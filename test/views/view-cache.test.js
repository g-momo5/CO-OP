const test = require('node:test');
const assert = require('node:assert/strict');

const { TimedViewCache } = require('../../src/accounting/view-cache');

test('deduplicates in-flight view loads and caches result', async () => {
  const cache = new TimedViewCache({ ttlMs: 1_000 });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { value: calls };
  };

  const [first, second] = await Promise.all([
    cache.getOrSet('key', loader),
    cache.getOrSet('key', loader)
  ]);
  const third = await cache.getOrSet('key', loader);

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.deepEqual(third, { value: 1 });
  assert.equal(calls, 1);
});

test('clears cached view data after invalidation', async () => {
  const cache = new TimedViewCache({ ttlMs: 1_000 });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await cache.getOrSet('key', loader), 1);
  cache.clear();
  assert.equal(await cache.getOrSet('key', loader), 2);
});
