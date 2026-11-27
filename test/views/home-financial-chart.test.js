const test = require('node:test');
const assert = require('node:assert/strict');
const { financialMonthRange, renderFinancialOverview } = require('../../src/readonly-ui');

test('the finance chart covers twelve calendar months across New Year', () => {
  assert.deepEqual(financialMonthRange(new Date(2026, 0, 15)), {
    fromMonth: '2025-02',
    toMonth: '2026-01'
  });
});

test('the finance chart uses all three profit report totals and plots losses below zero', () => {
  const html = renderFinancialOverview({ rows: [
    { month_key: '2026-11', total_positive: 500, expenses_month: 80, total_deductions: 130, net_profit: 370 },
    { month_key: '2026-10', total_positive: 100, expenses_month: 120, total_deductions: 150, net_profit: -50 }
  ] });
  const money = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
  const zero = Number(html.match(/y1="([^"]+)" y2="[^"]+" class="chart-axis-line"/)[1]);
  const points = Array.from(html.matchAll(/<circle[^>]+ cy="([^"]+)"[^>]+class="financial-net-point"/g), (match) => Number(match[1]));

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
  const html = renderFinancialOverview({ rows });
  const heights = Array.from(html.matchAll(/<rect[^>]+height="([^"]+)"[^>]+class="financial-deductions"/g), (match) => Number(match[1]));

  assert.equal(heights.length, 12);
  assert.equal(heights[0], 0);
  assert.ok(heights.slice(1).every((height) => height > 10));
  assert.match(html, /الخصومات على اليمين/);
  assert.match(html, /financial-deduction-tick/);
});

test('the finance chart shows an empty message when the report has no activity', () => {
  const html = renderFinancialOverview({
    rows: [{ month_key: '2026-11', total_positive: 0, total_deductions: 0, net_profit: 0 }]
  });
  assert.match(html, /لا توجد بيانات مالية/);
  assert.doesNotMatch(html, /<svg|data-chart-expand/);
});
