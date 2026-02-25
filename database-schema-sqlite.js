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
    this.createAnnualInventoriesTable(db);
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
        current_price REAL NOT NULL,
        vat REAL DEFAULT 0,
        effective_date TEXT,
        is_active INTEGER DEFAULT 1
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
        product_id INTEGER
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
        net_quantity REAL NOT NULL,
        purchase_price REAL NOT NULL,
        total REAL NOT NULL,
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
        immediate_discount REAL DEFAULT 0,
        martyrs_tax REAL DEFAULT 0,
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

  static createAnnualInventoriesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS annual_inventories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL UNIQUE,
        prev_balance REAL DEFAULT 0,
        station_profit REAL DEFAULT 0,
        bank_balance REAL DEFAULT 0,
        safe_balance REAL DEFAULT 0,
        accounting_remainder REAL DEFAULT 0,
        customers_balance REAL DEFAULT 0,
        vouchers_balance REAL DEFAULT 0,
        visa_balance REAL DEFAULT 0,
        expected_total REAL DEFAULT 0,
        actual_total REAL DEFAULT 0,
        difference REAL DEFAULT 0,
        expected_items TEXT DEFAULT '[]',
        actual_items TEXT DEFAULT '[]',
        status TEXT DEFAULT 'balanced',
        finalized INTEGER DEFAULT 0,
        finalized_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
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
    db.exec('CREATE INDEX IF NOT EXISTS idx_annual_inventories_year ON annual_inventories(year)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_annual_inventories_finalized ON annual_inventories(finalized)');

    // Sync queue indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name)');
  }

  /**
   * Migrate existing database to match PostgreSQL schema
   * @param {Database} db - SQLite database instance
   */
  static migrateExistingDatabase(db) {
    console.log('Checking for schema migrations...');

    try {
      // Check if product_id column exists in price_history
      const priceHistoryTableInfo = db.prepare("PRAGMA table_info(price_history)").all();
      const hasProductId = priceHistoryTableInfo.some(col => col.name === 'product_id');

      if (!hasProductId) {
        console.log('Adding product_id column to price_history table...');
        db.exec('ALTER TABLE price_history ADD COLUMN product_id INTEGER');
        console.log('Migration completed: product_id column added');
      }

      // Check if fuel_invoices has columns to remove (sale_price, profit, invoice_total)
      const fuelInvoicesTableInfo = db.prepare("PRAGMA table_info(fuel_invoices)").all();
      const hasSalePrice = fuelInvoicesTableInfo.some(col => col.name === 'sale_price');

      if (hasSalePrice) {
        console.log('Removing obsolete columns from fuel_invoices table...');

        // SQLite doesn't support DROP COLUMN, so we need to recreate the table
        db.exec(`
          -- Create new table with correct schema
          CREATE TABLE fuel_invoices_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            invoice_number TEXT NOT NULL,
            fuel_type TEXT NOT NULL,
            quantity REAL NOT NULL,
            net_quantity REAL NOT NULL,
            purchase_price REAL NOT NULL,
            total REAL NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
          );

          -- Copy data from old table
          INSERT INTO fuel_invoices_new (id, date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total, created_at)
          SELECT id, date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total, created_at
          FROM fuel_invoices;

          -- Drop old table
          DROP TABLE fuel_invoices;

          -- Rename new table
          ALTER TABLE fuel_invoices_new RENAME TO fuel_invoices;
        `);

        console.log('Migration completed: removed sale_price, profit, invoice_total from fuel_invoices');
      }

      const annualInventoriesTableInfo = db.prepare("PRAGMA table_info(annual_inventories)").all();
      const hasExpectedItems = annualInventoriesTableInfo.some(col => col.name === 'expected_items');
      const hasActualItems = annualInventoriesTableInfo.some(col => col.name === 'actual_items');

      if (!hasExpectedItems) {
        console.log('Adding expected_items column to annual_inventories table...');
        db.exec("ALTER TABLE annual_inventories ADD COLUMN expected_items TEXT DEFAULT '[]'");
      }

      if (!hasActualItems) {
        console.log('Adding actual_items column to annual_inventories table...');
        db.exec("ALTER TABLE annual_inventories ADD COLUMN actual_items TEXT DEFAULT '[]'");
      }

      console.log('Schema is up to date');
    } catch (error) {
      console.error('Migration error:', error);
      // Don't throw - allow app to continue if migration fails
    }
  }
}

module.exports = DatabaseSchema;
