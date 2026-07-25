const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateShiftTotals,
  validateShiftAccounting
} = require('../../src/accounting/shift-accounting');

test('calculates full shift accounting total', () => {
  const result = calculateShiftTotals({
    date: '2026-07-10',
    shift_number: 1,
    fuel_data: {
      diesel: {
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
      }
    },
    oil_data: {
      oil_a: {
        product_name: 'زيت أ',
        initial: 10,
        added: 5,
        remaining: 9,
        customers: 2,
        open: 1,
        price: 20
      }
    },
    wash_lube_revenue: 40,
    revenue_items: [{ description: 'إيراد إضافي', amount: 25 }],
    customer_payments: [{ customer_name: 'عميل', amount: 100 }],
    expense_items: [
      { description: 'مصروف ١', amount: 50 },
      { description: 'مصروف ٢', amount: 20 }
    ]
  });

  assert.equal(result.totals.fuel_total, 980);
  assert.equal(result.totals.oil_total, 60);
  assert.equal(result.totals.total_revenue, 1205);
  assert.equal(result.totals.total_expenses, 70);
  assert.equal(result.totals.grand_total, 1135);
});

test('validates fuel and oil accounting together', () => {
  const errors = validateShiftAccounting({
    fuel_data: {
      diesel: { product_name: 'سولار', firstShift1: 10, lastShift1: 5, price: 10 }
    },
    oil_data: {
      oil_a: { product_name: 'زيت أ', initial: 1, added: 0, remaining: 0, open: 2, price: 10 }
    }
  });

  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /آخر الوردية/);
  assert.match(errors.join('\n'), /مفتوح/);
});
