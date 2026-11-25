async function withPostgresTransaction(pool, work) {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query('BEGIN');
    const result = await work({
      query: async (sql, params) => (await client.query(sql, params)).rows,
      update: async (sql, params) => (await client.query(sql, params)).rowCount,
      insert: async (sql, params) => {
        const result = await client.query(sql, params);
        return result.rows[0]?.id ?? result.rowCount;
      }
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

module.exports = { withPostgresTransaction };
