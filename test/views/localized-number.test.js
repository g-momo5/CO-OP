const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeLocalizedNumberText,
  parseLocalizedNumber,
  sanitizeLocalizedDecimalText
} = require('../../src/localized-number');

test('normalizes mixed Western, Arabic and Eastern Arabic digits', () => {
  assert.equal(normalizeLocalizedNumberText('12٣٤۵6'), '123456');
});

test('normalizes Arabic decimal and grouping separators', () => {
  assert.equal(normalizeLocalizedNumberText('\u061c١٬٢٣٤٫٥'), '1234.5');
  assert.equal(parseLocalizedNumber('١٬٢٣٤٫٥'), 1234.5);
});

test('sanitizes localized decimal input while keeping one decimal separator', () => {
  assert.equal(sanitizeLocalizedDecimalText('١٢٫٣.٤'), '12.34');
  assert.equal(sanitizeLocalizedDecimalText('- ۴۵,۶'), '-45.6');
});

test('rejects text that is not a complete localized number', () => {
  assert.equal(Number.isNaN(parseLocalizedNumber('١٢abc')), true);
  assert.equal(Number.isNaN(parseLocalizedNumber('')), true);
});
