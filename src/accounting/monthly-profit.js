const {
  buildMonthRange,
  normalizeDate,
  normalizeMonth,
  roundMoney,
  toNumber
} = require('./common');
const { getFuelProfitValue } = require('./fuel-accounting');
const { getOilProfitValue } = require('./oil-accounting');
const { normalizeShiftRecord } = require('./shift-accounting');
const {
  groupOilPurchasesByMonth,
  normalizeFuelProfitKey
} = require('./invoice-accounting');
const {
  buildAccountingFuelPurchaseMaps,
  buildAccountingProfitRows
} = require('./monthly-accounting');

function mapMonthlyInputs(rows = []) {
  const byMonth = new Map();
  rows.forEach((row) => {
    const monthKey = normalizeMonth(row.month_key);
    if (!monthKey) return;
    byMonth.set(monthKey, {
      fuel_diesel: toNumber(row.fuel_diesel),
      fuel_80: toNumber(row.fuel_80),
      fuel_92: toNumber(row.fuel_92),
      fuel_95: toNumber(row.fuel_95),
      oil_total: toNumber(row.oil_total),
      bonuses: toNumber(row.bonuses),
      commission_diff: toNumber(row.commission_diff),
      deposit_tax: toNumber(row.deposit_tax),
      bonus_tax: toNumber(row.bonus_tax)
    });
  });
  return byMonth;
}

function mapCustomValues(rows = []) {
  const byRow = new Map();
  rows.forEach((row) => {
    const rowKey = String(row.row_key || '').trim();
    const monthKey = normalizeMonth(row.month_key);
    if (!rowKey || !monthKey) return;
    if (!byRow.has(rowKey)) byRow.set(rowKey, new Map());
    byRow.get(rowKey).set(monthKey, (byRow.get(rowKey).get(monthKey) || 0) + toNumber(row.amount));
  });
  return byRow;
}

function normalizeProfitRowDefinition(row = {}) {
  const rowKey = String(row?.row_key || '').trim();
  if (!rowKey) return null;
  return {
    ...row,
    row_key: rowKey,
    row_label: String(row?.row_label || rowKey).trim() || rowKey,
    row_type: row?.row_type === 'deduction' ? 'deduction' : 'revenue'
  };
}

