const { normalizeMonth, roundMoney, roundQuantity, toNumber } = require('./common');

const HOME_ACCOUNTING_CARD_KEYS = [
  'sales-summary',
  'sales-reconciliation',
  'safe-book',
  'profit',
  'expenses',
  'company-vouchers',
  'customer-invoices'
];

const EMPTY_META = 'لا توجد بيانات';
const VOUCHER_CUSTOMER_NAME = 'بونات الشركة';

function toArabicDigits(value) {
  return String(value ?? '').replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)] || digit);
}

function formatMonthMeta(value) {
  const month = normalizeMonth(value);
  if (!month) return '';
  const [year, monthNumber] = month.split('-');
  return toArabicDigits(`${monthNumber}/${year}`);
}

function formatDateMeta(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [year, month, day] = date.split('-');
  return toArabicDigits(`${day}/${month}/${year}`);
}

function formatPeriodMeta(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}$/.test(text)) return formatMonthMeta(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDateMeta(text);
  const rangeMatch = text.match(/^(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    return `${formatDateMeta(rangeMatch[1])} - ${formatDateMeta(rangeMatch[2])}`;
  }
  return toArabicDigits(text);
}

function buildEmptyStat(overrides = {}) {
  return {
    value: null,
    value_type: overrides.value_type || 'number',
    unit: overrides.unit || '',
    meta: EMPTY_META,
    empty: true,
    rows: [],
    ...overrides
  };
}

function hasAmount(value) {
  return Math.abs(toNumber(value)) > 0.004;
}

function normalizeStatRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      label: String(row?.label || '').trim(),
      value: toNumber(row?.value),
      value_text: String(row?.value_text || '').trim(),
      value_type: row?.value_type || 'number',
      unit: row?.unit || '',
      status: ['ok', 'mismatch', 'missing', 'warning'].includes(row?.status) ? row.status : '',
      trend: ['up', 'down', 'flat'].includes(row?.trend) ? row.trend : '',
      projected: row?.projected === true
    }))
    .filter((row) => row.label);
}

function buildSalesSummaryStat(summary = {}, monthKey = '') {
  const view = summary?.view && typeof summary.view === 'object' ? summary.view : summary;
  const month = normalizeMonth(summary?.stat_month) || normalizeMonth(monthKey) || normalizeMonth(view?.toMonth) || '';
  const periodLabel = String(summary?.period_label || '').trim();
  const comparisonView = summary?.comparison_view && typeof summary.comparison_view === 'object'
    ? summary.comparison_view
    : null;
  const comparisonMonth = normalizeMonth(summary?.comparison_month);
  const projectionFactor = Math.max(1, toNumber(summary?.projection_factor) || 1);
  const comparisonByProduct = new Map((Array.isArray(comparisonView?.rows) ? comparisonView.rows : [])
    .filter((row) => row?.type === 'fuel')
    .map((row) => [String(row?.product || '').trim(), toNumber(row?.byMonth?.[comparisonMonth] ?? row?.total)]));
  const getTrend = (value, previousValue) => {
    const projectedValue = value * projectionFactor;
    const difference = projectedValue - previousValue;
    if (Math.abs(difference) <= 0.004) return 'flat';
    return difference > 0 ? 'up' : 'down';
  };
  const rows = (Array.isArray(view?.rows) ? view.rows : [])
    .filter((row) => row?.type === 'fuel')
    .map((row) => ({
      label: String(row?.product || '').trim(),
      value: toNumber(row?.byMonth?.[month] ?? row?.total),
      value_type: 'quantity',
      unit: 'لتر',
      trend: getTrend(
        toNumber(row?.byMonth?.[month] ?? row?.total),
        comparisonByProduct.get(String(row?.product || '').trim()) || 0
      ),
      projected: projectionFactor > 1.0001
    }))
    .filter((row) => row.label && (row.value > 0 || comparisonByProduct.get(row.label) > 0))
    .sort((a, b) => b.value - a.value);
  const washValue = roundMoney(summary?.wash_lube_amount);
  const washComparisonValue = roundMoney(summary?.wash_lube_comparison_amount);
  if (hasAmount(washValue) || hasAmount(washComparisonValue)) {
    rows.push({
      label: 'غسيل و تشحيم',
      value: washValue,
      value_type: 'currency',
      unit: '',
      trend: getTrend(washValue, washComparisonValue),
      projected: projectionFactor > 1.0001
    });
  }
  const hasRows = rows.some((row) => hasAmount(row.value));

  if (!hasRows) {
    return buildEmptyStat({ value: 0, value_type: 'quantity', unit: 'لتر' });
  }

  return {
    value: null,
    value_type: 'number',
    unit: '',
    meta: formatPeriodMeta(periodLabel || month),
    empty: false,
    layout: 'rows-only',
    hide_value: true,
    rows: normalizeStatRows(rows)
  };
}

