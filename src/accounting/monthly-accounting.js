const {
  normalizeMonth,
  parseObject,
  roundMoney,
  toNumber
} = require('./common');

const ACCOUNTING_ROW_KEYS = {
  DEBIT_FUEL_WITHDRAWALS: 'debit_fuel_withdrawals',
  DEBIT_OIL_WITHDRAWALS: 'debit_oil_withdrawals',
  DEBIT_WITHHOLDING_TAX: 'debit_withholding_tax',
  DEBIT_COMMISSION: 'debit_commission',
  CREDIT_FUEL_CASH: 'credit_fuel_cash',
  CREDIT_DELIVERY_DEPOSITS: 'credit_delivery_deposits',
  CREDIT_PREVIOUS_INCREASE: 'credit_previous_increase'
};

const DEBIT_DEFAULT_ROWS = [
  { row_key: ACCOUNTING_ROW_KEYS.DEBIT_FUEL_WITHDRAWALS, label: 'جملة مسحوبات المواد البترولية', locked: true },
  { row_key: ACCOUNTING_ROW_KEYS.DEBIT_OIL_WITHDRAWALS, label: 'جملة مسحوبات الزيوت' },
  { row_key: ACCOUNTING_ROW_KEYS.DEBIT_WITHHOLDING_TAX, label: 'ضرائب المنبع' },
  { row_key: ACCOUNTING_ROW_KEYS.DEBIT_COMMISSION, label: 'عموله ١٫٥٪ عن المسحوبات' }
];

const CREDIT_DEFAULT_ROWS = [
  { row_key: ACCOUNTING_ROW_KEYS.CREDIT_FUEL_CASH, label: 'جملة النقدية والشيكات للمواد البترولية' },
  { row_key: ACCOUNTING_ROW_KEYS.CREDIT_DELIVERY_DEPOSITS, label: 'جملة حوافظ التسليمات' }
];

const DEBIT_DEFAULT_LABELS = DEBIT_DEFAULT_ROWS.map((row) => row.label);
const CREDIT_DEFAULT_LABELS = CREDIT_DEFAULT_ROWS.map((row) => row.label);

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
const SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS = new Set([
  ACCOUNTING_ROW_KEYS.DEBIT_FUEL_WITHDRAWALS,
  ACCOUNTING_ROW_KEYS.CREDIT_PREVIOUS_INCREASE
]);

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

function normalizeAccountingLabelDefaults(defaults = {}) {
  const source = defaults && typeof defaults === 'object' ? defaults : {};
  const map = source instanceof Map
    ? source
    : new Map(Object.entries(source));
  const normalized = {};

  [...DEBIT_DEFAULT_ROWS, ...CREDIT_DEFAULT_ROWS].forEach((definition) => {
    const rowKey = definition.row_key;
    const rawValue = map.get(rowKey) || source[rowKey];
    const rawObject = rawValue && typeof rawValue === 'object' && !(rawValue instanceof String)
      ? rawValue
      : null;
    const label = String(rawObject ? rawObject.label : rawValue || '').trim();
    const isDefault = SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(rowKey)
      ? true
      : rawObject?.is_default !== false && rawObject?.is_default !== 0;
    if ((label || rawObject) && !SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(rowKey)) {
      normalized[rowKey] = {
        label,
        is_default: isDefault
      };
    }
  });

  return normalized;
}

function getDefaultAccountingRowLabel(definition, labelDefaults = {}) {
  if (!definition?.row_key || SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key)) {
    return definition?.label || '';
  }
  return normalizeAccountingLabelDefaults(labelDefaults)[definition.row_key]?.label || definition.label;
}

function isDefaultAccountingRowVisible(definition, labelDefaults = {}) {
  if (!definition?.row_key || SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key)) return true;
  const setting = normalizeAccountingLabelDefaults(labelDefaults)[definition.row_key];
  return setting?.is_default !== false;
}

function getRowKeyFromLegacyLabel(label, side) {
  const normalizedLabel = normalizeAccountingProfitLabel(label);
  const definitions = side === 'credit' ? CREDIT_DEFAULT_ROWS : DEBIT_DEFAULT_ROWS;
  const match = definitions.find((definition) => normalizeAccountingProfitLabel(definition.label) === normalizedLabel);
  if (match) return match.row_key;
  if (side === 'credit' && normalizedLabel.startsWith('زيادة محاسبة شهر')) {
    return ACCOUNTING_ROW_KEYS.CREDIT_PREVIOUS_INCREASE;
  }
  return '';
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
    .find((entry) => (
      entry?.row_key === ACCOUNTING_ROW_KEYS.DEBIT_FUEL_WITHDRAWALS
      || normalizeAccountingProfitLabel(entry?.label) === FUEL_WITHDRAWAL_LABEL
    ));
  return normalizeAccountingAmount(row?.amount);
}

function calculateAccountingCashInsurance(data = {}) {
  if (!Object.prototype.hasOwnProperty.call(data || {}, 'fuel_purchase_rows')) {
    return 0;
  }
  return roundMoney(getFuelWithdrawalAmount(data) - calculateFuelPurchaseTotal(data?.fuel_purchase_rows));
}

