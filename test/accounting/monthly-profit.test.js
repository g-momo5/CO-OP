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
      { date: '2026-07-03', invoice_number: 'F1', fuel_type: 'سولار', total: 99999, invoice_total: 99999 }
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
    ],
    monthlyAccountingDocuments: [
      {
        month_key: '2026-07',
        is_final: 1,
        final_data: {
          month_key: '2026-07',
          debit_rows: [
            { label: 'جملة مسحوبات المواد البترولية', amount: 450 }
          ],
          fuel_purchase_rows: [
            { date: '2026-07-03', fuel_type: 'سولار', quantity: 30, purchase_price: 10 },
            { date: '2026-07-03', fuel_type: 'بنزين ٨٠', quantity: 10, purchase_price: 10 }
          ]
        }
      }
    ]
  });

  const july = rows[0];
  assert.equal(july.fuel_diesel, 700);
  assert.equal(july.fuel_80, 300.5);
  assert.equal(july.oil_total, 85);
  assert.equal(july.cash_insurance_month, 50.5);
  assert.equal(july.total_positive, 1150.5);
  assert.equal(july.total_deductions, 87.5);
  assert.equal(july.net_profit, 1063);
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
  assert.equal(rows[0].net_profit, 175);
});

test('imports finalized monthly accounting rows into profit totals', () => {
  const rows = calculateMonthlyProfit({
    fromMonth: '2026-06',
    toMonth: '2026-06',
    monthlyInputs: [
      { month_key: '2026-06', fuel_diesel: 100, oil_total: 25 }
    ],
    monthlyAccountingDocuments: [
      {
        month_key: '2026-06',
        is_final: 1,
        final_data: {
          month_key: '2026-06',
          debit_rows: [
            { label: 'جملة مسحوبات المواد البترولية', amount: 999 },
            { label: 'جملة مسحوبات الزيوت', amount: 888 },
            { label: 'ضرائب المنبع', amount: 12 },
            { label: 'خصم محاسبي', amount: 8 }
          ],
          credit_rows: [
            { label: 'جملة النقدية والشيكات للمواد البترولية', amount: 777 },
            { label: 'جملة حوافظ التسليمات', amount: 666 },
            { label: 'زيادة محاسبة شهر ٢٠٢٦ / ٥', amount: 555, auto: true },
            { label: 'إيراد محاسبي', amount: 30 }
          ]
        }
      }
    ]
  });

  const june = rows[0];
  assert.equal(june.custom_revenue_total, 30);
  assert.equal(june.custom_deduction_total, 20);
  assert.equal(june.total_positive, 155);
  assert.equal(june.total_deductions, 20);
  assert.equal(june.net_profit, 135);
  assert.equal(Object.values(june.accounting_values).reduce((sum, value) => sum + value, 0), 50);
});

test('ignores draft monthly accounting documents in profit totals', () => {
  const rows = calculateMonthlyProfit({
    fromMonth: '2026-06',
    toMonth: '2026-06',
    monthlyInputs: [
      { month_key: '2026-06', fuel_diesel: 100 }
    ],
    monthlyAccountingDocuments: [
      {
        month_key: '2026-06',
        is_final: 0,
        final_data: {
          month_key: '2026-06',
          credit_rows: [{ label: 'إيراد غير نهائي', amount: 999 }]
        }
      }
    ]
  });

  assert.equal(rows[0].custom_revenue_total, 0);
  assert.equal(rows[0].net_profit, 100);
});

test('does not subtract old fuel invoices when finalized accounting fuel rows are absent', () => {
  const rows = calculateMonthlyProfit({
    fromMonth: '2026-09',
    toMonth: '2026-09',
    shifts: [
      {
        date: '2026-09-10',
        fuel_data: {
          diesel: { product_name: 'سولار', totalQuantity: 100, cars: 0, price: 10 }
        }
      }
    ],
    fuelInvoices: [
      { date: '2026-09-03', invoice_number: 'F1', fuel_type: 'سولار', total: 900, invoice_total: 950 }
    ],
    monthlyAccountingDocuments: [
      {
        month_key: '2026-09',
        is_final: 1,
        final_data: {
          month_key: '2026-09',
          debit_rows: [{ label: 'جملة مسحوبات المواد البترولية', amount: 0 }]
        }
      }
    ]
  });

  assert.equal(rows[0].fuel_diesel, 1000);
  assert.equal(rows[0].cash_insurance_month, 0);
  assert.equal(rows[0].net_profit, 1000);
});
