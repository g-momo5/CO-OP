const {
  recalculateFuelData: recalculateFuelDataAccounting
} = require('./accounting/fuel-accounting');
const {
  recalculateOilData: recalculateOilDataAccounting
} = require('./accounting/oil-accounting');
const {
  calculateShiftTotals,
  normalizeShiftRecord: normalizeShiftRecordAccounting
} = require('./accounting/shift-accounting');

function toNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundQuantity(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function parseObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getEntryName(entryKey, data = {}) {
  return normalizeName(data?.product_name || data?.oil_type || data?.fuel_type || entryKey || '');
}

function getEntryCode(entryKey, data = {}) {
  return normalizeName(data?.product_code || entryKey || '');
}

function getCounterCount(entryKey, data = {}) {
  return getEntryName(entryKey, data) === 'سولار' ? 4 : 2;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeItems(items) {
  return Array.isArray(items) ? clone(items) : [];
}

function normalizeShiftRecord(row = {}) {
  return normalizeShiftRecordAccounting(row);
}

function buildEntryLookup(entries = {}) {
  const byCode = new Map();
  const byName = new Map();

  Object.entries(entries || {}).forEach(([entryKey, data]) => {
    if (!data || typeof data !== 'object') return;
    const code = getEntryCode(entryKey, data);
    const name = getEntryName(entryKey, data);
    if (code) byCode.set(code, data);
    if (name) byName.set(name, data);
  });

  return { byCode, byName };
}

function findMatchingEntry(previousEntries, entryKey, data) {
  const lookup = buildEntryLookup(previousEntries);
  const code = getEntryCode(entryKey, data);
  const name = getEntryName(entryKey, data);
  return lookup.byCode.get(code) || lookup.byName.get(name) || null;
}

function recalculateFuelData(currentFuelData = {}, previousFuelData = {}) {
  return recalculateFuelDataAccounting(currentFuelData, previousFuelData);
}

function recalculateOilData(currentOilData = {}, previousOilData = {}) {
  return recalculateOilDataAccounting(currentOilData, previousOilData);
}

function sumAmounts(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + toNumber(item?.amount), 0);
}

function recalculateGrandTotal(shift) {
  return calculateShiftTotals(shift).totals.grand_total;
}

function shiftKey(shift) {
  return `${normalizeDate(shift?.date)}|${parseInt(shift?.shift_number, 10) || 1}`;
}

function serializeShiftForPersistence(shift) {
  return {
    date: shift.date,
    shift_number: shift.shift_number,
    fuel_data: JSON.stringify(shift.fuel_data || {}),
    fuel_total: toNumber(shift.fuel_total),
    oil_data: JSON.stringify(shift.oil_data || {}),
    oil_total: toNumber(shift.oil_total),
    customer_rows: normalizeItems(shift.customer_rows),
    revenue_items: normalizeItems(shift.revenue_items),
    customer_payments: normalizeItems(shift.customer_payments),
    expense_items: normalizeItems(shift.expense_items),
    wash_lube_revenue: toNumber(shift.wash_lube_revenue),
    total_expenses: toNumber(shift.total_expenses),
    grand_total: toNumber(shift.grand_total),
    is_saved: shift.is_saved ? 1 : 0
  };
}

function buildCascadeUpdates({ sourceShift, followingShifts = [], resetShiftKeys = new Set() } = {}) {
  let previousShift = normalizeShiftRecord(sourceShift);
  const updates = [];
  const validationErrors = [];

  for (const rawShift of followingShifts) {
    const currentShift = normalizeShiftRecord(rawShift);
    const key = shiftKey(currentShift);

    if (resetShiftKeys.has(key)) {
      return {
        updates,
        stopped_at: { date: currentShift.date, shift_number: currentShift.shift_number },
        stopped_reason: 'manual_reset',
        validationErrors
      };
    }

    const fuel = recalculateFuelData(currentShift.fuel_data, previousShift.fuel_data);
    const oil = recalculateOilData(currentShift.oil_data, previousShift.oil_data);

    currentShift.fuel_data = fuel.fuel_data;
    currentShift.fuel_total = fuel.fuel_total;
    currentShift.oil_data = oil.oil_data;
    currentShift.oil_total = oil.oil_total;
    currentShift.grand_total = recalculateGrandTotal(currentShift);

    validationErrors.push(...fuel.errors, ...oil.errors);
    updates.push({
      shift: currentShift,
      payload: serializeShiftForPersistence(currentShift)
    });

    previousShift = currentShift;
  }

  return {
    updates,
    stopped_at: null,
    stopped_reason: null,
    validationErrors
  };
}

module.exports = {
  buildCascadeUpdates,
  normalizeShiftRecord,
  recalculateFuelData,
  recalculateOilData,
  serializeShiftForPersistence,
  shiftKey
};
