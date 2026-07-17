const test = require('node:test');
const assert = require('node:assert/strict');
const land = require('./src/land-domain');

test('converts Egyptian land units to sahm and back', () => {
  const total = land.surfaceToSahm({ feddan: 2, qirat: 12, sahm: 0 });
  assert.equal(total, 1440);
  assert.deepEqual(land.sahmToSurface(total), { feddan: 2, qirat: 12, sahm: 0 });
});

test('rejects invalid surfaces', () => {
  assert.throws(() => land.surfaceToSahm({ feddan: 0, qirat: 24, sahm: 0 }), /qirat/);
  assert.throws(() => land.surfaceToSahm({ feddan: 0, qirat: 0, sahm: -1 }), /negative/);
});

test('calculates rent by feddan proportionally', () => {
  const total = land.surfaceToSahm({ feddan: 2, qirat: 12, sahm: 0 });
  assert.equal(land.calculateRentByFeddan(total, 1_000_000), 2_500_000);
});

test('formats money as Egyptian pounds', () => {
  assert.equal(land.formatMoney(1_234_56), '1234.56 جنيه مصري');
});

test('allocates proportional rent and keeps rounding difference on last part', () => {
  const total = land.surfaceToSahm({ feddan: 2, qirat: 12, sahm: 0 });
  const a = land.surfaceToSahm({ feddan: 1, qirat: 0, sahm: 0 });
  const b = land.surfaceToSahm({ feddan: 1, qirat: 12, sahm: 0 });
  assert.deepEqual(land.allocateProportionalAmounts(2_500_000, [a, b], total), [1_000_000, 1_500_000]);
  assert.deepEqual(land.allocateProportionalAmounts(100, [1, 1, 1], 3), [33, 33, 34]);
});

test('validates available surface', () => {
  assert.equal(land.validateAvailableSurface(100, 40, 60), true);
  assert.throws(() => land.validateAvailableSurface(100, 40, 61), /exceeds/);
  assert.throws(() => land.validateAvailableSurface(100, 40, 0), /greater than zero/);
});

test('splits installment plans', () => {
  assert.deepEqual(land.splitInstallments(15_000_00), [7_500_00, 7_500_00]);
  assert.deepEqual(land.splitInstallments(15_000_00, 7_000_00, 'amount'), [7_000_00, 8_000_00]);
});

test('calculates partial payments, remaining amount, and overpayment', () => {
  const partial = land.calculatePaymentSummary(1_500_000, 750_000, 750_000, 700_000, 500_000);
  assert.equal(partial.totalPaidCents, 1_200_000);
  assert.equal(partial.remainingCents, 300_000);
  assert.equal(partial.status, 'first_partial');

  const overpaid = land.calculatePaymentSummary(1_500_000, 750_000, 750_000, 800_000, 800_000);
  assert.equal(overpaid.creditCents, 100_000);
  assert.equal(overpaid.status, 'overpaid');
});

test('keeps seasonal price changes independent', () => {
  const surface = land.surfaceToSahm({ feddan: 1, qirat: 0, sahm: 0 });
  const oldRent = land.calculateRentByFeddan(surface, 1_000_000);
  const newRent = land.calculateRentByFeddan(surface, 1_200_000);
  assert.equal(oldRent, 1_000_000);
  assert.equal(newRent, 1_200_000);
});
