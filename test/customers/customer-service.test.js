const test = require('node:test');
const assert = require('node:assert/strict');

const { CustomerService } = require('../../src/customer-service');

function createService() {
  const customers = [];
  let nextId = 1;

  const service = new CustomerService({
    query: async (sql, params = []) => {
      if (sql.includes('WHERE name = $1')) {
        return customers.filter((customer) => customer.name === params[0]).slice(0, 1);
      }
      if (sql.includes('WHERE id = $1')) {
        const customer = customers.find((item) => item.id === params[0]);
        if (!customer) return [];
        if (sql.includes('COALESCE(is_active, 1) = 1') && customer.is_active !== 1) return [];
        return [customer];
      }
      if (sql.includes('COALESCE(is_active, 1) = 1')) {
        return customers.filter((customer) => customer.is_active === 1);
      }
      return [...customers];
    },
    update: async (sql, params = []) => {
      if (sql.includes('SET is_active = 1')) {
        const customer = customers.find((item) => item.id === params[0]);
        if (!customer) return 0;
        customer.is_active = 1;
        return 1;
      }
      if (sql.includes('SET is_active = 0')) {
        const customer = customers.find((item) => item.id === params[0] && item.is_active === 1);
        if (!customer) return 0;
        customer.is_active = 0;
        return 1;
      }
      return 0;
    },
    insert: async (_sql, params = []) => {
      const customer = { id: nextId, name: params[0], is_active: 1 };
      nextId += 1;
      customers.push(customer);
      return customer.id;
    }
  });

  return { customers, service };
}

test('archiving a customer hides it without deleting historical identity', async () => {
  const { customers, service } = createService();

  const customerId = Number(await service.add({ name: 'عميل تجريبي' }));
  const archiveResult = await service.archive({ id: customerId });

  assert.equal(archiveResult.archived, true);
  assert.deepEqual(await service.listActive(), []);
  assert.deepEqual(
    customers.find((customer) => customer.id === customerId),
    { id: customerId, name: 'عميل تجريبي', is_active: 0 }
  );
});

test('adding an archived customer reactivates the same record', async () => {
  const { customers, service } = createService();

  const originalId = Number(await service.add({ name: 'عميل تجريبي' }));
  await service.archive({ id: originalId });
  const reactivatedId = Number(await service.add({ name: '  عميل   تجريبي  ' }));

  assert.equal(reactivatedId, originalId);
  assert.equal((await service.listActive()).length, 1);
  assert.equal(customers.length, 1);
});
