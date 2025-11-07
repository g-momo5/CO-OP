/**
 * Database Manager - Unified database access layer
 * Handles both PostgreSQL (online) and SQLite (offline) databases
 */

const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const DatabaseSchema = require('./database-schema-sqlite');

class DatabaseManager {
  constructor(app) {
    this.app = app;
    this.isOnline = false;
    this.pgPool = null;
    this.sqlite = null;
    this.sqlitePath = null;
    this.lastSyncTime = null;
    this.connectionString = 'postgresql://postgres.ihajlcodsypvjwfnkcjc:Ghaly1997.@aws-1-eu-west-2.pooler.supabase.com:6543/postgres';
  }

  /**
   * Initialize both PostgreSQL and SQLite databases
   * @param {number} timeout - Connection timeout in milliseconds
   */
  async initialize(timeout = 5000) {
    console.log('Initializing DatabaseManager...');

    // Always initialize SQLite first (for offline fallback)
    await this.initializeSQLite();

    // Try to connect to PostgreSQL with timeout
    try {
      const connectionPromise = this.initializePostgreSQL();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      await Promise.race([connectionPromise, timeoutPromise]);
      this.isOnline = true;
      console.log('DatabaseManager initialized in ONLINE mode');

      // Initial sync: download all data from PostgreSQL to SQLite
      await this.initialSync();
    } catch (error) {
      console.warn('PostgreSQL connection failed, using OFFLINE mode:', error.message);
      this.isOnline = false;
      console.log('DatabaseManager initialized in OFFLINE mode');
    }

    return { online: this.isOnline };
  }

  /**
   * Initialize SQLite database
   */
  async initializeSQLite() {
    try {
      const userDataPath = this.app.getPath('userData');
      this.sqlitePath = path.join(userDataPath, 'coop_local.db');

      // Ensure directory exists
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      // Open SQLite database
      this.sqlite = new Database(this.sqlitePath);

      // Enable WAL mode for better concurrency
      this.sqlite.pragma('journal_mode = WAL');

      // Initialize schema
      DatabaseSchema.initialize(this.sqlite);

      // Run migrations to align with PostgreSQL schema
      DatabaseSchema.migrateExistingDatabase(this.sqlite);

      console.log('SQLite initialized at:', this.sqlitePath);
    } catch (error) {
      console.error('Failed to initialize SQLite:', error);
      throw error;
    }
  }

