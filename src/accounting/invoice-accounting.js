const {
  getEntryName,
  normalizeDate,
  normalizeMonth,
  roundMoney,
  toNumber
} = require('./common');
const { getShiftFuelSoldQuantity } = require('./fuel-accounting');
const { normalizeShiftRecord } = require('./shift-accounting');

function calculateFuelInvoiceTotals(rows = []) {
  const items = Array.isArray(rows) ? rows : rows.items || rows.fuel_items || [];
  const rowsTotal = items.reduce((sum, row) => sum + toNumber(row.total), 0);
  const invoiceTotal = toNumber((Array.isArray(rows) ? items[0] : rows)?.invoice_total);
  const effectiveTotal = invoiceTotal > 0 ? invoiceTotal : rowsTotal;
  const cashInsurance = invoiceTotal > 0 ? invoiceTotal - rowsTotal : 0;
  const quantity = items.reduce((sum, row) => {
    const netQuantity = toNumber(row.net_quantity);
    return sum + (netQuantity > 0 ? netQuantity : toNumber(row.quantity));
  }, 0);

  return {
    rows_total: roundMoney(rowsTotal),
    invoice_total: roundMoney(effectiveTotal),
    cash_insurance: roundMoney(cashInsurance),
    quantity
  };
}

function calculateOilInvoiceTotals(rows = []) {
  const items = Array.isArray(rows) ? rows : rows.items || rows.oil_items || [];
  const subtotal = items.reduce((sum, row) => sum + toNumber(row.total_purchase), 0);
  const immediateDiscount = items.reduce((max, row) => Math.max(max, toNumber(row.immediate_discount)), 0);
  const martyrsTax = items.reduce((max, row) => Math.max(max, toNumber(row.martyrs_tax)), 0);

  return {
    subtotal: roundMoney(subtotal),
    immediate_discount: roundMoney(immediateDiscount),
    martyrs_tax: roundMoney(martyrsTax),
    invoice_total: roundMoney(subtotal - immediateDiscount + martyrsTax)
  };
}

function normalizeFuelProfitKey(fuelType) {
  switch (String(fuelType || '').trim()) {
    case 'سولار':
      return 'fuel_diesel';
    case 'بنزين ٨٠':
      return 'fuel_80';
    case 'بنزين ٩٢':
      return 'fuel_92';
    case 'بنزين ٩٥':
      return 'fuel_95';
    default:
      return null;
  }
}

function groupFuelPurchasesByMonth(fuelInvoices = []) {
  const purchases = {
    fuel_diesel: new Map(),
    fuel_80: new Map(),
    fuel_92: new Map(),
    fuel_95: new Map()
  };
  const invoiceGroups = new Map();

  fuelInvoices.forEach((row) => {
    const monthKey = normalizeMonth(normalizeDate(row.date));
    if (!monthKey) return;
    const key = normalizeFuelProfitKey(row.fuel_type);
    if (key) {
      purchases[key].set(monthKey, (purchases[key].get(monthKey) || 0) + toNumber(row.total));
    }

    const invoiceNumber = String(row.invoice_number || '').trim() || '__unknown__';
    const groupKey = `${monthKey}__${invoiceNumber}`;
    if (!invoiceGroups.has(groupKey)) {
      invoiceGroups.set(groupKey, { monthKey, rows: [] });
    }
    invoiceGroups.get(groupKey).rows.push(row);
  });

  const insuranceByMonth = new Map();
  invoiceGroups.forEach((group) => {
    const totals = calculateFuelInvoiceTotals(group.rows);
    insuranceByMonth.set(group.monthKey, (insuranceByMonth.get(group.monthKey) || 0) + totals.cash_insurance);
  });

  return { purchases, insuranceByMonth };
}

function groupOilPurchasesByMonth(oilInvoices = []) {
  const invoiceGroups = new Map();

  oilInvoices.forEach((row) => {
    const monthKey = normalizeMonth(normalizeDate(row.date));
    if (!monthKey) return;
    const invoiceNumber = String(row.invoice_number || '').trim() || '__unknown__';
    const groupKey = `${monthKey}__${invoiceNumber}`;
    if (!invoiceGroups.has(groupKey)) {
      invoiceGroups.set(groupKey, { monthKey, rows: [] });
    }
    invoiceGroups.get(groupKey).rows.push(row);
  });

  const purchasesByMonth = new Map();
  invoiceGroups.forEach((group) => {
    const totals = calculateOilInvoiceTotals(group.rows);
    purchasesByMonth.set(group.monthKey, (purchasesByMonth.get(group.monthKey) || 0) + totals.invoice_total);
  });

  return purchasesByMonth;
}

function calculateFuelStock({ fuelInvoices = [], shifts = [] } = {}) {
  const stock = new Map();
  const ensure = (name) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    if (!stock.has(cleanName)) stock.set(cleanName, { fuel_type: cleanName, incoming: 0, outgoing: 0, balance: 0 });
    return stock.get(cleanName);
  };

  fuelInvoices.forEach((row) => {
    const target = ensure(row.fuel_type);
    if (!target) return;
    const netQuantity = toNumber(row.net_quantity);
    target.incoming += netQuantity > 0 ? netQuantity : toNumber(row.quantity);
  });

  shifts.map(normalizeShiftRecord).forEach((shift) => {
    Object.entries(shift.fuel_data || {}).forEach(([entryKey, data]) => {
      const fuelName = getEntryName(entryKey, data);
      const target = ensure(fuelName);
      if (!target) return;
      target.outgoing += getShiftFuelSoldQuantity(fuelName, data);
    });
  });

  return Array.from(stock.values()).map((row) => ({
    ...row,
    balance: row.incoming - row.outgoing
  }));
}

function calculateOilStock({ oilInvoices = [], oilMovements = [], shifts = [] } = {}) {
  const stock = new Map();
  const ensure = (name) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    if (!stock.has(cleanName)) stock.set(cleanName, { oil_type: cleanName, incoming: 0, outgoing: 0, balance: 0 });
    return stock.get(cleanName);
  };

  oilInvoices.forEach((row) => {
    const target = ensure(row.oil_type || row.product_name);
    if (target) target.incoming += toNumber(row.quantity);
  });

  oilMovements.forEach((row) => {
    const target = ensure(row.oil_type || row.product_name);
    if (!target) return;
    const quantity = toNumber(row.quantity);
    if (row.type === 'out') target.outgoing += quantity;
    else target.incoming += quantity;
  });

  shifts.map(normalizeShiftRecord).forEach((shift) => {
    Object.entries(shift.oil_data || {}).forEach(([entryKey, data]) => {
      const target = ensure(getEntryName(entryKey, data));
      if (target) target.outgoing += toNumber(data.sold);
    });
  });

  return Array.from(stock.values()).map((row) => ({
    ...row,
    balance: row.incoming - row.outgoing
  }));
}

module.exports = {
  calculateFuelInvoiceTotals,
  calculateFuelStock,
  calculateOilInvoiceTotals,
  calculateOilStock,
  groupFuelPurchasesByMonth,
  groupOilPurchasesByMonth,
  normalizeFuelProfitKey
};
