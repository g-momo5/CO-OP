const {
  getEntryName,
  monthToRange,
  normalizeDate,
  normalizeMonth,
  normalizeName,
  roundQuantity,
  toNumber
} = require('./common');
const { getFuelCounterCount } = require('./fuel-accounting');
const { buildSalesSummaryView, normalizeFuelTypeForSalesSummary } = require('./sales-summary-view');

const SALES_RECONCILIATION_TOLERANCE = 0.01;

function previousMonth(monthKey) {
  const month = normalizeMonth(monthKey);
  if (!month) return '';
  const [yearText, monthText] = month.split('-');
  let year = parseInt(yearText, 10);
  let monthNumber = parseInt(monthText, 10) - 1;
  if (monthNumber < 1) {
    monthNumber = 12;
    year -= 1;
  }
  return `${year}-${String(monthNumber).padStart(2, '0')}`;
}

function compareShifts(a, b) {
  const dateA = normalizeDate(a?.date);
  const dateB = normalizeDate(b?.date);
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const shiftA = parseInt(a?.shift_number, 10);
  const shiftB = parseInt(b?.shift_number, 10);
  const safeShiftA = Number.isFinite(shiftA) ? shiftA : 0;
  const safeShiftB = Number.isFinite(shiftB) ? shiftB : 0;
  if (safeShiftA !== safeShiftB) return safeShiftA - safeShiftB;

  const idA = parseInt(a?.id, 10);
  const idB = parseInt(b?.id, 10);
  return (Number.isFinite(idA) ? idA : 0) - (Number.isFinite(idB) ? idB : 0);
}

function inRange(date, startDate, endDate) {
  const normalized = normalizeDate(date);
  return normalized && normalized >= startDate && normalized <= endDate;
}

function getShiftLabel(shift) {
  if (!shift) return null;
  return {
    date: normalizeDate(shift.date),
    shift_number: shift.shift_number ?? null
  };
}

function normalizeFuelName(entryKey, data) {
  return normalizeFuelTypeForSalesSummary(getEntryName(entryKey, data));
}

function normalizeOilName(entryKey, data) {
  return normalizeName(getEntryName(entryKey, data));
}

function getConfiguredProductNames(products = [], type) {
  return (Array.isArray(products) ? products : [])
    .filter((product) => (
      !type
      || product.product_type === type
      || product.type === type
      || (type === 'fuel' && product.fuel_type)
      || (type === 'oil' && product.oil_type)
    ))
    .map((product) => normalizeName(product.name || product.product_name || product.fuel_type || product.oil_type || ''))
    .filter(Boolean);
}

function collectFuelNames({ fuelProducts = [], shifts = [], summaryRows = [] } = {}) {
  const names = new Set();
  getConfiguredProductNames(fuelProducts, 'fuel')
    .map((name) => normalizeFuelTypeForSalesSummary(name))
    .filter(Boolean)
    .forEach((name) => names.add(name));

  summaryRows
    .filter((row) => row?.type === 'fuel')
    .map((row) => normalizeFuelTypeForSalesSummary(row.product || row.name))
    .filter(Boolean)
    .forEach((name) => names.add(name));

  shifts.forEach((shift) => {
    Object.entries(shift?.fuel_data || {}).forEach(([entryKey, data]) => {
      const name = normalizeFuelName(entryKey, data);
      if (name) names.add(name);
    });
  });

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'ar'));
}

function collectOilNames({ oilProducts = [], shifts = [], summaryRows = [] } = {}) {
  const names = new Set(getConfiguredProductNames(oilProducts, 'oil'));

  summaryRows
    .filter((row) => row?.type === 'oil')
    .map((row) => normalizeOilName(row.product || row.name, {}))
    .filter(Boolean)
    .forEach((name) => names.add(name));

  shifts.forEach((shift) => {
    Object.entries(shift?.oil_data || {}).forEach(([entryKey, data]) => {
      const name = normalizeOilName(entryKey, data);
      if (name) names.add(name);
    });
  });

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'ar'));
}

function getFuelEntriesForProduct(shift, productName) {
  return Object.entries(shift?.fuel_data || {})
    .filter(([entryKey, data]) => normalizeFuelName(entryKey, data) === productName);
}

function getOilEntriesForProduct(shift, productName) {
  return Object.entries(shift?.oil_data || {})
    .filter(([entryKey, data]) => normalizeOilName(entryKey, data) === productName);
}

