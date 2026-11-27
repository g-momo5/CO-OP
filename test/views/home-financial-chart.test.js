const test = require('node:test');
const assert = require('node:assert/strict');
const { financialMonthRange, renderFinancialOverview } = require('../../src/readonly-ui');

test('the finance chart covers six calendar months across New Year', () => {
  assert.deepEqual(financialMonthRange(new Date(2026, 0, 15)), {
    fromMonth: '2025-08',
    toMonth: '2026-01'
  });
});

test('the finance chart uses reported net profit and plots losses below zero', () => {
  const html = renderFinancialOverview({ rows: [
    { month_key: '2026-11', total_positive: 500, expenses_month: 80, net_profit: 370 },
    { month_key: '2026-10', total_positive: 100, expenses_month: 120, net_profit: -50 }
  ] });
  const money = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
  const zero = Number(html.match(/y1="([^"]+)" y2="[^"]+" class="chart-axis-line"/)[1]);
  const points = Array.from(html.matchAll(/<circle[^>]+ cy="([^"]+)"[^>]+class="financial-net-point"/g), (match) => Number(match[1]));

  assert.equal(points.length, 2);
  assert.ok(points[0] > zero);
  assert.ok(points[1] < zero);
  assert.ok(html.includes(`<td>${money.format(370)}</td>`));
  assert.ok(html.includes(`<td>${money.format(-50)}</td>`));
  assert.match(html, /القيم الشهرية/);
});

test('the finance chart shows an empty message when the report has no activity', () => {
  const html = renderFinancialOverview({
    rows: [{ month_key: '2026-11', total_positive: 0, expenses_month: 0, net_profit: 0 }]
  });
  assert.match(html, /لا توجد بيانات مالية/);
  assert.doesNotMatch(html, /<svg|data-chart-expand/);
});