function formatReconciliationDifference(value) {
  if (value === null || value === undefined || value === '') return '';
  const amount = roundQuantity(value);
  if (!Number.isFinite(amount) || Math.abs(amount) <= 0.004) return '';
  const sign = amount > 0 ? '+' : '-';
  return `${sign}${toArabicDigits(Math.abs(amount))} لتر`;
}

function getReconciliationRowLabel(row = {}) {
  const product = String(row?.product || row?.name || row?.label || '').trim();
  if (!product) return 'بند غير محدد';
  return row?.type === 'oil' ? `${product} (زيوت)` : product;
}

function buildReconciliationIssueRows(view = {}) {
  const detailRows = [
    ...(Array.isArray(view?.fuel_rows) ? view.fuel_rows : []),
    ...(Array.isArray(view?.oil_rows) ? view.oil_rows : [])
  ];
  return detailRows
    .filter((row) => row?.status === 'mismatch' || row?.status === 'missing')
    .map((row) => {
      const difference = formatReconciliationDifference(row?.difference);
      const statusLabel = row.status === 'missing' ? 'بيانات ناقصة' : 'فرق';
      return {
        label: getReconciliationRowLabel(row),
        value_text: difference ? `${statusLabel} ${difference}` : statusLabel,
        status: row.status
      };
    });
}

function buildSalesReconciliationStat(view = {}) {
  const totals = view?.totals || {};
  const total = toNumber(totals.total);
  if (total <= 0) {
    return buildEmptyStat({ value: 0, value_type: 'count', unit: 'مطابق' });
  }

  const hasIssues = toNumber(totals.mismatch) > 0 || toNumber(totals.missing) > 0;
  if (!hasIssues) {
    return {
      value: null,
      value_text: 'كل شيء مطابق',
      value_type: 'text',
      unit: '',
      meta: formatMonthMeta(view?.month),
      empty: false,
      layout: 'message',
      rows: []
    };
  }

  const issueRows = buildReconciliationIssueRows(view);
  const fallbackRows = [
    toNumber(totals.mismatch) > 0 ? { label: 'بنود بها فرق', value: totals.mismatch, value_type: 'count', status: 'mismatch' } : null,
    toNumber(totals.missing) > 0 ? { label: 'بنود ناقصة البيانات', value: totals.missing, value_type: 'count', status: 'missing' } : null
  ].filter(Boolean);

  return {
    value: null,
    value_text: 'توجد فروقات',
    value_type: 'text',
    unit: '',
    meta: formatMonthMeta(view?.month),
    empty: false,
    layout: 'message',
    rows: normalizeStatRows(issueRows.length ? issueRows : fallbackRows)
  };
}

