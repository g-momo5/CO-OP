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
  const legacyData = parseObject(row.data, {});
  const fuelData = parseObject(row.fuel_data || legacyData.fuel_data, {});
  const oilData = parseObject(row.oil_data || legacyData.oil_data, {});

  return {
    id: row.id ?? null,
    date: normalizeDate(row.date),
    shift_number: parseInt(row.shift_number, 10) || 1,
    fuel_data: clone(fuelData) || {},
    fuel_total: toNumber(row.fuel_total ?? legacyData.fuel_total),
    oil_data: clone(oilData) || {},
    oil_total: toNumber(row.oil_total ?? legacyData.oil_total),
    customer_rows: normalizeItems(legacyData.customer_rows),
    revenue_items: normalizeItems(legacyData.revenue_items),
    customer_payments: normalizeItems(legacyData.customer_payments),
    expense_items: normalizeItems(legacyData.expense_items),
    wash_lube_revenue: toNumber(row.wash_lube_revenue ?? legacyData.wash_lube_revenue),
    total_expenses: toNumber(row.total_expenses ?? legacyData.total_expenses),
    grand_total: toNumber(row.grand_total ?? legacyData.grand_total),
    is_saved: row.is_saved === undefined ? 1 : (row.is_saved ? 1 : 0)
  };
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
  const fuelData = clone(currentFuelData) || {};
  let fuelTotal = 0;
  const errors = [];

  Object.entries(fuelData).forEach(([entryKey, data]) => {
    if (!data || typeof data !== 'object') return;

    const previousData = findMatchingEntry(previousFuelData, entryKey, data);
    const counterCount = getCounterCount(entryKey, data);
    let totalQuantity = 0;

    for (let i = 1; i <= counterCount; i += 1) {
      if (previousData && previousData[`lastShift${i}`] !== undefined && previousData[`lastShift${i}`] !== null) {
        data[`firstShift${i}`] = toNumber(previousData[`lastShift${i}`]);
      }

      const firstShift = toNumber(data[`firstShift${i}`]);
      const lastShift = toNumber(data[`lastShift${i}`]);
      if (firstShift > 0 && lastShift < firstShift) {
        errors.push(`${getEntryName(entryKey, data)} (${i}): آخر الوردية يجب أن يكون أكبر من أو يساوي أول الوردية`);
      }

      const quantity = lastShift - firstShift;
      data[`quantity${i}`] = Math.round(quantity);
      totalQuantity += quantity;
    }

    data.totalQuantity = totalQuantity >= 0 ? Math.round(totalQuantity) : 0;
    data.cash = roundMoney((toNumber(data.totalQuantity) - (toNumber(data.clients) + toNumber(data.cars))) * toNumber(data.price));
    fuelTotal += toNumber(data.cash);
  });

  return {
    fuel_data: fuelData,
    fuel_total: roundMoney(fuelTotal),
    errors
  };
}

function recalculateOilData(currentOilData = {}, previousOilData = {}) {
  const oilData = clone(currentOilData) || {};
  let oilTotal = 0;
  const errors = [];

  Object.entries(oilData).forEach(([entryKey, data]) => {
    if (!data || typeof data !== 'object') return;

    const previousData = findMatchingEntry(previousOilData, entryKey, data);
    if (previousData && previousData.remaining !== undefined && previousData.remaining !== null) {
      data.initial = roundQuantity(previousData.remaining);
    }

    const total = roundQuantity(toNumber(data.initial) + toNumber(data.added));
    const remaining = roundQuantity(data.remaining);
    data.total = total;

    if (remaining > total && remaining > 0) {
      errors.push(`${getEntryName(entryKey, data)}: الكمية المتبقية يجب أن تكون أقل من أو تساوي الإجمالي المتاح`);
    }

    const sold = roundQuantity(total - remaining);
    data.sold = sold >= 0 ? sold : 0;

    const revenue = roundMoney((toNumber(data.sold) - toNumber(data.customers) - toNumber(data.open)) * toNumber(data.price));
    data.revenue = revenue >= 0 ? revenue : 0;
    oilTotal += toNumber(data.revenue);
  });

  return {
    oil_data: oilData,
    oil_total: roundMoney(oilTotal),
    errors
  };
}

function sumAmounts(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + toNumber(item?.amount), 0);
}

function recalculateGrandTotal(shift) {
  const totalRevenue = toNumber(shift.fuel_total)
    + toNumber(shift.oil_total)
    + toNumber(shift.wash_lube_revenue)
    + sumAmounts(shift.revenue_items)
    + sumAmounts(shift.customer_payments);
  return roundMoney(totalRevenue - toNumber(shift.total_expenses));
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
