const { getEntryName, normalizeDate, normalizeMonth, roundQuantity, toNumber } = require('./common');
const { getShiftFuelSoldQuantity } = require('./fuel-accounting');
const { getOilSoldQuantity } = require('./oil-accounting');
const { buildMonthlySalesSummary } = require('./monthly-sales-summary');

function normalizeProductName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFuelTypeForSalesSummary(value) {
  const text = normalizeProductName(value);
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

function normalizeProductRows(fuelProducts = [], oilProducts = []) {
  return [
    ...(Array.isArray(fuelProducts) ? fuelProducts : []).map((product) => ({
      product_type: 'fuel',
      product_name: normalizeFuelTypeForSalesSummary(product.fuel_type || product.product_name || product.name)
    })),
    ...(Array.isArray(oilProducts) ? oilProducts : []).map((product) => ({
      product_type: 'oil',
      product_name: normalizeProductName(product.oil_type || product.product_name || product.name)
    }))
  ].filter((product) => product.product_name);
}

function buildShiftSalesRows(shifts = []) {
  const rows = [];
  (Array.isArray(shifts) ? shifts : []).forEach((shift) => {
    const date = normalizeDate(shift?.date);
    if (!date) return;

    Object.entries(shift?.fuel_data || {}).forEach(([entryKey, data]) => {
      if (!data || typeof data !== 'object') return;
      const quantity = getShiftFuelSoldQuantity(entryKey, data);
      if (quantity <= 0) return;
      rows.push({
        date,
        fuel_type: normalizeFuelTypeForSalesSummary(getEntryName(entryKey, data)),
        quantity: roundQuantity(quantity),
        total_amount: 0,
        source: 'shift-fuel'
      });
    });

    Object.entries(shift?.oil_data || {}).forEach(([entryKey, data]) => {
      if (!data || typeof data !== 'object') return;
      const quantity = getOilSoldQuantity(data);
      if (quantity <= 0) return;
      rows.push({
        date,
        fuel_type: normalizeProductName(getEntryName(entryKey, data)),
        quantity: roundQuantity(quantity),
        total_amount: 0,
        source: 'shift-oil'
      });
    });
  });
  return rows;
}

function buildSalesSummaryView({ fromMonth, toMonth, fuelProducts = [], oilProducts = [], shifts = [], manualSales = [] } = {}) {
  const productRows = normalizeProductRows(fuelProducts, oilProducts);
  const configuredFuelNames = new Set(productRows
    .filter((product) => product.product_type === 'fuel')
    .map((product) => product.product_name));
  const configuredOilNames = new Set(productRows
    .filter((product) => product.product_type === 'oil')
    .map((product) => product.product_name));

  const shiftSales = buildShiftSalesRows(shifts);
  const hasShiftSales = shiftSales.length > 0;
  const normalizedManualSales = (Array.isArray(manualSales) ? manualSales : [])
    .map((sale) => ({
      date: normalizeDate(sale?.date),
      fuel_type: normalizeFuelTypeForSalesSummary(sale?.fuel_type || sale?.product_name || sale?.product),
      quantity: toNumber(sale?.quantity),
      total_amount: toNumber(sale?.total_amount),
      source: 'manual'
    }))
    .filter((sale) => (
      sale.date
      && sale.fuel_type
      && sale.quantity > 0
      && (!hasShiftSales || (!configuredFuelNames.has(sale.fuel_type) && !configuredOilNames.has(sale.fuel_type)))
    ));

  const detailSales = [...shiftSales, ...normalizedManualSales];
  const summary = buildMonthlySalesSummary({
    fromMonth,
    toMonth,
    products: productRows,
    shifts,
    manualSales: normalizedManualSales,
    includeConfiguredManualSales: !hasShiftSales
  });

  return {
    fromMonth,
    toMonth,
    months: summary.months,
    rows: summary.rows.map((row) => ({
      product: row.name,
      type: row.type,
      byMonth: row.byMonth,
      total: roundQuantity(row.total)
    })),
    detail_sales: detailSales.filter((sale) => {
      const monthKey = normalizeMonth(sale.date);
      return summary.months.includes(monthKey);
    })
  };
}

module.exports = {
  buildSalesSummaryView,
  buildShiftSalesRows,
  normalizeFuelTypeForSalesSummary
};
