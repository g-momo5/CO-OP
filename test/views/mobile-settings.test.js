const test = require('node:test');
const assert = require('node:assert/strict');
const { handleMobileSettingsRequest } = require('../../mobile-server/mobile-settings-core');

async function post(body, headers = { 'content-type': 'application/json' }) {
  const response = await handleMobileSettingsRequest({ method: 'POST', body, headers });
  return [response.statusCode, JSON.parse(response.body).error];
}

test('mobile settings restrict the supported sections, HTTP methods and write actions', async () => {
  const response = await handleMobileSettingsRequest({ method: 'DELETE' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET, POST');
  assert.equal(response.headers['Cache-Control'], 'no-store');

  const section = await handleMobileSettingsRequest({ query: { section: 'backup' } });
  assert.equal(section.statusCode, 404);
  assert.deepEqual(await post({ action: 'backup' }), [400, 'unknown_action']);
  assert.deepEqual(await post('action=add-customer', {}), [415, 'unsupported_content_type']);
  assert.deepEqual(await post('{'), [400, 'invalid_request']);
});

test('mobile settings reject invalid product and customer data before writing', async () => {
  const oil = { action: 'add-product', type: 'oil', name: 'زيت', price: '١٢٫٣٤' };
  assert.deepEqual(await post({ ...oil, vat: '١٠٠٫١' }), [400, 'invalid_vat']);
  assert.deepEqual(await post({ ...oil, price: '25abc' }), [400, 'invalid_price']);
  assert.deepEqual(await post({ ...oil, price: [25] }), [400, 'invalid_price']);
  assert.deepEqual(await post({ action: 'add-customer', name: ' ' }), [400, 'name_required']);
  assert.deepEqual(await post({ action: 'archive-customer', id: '12' }), [400, 'invalid_id']);
});

test('mobile settings validate the entire price batch first', async () => {
  const changes = [{ id: 3, salePrice: '١٢٫٣٤' }, { id: 4, purchasePrice: '٧,٨٩' }];
  const batch = { action: 'save-prices', date: '2026-11-25', changes };
  assert.deepEqual(await post({ ...batch, date: '2026-02-29' }), [400, 'invalid_date']);
  assert.deepEqual(await post({ ...batch, changes: [] }), [400, 'empty_prices']);
  assert.deepEqual(await post({ ...batch, changes: [...changes, { id: 4, salePrice: 15 }] }), [400, 'invalid_request']);
  assert.deepEqual(await post({ ...batch, changes: [...changes, { id: 5, salePrice: 0 }] }), [400, 'invalid_price']);
});
