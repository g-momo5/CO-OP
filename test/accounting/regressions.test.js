const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCascadeUpdates } = require('../../src/shift-cascade');
const { calculateMonthlyProfit } = require('../../src/accounting/monthly-profit');
const { calculateShiftTotals } = require('../../src/accounting/shift-accounting');

test('regression: morning and night shift totals remain stable', () => {
  const morning = calculateShiftTotals({
    date: '2026-07-20',
    shift_number: 1,
    fuel_data: {
      diesel: { product_name: 'سولار', firstShift1: 100, lastShift1: 160, price: 10 },
      fuel92: { product_name: 'بنزين ٩٢', firstShift1: 200, lastShift1: 230, price: 12 }
    },
    oil_data: {
      oil_a: { product_name: 'زيت أ', initial: 5, added: 2, remaining: 4, price: 30 }
    },
    wash_lube_revenue: 25,
    expense_items: [{ amount: 15 }]
  });

  const night = calculateShiftTotals({
    date: '2026-07-20',
    shift_number: 2,
    fuel_data: {
      diesel: { product_name: 'سولار', firstShift1: 160, lastShift1: 190, price: 10 },
      fuel92: { product_name: 'بنزين ٩٢', firstShift1: 230, lastShift1: 260, price: 12 }
    },
    oil_data: {
      oil_a: { product_name: 'زيت أ', initial: 4, added: 0, remaining: 3, open: 1, price: 30 }
    },
    total_expenses: 20
  });

  assert.equal(morning.totals.grand_total, 1060);
  assert.equal(night.totals.grand_total, 640);
});

test('regression: correcting an old shift cascades later accounting values', () => {
  const result = buildCascadeUpdates({
    sourceShift: {
      date: '2026-07-20',
      shift_number: 1,
      fuel_data: {
        diesel: { product_name: 'سولار', firstShift1: 100, lastShift1: 180, price: 10 }
      },
      oil_data: {
        oil_a: { product_name: 'زيت أ', initial: 5, added: 1, remaining: 3, price: 20 }
      }
    },
    followingShifts: [
      {
        date: '2026-07-20',
        shift_number: 2,
        fuel_data: {
          diesel: { product_name: 'سولار', firstShift1: 160, lastShift1: 210, price: 10 }
        },
        oil_data: {
          oil_a: { product_name: 'زيت أ', initial: 4, added: 2, remaining: 2, price: 20 }
        }
      }
    ]
  });

  const updated = result.updates[0].shift;
  assert.equal(updated.fuel_data.diesel.firstShift1, 180);
  assert.equal(updated.fuel_data.diesel.totalQuantity, 30);
  assert.equal(updated.fuel_total, 300);
  assert.equal(updated.oil_data.oil_a.initial, 3);
  assert.equal(updated.oil_data.oil_a.sold, 3);
  assert.equal(updated.oil_total, 60);
  assert.equal(updated.grand_total, 360);
});

test('regression: full month net profit fixture', () => {
  const rows = calculateMonthlyProfit({
    fromMonth: '2026-07',
    toMonth: '2026-07',
    shifts: [
      {
        date: '2026-07-20',
        fuel_data: {
          diesel: { product_name: 'سولار', totalQuantity: 80, price: 10 },
          fuel92: { product_name: 'بنزين ٩٢', totalQuantity: 60, price: 12 }
        },
        oil_data: {
          oil_a: { product_name: 'زيت أ', sold: 4, open: 1, price: 30 }
        },
        wash_lube_revenue: 25,
        total_expenses: 35
      }
    ],
    fuelInvoices: [
      { date: '2026-07-01', invoice_number: 'F-1', fuel_type: 'سولار', total: 9999, invoice_total: 9999 }
    ],
    oilInvoices: [
      { date: '2026-07-02', invoice_number: 'O-1', total_purchase: 40 }
    ],
    monthlyInputs: [
      { month_key: '2026-07', bonuses: 10, commission_diff: 5, deposit_tax: 3, bonus_tax: 2 }
    ],
    monthlyAccountingDocuments: [
      {
        month_key: '2026-07',
        is_final: 1,
        final_data: {
          month_key: '2026-07',
          debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 500 }],
          fuel_purchase_rows: [
            { date: '2026-07-01', fuel_type: 'سولار', quantity: 30, purchase_price: 10 },
            { date: '2026-07-01', fuel_type: 'بنزين ٩٢', quantity: 20, purchase_price: 10 }
          ]
        }
      }
    ]
  });

  assert.equal(rows[0].fuel_diesel, 500);
  assert.equal(rows[0].fuel_92, 521);
  assert.equal(rows[0].oil_total, 50);
  assert.equal(rows[0].net_profit, 1060);
});
