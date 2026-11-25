const { Pool } = require('pg');
const { withPostgresTransaction } = require('../src/postgres-transaction');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
    if (!connectionString) {
      const error = new Error('DATABASE_URL is not configured');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      query_timeout: 20000,
      statement_timeout: 20000
    });
    pool.on('error', (error) => console.error('Mobile database pool:', error.code || error.name));
  }
  return pool;
}

async function query(sql, params = []) {
  return (await getPool().query(sql, params)).rows;
}

function transaction(work) {
  return withPostgresTransaction(getPool(), work);
}

module.exports = { query, transaction };
