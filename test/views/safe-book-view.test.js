const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSafeBookView } = require('../../src/accounting/safe-book-view');

test('builds safe book view with current balance and default visible limit', () => {
  const view = buildSafeBookView({
    visibleLimit: 2,
    manualRows: [
      { id: 1, date: '2026-07-01', movement_type: 'إيداع', amount: 100, direction: 'in', created_at: '2026-07-01T09:00:00' },
      { id: 2, date: '2026-07-03', movement_type: 'مصروف', amount: 20, direction: 'out', created_at: '2026-07-03T09:00:00' }
    ],
    shiftRows: [
      { id: 10, date: '2026-07-02', shift_number: 1, grand_total: 50, created_at: '2026-07-02T10:00:00' }
    ]
  });

  assert.equal(view.current_balance, 130);
  assert.equal(view.movements.length, 2);
  assert.deepEqual(view.movements.map((row) => row.id), ['manual-2', 'shift-10']);
});

test('builds safe book period balances for filtered range', () => {
  const view = buildSafeBookView({
    startDate: '2026-07-02',
    endDate: '2026-07-03',
    manualRows: [
      { id: 1, date: '2026-07-01', amount: 100, direction: 'in' },
      { id: 2, date: '2026-07-03', amount: 20, direction: 'out' }
    ],
    shiftRows: [
      { id: 10, date: '2026-07-02', shift_number: 1, grand_total: 50 }
    ]
  });

  assert.equal(view.current_balance, 130);
  assert.equal(view.period_start_balance, 100);
  assert.equal(view.period_end_balance, 130);
  assert.deepEqual(view.movements.map((row) => row.id), ['manual-2', 'shift-10']);
});
