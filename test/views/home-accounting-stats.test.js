const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EMPTY_META,
  buildCompanyVouchersStat,
  buildCustomerInvoicesStat,
  buildExpensesStat,
  buildHomeAccountingStats,
  buildProfitStat,
  buildSafeBookStat,
  buildSalesReconciliationStat,
  buildSalesSummaryStat,
  getPreviousWeekRange,
  getSaturdayWeekRange
} = require('../../src/accounting/home-accounting-stats');

test('home sales summary stat lists fuel quantities without a total value and includes trends', () => {
  const stat = buildSalesSummaryStat({
    stat_month: '2026-08',
    comparison_month: '2026-07',
    wash_lube_amount: 250,
    wash_lube_comparison_amount: 300,
    view: {
      rows: [
        { product: 'سولار', type: 'fuel', byMonth: { '2026-08': 120 } },
        { product: 'بنزين ٩٢', type: 'fuel', byMonth: { '2026-08': 80 } },
        { product: 'بنزين ٩٥', type: 'fuel', byMonth: { '2026-08': 30 } },
        { product: 'غاز سيارات', type: 'fuel', byMonth: { '2026-08': 20 } },
        { product: 'زيت', type: 'oil', byMonth: { '2026-08': 999 } }
      ]
    },
    comparison_view: {
      rows: [
        { product: 'سولار', type: 'fuel', byMonth: { '2026-07': 100 } },
        { product: 'بنزين ٩٢', type: 'fuel', byMonth: { '2026-07': 90 } },
        { product: 'بنزين ٩٥', type: 'fuel', byMonth: { '2026-07': 30 } },
        { product: 'غاز سيارات', type: 'fuel', byMonth: { '2026-07': 0 } }
      ]
    }
  }, '2026-08');

  assert.equal(stat.empty, false);
  assert.equal(stat.value, null);
  assert.equal(stat.hide_value, true);
  assert.equal(stat.layout, 'rows-only');
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value, row.trend]), [
    ['سولار', 120, 'up'],
    ['بنزين ٩٢', 80, 'down'],
    ['بنزين ٩٥', 30, 'flat'],
    ['غاز سيارات', 20, 'up'],
    ['غسيل و تشحيم', 250, 'down']
  ]);
});

test('home sales summary stat can display previous month fallback', () => {
  const stat = buildSalesSummaryStat({
    stat_month: '2026-07',
    period_label: '2026-07',
    view: {
      rows: [
        { product: 'سولار', type: 'fuel', byMonth: { '2026-07': 90 } },
        { product: 'بنزين ٩٢', type: 'fuel', byMonth: { '2026-07': 30 } }
      ]
    },
    comparison_month: '2026-06',
    comparison_view: {
      rows: [
        { product: 'سولار', type: 'fuel', byMonth: { '2026-06': 100 } }
      ]
    }
  }, '2026-08');

  assert.equal(stat.empty, false);
  assert.equal(stat.value, null);
  assert.equal(stat.meta, '٠٧/٢٠٢٦');
  assert.equal(stat.rows[0].trend, 'down');
});

test('home sales summary trend can use projected current period quantity', () => {
  const stat = buildSalesSummaryStat({
    stat_month: '2026-08',
    comparison_month: '2026-07',
    projection_factor: 2,
    view: {
      rows: [
        { product: 'سولار', type: 'fuel', byMonth: { '2026-08': 60 } }
      ]
    },
    comparison_view: {
      rows: [
        { product: 'سولار', type: 'fuel', byMonth: { '2026-07': 100 } }
      ]
    }
  }, '2026-08');

  assert.equal(stat.rows[0].trend, 'up');
  assert.equal(stat.rows[0].projected, true);
});

test('home reconciliation stat says everything is ok when there are no issues', () => {
  const stat = buildSalesReconciliationStat({
    month: '2026-07',
    totals: { total: 4, ok: 4, mismatch: 0, missing: 0 },
    fuel_rows: [
      { product: 'سولار', type: 'fuel', status: 'ok' },
      { product: 'بنزين ٩٢', type: 'fuel', status: 'ok' }
    ]
  });

  assert.equal(stat.value, null);
  assert.equal(stat.value_text, 'كل شيء مطابق');
  assert.equal(stat.value_type, 'text');
  assert.equal(stat.meta, '٠٧/٢٠٢٦');
  assert.deepEqual(stat.rows, []);
});

