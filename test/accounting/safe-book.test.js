const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSafeBookEntries,
  buildSafeBookLedger,
  calculateSafeBookBalance,
  filterEntriesByDate
} = require('../../src/accounting/safe-book-accounting');

test('builds safe book entries from manual movements and saved shifts', () => {
  const entries = buildSafeBookEntries({
    manualMovements: [
      { id: 1, date: '2026-07-01', movement_type: 'إيداع', amount: 100, direction: 'in' },
      { id: 2, date: '2026-07-02', movement_type: 'مصروف', amount: 30, direction: 'out' }
    ],
    shifts: [
      { id: 3, date: '2026-07-03', shift_number: 1, grand_total: 500 },
      { id: 4, date: '2026-07-04', shift_number: 2, grand_total: -20 }
    ]
  });

  assert.equal(entries.length, 4);
  assert.equal(calculateSafeBookBalance(entries, 1000), 1550);
});

test('filters safe book entries and calculates progressive ledger balance', () => {
  const ledger = buildSafeBookLedger({
    openingBalance: 100,
    manualMovements: [
      { date: '2026-06-30', amount: 1000, direction: 'in' },
      { date: '2026-07-01', amount: 50, direction: 'in' },
      { date: '2026-07-02', amount: 20, direction: 'out' }
    ],
    shifts: [
      { date: '2026-07-03', shift_number: 1, grand_total: 70 }
    ],
    fromDate: '2026-07-01',
    toDate: '2026-07-03'
  });

  assert.equal(ledger.balance, 200);
  assert.deepEqual(ledger.entries.map((entry) => entry.balance), [150, 130, 200]);
  assert.equal(filterEntriesByDate(ledger.entries, '2026-07-02', '2026-07-03').length, 2);
});
