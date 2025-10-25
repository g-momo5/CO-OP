const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Database configuration - change this to switch between SQLite and PostgreSQL
const USE_POSTGRESQL = false; // Set to true when Supabase is ready

let mainWindow;
let db;

// Auto-updater configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets/logo_cpc.png'),
    title: 'محطة بنزين سمنود - الجمعية التعاونية للبترول - مصر'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

async function initializeDatabase() {
  if (USE_POSTGRESQL) {
    // PostgreSQL/Supabase configuration
    const { Client } = require('pg');
    const connectionString = 'postgresql://postgres.lryhwpadqrlnwjinxuqi:Ghaly1997.@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';
    
    db = new Client({
      connectionString: connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });

    try {
      await db.connect();
      console.log('Connected to Supabase PostgreSQL');
      await createPostgreSQLTables();
    } catch (error) {
      console.error('PostgreSQL connection error:', error);
      throw error;
    }
  } else {
    // SQLite configuration
    let dbPath;

    // In development, use __dirname; in production, use userData
    if (!app.isPackaged) {
      // Development mode: use local database
      dbPath = path.join(__dirname, 'coop_database.db');
      console.log('Development mode - Database:', dbPath);
    } else {
      // Production mode: use userData directory
      const userDataPath = app.getPath('userData');
      dbPath = path.join(userDataPath, 'coop_database.db');

      // Ensure the userData directory exists
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      console.log('Production mode - Database:', dbPath);
    }

    db = new sqlite3.Database(dbPath);
    await createSQLiteTables();
  }
}

