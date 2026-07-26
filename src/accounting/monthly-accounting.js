const {
  normalizeMonth,
  parseObject,
  roundMoney,
  toNumber
} = require('./common');

const DEBIT_DEFAULT_LABELS = [
  'جملة مسحوبات المواد البترولية',
  'جملة مسحوبات الزيوت',
  'ضرائب المنبع',
  'عموله ١٫٥٪ عن المسحوبات'
];

const CREDIT_DEFAULT_LABELS = [
  'جملة النقدية والشيكات للمواد البترولية',
  'جملة حوافظ التسليمات'
];

const ACCOUNTING_PROFIT_DEBIT_EXCLUDED_LABELS = new Set([
  'جملة مسحوبات المواد البترولية',
  'جملة مسحوبات الزيوت'
]);

const ACCOUNTING_PROFIT_CREDIT_EXCLUDED_LABELS = new Set([
  'جملة النقدية والشيكات للمواد البترولية',
  'جملة حوافظ التسليمات'
]);

const FUEL_WITHDRAWAL_LABEL = 'جملة مسحوبات المواد البترولية';
const CASH_INSURANCE_LABEL = 'تأمين نقدى';

const ARABIC_DIGITS = {
  0: '٠',
  1: '١',
  2: '٢',
  3: '٣',
  4: '٤',
  5: '٥',
  6: '٦',
  7: '٧',
  8: '٨',
  9: '٩'
};

function toArabicDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (digit) => ARABIC_DIGITS[digit]);
}

function shiftMonth(monthKey, offset) {
  const normalized = normalizeMonth(monthKey);
  const monthOffset = parseInt(offset, 10);
  if (!normalized || !Number.isFinite(monthOffset)) return '';

  const [year, month] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1 + monthOffset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousMonthKey(monthKey) {
  return shiftMonth(monthKey, -1);
}

function getPreviousIncreaseLabel(monthKey) {
  const previousMonthKey = getPreviousMonthKey(monthKey);
  if (!previousMonthKey) return 'زيادة محاسبة شهر';
  const [yearText, monthText] = previousMonthKey.split('-');
  return `زيادة محاسبة شهر ${toArabicDigits(yearText)} / ${toArabicDigits(parseInt(monthText, 10))}`;
}

function normalizeAccountingAmount(value) {
  return roundMoney(toNumber(value));
}

function normalizeAccountingDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function calculateFuelPurchaseRowTotal(row = {}) {
  const fuelType = String(row?.fuel_type || row?.product_name || '').trim();
  const quantity = toNumber(row.quantity);
  const netQuantity = fuelType.includes('بنزين') ? quantity * 0.995 : quantity;
  return roundMoney(netQuantity * toNumber(row.purchase_price));
}

function normalizeFuelPurchaseRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const quantity = toNumber(row?.quantity);
      const purchasePrice = toNumber(row?.purchase_price);
      return {
        date: normalizeAccountingDate(row?.date),
        product_code: String(row?.product_code || '').trim() || null,
        fuel_type: String(row?.fuel_type || row?.product_name || '').trim(),
        quantity,
        purchase_price: normalizeAccountingAmount(purchasePrice),
        total: calculateFuelPurchaseRowTotal({ ...row, quantity, purchase_price: purchasePrice })
      };
    })
    .filter((row) => (
      row.date
      || row.product_code
      || row.fuel_type
      || Math.abs(row.quantity) > 0.0001
      || Math.abs(row.purchase_price) > 0.0001
      || Math.abs(row.total) > 0.0001
    ));
}

function calculateFuelPurchaseTotal(rows = []) {
  return roundMoney((Array.isArray(rows) ? rows : [])
    .reduce((sum, row) => sum + calculateFuelPurchaseRowTotal(row), 0));
}

function getFuelWithdrawalAmount(data = {}) {
  const row = (Array.isArray(data?.debit_rows) ? data.debit_rows : [])
    .find((entry) => normalizeAccountingProfitLabel(entry?.label) === FUEL_WITHDRAWAL_LABEL);
  return normalizeAccountingAmount(row?.amount);
}

