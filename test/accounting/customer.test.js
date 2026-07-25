const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateCustomerBalance,
  calculateCustomerPayments,
  calculateCustomerShiftConsumption,
  filterCustomerEntries
} = require('../../src/accounting/customer-accounting');

test('extracts customer consumption and payments from a shift', () => {
  const shift = {
    date: '2026-07-05',
    shift_number: 1,
    data: JSON.stringify({
      customer_rows: [
        { customer_id: 10, name: 'عميل أ', diesel: 20, '80': 5 },
        { voucher: true, diesel: 7 }
      ],
      customer_payments: [
        { customer_id: 10, customer_name: 'عميل أ', amount: 200 }
      ]
    })
  };

  const consumptions = calculateCustomerShiftConsumption(shift);
  const payments = calculateCustomerPayments(shift);

  assert.equal(consumptions.length, 2);
  assert.equal(consumptions[0].quantity, 25);
  assert.equal(consumptions[1].voucher, true);
  assert.equal(payments[0].amount, 200);
});

test('calculates customer balance while excluding voucher consumption', () => {
  const consumptions = [
    { customer_id: 10, customer_name: 'عميل أ', amount: 500 },
    { voucher: true, amount: 1000 }
  ];
  const payments = [{ customer_id: 10, amount: 300 }];
  const balance = calculateCustomerBalance({ openingBalance: 100, consumptions, payments });

  assert.deepEqual(balance, {
    opening_balance: 100,
    consumption_total: 500,
    payment_total: 300,
    balance: 300
  });
});

test('filters customer entries by id or name', () => {
  const entries = [
    { date: '2026-07-02', customer_id: 2, customer_name: 'ب' },
    { date: '2026-07-01', customer_id: 1, customer_name: 'أ' }
  ];

  assert.deepEqual(filterCustomerEntries(entries, { id: 1 }).map((entry) => entry.customer_name), ['أ']);
  assert.deepEqual(filterCustomerEntries(entries, 'ب').map((entry) => entry.customer_id), [2]);
});
