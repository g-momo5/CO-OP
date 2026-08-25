const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normalizeLocalizedNumberText(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EASTERN_ARABIC_DIGITS.indexOf(digit)))
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gi, '')
    .replace(/[−﹣－]/g, '-')
    .replace(/[٬\u00a0\u202f\s]/g, '')
    .replace(/[٫،,]/g, '.');
}

function sanitizeLocalizedDecimalText(value, { allowNegative = true } = {}) {
  let normalized = normalizeLocalizedNumberText(value);
  const isNegative = allowNegative && normalized.startsWith('-');
  normalized = normalized.replace(/[^0-9.]/g, '');

  const firstDotIndex = normalized.indexOf('.');
  if (firstDotIndex !== -1) {
    normalized = normalized.slice(0, firstDotIndex + 1)
      + normalized.slice(firstDotIndex + 1).replace(/\./g, '');
  }

  return isNegative ? `-${normalized}` : normalized;
}

function parseLocalizedNumber(value) {
  const normalized = normalizeLocalizedNumberText(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

module.exports = {
  normalizeLocalizedNumberText,
  parseLocalizedNumber,
  sanitizeLocalizedDecimalText
};