function calculateAccountingCashInsurance(data = {}) {
  if (!Object.prototype.hasOwnProperty.call(data || {}, 'fuel_purchase_rows')) {
    return 0;
  }
  return roundMoney(getFuelWithdrawalAmount(data) - calculateFuelPurchaseTotal(data?.fuel_purchase_rows));
}

function normalizeManualRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      label: String(row?.label || row?.statement || row?.description || '').trim(),
      amount: normalizeAccountingAmount(row?.amount)
    }))
    .filter((row) => row.label || Math.abs(row.amount) > 0.0001);
}

function normalizeDebitRows(rows = []) {
  const manualRows = normalizeManualRows(rows);
  const consumed = new Set();
  const fixedRows = DEBIT_DEFAULT_LABELS.map((label) => {
    const index = manualRows.findIndex((row, rowIndex) => !consumed.has(rowIndex) && row.label === label);
    if (index >= 0) {
      consumed.add(index);
      return { label, amount: manualRows[index].amount, fixed: true };
    }
    return { label, amount: 0, fixed: true };
  });

  const extraRows = manualRows
    .filter((_row, index) => !consumed.has(index))
    .map((row) => ({ ...row, fixed: false }));

  return [...fixedRows, ...extraRows];
}

function normalizeCreditRows(rows = [], monthKey, previousIncrease = 0, options = {}) {
  const previousLabel = getPreviousIncreaseLabel(monthKey);
  const fixedLabels = [...CREDIT_DEFAULT_LABELS, previousLabel];
  const manualRows = normalizeManualRows(rows);
  const consumed = new Set();
  const forcePreviousIncrease = options.forcePreviousIncrease === true;

  const fixedRows = fixedLabels.map((label, fixedIndex) => {
    const isPreviousIncrease = fixedIndex === fixedLabels.length - 1;
    const index = manualRows.findIndex((row, rowIndex) => !consumed.has(rowIndex) && row.label === label);
    if (index >= 0) consumed.add(index);
    return {
      label,
      amount: isPreviousIncrease
        ? (index >= 0 && !forcePreviousIncrease ? manualRows[index].amount : normalizeAccountingAmount(previousIncrease))
        : (index >= 0 ? manualRows[index].amount : 0),
      fixed: true,
      auto: isPreviousIncrease
    };
  });

  const extraRows = manualRows
    .filter((_row, index) => !consumed.has(index))
    .map((row) => ({ ...row, fixed: false }));

  return [...fixedRows, ...extraRows];
}

function createDefaultAccountingData(monthKey, previousIncrease = 0) {
  const normalizedMonth = normalizeMonth(monthKey);
  return {
    month_key: normalizedMonth,
    debit_rows: normalizeDebitRows([]),
    credit_rows: normalizeCreditRows([], normalizedMonth, previousIncrease, { forcePreviousIncrease: true }),
    fuel_purchase_rows: []
  };
}

function normalizeAccountingData(data = {}, options = {}) {
  const monthKey = normalizeMonth(options.month_key || data?.month_key);
  if (!monthKey) {
    throw new Error('صيغة الشهر غير صحيحة');
  }

  const normalized = {
    month_key: monthKey,
    debit_rows: normalizeDebitRows(data?.debit_rows),
    credit_rows: normalizeCreditRows(data?.credit_rows, monthKey, options.previousIncrease, {
      forcePreviousIncrease: options.forcePreviousIncrease === true
    }),
    fuel_purchase_rows: normalizeFuelPurchaseRows(data?.fuel_purchase_rows)
  };
  normalized.fuel_purchase_total = calculateFuelPurchaseTotal(normalized.fuel_purchase_rows);
  normalized.cash_insurance = calculateAccountingCashInsurance(normalized);
  return normalized;
}

function calculateAccountingTotals(data = {}) {
  const debitTotal = (Array.isArray(data?.debit_rows) ? data.debit_rows : [])
    .reduce((sum, row) => sum + toNumber(row?.amount), 0);
  const creditTotal = (Array.isArray(data?.credit_rows) ? data.credit_rows : [])
    .reduce((sum, row) => sum + toNumber(row?.amount), 0);

  return {
    debit_total: roundMoney(debitTotal),
    credit_total: roundMoney(creditTotal),
    accounting_increase: roundMoney(creditTotal - debitTotal)
  };
}

