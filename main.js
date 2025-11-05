const { app, BrowserWindow, ipcMain, dialog } = require('electron');
// Note: autoUpdater initialized after app.whenReady() to avoid initialization issues
const path = require('path');

let mainWindow;
let db;
let autoUpdater; // Initialized after app is ready

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
  // PostgreSQL/Supabase configuration
  const { Pool } = require('pg');
  const connectionString = 'postgresql://postgres.ihajlcodsypvjwfnkcjc:Ghaly1997.@aws-1-eu-west-2.pooler.supabase.com:6543/postgres';

  db = new Pool({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false
    },
    // Connection pool configuration
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 30000, // Wait 30 seconds before timing out when connecting
    // Query timeout
    query_timeout: 30000, // Query timeout in milliseconds
    statement_timeout: 30000, // Statement timeout in milliseconds
    // Keep-alive configuration
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000 // Start keep-alive after 10 seconds
  });

  // Handle pool errors
  db.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
    // Don't exit the process, just log the error
  });

  try {
    // Test connection
    const client = await db.connect();
    console.log('Connected to Supabase PostgreSQL');
    client.release();
    await createPostgreSQLTables();
  } catch (error) {
    console.error('PostgreSQL connection error:', error);
    throw error;
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

  // Purchase prices table (for purchase costs - different from selling prices in products)
  await db.query(`CREATE TABLE IF NOT EXISTS purchase_prices (
    id SERIAL PRIMARY KEY,
    fuel_type TEXT NOT NULL UNIQUE,
    price REAL NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default purchase prices if not exists
  await db.query(`INSERT INTO purchase_prices (fuel_type, price) VALUES
    ('بنزين ٨٠', 8.00),
    ('بنزين ٩٢', 10.00),
    ('بنزين ٩٥', 11.00),
    ('سولار', 7.00)
  ON CONFLICT (fuel_type) DO NOTHING`);

  // Products table (unified product management)
  await db.query(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    product_type TEXT NOT NULL,
    product_name TEXT NOT NULL UNIQUE,
    current_price REAL NOT NULL,
    vat REAL DEFAULT 0,
    effective_date DATE,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create index on product_type for faster queries
  try {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type)`);
  } catch (err) {
    console.log('Index creation: ', err.message);
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

  // Customers table
  await db.query(`CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Shifts table (for shift management)
  await db.query(`CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    shift_number INTEGER NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, shift_number)
  )`);
}

// Database helper functions with retry logic
async function executeWithRetry(operation, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if error is recoverable (network/timeout issues)
      const isRecoverable = error.code === 'ETIMEDOUT' ||
                           error.code === 'ECONNREFUSED' ||
                           error.code === 'ECONNRESET' ||
                           error.code === 'EPIPE';

      if (!isRecoverable || attempt === maxRetries) {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`Query failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function executeQuery(query, params = []) {
  return executeWithRetry(async () => {
    const result = await db.query(query, params);
    return result.rows;
  });
}

function executeUpdate(query, params = []) {
  return executeWithRetry(async () => {
    const result = await db.query(query, params);
    return result.rowCount;
  });
}

