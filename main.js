const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
// Note: autoUpdater initialized after app.whenReady() to avoid initialization issues
const path = require('path');
const DatabaseManager = require('./database-manager');
const SyncManager = require('./sync-manager');

let mainWindow;
let dbManager; // DatabaseManager instance (replaces db)
let syncManager; // SyncManager instance
let autoUpdater; // Initialized after app is ready
let connectionCheckInterval; // Interval for checking connection status

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

  // Prevent close dialog when installing update
  mainWindow.on('close', (e) => {
    if (app.isQuitting) {
      // Allow close when quitting for update
      return;
    }
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

async function initializeDatabase() {
  // Initialize DatabaseManager with 5 second timeout
  dbManager = new DatabaseManager(app);
  syncManager = new SyncManager(dbManager);

  const result = await dbManager.initialize(5000);

  if (!result.online) {
    // Show offline warning to user after window is created
    console.log('تحذير: التطبيق يعمل في وضع عدم الاتصال');
  }

  // PostgreSQL tables creation and schema migration now happen inside DatabaseManager.initialize()

  return result;
}

// Database helper functions - Now delegated to DatabaseManager
function executeQuery(query, params = []) {
  return dbManager.executeQuery(query, params);
}

function executeUpdate(query, params = []) {
  return dbManager.executeUpdate(query, params);
}

function executeInsert(query, params = [], tableName = 'unknown') {
  return dbManager.executeInsert(query, params, tableName);
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

        // Get product_id and current effective_date from products table
        const productQuery = 'SELECT id, effective_date FROM products WHERE product_type = $1 AND product_name = $2';
        const productResult = await executeQuery(productQuery, [product_type, product_name]);

        if (productResult.length === 0) {
          console.warn(`Product not found: ${product_type} - ${product_name}`);
          continue;
        }

        const product_id = productResult[0].id;
        const current_effective_date = productResult[0].effective_date;

        // Save to history with product_id (always save to history)
        const historyQuery = 'INSERT INTO price_history (product_type, product_name, price, start_date, product_id) VALUES ($1, $2, $3, $4, $5)';
        await executeInsert(historyQuery, [product_type, product_name, price, start_date, product_id]);

        // Update current price in products table ONLY if new date is more recent
        // If no current date exists, always update
        if (!current_effective_date || new Date(start_date) >= new Date(current_effective_date)) {
          const updateQuery = 'UPDATE products SET current_price = $1, effective_date = $2 WHERE id = $3';
          await executeUpdate(updateQuery, [price, start_date, product_id]);
          console.log(`Updated current price for ${product_name}: ${price} (effective: ${start_date})`);
        } else {
          console.log(`Skipped updating current price for ${product_name}: new date ${start_date} is older than current ${current_effective_date}`);
        }
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
        const invoiceQuery = 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        await executeInsert(invoiceQuery, [
          date,
          invoice_number,
          item.fuel_type,
          item.quantity,
          item.net_quantity,
          item.purchase_price,
          item.total
        ], 'fuel_invoices');
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
        await executeInsert(invoiceQuery, [date, invoice_number, item.oil_type, item.quantity, item.purchase_price, item.iva, item.total_purchase, immediate_discount || 0, martyrs_tax || 0], 'oil_invoices');
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
          const query = 'INSERT INTO fuel_invoices (date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING';
          await executeInsert(query, [
            invoice.date,
            invoice.invoice_number,
            invoice.fuel_type,
            invoice.quantity,
            invoice.net_quantity,
            invoice.purchase_price,
            invoice.total
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

  // Sync-related IPC handlers
  ipcMain.handle('manual-sync', async () => {
    try {
      if (!dbManager.isOnline) {
        return { success: false, error: 'لا يوجد اتصال بالإنترنت' };
      }

      const result = await syncManager.syncAll();
      return result;
    } catch (error) {
      console.error('Manual sync failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-sync-status', async () => {
    return syncManager.getSyncStatus();
  });

  ipcMain.handle('get-connection-status', async () => {
    return {
      online: dbManager.isOnline,
      lastSync: dbManager.lastSyncTime,
      pending: dbManager.getPendingSyncCount()
    };
  });
} // End of setupIPCHandlers

app.whenReady().then(async () => {
  // Initialize database (with 5 second timeout)
  const dbResult = await initializeDatabase();

  setupIPCHandlers();
  createWindow();

  // Show offline warning if needed (after 2 seconds to let UI load)
  if (!dbResult.online) {
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send('offline-mode-warning', {
          message: 'تعمل في وضع عدم الاتصال. سيتم مزامنة البيانات عند استعادة الاتصال بالإنترنت.',
          offline: true
        });
      }
    }, 2000);
  }

  // Start connection monitoring (check every 10 seconds)
  connectionCheckInterval = setInterval(async () => {
    const wasOnline = dbManager.isOnline;
    const isNowOnline = net.isOnline() && await dbManager.checkConnection();

    if (!wasOnline && isNowOnline) {
      // Connection restored!
      dbManager.isOnline = true;
      console.log('📡 Connection restored, starting automatic sync...');

      if (mainWindow) {
        mainWindow.webContents.send('connection-status', {
          online: true,
          syncing: true
        });
      }

      // Trigger automatic sync
      try {
        const syncResult = await syncManager.syncAll();
        console.log('✅ Auto-sync completed:', syncResult);

        if (mainWindow) {
          mainWindow.webContents.send('sync-completed', {
            success: syncResult.success,
            synced: syncResult.synced,
            failed: syncResult.failed,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('❌ Auto-sync failed:', error);
      }
    } else if (wasOnline && !isNowOnline) {
      // Connection lost
      dbManager.isOnline = false;
      console.log('📡 Connection lost, switching to offline mode');

      if (mainWindow) {
        mainWindow.webContents.send('connection-status', {
          online: false,
          syncing: false
        });
      }
    }

    // Send status update to renderer
    if (mainWindow) {
      const status = syncManager.getSyncStatus();
      mainWindow.webContents.send('sync-status-update', status);
    }
  }, 10000);

  // Initialize autoUpdater after app is ready (only if online)
  try {
    const { autoUpdater: au } = require('electron-updater');
    autoUpdater = au;

    // Configurazione auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Fix per Windows: forza il download differenziale se disponibile
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;

    // Logger per debugging
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';

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
      if (mainWindow) {
        // Invia errore al renderer per mostrare all'utente
        mainWindow.webContents.send('update-error', { message: err.message });
      }
    });

    // Evento download-progress con fallback manuale per Windows
    let lastProgress = 0;
    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent) || 0;

      // Log dettagliato
      console.log(`Download progress: ${percent}% (${progressObj.transferred}/${progressObj.total} bytes)`);
      console.log(`Speed: ${Math.round(progressObj.bytesPerSecond / 1024)} KB/s`);

      if (mainWindow) {
        mainWindow.webContents.send('download-progress', {
          percent: percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
          bytesPerSecond: progressObj.bytesPerSecond
        });
      }

      lastProgress = percent;
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded');

      // Forza invio 100% se non è stato ricevuto
      if (lastProgress < 100 && mainWindow) {
        mainWindow.webContents.send('download-progress', {
          percent: 100,
          transferred: info.files?.[0]?.size || 0,
          total: info.files?.[0]?.size || 0,
          bytesPerSecond: 0
        });
      }

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
    console.log('User requested update installation, quitting and installing...');
    // Close all windows first
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(win => {
      if (win !== mainWindow) {
        win.close();
      }
    });

    // quitAndInstall parameters:
    // isSilent: false (show installation progress)
    // isForceRunAfter: true (force app to run after update)
    setImmediate(() => {
      app.isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    });
  } else {
    console.log('AutoUpdater not available');
  }
});

// Manual update check from settings
ipcMain.on('check-for-updates-manual', () => {
  if (autoUpdater) {
    autoUpdater.checkForUpdates().then(result => {
      if (mainWindow && result && result.updateInfo) {
        mainWindow.webContents.send('update-check-result', {
          available: result.updateInfo.version !== app.getVersion(),
          version: result.updateInfo.version,
          releaseNotes: result.updateInfo.releaseNotes
        });
      } else if (mainWindow) {
        mainWindow.webContents.send('update-check-result', {
          available: false,
          error: 'No update info available'
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
  // Stop connection monitoring
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }

  // Close database connections
  if (dbManager) {
    dbManager.close();
  }
});
