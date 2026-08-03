const { getEntryName, normalizeDate, normalizeMonth, parseObject, roundQuantity, toNumber } = require('./common');
const { getShiftFuelSoldQuantity } = require('./fuel-accounting');
const { extractAccountingFuelPurchaseRows } = require('./monthly-accounting');

const HOME_CHART_MODES = {
  SALES: 'sales',
  PURCHASES: 'purchases',
  PROFIT: 'profit'
};

const HOME_CHART_FUEL_TYPES = ['بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'سولار', 'غاز سيارات'];
const HOME_CHART_PURCHASE_FUEL_TYPES = HOME_CHART_FUEL_TYPES.filter((fuelType) => fuelType !== 'غاز سيارات');

function normalizeFuelTypeForChart(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const normalized = text
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .toLowerCase();

  if (normalized === 'سولار' || normalized === 'ديزل' || normalized === 'diesel') return 'سولار';
  if (normalized === 'غاز سيارات' || normalized === 'gas') return 'غاز سيارات';

  const isFuelName = /بنزين|benz|gasoline|petrol/.test(normalized);
  const hasOctane = (octane) => new RegExp(`(^|[^0-9])${octane}([^0-9]|$)`).test(normalized);
  if (isFuelName && hasOctane('95')) return 'بنزين ٩٥';
  if (isFuelName && hasOctane('92')) return 'بنزين ٩٢';
  if (isFuelName && (hasOctane('80') || normalized === 'بنزين 8')) return 'بنزين ٨٠';

  return text;
}

function addChartQuantity(entries, date, fuelType, quantity, allowedFuelTypes = HOME_CHART_FUEL_TYPES) {
  const day = normalizeDate(date);
  const normalizedFuelType = normalizeFuelTypeForChart(fuelType);
  const amount = toNumber(quantity);
  if (!day || !normalizedFuelType || amount <= 0 || !allowedFuelTypes.includes(normalizedFuelType)) return;
  entries.push({
    date: day,
    fuel_type: normalizedFuelType,
    quantity: roundQuantity(amount)
  });
}

function aggregateChartEntries(entries = []) {
  const byDayAndFuel = new Map();
  entries.forEach((entry) => {
    const date = normalizeDate(entry?.date);
    const fuelType = normalizeFuelTypeForChart(entry?.fuel_type);
    if (!date || !fuelType) return;
    const key = `${date}__${fuelType}`;
    const current = byDayAndFuel.get(key) || { date, fuel_type: fuelType, quantity: 0 };
    current.quantity = roundQuantity(current.quantity + toNumber(entry?.quantity));
    byDayAndFuel.set(key, current);
  });
  return Array.from(byDayAndFuel.values()).sort((a, b) => (
    a.date.localeCompare(b.date) || a.fuel_type.localeCompare(b.fuel_type, 'ar')
  ));
}

function getLatestAccountingChartMonth(accountingMonths = []) {
  const months = (Array.isArray(accountingMonths) ? accountingMonths : [])
    .map((month) => normalizeMonth(month))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return months[months.length - 1] || '';
}

function filterProfitRowsThroughLatestAccountingMonth(rows = [], accountingMonths = null) {
  if (!Array.isArray(accountingMonths)) return Array.isArray(rows) ? rows : [];
  const latestAccountingMonth = getLatestAccountingChartMonth(accountingMonths);
  if (!latestAccountingMonth) return [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const monthKey = normalizeMonth(row?.month_key || String(row?.date || '').slice(0, 7));
    return monthKey && monthKey <= latestAccountingMonth;
  });
}

function aggregateProfitChartEntries(rows = [], accountingMonths = null) {
  const byMonth = new Map();
  filterProfitRowsThroughLatestAccountingMonth(rows, accountingMonths).forEach((row) => {
    const monthKey = normalizeMonth(row?.month_key || String(row?.date || '').slice(0, 7));
    if (!monthKey) return;
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + toNumber(row?.net_profit));
  });

  return Array.from(byMonth.entries())
    .map(([month_key, net_profit]) => ({
      month_key,
      net_profit
    }))
    .sort((a, b) => a.month_key.localeCompare(b.month_key));
}

function buildHomeChartData({
  mode = HOME_CHART_MODES.SALES,
  sales = [],
  shifts = [],
  fuelMovements = [],
  monthlyAccountingDocuments = [],
  profitRows = [],
  accountingMonths = null
} = {}) {
  const selectedMode = Object.values(HOME_CHART_MODES).includes(mode) ? mode : HOME_CHART_MODES.SALES;
  const entries = [];

  if (selectedMode === HOME_CHART_MODES.PROFIT) {
    return { mode: selectedMode, entries: aggregateProfitChartEntries(profitRows, accountingMonths) };
  }

  if (selectedMode === HOME_CHART_MODES.PURCHASES) {
    (Array.isArray(monthlyAccountingDocuments) ? monthlyAccountingDocuments : []).forEach((document) => {
      if (!(document?.is_final === true || document?.is_final === 1)) return;
      const finalData = parseObject(document.final_data, {});
      extractAccountingFuelPurchaseRows(finalData).forEach((row) => {
        addChartQuantity(entries, row.date, row.fuel_type, row.quantity, HOME_CHART_PURCHASE_FUEL_TYPES);
      });
    });
    return { mode: selectedMode, entries: aggregateChartEntries(entries) };
  }

  sales.forEach((sale) => {
    addChartQuantity(entries, sale?.date, sale?.fuel_type || sale?.product_name, sale?.quantity);
  });

  shifts.forEach((shift) => {
    const shiftDate = normalizeDate(shift?.date);
    if (!shiftDate) return;
    Object.entries(shift?.fuel_data || {}).forEach(([entryKey, data]) => {
      if (!data || typeof data !== 'object') return;
      addChartQuantity(entries, shiftDate, getEntryName(entryKey, data), getShiftFuelSoldQuantity(entryKey, data));
    });
  });

  return { mode: selectedMode, entries: aggregateChartEntries(entries) };
}

module.exports = {
  HOME_CHART_FUEL_TYPES,
  HOME_CHART_MODES,
  aggregateChartEntries,
  aggregateProfitChartEntries,
  buildHomeChartData,
  filterProfitRowsThroughLatestAccountingMonth,
  normalizeFuelTypeForChart
};