function executeInsert(query, params = []) {
  return executeWithRetry(async () => {
    const result = await db.query(query + ' RETURNING id', params);
    return result.rows[0].id;
  });
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
      return await executeQuery("SELECT id, product_name as fuel_type, current_price as price, is_active, effective_date FROM products WHERE product_type = 'fuel' ORDER BY product_name");
    } catch (error) {
      console.error('Error getting fuel prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-fuel-price', async (event, { fuel_type, price }) => {
    try {
      const updateQuery = 'UPDATE products SET current_price = $1 WHERE product_type = $2 AND product_name = $3';
      return await executeUpdate(updateQuery, [price, 'fuel', fuel_type]);
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
      const updateQuery = 'UPDATE purchase_prices SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2';
      return await executeUpdate(updateQuery, [price, fuel_type]);
    } catch (error) {
      console.error('Error updating purchase price:', error);
      throw error;
    }
  });

  // Oil Prices Handlers
  ipcMain.handle('get-oil-prices', async () => {
    try {
      return await executeQuery("SELECT id, product_name as oil_type, current_price as price, vat, is_active, effective_date FROM products WHERE product_type = 'oil' ORDER BY product_name");
    } catch (error) {
      console.error('Error getting oil prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-oil-price', async (event, { oil_type, price }) => {
    try {
      const updateQuery = 'UPDATE products SET current_price = $1 WHERE product_type = $2 AND product_name = $3';
      const result = await executeUpdate(updateQuery, [price, 'oil', oil_type]);

      // If no rows were updated, insert new product
      if (result === 0) {
        const insertQuery = 'INSERT INTO products (product_type, product_name, current_price) VALUES ($1, $2, $3)';
        return await executeInsert(insertQuery, ['oil', oil_type, price]);
      }
      return result;
    } catch (error) {
      console.error('Error updating oil price:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-oil-product', async (_event, oil_type) => {
    try {
      const deleteQuery = 'DELETE FROM products WHERE product_type = $1 AND product_name = $2';
      return await executeUpdate(deleteQuery, ['oil', oil_type]);
    } catch (error) {
      console.error('Error deleting oil product:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-fuel-product', async (_event, fuel_type) => {
    try {
      const deleteQuery = 'DELETE FROM products WHERE product_type = $1 AND product_name = $2';
      return await executeUpdate(deleteQuery, ['fuel', fuel_type]);
    } catch (error) {
      console.error('Error deleting fuel product:', error);
      throw error;
    }
  });

  // Toggle oil product active status
  ipcMain.handle('toggle-oil-active', async (_event, oil_type) => {
    try {
      const updateQuery = 'UPDATE products SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE product_type = $1 AND product_name = $2';
      return await executeUpdate(updateQuery, ['oil', oil_type]);
    } catch (error) {
      console.error('Error toggling oil active status:', error);
      throw error;
    }
  });

  // Toggle fuel product active status
  ipcMain.handle('toggle-fuel-active', async (_event, fuel_type) => {
    try {
      const updateQuery = 'UPDATE products SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE product_type = $1 AND product_name = $2';
      return await executeUpdate(updateQuery, ['fuel', fuel_type]);
    } catch (error) {
      console.error('Error toggling fuel active status:', error);
      throw error;
    }
  });

  // Add new fuel price
  ipcMain.handle('add-fuel-price', async (event, { fuel_type, price }) => {
    try {
      // Check if fuel type already exists
      const checkQuery = 'SELECT * FROM products WHERE product_type = $1 AND product_name = $2';
      const existing = await executeQuery(checkQuery, ['fuel', fuel_type]);

      if (existing.length > 0) {
        throw new Error('هذا النوع من الوقود موجود بالفعل');
      }

      // Insert new fuel product
      const insertQuery = 'INSERT INTO products (product_type, product_name, current_price) VALUES ($1, $2, $3)';
      return await executeInsert(insertQuery, ['fuel', fuel_type, price]);
    } catch (error) {
      console.error('Error adding fuel price:', error);
      throw error;
    }
  });

  // Add new oil price
  ipcMain.handle('add-oil-price', async (event, { oil_type, price, vat }) => {
    try {
      // Check if oil type already exists
      const checkQuery = 'SELECT * FROM products WHERE product_type = $1 AND product_name = $2';
      const existing = await executeQuery(checkQuery, ['oil', oil_type]);

      if (existing.length > 0) {
        throw new Error('هذا النوع من الزيت موجود بالفعل');
      }

      // Insert new oil product with VAT
      const vatValue = vat || 0;
      const insertQuery = 'INSERT INTO products (product_type, product_name, current_price, vat) VALUES ($1, $2, $3, $4)';
      return await executeInsert(insertQuery, ['oil', oil_type, price, vatValue]);
    } catch (error) {
      console.error('Error adding oil price:', error);
      throw error;
    }
  });

  // Update product name
  ipcMain.handle('update-product-name', async (event, { type, oldName, newName, id }) => {
    try {
      // Check if new name already exists for this product type
      const checkQuery = 'SELECT * FROM products WHERE product_type = $1 AND product_name = $2';
      const existing = await executeQuery(checkQuery, [type, newName]);

      if (existing.length > 0) {
        throw new Error('يوجد منتج بهذا الاسم بالفعل');
      }

      // Update the product name in products table
      // The product_id remains the same, preserving price history
      const updateQuery = 'UPDATE products SET product_name = $1 WHERE product_type = $2 AND product_name = $3';
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
        const productQuery = 'SELECT id FROM products WHERE product_type = $1 AND product_name = $2';
        const productResult = await executeQuery(productQuery, [product_type, product_name]);

        if (productResult.length === 0) {
          console.warn(`Product not found: ${product_type} - ${product_name}`);
          continue;
        }

        const product_id = productResult[0].id;

        // Save to history with product_id
        const historyQuery = 'INSERT INTO price_history (product_type, product_name, price, start_date, product_id) VALUES ($1, $2, $3, $4, $5)';
        await executeInsert(historyQuery, [product_type, product_name, price, start_date, product_id]);

        // Update current price in products table
        const updateQuery = 'UPDATE products SET current_price = $1, effective_date = $2 WHERE id = $3';
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
        query += ' WHERE product_name = $1';
        params.push(filter);
      }

      query += ' ORDER BY created_at DESC LIMIT 100';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting price history:', error);
      throw error;
    }
  });

  ipcMain.handle('get-price-by-date', async (event, { product_name, date }) => {
    try {
      // Get the most recent price that was effective on or before the given date
      const query = `
        SELECT price
        FROM price_history
        WHERE product_name = $1 AND start_date <= $2
        ORDER BY start_date DESC
        LIMIT 1
      `;
      const result = await executeQuery(query, [product_name, date]);

      // If no historical price found, try to get current price from products table
      if (result.length === 0) {
        const currentPriceQuery = `
          SELECT current_price as price
          FROM products
          WHERE product_name = $1
        `;
        const currentResult = await executeQuery(currentPriceQuery, [product_name]);
        return currentResult.length > 0 ? currentResult[0].price : null;
      }

      return result[0].price;
    } catch (error) {
      console.error('Error getting price by date:', error);
      throw error;
    }
  });

  ipcMain.handle('get-sales-report', async (event, { startDate, endDate }) => {
    try {
      const reportQuery = 'SELECT * FROM sales WHERE date BETWEEN $1 AND $2 ORDER BY date DESC';
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
      const insertQuery = 'INSERT INTO oil_movements (oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5)';
      return await executeInsert(insertQuery, [oil_type, date, type, quantity, invoice_number]);
    } catch (error) {
      console.error('Error adding oil movement:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-movements', async (event, oilType) => {
    try {
      const movementsQuery = 'SELECT * FROM oil_movements WHERE oil_type = $1 ORDER BY date DESC, created_at DESC';
      return await executeQuery(movementsQuery, [oilType]);
    } catch (error) {
      console.error('Error getting oil movements:', error);
      throw error;
    }
  });

  ipcMain.handle('get-current-oil-stock', async (event, oilType) => {
    try {
      const stockQuery = 'SELECT type, SUM(quantity) as total FROM oil_movements WHERE oil_type = $1 GROUP BY type';
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
      const insertQuery = 'INSERT INTO fuel_movements (fuel_type, date, type, quantity, invoice_number, notes) VALUES ($1, $2, $3, $4, $5, $6)';
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
        movementsQuery = 'SELECT * FROM fuel_movements WHERE fuel_type = $1 ORDER BY date DESC, created_at DESC';
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
      const stockQuery = 'SELECT type, SUM(quantity) as total FROM fuel_movements WHERE fuel_type = $1 GROUP BY type';
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
        const invoiceQuery = 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, sale_price, total, profit, invoice_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)';
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
        const invoiceQuery = 'INSERT INTO oil_invoices (date, invoice_number, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
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
      const reportQuery = 'SELECT * FROM oil_invoices WHERE date BETWEEN $1 AND $2 ORDER BY date DESC';
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
      const products = await executeQuery('SELECT * FROM products ORDER BY product_type, product_name');
      const purchasePrices = await executeQuery('SELECT * FROM purchase_prices');
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
        products,
        purchasePrices,
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
          const query = 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, sale_price, total, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING';
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
          const query = 'INSERT INTO oil_invoices (date, invoice_number, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING';
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

      // Import products (new format) or legacy fuel/oil prices (old format)
      if (backupData.products) {
        // New format with unified products table
        for (const product of backupData.products) {
          const query = 'INSERT INTO products (product_type, product_name, current_price, vat, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (product_name) DO UPDATE SET current_price = $3, vat = $4, is_active = $5';
          await executeInsert(query, [product.product_type, product.product_name, product.current_price, product.vat || 0, product.is_active !== undefined ? product.is_active : 1]);
        }
      } else {
        // Legacy format - import from old fuelPrices and oilPrices
        if (backupData.fuelPrices) {
          for (const price of backupData.fuelPrices) {
            const query = 'INSERT INTO products (product_type, product_name, current_price) VALUES ($1, $2, $3) ON CONFLICT (product_name) DO UPDATE SET current_price = $3';
            await executeInsert(query, ['fuel', price.fuel_type, price.price]);
          }
        }
        if (backupData.oilPrices) {
          for (const price of backupData.oilPrices) {
            const query = 'INSERT INTO products (product_type, product_name, current_price, vat) VALUES ($1, $2, $3, $4) ON CONFLICT (product_name) DO UPDATE SET current_price = $3, vat = $4';
            await executeInsert(query, ['oil', price.oil_type, price.price, price.vat || 0]);
          }
        }
      }

      // Import purchase prices
      if (backupData.purchasePrices) {
        for (const price of backupData.purchasePrices) {
          const query = 'INSERT INTO purchase_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2';
          await executeInsert(query, [price.fuel_type, price.price]);
        }
      }

      // Import price history
      if (backupData.priceHistory) {
        for (const item of backupData.priceHistory) {
          const query = 'INSERT INTO price_history (product_type, product_name, price, start_date, created_at) VALUES ($1, $2, $3, $4, $5)';
          await executeInsert(query, [item.product_type, item.product_name, item.price, item.start_date, item.created_at]);
        }
      }

      // Import depot movements
      if (backupData.depotMovements) {
        for (const movement of backupData.depotMovements) {
          const query = 'INSERT INTO depot_movements (oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING';
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

  // Initialize autoUpdater after app is ready
  try {
    const { autoUpdater: au } = require('electron-updater');
    autoUpdater = au;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Auto-updater event handlers (registered only if autoUpdater is available)
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
  } catch (err) {
    console.log('AutoUpdater not available:', err.message);
  }

  // Check for updates after window is created (if auto-check is enabled)
  setTimeout(() => {
    // Will be triggered by renderer after checking localStorage
  }, 3000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// IPC handlers for manual update actions
ipcMain.on('download-update', () => {
  if (autoUpdater) {
    autoUpdater.downloadUpdate();
  } else {
    console.log('AutoUpdater not available');
  }
});

ipcMain.on('install-update', () => {
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
  } else {
    console.log('AutoUpdater not available');
  }
});

// Manual update check from settings
ipcMain.on('check-for-updates-manual', () => {
  if (autoUpdater) {
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
  } else {
    console.log('AutoUpdater not available');
    if (mainWindow) {
      mainWindow.webContents.send('update-check-result', {
        available: false,
        error: 'AutoUpdater not available'
      });
    }
  }
});

// Customer management handlers
ipcMain.handle('get-customers', async () => {
  try {
    return await executeQuery('SELECT * FROM customers ORDER BY name');
  } catch (error) {
    console.error('Error getting customers:', error);
    throw error;
  }
});

ipcMain.handle('add-customer', async (event, { name }) => {
  try {
    const insertQuery = 'INSERT INTO customers (name) VALUES ($1)';
    return await executeInsert(insertQuery, [name]);
  } catch (error) {
    console.error('Error adding customer:', error);
    throw error;
  }
});

ipcMain.handle('delete-customer', async (event, { id }) => {
  try {
    const deleteQuery = 'DELETE FROM customers WHERE id = $1';
    return await executeUpdate(deleteQuery, [id]);
  } catch (error) {
    console.error('Error deleting customer:', error);
    throw error;
  }
});

ipcMain.handle('update-customer', async (event, { id, name }) => {
  try {
    const updateQuery = 'UPDATE customers SET name = $1 WHERE id = $2';
    return await executeUpdate(updateQuery, [name, id]);
  } catch (error) {
    console.error('Error updating customer:', error);
    throw error;
  }
});

// Shift management handlers
ipcMain.handle('save-shift', async (event, shiftData) => {
  try {
    const { date, shift_number, data } = shiftData;
    const query = `
      INSERT INTO shifts (date, shift_number, data, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (date, shift_number)
      DO UPDATE SET data = $3, updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const result = await db.query(query, [date, shift_number, JSON.stringify(data)]);
    return result.rows[0].id;
  } catch (error) {
    console.error('Error saving shift:', error);
    throw error;
  }
});

ipcMain.handle('get-shift', async (event, { date, shift_number }) => {
  try {
    const query = 'SELECT * FROM shifts WHERE date = $1 AND shift_number = $2';
    const result = await executeQuery(query, [date, shift_number]);
    if (result.length > 0) {
      // Parse the JSONB data field
      return {
        ...result[0],
        data: typeof result[0].data === 'string' ? JSON.parse(result[0].data) : result[0].data
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting shift:', error);
    throw error;
  }
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
    await db.end();
  }
});
