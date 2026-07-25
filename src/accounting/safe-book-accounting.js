const { normalizeDate, roundMoney, toNumber } = require('./common');
const { normalizeShiftRecord } = require('./shift-accounting');

function buildSafeBookEntries({ manualMovements = [], shifts = [] } = {}) {
  return [
    ...manualMovements.map((row) => ({
      id: row.id ? `manual-${row.id}` : undefined,
      date: normalizeDate(row.date),
      label: row.movement_type || row.label || 'حركة خزنة',
      amount: Math.abs(toNumber(row.amount)),
      direction: row.direction === 'out' ? 'out' : 'in',
      source: 'manual'
    })),
    ...shifts.map(normalizeShiftRecord).map((shift) => ({
      id: shift.id ? `shift-${shift.id}` : undefined,
      date: normalizeDate(shift.date),
      label: `وردية ${shift.shift_number === 2 ? 'ليل' : 'صباح'}`,
      amount: Math.abs(toNumber(shift.grand_total)),
      direction: toNumber(shift.grand_total) >= 0 ? 'in' : 'out',
      source: 'shift',
      shift_number: shift.shift_number
    }))
  ].filter((entry) => entry.date);
}

function filterEntriesByDate(entries = [], fromDate = '', toDate = '') {
  const from = normalizeDate(fromDate);
  const to = normalizeDate(toDate);
  return entries.filter((entry) => {
    if (from && entry.date < from) return false;
    if (to && entry.date > to) return false;
    return true;
  });
}

function calculateSafeBookBalance(entries = [], openingBalance = 0) {
  return roundMoney(entries.reduce((balance, entry) => {
    const amount = toNumber(entry.amount);
    return balance + (entry.direction === 'out' ? -amount : amount);
  }, toNumber(openingBalance)));
}

function buildSafeBookLedger({ manualMovements = [], shifts = [], openingBalance = 0, fromDate = '', toDate = '' } = {}) {
  const entries = filterEntriesByDate(buildSafeBookEntries({ manualMovements, shifts }), fromDate, toDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.shift_number || 0) - (b.shift_number || 0));
  let balance = toNumber(openingBalance);
  const ledger = entries.map((entry) => {
    balance += entry.direction === 'out' ? -toNumber(entry.amount) : toNumber(entry.amount);
    return { ...entry, balance: roundMoney(balance) };
  });
  return { entries: ledger, balance: roundMoney(balance) };
}

module.exports = {
  buildSafeBookEntries,
  buildSafeBookLedger,
  calculateSafeBookBalance,
  filterEntriesByDate
};
