const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Delay autoUpdater import to avoid initialization issues
let autoUpdater;

let mainWindow;
let db; // PostgreSQL client (Supabase)

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
    is_active INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add vat column if it doesn't exist (migration)
  try {
    await db.query(`ALTER TABLE oil_prices ADD COLUMN IF NOT EXISTS vat REAL DEFAULT 0`);
  } catch (err) {
    // Column might already exist, ignore error
    console.log('VAT column migration: ', err.message);
  }

  // Add is_active column if it doesn't exist (migration)
  try {
    await db.query(`ALTER TABLE oil_prices ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1`);
  } catch (err) {
    // Column might already exist, ignore error
    console.log('is_active column migration: ', err.message);
  }

  // Update existing oils to be active by default
  try {
    await db.query(`UPDATE oil_prices SET is_active = 1 WHERE is_active IS NULL`);
    console.log('Existing oils set as active');
  } catch (err) {
    console.log('Error setting existing oils as active:', err.message);
  }

  // Products table (unified table for fuel and oil products)
  await db.query(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    product_type TEXT NOT NULL,
    product_name TEXT NOT NULL,
    current_price REAL NOT NULL,
    effective_date DATE DEFAULT CURRENT_DATE,
    vat REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_type, product_name)
  )`);

  // Migrate fuel prices to products table if products is empty
  try {
    const productCount = await db.query('SELECT COUNT(*) FROM products');
    if (productCount.rows[0].count === '0') {
      await db.query(`INSERT INTO products (product_type, product_name, current_price, effective_date, is_active)
        SELECT 'fuel', fuel_type, price, CURRENT_DATE, 1 FROM fuel_prices
        ON CONFLICT (product_type, product_name) DO NOTHING`);
      await db.query(`INSERT INTO products (product_type, product_name, current_price, effective_date, vat, is_active)
        SELECT 'oil', oil_type, price, CURRENT_DATE, COALESCE(vat, 0), COALESCE(is_active, 1) FROM oil_prices
        ON CONFLICT (product_type, product_name) DO NOTHING`);
      console.log('Migrated existing fuel and oil prices to products table');
    }
  } catch (err) {
    console.log('Error migrating to products table:', err.message);
  }

  // Customers table
  await db.query(`CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Price history table
  await db.query(`CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    product_id INTEGER,
    product_type TEXT NOT NULL,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    start_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add product_id column if it doesn't exist (migration)
  try {
    await db.query(`ALTER TABLE price_history ADD COLUMN IF NOT EXISTS product_id INTEGER`);
  } catch (err) {
    // Column might already exist, ignore error
    console.log('product_id column migration: ', err.message);
  }

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

  // Shifts table for daily shift tracking
  await db.query(`CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    shift_number INTEGER NOT NULL,
    fuel_data TEXT NOT NULL,
    fuel_total REAL NOT NULL,
    oil_data TEXT NOT NULL,
    oil_total REAL NOT NULL,
    grand_total REAL NOT NULL,
    is_saved INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, shift_number)
  )`);
}

// Database helper functions (PostgreSQL only)
function executeQuery(query, params = []) {
  return db.query(query, params).then(result => result.rows);
}

function executeUpdate(query, params = []) {
  return db.query(query, params).then(result => result.rowCount);
}

function executeInsert(query, params = []) {
  return db.query(query + ' RETURNING id', params).then(result => result.rows[0].id);
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
      const updateQuery = 'UPDATE fuel_prices SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2';
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
      return await executeQuery("SELECT id, product_name as oil_type, current_price as price, vat, effective_date, is_active FROM products WHERE product_type = 'oil' ORDER BY product_name");
    } catch (error) {
      console.error('Error getting oil prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-oil-price', async (event, { oil_type, price }) => {
    try {
      const checkQuery = 'SELECT * FROM oil_prices WHERE oil_type = $1';
      const existing = await executeQuery(checkQuery, [oil_type]);

      if (existing.length > 0) {
        const updateQuery = 'UPDATE oil_prices SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE oil_type = $2';
        return await executeUpdate(updateQuery, [price, oil_type]);
      } else {
        const insertQuery = 'INSERT INTO oil_prices (oil_type, price) VALUES ($1, $2)';
        return await executeInsert(insertQuery, [oil_type, price]);
      }
    } catch (error) {
      console.error('Error updating oil price:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-oil-product', async (_event, oil_type) => {
    try {
      const deleteQuery = "DELETE FROM products WHERE product_name = $1 AND product_type = 'oil'";
      const result = await executeUpdate(deleteQuery, [oil_type]);
      console.log(`Deleted oil product: ${oil_type}, result:`, result);
      return result;
    } catch (error) {
      console.error('Error deleting oil product:', error);
      throw error;
    }
  });

  ipcMain.handle('toggle-oil-active', async (_event, oil_type, isActive) => {
    try {
      const updateQuery = "UPDATE products SET is_active = ? WHERE product_name = ? AND product_type = 'oil'";
      return await executeUpdate(updateQuery, [isActive ? 1 : 0, oil_type]);
    } catch (error) {
      console.error('Error toggling oil active status:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-fuel-product', async (_event, fuel_type) => {
    try {
      const deleteQuery = "DELETE FROM products WHERE product_name = $1 AND product_type = 'fuel'";
      const result = await executeUpdate(deleteQuery, [fuel_type]);
      console.log(`Deleted fuel product: ${fuel_type}, result:`, result);
      return result;
    } catch (error) {
      console.error('Error deleting fuel product:', error);
      throw error;
    }
  });

  // Add new fuel price
  ipcMain.handle('add-fuel-price', async (event, { fuel_type, price }) => {
    try {
      // Check if fuel type already exists
      const checkQuery = 'SELECT * FROM fuel_prices WHERE fuel_type = $1';
      const existing = await executeQuery(checkQuery, [fuel_type]);

      if (existing.length > 0) {
        throw new Error('هذا النوع من الوقود موجود بالفعل');
      }

      // Insert new fuel price (with conflict handling to prevent duplicates)
      const insertQuery = 'INSERT INTO fuel_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2, updated_at = CURRENT_TIMESTAMP';
      const result = await executeInsert(insertQuery, [fuel_type, price]);

      // Also add to products table
      const productInsertQuery = 'INSERT INTO products (product_type, product_name, current_price, effective_date, is_active) VALUES ($1, $2, $3, CURRENT_DATE, 1) ON CONFLICT (product_type, product_name) DO UPDATE SET current_price = $3';
      await executeInsert(productInsertQuery, ['fuel', fuel_type, price]);

      return result;
    } catch (error) {
      console.error('Error adding fuel price:', error);
      throw error;
    }
  });

  // Add new oil price
  ipcMain.handle('add-oil-price', async (event, { oil_type, price, vat }) => {
    try {
      // Check if oil type already exists
      const checkQuery = 'SELECT * FROM oil_prices WHERE oil_type = $1';
      const existing = await executeQuery(checkQuery, [oil_type]);

      if (existing.length > 0) {
        throw new Error('هذا النوع من الزيت موجود بالفعل');
      }

      // Insert new oil price with VAT (with conflict handling to prevent duplicates)
      const vatValue = vat || 0;
      const insertQuery = 'INSERT INTO oil_prices (oil_type, price, vat) VALUES ($1, $2, $3) ON CONFLICT (oil_type) DO UPDATE SET price = $2, vat = $3, updated_at = CURRENT_TIMESTAMP';
      const result = await executeInsert(insertQuery, [oil_type, price, vatValue]);

      // Also add to products table
      const productInsertQuery = 'INSERT INTO products (product_type, product_name, current_price, vat, effective_date, is_active) VALUES ($1, $2, $3, $4, CURRENT_DATE, 1) ON CONFLICT (product_type, product_name) DO UPDATE SET current_price = $3, vat = $4';
      await executeInsert(productInsertQuery, ['oil', oil_type, price, vatValue]);

      return result;
    } catch (error) {
      console.error('Error adding oil price:', error);
      throw error;
    }
  });

  // ============= CUSTOMERS HANDLERS =============

  // Get all customers
  ipcMain.handle('get-customers', async () => {
    try {
      const query = 'SELECT * FROM customers ORDER BY name';
      const customers = await executeQuery(query);
      return customers;
    } catch (error) {
      console.error('Error fetching customers:', error);
      throw error;
    }
  });

  // Add customer
  ipcMain.handle('add-customer', async (event, { name }) => {
    try {
      const insertQuery = 'INSERT INTO customers (name) VALUES ($1) RETURNING *';
      const result = await executeInsert(insertQuery, [name]);
      return result;
    } catch (error) {
      console.error('Error adding customer:', error);
      if (error.message.includes('UNIQUE')) {
        throw new Error('عميل بهذا الاسم موجود بالفعل');
      }
      throw error;
    }
  });

  // Delete customer
  ipcMain.handle('delete-customer', async (event, { id }) => {
    try {
      const deleteQuery = 'DELETE FROM customers WHERE id = $1';
      await executeQuery(deleteQuery, [id]);
      return { success: true };
    } catch (error) {
      console.error('Error deleting customer:', error);
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

  // Get price by date - finds the price valid for a given date
  ipcMain.handle('get-price-by-date', async (event, { product_name, date }) => {
    try {
      // First check price_history for a price effective on or before the given date
      const historyQuery = 'SELECT price FROM price_history WHERE product_name = $1 AND start_date <= $2 ORDER BY start_date DESC LIMIT 1';

      const historyResult = await executeQuery(historyQuery, [product_name, date]);

      if (historyResult && historyResult.length > 0) {
        return historyResult[0].price;
      }

      // If no history found, get current price from products table
      const currentQuery = "SELECT current_price FROM products WHERE product_name = $1";

      const currentResult = await executeQuery(currentQuery, [product_name]);

      if (currentResult && currentResult.length > 0) {
        return currentResult[0].current_price;
      }

      return null;
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

      // Import fuel prices
      if (backupData.fuelPrices) {
        for (const price of backupData.fuelPrices) {
          const query = 'INSERT INTO fuel_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2';
          await executeInsert(query, [price.fuel_type, price.price]);
        }
      }

      // Import purchase prices
      if (backupData.purchasePrices) {
        for (const price of backupData.purchasePrices) {
          const query = 'INSERT INTO purchase_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2';
          await executeInsert(query, [price.fuel_type, price.price]);
        }
      }

      // Import oil prices
      if (backupData.oilPrices) {
        for (const price of backupData.oilPrices) {
          const query = 'INSERT INTO oil_prices (oil_type, price) VALUES ($1, $2) ON CONFLICT (oil_type) DO UPDATE SET price = $2';
          await executeInsert(query, [price.oil_type, price.price]);
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

  // ============================================================
  // SHIFT ENTRY IPC HANDLERS
  // ============================================================

  // Save or update shift
  ipcMain.handle('save-shift', async (_event, shiftData) => {
    try {
      const { date, shift_number, fuel_data, fuel_total, oil_data, oil_total, grand_total, is_saved } = shiftData;

        // PostgreSQL: Use INSERT ... ON CONFLICT
        const query = `
          INSERT INTO shifts (date, shift_number, fuel_data, fuel_total, oil_data, oil_total, grand_total, is_saved, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
          ON CONFLICT (date, shift_number)
          DO UPDATE SET
            fuel_data = $3,
            fuel_total = $4,
            oil_data = $5,
            oil_total = $6,
            grand_total = $7,
            is_saved = $8,
            updated_at = CURRENT_TIMESTAMP
        `;
        await db.query(query, [date, shift_number, fuel_data, fuel_total, oil_data, oil_total, grand_total, is_saved]);

      return { success: true };
    } catch (error) {
      console.error('Error saving shift:', error);
      return { success: false, error: error.message };
    }
  });

  // Get shift by date and shift number
  ipcMain.handle('get-shift', async (_event, { date, shift_number }) => {
    try {
      const query = 'SELECT * FROM shifts WHERE date = $1 AND shift_number = $2';

      const results = await executeQuery(query, [date, shift_number]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error getting shift:', error);
      throw error;
    }
  });

  // Get shifts history with optional date filters
  ipcMain.handle('get-shifts-history', async (_event, { startDate, endDate } = {}) => {
    try {
      let query = 'SELECT * FROM shifts WHERE is_saved = 1';
      const params = [];

      if (startDate && endDate) {
          query += ' AND date BETWEEN $1 AND $2';
        params.push(startDate, endDate);
      } else if (startDate) {
          query += ' AND date >= $1';
        params.push(startDate);
      } else if (endDate) {
          query += ' AND date <= $1';
        params.push(endDate);
      }

      query += ' ORDER BY date DESC, shift_number DESC';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting shifts history:', error);
      throw error;
    }
  });

  // Get app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
} // End of setupIPCHandlers

app.whenReady().then(async () => {
  // Import and configure autoUpdater after app is ready
  const { autoUpdater: au } = require('electron-updater');
  autoUpdater = au;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Enable updates in development mode
  if (!app.isPackaged) {
    autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
    console.log('AutoUpdater: Using dev config from', path.join(__dirname, 'dev-app-update.yml'));
  } else {
    // In production, explicitly set the provider configuration
    try {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'g-momo5',
        repo: 'CO-OP'
      });
      console.log('AutoUpdater: Configured for GitHub repository g-momo5/CO-OP');
    } catch (error) {
      console.error('AutoUpdater: Error setting feed URL:', error);
    }
  }

  await initializeDatabase();
  setupIPCHandlers();
  createWindow();

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
    if (mainWindow) {
      mainWindow.webContents.send('update-error', {
        message: err.message || 'حدث خطأ أثناء تحديث التطبيق',
        error: err.toString()
      });
    }
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
  ipcMain.on('download-update', async () => {
    console.log('AutoUpdater: Starting download...');
    try {
      const result = await autoUpdater.downloadUpdate();
      console.log('AutoUpdater: Download initiated successfully', result);
    } catch (error) {
      console.error('AutoUpdater: Error downloading update:', error);
      console.error('AutoUpdater: Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno
      });
      if (mainWindow) {
        mainWindow.webContents.send('update-error', {
          message: error.message || 'فشل تنزيل التحديث',
          error: error.toString(),
          code: error.code
        });
      }
    }
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

  // Check for updates after window is created (if auto-check is enabled)
  setTimeout(() => {
    // Will be triggered by renderer after checking localStorage
  }, 3000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});

app.on('before-quit', async () => {
  if (db) {
      await db.end();
  }
});
