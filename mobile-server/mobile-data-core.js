const { Pool } = require('pg');
const { formatSurface, formatMoney, calculatePaymentSummary } = require('../src/land-domain');

let pool = null;

const FUEL_ORDER = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'غاز سيارات'];
const DEFAULT_EXPENSE_ROW_ORDER = [
  'اكرامية مواد',
  'مجارى',
  'مياة للمحطة',
  'كهرباء للمحطة',
  'سولار للديزل',
  'رسوم البوسطة',
  'تامينات'
];

function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
}

function getPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      query_timeout: 20000,
      statement_timeout: 20000
    });
  }

  return pool;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

function parseStoredObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function parseStoredArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function toNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function normalizeMonth(value) {
  const month = String(value || '').trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : '';
}

function getDefaultMonthRange() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    startDate: `${month}-01`,
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    month
  };
}

function buildMonthRange(fromMonth, toMonth) {
  const start = normalizeMonth(fromMonth);
  const end = normalizeMonth(toMonth);
  if (!start || !end || start > end) return [];

  const [startYear, startMonth] = start.split('-').map((value) => parseInt(value, 10));
  const [endYear, endMonth] = end.split('-').map((value) => parseInt(value, 10));
  const months = [];
  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }

  return months;
}

function monthToRange(monthKey) {
  const normalized = normalizeMonth(monthKey);
  if (!normalized) return null;
  const [year, month] = normalized.split('-').map((value) => parseInt(value, 10));
  return {
    startDate: `${normalized}-01`,
    endDate: new Date(year, month, 0).toISOString().slice(0, 10)
  };
}

function normalizeDateRange(query = {}) {
  const defaults = getDefaultMonthRange();
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.startDate || ''))
    ? String(query.startDate)
    : defaults.startDate;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.endDate || ''))
    ? String(query.endDate)
    : defaults.endDate;
  return startDate <= endDate
    ? { startDate, endDate }
    : { startDate: defaults.startDate, endDate: defaults.endDate };
}

function normalizeMonthRange(queryParams = {}) {
  const defaults = getDefaultMonthRange();
  let toMonth = normalizeMonth(queryParams.toMonth) || defaults.month;
  let fromMonth = normalizeMonth(queryParams.fromMonth) || `${toMonth.slice(0, 4)}-01`;
  if (fromMonth > toMonth) {
    fromMonth = `${toMonth.slice(0, 4)}-01`;
  }
  return { fromMonth, toMonth };
}

function getShiftFuelSoldQuantity(fuelType, data) {
  if (!data || typeof data !== 'object') return 0;
  let totalQuantity = toNumber(data.totalQuantity);
  if (totalQuantity <= 0) {
    const counterCount = getShiftProductDisplayName(fuelType, data) === 'سولار' ? 4 : 2;
    for (let i = 1; i <= counterCount; i += 1) {
      totalQuantity += toNumber(data[`quantity${i}`]);
    }
  }
  return Math.max(totalQuantity - toNumber(data.cars), 0);
}

function getShiftProductDisplayName(entryKey, data = {}) {
  return String(data?.product_name || data?.oil_type || data?.fuel_type || entryKey || '').trim();
}

function findShiftDataEntryByName(shiftData, productName) {
  const targetName = String(productName || '').trim();
  if (!shiftData || typeof shiftData !== 'object' || !targetName) return null;
  if (shiftData[targetName]) return shiftData[targetName];
  const found = Object.entries(shiftData).find(([entryKey, data]) => (
    getShiftProductDisplayName(entryKey, data) === targetName
  ));
  return found ? found[1] : null;
}

function getShiftFuelProfitValue(shift, fuelType) {
  const fuelEntry = findShiftDataEntryByName(shift?.fuel_data, fuelType);
  if (!fuelEntry || typeof fuelEntry !== 'object') return 0;
  return (toNumber(fuelEntry.totalQuantity) - toNumber(fuelEntry.cars)) * toNumber(fuelEntry.price);
}

