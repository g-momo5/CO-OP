const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateFuelCounterQuantity,
  calculateFuelEntry,
  getShiftFuelSoldQuantity,
  recalculateFuelData,
  validateFuelData
} = require('../../src/accounting/fuel-accounting');

test('calculates diesel accounting across four counters', () => {
  const result = calculateFuelEntry('diesel', {
    product_name: 'سولار',
    firstShift1: 100,
    lastShift1: 110,
    firstShift2: 200,
    lastShift2: 215,
    firstShift3: 300,
    lastShift3: 330,
    firstShift4: 400,
    lastShift4: 450,
    clients: 5,
    cars: 2,
    price: 10
  });

  assert.equal(result.entry.quantity1, 10);
  assert.equal(result.entry.quantity2, 15);
  assert.equal(result.entry.quantity3, 30);
  assert.equal(result.entry.quantity4, 50);
  assert.equal(result.entry.totalQuantity, 105);
  assert.equal(result.entry.cash, 980);
  assert.deepEqual(result.errors, []);
});

test('calculates gasoline accounting across two counters', () => {
  const result = recalculateFuelData({
    fuel_92: {
      product_name: 'بنزين ٩٢',
      firstShift1: 1000,
      lastShift1: 1025,
      firstShift2: 2000,
      lastShift2: 2040,
      clients: 10,
      cars: 5,
      price: 12
    }
  });

  assert.equal(result.fuel_data.fuel_92.totalQuantity, 65);
  assert.equal(result.fuel_data.fuel_92.cash, 600);
  assert.equal(result.fuel_total, 600);
});

test('reports invalid fuel counters', () => {
  assert.equal(calculateFuelCounterQuantity(20, 15), -5);
  const errors = validateFuelData({
    fuel_80: {
      product_name: 'بنزين ٨٠',
      firstShift1: 50,
      lastShift1: 40,
      firstShift2: 0,
      lastShift2: 0,
      price: 10
    }
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /آخر الوردية/);
});

test('sold fuel quantity excludes calibration cars', () => {
  assert.equal(getShiftFuelSoldQuantity('سولار', { totalQuantity: 100, cars: 7 }), 93);
});
