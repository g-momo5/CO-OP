const {
  buildMonthRange,
  getEntryName,
  normalizeDate,
  normalizeMonth,
  toNumber
} = require('./common');
const { getShiftFuelSoldQuantity } = require('./fuel-accounting');
const { getOilSoldQuantity } = require('./oil-accounting');
const { normalizeShiftRecord } = require('./shift-accounting');

const DEFAULT_FUEL_ORDER = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'غاز سيارات'];

function normalizeProductRows(products = [], type) {
  return products
    .filter((product) => !type || product.product_type === type || product.type === type)
    .map((product) => String(product.name || product.product_name || product.fuel_type || product.oil_type || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ar'));
}

function buildMonthlySalesSummary({ shifts = [], manualSales = [], products = [], fromMonth, toMonth } = {}) {
  const months = buildMonthRange(fromMonth, toMonth);
  if (months.length === 0) {
    return { fromMonth, toMonth, months: [], rows: [] };
  }

  const fuelOrder = normalizeProductRows(products, 'fuel');
  const oilOrder = normalizeProductRows(products, 'oil');
  const fuelNames = new Set(fuelOrder.length ? fuelOrder : DEFAULT_FUEL_ORDER);
  const oilNames = new Set(oilOrder);
  const rowsByProduct = new Map();

  const getProductType = (name) => {
    if (fuelNames.has(name)) return 'fuel';
    if (oilNames.has(name)) return 'oil';
    return 'other';
  };

  const ensure = (name, forcedType = null) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    if (!rowsByProduct.has(cleanName)) {
      rowsByProduct.set(cleanName, {
        name: cleanName,
        type: forcedType || getProductType(cleanName),
        byMonth: Object.fromEntries(months.map((month) => [month, 0])),
        total: 0
      });
    } else if (forcedType && rowsByProduct.get(cleanName).type === 'other') {
      rowsByProduct.get(cleanName).type = forcedType;
    }
    return rowsByProduct.get(cleanName);
  };

  Array.from(fuelNames).forEach((name) => ensure(name, 'fuel'));
  Array.from(oilNames).forEach((name) => ensure(name, 'oil'));

  shifts.map(normalizeShiftRecord).forEach((shift) => {
    const monthKey = normalizeMonth(shift.date);
    if (!months.includes(monthKey)) return;

    Object.entries(shift.fuel_data || {}).forEach(([entryKey, data]) => {
      const fuelName = getEntryName(entryKey, data);
      const row = ensure(fuelName, 'fuel');
      if (!row) return;
      const quantity = getShiftFuelSoldQuantity(fuelName, data);
      row.byMonth[monthKey] += quantity;
      row.total += quantity;
    });

    Object.entries(shift.oil_data || {}).forEach(([entryKey, data]) => {
      const oilName = getEntryName(entryKey, data);
      const row = ensure(oilName, 'oil');
      if (!row) return;
      const quantity = getOilSoldQuantity(data);
      row.byMonth[monthKey] += quantity;
      row.total += quantity;
    });
  });

  manualSales.forEach((sale) => {
    const product = String(sale.fuel_type || sale.product || sale.product_name || '').trim();
    if (!product || fuelNames.has(product) || oilNames.has(product)) return;
    const monthKey = normalizeMonth(normalizeDate(sale.date));
    if (!months.includes(monthKey)) return;
    const row = ensure(product, 'other');
    if (!row) return;
    const quantity = toNumber(sale.quantity);
    row.byMonth[monthKey] += quantity;
    row.total += quantity;
  });

  return {
    fromMonth,
    toMonth,
    months,
    rows: Array.from(rowsByProduct.values())
  };
}

module.exports = {
  DEFAULT_FUEL_ORDER,
  buildMonthlySalesSummary
};