function getShiftOilProfitValue(shift) {
  return Object.values(shift?.oil_data || {}).reduce((sum, oilEntry) => {
    if (!oilEntry || typeof oilEntry !== 'object') return sum;
    return sum + ((toNumber(oilEntry.sold) - toNumber(oilEntry.open)) * toNumber(oilEntry.price));
  }, 0);
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

function normalizeExpenseItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const amount = toNumber(item?.amount);
      if (amount <= 0) return null;
      return {
        index: Number.isFinite(parseInt(item?.index, 10)) ? parseInt(item.index, 10) : index + 1,
        description: String(item?.description || '').trim(),
        amount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function normalizeRevenueItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const amount = toNumber(item?.amount);
      if (amount <= 0) return null;
      return {
        index: Number.isFinite(parseInt(item?.index, 10)) ? parseInt(item.index, 10) : index + 1,
        description: String(item?.description || '').trim(),
        amount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function normalizeShift(row = {}) {
  const legacyData = parseStoredObject(row.data, {});
  const fuelData = parseStoredObject(row.fuel_data || legacyData.fuel_data, {});
  const oilData = parseStoredObject(row.oil_data || legacyData.oil_data, {});
  return {
    id: row.id,
    date: normalizeDate(row.date),
    shift_number: parseInt(row.shift_number, 10) === 2 ? 2 : 1,
    fuel_data: fuelData,
    oil_data: oilData,
    customer_rows: Array.isArray(legacyData.customer_rows) ? legacyData.customer_rows : [],
    revenue_items: normalizeRevenueItems(legacyData.revenue_items),
    expense_items: normalizeExpenseItems(legacyData.expense_items),
    fuel_total: toNumber(row.fuel_total ?? legacyData.fuel_total),
    oil_total: toNumber(row.oil_total ?? legacyData.oil_total),
    wash_lube_revenue: toNumber(row.wash_lube_revenue ?? legacyData.wash_lube_revenue),
    total_expenses: toNumber(row.total_expenses ?? legacyData.total_expenses),
    grand_total: toNumber(row.grand_total ?? legacyData.grand_total),
    updated_at: row.updated_at || row.created_at || null
  };
}

function getOilSoldQuantity(data) {
  return Math.max(toNumber(data?.sold), 0);
}

function getOilRevenue(data) {
  const direct = toNumber(data?.revenue ?? data?.total);
  if (direct > 0) return direct;
  const quantity = getOilSoldQuantity(data) - toNumber(data?.open);
  return Math.max(quantity, 0) * toNumber(data?.price);
}

function buildShiftExpenseEntries(shift) {
  if (shift.expense_items.length > 0) {
    return shift.expense_items.map((item) => ({
      date: shift.date,
      shift_number: shift.shift_number,
      description: item.description || `مصروف ${item.index}`,
      amount: item.amount,
      is_aggregated: false,
      line_index: item.index
    }));
  }

  if (shift.total_expenses > 0) {
    return [{
      date: shift.date,
      shift_number: shift.shift_number,
      description: 'مصروفات الوردية',
      amount: shift.total_expenses,
      is_aggregated: true,
      line_index: null
    }];
  }

  return [];
}

function sortArabicRowsByOrder(rows, order, labelKey = 'name') {
  const normalizedOrder = order.map((value) => String(value || '').trim().toLowerCase());
  return [...rows].sort((a, b) => {
    const aLabel = String(a[labelKey] || '').trim();
    const bLabel = String(b[labelKey] || '').trim();
    const aIndex = normalizedOrder.indexOf(aLabel.toLowerCase());
    const bIndex = normalizedOrder.indexOf(bLabel.toLowerCase());
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return aLabel.localeCompare(bLabel, 'ar');
  });
}

async function query(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

async function getLastDataTimestamp() {
  const rows = await query(`
    SELECT MAX(ts) AS last_sync FROM (
      SELECT MAX(updated_at) AS ts FROM shifts
      UNION ALL SELECT MAX(created_at) AS ts FROM sales
      UNION ALL SELECT MAX(created_at) AS ts FROM fuel_invoices
      UNION ALL SELECT MAX(created_at) AS ts FROM oil_invoices
      UNION ALL SELECT MAX(created_at) AS ts FROM oil_movements
      UNION ALL SELECT MAX(created_at) AS ts FROM safe_book_movements
    ) all_ts
  `).catch(() => []);
  return rows[0]?.last_sync || null;
}

async function getShifts(limit = 40) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 40, 200));
  const rows = await query(
    `SELECT id, date, shift_number, data, fuel_data, fuel_total, oil_data, oil_total,
            wash_lube_revenue, total_expenses, grand_total, created_at, updated_at
     FROM shifts
     WHERE (is_saved = 1 OR is_saved IS NULL)
     ORDER BY date DESC, shift_number DESC, id DESC
     LIMIT $1`,
    [safeLimit]
  );
  return rows.map(normalizeShift);
}

async function getShiftDetail(queryParams) {
  const date = normalizeDate(queryParams.date);
  const shiftNumber = parseInt(queryParams.shiftNumber || queryParams.shift_number, 10);
  if (!date || !Number.isFinite(shiftNumber)) {
    return null;
  }

  const rows = await query(
    `SELECT * FROM shifts WHERE (is_saved = 1 OR is_saved IS NULL) AND date = $1 AND shift_number = $2 LIMIT 1`,
    [date, shiftNumber]
  );
  return rows[0] ? normalizeShift(rows[0]) : null;
}

async function getFuelStock() {
  const totals = new Map();
  const ensure = (name) => {
    const key = String(name || '').trim();
    if (!key) return null;
    if (!totals.has(key)) totals.set(key, { name: key, incoming: 0, outgoing: 0, balance: 0 });
    return totals.get(key);
  };
  FUEL_ORDER.forEach(ensure);

  const products = await query("SELECT product_name FROM products WHERE product_type = 'fuel'").catch(() => []);
  products.forEach((row) => ensure(row.product_name));

  const invoices = await query('SELECT fuel_type, quantity, net_quantity FROM fuel_invoices').catch(() => []);
  invoices.forEach((row) => {
    const target = ensure(row.fuel_type);
    if (!target) return;
    target.incoming += Math.max(toNumber(row.net_quantity) || toNumber(row.quantity), 0);
  });

  const shifts = await query('SELECT fuel_data, data FROM shifts WHERE (is_saved = 1 OR is_saved IS NULL)').catch(() => []);
  shifts.forEach((row) => {
    const legacyData = parseStoredObject(row.data, {});
    const fuelData = parseStoredObject(row.fuel_data || legacyData.fuel_data, {});
    Object.entries(fuelData).forEach(([fuelType, data]) => {
      const fuelName = getShiftProductDisplayName(fuelType, data);
      const target = ensure(fuelName);
      if (!target) return;
      target.outgoing += getShiftFuelSoldQuantity(fuelName, data);
    });
  });

  return Array.from(totals.values())
    .map((row) => ({ ...row, balance: row.incoming - row.outgoing }))
    .sort((a, b) => {
      const aIndex = FUEL_ORDER.indexOf(a.name);
      const bIndex = FUEL_ORDER.indexOf(b.name);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
      return a.name.localeCompare(b.name, 'ar');
    });
}

async function getOilStock() {
  const rows = await query(`
    SELECT oil_type AS name,
           SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END) AS incoming,
           SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END) AS outgoing,
           SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS balance
    FROM oil_movements
    GROUP BY oil_type
    ORDER BY oil_type ASC
  `).catch(() => []);
  return rows.map((row) => ({
    name: row.name,
    incoming: toNumber(row.incoming),
    outgoing: toNumber(row.outgoing),
    balance: toNumber(row.balance)
  }));
}

async function getSafeBook(limit = 80) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 80, 300));
  const [manualRows, shiftRows] = await Promise.all([
    query('SELECT id, date, movement_type, amount, direction, created_at FROM safe_book_movements ORDER BY date DESC, created_at DESC, id DESC LIMIT $1', [safeLimit]).catch(() => []),
    query('SELECT id, date, shift_number, grand_total, created_at, updated_at FROM shifts WHERE (is_saved = 1 OR is_saved IS NULL) ORDER BY date DESC, shift_number DESC, id DESC LIMIT $1', [safeLimit]).catch(() => [])
  ]);

  const movements = [
    ...manualRows.map((row) => ({
      id: `manual-${row.id}`,
      date: normalizeDate(row.date),
      label: row.movement_type || 'حركة خزنة',
      amount: toNumber(row.amount),
      direction: row.direction === 'out' ? 'out' : 'in',
      source: 'manual'
    })),
    ...shiftRows.map((row) => ({
      id: `shift-${row.id}`,
      date: normalizeDate(row.date),
      label: `وردية ${parseInt(row.shift_number, 10) === 2 ? 'ليل' : 'صباح'}`,
      amount: Math.abs(toNumber(row.grand_total)),
      direction: toNumber(row.grand_total) >= 0 ? 'in' : 'out',
      source: 'shift',
      shift_number: parseInt(row.shift_number, 10) === 2 ? 2 : 1
    }))
  ].sort((a, b) => (
    b.date.localeCompare(a.date) || (b.shift_number || 0) - (a.shift_number || 0)
  )).slice(0, safeLimit);

  const balanceRows = await query(`
    SELECT
      COALESCE((SELECT SUM(grand_total) FROM shifts WHERE (is_saved = 1 OR is_saved IS NULL)), 0) +
      COALESCE((SELECT SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) FROM safe_book_movements), 0)
      AS balance
  `).catch(() => [{ balance: 0 }]);

  return { balance: toNumber(balanceRows[0]?.balance), movements };
}

