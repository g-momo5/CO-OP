const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSalesSummaryView } = require('../../src/accounting/sales-summary-view');

test('builds monthly sales summary from shifts and extra manual products', () => {
  const view = buildSalesSummaryView({
    fromMonth: '2026-07',
    toMonth: '2026-08',
    fuelProducts: [{ fuel_type: 'سولار' }],
    oilProducts: [{ oil_type: 'زيت اختبار' }],
    shifts: [
      {
        date: '2026-07-01',
        fuel_data: {
          diesel: { product_name: 'سولار', totalQuantity: 100, cars: 5 }
        },
        oil_data: {
          oil: { product_name: 'زيت اختبار', sold: 3 }
        }
      }
    ],
    manualSales: [
      { date: '2026-07-02', fuel_type: 'غسيل', quantity: 2, total_amount: 20 },
      { date: '2026-07-02', fuel_type: 'سولار', quantity: 999, total_amount: 999 }
    ]
  });

  const byProduct = new Map(view.rows.map((row) => [row.product, row]));
  assert.equal(byProduct.get('سولار').byMonth['2026-07'], 95);
  assert.equal(byProduct.get('زيت اختبار').byMonth['2026-07'], 3);
  assert.equal(byProduct.get('غسيل').byMonth['2026-07'], 2);
  assert.equal(view.detail_sales.length, 3);
});

test('keeps manual fuel sales when no shift sales exist', () => {
  const view = buildSalesSummaryView({
    fromMonth: '2026-07',
    toMonth: '2026-07',
    fuelProducts: [{ fuel_type: 'سولار' }],
    oilProducts: [],
    shifts: [],
    manualSales: [
      { date: '2026-07-02', fuel_type: 'سولار', quantity: 25, total_amount: 250 }
    ]
  });

  const diesel = view.rows.find((row) => row.product === 'سولار');
  assert.equal(diesel.byMonth['2026-07'], 25);
  assert.equal(view.detail_sales.length, 1);
});