test('home reconciliation stat lists mismatch and missing rows', () => {
  const stat = buildSalesReconciliationStat({
    month: '2026-07',
    totals: { total: 4, ok: 2, mismatch: 1, missing: 1 },
    fuel_rows: [
      { product: 'سولار', type: 'fuel', status: 'mismatch', difference: 12.5 },
      { product: 'بنزين ٩٢', type: 'fuel', status: 'ok' }
    ],
    oil_rows: [
      { product: 'زيت ٤٠', type: 'oil', status: 'missing', difference: null }
    ]
  });

  assert.equal(stat.value_text, 'توجد فروقات');
  assert.equal(stat.meta, '٠٧/٢٠٢٦');
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value_text, row.status]), [
    ['سولار', 'فرق +١٢.٥ لتر', 'mismatch'],
    ['زيت ٤٠ (زيوت)', 'بيانات ناقصة', 'missing']
  ]);
});

test('home safe book stat shows current balance and current month movement totals', () => {
  const stat = buildSafeBookStat(
    { current_balance: 875 },
    [
      { direction: 'in', amount: 1000 },
      { direction: 'out', amount: 125 }
    ]
  );

  assert.equal(stat.value, 875);
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value]), [
    ['داخل', 1000],
    ['خارج', 125]
  ]);
});

test('home safe book stat can display previous month movement fallback', () => {
  const stat = buildSafeBookStat(
    { current_balance: 875 },
    {
      period_label: '2026-07',
      items: [
        { direction: 'in', amount: 400 },
        { direction: 'out', amount: 75 }
      ]
    }
  );

  assert.equal(stat.value, 875);
  assert.equal(stat.meta, '٠٧/٢٠٢٦');
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value]), [
    ['داخل', 400],
    ['خارج', 75]
  ]);
});

test('home profit stat uses latest available profit month and compares with previous month', () => {
  const stat = buildProfitStat([
    { month_key: '2026-05', total_positive: 900, total_deductions: 200, net_profit: 700 },
    { month_key: '2026-06', total_positive: 1100, total_deductions: 250, net_profit: 850 },
    { month_key: '2026-07', total_positive: 0, total_deductions: 0, net_profit: 0 }
  ]);

  assert.equal(stat.meta, '٠٦/٢٠٢٦');
  assert.equal(stat.value, 850);
  assert.equal(stat.delta, 150);
});

test('home expenses stat totals current month and delta from previous month', () => {
  const stat = buildExpensesStat({
    currentTotal: 500,
    previousTotal: 650,
    period_label: '2026-08',
    comparison_month: '2026-07'
  });

  assert.equal(stat.value, 500);
  assert.equal(stat.delta, -150);
  assert.equal(stat.meta, '٠٨/٢٠٢٦');
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value]), [
    ['٠٧/٢٠٢٦', 650],
    ['التغير', -150]
  ]);
});

test('home expenses stat can display previous month fallback with prior comparison', () => {
  const stat = buildExpensesStat({
    currentTotal: 650,
    previousTotal: 500,
    period_label: '2026-07',
    comparison_month: '2026-06'
  });

  assert.equal(stat.value, 650);
  assert.equal(stat.delta, 150);
  assert.equal(stat.meta, '٠٧/٢٠٢٦');
});

test('home company vouchers stat uses latest month with company return and shows same/next month direct vouchers', () => {
  const stat = buildCompanyVouchersStat([
    {
      month: '2026-09',
      company_total: 0,
      direct_total: 80,
      items: [{}]
    },
    {
      month: '2026-08',
      company_total: 300,
      direct_total: 125,
      items: [{}, {}, {}]
    }
  ]);

  assert.equal(stat.value, 300);
  assert.equal(stat.meta, 'ما ردته الشركة - ٠٨/٢٠٢٦');
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value]), [
    ['بونات جديدة وفروق ٠٨/٢٠٢٦', 125],
    ['بونات جديدة وفروق ٠٩/٢٠٢٦', 80]
  ]);
});

