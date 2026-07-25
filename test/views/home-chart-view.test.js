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

test('builds home chart purchases from incoming fuel movements only', () => {
  const result = buildHomeChartData({
    mode: 'purchases',
    fuelMovements: [
      { date: '2026-07-01', fuel_type: 'بنزين ٨٠', type: 'in', quantity: 100 },
      { date: '2026-07-02', fuel_type: 'بنزين ٨٠', type: 'out', quantity: 50 }
    ]
  });

  assert.deepEqual(result.entries, [
    { date: '2026-07-01', fuel_type: 'بنزين ٨٠', quantity: 100 }
  ]);
});
