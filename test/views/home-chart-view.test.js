const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHomeChartData } = require('../../src/accounting/home-chart-view');

test('builds home chart sales from manual sales and saved shifts', () => {
  const result = buildHomeChartData({
    mode: 'sales',
    sales: [
      { date: '2026-07-01', fuel_type: 'بنزين 92', quantity: 10 },
      { date: '2026-07-01', fuel_type: 'بنزين ٩٢', quantity: 4 },
      { date: '2026-07-01', fuel_type: 'منتج آخر', quantity: 99 }
    ],
    shifts: [
      {
        date: '2026-07-02',
        fuel_data: {
          diesel: {
            product_name: 'سولار',
            totalQuantity: 50,
            cars: 3
          }
        }
      }
    ]
  });

  assert.deepEqual(result.entries, [
    { date: '2026-07-01', fuel_type: 'بنزين ٩٢', quantity: 14 },
    { date: '2026-07-02', fuel_type: 'سولار', quantity: 47 }
  ]);
});

test('builds home chart purchases from finalized monthly accounting fuel rows', () => {
  const result = buildHomeChartData({
    mode: 'purchases',
    fuelMovements: [
      { date: '2026-07-01', fuel_type: 'بنزين ٨٠', type: 'in', quantity: 999 }
    ],
    monthlyAccountingDocuments: [
      {
        is_final: 1,
        final_data: {
          month_key: '2026-07',
          fuel_purchase_rows: [
            { date: '2026-07-01', fuel_type: 'بنزين ٨٠', quantity: 100, purchase_price: 10 },
            { date: '2026-07-01', fuel_type: 'بنزين ٨٠', quantity: 25, purchase_price: 11 },
            { date: '2026-07-02', fuel_type: 'سولار', quantity: 50, purchase_price: 12 },
            { date: '2026-07-02', fuel_type: 'غاز سيارات', quantity: 30, purchase_price: 7 }
          ]
        }
      },
      {
        is_final: 0,
        final_data: {
          month_key: '2026-07',
          fuel_purchase_rows: [
            { date: '2026-07-03', fuel_type: 'بنزين ٩٢', quantity: 999, purchase_price: 10 }
          ]
        }
      }
    ]
  });

  assert.deepEqual(result.entries, [
    { date: '2026-07-01', fuel_type: 'بنزين ٨٠', quantity: 125 },
    { date: '2026-07-02', fuel_type: 'سولار', quantity: 50 }
  ]);
});