test('home company vouchers stat can use an explicitly selected returned month', () => {
  const stat = buildCompanyVouchersStat([
    {
      month: '2026-07',
      company_total: 200,
      direct_total: 90,
      items: [{}]
    },
    {
      month: '2026-08',
      company_total: 0,
      direct_total: 40,
      items: [{}]
    }
  ], '2026-07');

  assert.equal(stat.value, 200);
  assert.equal(stat.meta, 'ما ردته الشركة - ٠٧/٢٠٢٦');
  assert.equal(stat.rows[0].value, 90);
  assert.equal(stat.rows[1].value, 40);
});

test('home customer invoices stat aggregates current week and excludes company vouchers customer', () => {
  const stat = buildCustomerInvoicesStat({
    period_start: '2026-08-01',
    period_end: '2026-08-07',
    invoicesByCustomer: {
      1: { customer: 'عميل ١', purchases_total: 500, payments_total: 100, current_balance: 900 },
      2: { customer: 'بونات الشركة', purchases_total: 800, payments_total: 0, current_balance: 800 },
      3: { customer: 'عميل ٢', purchases_total: 250, payments_total: 50, current_balance: 300 }
    }
  });

  assert.equal(stat.value, 750);
  assert.equal(stat.meta, '٠١/٠٨/٢٠٢٦ - ٠٧/٠٨/٢٠٢٦');
  assert.deepEqual(stat.rows.map((row) => [row.label, row.value]), [
    ['المدفوعات', 150],
    ['الرصيد الحالي', 1200]
  ]);
});

test('home accounting stats builder normalizes empty and partial data safely', () => {
  const stats = buildHomeAccountingStats({
    currentMonth: '2026-08',
    salesSummary: { rows: [] },
    salesReconciliation: null,
    safeBookView: null,
    safeBookMonthMovements: [{ direction: 'in', amount: 'bad' }],
    profitRows: [{ month_key: '2026-08', net_profit: 0 }],
    expenses: {},
    companyVoucherMonths: [],
    customerInvoices: { invoicesByCustomer: { 1: { customer: 'عميل', purchases_total: 0 } } }
  });

  Object.values(stats).forEach((stat) => {
    assert.equal(stat.empty, true);
    assert.equal(stat.meta, EMPTY_META);
  });
});

test('home customer invoice stat handles missing price totals without throwing', () => {
  const stat = buildCustomerInvoicesStat({
    invoicesByCustomer: {
      1: { customer: 'عميل', purchases_total: '', payments_total: 25, current_balance: -25 }
    }
  });

  assert.equal(stat.empty, false);
  assert.equal(stat.value, 0);
  assert.equal(stat.rows[0].value, 25);
  assert.equal(stat.rows[1].value, -25);
});

test('home customer invoice stat uses previous week label after endpoint fallback', () => {
  const stat = buildCustomerInvoicesStat({
    period_start: '2026-07-25',
    period_end: '2026-07-31',
    has_period_activity: true,
    invoicesByCustomer: {
      1: { customer: 'عميل', purchases_total: 300, payments_total: 50, current_balance: 400 }
    }
  });

  assert.equal(stat.empty, false);
  assert.equal(stat.meta, '٢٥/٠٧/٢٠٢٦ - ٣١/٠٧/٢٠٢٦');
  assert.equal(stat.value, 300);
});

test('home customer invoice stat treats old balance without weekly activity as empty', () => {
  const stat = buildCustomerInvoicesStat({
    invoicesByCustomer: {
      1: { customer: 'عميل', purchases_total: 0, payments_total: 0, current_balance: 1200 }
    }
  });

  assert.equal(stat.empty, true);
  assert.equal(stat.meta, EMPTY_META);
});

test('home accounting current week starts on Saturday and ends on Friday', () => {
  assert.deepEqual(getSaturdayWeekRange(new Date(2026, 7, 4)), {
    startDate: '2026-08-01',
    endDate: '2026-08-07'
  });
});

test('home accounting previous week is the Saturday to Friday before the current week', () => {
  assert.deepEqual(getPreviousWeekRange({ startDate: '2026-08-01', endDate: '2026-08-07' }), {
    startDate: '2026-07-25',
    endDate: '2026-07-31'
  });
});