function buildSafeBookStat(view = {}, movements = []) {
  const normalizedMovements = Array.isArray(movements)
    ? movements
    : Array.isArray(movements?.items)
      ? movements.items
      : [];
  const periodLabel = !Array.isArray(movements) && movements?.period_label
    ? String(movements.period_label).trim()
    : 'الشهر الحالي';
  const incoming = normalizedMovements.reduce((sum, movement) => (
    movement?.direction === 'out' ? sum : sum + Math.abs(toNumber(movement?.amount))
  ), 0);
  const outgoing = normalizedMovements.reduce((sum, movement) => (
    movement?.direction === 'out' ? sum + Math.abs(toNumber(movement?.amount)) : sum
  ), 0);
  const currentBalance = roundMoney(view?.current_balance);

  if (!hasAmount(currentBalance) && !hasAmount(incoming) && !hasAmount(outgoing)) {
    return buildEmptyStat({ value: 0, value_type: 'currency' });
  }

  return {
    value: currentBalance,
    value_type: 'currency',
    unit: '',
    meta: formatPeriodMeta(periodLabel || 'الشهر الحالي'),
    empty: false,
    rows: normalizeStatRows([
      { label: 'داخل', value: roundMoney(incoming), value_type: 'currency' },
      { label: 'خارج', value: roundMoney(outgoing), value_type: 'currency' }
    ])
  };
}

function isMeaningfulProfitRow(row = {}) {
  return [
    'total_positive',
    'total_deductions',
    'net_profit',
    'expenses_month',
    'fuel_total_month',
    'oil_total',
    'wash_lube_month'
  ].some((key) => hasAmount(row?.[key]));
}

function buildProfitStat(rows = []) {
  const sortedRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => normalizeMonth(row?.month_key))
    .sort((a, b) => String(b.month_key).localeCompare(String(a.month_key)));
  const latest = sortedRows.find(isMeaningfulProfitRow);
  if (!latest) {
    return buildEmptyStat({ value: 0, value_type: 'currency' });
  }

  const latestIndex = sortedRows.indexOf(latest);
  const previous = sortedRows.slice(latestIndex + 1).find(isMeaningfulProfitRow) || null;
  const netProfit = roundMoney(latest.net_profit);
  const previousProfit = previous ? roundMoney(previous.net_profit) : null;
  const delta = previous ? roundMoney(netProfit - previousProfit) : null;

  return {
    value: netProfit,
    value_type: 'currency',
    unit: '',
    meta: formatMonthMeta(latest.month_key),
    empty: false,
    delta,
    rows: normalizeStatRows([
      { label: 'الإيرادات', value: roundMoney(latest.total_positive), value_type: 'currency' },
      { label: 'الخصومات', value: roundMoney(latest.total_deductions), value_type: 'currency' }
    ])
  };
}

function buildExpensesStat({ currentTotal = 0, previousTotal = 0, period_label: periodLabel = '', comparison_month: comparisonMonth = '' } = {}) {
  const current = roundMoney(currentTotal);
  const previous = roundMoney(previousTotal);
  const delta = roundMoney(current - previous);

  if (!hasAmount(current) && !hasAmount(previous)) {
    return buildEmptyStat({ value: 0, value_type: 'currency' });
  }

  return {
    value: current,
    value_type: 'currency',
    unit: '',
    meta: formatPeriodMeta(String(periodLabel || '').trim() || 'الشهر الحالي'),
    empty: false,
    delta,
    rows: normalizeStatRows([
      { label: formatPeriodMeta(comparisonMonth) || 'الفترة السابقة', value: previous, value_type: 'currency' },
      { label: 'التغير', value: delta, value_type: 'currency' }
    ])
  };
}

