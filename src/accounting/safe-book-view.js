const { normalizeDate, roundMoney, toNumber } = require('./common');

const DEFAULT_SAFE_BOOK_VISIBLE_ROWS = 15;

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num)) return num < 1e12 ? num * 1000 : num;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function toDateKey(dateStr) {
  const date = normalizeDate(dateStr);
  const parsed = Date.parse(`${date}T00:00:00`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function signedAmount(movement) {
  const amount = Math.abs(toNumber(movement?.amount));
  return movement?.direction === 'out' ? -amount : amount;
}

function buildSafeBookMovements({ manualRows = [], shiftRows = [] } = {}) {
  const manualMovements = (Array.isArray(manualRows) ? manualRows : []).map((row) => ({
    id: `manual-${row.id}`,
    date: normalizeDate(row.date),
    movement_type: row.movement_type,
    amount: Math.abs(toNumber(row.amount)),
    direction: row.direction === 'out' ? 'out' : 'in',
    source: 'manual',
    shift_number: null,
    created_at: toTimestamp(row.created_at)
  })).filter((row) => row.date);

  const shiftMovements = (Array.isArray(shiftRows) ? shiftRows : []).map((row) => {
    const amount = toNumber(row.grand_total);
    return {
      id: `shift-${row.id}`,
      date: normalizeDate(row.date),
      movement_type: null,
      amount: Math.abs(amount),
      direction: amount >= 0 ? 'in' : 'out',
      source: 'shift',
      shift_number: parseInt(row.shift_number, 10) || 1,
      created_at: toTimestamp(row.updated_at || row.created_at)
    };
  }).filter((row) => row.date);

  const all = [...shiftMovements, ...manualMovements];
  all.sort((a, b) => {
    const byDate = toDateKey(b.date) - toDateKey(a.date);
    if (byDate !== 0) return byDate;

    const aShiftRank = a.source === 'shift' ? (a.shift_number || 0) : 0;
    const bShiftRank = b.source === 'shift' ? (b.shift_number || 0) : 0;
    if (bShiftRank !== aShiftRank) return bShiftRank - aShiftRank;

    return (b.created_at || 0) - (a.created_at || 0);
  });

  return all;
}

function buildSafeBookView({
  manualRows = [],
  shiftRows = [],
  startDate = null,
  endDate = null,
  visibleLimit = DEFAULT_SAFE_BOOK_VISIBLE_ROWS
} = {}) {
  const allMovements = buildSafeBookMovements({ manualRows, shiftRows });
  const from = normalizeDate(startDate);
  const to = normalizeDate(endDate);
  const isFiltered = Boolean(from && to);
  const currentBalance = roundMoney(allMovements.reduce((sum, movement) => sum + signedAmount(movement), 0));

  let periodStartBalance = 0;
  let periodEndBalance = currentBalance;
  if (isFiltered) {
    periodStartBalance = roundMoney(allMovements.reduce((sum, movement) => {
      if (!movement.date || movement.date >= from) return sum;
      return sum + signedAmount(movement);
    }, 0));

    periodEndBalance = roundMoney(allMovements.reduce((sum, movement) => {
      if (!movement.date || movement.date > to) return sum;
      return sum + signedAmount(movement);
    }, 0));
  }

  const filteredMovements = isFiltered
    ? allMovements.filter((movement) => movement.date >= from && movement.date <= to)
    : allMovements;
  const movements = isFiltered ? filteredMovements : filteredMovements.slice(0, visibleLimit);

  return {
    current_balance: currentBalance,
    period_start_balance: periodStartBalance,
    period_end_balance: periodEndBalance,
    is_filtered: isFiltered,
    total_count: allMovements.length,
    filtered_count: filteredMovements.length,
    movements
  };
}

module.exports = {
  DEFAULT_SAFE_BOOK_VISIBLE_ROWS,
  buildSafeBookMovements,
  buildSafeBookView
};
