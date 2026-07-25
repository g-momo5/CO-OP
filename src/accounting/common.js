function toNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function roundQuantity(value) {
  return roundTo(value, 2);
}

function roundMoney(value) {
  return roundTo(value, 2);
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function normalizeMonth(value) {
  const normalized = String(value || '').trim().slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : '';
}

function monthToRange(monthKey) {
  const month = normalizeMonth(monthKey);
  if (!month) return null;
  const [yearText, monthText] = month.split('-');
  const year = parseInt(yearText, 10);
  const monthNumber = parseInt(monthText, 10);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, '0')}`
  };
}

function buildMonthRange(fromMonth, toMonth) {
  const start = normalizeMonth(fromMonth);
  const end = normalizeMonth(toMonth);
  if (!start || !end || start > end) return [];

  const months = [];
  let [year, month] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

function parseObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getEntryName(entryKey, data = {}) {
  return normalizeName(data?.product_name || data?.oil_type || data?.fuel_type || entryKey || '');
}

function getEntryCode(entryKey, data = {}) {
  return normalizeName(data?.product_code || entryKey || '');
}

function buildEntryLookup(entries = {}) {
  const byCode = new Map();
  const byName = new Map();

  Object.entries(entries || {}).forEach(([entryKey, data]) => {
    if (!data || typeof data !== 'object') return;
    const code = getEntryCode(entryKey, data);
    const name = getEntryName(entryKey, data);
    if (code) byCode.set(code, data);
    if (name) byName.set(name, data);
  });

  return { byCode, byName };
}

function findMatchingEntry(previousEntries, entryKey, data) {
  const lookup = buildEntryLookup(previousEntries);
  const code = getEntryCode(entryKey, data);
  const name = getEntryName(entryKey, data);
  return lookup.byCode.get(code) || lookup.byName.get(name) || null;
}

function normalizeItems(items) {
  return Array.isArray(items) ? clone(items) : [];
}

function sumAmounts(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + toNumber(item?.amount), 0);
}

module.exports = {
  buildMonthRange,
  clone,
  findMatchingEntry,
  getEntryCode,
  getEntryName,
  monthToRange,
  normalizeDate,
  normalizeItems,
  normalizeMonth,
  normalizeName,
  parseObject,
  roundMoney,
  roundQuantity,
  sumAmounts,
  toNumber
};
