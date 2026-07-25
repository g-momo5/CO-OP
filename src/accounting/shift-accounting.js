const {
  clone,
  normalizeDate,
  normalizeItems,
  parseObject,
  roundMoney,
  sumAmounts,
  toNumber
} = require('./common');
const { recalculateFuelData, validateFuelData } = require('./fuel-accounting');
const { recalculateOilData, validateOilData } = require('./oil-accounting');

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
    customer_rows: normalizeItems(row.customer_rows || legacyData.customer_rows),
    revenue_items: normalizeItems(row.revenue_items || legacyData.revenue_items),
    customer_payments: normalizeItems(row.customer_payments || legacyData.customer_payments),
    expense_items: normalizeItems(row.expense_items || legacyData.expense_items),
    wash_lube_revenue: toNumber(row.wash_lube_revenue ?? legacyData.wash_lube_revenue),
    total_expenses: toNumber(row.total_expenses ?? legacyData.total_expenses),
    grand_total: toNumber(row.grand_total ?? legacyData.grand_total),
    is_saved: row.is_saved === undefined ? 1 : (row.is_saved ? 1 : 0)
  };
}

function calculateShiftTotals(rawShift = {}, options = {}) {
  const shift = normalizeShiftRecord(rawShift);
  const fuel = recalculateFuelData(shift.fuel_data, options.previousFuelData || {});
  const oil = recalculateOilData(shift.oil_data, options.previousOilData || {});

  shift.fuel_data = fuel.fuel_data;
  shift.fuel_total = fuel.fuel_total;
  shift.oil_data = oil.oil_data;
  shift.oil_total = oil.oil_total;
  shift.total_expenses = shift.expense_items.length > 0 ? sumAmounts(shift.expense_items) : shift.total_expenses;

  const totalRevenue = shift.fuel_total
    + shift.oil_total
    + shift.wash_lube_revenue
    + sumAmounts(shift.revenue_items)
    + sumAmounts(shift.customer_payments);

  shift.grand_total = roundMoney(totalRevenue - shift.total_expenses);

  return {
    shift,
    totals: {
      fuel_total: shift.fuel_total,
      oil_total: shift.oil_total,
      wash_lube_revenue: shift.wash_lube_revenue,
      extra_revenue: sumAmounts(shift.revenue_items),
      customer_payments: sumAmounts(shift.customer_payments),
      total_revenue: roundMoney(totalRevenue),
      total_expenses: shift.total_expenses,
      grand_total: shift.grand_total
    },
    errors: [...fuel.errors, ...oil.errors]
  };
}

function validateShiftAccounting(rawShift = {}, options = {}) {
  const shift = normalizeShiftRecord(rawShift);
  return [
    ...validateFuelData(shift.fuel_data),
    ...validateOilData(shift.oil_data, options)
  ];
}

module.exports = {
  calculateShiftTotals,
  normalizeShiftRecord,
  validateShiftAccounting
};
