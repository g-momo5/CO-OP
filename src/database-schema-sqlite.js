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
    this.createPurchasePriceHistoryTable(db);
    this.createOilMovementsTable(db);
    this.createFuelMovementsTable(db);
    this.createFuelInvoicesTable(db);
    this.createOilInvoicesTable(db);
    this.createCustomersTable(db);
    this.createCustomerBalanceAdjustmentsTable(db);
    this.createShiftsTable(db);
    this.createAnnualInventoriesTable(db);
    this.createCompanyVoucherSettlementsTable(db);
    this.createSafeBookMovementsTable(db);
    this.createShiftBalanceChangeHistoryTable(db);
    this.createShiftCorrectionsTable(db);
    this.createMonthlyProfitInputsTable(db);
    this.createMonthlyProfitCustomRowsTable(db);
    this.createMonthlyProfitCustomValuesTable(db);
    this.createAppUsersTable(db);
    this.createAppDevicesTable(db);
    this.createLandTables(db);
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
        product_code TEXT,
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
        product_code TEXT,
        fuel_type TEXT NOT NULL UNIQUE,
        price REAL NOT NULL,
        effective_date TEXT,
        product_id INTEGER,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

  }

  static createAppDevicesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_devices (
        device_id TEXT PRIMARY KEY,
        system_name TEXT NOT NULL,
        display_name TEXT,
        app_version TEXT NOT NULL,
        platform TEXT,
        arch TEXT,
        first_seen_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_opened_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createAppUsersTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operator',
        password_hash TEXT,
        password_salt TEXT,
        avatar_type TEXT NOT NULL DEFAULT 'initial',
        avatar_value TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const tableInfo = db.prepare("PRAGMA table_info(app_users)").all();
    const ensureColumn = (columnName, definition) => {
      if (!tableInfo.some(col => col.name === columnName)) {
        db.exec(`ALTER TABLE app_users ADD COLUMN ${columnName} ${definition}`);
      }
    };

    ensureColumn('username', 'TEXT');
    ensureColumn('display_name', 'TEXT');
    ensureColumn('role', "TEXT NOT NULL DEFAULT 'operator'");
    ensureColumn('password_hash', 'TEXT');
    ensureColumn('password_salt', 'TEXT');
    ensureColumn('avatar_type', "TEXT NOT NULL DEFAULT 'initial'");
    ensureColumn('avatar_value', 'TEXT');
    ensureColumn('is_active', 'INTEGER DEFAULT 1');
    ensureColumn('created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    ensureColumn('updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  }

  static createPurchasePriceHistoryTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuel_type TEXT NOT NULL,
        product_code TEXT,
        price REAL NOT NULL,
        start_date TEXT NOT NULL,
        product_id INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createProductsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL UNIQUE,
        product_code TEXT UNIQUE,
        current_price REAL NOT NULL,
        vat REAL DEFAULT 0,
        effective_date TEXT,
        is_active INTEGER DEFAULT 1,
        display_order INTEGER DEFAULT 0
      )
    `);

    const columns = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
    if (!columns.includes('product_code')) {
      db.exec('ALTER TABLE products ADD COLUMN product_code TEXT');
    }
    if (!columns.includes('display_order')) {
      db.exec('ALTER TABLE products ADD COLUMN display_order INTEGER DEFAULT 0');
    }

    db.exec(`
      UPDATE products
      SET display_order = id
      WHERE display_order IS NULL OR display_order = 0
    `);

    db.exec(`
      UPDATE products
      SET product_code = product_type || '_' || id
      WHERE product_code IS NULL OR TRIM(product_code) = ''
    `);
  }

  static createPriceHistoryTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_code TEXT,
        price REAL NOT NULL,
        start_date TEXT NOT NULL,
        product_id INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createOilMovementsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oil_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT,
        oil_type TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        invoice_number TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createFuelMovementsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fuel_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT,
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
        product_code TEXT,
        fuel_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        net_quantity REAL NOT NULL,
        purchase_price REAL NOT NULL,
        total REAL NOT NULL,
        invoice_total REAL DEFAULT 0,
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
        product_code TEXT,
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

  static createCustomerBalanceAdjustmentsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_balance_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        customer_name TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(customer_id, effective_date)
      )
    `);

    const tableInfo = db.prepare("PRAGMA table_info(customer_balance_adjustments)").all();
    const hasCustomerId = tableInfo.some(col => col.name === 'customer_id');
    if (!hasCustomerId) {
      db.exec('ALTER TABLE customer_balance_adjustments ADD COLUMN customer_id INTEGER');
    }
  }

  static createShiftsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        shift_number INTEGER NOT NULL,
        data TEXT DEFAULT '{}',
        fuel_data TEXT DEFAULT '{}',
        fuel_total REAL DEFAULT 0,
        oil_data TEXT DEFAULT '{}',
        oil_total REAL DEFAULT 0,
        wash_lube_revenue REAL DEFAULT 0,
        total_expenses REAL DEFAULT 0,
        grand_total REAL DEFAULT 0,
        is_saved INTEGER DEFAULT 0,
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

  static createCompanyVoucherSettlementsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS company_voucher_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_month TEXT NOT NULL UNIQUE,
        paid_amount REAL DEFAULT 0,
        paid_at TEXT,
        notes TEXT DEFAULT '',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createSafeBookMovementsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS safe_book_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        movement_type TEXT NOT NULL,
        amount REAL NOT NULL,
        direction TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createShiftBalanceChangeHistoryTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shift_balance_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_date TEXT NOT NULL,
        shift_number INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        item_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value REAL,
        new_value REAL NOT NULL,
        changed_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createShiftCorrectionsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shift_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        shift_number INTEGER NOT NULL,
        corrected_at INTEGER DEFAULT (strftime('%s', 'now')),
        before_data TEXT NOT NULL,
        after_data TEXT NOT NULL,
        diff_summary TEXT DEFAULT '{}'
      )
    `);
  }

  static createMonthlyProfitInputsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_profit_inputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_key TEXT NOT NULL UNIQUE,
        fuel_diesel REAL DEFAULT 0,
        fuel_80 REAL DEFAULT 0,
        fuel_92 REAL DEFAULT 0,
        fuel_95 REAL DEFAULT 0,
        oil_total REAL DEFAULT 0,
        bonuses REAL DEFAULT 0,
        commission_diff REAL DEFAULT 0,
        deposit_tax REAL DEFAULT 0,
        bonus_tax REAL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createMonthlyProfitCustomRowsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_profit_custom_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        row_key TEXT NOT NULL UNIQUE,
        row_label TEXT NOT NULL,
        row_type TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  static createMonthlyProfitCustomValuesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_profit_custom_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        row_key TEXT NOT NULL,
        month_key TEXT NOT NULL,
        amount REAL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(row_key, month_key)
      )
    `);
  }

  static createLandTables(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS land_seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        notes TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS land_plots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        location TEXT DEFAULT '',
        description TEXT DEFAULT '',
        total_sahm INTEGER NOT NULL CHECK(total_sahm > 0),
        status TEXT NOT NULL DEFAULT 'available',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS land_plot_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_id INTEGER NOT NULL,
        season_id INTEGER NOT NULL,
        rent_mode TEXT NOT NULL DEFAULT 'per_feddan',
        rent_value_cents INTEGER NOT NULL DEFAULT 0,
        rent_total_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plot_id, season_id),
        FOREIGN KEY(plot_id) REFERENCES land_plots(id),
        FOREIGN KEY(season_id) REFERENCES land_seasons(id)
      );

      CREATE TABLE IF NOT EXISTS land_tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        village_address TEXT DEFAULT '',
        document_id TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS land_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plot_id INTEGER NOT NULL,
        tenant_id INTEGER NOT NULL,
        season_id INTEGER NOT NULL,
        assigned_sahm INTEGER NOT NULL CHECK(assigned_sahm > 0),
        rent_cents INTEGER NOT NULL DEFAULT 0,
        manual_rent_cents INTEGER,
        manual_rent_note TEXT DEFAULT '',
        rent_adjustment_mode TEXT DEFAULT 'none',
        rent_adjustment_cents INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        contract_status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        FOREIGN KEY(plot_id) REFERENCES land_plots(id),
        FOREIGN KEY(tenant_id) REFERENCES land_tenants(id),
        FOREIGN KEY(season_id) REFERENCES land_seasons(id)
      );

      CREATE TABLE IF NOT EXISTS land_installments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        installment_number INTEGER NOT NULL CHECK(installment_number IN (1, 2)),
        expected_cents INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(assignment_id, installment_number),
        FOREIGN KEY(assignment_id) REFERENCES land_assignments(id)
      );

      CREATE TABLE IF NOT EXISTS land_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        installment_number INTEGER NOT NULL CHECK(installment_number IN (1, 2)),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        paid_at TEXT NOT NULL,
        payment_method TEXT DEFAULT '',
        reference TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        FOREIGN KEY(assignment_id) REFERENCES land_assignments(id)
      );

      CREATE TABLE IF NOT EXISTS land_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL,
        receipt_number TEXT NOT NULL UNIQUE,
        issued_at TEXT NOT NULL,
        receipt_data TEXT NOT NULL DEFAULT '{}',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(payment_id) REFERENCES land_payments(id)
      );

      CREATE TABLE IF NOT EXISTS land_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
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
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_code ON products(product_code)');

    // Movements indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_oil_movements_date ON oil_movements(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_fuel_movements_date ON fuel_movements(date)');

    // Invoices indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_fuel_invoices_date ON fuel_invoices(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_oil_invoices_date ON oil_invoices(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customer_balance_adjustments_customer_date ON customer_balance_adjustments(customer_name, effective_date)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_balance_adjustments_customer_id_date ON customer_balance_adjustments(customer_id, effective_date)');

    // Shifts indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_profit_inputs_month_key ON monthly_profit_inputs(month_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_profit_custom_rows_type_order ON monthly_profit_custom_rows(row_type, display_order)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_profit_custom_values_month_key ON monthly_profit_custom_values(month_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_profit_custom_values_row_key ON monthly_profit_custom_values(row_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_app_devices_last_seen ON app_devices(last_seen_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_app_devices_last_opened ON app_devices(last_opened_at)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_app_users_active ON app_users(is_active)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_plots_location ON land_plots(location)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_plots_status ON land_plots(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_plot_terms_plot_season ON land_plot_terms(plot_id, season_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_tenants_name ON land_tenants(full_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_tenants_phone ON land_tenants(phone)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_assignments_plot_season ON land_assignments(plot_id, season_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_assignments_tenant ON land_assignments(tenant_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_installments_assignment ON land_installments(assignment_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_payments_assignment ON land_payments(assignment_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_land_payments_paid_at ON land_payments(paid_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_annual_inventories_year ON annual_inventories(year)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_annual_inventories_finalized ON annual_inventories(finalized)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_safe_book_movements_date ON safe_book_movements(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_safe_book_movements_direction ON safe_book_movements(direction)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_shift_balance_history_changed_at ON shift_balance_change_history(changed_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_shift_balance_history_shift ON shift_balance_change_history(shift_date, shift_number)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_shift_balance_history_item ON shift_balance_change_history(item_type, item_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_shift_corrections_shift ON shift_corrections(date, shift_number)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_shift_corrections_corrected_at ON shift_corrections(corrected_at)');

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
      const ensureColumn = (tableName, tableInfo, columnName, definition) => {
        const exists = tableInfo.some(col => col.name === columnName);
        if (!exists) {
          console.log(`Adding ${columnName} column to ${tableName} table...`);
          db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
      };

      ensureColumn('sales', db.prepare("PRAGMA table_info(sales)").all(), 'product_code', 'TEXT');
      ensureColumn('products', db.prepare("PRAGMA table_info(products)").all(), 'product_code', 'TEXT');
      const purchasePricesTableInfo = db.prepare("PRAGMA table_info(purchase_prices)").all();
      ensureColumn('purchase_prices', purchasePricesTableInfo, 'product_code', 'TEXT');
      ensureColumn('purchase_prices', purchasePricesTableInfo, 'effective_date', 'TEXT');
      ensureColumn('purchase_prices', purchasePricesTableInfo, 'product_id', 'INTEGER');
      ensureColumn('price_history', priceHistoryTableInfo, 'product_code', 'TEXT');
      this.createPurchasePriceHistoryTable(db);
      const purchasePriceHistoryTableInfo = db.prepare("PRAGMA table_info(purchase_price_history)").all();
      ensureColumn('purchase_price_history', purchasePriceHistoryTableInfo, 'product_code', 'TEXT');
      ensureColumn('purchase_price_history', purchasePriceHistoryTableInfo, 'product_id', 'INTEGER');
      ensureColumn('purchase_price_history', purchasePriceHistoryTableInfo, 'created_at', 'INTEGER');
      ensureColumn('oil_movements', db.prepare("PRAGMA table_info(oil_movements)").all(), 'product_code', 'TEXT');
      ensureColumn('fuel_movements', db.prepare("PRAGMA table_info(fuel_movements)").all(), 'product_code', 'TEXT');
      ensureColumn('fuel_invoices', db.prepare("PRAGMA table_info(fuel_invoices)").all(), 'product_code', 'TEXT');
      ensureColumn('oil_invoices', db.prepare("PRAGMA table_info(oil_invoices)").all(), 'product_code', 'TEXT');

      db.exec(`
        UPDATE products
        SET product_code = product_type || '_' || id
        WHERE product_code IS NULL OR TRIM(product_code) = ''
      `);
      db.exec(`
        UPDATE sales
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE p.product_type = 'fuel' AND p.product_name = sales.fuel_type
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);
      db.exec(`
        UPDATE price_history
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE (price_history.product_id IS NOT NULL AND p.id = price_history.product_id)
             OR (price_history.product_id IS NULL AND p.product_type = price_history.product_type AND p.product_name = price_history.product_name)
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);
      db.exec(`
        UPDATE purchase_prices
        SET
          product_code = COALESCE(product_code, (
            SELECT p.product_code FROM products p
            WHERE p.product_type = 'fuel' AND p.product_name = purchase_prices.fuel_type
            LIMIT 1
          )),
          product_id = COALESCE(product_id, (
            SELECT p.id FROM products p
            WHERE p.product_type = 'fuel' AND p.product_name = purchase_prices.fuel_type
            LIMIT 1
          )),
          effective_date = COALESCE(effective_date, date(COALESCE(updated_at, strftime('%s', 'now')), 'unixepoch'))
      `);
      db.exec(`
        UPDATE purchase_price_history
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE (purchase_price_history.product_id IS NOT NULL AND p.id = purchase_price_history.product_id)
             OR (purchase_price_history.product_id IS NULL AND p.product_type = 'fuel' AND p.product_name = purchase_price_history.fuel_type)
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_migrations (
          key TEXT PRIMARY KEY,
          applied_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      const seedPurchasePricesMigration = db.prepare(
        'SELECT key FROM app_migrations WHERE key = ? LIMIT 1'
      ).get('seed_manual_fuel_purchase_prices_20260101');
      if (!seedPurchasePricesMigration) {
        db.exec('DELETE FROM purchase_prices');
        db.exec('DELETE FROM purchase_price_history');
        db.exec(`
          INSERT INTO purchase_prices (fuel_type, product_code, price, effective_date, product_id, updated_at)
          SELECT
            COALESCE(p.product_name, mp.fuel_type) AS fuel_type,
            p.product_code,
            mp.price,
            '2026-01-01' AS effective_date,
            p.id AS product_id,
            strftime('%s', 'now') AS updated_at
          FROM (
            SELECT 'بنزين ٨٠' AS fuel_type, 9.0 AS price
            UNION ALL
            SELECT 'بنزين ٩٢' AS fuel_type, 12.0 AS price
          ) mp
          LEFT JOIN products p
            ON p.product_type = 'fuel'
            AND p.product_name = mp.fuel_type
        `);
        db.exec(`
          INSERT INTO purchase_price_history (fuel_type, product_code, price, start_date, product_id, created_at)
          SELECT fuel_type, product_code, price, '2026-01-01', product_id, strftime('%s', 'now')
          FROM purchase_prices
        `);
        db.prepare('INSERT OR IGNORE INTO app_migrations (key) VALUES (?)')
          .run('seed_manual_fuel_purchase_prices_20260101');
      }
      db.exec(`
        INSERT INTO purchase_price_history (fuel_type, product_code, price, start_date, product_id, created_at)
        SELECT pp.fuel_type, pp.product_code, pp.price, COALESCE(pp.effective_date, date(COALESCE(pp.updated_at, strftime('%s', 'now')), 'unixepoch')), pp.product_id, COALESCE(pp.updated_at, strftime('%s', 'now'))
        FROM purchase_prices pp
        WHERE NOT EXISTS (
          SELECT 1
          FROM purchase_price_history pph
          WHERE pph.fuel_type = pp.fuel_type
            AND pph.start_date = COALESCE(pp.effective_date, date(COALESCE(pp.updated_at, strftime('%s', 'now')), 'unixepoch'))
        )
      `);
      db.exec(`
        UPDATE oil_movements
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE p.product_type = 'oil' AND p.product_name = oil_movements.oil_type
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);
      db.exec(`
        UPDATE oil_invoices
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE p.product_type = 'oil' AND p.product_name = oil_invoices.oil_type
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);
      db.exec(`
        UPDATE fuel_movements
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE p.product_type = 'fuel' AND p.product_name = fuel_movements.fuel_type
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);
      db.exec(`
        UPDATE fuel_invoices
        SET product_code = (
          SELECT p.product_code FROM products p
          WHERE p.product_type = 'fuel' AND p.product_name = fuel_invoices.fuel_type
          LIMIT 1
        )
        WHERE product_code IS NULL
      `);

      if (!hasProductId) {
        console.log('Adding product_id column to price_history table...');
        db.exec('ALTER TABLE price_history ADD COLUMN product_id INTEGER');
        console.log('Migration completed: product_id column added');
      }

      const hasCreatedAt = priceHistoryTableInfo.some(col => col.name === 'created_at');

      if (!hasCreatedAt) {
        console.log('Adding created_at column to price_history table...');
        db.exec('ALTER TABLE price_history ADD COLUMN created_at INTEGER');
        console.log('Migration completed: created_at column added to price_history');
      }
      db.exec("UPDATE price_history SET created_at = strftime('%s', 'now') WHERE created_at IS NULL");

      // Check if fuel_invoices has obsolete columns to remove (sale_price/profit)
      const fuelInvoicesTableInfo = db.prepare("PRAGMA table_info(fuel_invoices)").all();
      const hasSalePrice = fuelInvoicesTableInfo.some(col => col.name === 'sale_price');
      const hasProfit = fuelInvoicesTableInfo.some(col => col.name === 'profit');

      if (hasSalePrice || hasProfit) {
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
            invoice_total REAL DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
          );

          -- Copy data from old table
          INSERT INTO fuel_invoices_new (id, date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total, created_at)
          SELECT
            id,
            date,
            invoice_number,
            fuel_type,
            quantity,
            net_quantity,
            purchase_price,
            total,
            COALESCE(invoice_total, 0),
            created_at
          FROM fuel_invoices;

          -- Drop old table
          DROP TABLE fuel_invoices;

          -- Rename new table
          ALTER TABLE fuel_invoices_new RENAME TO fuel_invoices;
        `);

        console.log('Migration completed: removed obsolete columns from fuel_invoices');
      }

      const refreshedFuelInvoicesInfo = db.prepare("PRAGMA table_info(fuel_invoices)").all();
      const hasInvoiceTotal = refreshedFuelInvoicesInfo.some(col => col.name === 'invoice_total');
      if (!hasInvoiceTotal) {
        console.log('Adding invoice_total column to fuel_invoices table...');
        db.exec('ALTER TABLE fuel_invoices ADD COLUMN invoice_total REAL DEFAULT 0');
      }

      const shiftsTableInfo = db.prepare("PRAGMA table_info(shifts)").all();
      const ensureShiftColumn = (name, definition) => {
        const exists = shiftsTableInfo.some(col => col.name === name);
        if (!exists) {
          console.log(`Adding ${name} column to shifts table...`);
          db.exec(`ALTER TABLE shifts ADD COLUMN ${name} ${definition}`);
        }
      };

      ensureShiftColumn('fuel_data', "TEXT DEFAULT '{}'");
      ensureShiftColumn('data', "TEXT DEFAULT '{}'");
      ensureShiftColumn('fuel_total', 'REAL DEFAULT 0');
      ensureShiftColumn('oil_data', "TEXT DEFAULT '{}'");
      ensureShiftColumn('oil_total', 'REAL DEFAULT 0');
      ensureShiftColumn('wash_lube_revenue', 'REAL DEFAULT 0');
      ensureShiftColumn('total_expenses', 'REAL DEFAULT 0');
      ensureShiftColumn('grand_total', 'REAL DEFAULT 0');
      ensureShiftColumn('is_saved', 'INTEGER DEFAULT 0');

      const monthlyProfitInputsInfo = db.prepare("PRAGMA table_info(monthly_profit_inputs)").all();
      const balanceHistoryInfo = db.prepare("PRAGMA table_info(shift_balance_change_history)").all();
      if (balanceHistoryInfo.length === 0) {
        console.log('Creating shift_balance_change_history table...');
        this.createShiftBalanceChangeHistoryTable(db);
      }

      const shiftCorrectionsInfo = db.prepare("PRAGMA table_info(shift_corrections)").all();
      if (shiftCorrectionsInfo.length === 0) {
        console.log('Creating shift_corrections table...');
        this.createShiftCorrectionsTable(db);
      }

      const customerBalanceAdjustmentsInfo = db.prepare("PRAGMA table_info(customer_balance_adjustments)").all();
      if (customerBalanceAdjustmentsInfo.length === 0) {
        console.log('Creating customer_balance_adjustments table...');
        this.createCustomerBalanceAdjustmentsTable(db);
      } else {
        ensureColumn('customer_balance_adjustments', customerBalanceAdjustmentsInfo, 'customer_id', 'INTEGER');
      }

      if (monthlyProfitInputsInfo.length === 0) {
        console.log('Creating monthly_profit_inputs table...');
        this.createMonthlyProfitInputsTable(db);
      }

      const monthlyProfitCustomRowsInfo = db.prepare("PRAGMA table_info(monthly_profit_custom_rows)").all();
      if (monthlyProfitCustomRowsInfo.length === 0) {
        console.log('Creating monthly_profit_custom_rows table...');
        this.createMonthlyProfitCustomRowsTable(db);
      }

      const monthlyProfitCustomValuesInfo = db.prepare("PRAGMA table_info(monthly_profit_custom_values)").all();
      if (monthlyProfitCustomValuesInfo.length === 0) {
        console.log('Creating monthly_profit_custom_values table...');
        this.createMonthlyProfitCustomValuesTable(db);
      }

      const appDevicesInfo = db.prepare("PRAGMA table_info(app_devices)").all();
      if (appDevicesInfo.length === 0) {
        console.log('Creating app_devices table...');
        this.createAppDevicesTable(db);
      } else {
        ensureColumn('app_devices', appDevicesInfo, 'system_name', 'TEXT');
        ensureColumn('app_devices', appDevicesInfo, 'display_name', 'TEXT');
        ensureColumn('app_devices', appDevicesInfo, 'app_version', 'TEXT');
        ensureColumn('app_devices', appDevicesInfo, 'platform', 'TEXT');
        ensureColumn('app_devices', appDevicesInfo, 'arch', 'TEXT');
        ensureColumn('app_devices', appDevicesInfo, 'first_seen_at', 'INTEGER');
        ensureColumn('app_devices', appDevicesInfo, 'last_opened_at', 'INTEGER');
        ensureColumn('app_devices', appDevicesInfo, 'last_seen_at', 'INTEGER');
        ensureColumn('app_devices', appDevicesInfo, 'updated_at', 'INTEGER');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_app_devices_last_seen ON app_devices(last_seen_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_app_devices_last_opened ON app_devices(last_opened_at)');

      const appUsersInfo = db.prepare("PRAGMA table_info(app_users)").all();
      if (appUsersInfo.length === 0) {
        console.log('Creating app_users table...');
        this.createAppUsersTable(db);
      } else {
        ensureColumn('app_users', appUsersInfo, 'username', 'TEXT');
        ensureColumn('app_users', appUsersInfo, 'display_name', 'TEXT');
        ensureColumn('app_users', appUsersInfo, 'role', "TEXT NOT NULL DEFAULT 'operator'");
        ensureColumn('app_users', appUsersInfo, 'password_hash', 'TEXT');
        ensureColumn('app_users', appUsersInfo, 'password_salt', 'TEXT');
        ensureColumn('app_users', appUsersInfo, 'avatar_type', "TEXT NOT NULL DEFAULT 'initial'");
        ensureColumn('app_users', appUsersInfo, 'avatar_value', 'TEXT');
        ensureColumn('app_users', appUsersInfo, 'is_active', 'INTEGER DEFAULT 1');
        ensureColumn('app_users', appUsersInfo, 'created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        ensureColumn('app_users', appUsersInfo, 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
      }
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_app_users_active ON app_users(is_active)');

      const landSeasonsInfo = db.prepare("PRAGMA table_info(land_seasons)").all();
      if (landSeasonsInfo.length === 0) {
        console.log('Creating land management tables...');
        this.createLandTables(db);
      } else {
        const landAssignmentsInfo = db.prepare("PRAGMA table_info(land_assignments)").all();
        ensureColumn('land_assignments', landAssignmentsInfo, 'rent_adjustment_mode', "TEXT DEFAULT 'none'");
        ensureColumn('land_assignments', landAssignmentsInfo, 'rent_adjustment_cents', 'INTEGER DEFAULT 0');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_plots_location ON land_plots(location)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_plots_status ON land_plots(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_plot_terms_plot_season ON land_plot_terms(plot_id, season_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_tenants_name ON land_tenants(full_name)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_tenants_phone ON land_tenants(phone)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_assignments_plot_season ON land_assignments(plot_id, season_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_assignments_tenant ON land_assignments(tenant_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_installments_assignment ON land_installments(assignment_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_payments_assignment ON land_payments(assignment_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_land_payments_paid_at ON land_payments(paid_at)');

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