function normalizeManualRows(rows = [], side = 'debit') {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      row_key: String(row?.row_key || getRowKeyFromLegacyLabel(row?.label, side) || '').trim(),
      label: String(row?.label || row?.statement || row?.description || '').trim(),
      amount: normalizeAccountingAmount(row?.amount),
      fixed: row?.fixed === true,
      auto: row?.auto === true,
      locked: row?.locked === true,
      can_save_default: row?.can_save_default === true,
      save_as_default: row?.save_as_default === true
    }))
    .filter((row) => row.label || Math.abs(row.amount) > 0.0001);
}

function normalizeDebitRows(rows = [], options = {}) {
  const labelDefaults = normalizeAccountingLabelDefaults(options.labelDefaults);
  const includeInactiveDefaults = options.includeInactiveDefaults === true;
  const manualRows = normalizeManualRows(rows, 'debit');
  const consumed = new Set();
  const fixedRows = DEBIT_DEFAULT_ROWS.flatMap((definition) => {
    const label = getDefaultAccountingRowLabel(definition, labelDefaults);
    const defaultVisible = isDefaultAccountingRowVisible(definition, labelDefaults);
    const index = manualRows.findIndex((row, rowIndex) => (
      !consumed.has(rowIndex)
      && (
        row.row_key === definition.row_key
        || (!row.row_key && normalizeAccountingProfitLabel(row.label) === normalizeAccountingProfitLabel(definition.label))
      )
    ));
    if (index >= 0) {
      consumed.add(index);
      const row = manualRows[index];
      return {
        row_key: definition.row_key,
        label: SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key) ? definition.label : (row.label || label),
        default_label: label,
        amount: row.amount,
        fixed: true,
        locked: SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key),
        can_save_default: !SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key),
        is_visible_default: defaultVisible,
        is_default_label: normalizeAccountingProfitLabel(row.label || label) === normalizeAccountingProfitLabel(label),
        save_as_default: row.save_as_default === true
      };
    }
    if (!defaultVisible && !includeInactiveDefaults) return [];
    return {
      row_key: definition.row_key,
      label,
      default_label: label,
      amount: 0,
      fixed: true,
      locked: SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key),
      can_save_default: !SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key),
      is_visible_default: defaultVisible,
      is_default_label: true,
      save_as_default: false
    };
  });

  const extraRows = manualRows
    .filter((_row, index) => !consumed.has(index))
    .map((row) => ({
      row_key: row.row_key && !DEBIT_DEFAULT_ROWS.some((definition) => definition.row_key === row.row_key) ? row.row_key : '',
      label: row.label,
      default_label: '',
      amount: row.amount,
      fixed: false,
      auto: false,
      locked: false,
      can_save_default: false,
      is_visible_default: false,
      is_default_label: false,
      save_as_default: false
    }));

  return [...fixedRows, ...extraRows];
}

function normalizeCreditRows(rows = [], monthKey, previousIncrease = 0, options = {}) {
  const previousLabel = getPreviousIncreaseLabel(monthKey);
  const labelDefaults = normalizeAccountingLabelDefaults(options.labelDefaults);
  const includeInactiveDefaults = options.includeInactiveDefaults === true;
  const fixedRowsDefinitions = [
    ...CREDIT_DEFAULT_ROWS,
    { row_key: ACCOUNTING_ROW_KEYS.CREDIT_PREVIOUS_INCREASE, label: previousLabel, locked: true, auto: true }
  ];
  const manualRows = normalizeManualRows(rows, 'credit');
  const consumed = new Set();
  const forcePreviousIncrease = options.forcePreviousIncrease === true;

  const fixedRows = fixedRowsDefinitions.flatMap((definition) => {
    const isPreviousIncrease = definition.row_key === ACCOUNTING_ROW_KEYS.CREDIT_PREVIOUS_INCREASE;
    const label = isPreviousIncrease ? previousLabel : getDefaultAccountingRowLabel(definition, labelDefaults);
    const defaultVisible = isDefaultAccountingRowVisible(definition, labelDefaults);
    const index = manualRows.findIndex((row, rowIndex) => (
      !consumed.has(rowIndex)
      && (
        row.row_key === definition.row_key
        || (!row.row_key && normalizeAccountingProfitLabel(row.label) === normalizeAccountingProfitLabel(definition.label))
        || (isPreviousIncrease && normalizeAccountingProfitLabel(row.label).startsWith('زيادة محاسبة شهر'))
      )
    ));
    if (index >= 0) consumed.add(index);
    const row = index >= 0 ? manualRows[index] : null;
    if (!row && !defaultVisible && !includeInactiveDefaults) return [];
    return {
      row_key: definition.row_key,
      label: isPreviousIncrease || SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key) ? label : (row?.label || label),
      default_label: label,
      amount: isPreviousIncrease
        ? (row && !forcePreviousIncrease ? row.amount : normalizeAccountingAmount(previousIncrease))
        : (row ? row.amount : 0),
      fixed: true,
      auto: isPreviousIncrease,
      locked: SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key),
      can_save_default: !SYSTEM_LOCKED_ACCOUNTING_ROW_KEYS.has(definition.row_key),
      is_visible_default: defaultVisible,
      is_default_label: normalizeAccountingProfitLabel(row?.label || label) === normalizeAccountingProfitLabel(label),
      save_as_default: row?.save_as_default === true
    };
  });

  const extraRows = manualRows
    .filter((_row, index) => !consumed.has(index))
    .map((row) => ({
      row_key: row.row_key && !fixedRowsDefinitions.some((definition) => definition.row_key === row.row_key) ? row.row_key : '',
      label: row.label,
      default_label: '',
      amount: row.amount,
      fixed: false,
      auto: false,
      locked: false,
      can_save_default: false,
      is_visible_default: false,
      is_default_label: false,
      save_as_default: false
    }));

  return [...fixedRows, ...extraRows];
}