function sumFuelFinalCounters(entries = []) {
  let total = 0;
  let hasReading = false;
  const counters = [];

  entries.forEach(([entryKey, data]) => {
    const count = getFuelCounterCount(entryKey, data);
    for (let i = 1; i <= count; i += 1) {
      const key = `lastShift${i}`;
      if (!Object.prototype.hasOwnProperty.call(data || {}, key)) continue;
      const value = toNumber(data[key]);
      counters[i - 1] = toNumber(counters[i - 1]) + value;
      total += value;
      hasReading = true;
    }
  });

  return {
    total: roundQuantity(total),
    counters: counters.map((value) => roundQuantity(value)),
    hasReading
  };
}

function findLatestFuelReading(shifts, productName, startDate, endDate) {
  const candidates = shifts
    .filter((shift) => inRange(shift?.date, startDate, endDate))
    .map((shift) => ({ shift, entries: getFuelEntriesForProduct(shift, productName) }))
    .filter((item) => item.entries.length > 0)
    .sort((a, b) => compareShifts(a.shift, b.shift));

  const latest = candidates[candidates.length - 1] || null;
  if (!latest) return null;

  const reading = sumFuelFinalCounters(latest.entries);
  return {
    shift: getShiftLabel(latest.shift),
    ...reading
  };
}

function findLatestOilReading(shifts, productName, startDate, endDate) {
  const candidates = shifts
    .filter((shift) => inRange(shift?.date, startDate, endDate))
    .map((shift) => ({ shift, entries: getOilEntriesForProduct(shift, productName) }))
    .filter((item) => item.entries.length > 0)
    .sort((a, b) => compareShifts(a.shift, b.shift));

  const latest = candidates[candidates.length - 1] || null;
  if (!latest) return null;

  let total = 0;
  let hasReading = false;
  latest.entries.forEach(([_entryKey, data]) => {
    if (!Object.prototype.hasOwnProperty.call(data || {}, 'remaining')) return;
    total += toNumber(data.remaining);
    hasReading = true;
  });

  return {
    shift: getShiftLabel(latest.shift),
    remaining: roundQuantity(total),
    hasReading
  };
}

function sumFuelCalibrations(shifts, productName, startDate, endDate) {
  return roundQuantity(shifts
    .filter((shift) => inRange(shift?.date, startDate, endDate))
    .reduce((sum, shift) => (
      sum + getFuelEntriesForProduct(shift, productName)
        .reduce((entrySum, [_entryKey, data]) => entrySum + toNumber(data?.cars), 0)
    ), 0));
}

function sumOilAdded(shifts, productName, startDate, endDate) {
  return roundQuantity(shifts
    .filter((shift) => inRange(shift?.date, startDate, endDate))
    .reduce((sum, shift) => (
      sum + getOilEntriesForProduct(shift, productName)
        .reduce((entrySum, [_entryKey, data]) => entrySum + toNumber(data?.added), 0)
    ), 0));
}

function getSummaryQuantities(summaryRows = [], monthKey) {
  const quantities = new Map();
  summaryRows.forEach((row) => {
    const product = normalizeName(row?.product || row?.name || '');
    if (!product) return;
    quantities.set(product, roundQuantity(toNumber(row?.byMonth?.[monthKey])));
  });
  return quantities;
}

function getStatus(expectedQuantity, summaryQuantity, hasAllData, tolerance) {
  if (!hasAllData) {
    return {
      status: 'missing',
      status_label: 'بيانات ناقصة'
    };
  }

  const difference = roundQuantity(expectedQuantity - summaryQuantity);
  if (Math.abs(difference) <= tolerance) {
    return {
      status: 'ok',
      status_label: 'مطابق'
    };
  }

  return {
    status: 'mismatch',
    status_label: 'فرق'
  };
}

function buildFuelReconciliationRows({ monthKey, ranges, shifts, fuelNames, summaryQuantities, tolerance }) {
  return fuelNames.map((product) => {
    const previousReading = findLatestFuelReading(shifts, product, ranges.previous.startDate, ranges.previous.endDate);
    const currentReading = findLatestFuelReading(shifts, product, ranges.current.startDate, ranges.current.endDate);
    const calibrations = sumFuelCalibrations(shifts, product, ranges.current.startDate, ranges.current.endDate);
    const previousCounter = previousReading?.hasReading ? previousReading.total : 0;
    const currentCounter = currentReading?.hasReading ? currentReading.total : 0;
    const grossQuantity = roundQuantity(currentCounter - previousCounter);
    const expectedQuantity = roundQuantity(grossQuantity - calibrations);
    const summaryQuantity = roundQuantity(toNumber(summaryQuantities.get(product)));
    const hasAllData = Boolean(previousReading?.hasReading && currentReading?.hasReading);
    const difference = hasAllData ? roundQuantity(expectedQuantity - summaryQuantity) : null;
    const status = getStatus(expectedQuantity, summaryQuantity, hasAllData, tolerance);

    return {
      product,
      type: 'fuel',
      month: monthKey,
      previous_counter: previousCounter,
      current_counter: currentCounter,
      gross_quantity: grossQuantity,
      calibrations,
      expected_quantity: expectedQuantity,
      summary_quantity: summaryQuantity,
      difference,
      previous_shift: previousReading?.shift || null,
      current_shift: currentReading?.shift || null,
      counter_values: currentReading?.counters || [],
      ...status
    };
  });
}

