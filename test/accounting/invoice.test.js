const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateFuelInvoiceTotals,
  calculateFuelStock,
  calculateOilInvoiceTotals,
  calculateOilStock
} = require('../../src/accounting/invoice-accounting');

test('calculates fuel invoice totals and prefers net quantity', () => {
  const totals = calculateFuelInvoiceTotals([
    { fuel_type: 'سولار', quantity: 100, net_quantity: 98, total: 300, invoice_total: 650 },
    { fuel_type: 'بنزين ٨٠', quantity: 50, total: 320, invoice_total: 650 }
  ]);

  assert.equal(totals.rows_total, 620);
  assert.equal(totals.invoice_total, 650);
  assert.equal(totals.cash_insurance, 30);
  assert.equal(totals.quantity, 148);
});

test('calculates oil invoice total with discount and martyrs tax', () => {
  const totals = calculateOilInvoiceTotals([
    { oil_type: 'زيت أ', quantity: 5, total_purchase: 100, immediate_discount: 10, martyrs_tax: 3 },
    { oil_type: 'زيت ب', quantity: 2, total_purchase: 40, immediate_discount: 10, martyrs_tax: 3 }
  ]);

  assert.deepEqual(totals, {
    subtotal: 140,
    immediate_discount: 10,
    martyrs_tax: 3,
    invoice_total: 133
  });
});

test('calculates fuel stock after shift sales', () => {
  const rows = calculateFuelStock({
    fuelInvoices: [
      { fuel_type: 'سولار', quantity: 200, net_quantity: 195 }
    ],
    shifts: [
      { fuel_data: { diesel: { product_name: 'سولار', totalQuantity: 40, cars: 5 } } }
    ]
  });

  assert.equal(rows[0].incoming, 195);
  assert.equal(rows[0].outgoing, 35);
  assert.equal(rows[0].balance, 160);
});

test('calculates oil stock from invoices, movements, and shifts', () => {
  const rows = calculateOilStock({
    oilInvoices: [
      { oil_type: 'زيت أ', quantity: 10 }
    ],
    oilMovements: [
      { oil_type: 'زيت أ', type: 'in', quantity: 2 },
      { oil_type: 'زيت أ', type: 'out', quantity: 1 }
    ],
    shifts: [
      { oil_data: { oil_a: { product_name: 'زيت أ', sold: 3 } } }
    ]
  });

  assert.equal(rows[0].incoming, 12);
  assert.equal(rows[0].outgoing, 4);
  assert.equal(rows[0].balance, 8);
});
