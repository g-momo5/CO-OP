const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMonthlySalesSummary } = require('../../src/accounting/monthly-sales-summary');

test('builds monthly sales summary from shifts and manual sales', () => {
  const summary = buildMonthlySalesSummary({
    fromMonth: '2026-07',
    toMonth: '2026-08',
    products: [
      { product_type: 'fuel', product_name: 'سولار' },
      { product_type: 'fuel', product_name: 'بنزين ٨٠' },
      { product_type: 'oil', product_name: 'زيت أ' }
    ],
    shifts: [
      {
        date: '2026-07-10',
        shift_number: 1,
        fuel_data: {
          diesel: { product_name: 'سولار', totalQuantity: 100, cars: 5 }
        },
        oil_data: {
          oil_a: { product_name: 'زيت أ', sold: 3 }
        }
      },
      {
        date: '2026-08-01',
        shift_number: 1,
        fuel_data: {
          diesel: { product_name: 'سولار', totalQuantity: 40 }
        }
      }
    ],
    manualSales: [
      { date: '2026-07-11', fuel_type: 'خدمة', quantity: 2 }
    ]
  });

  const rows = new Map(summary.rows.map((row) => [row.name, row]));
  assert.deepEqual(summary.months, ['2026-07', '2026-08']);
  assert.equal(rows.get('سولار').byMonth['2026-07'], 95);
  assert.equal(rows.get('سولار').byMonth['2026-08'], 40);
  assert.equal(rows.get('زيت أ').byMonth['2026-07'], 3);
  assert.equal(rows.get('بنزين ٨٠').total, 0);
  assert.equal(rows.get('خدمة').type, 'other');
  assert.equal(rows.get('خدمة').total, 2);
});