function buildOilReconciliationRows({ monthKey, ranges, shifts, oilNames, summaryQuantities, tolerance }) {
  return oilNames.map((product) => {
    const previousReading = findLatestOilReading(shifts, product, ranges.previous.startDate, ranges.previous.endDate);
    const currentReading = findLatestOilReading(shifts, product, ranges.current.startDate, ranges.current.endDate);
    const added = sumOilAdded(shifts, product, ranges.current.startDate, ranges.current.endDate);
    const previousRemaining = previousReading?.hasReading ? previousReading.remaining : 0;
    const currentRemaining = currentReading?.hasReading ? currentReading.remaining : 0;
    const expectedQuantity = roundQuantity(previousRemaining + added - currentRemaining);
    const summaryQuantity = roundQuantity(toNumber(summaryQuantities.get(product)));
    const hasAllData = Boolean(previousReading?.hasReading && currentReading?.hasReading);
    const difference = hasAllData ? roundQuantity(expectedQuantity - summaryQuantity) : null;
    const status = getStatus(expectedQuantity, summaryQuantity, hasAllData, tolerance);

    return {
      product,
      type: 'oil',
      month: monthKey,
      previous_remaining: previousRemaining,
      added,
      current_remaining: currentRemaining,
      expected_quantity: expectedQuantity,
      summary_quantity: summaryQuantity,
      difference,
      previous_shift: previousReading?.shift || null,
      current_shift: currentReading?.shift || null,
      ...status
    };
  });
}

function countStatuses(rows = []) {
  return rows.reduce((totals, row) => {
    const key = row?.status || 'missing';
    totals[key] = (totals[key] || 0) + 1;
    totals.total += 1;
    return totals;
  }, { total: 0, ok: 0, mismatch: 0, missing: 0 });
}

function buildSalesReconciliationView({
  month,
  fuelProducts = [],
  oilProducts = [],
  shifts = [],
  manualSales = [],
  tolerance = SALES_RECONCILIATION_TOLERANCE
} = {}) {
  const monthKey = normalizeMonth(month);
  const currentRange = monthToRange(monthKey);
  const previousMonthKey = previousMonth(monthKey);
  const previousRange = monthToRange(previousMonthKey);

  if (!monthKey || !currentRange || !previousRange) {
    return {
      month: '',
      previous_month: '',
      start_date: '',
      end_date: '',
      tolerance,
      fuel_rows: [],
      oil_rows: [],
      totals: { total: 0, ok: 0, mismatch: 0, missing: 0 }
    };
  }

  const normalizedShifts = (Array.isArray(shifts) ? shifts : [])
    .filter((shift) => normalizeDate(shift?.date))
    .sort(compareShifts);
  const currentMonthShifts = normalizedShifts.filter((shift) => inRange(shift?.date, currentRange.startDate, currentRange.endDate));
  const summary = buildSalesSummaryView({
    fromMonth: monthKey,
    toMonth: monthKey,
    fuelProducts,
    oilProducts,
    shifts: currentMonthShifts,
    manualSales
  });
  const summaryQuantities = getSummaryQuantities(summary.rows, monthKey);
  const ranges = {
    current: currentRange,
    previous: previousRange
  };
  const fuelNames = collectFuelNames({ fuelProducts, shifts: normalizedShifts, summaryRows: summary.rows });
  const oilNames = collectOilNames({ oilProducts, shifts: normalizedShifts, summaryRows: summary.rows });
  const fuelRows = buildFuelReconciliationRows({
    monthKey,
    ranges,
    shifts: normalizedShifts,
    fuelNames,
    summaryQuantities,
    tolerance
  });
  const oilRows = buildOilReconciliationRows({
    monthKey,
    ranges,
    shifts: normalizedShifts,
    oilNames,
    summaryQuantities,
    tolerance
  });
  const totals = countStatuses([...fuelRows, ...oilRows]);

  return {
    month: monthKey,
    previous_month: previousMonthKey,
    start_date: currentRange.startDate,
    end_date: currentRange.endDate,
    tolerance,
    fuel_rows: fuelRows,
    oil_rows: oilRows,
    totals
  };
}

module.exports = {
  SALES_RECONCILIATION_TOLERANCE,
  buildSalesReconciliationView,
  previousMonth
};