  /**
   * Initialize PostgreSQL connection pool
   */
  async initializePostgreSQL() {
    this.pgPool = new Pool({
      connectionString: this.connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      query_timeout: 30000,
      statement_timeout: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    });

    // Handle pool errors
    this.pgPool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
      this.isOnline = false;
    });

    // Test connection
    const client = await this.pgPool.connect();
    console.log('Connected to PostgreSQL/Supabase');
    client.release();
  }

  /**
   * Check if we're currently online
   */
  async checkConnection() {
    if (!this.pgPool) return false;

    try {
      const client = await this.pgPool.connect();
      client.release();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert PostgreSQL parameterized query to SQLite format
   * @param {string} sql - SQL query with $1, $2... placeholders
   * @param {Array} params - Query parameters
   */
  convertPgToSqlite(sql, params) {
    // Replace $1, $2, etc. with ?
    let sqliteSql = sql;
    for (let i = params.length; i >= 1; i--) {
      sqliteSql = sqliteSql.replace(new RegExp(`\\$${i}\\b`, 'g'), '?');
    }

    // Replace PostgreSQL specific functions
    sqliteSql = sqliteSql.replace(/CURRENT_TIMESTAMP/gi, "strftime('%s', 'now')");
    sqliteSql = sqliteSql.replace(/NOW\(\)/gi, "strftime('%s', 'now')");

    // Remove RETURNING clause (SQLite doesn't support it)
    sqliteSql = sqliteSql.replace(/RETURNING\s+\w+/gi, '');

    return sqliteSql;
  }

  /**
   * Execute SELECT query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   */
  async executeQuery(sql, params = []) {
    // Try online first
    if (this.isOnline && this.pgPool) {
      try {
        const result = await this.executeWithRetry(async () => {
          return await this.pgPool.query(sql, params);
        });
        return result.rows;
      } catch (error) {
        console.warn('PostgreSQL query failed, falling back to SQLite:', error.message);
        this.isOnline = false;
      }
    }

    // Use SQLite
    return this.executeSQLiteQuery(sql, params);
  }

  /**
   * Execute UPDATE or DELETE query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   */
  async executeUpdate(sql, params = []) {
    // Try online first
    if (this.isOnline && this.pgPool) {
      try {
        const result = await this.executeWithRetry(async () => {
          return await this.pgPool.query(sql, params);
        });
        return result.rowCount;
      } catch (error) {
        console.warn('PostgreSQL update failed, falling back to SQLite:', error.message);
        this.isOnline = false;
      }
    }

    // Use SQLite and track in sync queue
    const rowCount = this.executeSQLiteUpdate(sql, params);

    // Add to sync queue if offline
    if (!this.isOnline) {
      this.addToSyncQueue('unknown', 'UPDATE', { sql, params });
    }

    return rowCount;
  }

  /**
   * Execute INSERT query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @param {string} tableName - Table name for sync tracking
   */
  async executeInsert(sql, params = [], tableName = 'unknown') {
    // Try online first
    if (this.isOnline && this.pgPool) {
      try {
        const result = await this.executeWithRetry(async () => {
          return await this.pgPool.query(sql, params);
        });
        return result.rows[0] ? result.rows[0].id : result.rowCount;
      } catch (error) {
        console.warn('PostgreSQL insert failed, falling back to SQLite:', error.message);
        this.isOnline = false;
      }
    }

    // Use SQLite and track in sync queue
    const insertId = this.executeSQLiteInsert(sql, params);

    // Add to sync queue if offline
    if (!this.isOnline) {
      this.addToSyncQueue(tableName, 'INSERT', {
        id: insertId,
        sql,
        params
      });
    }

    return insertId;
  }

  /**
   * Execute SQLite query (SELECT)
   */
  executeSQLiteQuery(sql, params) {
    const sqliteSql = this.convertPgToSqlite(sql, params);

    try {
      const stmt = this.sqlite.prepare(sqliteSql);
      const rows = stmt.all(...params);
      return rows;
    } catch (error) {
      console.error('SQLite query error:', error);
      throw error;
    }
  }

  /**
   * Execute SQLite update/delete
   */
  executeSQLiteUpdate(sql, params) {
    const sqliteSql = this.convertPgToSqlite(sql, params);

    try {
      const stmt = this.sqlite.prepare(sqliteSql);
      const result = stmt.run(...params);
      return result.changes;
    } catch (error) {
      console.error('SQLite update error:', error);
      throw error;
    }
  }

  /**
   * Execute SQLite insert
   */
  executeSQLiteInsert(sql, params) {
    const sqliteSql = this.convertPgToSqlite(sql, params);

    try {
      const stmt = this.sqlite.prepare(sqliteSql);
      const result = stmt.run(...params);
      return result.lastInsertRowid;
    } catch (error) {
      console.error('SQLite insert error:', error);
      throw error;
    }
  }

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry(operation, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
      }
    }
    throw lastError;
  }

  /**
   * Add operation to sync queue
   */
  addToSyncQueue(tableName, operation, data) {
    try {
      const stmt = this.sqlite.prepare(`
        INSERT INTO sync_queue (table_name, operation, data, timestamp)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(
        tableName,
        operation,
        JSON.stringify(data),
        Date.now()
      );
    } catch (error) {
      console.error('Failed to add to sync queue:', error);
    }
  }

  /**
   * Get pending sync count
   */
  getPendingSyncCount() {
    try {
      const stmt = this.sqlite.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0');
      const result = stmt.get();
      return result.count;
    } catch (error) {
      console.error('Failed to get pending sync count:', error);
      return 0;
    }
  }

  /**
   * Initial sync: download all data from PostgreSQL to SQLite
   */
  async initialSync() {
    if (!this.isOnline || !this.pgPool) return;

    console.log('Starting initial sync from PostgreSQL to SQLite...');

    const tables = [
      'sales', 'purchase_prices', 'products', 'price_history',
      'oil_movements', 'fuel_movements', 'fuel_invoices', 'oil_invoices',
      'customers', 'shifts'
    ];

    for (const table of tables) {
      try {
        // Get all data from PostgreSQL
        const result = await this.pgPool.query(`SELECT * FROM ${table}`);

        if (result.rows.length === 0) continue;

        // Clear SQLite table
        this.sqlite.prepare(`DELETE FROM ${table}`).run();

        // Insert into SQLite
        const columns = Object.keys(result.rows[0]);
        const placeholders = columns.map(() => '?').join(',');
        const stmt = this.sqlite.prepare(
          `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
        );

        const insertMany = this.sqlite.transaction((rows) => {
          for (const row of rows) {
            const values = columns.map(col => {
              // Handle JSONB fields
              if (typeof row[col] === 'object' && row[col] !== null) {
                return JSON.stringify(row[col]);
              }
              // Handle timestamps
              if (row[col] instanceof Date) {
                return Math.floor(row[col].getTime() / 1000);
              }
              return row[col];
            });
            stmt.run(...values);
          }
        });

        insertMany(result.rows);
        console.log(`Synced ${result.rows.length} rows from ${table}`);
      } catch (error) {
        console.error(`Failed to sync table ${table}:`, error);
      }
    }

    this.lastSyncTime = Date.now();
    console.log('Initial sync completed');
  }

  /**
   * Close database connections
   */
  close() {
    if (this.pgPool) {
      this.pgPool.end();
    }
    if (this.sqlite) {
      this.sqlite.close();
    }
  }
}

module.exports = DatabaseManager;
