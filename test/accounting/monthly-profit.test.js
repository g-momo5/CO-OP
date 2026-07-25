const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateMonthlyProfit } = require('../../src/accounting/monthly-profit');

test('calculates monthly profit from shifts, invoices, inputs, and custom rows', () => {
  const rows = calculateMonthlyProfit({
    fromMonth: '2026-07',
    toMonth: '2026-07',
    shifts: [
      {
        date: '2026-07-10',
        fuel_data: {
          diesel: { product_name: 'سولار', totalQuantity: 100, cars: 0, price: 10 },
          fuel80: { product_name: 'بنزين ٨٠', totalQuantity: 50, cars: 0, price: 8 }
        },
        oil_data: {
          oil_a: { product_name: 'زيت أ', sold: 10, open: 2, price: 20 }
        },
        wash_lube_revenue: 50,
        total_expenses: 30
      }
    ],
    fuelInvoices: [
      { date: '2026-07-03', invoice_number: 'F1', fuel_type: 'سولار', total: 300, invoice_total: 350 },
      { date: '2026-07-03', invoice_number: 'F1', fuel_type: 'بنزين ٨٠', total: 100, invoice_total: 350 }
    ],
    oilInvoices: [
      { date: '2026-07-04', invoice_number: 'O1', total_purchase: 80, immediate_discount: 10, martyrs_tax: 5 }
    ],
    monthlyInputs: [
      { month_key: '2026-07', bonuses: 20, commission_diff: 30, deposit_tax: 5, bonus_tax: 3 }
    ],
    customRows: [
      { row_key: 'extra', row_type: 'revenue' },
      { row_key: 'deduct', row_type: 'deduction' }
    ],
    customValues: [
      { row_key: 'extra', month_key: '2026-07', amount: 15 },
      { row_key: 'deduct', month_key: '2026-07', amount: 7 }
    ]
  });

  const july = rows[0];
  assert.equal(july.fuel_diesel, 700);
  assert.equal(july.fuel_80, 300);
  assert.equal(july.oil_total, 85);
  assert.equal(july.cash_insurance_month, -50);
  assert.equal(july.total_positive, 1200);
  assert.equal(july.total_deductions, -5);
  assert.equal(july.net_profit, 1205);
  assert.deepEqual(july.custom_values, { extra: 15, deduct: 7 });
});

test('uses manual monthly inputs when no shift revenue exists', () => {
  const rows = calculateMonthlyProfit({
    fromMonth: '2026-08',
    toMonth: '2026-08',
    monthlyInputs: [
      { month_key: '2026-08', fuel_diesel: 100, fuel_80: 50, oil_total: 25, bonuses: 10 }
    ]
  });

  assert.equal(rows[0].fuel_total_month, 150);
  assert.equal(rows[0].oil_total, 25);
  assert.equal(rows[0].net_profit, 185);
});
