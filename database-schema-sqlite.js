/**
 * SQLite Database Schema
 * Mirror of PostgreSQL schema adapted for SQLite
 */

const Database = require('better-sqlite3');

class DatabaseSchema {
  /**
   * Initialize SQLite database with all tables
   * @param {Database} db - SQLite database instance
   */
  static initialize(db) {
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Create all tables
    this.createSalesTable(db);
    this.createPurchasePricesTable(db);
    this.createProductsTable(db);
    this.createPriceHistoryTable(db);
    this.createOilMovementsTable(db);
    this.createFuelMovementsTable(db);
    this.createFuelInvoicesTable(db);
    this.createOilInvoicesTable(db);
    this.createCustomersTable(db);
    this.createShiftsTable(db);
    this.createSyncQueueTable(db);

    // Create indexes for performance
    this.createIndexes(db);

    console.log('SQLite schema initialized successfully');
  }

  static createSalesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        fuel_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        price_per_liter REAL NOT NULL,
        total_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        customer_name TEXT,
        notes TEXT
      )
    `);
  }

  static createPurchasePricesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuel_type TEXT NOT NULL UNIQUE,
        price REAL NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Insert default values if table is empty
    const count = db.prepare('SELECT COUNT(*) as count FROM purchase_prices').get();
    if (count.count === 0) {
      const insert = db.prepare(`
        INSERT INTO purchase_prices (fuel_type, price) VALUES (?, ?)
      `);
      insert.run('بنزين ٨٠', 8.00);
      insert.run('بنزين ٩٢', 10.00);
      insert.run('بنزين ٩٥', 11.00);
      insert.run('سولار', 7.00);
    }
  }

  static createProductsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL UNIQUE,
        current_price REAL NOT NULL DEFAULT 0,
        vat REAL DEFAULT 0,
        effective_date TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createPriceHistoryTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL,
        price REAL NOT NULL,
        start_date TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createOilMovementsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oil_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oil_type TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        invoice_number TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createFuelMovementsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fuel_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuel_type TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        invoice_number TEXT,
        notes TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createFuelInvoicesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fuel_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        fuel_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        net_quantity REAL,
        purchase_price REAL NOT NULL,
        sale_price REAL NOT NULL,
        total REAL NOT NULL,
        profit REAL,
        invoice_total REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createOilInvoicesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oil_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        oil_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        purchase_price REAL NOT NULL,
        iva REAL NOT NULL,
        total_purchase REAL NOT NULL,
        immediate_discount REAL,
        martyrs_tax REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createCustomersTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createShiftsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        shift_number INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(date, shift_number)
      )
    `);
  }

  static createSyncQueueTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id TEXT,
        operation TEXT NOT NULL,
        data TEXT,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        error TEXT,
        retry_count INTEGER DEFAULT 0
      )
    `);
  }

  static createIndexes(db) {
    // Sales indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_fuel_type ON sales(fuel_type)');

    // Products indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active)');

    // Movements indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_oil_movements_date ON oil_movements(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_fuel_movements_date ON fuel_movements(date)');

    // Invoices indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_fuel_invoices_date ON fuel_invoices(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_oil_invoices_date ON oil_invoices(date)');

    // Shifts indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date)');

    // Sync queue indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name)');
  }
}

module.exports = DatabaseSchema;
