const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateOilEntry,
  recalculateOilData,
  validateOilData
} = require('../../src/accounting/oil-accounting');

test('calculates oil sold quantity and cash revenue', () => {
  const result = calculateOilEntry('oil_a', {
    product_name: 'زيت اختبار',
    initial: 10,
    added: 5,
    remaining: 9,
    customers: 2,
    open: 1,
    price: 20
  });

  assert.equal(result.entry.total, 15);
  assert.equal(result.entry.sold, 6);
  assert.equal(result.entry.revenue, 60);
  assert.deepEqual(result.errors, []);
});

test('calculates total oil cash across multiple oils', () => {
  const result = recalculateOilData({
    oil_a: { product_name: 'زيت أ', initial: 4, added: 6, remaining: 5, price: 30 },
    oil_b: { product_name: 'زيت ب', initial: 2, added: 0, remaining: 1, open: 0.5, price: 40 }
  });

  assert.equal(result.oil_data.oil_a.sold, 5);
  assert.equal(result.oil_data.oil_b.sold, 1);
  assert.equal(result.oil_total, 170);
});

test('blocks open oil quantity above sold quantity', () => {
  const errors = validateOilData({
    oil_a: { product_name: 'زيت أ', initial: 1, added: 0, remaining: 0.5, open: 1, price: 10 }
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /مفتوح/);
});

test('blocks loose oil incoming when no oil is opened', () => {
  const errors = validateOilData({
    loose: { product_name: 'سايب ١ ك', initial: 0, added: 2, remaining: 0, price: 0 },
    oil_a: { product_name: 'زيت أ', initial: 3, added: 0, remaining: 2, open: 0, price: 10 }
  }, { requireLooseOilOpen: true });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /سايب ١ ك/);
});

test('allows loose oil incoming when an oil is opened', () => {
  const errors = validateOilData({
    loose: { product_name: 'سايب ١ ك', initial: 0, added: 2, remaining: 0, price: 0 },
    oil_a: { product_name: 'زيت أ', initial: 3, added: 0, remaining: 2, open: 1, price: 10 }
  }, { requireLooseOilOpen: true });

  assert.deepEqual(errors, []);
});
