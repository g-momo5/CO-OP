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

test('calculates oil invoice total with value added tax, discount and martyrs tax', () => {
  const totals = calculateOilInvoiceTotals([
    { oil_type: 'زيت أ', quantity: 5, total_purchase: 100, iva: 14, immediate_discount: 10, martyrs_tax: 3 },
    { oil_type: 'زيت ب', quantity: 2, total_purchase: 40, iva: 14, immediate_discount: 10, martyrs_tax: 3 }
  ]);

  assert.deepEqual(totals, {
    subtotal: 140,
    immediate_discount: 10,
    value_added_tax: 18.2,
    martyrs_tax: 3,
    invoice_total: 151.2,
    value_added_tax_rate: 14
  });
});

test('skips value added tax when oil rows have different tax rates', () => {
  const totals = calculateOilInvoiceTotals([
    { oil_type: 'زيت أ', quantity: 5, total_purchase: 100, iva: 14, immediate_discount: 0, martyrs_tax: 0 },
    { oil_type: 'زيت ب', quantity: 2, total_purchase: 40, iva: 5, immediate_discount: 0, martyrs_tax: 0 }
  ]);

  assert.equal(totals.value_added_tax, 0);
  assert.equal(totals.invoice_total, 140);
  assert.equal(totals.value_added_tax_rate, null);
});

test('uses the shared oil tax rate from invoice rows', () => {
  const totals = calculateOilInvoiceTotals([
    { oil_type: 'منتج أ', quantity: 2, total_purchase: 100, iva: 5, immediate_discount: 0, martyrs_tax: 0 },
    { oil_type: 'منتج ب', quantity: 1, total_purchase: 50, iva: 5, immediate_discount: 0, martyrs_tax: 0 }
  ]);

  assert.equal(totals.value_added_tax, 7.5);
  assert.equal(totals.invoice_total, 157.5);
  assert.equal(totals.value_added_tax_rate, 5);
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
