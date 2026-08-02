const test = require('node:test');
const assert = require('node:assert/strict');

const SchemaMigrator = require('../../src/database-migration');

test('schema migrator strips PostgreSQL casts from SQLite defaults', () => {
  const migrator = new SchemaMigrator(null, null, '');

  assert.equal(
    migrator.mapPostgreSQLDefaultToSQLite('CURRENT_TIMESTAMP::text'),
    "(strftime('%s', 'now'))"
  );
  assert.equal(migrator.mapPostgreSQLDefaultToSQLite("'operator'::text"), "'operator'");
  assert.equal(migrator.mapPostgreSQLDefaultToSQLite('true'), '1');
});
