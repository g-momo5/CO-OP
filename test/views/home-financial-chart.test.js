const test = require('node:test');
const assert = require('node:assert/strict');
const { renderFinancialOverview, renderOverview } = require('../../src/readonly-ui');

const range = { fromMonth: '2026-01', toMonth: '2026-11' };

function monthLabels(html) {
  return Array.from(html.matchAll(/class="chart-month-label"><title>[^<]+<\/title>([^<]+)<\/text>/g), (match) => match[1]);
}

test('both home charts show active months this year with the same unpadded labels and order', () => {
  const sales = renderOverview({ chart: {
    months: ['2026-11', '2026-02', '2026-01', '2025-12', '2026-12'],
    salesDaysByMonth: { '2026-11': 15 },
    rows: [{ name: 'سولار', byMonth: { '2025-12': 5, '2026-01': 50, '2026-11': 100, '2026-12': 10 } }]
  } }, range);
  const finances = renderFinancialOverview({
    activeMonths: ['2025-12', '2026-01', '2026-11', '2026-12'],
    rows: [
      { month_key: '2026-11', total_positive: 50 },
      { month_key: '2026-02', total_positive: 0 },
      { month_key: '2026-01', total_positive: 0 },
      { month_key: '2025-12', total_positive: 15 },
      { month_key: '2026-12', total_positive: 15 }
    ]
  }, range);

  assert.deepEqual(monthLabels(sales), ['١', '١١']);
  assert.deepEqual(monthLabels(finances), monthLabels(sales));
  assert.match(sales, /class="sales-chart-line sales-chart-projection"/);
  assert.doesNotMatch(finances, /ديسمبر/);
});

test('the finance chart plots deductions and losses below zero with aligned revenue bars', () => {
  const html = renderFinancialOverview({ rows: [
    { month_key: '2026-11', total_positive: 500, expenses_month: 80, total_deductions: 130, net_profit: 370 },
    { month_key: '2026-10', total_positive: 100, expenses_month: 120, total_deductions: 150, net_profit: -50 }
  ] }, range);
  const money = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
  const zero = Number(html.match(/y1="([^"]+)" y2="[^"]+" class="chart-axis-line"/)[1]);
  const points = Array.from(html.matchAll(/<circle[^>]+ cy="([^"]+)"[^>]+class="financial-net-point"/g), (match) => Number(match[1]));
  const bars = Array.from(html.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*class="financial-(?:revenue|deductions)"/g), (match) => match.slice(1).map(Number));

  assert.equal(bars.length, 4);
  for (let index = 0; index < bars.length; index += 2) {
    const [revenueX, revenueY, revenueWidth, revenueHeight] = bars[index];
    const [deductionsX, deductionsY, deductionsWidth, deductionsHeight] = bars[index + 1];
    assert.equal(deductionsX, revenueX);
    assert.equal(deductionsWidth, revenueWidth);
    assert.equal(revenueY + revenueHeight, zero);
    assert.equal(deductionsY, zero);
    assert.ok(deductionsHeight > 0);
  }

  assert.equal(points.length, 2);
  assert.ok(points[0] > zero);
  assert.ok(points[1] < zero);
  assert.ok(html.includes(`<td>${money.format(130)}</td>`));
  assert.ok(!html.includes(`<td>${money.format(80)}</td>`));
  assert.ok(html.includes(`<td>${money.format(370)}</td>`));
  assert.ok(html.includes(`<td>${money.format(-50)}</td>`));
  assert.match(html, /<th>إجمالي الإيرادات<\/th><th>إجمالي الخصومات<\/th><th>صافي المكسب<\/th>/);
  assert.match(html, /القيم الشهرية/);
});

test('the annual chart gives small deductions a readable and explicitly labeled scale', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    month_key: `2026-${String(index + 1).padStart(2, '0')}`,
    total_positive: 5_000_000,
    total_deductions: index === 0 ? 0 : 80_000,
    net_profit: index === 0 ? 5_000_000 : 4_920_000
  }));
  const html = renderFinancialOverview({ rows }, { ...range, toMonth: '2026-12' });
  const heights = Array.from(html.matchAll(/<rect[^>]+height="([^"]+)"[^>]+class="financial-deductions"/g), (match) => Number(match[1]));

  assert.equal(heights.length, 12);
  assert.equal(heights[0], 0);
  assert.ok(heights.slice(1).every((height) => height > 10));
  assert.deepEqual(monthLabels(html), ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠', '١١', '١٢']);
  assert.match(html, /الخصومات على اليمين/);
  assert.match(html, /financial-deduction-tick/);
});

test('the finance chart shows an empty message when the report has no activity', () => {
  const html = renderFinancialOverview({
    rows: [{ month_key: '2026-11', total_positive: 0, total_deductions: 0, net_profit: 0 }]
  }, range);
  assert.match(html, /لا توجد بيانات مالية/);
  assert.doesNotMatch(html, /<svg|data-chart-expand/);
});