function buildAccountingDocumentData(data = {}, options = {}) {
  const normalized = normalizeAccountingData(data, options);
  return {
    ...normalized,
    totals: calculateAccountingTotals(normalized)
  };
}

function selectDefaultAccountingMonth(finalizedMonths = [], currentMonth = '') {
  const months = Array.from(new Set(
    (Array.isArray(finalizedMonths) ? finalizedMonths : [])
      .map((monthKey) => normalizeMonth(monthKey))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  if (months.length === 0) {
    return normalizeMonth(currentMonth) || normalizeMonth(new Date().toISOString().slice(0, 7));
  }

  let cursor = months[0];
  const latest = months[months.length - 1];
  const finalizedSet = new Set(months);
  while (cursor <= latest) {
    if (!finalizedSet.has(cursor)) return cursor;
    cursor = shiftMonth(cursor, 1);
  }

  return shiftMonth(latest, 1);
}

function splitDraftAndFinal(record = {}, previousIncrease = 0) {
  const monthKey = normalizeMonth(record?.month_key);
  if (!monthKey) {
    throw new Error('صيغة الشهر غير صحيحة');
  }

  const isFinal = record?.is_final === true || record?.is_final === 1;
  const draftData = record?.draft_data && Object.keys(record.draft_data).length
    ? buildAccountingDocumentData(record.draft_data, { month_key: monthKey, previousIncrease })
    : null;
  const finalData = record?.final_data && Object.keys(record.final_data).length
    ? buildAccountingDocumentData(record.final_data, { month_key: monthKey, previousIncrease })
    : null;

  return {
    month_key: monthKey,
    is_final: isFinal,
    draft_data: draftData,
    final_data: finalData,
    active_data: isFinal
      ? (finalData || buildAccountingDocumentData(createDefaultAccountingData(monthKey, previousIncrease), { month_key: monthKey, previousIncrease }))
      : (draftData || buildAccountingDocumentData(createDefaultAccountingData(monthKey, previousIncrease), { month_key: monthKey, previousIncrease }))
  };
}

function buildAccountingStorageUpdate({ mode, data, previousIncrease = 0 } = {}) {
  const saveMode = mode === 'draft' ? 'draft' : 'final';
  const normalized = buildAccountingDocumentData(data, {
    month_key: data?.month_key,
    previousIncrease
  });

  return saveMode === 'draft'
    ? { draft_data: normalized, final_data: undefined, is_final: false }
    : { draft_data: undefined, final_data: normalized, is_final: true };
}

function normalizeAccountingProfitLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isPreviousAccountingIncreaseRow(row = {}) {
  const label = normalizeAccountingProfitLabel(row.label);
  return row?.auto === true || label.startsWith('زيادة محاسبة شهر');
}

function createAccountingProfitRowKey(rowType, label) {
  const source = `${rowType}:${normalizeAccountingProfitLabel(label)}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return `accounting_${rowType}_${Math.abs(hash).toString(36)}`;
}

function extractAccountingProfitRows(data = {}) {
  const rows = [];
  const monthKey = normalizeMonth(data?.month_key);
  if (!monthKey) return rows;

  const addRows = (sourceRows, rowType, excludedLabels) => {
    (Array.isArray(sourceRows) ? sourceRows : []).forEach((row) => {
      const label = normalizeAccountingProfitLabel(row?.label);
      if (!label || excludedLabels.has(label)) return;
      if (rowType === 'revenue' && isPreviousAccountingIncreaseRow(row)) return;

      rows.push({
        row_key: createAccountingProfitRowKey(rowType, label),
        row_label: label,
        row_type: rowType,
        month_key: monthKey,
        amount: normalizeAccountingAmount(row?.amount),
        source: 'monthly_accounting'
      });
    });
  };

  addRows(data.debit_rows, 'deduction', ACCOUNTING_PROFIT_DEBIT_EXCLUDED_LABELS);
  addRows(data.credit_rows, 'revenue', ACCOUNTING_PROFIT_CREDIT_EXCLUDED_LABELS);
  const cashInsurance = calculateAccountingCashInsurance(data);
  if (Math.abs(cashInsurance) > 0.0001) {
    rows.push({
      row_key: createAccountingProfitRowKey('deduction', CASH_INSURANCE_LABEL),
      row_label: CASH_INSURANCE_LABEL,
      row_type: 'deduction',
      month_key: monthKey,
      amount: cashInsurance,
      source: 'monthly_accounting'
    });
  }
  return rows;
}

function extractAccountingFuelPurchaseRows(data = {}) {
  const monthKey = normalizeMonth(data?.month_key);
  if (!monthKey) return [];
  return normalizeFuelPurchaseRows(data?.fuel_purchase_rows).map((row) => ({
    ...row,
    month_key: monthKey
  }));
}

function buildAccountingFuelPurchaseMaps(documents = [], resolveFuelKey) {
  const purchases = {
    fuel_diesel: new Map(),
    fuel_80: new Map(),
    fuel_92: new Map(),
    fuel_95: new Map()
  };
  const insuranceByMonth = new Map();

  (Array.isArray(documents) ? documents : []).forEach((document) => {
    if (!(document?.is_final === true || document?.is_final === 1)) return;
    const finalData = parseObject(document.final_data, {});
    const monthKey = normalizeMonth(finalData?.month_key || document?.month_key);
    if (!monthKey) return;

    extractAccountingFuelPurchaseRows({ ...finalData, month_key: monthKey }).forEach((row) => {
      const fuelKey = typeof resolveFuelKey === 'function' ? resolveFuelKey(row.fuel_type) : null;
      if (!fuelKey || !purchases[fuelKey]) return;
      const purchaseMap = purchases[fuelKey];
      purchaseMap.set(monthKey, (purchaseMap.get(monthKey) || 0) + toNumber(row.total));
    });

    const cashInsurance = calculateAccountingCashInsurance({ ...finalData, month_key: monthKey });
    insuranceByMonth.set(monthKey, (insuranceByMonth.get(monthKey) || 0) + cashInsurance);
  });

  return { purchases, insuranceByMonth };
}

function buildAccountingProfitRows(documents = []) {
  const definitionsByKey = new Map();
  const values = [];

  (Array.isArray(documents) ? documents : []).forEach((document) => {
    if (!(document?.is_final === true || document?.is_final === 1)) return;
    const finalData = parseObject(document.final_data, {});
    extractAccountingProfitRows(finalData).forEach((entry) => {
      if (!definitionsByKey.has(entry.row_key)) {
        definitionsByKey.set(entry.row_key, {
          row_key: entry.row_key,
          row_label: entry.row_label,
          row_type: entry.row_type,
          display_order: definitionsByKey.size + 1,
          source: 'monthly_accounting'
        });
      }
      values.push({
        row_key: entry.row_key,
        month_key: entry.month_key,
        amount: entry.amount,
        source: 'monthly_accounting'
      });
    });
  });

  return {
    rows: Array.from(definitionsByKey.values()),
    values
  };
}

module.exports = {
  ACCOUNTING_PROFIT_CREDIT_EXCLUDED_LABELS,
  ACCOUNTING_PROFIT_DEBIT_EXCLUDED_LABELS,
  CASH_INSURANCE_LABEL,
  CREDIT_DEFAULT_LABELS,
  DEBIT_DEFAULT_LABELS,
  FUEL_WITHDRAWAL_LABEL,
  buildAccountingFuelPurchaseMaps,
  buildAccountingProfitRows,
  buildAccountingDocumentData,
  buildAccountingStorageUpdate,
  calculateAccountingCashInsurance,
  calculateAccountingTotals,
  calculateFuelPurchaseRowTotal,
  calculateFuelPurchaseTotal,
  createDefaultAccountingData,
  extractAccountingFuelPurchaseRows,
  extractAccountingProfitRows,
  getFuelWithdrawalAmount,
  getPreviousIncreaseLabel,
  getPreviousMonthKey,
  isPreviousAccountingIncreaseRow,
  normalizeAccountingData,
  normalizeFuelPurchaseRows,
  selectDefaultAccountingMonth,
  shiftMonth,
  splitDraftAndFinal,
  toArabicDigits
};