async function getReport(queryParams) {
  const { startDate, endDate } = normalizeDateRange(queryParams);
  const shifts = await query(
    `SELECT date, shift_number, data, fuel_data, fuel_total, oil_data, oil_total,
            wash_lube_revenue, total_expenses, grand_total, updated_at
     FROM shifts
     WHERE (is_saved = 1 OR is_saved IS NULL) AND date BETWEEN $1 AND $2
     ORDER BY date DESC, shift_number DESC`,
    [startDate, endDate]
  );

  const fuelTotals = new Map();
  const oilTotals = new Map();
  let fuelRevenue = 0;
  let oilRevenue = 0;
  let washRevenue = 0;
  let expenses = 0;
  let net = 0;

  shifts.map(normalizeShift).forEach((shift) => {
    fuelRevenue += shift.fuel_total;
    oilRevenue += shift.oil_total;
    washRevenue += shift.wash_lube_revenue;
    expenses += shift.total_expenses;
    net += shift.grand_total;

    Object.entries(shift.fuel_data).forEach(([fuelType, data]) => {
      const fuelName = getShiftProductDisplayName(fuelType, data);
      fuelTotals.set(fuelName, (fuelTotals.get(fuelName) || 0) + getShiftFuelSoldQuantity(fuelName, data));
    });
    Object.entries(shift.oil_data).forEach(([oilName, data]) => {
      const displayName = getShiftProductDisplayName(oilName, data);
      oilTotals.set(displayName, (oilTotals.get(displayName) || 0) + toNumber(data?.sold));
    });
  });

  return {
    startDate,
    endDate,
    shift_count: shifts.length,
    totals: { fuelRevenue, oilRevenue, washRevenue, expenses, net },
    fuelTotals: Array.from(fuelTotals, ([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => (FUEL_ORDER.indexOf(a.name) === -1 ? 99 : FUEL_ORDER.indexOf(a.name)) - (FUEL_ORDER.indexOf(b.name) === -1 ? 99 : FUEL_ORDER.indexOf(b.name))),
    oilTotals: Array.from(oilTotals, ([name, quantity]) => ({ name, quantity }))
      .filter((row) => row.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity)
  };
}

async function getProfit(queryParams) {
  const defaults = getDefaultMonthRange();
  let toMonth = normalizeMonth(queryParams.toMonth) || defaults.month;
  let fromMonth = normalizeMonth(queryParams.fromMonth) || `${toMonth.slice(0, 4)}-01`;
  if (fromMonth > toMonth) {
    fromMonth = `${toMonth.slice(0, 4)}-01`;
  }

  const months = buildMonthRange(fromMonth, toMonth);
  const fromRange = monthToRange(fromMonth);
  const toRange = monthToRange(toMonth);
  if (!months.length || !fromRange || !toRange) return [];

  const [manualRows, shiftRows, invoiceRows, oilInvoiceRows] = await Promise.all([
    query('SELECT * FROM monthly_profit_inputs WHERE month_key BETWEEN $1 AND $2 ORDER BY month_key ASC', [fromMonth, toMonth]).catch(() => []),
    query(
      `SELECT date, fuel_data, oil_data, data, wash_lube_revenue, total_expenses
       FROM shifts
       WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)`,
      [fromRange.startDate, toRange.endDate]
    ).catch(() => []),
    query(
      'SELECT date, invoice_number, fuel_type, total, invoice_total FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
      [fromRange.startDate, toRange.endDate]
    ).catch(() => []),
    query(
      'SELECT date, invoice_number, total_purchase, immediate_discount, martyrs_tax FROM oil_invoices WHERE date BETWEEN $1 AND $2',
      [fromRange.startDate, toRange.endDate]
    ).catch(() => [])
  ]);

  const manualByMonth = new Map();
  manualRows.forEach((row) => {
    const monthKey = normalizeMonth(row.month_key);
    if (!monthKey) return;
    manualByMonth.set(monthKey, {
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

  const dieselByMonth = new Map();
  const fuel80ByMonth = new Map();
  const fuel92ByMonth = new Map();
  const fuel95ByMonth = new Map();
  const oilByMonth = new Map();
  const washByMonth = new Map();
  const expensesByMonth = new Map();

  shiftRows.map(normalizeShift).forEach((shift) => {
    const monthKey = normalizeMonth(shift.date);
    if (!monthKey) return;
    dieselByMonth.set(monthKey, (dieselByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(shift, 'سولار'));
    fuel80ByMonth.set(monthKey, (fuel80ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(shift, 'بنزين ٨٠'));
    fuel92ByMonth.set(monthKey, (fuel92ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(shift, 'بنزين ٩٢'));
    fuel95ByMonth.set(monthKey, (fuel95ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(shift, 'بنزين ٩٥'));
    oilByMonth.set(monthKey, (oilByMonth.get(monthKey) || 0) + getShiftOilProfitValue(shift));
    washByMonth.set(monthKey, (washByMonth.get(monthKey) || 0) + shift.wash_lube_revenue);
    expensesByMonth.set(monthKey, (expensesByMonth.get(monthKey) || 0) + shift.total_expenses);
  });

  const fuelPurchasesByMonth = {
    fuel_diesel: new Map(),
    fuel_80: new Map(),
    fuel_92: new Map(),
    fuel_95: new Map()
  };
  const groupedFuelInvoices = new Map();
  invoiceRows.forEach((row) => {
    const monthKey = normalizeMonth(normalizeDate(row.date));
    if (!monthKey) return;

    const fuelProfitKey = normalizeFuelProfitKey(row.fuel_type);
    if (fuelProfitKey) {
      const purchaseMap = fuelPurchasesByMonth[fuelProfitKey];
      purchaseMap.set(monthKey, (purchaseMap.get(monthKey) || 0) + toNumber(row.total));
    }

    const invoiceNumber = String(row.invoice_number || '').trim() || '__unknown__';
    const groupKey = `${monthKey}__${invoiceNumber}`;
    if (!groupedFuelInvoices.has(groupKey)) {
      groupedFuelInvoices.set(groupKey, { monthKey, sumRowsTotal: 0, maxInvoiceTotal: null });
    }
    const entry = groupedFuelInvoices.get(groupKey);
    entry.sumRowsTotal += toNumber(row.total);
    const invoiceTotal = parseFloat(row.invoice_total);
    if (Number.isFinite(invoiceTotal)) {
      entry.maxInvoiceTotal = entry.maxInvoiceTotal === null
        ? invoiceTotal
        : Math.max(entry.maxInvoiceTotal, invoiceTotal);
    }
  });

  const insuranceByMonth = new Map();
  groupedFuelInvoices.forEach((entry) => {
    const invoiceTotal = entry.maxInvoiceTotal === null ? entry.sumRowsTotal : entry.maxInvoiceTotal;
    insuranceByMonth.set(entry.monthKey, (insuranceByMonth.get(entry.monthKey) || 0) + (invoiceTotal - entry.sumRowsTotal));
  });

  const groupedOilInvoices = new Map();
  oilInvoiceRows.forEach((row) => {
    const monthKey = normalizeMonth(normalizeDate(row.date));
    if (!monthKey) return;
    const invoiceNumber = String(row.invoice_number || '').trim() || '__unknown__';
    const groupKey = `${monthKey}__${invoiceNumber}`;
    if (!groupedOilInvoices.has(groupKey)) {
      groupedOilInvoices.set(groupKey, {
        monthKey,
        subtotal: 0,
        immediateDiscount: null,
        martyrsTax: null
      });
    }
    const entry = groupedOilInvoices.get(groupKey);
    entry.subtotal += toNumber(row.total_purchase);

    const discount = parseFloat(row.immediate_discount);
    if (Number.isFinite(discount)) {
      entry.immediateDiscount = entry.immediateDiscount === null
        ? discount
        : Math.max(entry.immediateDiscount, discount);
    }

    const tax = parseFloat(row.martyrs_tax);
    if (Number.isFinite(tax)) {
      entry.martyrsTax = entry.martyrsTax === null
        ? tax
        : Math.max(entry.martyrsTax, tax);
    }
  });

  const oilPurchasesByMonth = new Map();
  groupedOilInvoices.forEach((entry) => {
    const invoiceTotal = entry.subtotal - toNumber(entry.immediateDiscount) + toNumber(entry.martyrsTax);
    oilPurchasesByMonth.set(entry.monthKey, (oilPurchasesByMonth.get(entry.monthKey) || 0) + invoiceTotal);
  });

  return months.map((monthKey) => {
    const manual = manualByMonth.get(monthKey) || {};
    const fuel_diesel = (dieselByMonth.has(monthKey) ? dieselByMonth.get(monthKey) : toNumber(manual.fuel_diesel))
      - toNumber(fuelPurchasesByMonth.fuel_diesel.get(monthKey));
    const fuel_80 = (fuel80ByMonth.has(monthKey) ? fuel80ByMonth.get(monthKey) : toNumber(manual.fuel_80))
      - toNumber(fuelPurchasesByMonth.fuel_80.get(monthKey));
    const fuel_92 = (fuel92ByMonth.has(monthKey) ? fuel92ByMonth.get(monthKey) : toNumber(manual.fuel_92))
      - toNumber(fuelPurchasesByMonth.fuel_92.get(monthKey));
    const fuel_95 = (fuel95ByMonth.has(monthKey) ? fuel95ByMonth.get(monthKey) : toNumber(manual.fuel_95))
      - toNumber(fuelPurchasesByMonth.fuel_95.get(monthKey));
    const fuel_total_month = fuel_diesel + fuel_80 + fuel_92 + fuel_95;
    const oil_total = (oilByMonth.has(monthKey) ? oilByMonth.get(monthKey) : toNumber(manual.oil_total))
      - toNumber(oilPurchasesByMonth.get(monthKey));
    const wash_lube_month = toNumber(washByMonth.get(monthKey));
    const expenses_month = toNumber(expensesByMonth.get(monthKey));
    const bonuses = toNumber(manual.bonuses);
    const commission_diff = toNumber(manual.commission_diff);
    const deposit_tax = toNumber(manual.deposit_tax);
    const bonus_tax = toNumber(manual.bonus_tax);
    const cash_insurance_month = toNumber(insuranceByMonth.get(monthKey));
    const total_positive = fuel_total_month + oil_total + wash_lube_month + bonuses + commission_diff;
    const total_deductions = cash_insurance_month + expenses_month + deposit_tax + bonus_tax;
    const net_profit = total_positive - total_deductions;

    return {
      month_key: monthKey,
      fuel_diesel,
      fuel_80,
      fuel_92,
      fuel_95,
      fuel_total_month,
      fuel_total: fuel_total_month,
      oil_total,
      wash_lube_month,
      wash_lube_revenue: wash_lube_month,
      expenses_month,
      total_expenses: total_deductions,
      cash_insurance_month,
      bonuses,
      commission_diff,
      deposit_tax,
      bonus_tax,
      total_positive,
      total_deductions,
      net_profit
    };
  }).sort((a, b) => b.month_key.localeCompare(a.month_key));
}

async function getHomeChart(queryParams) {
  const defaults = getDefaultMonthRange();
  const { fromMonth, toMonth } = normalizeMonthRange({
    fromMonth: queryParams.fromMonth || `${defaults.month.slice(0, 4)}-01`,
    toMonth: queryParams.toMonth || defaults.month
  });
  const months = buildMonthRange(fromMonth, toMonth);
  const fromRange = monthToRange(fromMonth);
  const toRange = monthToRange(toMonth);
  if (!months.length || !fromRange || !toRange) {
    return { fromMonth, toMonth, months: [], rows: [] };
  }

  const report = await getReport({ startDate: fromRange.startDate, endDate: toRange.endDate });
  const rowsByFuel = new Map();
  const salesDaysByMonth = new Map(months.map((month) => [month, new Set()]));
  FUEL_ORDER.forEach((fuelType) => {
    rowsByFuel.set(fuelType, {
      name: fuelType,
      quantity: 0,
      byMonth: Object.fromEntries(months.map((month) => [month, 0]))
    });
  });

  const shiftRows = await query(
    `SELECT date, fuel_data, data
     FROM shifts
     WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)
     ORDER BY date ASC, shift_number ASC, id ASC`,
    [fromRange.startDate, toRange.endDate]
  ).catch(() => []);

  shiftRows.forEach((row) => {
    const monthKey = normalizeMonth(normalizeDate(row.date));
    if (!monthKey || !months.includes(monthKey)) return;
    const legacyData = parseStoredObject(row.data, {});
    const fuelData = parseStoredObject(row.fuel_data || legacyData.fuel_data, {});
    Object.entries(fuelData).forEach(([fuelType, data]) => {
      const fuelName = getShiftProductDisplayName(fuelType, data);
      if (!rowsByFuel.has(fuelName)) {
        rowsByFuel.set(fuelName, {
          name: fuelName,
          quantity: 0,
          byMonth: Object.fromEntries(months.map((month) => [month, 0]))
        });
      }
      const quantity = getShiftFuelSoldQuantity(fuelName, data);
      const entry = rowsByFuel.get(fuelName);
      entry.byMonth[monthKey] += quantity;
      entry.quantity += quantity;
      if (quantity > 0) {
        salesDaysByMonth.get(monthKey)?.add(normalizeDate(row.date));
      }
    });
  });

  return {
    fromMonth,
    toMonth,
    months,
    salesDaysByMonth: Object.fromEntries(
      months.map((month) => [month, salesDaysByMonth.get(month)?.size || 0])
    ),
    totals: report.fuelTotals || [],
    rows: sortArabicRowsByOrder(Array.from(rowsByFuel.values()), FUEL_ORDER)
  };
}

async function getSalesSummary(queryParams) {
  const { fromMonth, toMonth } = normalizeMonthRange(queryParams);
  const months = buildMonthRange(fromMonth, toMonth);
  const fromRange = monthToRange(fromMonth);
  const toRange = monthToRange(toMonth);
  if (!months.length || !fromRange || !toRange) {
    return { fromMonth, toMonth, months: [], rows: [] };
  }

  const [fuelProducts, oilProducts, shifts, salesRows] = await Promise.all([
    query("SELECT product_name AS name FROM products WHERE product_type = 'fuel' ORDER BY product_name").catch(() => []),
    query("SELECT product_name AS name FROM products WHERE product_type = 'oil' ORDER BY product_name").catch(() => []),
    query(
      `SELECT date, shift_number, data, fuel_data, fuel_total, oil_data, oil_total,
              wash_lube_revenue, total_expenses, grand_total, created_at, updated_at
       FROM shifts
       WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)
       ORDER BY date ASC, shift_number ASC, id ASC`,
      [fromRange.startDate, toRange.endDate]
    ).catch(() => []),
    query(
      'SELECT date, fuel_type, quantity, total_amount FROM sales WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
      [fromRange.startDate, toRange.endDate]
    ).catch(() => [])
  ]);

  const fuelOrder = fuelProducts
    .map((row) => String(row.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const oilOrder = oilProducts
    .map((row) => String(row.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const fuelNames = new Set(fuelOrder.length ? fuelOrder : FUEL_ORDER);
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

  shifts.map(normalizeShift).forEach((shift) => {
    const monthKey = normalizeMonth(shift.date);
    if (!monthKey || !months.includes(monthKey)) return;

    Object.entries(shift.fuel_data || {}).forEach(([fuelType, data]) => {
      const fuelName = getShiftProductDisplayName(fuelType, data);
      const row = ensure(fuelName, 'fuel');
      if (!row) return;
      const quantity = getShiftFuelSoldQuantity(fuelName, data);
      row.byMonth[monthKey] += quantity;
      row.total += quantity;
    });

    Object.entries(shift.oil_data || {}).forEach(([oilName, data]) => {
      const row = ensure(getShiftProductDisplayName(oilName, data), 'oil');
      if (!row) return;
      const quantity = getOilSoldQuantity(data);
      row.byMonth[monthKey] += quantity;
      row.total += quantity;
    });
  });

  salesRows.forEach((sale) => {
    const product = String(sale.fuel_type || '').trim();
    if (!product || fuelNames.has(product) || oilNames.has(product)) return;
    const monthKey = normalizeMonth(normalizeDate(sale.date));
    if (!monthKey || !months.includes(monthKey)) return;
    const row = ensure(product, 'other');
    if (!row) return;
    const quantity = toNumber(sale.quantity);
    row.byMonth[monthKey] += quantity;
    row.total += quantity;
  });

  const rows = Array.from(rowsByProduct.values())
    .filter((row) => row.total > 0)
    .sort((a, b) => {
      const typeOrder = { fuel: 0, oil: 1, other: 2 };
      const typeDiff = (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2);
      if (typeDiff !== 0) return typeDiff;
      if (a.type === 'fuel') {
        const fuelA = fuelOrder.length ? fuelOrder.indexOf(a.name) : FUEL_ORDER.indexOf(a.name);
        const fuelB = fuelOrder.length ? fuelOrder.indexOf(b.name) : FUEL_ORDER.indexOf(b.name);
        if (fuelA !== -1 || fuelB !== -1) {
          if (fuelA === -1) return 1;
          if (fuelB === -1) return -1;
          return fuelA - fuelB;
        }
      }
      if (a.type === 'oil') {
        const oilA = oilOrder.indexOf(a.name);
        const oilB = oilOrder.indexOf(b.name);
        if (oilA !== -1 || oilB !== -1) {
          if (oilA === -1) return 1;
          if (oilB === -1) return -1;
          return oilA - oilB;
        }
      }
      return a.name.localeCompare(b.name, 'ar');
    });

  return { fromMonth, toMonth, months, rows };
}

async function getExpenses(queryParams) {
  const { fromMonth, toMonth } = normalizeMonthRange(queryParams);
  const months = buildMonthRange(fromMonth, toMonth);
  const fromRange = monthToRange(fromMonth);
  const toRange = monthToRange(toMonth);
  const minAmount = queryParams.minAmount === undefined || queryParams.minAmount === '' ? null : toNumber(queryParams.minAmount);
  const maxAmount = queryParams.maxAmount === undefined || queryParams.maxAmount === '' ? null : toNumber(queryParams.maxAmount);
  const searchTerm = String(queryParams.searchTerm || '').trim().toLowerCase();

  if (!months.length || !fromRange || !toRange) {
    return { fromMonth, toMonth, months: [], rows: [], entries: [] };
  }

  const shiftRows = await query(
    `SELECT date, shift_number, data, fuel_data, fuel_total, oil_data, oil_total,
            wash_lube_revenue, total_expenses, grand_total, created_at, updated_at
     FROM shifts
     WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)
     ORDER BY date DESC, shift_number DESC, id DESC`,
    [fromRange.startDate, toRange.endDate]
  ).catch(() => []);

  const entries = shiftRows
    .map(normalizeShift)
    .flatMap(buildShiftExpenseEntries)
    .filter((entry) => {
      if (minAmount !== null && entry.amount < minAmount) return false;
      if (maxAmount !== null && entry.amount > maxAmount) return false;
      if (!searchTerm) return true;
      return String(entry.description || '').toLowerCase().includes(searchTerm);
    });

  const byDescription = new Map();
  entries.forEach((entry) => {
    const monthKey = normalizeMonth(entry.date);
    if (!monthKey || !months.includes(monthKey)) return;
    const description = entry.description || 'مصروفات';
    if (!byDescription.has(description)) {
      byDescription.set(description, {
        description,
        byMonth: Object.fromEntries(months.map((month) => [month, 0])),
        total: 0
      });
    }
    const row = byDescription.get(description);
    row.byMonth[monthKey] += entry.amount;
    row.total += entry.amount;
  });

  const rows = sortArabicRowsByOrder(Array.from(byDescription.values()), DEFAULT_EXPENSE_ROW_ORDER, 'description')
    .sort((a, b) => {
      const orderA = DEFAULT_EXPENSE_ROW_ORDER.indexOf(a.description);
      const orderB = DEFAULT_EXPENSE_ROW_ORDER.indexOf(b.description);
      if (orderA !== -1 || orderB !== -1) return 0;
      return b.total - a.total || a.description.localeCompare(b.description, 'ar');
    });

  return { fromMonth, toMonth, months, rows, entries };
}

async function getAnnualInventory(queryParams) {
  const selectedYear = parseInt(queryParams.year, 10);
  const rows = await query(`
    SELECT id, year, prev_balance, station_profit, bank_balance, safe_balance,
           accounting_remainder, customers_balance, vouchers_balance, visa_balance,
           expected_total, actual_total, difference, expected_items, actual_items,
           status, finalized, finalized_at, created_at, updated_at
    FROM annual_inventories
    ORDER BY year DESC
  `).catch(() => []);

  const records = rows.map((row) => ({
    id: row.id,
    year: String(row.year),
    fields: {
      prev_balance: toNumber(row.prev_balance),
      station_profit: toNumber(row.station_profit),
      bank_balance: toNumber(row.bank_balance),
      safe_balance: toNumber(row.safe_balance),
      accounting_remainder: toNumber(row.accounting_remainder),
      customers_balance: toNumber(row.customers_balance),
      vouchers_balance: toNumber(row.vouchers_balance),
      visa_balance: toNumber(row.visa_balance)
    },
    expected_total: toNumber(row.expected_total),
    actual_total: toNumber(row.actual_total),
    difference: toNumber(row.difference),
    expected_items: parseStoredArray(row.expected_items, []),
    actual_items: parseStoredArray(row.actual_items, []),
    status: row.status || 'balanced',
    finalized: Number(row.finalized) === 1 || row.finalized === true,
    finalized_at: row.finalized_at,
    updated_at: row.updated_at
  }));

  const currentYear = String(new Date().getFullYear());
  const year = Number.isFinite(selectedYear)
    ? String(selectedYear)
    : (records[0]?.year || currentYear);
  return {
    years: Array.from(new Set([currentYear, ...records.map((record) => record.year)])).sort((a, b) => Number(b) - Number(a)),
    selectedYear: year,
    record: records.find((record) => record.year === year) || null,
    records
  };
}

function buildShiftSummaryRows(shift) {
  const revenues = [];
  FUEL_ORDER.forEach((fuelType) => {
    const data = findShiftDataEntryByName(shift.fuel_data, fuelType);
    if (!data) return;
    const amount = toNumber(data.cash ?? data.total);
    const quantity = getShiftFuelSoldQuantity(fuelType, data);
    if (amount <= 0 && quantity <= 0) return;
    revenues.push({ name: fuelType, quantity, amount, type: 'fuel' });
  });

  Object.entries(shift.oil_data || {}).forEach(([oilName, data]) => {
    const quantity = getOilSoldQuantity(data);
    const amount = getOilRevenue(data);
    if (amount <= 0 && quantity <= 0) return;
    revenues.push({ name: getShiftProductDisplayName(oilName, data), quantity, amount, type: 'oil' });
  });

  if (shift.wash_lube_revenue > 0) {
    revenues.push({ name: 'غسيل و تشحيم', quantity: null, amount: shift.wash_lube_revenue, type: 'fixed' });
  }

  shift.revenue_items.forEach((item) => {
    revenues.push({
      name: item.description || `إيراد ${item.index}`,
      quantity: item.quantity ?? null,
      amount: item.amount,
      type: 'extra'
    });
  });

  return {
    revenues,
    expenses: buildShiftExpenseEntries(shift).map((entry) => ({
      name: entry.description,
      amount: entry.amount
    }))
  };
}

async function getShiftDaySummaries(queryParams) {
  const safeLimit = Math.max(1, Math.min(parseInt(queryParams.limit, 10) || 31, 120));
  const rows = await query(
    `SELECT date, shift_number, data, fuel_data, fuel_total, oil_data, oil_total,
            wash_lube_revenue, total_expenses, grand_total, created_at, updated_at
     FROM shifts
     WHERE (is_saved = 1 OR is_saved IS NULL)
     ORDER BY date DESC, shift_number DESC, id DESC
     LIMIT $1`,
    [safeLimit * 2]
  ).catch(() => []);

  const days = new Map();
  rows.map(normalizeShift).forEach((shift) => {
    if (!days.has(shift.date)) {
      days.set(shift.date, {
        date: shift.date,
        shifts: [],
        totals: { revenue: 0, expenses: 0, net: 0 }
      });
    }
    const day = days.get(shift.date);
    const summary = buildShiftSummaryRows(shift);
    day.shifts.push({
      date: shift.date,
      shift_number: shift.shift_number,
      label: shift.shift_number === 2 ? 'وردية ليل' : 'وردية صباح',
      net_total: shift.grand_total,
      total_revenue: shift.grand_total + shift.total_expenses,
      total_expenses: shift.total_expenses,
      revenues: summary.revenues,
      expenses: summary.expenses
    });
    day.totals.revenue += shift.grand_total + shift.total_expenses;
    day.totals.expenses += shift.total_expenses;
    day.totals.net += shift.grand_total;
  });

  return { days: Array.from(days.values()).slice(0, safeLimit) };
}

async function getPrices() {
  const [fuelRows, oilRows] = await Promise.all([
    query("SELECT product_name AS name, current_price AS price, effective_date, is_active FROM products WHERE product_type = 'fuel' ORDER BY product_name").catch(() => []),
    query("SELECT product_name AS name, current_price AS price, vat, effective_date, is_active FROM products WHERE product_type = 'oil' ORDER BY product_name").catch(() => [])
  ]);
  return {
    fuels: fuelRows.map((row) => ({ ...row, price: toNumber(row.price) })),
    oils: oilRows.map((row) => ({ ...row, price: toNumber(row.price), vat: toNumber(row.vat) }))
  };
}

async function getOverview() {
  const defaults = getDefaultMonthRange();
  const [lastSync, latestShifts, safeBook, fuelStock, oilStock, report] = await Promise.all([
    getLastDataTimestamp(),
    getShifts(5),
    getSafeBook(8),
    getFuelStock(),
    getOilStock(),
    getReport({ startDate: defaults.startDate, endDate: defaults.endDate })
  ]);

  return {
    readOnly: true,
    lastSync,
    latestShifts,
    safeBalance: safeBook.balance,
    recentSafeMovements: safeBook.movements,
    fuelStock,
    oilStock: oilStock.slice(0, 20),
    monthReport: report
  };
}

async function ensureLandSeason(seasonKey) {
  const key = String(seasonKey || new Date().getFullYear()).trim();
  const rows = await query('SELECT * FROM land_seasons WHERE season_key = $1 AND archived_at IS NULL LIMIT 1', [key]).catch(() => []);
  return rows[0] || null;
}

async function getLandSeasons() {
  return query(`
    SELECT season_key, name
    FROM land_seasons
    WHERE archived_at IS NULL
    ORDER BY season_key ASC
  `).catch(() => []);
}

async function getLandAssignments(queryParams = {}) {
  const season = await ensureLandSeason(queryParams.season || queryParams.season_key);
  if (!season) return [];
  const rows = await query(`
    SELECT
      a.*,
      p.name AS plot_name,
      p.plot_code,
      p.location,
      t.full_name AS tenant_name,
      t.phone AS tenant_phone,
      s.season_key,
      COALESCE(SUM(CASE WHEN i.installment_number = 1 THEN i.expected_cents ELSE 0 END), 0) AS first_expected_cents,
      COALESCE(SUM(CASE WHEN i.installment_number = 2 THEN i.expected_cents ELSE 0 END), 0) AS second_expected_cents,
      COALESCE(SUM(CASE WHEN pay.installment_number = 1 AND pay.archived_at IS NULL THEN pay.amount_cents ELSE 0 END), 0) AS first_paid_cents,
      COALESCE(SUM(CASE WHEN pay.installment_number = 2 AND pay.archived_at IS NULL THEN pay.amount_cents ELSE 0 END), 0) AS second_paid_cents
    FROM land_assignments a
    JOIN land_plots p ON p.id = a.plot_id
    JOIN land_tenants t ON t.id = a.tenant_id
    JOIN land_seasons s ON s.id = a.season_id
    LEFT JOIN land_installments i ON i.assignment_id = a.id
    LEFT JOIN land_payments pay ON pay.assignment_id = a.id
    WHERE a.archived_at IS NULL AND a.season_id = $1
    GROUP BY a.id, p.name, p.plot_code, p.location, t.full_name, t.phone, s.season_key
    ORDER BY p.name ASC, t.full_name ASC
  `, [season.id]).catch(() => []);

  return rows.map((row) => {
    const summary = calculatePaymentSummary(
      Number(row.rent_cents) || 0,
      Number(row.first_expected_cents) || 0,
      Number(row.second_expected_cents) || 0,
      Number(row.first_paid_cents) || 0,
      Number(row.second_paid_cents) || 0
    );
    return {
      ...row,
      assigned_sahm_label: formatSurface(Number(row.assigned_sahm) || 0),
      rent_egp: formatMoney(Number(row.rent_cents) || 0),
      paid_egp: formatMoney(summary.totalPaidCents),
      remaining_egp: formatMoney(summary.remainingCents),
      payment_status: summary.status
    };
  });
}

async function getLandPlots(queryParams = {}) {
  const season = await ensureLandSeason(queryParams.season || queryParams.season_key);
  const seasonId = season?.id || null;
  const rentedSeasonCondition = seasonId ? 'a.season_id = $1' : '1 = 1';
  const rentSeasonCondition = seasonId ? 'a.season_id = $2' : '1 = 1';
  const tenantsSeasonCondition = seasonId ? 'a.season_id = $3' : '1 = 1';
  const params = seasonId ? [seasonId, seasonId, seasonId] : [];
  const rows = await query(`
    SELECT
      p.*,
      COALESCE(SUM(CASE WHEN a.archived_at IS NULL AND ${rentedSeasonCondition} THEN a.assigned_sahm ELSE 0 END), 0) AS rented_sahm,
      COALESCE(SUM(CASE WHEN a.archived_at IS NULL AND ${rentSeasonCondition} THEN a.rent_cents ELSE 0 END), 0) AS expected_rent_cents,
      COUNT(DISTINCT CASE WHEN a.archived_at IS NULL AND ${tenantsSeasonCondition} THEN a.tenant_id END) AS tenants_count
    FROM land_plots p
    LEFT JOIN land_assignments a ON a.plot_id = p.id
    WHERE p.archived_at IS NULL
    GROUP BY p.id
    ORDER BY p.name ASC
  `, params).catch(() => []);
  return rows.map((row) => {
    const total = Number(row.total_sahm) || 0;
    const rented = Number(row.rented_sahm) || 0;
    return {
      ...row,
      total_sahm_label: formatSurface(total),
      rented_sahm_label: formatSurface(rented),
      available_sahm_label: formatSurface(Math.max(total - rented, 0)),
      expected_rent_egp: formatMoney(Number(row.expected_rent_cents) || 0)
    };
  });
}

async function getLandDashboard(queryParams = {}) {
  const [plots, assignments] = await Promise.all([
    getLandPlots(queryParams),
    getLandAssignments(queryParams)
  ]);
  const totalSahm = plots.reduce((sum, row) => sum + (Number(row.total_sahm) || 0), 0);
  const rentedSahm = plots.reduce((sum, row) => sum + (Number(row.rented_sahm) || 0), 0);
  const expected = assignments.reduce((sum, row) => sum + (Number(row.rent_cents) || 0), 0);
  const paid = assignments.reduce((sum, row) => {
    const firstPaid = Number(row.first_paid_cents) || 0;
    const secondPaid = Number(row.second_paid_cents) || 0;
    return sum + firstPaid + secondPaid;
  }, 0);
  return {
    readOnly: true,
    plots_count: plots.length,
    total_sahm: totalSahm,
    rented_sahm: rentedSahm,
    available_sahm: Math.max(totalSahm - rentedSahm, 0),
    total_sahm_label: formatSurface(totalSahm),
    rented_sahm_label: formatSurface(rentedSahm),
    available_sahm_label: formatSurface(Math.max(totalSahm - rentedSahm, 0)),
    expected_egp: formatMoney(expected),
    paid_egp: formatMoney(paid),
    remaining_egp: formatMoney(Math.max(expected - paid, 0)),
    plots: plots.slice(0, 12),
    assignments: assignments.slice(0, 20),
    lastSync: await getLastDataTimestamp()
  };
}

async function getLandTenants() {
  return query(`
    SELECT t.*, COUNT(DISTINCT a.id) AS assignments_count, COALESCE(SUM(a.rent_cents), 0) AS total_rent_cents
    FROM land_tenants t
    LEFT JOIN land_assignments a ON a.tenant_id = t.id AND a.archived_at IS NULL
    WHERE t.archived_at IS NULL
    GROUP BY t.id
    ORDER BY t.full_name ASC
  `).then((rows) => rows.map((row) => ({
    ...row,
    total_rent_egp: formatMoney(Number(row.total_rent_cents) || 0)
  }))).catch(() => []);
}

async function getLandReports(queryParams = {}) {
  const rows = await getLandAssignments(queryParams);
  const kind = String(queryParams.kind || 'complete');
  if (kind === 'missing-payments') {
    return rows.filter((row) => row.payment_status !== 'paid_full' && row.payment_status !== 'overpaid');
  }
  if (kind === 'overdue') {
    return rows.filter((row) => row.payment_status === 'overdue');
  }
  return rows;
}

async function getMobileData(queryParams = {}) {
  const view = String(queryParams.view || 'overview').trim();

  switch (view) {
    case 'overview':
      return getOverview();
    case 'home-chart':
      return { chart: await getHomeChart(queryParams), lastSync: await getLastDataTimestamp() };
    case 'sales-summary':
      return { summary: await getSalesSummary(queryParams), lastSync: await getLastDataTimestamp() };
    case 'shifts':
      return { shifts: await getShifts(queryParams.limit) };
    case 'shift-day-summaries':
      return { summaries: await getShiftDaySummaries(queryParams), lastSync: await getLastDataTimestamp() };
    case 'shift-detail':
      return { shift: await getShiftDetail(queryParams) };
    case 'report':
      return { report: await getReport(queryParams) };
    case 'expenses':
      return { expenses: await getExpenses(queryParams), lastSync: await getLastDataTimestamp() };
    case 'annual-inventory':
      return { annual: await getAnnualInventory(queryParams), lastSync: await getLastDataTimestamp() };
    case 'stock':
      return { fuelStock: await getFuelStock(), oilStock: await getOilStock() };
    case 'safe-book':
      return getSafeBook(queryParams.limit);
    case 'profit':
      return { rows: await getProfit(queryParams) };
    case 'prices':
      return await getPrices();
    case 'land-dashboard':
      return await getLandDashboard(queryParams);
    case 'land-seasons':
      return { seasons: await getLandSeasons(), lastSync: await getLastDataTimestamp() };
    case 'land-plots':
      return { plots: await getLandPlots(queryParams), lastSync: await getLastDataTimestamp() };
    case 'land-plot-detail':
      return { plots: await getLandPlots(queryParams), assignments: await getLandAssignments(queryParams) };
    case 'land-tenants':
      return { tenants: await getLandTenants(), lastSync: await getLastDataTimestamp() };
    case 'land-reports':
      return { rows: await getLandReports(queryParams), lastSync: await getLastDataTimestamp() };
    default:
      return getOverview();
  }
}

async function handleMobileDataRequest({ method = 'GET', query = {} } = {}) {
  if (method !== 'GET') {
    return json(405, { error: 'method_not_allowed' });
  }

  try {
    const data = await getMobileData(query);
    return json(200, { ok: true, data });
  } catch (error) {
    console.error('Mobile read-only API error:', error);
    return json(500, { error: 'server_error', message: error.message });
  }
}

module.exports = {
  handleMobileDataRequest,
  getMobileData
};