async function createPostgreSQLTables() {
  // Sales table
  await db.query(`CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    fuel_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    price_per_liter REAL NOT NULL,
    total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    customer_name TEXT,
    notes TEXT
  )`);

  // Fuel prices table
  await db.query(`CREATE TABLE IF NOT EXISTS fuel_prices (
    id SERIAL PRIMARY KEY,
    fuel_type TEXT NOT NULL UNIQUE,
    price REAL NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Purchase prices table
  await db.query(`CREATE TABLE IF NOT EXISTS purchase_prices (
    id SERIAL PRIMARY KEY,
    fuel_type TEXT NOT NULL UNIQUE,
    price REAL NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default fuel prices if not exists
  await db.query(`INSERT INTO fuel_prices (fuel_type, price) VALUES
    ('بنزين ٨٠', 8.50),
    ('بنزين ٩٢', 10.50),
    ('بنزين ٩٥', 11.50),
    ('سولار', 7.50)
  ON CONFLICT (fuel_type) DO NOTHING`);

  // Insert default purchase prices if not exists
  await db.query(`INSERT INTO purchase_prices (fuel_type, price) VALUES
    ('بنزين ٨٠', 8.00),
    ('بنزين ٩٢', 10.00),
    ('بنزين ٩٥', 11.00),
    ('سولار', 7.00)
  ON CONFLICT (fuel_type) DO NOTHING`);

  // Oil prices table
  await db.query(`CREATE TABLE IF NOT EXISTS oil_prices (
    id SERIAL PRIMARY KEY,
    oil_type TEXT NOT NULL UNIQUE,
    price REAL NOT NULL,
    vat REAL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add vat column if it doesn't exist (migration)
  try {
    await db.query(`ALTER TABLE oil_prices ADD COLUMN IF NOT EXISTS vat REAL DEFAULT 0`);
  } catch (err) {
    // Column might already exist, ignore error
    console.log('VAT column migration: ', err.message);
  }

  // Price history table
  await db.query(`CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    product_type TEXT NOT NULL,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    start_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Oil movements table
  await db.query(`CREATE TABLE IF NOT EXISTS oil_movements (
    id SERIAL PRIMARY KEY,
    oil_type TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    invoice_number TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Fuel movements table (for tank inventory tracking)
  await db.query(`CREATE TABLE IF NOT EXISTS fuel_movements (
    id SERIAL PRIMARY KEY,
    fuel_type TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    invoice_number TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Fuel invoices table
  await db.query(`CREATE TABLE IF NOT EXISTS fuel_invoices (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    fuel_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    net_quantity REAL NOT NULL,
    purchase_price REAL NOT NULL,
    sale_price REAL NOT NULL,
    total REAL NOT NULL,
    profit REAL NOT NULL,
    invoice_total REAL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Oil invoices table
  await db.query(`CREATE TABLE IF NOT EXISTS oil_invoices (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    oil_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    purchase_price REAL NOT NULL,
    iva REAL NOT NULL,
    total_purchase REAL NOT NULL,
    immediate_discount REAL DEFAULT 0,
    martyrs_tax REAL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

function createSQLiteTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Sales table
      db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        fuel_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        price_per_liter REAL NOT NULL,
        total_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        customer_name TEXT,
        notes TEXT
      )`);

      // Fuel prices table
      db.run(`CREATE TABLE IF NOT EXISTS fuel_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuel_type TEXT NOT NULL UNIQUE,
        price REAL NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Purchase prices table
      db.run(`CREATE TABLE IF NOT EXISTS purchase_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuel_type TEXT NOT NULL UNIQUE,
        price REAL NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Insert default fuel prices if not exists
      db.run(`INSERT OR IGNORE INTO fuel_prices (fuel_type, price) VALUES
        ('بنزين ٨٠', 8.50),
        ('بنزين ٩٢', 10.50),
        ('بنزين ٩٥', 11.50),
        ('سولار', 7.50)`);

      // Insert default purchase prices if not exists
      db.run(`INSERT OR IGNORE INTO purchase_prices (fuel_type, price) VALUES
        ('بنزين ٨٠', 8.00),
        ('بنزين ٩٢', 10.00),
        ('بنزين ٩٥', 11.00),
        ('سولار', 7.00)`);

      // Oil prices table
      db.run(`CREATE TABLE IF NOT EXISTS oil_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oil_type TEXT NOT NULL UNIQUE,
        price REAL NOT NULL,
        vat REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Add vat column if it doesn't exist (migration)
      db.run(`ALTER TABLE oil_prices ADD COLUMN vat REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('VAT column migration error:', err.message);
        }
      });

      // Price history table
      db.run(`CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL,
        price REAL NOT NULL,
        start_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Oil movements table
      db.run(`CREATE TABLE IF NOT EXISTS oil_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oil_type TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        invoice_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Fuel movements table (for tank inventory tracking)
      db.run(`CREATE TABLE IF NOT EXISTS fuel_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuel_type TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        invoice_number TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Fuel invoices table
      db.run(`CREATE TABLE IF NOT EXISTS fuel_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        fuel_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        net_quantity REAL NOT NULL,
        purchase_price REAL NOT NULL,
        sale_price REAL NOT NULL,
        total REAL NOT NULL,
        profit REAL NOT NULL,
        invoice_total REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Oil invoices table
      db.run(`CREATE TABLE IF NOT EXISTS oil_invoices (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Add invoice_total column to fuel_invoices if it doesn't exist (migration)
      db.run(`ALTER TABLE fuel_invoices ADD COLUMN invoice_total REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('invoice_total column migration error:', err.message);
        }
        resolve();
      });
    });
  });
}

// Database helper functions
function executeQuery(query, params = []) {
  if (USE_POSTGRESQL) {
    return db.query(query, params).then(result => result.rows);
  } else {
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

function executeUpdate(query, params = []) {
  if (USE_POSTGRESQL) {
    return db.query(query, params).then(result => result.rowCount);
  } else {
    return new Promise((resolve, reject) => {
      db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

function executeInsert(query, params = []) {
  if (USE_POSTGRESQL) {
    return db.query(query + ' RETURNING id', params).then(result => result.rows[0].id);
  } else {
    return new Promise((resolve, reject) => {
      db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }
}

// IPC Handlers setup function
function setupIPCHandlers() {
  ipcMain.handle('get-sales', async () => {
    try {
      return await executeQuery('SELECT * FROM sales ORDER BY date DESC');
    } catch (error) {
      console.error('Error getting sales:', error);
      throw error;
    }
  });

  ipcMain.handle('add-sale', async (event, saleData) => {
    try {
      const { date, fuel_type, quantity, price_per_liter, total_amount, payment_method, customer_name, notes } = saleData;
      const query = 'INSERT INTO sales (date, fuel_type, quantity, price_per_liter, total_amount, payment_method, customer_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      return await executeInsert(query, [date, fuel_type, quantity, price_per_liter, total_amount, payment_method, customer_name, notes]);
    } catch (error) {
      console.error('Error adding sale:', error);
      throw error;
    }
  });

  ipcMain.handle('get-fuel-prices', async () => {
    try {
      return await executeQuery("SELECT id, product_name as fuel_type, current_price as price, effective_date FROM products WHERE product_type = 'fuel' ORDER BY product_name");
    } catch (error) {
      console.error('Error getting fuel prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-fuel-price', async (event, { fuel_type, price }) => {
    try {
      const updateQuery = USE_POSTGRESQL
        ? 'UPDATE fuel_prices SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2'
        : 'UPDATE fuel_prices SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = ?';
      return await executeUpdate(updateQuery, [price, fuel_type]);
    } catch (error) {
      console.error('Error updating fuel price:', error);
      throw error;
    }
  });

  ipcMain.handle('get-purchase-prices', async () => {
    try {
      return await executeQuery('SELECT * FROM purchase_prices ORDER BY fuel_type');
    } catch (error) {
      console.error('Error getting purchase prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-purchase-price', async (event, { fuel_type, price }) => {
    try {
      const updateQuery = USE_POSTGRESQL
        ? 'UPDATE purchase_prices SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2'
        : 'UPDATE purchase_prices SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = ?';
      return await executeUpdate(updateQuery, [price, fuel_type]);
    } catch (error) {
      console.error('Error updating purchase price:', error);
      throw error;
    }
  });

  // Oil Prices Handlers
  ipcMain.handle('get-oil-prices', async () => {
    try {
      return await executeQuery("SELECT id, product_name as oil_type, current_price as price, vat, effective_date FROM products WHERE product_type = 'oil' ORDER BY product_name");
    } catch (error) {
      console.error('Error getting oil prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-oil-price', async (event, { oil_type, price }) => {
    try {
      const checkQuery = USE_POSTGRESQL
        ? 'SELECT * FROM oil_prices WHERE oil_type = $1'
        : 'SELECT * FROM oil_prices WHERE oil_type = ?';
      const existing = await executeQuery(checkQuery, [oil_type]);

      if (existing.length > 0) {
        const updateQuery = USE_POSTGRESQL
          ? 'UPDATE oil_prices SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE oil_type = $2'
          : 'UPDATE oil_prices SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE oil_type = ?';
        return await executeUpdate(updateQuery, [price, oil_type]);
      } else {
        const insertQuery = USE_POSTGRESQL
          ? 'INSERT INTO oil_prices (oil_type, price) VALUES ($1, $2)'
          : 'INSERT INTO oil_prices (oil_type, price) VALUES (?, ?)';
        return await executeInsert(insertQuery, [oil_type, price]);
      }
    } catch (error) {
      console.error('Error updating oil price:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-oil-product', async (_event, oil_type) => {
    try {
      const deleteQuery = USE_POSTGRESQL
        ? 'DELETE FROM oil_prices WHERE oil_type = $1'
        : 'DELETE FROM oil_prices WHERE oil_type = ?';
      return await executeUpdate(deleteQuery, [oil_type]);
    } catch (error) {
      console.error('Error deleting oil product:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-fuel-product', async (_event, fuel_type) => {
    try {
      const deleteQuery = USE_POSTGRESQL
        ? 'DELETE FROM fuel_prices WHERE fuel_type = $1'
        : 'DELETE FROM fuel_prices WHERE fuel_type = ?';
      return await executeUpdate(deleteQuery, [fuel_type]);
    } catch (error) {
      console.error('Error deleting fuel product:', error);
      throw error;
    }
  });

  // Add new fuel price
  ipcMain.handle('add-fuel-price', async (event, { fuel_type, price }) => {
    try {
      // Check if fuel type already exists
      const checkQuery = USE_POSTGRESQL
        ? 'SELECT * FROM fuel_prices WHERE fuel_type = $1'
        : 'SELECT * FROM fuel_prices WHERE fuel_type = ?';
      const existing = await executeQuery(checkQuery, [fuel_type]);

      if (existing.length > 0) {
        throw new Error('هذا النوع من الوقود موجود بالفعل');
      }

      // Insert new fuel price (with conflict handling to prevent duplicates)
      const insertQuery = USE_POSTGRESQL
        ? 'INSERT INTO fuel_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2, updated_at = CURRENT_TIMESTAMP'
        : 'INSERT OR REPLACE INTO fuel_prices (fuel_type, price) VALUES (?, ?)';
      return await executeInsert(insertQuery, [fuel_type, price]);
    } catch (error) {
      console.error('Error adding fuel price:', error);
      throw error;
    }
  });

  // Add new oil price
  ipcMain.handle('add-oil-price', async (event, { oil_type, price, vat }) => {
    try {
      // Check if oil type already exists
      const checkQuery = USE_POSTGRESQL
        ? 'SELECT * FROM oil_prices WHERE oil_type = $1'
        : 'SELECT * FROM oil_prices WHERE oil_type = ?';
      const existing = await executeQuery(checkQuery, [oil_type]);

      if (existing.length > 0) {
        throw new Error('هذا النوع من الزيت موجود بالفعل');
      }

      // Insert new oil price with VAT (with conflict handling to prevent duplicates)
      const vatValue = vat || 0;
      const insertQuery = USE_POSTGRESQL
        ? 'INSERT INTO oil_prices (oil_type, price, vat) VALUES ($1, $2, $3) ON CONFLICT (oil_type) DO UPDATE SET price = $2, vat = $3, updated_at = CURRENT_TIMESTAMP'
        : 'INSERT OR REPLACE INTO oil_prices (oil_type, price, vat) VALUES (?, ?, ?)';
      return await executeInsert(insertQuery, [oil_type, price, vatValue]);
    } catch (error) {
      console.error('Error adding oil price:', error);
      throw error;
    }
  });

  // Update product name
  ipcMain.handle('update-product-name', async (event, { type, oldName, newName, id }) => {
    try {
      // Check if new name already exists for this product type
      const checkQuery = USE_POSTGRESQL
        ? 'SELECT * FROM products WHERE product_type = $1 AND product_name = $2'
        : 'SELECT * FROM products WHERE product_type = ? AND product_name = ?';
      const existing = await executeQuery(checkQuery, [type, newName]);

      if (existing.length > 0) {
        throw new Error('يوجد منتج بهذا الاسم بالفعل');
      }

      // Update the product name in products table
      // The product_id remains the same, preserving price history
      const updateQuery = USE_POSTGRESQL
        ? 'UPDATE products SET product_name = $1 WHERE product_type = $2 AND product_name = $3'
        : 'UPDATE products SET product_name = ? WHERE product_type = ? AND product_name = ?';
      await executeQuery(updateQuery, [newName, type, oldName]);

      return { success: true };
    } catch (error) {
      console.error('Error updating product name:', error);
      throw error;
    }
  });

  // Save all prices with history
  ipcMain.handle('save-all-prices', async (event, prices) => {
    try {
      if (!prices || prices.length === 0) {
        throw new Error('No prices to save');
      }

      for (const item of prices) {
        const { product_type, product_name, price, start_date } = item;

        // Validate price
        if (!price || isNaN(price) || price <= 0) {
          console.warn(`Invalid price for ${product_name}: ${price}`);
          continue; // Skip invalid prices
        }

        // Validate required fields
        if (!product_type || !product_name || !start_date) {
          console.warn(`Missing required fields for price: ${JSON.stringify(item)}`);
          continue;
        }

        // Get product_id from products table
        const productQuery = USE_POSTGRESQL
          ? 'SELECT id FROM products WHERE product_type = $1 AND product_name = $2'
          : 'SELECT id FROM products WHERE product_type = ? AND product_name = ?';
        const productResult = await executeQuery(productQuery, [product_type, product_name]);

        if (productResult.length === 0) {
          console.warn(`Product not found: ${product_type} - ${product_name}`);
          continue;
        }

        const product_id = productResult[0].id;

        // Save to history with product_id
        const historyQuery = USE_POSTGRESQL
          ? 'INSERT INTO price_history (product_type, product_name, price, start_date, product_id) VALUES ($1, $2, $3, $4, $5)'
          : 'INSERT INTO price_history (product_type, product_name, price, start_date, product_id) VALUES (?, ?, ?, ?, ?)';
        await executeInsert(historyQuery, [product_type, product_name, price, start_date, product_id]);

        // Update current price in products table
        const updateQuery = USE_POSTGRESQL
          ? 'UPDATE products SET current_price = $1, effective_date = $2 WHERE id = $3'
          : 'UPDATE products SET current_price = ?, effective_date = ? WHERE id = ?';
        await executeUpdate(updateQuery, [price, start_date, product_id]);
      }
      return { success: true };
    } catch (error) {
      console.error('Error saving prices:', error);
      throw error;
    }
  });

  // Get price history
  ipcMain.handle('get-price-history', async (event, filter) => {
    try {
      let query = 'SELECT * FROM price_history';
      const params = [];

      if (filter) {
        query += USE_POSTGRESQL ? ' WHERE product_name = $1' : ' WHERE product_name = ?';
        params.push(filter);
      }

      query += ' ORDER BY created_at DESC LIMIT 100';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting price history:', error);
      throw error;
    }
  });

  ipcMain.handle('get-sales-report', async (event, { startDate, endDate }) => {
    try {
      const reportQuery = USE_POSTGRESQL
        ? 'SELECT * FROM sales WHERE date BETWEEN $1 AND $2 ORDER BY date DESC'
        : 'SELECT * FROM sales WHERE date BETWEEN ? AND ? ORDER BY date DESC';
      return await executeQuery(reportQuery, [startDate, endDate]);
    } catch (error) {
      console.error('Error getting sales report:', error);
      throw error;
    }
  });

  ipcMain.handle('get-sales-summary', async () => {
    try {
      return await executeQuery(`
        SELECT
          fuel_type,
          COUNT(*) as total_sales,
          SUM(quantity) as total_quantity,
          SUM(total_amount) as total_revenue,
          AVG(price_per_liter) as avg_price
        FROM sales
        GROUP BY fuel_type
      `);
    } catch (error) {
      console.error('Error getting sales summary:', error);
      throw error;
    }
  });

  // Oil movement handlers
  ipcMain.handle('add-oil-movement', async (event, movementData) => {
    try {
      const { oil_type, date, type, quantity, invoice_number } = movementData;
      const insertQuery = USE_POSTGRESQL
        ? 'INSERT INTO oil_movements (oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5)'
        : 'INSERT INTO oil_movements (oil_type, date, type, quantity, invoice_number) VALUES (?, ?, ?, ?, ?)';
      return await executeInsert(insertQuery, [oil_type, date, type, quantity, invoice_number]);
    } catch (error) {
      console.error('Error adding oil movement:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-movements', async (event, oilType) => {
    try {
      const movementsQuery = USE_POSTGRESQL
        ? 'SELECT * FROM oil_movements WHERE oil_type = $1 ORDER BY date DESC, created_at DESC'
        : 'SELECT * FROM oil_movements WHERE oil_type = ? ORDER BY date DESC, created_at DESC';
      return await executeQuery(movementsQuery, [oilType]);
    } catch (error) {
      console.error('Error getting oil movements:', error);
      throw error;
    }
  });

  ipcMain.handle('get-current-oil-stock', async (event, oilType) => {
    try {
      const stockQuery = USE_POSTGRESQL
        ? 'SELECT type, SUM(quantity) as total FROM oil_movements WHERE oil_type = $1 GROUP BY type'
        : 'SELECT type, SUM(quantity) as total FROM oil_movements WHERE oil_type = ? GROUP BY type';
      const result = await executeQuery(stockQuery, [oilType]);
      let stock = 0;
      result.forEach(row => {
        if (row.type === 'in') {
          stock += parseInt(row.total);
        } else if (row.type === 'out') {
          stock -= parseInt(row.total);
        }
      });
      return stock;
    } catch (error) {
      console.error('Error getting oil stock:', error);
      throw error;
    }
  });

  // Fuel movement handlers
  ipcMain.handle('add-fuel-movement', async (event, movementData) => {
    try {
      const { fuel_type, date, type, quantity, invoice_number, notes } = movementData;
      const insertQuery = USE_POSTGRESQL
        ? 'INSERT INTO fuel_movements (fuel_type, date, type, quantity, invoice_number, notes) VALUES ($1, $2, $3, $4, $5, $6)'
        : 'INSERT INTO fuel_movements (fuel_type, date, type, quantity, invoice_number, notes) VALUES (?, ?, ?, ?, ?, ?)';
      return await executeInsert(insertQuery, [fuel_type, date, type, quantity, invoice_number, notes]);
    } catch (error) {
      console.error('Error adding fuel movement:', error);
      throw error;
    }
  });

  ipcMain.handle('get-fuel-movements', async (event, fuelType) => {
    try {
      let movementsQuery, params;
      if (fuelType) {
        movementsQuery = USE_POSTGRESQL
          ? 'SELECT * FROM fuel_movements WHERE fuel_type = $1 ORDER BY date DESC, created_at DESC'
          : 'SELECT * FROM fuel_movements WHERE fuel_type = ? ORDER BY date DESC, created_at DESC';
        params = [fuelType];
      } else {
        movementsQuery = 'SELECT * FROM fuel_movements ORDER BY date DESC, created_at DESC';
        params = [];
      }
      return await executeQuery(movementsQuery, params);
    } catch (error) {
      console.error('Error getting fuel movements:', error);
      throw error;
    }
  });

  ipcMain.handle('get-current-fuel-stock', async (event, fuelType) => {
    try {
      const stockQuery = USE_POSTGRESQL
        ? 'SELECT type, SUM(quantity) as total FROM fuel_movements WHERE fuel_type = $1 GROUP BY type'
        : 'SELECT type, SUM(quantity) as total FROM fuel_movements WHERE fuel_type = ? GROUP BY type';
      const result = await executeQuery(stockQuery, [fuelType]);
      let stock = 0;
      result.forEach(row => {
        if (row.type === 'in') {
          stock += parseFloat(row.total);
        } else if (row.type === 'out') {
          stock -= parseFloat(row.total);
        }
      });
      return stock;
    } catch (error) {
      console.error('Error getting fuel stock:', error);
      throw error;
    }
  });

  // Fuel invoice handlers
  ipcMain.handle('add-fuel-invoice', async (event, invoiceData) => {
    try {
      const { date, invoice_number, invoice_total, fuel_items } = invoiceData;

      // Save each fuel item as a separate record
      for (const item of fuel_items) {
        const invoiceQuery = USE_POSTGRESQL
          ? 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, sale_price, total, profit, invoice_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)'
          : 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, sale_price, total, profit, invoice_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        await executeInsert(invoiceQuery, [
          date,
          invoice_number,
          item.fuel_type,
          item.quantity,
          item.net_quantity,
          item.purchase_price,
          item.sale_price || 0,
          item.total,
          item.profit || 0,
          invoice_total || 0
        ]);
      }

      return true;
    } catch (error) {
      console.error('Error adding fuel invoice:', error);
      throw error;
    }
  });

  // Oil invoice handlers
  ipcMain.handle('add-oil-invoice', async (event, invoiceData) => {
    try {
      const { date, invoice_number, immediate_discount, martyrs_tax, oil_items } = invoiceData;

      // Save each oil item as a separate record
      for (const item of oil_items) {
        const invoiceQuery = USE_POSTGRESQL
          ? 'INSERT INTO oil_invoices (date, invoice_number, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)'
          : 'INSERT INTO oil_invoices (date, invoice_number, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
        await executeInsert(invoiceQuery, [date, invoice_number, item.oil_type, item.quantity, item.purchase_price, item.iva, item.total_purchase, immediate_discount || 0, martyrs_tax || 0]);
      }

      return true;
    } catch (error) {
      console.error('Error adding oil invoice:', error);
      throw error;
    }
  });

  ipcMain.handle('get-fuel-invoices', async () => {
    try {
      return await executeQuery('SELECT * FROM fuel_invoices ORDER BY date DESC');
    } catch (error) {
      console.error('Error getting fuel invoices:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-invoices', async () => {
    try {
      return await executeQuery('SELECT * FROM oil_invoices ORDER BY date DESC');
    } catch (error) {
      console.error('Error getting oil invoices:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-invoices-report', async (event, { startDate, endDate }) => {
    try {
      const reportQuery = USE_POSTGRESQL
        ? 'SELECT * FROM oil_invoices WHERE date BETWEEN $1 AND $2 ORDER BY date DESC'
        : 'SELECT * FROM oil_invoices WHERE date BETWEEN ? AND ? ORDER BY date DESC';
      return await executeQuery(reportQuery, [startDate, endDate]);
    } catch (error) {
      console.error('Error getting oil invoices report:', error);
      throw error;
    }
  });

  // General Settings Handlers
  ipcMain.handle('save-general-settings', async (event, settings) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Error saving general settings:', error);
      throw error;
    }
  });

  ipcMain.handle('get-general-settings', async () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');

      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('Error loading general settings:', error);
      return null;
    }
  });

  // Backup Handlers
  ipcMain.handle('export-backup', async () => {
    try {
      const { dialog } = require('electron');
      const fs = require('fs');
      const path = require('path');

      // Get all data from database
      const fuelInvoices = await executeQuery('SELECT * FROM fuel_invoices ORDER BY date DESC');
      const oilInvoices = await executeQuery('SELECT * FROM oil_invoices ORDER BY date DESC');
      const fuelPrices = await executeQuery('SELECT * FROM fuel_prices');
      const purchasePrices = await executeQuery('SELECT * FROM purchase_prices');
      const oilPrices = await executeQuery('SELECT * FROM oil_prices');
      const priceHistory = await executeQuery('SELECT * FROM price_history ORDER BY created_at DESC');
      const depotMovements = await executeQuery('SELECT * FROM depot_movements ORDER BY date DESC');

      // Get general settings
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      let generalSettings = null;
      if (fs.existsSync(settingsPath)) {
        generalSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }

      const backupData = {
        exportDate: new Date().toISOString(),
        fuelInvoices,
        oilInvoices,
        fuelPrices,
        purchasePrices,
        oilPrices,
        priceHistory,
        depotMovements,
        generalSettings
      };

      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'حفظ النسخة الاحتياطية',
        defaultPath: `backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, JSON.stringify(backupData, null, 2));
        return { success: true };
      }

      return { success: false };
    } catch (error) {
      console.error('Error exporting backup:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('import-backup', async (event, backupData) => {
    try {
      const fs = require('fs');
      const path = require('path');

      // Clear existing data (optional - you may want to keep existing data)
      // For now, we'll just add the imported data

      // Import fuel invoices
      if (backupData.fuelInvoices) {
        for (const invoice of backupData.fuelInvoices) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, sale_price, total, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING'
            : 'INSERT OR IGNORE INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, sale_price, total, profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
          await executeInsert(query, [
            invoice.date,
            invoice.invoice_number,
            invoice.fuel_type,
            invoice.quantity,
            invoice.net_quantity,
            invoice.purchase_price,
            invoice.sale_price,
            invoice.total,
            invoice.profit
          ]);
        }
      }

      // Import oil invoices
      if (backupData.oilInvoices) {
        for (const invoice of backupData.oilInvoices) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO oil_invoices (date, invoice_number, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING'
            : 'INSERT OR IGNORE INTO oil_invoices (date, invoice_number, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
          await executeInsert(query, [
            invoice.date,
            invoice.invoice_number,
            invoice.oil_type,
            invoice.quantity,
            invoice.purchase_price,
            invoice.iva,
            invoice.total_purchase,
            invoice.immediate_discount || 0,
            invoice.martyrs_tax || 0
          ]);
        }
      }

      // Import fuel prices
      if (backupData.fuelPrices) {
        for (const price of backupData.fuelPrices) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO fuel_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2'
            : 'INSERT OR REPLACE INTO fuel_prices (fuel_type, price) VALUES (?, ?)';
          await executeInsert(query, [price.fuel_type, price.price]);
        }
      }

      // Import purchase prices
      if (backupData.purchasePrices) {
        for (const price of backupData.purchasePrices) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO purchase_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2'
            : 'INSERT OR REPLACE INTO purchase_prices (fuel_type, price) VALUES (?, ?)';
          await executeInsert(query, [price.fuel_type, price.price]);
        }
      }

      // Import oil prices
      if (backupData.oilPrices) {
        for (const price of backupData.oilPrices) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO oil_prices (oil_type, price) VALUES ($1, $2) ON CONFLICT (oil_type) DO UPDATE SET price = $2'
            : 'INSERT OR REPLACE INTO oil_prices (oil_type, price) VALUES (?, ?)';
          await executeInsert(query, [price.oil_type, price.price]);
        }
      }

      // Import price history
      if (backupData.priceHistory) {
        for (const item of backupData.priceHistory) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO price_history (product_type, product_name, price, start_date, created_at) VALUES ($1, $2, $3, $4, $5)'
            : 'INSERT INTO price_history (product_type, product_name, price, start_date, created_at) VALUES (?, ?, ?, ?, ?)';
          await executeInsert(query, [item.product_type, item.product_name, item.price, item.start_date, item.created_at]);
        }
      }

      // Import depot movements
      if (backupData.depotMovements) {
        for (const movement of backupData.depotMovements) {
          const query = USE_POSTGRESQL
            ? 'INSERT INTO depot_movements (oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING'
            : 'INSERT OR IGNORE INTO depot_movements (oil_type, date, type, quantity, invoice_number) VALUES (?, ?, ?, ?, ?)';
          await executeInsert(query, [
            movement.oil_type,
            movement.date,
            movement.type,
            movement.quantity,
            movement.invoice_number
          ]);
        }
      }

      // Import general settings
      if (backupData.generalSettings) {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(backupData.generalSettings, null, 2));
      }

      return { success: true };
    } catch (error) {
      console.error('Error importing backup:', error);
      return { success: false, error: error.message };
    }
  });
} // End of setupIPCHandlers

app.whenReady().then(async () => {
  await initializeDatabase();
  setupIPCHandlers();
  createWindow();

  // Check for updates after window is created (if auto-check is enabled)
  setTimeout(() => {
    // Will be triggered by renderer after checking localStorage
  }, 3000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available');
});

autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`);
  if (mainWindow) {
    mainWindow.webContents.send('download-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);
  }
});

// IPC handlers for manual update actions
ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Manual update check from settings
ipcMain.on('check-for-updates-manual', () => {
  autoUpdater.checkForUpdates().then(result => {
    if (mainWindow) {
      mainWindow.webContents.send('update-check-result', {
        available: result.updateInfo.version !== app.getVersion(),
        version: result.updateInfo.version,
        releaseNotes: result.updateInfo.releaseNotes
      });
    }
  }).catch(err => {
    console.error('Error checking for updates:', err);
    if (mainWindow) {
      mainWindow.webContents.send('update-check-result', {
        available: false,
        error: err.message
      });
    }
  });
});

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

app.on('window-all-closed', function () {
  app.quit();
});

app.on('before-quit', async () => {
  if (db) {
    if (USE_POSTGRESQL) {
      await db.end();
    } else {
      await new Promise((resolve) => {
        db.close(resolve);
      });
    }
  }
});