function createDefaultAccountingData(monthKey, previousIncrease = 0, labelDefaults = {}) {
  const normalizedMonth = normalizeMonth(monthKey);

  return {
    month_key: normalizedMonth,
    debit_rows: normalizeDebitRows([], { labelDefaults }),
    credit_rows: normalizeCreditRows([], normalizedMonth, previousIncrease, { forcePreviousIncrease: true, labelDefaults }),
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
    debit_rows: normalizeDebitRows(data?.debit_rows, {
      labelDefaults: options.labelDefaults,
      includeInactiveDefaults: options.includeInactiveDefaults === true
    }),
    credit_rows: normalizeCreditRows(data?.credit_rows, monthKey, options.previousIncrease, {
      forcePreviousIncrease: options.forcePreviousIncrease === true,
      labelDefaults: options.labelDefaults,
      includeInactiveDefaults: options.includeInactiveDefaults === true
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

function splitDraftAndFinal(record = {}, previousIncrease = 0, labelDefaults = {}, options = {}) {
  const monthKey = normalizeMonth(record?.month_key);
  if (!monthKey) {
    throw new Error('صيغة الشهر غير صحيحة');
  }

  const buildOptions = {
    month_key: monthKey,
    previousIncrease,
    labelDefaults,
    includeInactiveDefaults: options.includeInactiveDefaults === true
  };
  const isFinal = record?.is_final === true || record?.is_final === 1;
  const draftData = record?.draft_data && Object.keys(record.draft_data).length
    ? buildAccountingDocumentData(record.draft_data, buildOptions)
    : null;
  const finalData = record?.final_data && Object.keys(record.final_data).length
    ? buildAccountingDocumentData(record.final_data, buildOptions)
    : null;
  const emptyData = { month_key: monthKey, debit_rows: [], credit_rows: [], fuel_purchase_rows: [] };

  return {
    month_key: monthKey,
    is_final: isFinal,
    draft_data: draftData,
    final_data: finalData,
    active_data: isFinal
      ? (finalData || buildAccountingDocumentData(emptyData, buildOptions))
      : (draftData || buildAccountingDocumentData(emptyData, buildOptions))
  };
}

function buildAccountingStorageUpdate({ mode, data, previousIncrease = 0, labelDefaults = {} } = {}) {
  const saveMode = mode === 'draft' ? 'draft' : 'final';
  const normalized = buildAccountingDocumentData(data, {
    month_key: data?.month_key,
    previousIncrease,
    labelDefaults
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
  return row?.row_key === ACCOUNTING_ROW_KEYS.CREDIT_PREVIOUS_INCREASE
    || row?.auto === true
    || label.startsWith('زيادة محاسبة شهر');
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
      const rowKey = String(row?.row_key || '').trim();
      if (!label) return;
      if (
        rowKey === ACCOUNTING_ROW_KEYS.DEBIT_FUEL_WITHDRAWALS
        || rowKey === ACCOUNTING_ROW_KEYS.DEBIT_OIL_WITHDRAWALS
        || rowKey === ACCOUNTING_ROW_KEYS.CREDIT_FUEL_CASH
        || rowKey === ACCOUNTING_ROW_KEYS.CREDIT_DELIVERY_DEPOSITS
        || excludedLabels.has(label)
      ) return;
      if (rowType === 'revenue' && isPreviousAccountingIncreaseRow(row)) return;

      rows.push({
        row_key: createAccountingProfitRowKey(rowType, rowKey || label),
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
  ACCOUNTING_ROW_KEYS,
  ACCOUNTING_PROFIT_CREDIT_EXCLUDED_LABELS,
  ACCOUNTING_PROFIT_DEBIT_EXCLUDED_LABELS,
  CASH_INSURANCE_LABEL,
  CREDIT_DEFAULT_ROWS,
  CREDIT_DEFAULT_LABELS,
  DEBIT_DEFAULT_ROWS,
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
  getDefaultAccountingRowLabel,
  getPreviousIncreaseLabel,
  getPreviousMonthKey,
  isPreviousAccountingIncreaseRow,
  normalizeAccountingData,
  normalizeAccountingLabelDefaults,
  normalizeFuelPurchaseRows,
  selectDefaultAccountingMonth,
  shiftMonth,
  splitDraftAndFinal,
  toArabicDigits
};