function normalizeProfitLabelTokens(label = '') {
  return String(label || '')
    .replace(/[0-9٠-٩]+/g, ' ')
    .replace(/[.,،٫٪%/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length >= 3 && !['شهر', 'على', 'عن', 'الى', 'إلى'].includes(token));
}

function profitLabelsMayReferToSameEntry(firstLabel = '', secondLabel = '') {
  const first = normalizeProfitLabelTokens(firstLabel);
  const second = new Set(normalizeProfitLabelTokens(secondLabel));
  if (!first.length || !second.size) return false;
  return first.some((token) => second.has(token));
}

function buildProfitValueMap(valueRows = []) {
  const byRow = new Map();
  (Array.isArray(valueRows) ? valueRows : []).forEach((row) => {
    const rowKey = String(row?.row_key || '').trim();
    const monthKey = normalizeMonth(row?.month_key);
    if (!rowKey || !monthKey) return;
    if (!byRow.has(rowKey)) byRow.set(rowKey, new Map());
    const rowMap = byRow.get(rowKey);
    rowMap.set(monthKey, roundMoney((rowMap.get(monthKey) || 0) + toNumber(row?.amount)));
  });
  return byRow;
}

function hasProfitRowValue(rowKey, valueMap, months = []) {
  const rowMap = valueMap.get(String(rowKey || '').trim());
  if (!rowMap) return false;
  return (Array.isArray(months) ? months : [])
    .some((monthKey) => Math.abs(toNumber(rowMap.get(monthKey))) > 0.0001);
}

function filterProfitRowsWithValues(rowDefinitions = [], valueRows = [], months = []) {
  const normalizedMonths = (Array.isArray(months) ? months : [])
    .map((monthKey) => normalizeMonth(monthKey))
    .filter(Boolean);
  const valueMap = buildProfitValueMap(valueRows);

  return (Array.isArray(rowDefinitions) ? rowDefinitions : [])
    .map((row) => normalizeProfitRowDefinition(row))
    .filter((row) => row && hasProfitRowValue(row.row_key, valueMap, normalizedMonths));
}

function findSupersededProfitCustomRowKeys({
  customRows = [],
  customValues = [],
  accountingRows = [],
  accountingValues = [],
  months = []
} = {}) {
  const normalizedMonths = (Array.isArray(months) ? months : [])
    .map((monthKey) => normalizeMonth(monthKey))
    .filter(Boolean);
  const customValueMap = buildProfitValueMap(customValues);
  const accountingValueMap = buildProfitValueMap(accountingValues);
  const accountingRowsByType = (Array.isArray(accountingRows) ? accountingRows : [])
    .map((row) => normalizeProfitRowDefinition(row))
    .filter(Boolean)
    .reduce((map, row) => {
      if (!map.has(row.row_type)) map.set(row.row_type, []);
      map.get(row.row_type).push(row);
      return map;
    }, new Map());
  const superseded = new Set();

  (Array.isArray(customRows) ? customRows : []).forEach((rawRow) => {
    const customRow = normalizeProfitRowDefinition(rawRow);
    if (!customRow) return;
    const customMonthValues = normalizedMonths
      .map((monthKey) => ({
        monthKey,
        amount: toNumber(customValueMap.get(customRow.row_key)?.get(monthKey))
      }))
      .filter((entry) => Math.abs(entry.amount) > 0.0001);
    if (customMonthValues.length === 0) return;

    const matchingAccountingRow = (accountingRowsByType.get(customRow.row_type) || [])
      .find((accountingRow) => (
        profitLabelsMayReferToSameEntry(customRow.row_label, accountingRow.row_label)
        && customMonthValues.every((entry) => (
          roundMoney(accountingValueMap.get(accountingRow.row_key)?.get(entry.monthKey)) === roundMoney(entry.amount)
        ))
      ));

    if (matchingAccountingRow) {
      superseded.add(customRow.row_key);
    }
  });

  return superseded;
}

function calculateMonthlyProfit({
  shifts = [],
  fuelInvoices = [],
  oilInvoices = [],
  monthlyInputs = [],
  customRows = [],
  customValues = [],
  monthlyAccountingDocuments = [],
  fromMonth,
  toMonth
} = {}) {
  const months = buildMonthRange(fromMonth, toMonth);
  if (months.length === 0) return [];

  const manualByMonth = mapMonthlyInputs(monthlyInputs);
  const fuelRevenue = {
    fuel_diesel: new Map(),
    fuel_80: new Map(),
    fuel_92: new Map(),
    fuel_95: new Map()
  };
  const oilRevenue = new Map();
  const washByMonth = new Map();
  const expensesByMonth = new Map();

  shifts.map(normalizeShiftRecord).forEach((shift) => {
    const monthKey = normalizeMonth(normalizeDate(shift.date));
    if (!months.includes(monthKey)) return;
    fuelRevenue.fuel_diesel.set(monthKey, (fuelRevenue.fuel_diesel.get(monthKey) || 0) + getFuelProfitValue(shift.fuel_data, 'سولار'));
    fuelRevenue.fuel_80.set(monthKey, (fuelRevenue.fuel_80.get(monthKey) || 0) + getFuelProfitValue(shift.fuel_data, 'بنزين ٨٠'));
    fuelRevenue.fuel_92.set(monthKey, (fuelRevenue.fuel_92.get(monthKey) || 0) + getFuelProfitValue(shift.fuel_data, 'بنزين ٩٢'));
    fuelRevenue.fuel_95.set(monthKey, (fuelRevenue.fuel_95.get(monthKey) || 0) + getFuelProfitValue(shift.fuel_data, 'بنزين ٩٥'));
    oilRevenue.set(monthKey, (oilRevenue.get(monthKey) || 0) + getOilProfitValue(shift.oil_data));
    washByMonth.set(monthKey, (washByMonth.get(monthKey) || 0) + shift.wash_lube_revenue);
    expensesByMonth.set(monthKey, (expensesByMonth.get(monthKey) || 0) + shift.total_expenses);
  });

  const { purchases: fuelPurchases, insuranceByMonth } = buildAccountingFuelPurchaseMaps(
    monthlyAccountingDocuments,
    normalizeFuelProfitKey
  );
  const oilPurchases = groupOilPurchasesByMonth(oilInvoices);
  const accountingProfit = buildAccountingProfitRows(monthlyAccountingDocuments);
  const customValuesByRow = mapCustomValues(customValues);
  const accountingValuesByRow = mapCustomValues(accountingProfit.values);
  const normalizedCustomRows = [
    ...customRows.map((row) => ({
      row_key: String(row.row_key || '').trim(),
      row_type: row.row_type === 'deduction' ? 'deduction' : 'revenue',
      source: 'monthly_profit'
    })),
    ...accountingProfit.rows.map((row) => ({
      row_key: String(row.row_key || '').trim(),
      row_type: row.row_type === 'deduction' ? 'deduction' : 'revenue',
      source: 'monthly_accounting'
    }))
  ].filter((row) => row.row_key);

  return months.map((monthKey) => {
    const manual = manualByMonth.get(monthKey) || {};
    const fuel_diesel = (fuelRevenue.fuel_diesel.has(monthKey) ? fuelRevenue.fuel_diesel.get(monthKey) : toNumber(manual.fuel_diesel))
      - toNumber(fuelPurchases.fuel_diesel.get(monthKey));
    const fuel_80 = (fuelRevenue.fuel_80.has(monthKey) ? fuelRevenue.fuel_80.get(monthKey) : toNumber(manual.fuel_80))
      - toNumber(fuelPurchases.fuel_80.get(monthKey));
    const fuel_92 = (fuelRevenue.fuel_92.has(monthKey) ? fuelRevenue.fuel_92.get(monthKey) : toNumber(manual.fuel_92))
      - toNumber(fuelPurchases.fuel_92.get(monthKey));
    const fuel_95 = (fuelRevenue.fuel_95.has(monthKey) ? fuelRevenue.fuel_95.get(monthKey) : toNumber(manual.fuel_95))
      - toNumber(fuelPurchases.fuel_95.get(monthKey));
    const fuel_total_month = fuel_diesel + fuel_80 + fuel_92 + fuel_95;
    const oil_total = (oilRevenue.has(monthKey) ? oilRevenue.get(monthKey) : toNumber(manual.oil_total))
      - toNumber(oilPurchases.get(monthKey));
    const wash_lube_month = toNumber(washByMonth.get(monthKey));
    const expenses_month = toNumber(expensesByMonth.get(monthKey));
    const bonuses = toNumber(manual.bonuses);
    const commission_diff = toNumber(manual.commission_diff);
    const deposit_tax = toNumber(manual.deposit_tax);
    const bonus_tax = toNumber(manual.bonus_tax);
    const cash_insurance_month = toNumber(insuranceByMonth.get(monthKey));

    let custom_revenue_total = 0;
    let custom_deduction_total = 0;
    const custom_values = {};
    const accounting_values = {};
    normalizedCustomRows.forEach((row) => {
      const amount = row.source === 'monthly_accounting'
        ? toNumber(accountingValuesByRow.get(row.row_key)?.get(monthKey))
        : toNumber(customValuesByRow.get(row.row_key)?.get(monthKey));
      if (row.source === 'monthly_accounting') accounting_values[row.row_key] = amount;
      else custom_values[row.row_key] = amount;
      if (row.row_type === 'deduction') custom_deduction_total += amount;
      else custom_revenue_total += amount;
    });

    const total_positive = fuel_total_month + oil_total + wash_lube_month + custom_revenue_total;
    const total_deductions = expenses_month + custom_deduction_total;
    const net_profit = total_positive - total_deductions;

    return {
      month_key: monthKey,
      fuel_diesel: roundMoney(fuel_diesel),
      fuel_80: roundMoney(fuel_80),
      fuel_92: roundMoney(fuel_92),
      fuel_95: roundMoney(fuel_95),
      fuel_total_month: roundMoney(fuel_total_month),
      fuel_total: roundMoney(fuel_total_month),
      oil_total: roundMoney(oil_total),
      wash_lube_month: roundMoney(wash_lube_month),
      wash_lube_revenue: roundMoney(wash_lube_month),
      bonuses,
      commission_diff,
      custom_revenue_total: roundMoney(custom_revenue_total),
      total_positive: roundMoney(total_positive),
      expenses_month: roundMoney(expenses_month),
      cash_insurance_month: roundMoney(cash_insurance_month),
      deposit_tax,
      bonus_tax,
      custom_deduction_total: roundMoney(custom_deduction_total),
      total_deductions: roundMoney(total_deductions),
      net_profit: roundMoney(net_profit),
      custom_values,
      accounting_values
    };
  });
}

module.exports = {
  calculateMonthlyProfit,
  filterProfitRowsWithValues,
  findSupersededProfitCustomRowKeys
};