function getNextMonth(monthKey = '') {
  const month = normalizeMonth(monthKey);
  if (!month) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(year, monthNumber, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function buildCompanyVouchersStat(months = [], monthKey = '', periodLabel = '') {
  const normalizedMonths = (Array.isArray(months) ? months : [])
    .map((item) => ({ ...item, month: normalizeMonth(item?.month) }))
    .filter((item) => item.month)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const requestedMonth = normalizeMonth(monthKey);
  const selected = requestedMonth
    ? normalizedMonths.find((item) => item.month === requestedMonth)
    : normalizedMonths.find((item) => hasAmount(item?.company_total));
  const month = selected?.month || '';
  const nextMonth = getNextMonth(month);
  const next = normalizedMonths.find((item) => item.month === nextMonth) || null;
  const companyTotal = roundMoney(selected?.company_total);
  const directTotal = roundMoney(selected?.direct_total);
  const nextDirectTotal = roundMoney(next?.direct_total);

  if (!selected || !hasAmount(companyTotal)) {
    return buildEmptyStat({ value: 0, value_type: 'currency' });
  }

  return {
    value: companyTotal,
    value_type: 'currency',
    unit: '',
    meta: `ما ردته الشركة - ${formatPeriodMeta(String(periodLabel || '').trim() || month)}`,
    empty: false,
    rows: normalizeStatRows([
      { label: `بونات جديدة وفروق ${formatMonthMeta(month) || month}`, value: directTotal, value_type: 'currency' },
      { label: `بونات جديدة وفروق ${formatMonthMeta(nextMonth) || nextMonth || '-'}`, value: nextDirectTotal, value_type: 'currency' }
    ])
  };
}

function buildCustomerInvoicesStat(response = {}) {
  const invoices = Object.values(response?.invoicesByCustomer || {})
    .filter((invoice) => String(invoice?.customer || '').trim() !== VOUCHER_CUSTOMER_NAME);
  const totals = invoices.reduce((acc, invoice) => {
    acc.purchases += toNumber(invoice?.purchases_total);
    acc.payments += toNumber(invoice?.payments_total);
    acc.balance += toNumber(invoice?.current_balance);
    return acc;
  }, { purchases: 0, payments: 0, balance: 0 });
  const hasPeriodActivity = response?.has_period_activity === true
    || invoices.some((invoice) => hasAmount(invoice?.purchases_total) || hasAmount(invoice?.payments_total));

  if (!invoices.length || !hasPeriodActivity) {
    return buildEmptyStat({ value: 0, value_type: 'currency' });
  }

  return {
    value: roundMoney(totals.purchases),
    value_type: 'currency',
    unit: '',
    meta: formatPeriodMeta(
      response?.period_start && response?.period_end
        ? `${response.period_start} - ${response.period_end}`
        : String(response?.period_label || '').trim() || 'الأسبوع الحالي'
    ),
    empty: false,
    rows: normalizeStatRows([
      { label: 'المدفوعات', value: roundMoney(totals.payments), value_type: 'currency' },
      { label: 'الرصيد الحالي', value: roundMoney(totals.balance), value_type: 'currency' }
    ])
  };
}

function formatLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function buildHomeAccountingStats(data = {}) {
  const stats = {
    'sales-summary': buildSalesSummaryStat(data.salesSummary, data.currentMonth),
    'sales-reconciliation': buildSalesReconciliationStat(data.salesReconciliation),
    'safe-book': buildSafeBookStat(data.safeBookView, data.safeBookMonthMovements),
    profit: buildProfitStat(data.profitRows),
    expenses: buildExpensesStat(data.expenses),
    'company-vouchers': buildCompanyVouchersStat(
      data.companyVoucherMonths,
      data.companyVoucherMonth || '',
      data.companyVoucherPeriodLabel || ''
    ),
    'customer-invoices': buildCustomerInvoicesStat(data.customerInvoices)
  };

  HOME_ACCOUNTING_CARD_KEYS.forEach((key) => {
    if (!stats[key]) stats[key] = buildEmptyStat();
  });

  return stats;
}

function getSaturdayWeekRange(referenceDate = new Date()) {
  const date = referenceDate instanceof Date ? new Date(referenceDate) : new Date(referenceDate);
  if (Number.isNaN(date.getTime())) {
    return { startDate: '', endDate: '' };
  }
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const daysSinceSaturday = (day + 1) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - daysSinceSaturday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end)
  };
}

function getPreviousWeekRange(weekRange = {}) {
  const startDate = String(weekRange?.startDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { startDate: '', endDate: '' };
  }
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return { startDate: '', endDate: '' };
  }
  start.setDate(start.getDate() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end)
  };
}

module.exports = {
  EMPTY_META,
  HOME_ACCOUNTING_CARD_KEYS,
  VOUCHER_CUSTOMER_NAME,
  buildCompanyVouchersStat,
  buildCustomerInvoicesStat,
  buildExpensesStat,
  buildHomeAccountingStats,
  buildProfitStat,
  buildSafeBookStat,
  buildSalesReconciliationStat,
  buildSalesSummaryStat,
  getNextMonth,
  getPreviousWeekRange,
  getSaturdayWeekRange
};
