const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSalesReconciliationView } = require('../../src/accounting/sales-reconciliation');

test('reconciles fuel net sales from month counters and calibrations', () => {
  const view = buildSalesReconciliationView({
    month: '2026-07',
    fuelProducts: [{ fuel_type: 'بنزين ٩٢' }],
    shifts: [
      {
        id: 1,
        date: '2026-06-30',
        shift_number: 2,
        fuel_data: {
          fuel_92: { product_name: 'بنزين ٩٢', lastShift1: 1000, lastShift2: 2000 }
        }
      },
      {
        id: 2,
        date: '2026-07-31',
        shift_number: 2,
        fuel_data: {
          fuel_92: { product_name: 'بنزين ٩٢', lastShift1: 1060, lastShift2: 2070, totalQuantity: 130, cars: 5 }
        }
      }
    ]
  });

  const row = view.fuel_rows.find((item) => item.product === 'بنزين ٩٢');
  assert.equal(row.previous_counter, 3000);
  assert.equal(row.current_counter, 3130);
  assert.equal(row.gross_quantity, 130);
  assert.equal(row.calibrations, 5);
  assert.equal(row.expected_quantity, 125);
  assert.equal(row.summary_quantity, 125);
  assert.equal(row.difference, 0);
  assert.equal(row.status, 'ok');
});

test('reconciles diesel using four final counters', () => {
  const view = buildSalesReconciliationView({
    month: '2026-07',
    fuelProducts: [{ fuel_type: 'سولار' }],
    shifts: [
      {
        id: 1,
        date: '2026-06-30',
        shift_number: 2,
        fuel_data: {
          diesel: {
            product_name: 'سولار',
            lastShift1: 100,
            lastShift2: 200,
            lastShift3: 300,
            lastShift4: 400
          }
        }
      },
      {
        id: 2,
        date: '2026-07-31',
        shift_number: 2,
        fuel_data: {
          diesel: {
            product_name: 'سولار',
            lastShift1: 110,
            lastShift2: 220,
            lastShift3: 330,
            lastShift4: 440,
            totalQuantity: 100,
            cars: 10
          }
        }
      }
    ]
  });

  const row = view.fuel_rows.find((item) => item.product === 'سولار');
  assert.equal(row.previous_counter, 1000);
  assert.equal(row.current_counter, 1100);
  assert.equal(row.gross_quantity, 100);
  assert.equal(row.expected_quantity, 90);
  assert.equal(row.summary_quantity, 90);
  assert.equal(row.status, 'ok');
});

test('detects fuel mismatch against sales summary', () => {
  const view = buildSalesReconciliationView({
    month: '2026-07',
    fuelProducts: [{ fuel_type: 'بنزين ٨٠' }],
    shifts: [
      {
        id: 1,
        date: '2026-06-30',
        shift_number: 2,
        fuel_data: {
          fuel_80: { product_name: 'بنزين ٨٠', lastShift1: 100, lastShift2: 100 }
        }
      },
      {
        id: 2,
        date: '2026-07-31',
        shift_number: 2,
        fuel_data: {
          fuel_80: { product_name: 'بنزين ٨٠', lastShift1: 130, lastShift2: 130, totalQuantity: 40 }
        }
      }
    ]
  });

  const row = view.fuel_rows.find((item) => item.product === 'بنزين ٨٠');
  assert.equal(row.expected_quantity, 60);
  assert.equal(row.summary_quantity, 40);
  assert.equal(row.difference, 20);
  assert.equal(row.status, 'mismatch');
});

test('reconciles oils from previous remaining, shift incoming, and current remaining', () => {
  const view = buildSalesReconciliationView({
    month: '2026-07',
    oilProducts: [{ oil_type: 'زيت اختبار' }],
    shifts: [
      {
        id: 1,
        date: '2026-06-30',
        shift_number: 2,
        oil_data: {
          oil_test: { product_name: 'زيت اختبار', remaining: 12 }
        }
      },
      {
        id: 2,
        date: '2026-07-10',
        shift_number: 1,
        oil_data: {
          oil_test: { product_name: 'زيت اختبار', added: 8, remaining: 15, sold: 5 }
        }
      }
    ],
    manualSales: [
      { date: '2026-07-02', fuel_type: 'زيت اختبار', quantity: 999, total_amount: 999 }
    ]
  });

  const row = view.oil_rows.find((item) => item.product === 'زيت اختبار');
  assert.equal(row.previous_remaining, 12);
  assert.equal(row.added, 8);
  assert.equal(row.current_remaining, 15);
  assert.equal(row.expected_quantity, 5);
  assert.equal(row.summary_quantity, 5);
  assert.equal(row.status, 'ok');
});

test('marks reconciliation as missing when previous or current reading is unavailable', () => {
  const view = buildSalesReconciliationView({
    month: '2026-07',
    fuelProducts: [{ fuel_type: 'بنزين ٩٥' }],
    shifts: [
      {
        id: 2,
        date: '2026-07-31',
        shift_number: 2,
        fuel_data: {
          fuel_95: { product_name: 'بنزين ٩٥', lastShift1: 130, lastShift2: 130, totalQuantity: 60 }
        }
      }
    ]
  });

  const row = view.fuel_rows.find((item) => item.product === 'بنزين ٩٥');
  assert.equal(row.status, 'missing');
  assert.equal(row.difference, null);
});

test('includes configured products even when only product type fields are provided', () => {
  const view = buildSalesReconciliationView({
    month: '2026-07',
    fuelProducts: [{ fuel_type: 'بنزين ٩٢' }],
    oilProducts: [{ oil_type: 'زيت أ' }],
    shifts: []
  });

  assert.ok(view.fuel_rows.some((row) => row.product === 'بنزين ٩٢'));
  assert.ok(view.oil_rows.some((row) => row.product === 'زيت أ'));
});
