const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCascadeUpdates
} = require('./src/shift-cascade');

function shift(overrides = {}) {
  return {
    date: overrides.date || '2026-07-01',
    shift_number: overrides.shift_number || 1,
    fuel_data: overrides.fuel_data || {},
    oil_data: overrides.oil_data || {},
    wash_lube_revenue: overrides.wash_lube_revenue || 0,
    total_expenses: overrides.total_expenses || 0,
    data: JSON.stringify({
      revenue_items: overrides.revenue_items || [],
      customer_payments: overrides.customer_payments || [],
      expense_items: overrides.expense_items || [],
      customer_rows: overrides.customer_rows || []
    }),
    is_saved: 1
  };
}

function diesel({ first = 0, last = 0, price = 10, clients = 0, cars = 0 } = {}) {
  return {
    product_name: 'سولار',
    firstShift1: first,
    lastShift1: last,
    firstShift2: 0,
    lastShift2: 0,
    firstShift3: 0,
    lastShift3: 0,
    firstShift4: 0,
    lastShift4: 0,
    price,
    clients,
    cars
  };
}

function oil({ initial = 0, added = 0, remaining = 0, price = 20, customers = 0, open = 0 } = {}) {
  return {
    product_name: 'زيت اختبار',
    initial,
    added,
    remaining,
    price,
    customers,
    open
  };
}

test('propagates corrected fuel counters through following shifts', () => {
  const result = buildCascadeUpdates({
    sourceShift: shift({
      fuel_data: {
        diesel: diesel({ first: 100, last: 150, price: 10 })
      }
    }),
    followingShifts: [
      shift({
        date: '2026-07-01',
        shift_number: 2,
        fuel_data: {
          diesel: diesel({ first: 120, last: 180, price: 10, clients: 5, cars: 2 })
        }
      }),
      shift({
        date: '2026-07-02',
        shift_number: 1,
        fuel_data: {
          diesel: diesel({ first: 170, last: 230, price: 10 })
        }
      })
    ]
  });

  assert.deepEqual(result.validationErrors, []);
  assert.equal(result.updates.length, 2);
  assert.equal(result.updates[0].shift.fuel_data.diesel.firstShift1, 150);
  assert.equal(result.updates[0].shift.fuel_data.diesel.lastShift1, 180);
  assert.equal(result.updates[0].shift.fuel_data.diesel.quantity1, 30);
  assert.equal(result.updates[0].shift.fuel_data.diesel.totalQuantity, 30);
  assert.equal(result.updates[0].shift.fuel_data.diesel.cash, 230);
  assert.equal(result.updates[0].shift.fuel_total, 230);
  assert.equal(result.updates[1].shift.fuel_data.diesel.firstShift1, 180);
  assert.equal(result.updates[1].shift.fuel_data.diesel.quantity1, 50);
  assert.equal(result.updates[1].shift.grand_total, 500);
});

test('propagates oil remaining balance and recalculates oil totals', () => {
  const result = buildCascadeUpdates({
    sourceShift: shift({
      oil_data: {
        oil_test: oil({ initial: 8, added: 1, remaining: 4, price: 20 })
      }
    }),
    followingShifts: [
      shift({
        date: '2026-07-01',
        shift_number: 2,
        oil_data: {
          oil_test: oil({ initial: 2, added: 3, remaining: 5, price: 20, customers: 1, open: 0.5 })
        },
        wash_lube_revenue: 10,
        total_expenses: 5
      })
    ]
  });

  const updatedOil = result.updates[0].shift.oil_data.oil_test;
  assert.deepEqual(result.validationErrors, []);
  assert.equal(updatedOil.initial, 4);
  assert.equal(updatedOil.added, 3);
  assert.equal(updatedOil.remaining, 5);
  assert.equal(updatedOil.total, 7);
  assert.equal(updatedOil.sold, 2);
  assert.equal(updatedOil.revenue, 10);
  assert.equal(result.updates[0].shift.oil_total, 10);
  assert.equal(result.updates[0].shift.grand_total, 15);
});

test('stops before a following shift with manual reset history', () => {
  const result = buildCascadeUpdates({
    sourceShift: shift({
      fuel_data: {
        diesel: diesel({ first: 100, last: 150 })
      }
    }),
    followingShifts: [
      shift({
        date: '2026-07-01',
        shift_number: 2,
        fuel_data: {
          diesel: diesel({ first: 120, last: 180 })
        }
      }),
      shift({
        date: '2026-07-02',
        shift_number: 1,
        fuel_data: {
          diesel: diesel({ first: 180, last: 230 })
        }
      })
    ],
    resetShiftKeys: new Set(['2026-07-01|2'])
  });

  assert.equal(result.updates.length, 0);
  assert.deepEqual(result.stopped_at, { date: '2026-07-01', shift_number: 2 });
  assert.equal(result.stopped_reason, 'manual_reset');
});

test('reports validation errors for counters below propagated starts', () => {
  const result = buildCascadeUpdates({
    sourceShift: shift({
      fuel_data: {
        diesel: diesel({ first: 100, last: 250 })
      }
    }),
    followingShifts: [
      shift({
        date: '2026-07-01',
        shift_number: 2,
        fuel_data: {
          diesel: diesel({ first: 120, last: 200 })
        }
      })
    ]
  });

  assert.equal(result.validationErrors.length, 1);
  assert.match(result.validationErrors[0], /آخر الوردية/);
});

test('reports validation errors for oil remaining above recalculated total', () => {
  const result = buildCascadeUpdates({
    sourceShift: shift({
      oil_data: {
        oil_test: oil({ initial: 20, remaining: 10 })
      }
    }),
    followingShifts: [
      shift({
        date: '2026-07-01',
        shift_number: 2,
        oil_data: {
          oil_test: oil({ initial: 1, added: 0, remaining: 11 })
        }
      })
    ]
  });

  assert.equal(result.validationErrors.length, 1);
  assert.match(result.validationErrors[0], /المتبقية/);
});
