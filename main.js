const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
// Note: autoUpdater initialized after app.whenReady() to avoid initialization issues
const path = require('path');
const util = require('util');
const DatabaseManager = require('./database-manager');
const SyncManager = require('./sync-manager');

let mainWindow;
let splashWindow = null;
let dbManager; // DatabaseManager instance (replaces db)
let syncManager; // SyncManager instance
let autoUpdater; // Initialized after app is ready
let connectionCheckInterval; // Interval for checking connection status
let startupPhase = { progress: 0, message: '', level: 'info' };
let startupConsoleRestore = null;
let mainWindowReady = false;
let rendererBootstrapReady = false;
let startupFallbackTimer = null;
let startupComplete = false;
let isForceClosingWindow = false; // Allow close after explicit user confirmation
// Screens and sections that are limited when offline
const OFFLINE_RESTRICTED = {
  screens: ['report', 'charts'],
  settingsSections: ['invoices-list', 'backup'],
  reads: [
    'get-sales',
    'get-sales-report',
    'get-sales-summary',
    'get-fuel-invoices',
    'get-oil-invoices',
    'get-oil-invoices-report',
    'get-price-history'
  ]
};
const LEGACY_AGGREGATED_EXPENSE_LABEL = 'مصروفات مجمعة (بيانات قديمة)';

function toFiniteNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStoredObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizeFilterMonthKey(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : null;
}

function getMonthRangeBounds(fromMonth, toMonth) {
  const startMonth = normalizeFilterMonthKey(fromMonth);
  const endMonth = normalizeFilterMonthKey(toMonth);

  if (!startMonth || !endMonth || startMonth > endMonth) {
    return null;
  }

  const [endYearText, endMonthText] = endMonth.split('-');
  const endYear = parseInt(endYearText, 10);
  const endMonthNumber = parseInt(endMonthText, 10);
  if (!Number.isFinite(endYear) || !Number.isFinite(endMonthNumber)) {
    return null;
  }

  const lastDay = new Date(endYear, endMonthNumber, 0).getDate();
  return {
    startDate: `${startMonth}-01`,
    endDate: `${endMonth}-${String(lastDay).padStart(2, '0')}`
  };
}

function normalizeExpenseItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, fallbackIndex) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const amount = parseOptionalNumber(item.amount);
      if (amount === null || amount <= 0) {
        return null;
      }

      const index = parseInt(item.index, 10);
      return {
        index: Number.isFinite(index) && index > 0 ? index : fallbackIndex + 1,
        description: String(item.description || '').trim(),
        amount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function buildShiftExpenseSnapshot(shiftRow) {
  const legacyData = parseStoredObject(shiftRow?.data, {});
  const expenseItems = normalizeExpenseItems(legacyData.expense_items);
  const totalExpenses = toFiniteNumber(shiftRow?.total_expenses ?? legacyData.total_expenses);

  return {
    legacyData,
    expenseItems,
    totalExpenses
  };
}

function getAppIconPath() {
  return process.platform === 'darwin'
    ? path.join(__dirname, 'assets', 'logo_cpc.icns')
    : path.join(__dirname, 'assets', 'logo_cpc.png');
}

function clearStartupFallbackTimer() {
  if (!startupFallbackTimer) {
    return;
  }

  clearTimeout(startupFallbackTimer);
  startupFallbackTimer = null;
}

function restoreStartupConsoleMirror() {
  if (typeof startupConsoleRestore === 'function') {
    startupConsoleRestore();
  }
}

function destroySplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
  }

  splashWindow = null;
}

function normalizeStartupMessage(message) {
  return String(message ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatStartupLogArgs(args) {
  return normalizeStartupMessage(args.map((arg) => {
    if (arg instanceof Error) {
      return arg.stack || arg.message;
    }

    if (typeof arg === 'string') {
      return arg;
    }

    return util.inspect(arg, {
      depth: 2,
      breakLength: Infinity,
      compact: true
    });
  }).join(' '));
}

function emitStartupStatus(message, progress = startupPhase.progress, level = 'info') {
  const nextProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : startupPhase.progress;
  const nextMessage = normalizeStartupMessage(message) || startupPhase.message;
  const nextLevel = level === 'warn' || level === 'error' ? level : 'info';

  startupPhase = {
    progress: nextProgress,
    message: nextMessage,
    level: nextLevel
  };

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('startup-status', startupPhase);
  }
}

function installStartupConsoleMirror() {
  if (typeof startupConsoleRestore === 'function') {
    return startupConsoleRestore;
  }

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args) => {
    originalLog(...args);
    const message = formatStartupLogArgs(args);
    if (message) {
      emitStartupStatus(message, startupPhase.progress, 'info');
    }
  };

  console.warn = (...args) => {
    originalWarn(...args);
    const message = formatStartupLogArgs(args);
    if (message) {
      emitStartupStatus(message, startupPhase.progress, 'warn');
    }
  };

  console.error = (...args) => {
    originalError(...args);
    const message = formatStartupLogArgs(args);
    if (message) {
      emitStartupStatus(message, startupPhase.progress, 'error');
    }
  };

  startupConsoleRestore = () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    startupConsoleRestore = null;
  };

  return startupConsoleRestore;
}

function finalizeStartupIfReady() {
  if (startupComplete || !mainWindowReady || !rendererBootstrapReady) {
    return;
  }

  emitStartupStatus('Interfaccia pronta', 100, 'info');
  startupComplete = true;
  clearStartupFallbackTimer();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  destroySplashWindow();
  restoreStartupConsoleMirror();
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return Promise.resolve(splashWindow);
  }

  const iconPath = getAppIconPath();

  return new Promise((resolve, reject) => {
    let resolved = false;

    splashWindow = new BrowserWindow({
      width: 560,
      height: 360,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      show: false,
      autoHideMenuBar: true,
      icon: iconPath,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    splashWindow.on('closed', () => {
      splashWindow = null;
    });

    splashWindow.webContents.on('did-finish-load', () => {
      if (startupPhase.message && splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('startup-status', startupPhase);
      }
    });

    splashWindow.once('ready-to-show', () => {
      if (!splashWindow || splashWindow.isDestroyed()) {
        return;
      }

      splashWindow.show();
      resolved = true;
      resolve(splashWindow);
    });

    splashWindow.loadFile('loading.html').catch((error) => {
      if (!resolved) {
        reject(error);
      }
    });
  });
}

function createWindow({ deferShow = false } = {}) {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !deferShow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: iconPath,
    title: 'محطة بنزين سمنود - الجمعية التعاونية للبترول - مصر'
  });

  if (deferShow) {
    mainWindowReady = false;
    clearStartupFallbackTimer();
    startupFallbackTimer = setTimeout(() => {
      if (startupComplete) {
        return;
      }

      emitStartupStatus('Avvio prolungato, apertura interfaccia...', 88, 'warn');
      startupComplete = true;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }

      destroySplashWindow();
      clearStartupFallbackTimer();
      restoreStartupConsoleMirror();
      console.warn('Renderer bootstrap timeout, showing main window before bootstrap completed');
    }, 12000);

    mainWindow.once('ready-to-show', () => {
      mainWindowReady = true;
      emitStartupStatus('Finestra principale pronta', 88, 'info');
      finalizeStartupIfReady();
    });
  } else {
    mainWindowReady = true;
  }

  mainWindow.loadFile('index.html');

  // Handle close on macOS/windows with confirmation outside home screen
  mainWindow.on('close', (e) => {
    if (app.isQuitting || isForceClosingWindow) {
      return;
    }

    e.preventDefault();

    const handleClose = async () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      let currentScreen = 'home';
      try {
        currentScreen = await mainWindow.webContents.executeJavaScript(
          "window.__currentScreen || 'home'",
          true
        );
      } catch (err) {
        console.warn('Unable to read current screen before close:', err.message);
      }

      if (currentScreen !== 'home') {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['إغلاق', 'إلغاء'],
          defaultId: 1,
          cancelId: 1,
          title: 'تأكيد الإغلاق',
          message: 'سيتم فقدان المعلومات غير المحفوظة.'
        });

        if (response !== 0) {
          return;
        }
      }

      try {
        await mainWindow.webContents.executeJavaScript('window.__skipBeforeUnloadWarning = true;', true);
      } catch (_err) {
        // Ignore renderer sync errors and continue closing
      }

      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      isForceClosingWindow = true;
      mainWindow.close();
    };

    handleClose().catch((err) => {
      console.error('Error while handling app close:', err);
    });
  });

  mainWindow.on('closed', () => {
    isForceClosingWindow = false;
    if (mainWindow && mainWindow.isDestroyed()) {
      mainWindow = null;
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

function requireOnline(featureName = 'هذه الوظيفة') {
  if (!dbManager?.isOnline) {
    const err = new Error(`${featureName} تتطلب اتصالاً بالإنترنت`);
    err.code = 'OFFLINE_RESTRICTED';
    throw err;
  }
}

// IPC Handlers setup function
function setupIPCHandlers() {
  const PROFIT_MANUAL_FIELDS = [
    'fuel_diesel',
    'fuel_80',
    'fuel_92',
    'fuel_95',
    'oil_total',
    'bonuses',
    'commission_diff',
    'deposit_tax',
    'bonus_tax'
  ];

  const toNumber = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeMonthKey = (value) => {
    const monthKey = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
    return monthKey;
  };

  const parseJsonObject = (value, fallback = null) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }

    if (typeof value !== 'string' || !value.trim()) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (_error) {
      return fallback;
    }
  };

  const getShiftFuelProfitValue = (shiftRow, fuelType) => {
    const normalizedFuelType = String(fuelType || '').trim();
    if (!normalizedFuelType) {
      return 0;
    }

    let fuelData = parseJsonObject(shiftRow?.fuel_data, null);

    if (!fuelData) {
      const legacyData = parseJsonObject(shiftRow?.data, null);
      fuelData = parseJsonObject(legacyData?.fuel_data, null);
    }

    const fuelEntry = fuelData && typeof fuelData === 'object' ? fuelData[normalizedFuelType] : null;
    if (!fuelEntry || typeof fuelEntry !== 'object') {
      return 0;
    }

    const totalQuantity = toNumber(fuelEntry.totalQuantity);
    const cars = toNumber(fuelEntry.cars);
    const price = toNumber(fuelEntry.price);
    return (totalQuantity - cars) * price;
  };

  const normalizeFuelProfitKey = (fuelType) => {
    const normalizedFuelType = String(fuelType || '').trim();
    switch (normalizedFuelType) {
      case 'سولار':
        return 'fuel_diesel';
      case 'بنزين ٨٠':
        return 'fuel_80';
      case 'بنزين ٩٢':
        return 'fuel_92';
      case 'بنزين ٩٥':
        return 'fuel_95';
      default:
        return null;
    }
  };

  const normalizeProfitCustomRowType = (value) => {
    const rowType = String(value || '').trim();
    return rowType === 'deduction' ? 'deduction' : 'revenue';
  };

  const normalizeProfitCustomRowLabel = (label, rowType) => {
    const rawLabel = String(label || '').trim();
    if (rawLabel) return rawLabel;
    return rowType === 'deduction' ? 'خصم إضافي' : 'إيراد إضافي';
  };

  const generateProfitCustomRowKey = (rowType) => {
    const suffix = Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, '0');
    return `${rowType}_${Date.now()}_${suffix}`;
  };

  const monthToRange = (monthKey) => {
    const normalized = normalizeMonthKey(monthKey);
    if (!normalized) return null;
    const [yearText, monthText] = normalized.split('-');
    const year = parseInt(yearText, 10);
    const month = parseInt(monthText, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    const startDate = `${normalized}-01`;
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10);
    return { startDate, endDate };
  };

  const buildMonthRange = (fromMonth, toMonth) => {
    const start = normalizeMonthKey(fromMonth);
    const end = normalizeMonthKey(toMonth);
    if (!start || !end) return [];
    if (start > end) return [];

    const range = [];
    const [startYear, startMonth] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);
    const cursor = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth - 1, 1);

    while (cursor <= endDate) {
      range.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return range;
  };

  const collectAvailableProfitMonths = async () => {
    const monthSet = new Set();
    const addMonth = (rawMonth) => {
      const monthKey = normalizeMonthKey(String(rawMonth || '').slice(0, 7));
      if (monthKey) monthSet.add(monthKey);
    };

    try {
      const rows = await executeQuery('SELECT month_key FROM monthly_profit_inputs ORDER BY month_key ASC');
      rows.forEach((row) => addMonth(row.month_key));
    } catch (error) {
      console.warn('Unable to read monthly_profit_inputs months:', error.message);
    }

    try {
      const rows = await executeQuery('SELECT SUBSTR(date, 1, 7) AS month_key FROM shifts WHERE date IS NOT NULL');
      rows.forEach((row) => addMonth(row.month_key));
    } catch (error) {
      console.warn('Unable to read shifts months:', error.message);
    }

    try {
      const rows = await executeQuery('SELECT SUBSTR(date, 1, 7) AS month_key FROM fuel_invoices WHERE date IS NOT NULL');
      rows.forEach((row) => addMonth(row.month_key));
    } catch (error) {
      console.warn('Unable to read fuel_invoices months:', error.message);
    }

    try {
      const rows = await executeQuery('SELECT month_key FROM monthly_profit_custom_values WHERE month_key IS NOT NULL');
      rows.forEach((row) => addMonth(row.month_key));
    } catch (error) {
      console.warn('Unable to read monthly_profit_custom_values months:', error.message);
    }

    return Array.from(monthSet).sort((a, b) => a.localeCompare(b));
  };

  ipcMain.handle('get-sales', async () => {
    try {
      requireOnline('عرض المبيعات');
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
      return await executeInsert(query, [date, fuel_type, quantity, price_per_liter, total_amount, payment_method, customer_name, notes], 'sales');
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
        return await executeInsert(insertQuery, ['oil', oil_type, price], 'products');
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
      return await executeInsert(insertQuery, ['fuel', fuel_type, price], 'products');
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
      return await executeInsert(insertQuery, ['oil', oil_type, price, vatValue], 'products');
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
        await executeInsert(historyQuery, [product_type, product_name, price, start_date, product_id], 'price_history');

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
      requireOnline('سجل الأسعار');
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
      requireOnline('التقارير');
      const reportQuery = 'SELECT * FROM sales WHERE date BETWEEN $1 AND $2 ORDER BY date DESC';
      return await executeQuery(reportQuery, [startDate, endDate]);
    } catch (error) {
      console.error('Error getting sales report:', error);
      throw error;
    }
  });

  ipcMain.handle('get-sales-summary', async () => {
    try {
      requireOnline('ملخص المبيعات');
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

  ipcMain.handle('get-profit-available-months', async () => {
    try {
      return await collectAvailableProfitMonths();
    } catch (error) {
      console.error('Error getting available profit months:', error);
      throw error;
    }
  });

  ipcMain.handle('get-profit-custom-rows', async () => {
    try {
      const query = `
        SELECT row_key, row_label, row_type, display_order
        FROM monthly_profit_custom_rows
        ORDER BY
          CASE WHEN row_type = 'revenue' THEN 0 ELSE 1 END,
          display_order ASC,
          created_at ASC
      `;
      return await executeQuery(query, []);
    } catch (error) {
      console.error('Error getting profit custom rows:', error);
      throw error;
    }
  });

  ipcMain.handle('get-profit-custom-values', async (_event, payload = {}) => {
    try {
      const fromMonth = normalizeMonthKey(payload?.fromMonth);
      const toMonth = normalizeMonthKey(payload?.toMonth);
      if (!fromMonth || !toMonth || fromMonth > toMonth) {
        return [];
      }

      const query = `
        SELECT row_key, month_key, amount
        FROM monthly_profit_custom_values
        WHERE month_key BETWEEN $1 AND $2
      `;
      return await executeQuery(query, [fromMonth, toMonth]);
    } catch (error) {
      console.error('Error getting profit custom values:', error);
      throw error;
    }
  });

  ipcMain.handle('add-profit-custom-row', async (_event, payload = {}) => {
    try {
      const rowType = normalizeProfitCustomRowType(payload?.row_type);
      const rowLabel = normalizeProfitCustomRowLabel(payload?.row_label, rowType);
      const rowKey = generateProfitCustomRowKey(rowType);
      const requestedOrderRaw = parseInt(payload?.display_order, 10);
      const requestedOrder = Number.isFinite(requestedOrderRaw) && requestedOrderRaw > 0
        ? requestedOrderRaw
        : null;

      let nextOrder = 1;
      if (requestedOrder !== null) {
        nextOrder = requestedOrder;
        await executeUpdate(
          `UPDATE monthly_profit_custom_rows
           SET display_order = display_order + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE row_type = $1
             AND display_order >= $2`,
          [rowType, nextOrder]
        );
      } else {
        const orderRows = await executeQuery(
          'SELECT COALESCE(MAX(display_order), 0) AS max_order FROM monthly_profit_custom_rows WHERE row_type = $1',
          [rowType]
        );
        nextOrder = (parseInt(orderRows[0]?.max_order, 10) || 0) + 1;
      }

      const insertQuery = `
        INSERT INTO monthly_profit_custom_rows (row_key, row_label, row_type, display_order, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      await executeInsert(insertQuery, [rowKey, rowLabel, rowType, nextOrder], 'monthly_profit_custom_rows');

      const rows = await executeQuery(
        'SELECT row_key, row_label, row_type, display_order FROM monthly_profit_custom_rows WHERE row_key = $1 LIMIT 1',
        [rowKey]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('Error adding profit custom row:', error);
      throw error;
    }
  });

  ipcMain.handle('update-profit-custom-row-label', async (_event, payload = {}) => {
    try {
      const rowKey = String(payload?.row_key || '').trim();
      if (!rowKey) throw new Error('المعرف غير صالح');

      const existingRows = await executeQuery(
        'SELECT row_type FROM monthly_profit_custom_rows WHERE row_key = $1 LIMIT 1',
        [rowKey]
      );
      if (!existingRows.length) throw new Error('الصف غير موجود');

      const rowType = normalizeProfitCustomRowType(existingRows[0].row_type);
      const rowLabel = normalizeProfitCustomRowLabel(payload?.row_label, rowType);
      await executeUpdate(
        'UPDATE monthly_profit_custom_rows SET row_label = $1, updated_at = CURRENT_TIMESTAMP WHERE row_key = $2',
        [rowLabel, rowKey]
      );

      const rows = await executeQuery(
        'SELECT row_key, row_label, row_type, display_order FROM monthly_profit_custom_rows WHERE row_key = $1 LIMIT 1',
        [rowKey]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('Error updating profit custom row label:', error);
      throw error;
    }
  });

  ipcMain.handle('delete-profit-custom-row', async (_event, payload = {}) => {
    try {
      const rowKey = String(payload?.row_key || '').trim();
      if (!rowKey) throw new Error('المعرف غير صالح');

      await executeUpdate('DELETE FROM monthly_profit_custom_values WHERE row_key = $1', [rowKey]);
      await executeUpdate('DELETE FROM monthly_profit_custom_rows WHERE row_key = $1', [rowKey]);
      return true;
    } catch (error) {
      console.error('Error deleting profit custom row:', error);
      throw error;
    }
  });

  ipcMain.handle('upsert-profit-custom-value', async (_event, payload = {}) => {
    try {
      const rowKey = String(payload?.row_key || '').trim();
      const monthKey = normalizeMonthKey(payload?.month_key);
      if (!rowKey || !monthKey) throw new Error('البيانات غير صالحة');

      const amount = toNumber(payload?.amount);
      const query = `
        INSERT INTO monthly_profit_custom_values (row_key, month_key, amount, created_at, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (row_key, month_key)
        DO UPDATE SET
          amount = EXCLUDED.amount,
          updated_at = CURRENT_TIMESTAMP
      `;
      await executeUpdate(query, [rowKey, monthKey, amount]);
      return true;
    } catch (error) {
      console.error('Error upserting profit custom value:', error);
      throw error;
    }
  });

  ipcMain.handle('upsert-monthly-profit-input', async (_event, payload) => {
    try {
      const monthKey = normalizeMonthKey(payload?.month_key);
      if (!monthKey) {
        throw new Error('صيغة الشهر غير صحيحة');
      }

      const field = String(payload?.field || '').trim();
      if (field) {
        if (!PROFIT_MANUAL_FIELDS.includes(field)) {
          throw new Error('الحقل غير مدعوم');
        }

        const value = toNumber(payload?.value);
        const query = `
          INSERT INTO monthly_profit_inputs (month_key, ${field}, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (month_key)
          DO UPDATE SET
            ${field} = EXCLUDED.${field},
            updated_at = CURRENT_TIMESTAMP
        `;
        await executeUpdate(query, [monthKey, value]);
      } else {
        const source = payload?.values && typeof payload.values === 'object' ? payload.values : payload;
        const values = PROFIT_MANUAL_FIELDS.map((name) => toNumber(source?.[name]));
        const query = `
          INSERT INTO monthly_profit_inputs (
            month_key, fuel_diesel, fuel_80, fuel_92, fuel_95, oil_total,
            bonuses, commission_diff, deposit_tax, bonus_tax, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (month_key)
          DO UPDATE SET
            fuel_diesel = EXCLUDED.fuel_diesel,
            fuel_80 = EXCLUDED.fuel_80,
            fuel_92 = EXCLUDED.fuel_92,
            fuel_95 = EXCLUDED.fuel_95,
            oil_total = EXCLUDED.oil_total,
            bonuses = EXCLUDED.bonuses,
            commission_diff = EXCLUDED.commission_diff,
            deposit_tax = EXCLUDED.deposit_tax,
            bonus_tax = EXCLUDED.bonus_tax,
            updated_at = CURRENT_TIMESTAMP
        `;
        await executeUpdate(query, [monthKey, ...values]);
      }

      const rows = await executeQuery('SELECT * FROM monthly_profit_inputs WHERE month_key = $1 LIMIT 1', [monthKey]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error upserting monthly profit input:', error);
      throw error;
    }
  });

  ipcMain.handle('get-profit-monthly-data', async (_event, payload = {}) => {
    try {
      let fromMonth = normalizeMonthKey(payload?.fromMonth);
      let toMonth = normalizeMonthKey(payload?.toMonth);

      if (!fromMonth || !toMonth || fromMonth > toMonth) {
        const availableMonths = await collectAvailableProfitMonths();
        if (availableMonths.length > 0) {
          fromMonth = availableMonths[0];
          toMonth = availableMonths[availableMonths.length - 1];
        } else {
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          fromMonth = currentMonth;
          toMonth = currentMonth;
        }
      }

      const monthRange = buildMonthRange(fromMonth, toMonth);
      if (monthRange.length === 0) {
        return [];
      }

      const fromDateRange = monthToRange(fromMonth);
      const toDateRange = monthToRange(toMonth);
      const startDate = fromDateRange?.startDate;
      const endDate = toDateRange?.endDate;
      if (!startDate || !endDate) {
        return [];
      }

      const manualRows = await executeQuery(
        'SELECT * FROM monthly_profit_inputs WHERE month_key BETWEEN $1 AND $2 ORDER BY month_key ASC',
        [fromMonth, toMonth]
      ).catch((error) => {
        console.warn('Unable to read monthly profit manual rows:', error.message);
        return [];
      });

      const shiftRows = await executeQuery(
        'SELECT date, fuel_data, data, wash_lube_revenue, total_expenses FROM shifts WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)',
        [startDate, endDate]
      ).catch((error) => {
        console.warn('Unable to read shift wash rows:', error.message);
        return [];
      });

      const invoiceRows = await executeQuery(
        'SELECT date, invoice_number, fuel_type, total, invoice_total FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
        [startDate, endDate]
      ).catch(async (error) => {
        console.warn('Unable to read fuel invoices with invoice_total, fallback to totals only:', error.message);
        const fallbackRows = await executeQuery(
          'SELECT date, invoice_number, fuel_type, total FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
          [startDate, endDate]
        ).catch((fallbackError) => {
          console.warn('Unable to read fuel invoices fallback:', fallbackError.message);
          return [];
        });
        return fallbackRows.map((row) => ({ ...row, invoice_total: null }));
      });

      const manualByMonth = new Map();
      for (const row of manualRows) {
        const monthKey = normalizeMonthKey(row.month_key);
        if (!monthKey) continue;
        manualByMonth.set(monthKey, {
          fuel_diesel: toNumber(row.fuel_diesel),
          fuel_80: toNumber(row.fuel_80),
          fuel_92: toNumber(row.fuel_92),
          fuel_95: toNumber(row.fuel_95),
          oil_total: toNumber(row.oil_total),
          bonuses: toNumber(row.bonuses),
          commission_diff: toNumber(row.commission_diff),
          deposit_tax: toNumber(row.deposit_tax),
          bonus_tax: toNumber(row.bonus_tax)
        });
      }

      const dieselByMonth = new Map();
      const fuel80ByMonth = new Map();
      const fuel92ByMonth = new Map();
      const fuel95ByMonth = new Map();
      const washByMonth = new Map();
      const expensesByMonth = new Map();
      for (const row of shiftRows) {
        const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
        if (!monthKey) continue;
        dieselByMonth.set(monthKey, (dieselByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'سولار'));
        fuel80ByMonth.set(monthKey, (fuel80ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٨٠'));
        fuel92ByMonth.set(monthKey, (fuel92ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٩٢'));
        fuel95ByMonth.set(monthKey, (fuel95ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٩٥'));
        washByMonth.set(monthKey, (washByMonth.get(monthKey) || 0) + toNumber(row.wash_lube_revenue));
        expensesByMonth.set(monthKey, (expensesByMonth.get(monthKey) || 0) + toNumber(row.total_expenses));
      }

      const groupedInvoices = new Map();
      const fuelPurchasesByMonth = {
        fuel_diesel: new Map(),
        fuel_80: new Map(),
        fuel_92: new Map(),
        fuel_95: new Map()
      };
      for (const row of invoiceRows) {
        const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
        if (!monthKey) continue;

        const fuelProfitKey = normalizeFuelProfitKey(row?.fuel_type);
        if (fuelProfitKey && fuelPurchasesByMonth[fuelProfitKey]) {
          const purchaseMap = fuelPurchasesByMonth[fuelProfitKey];
          purchaseMap.set(monthKey, (purchaseMap.get(monthKey) || 0) + toNumber(row?.total));
        }

        const invoiceNumber = String(row?.invoice_number || '').trim() || '__unknown__';
        const groupKey = `${monthKey}__${invoiceNumber}`;
        if (!groupedInvoices.has(groupKey)) {
          groupedInvoices.set(groupKey, {
            monthKey,
            sumRowsTotal: 0,
            maxInvoiceTotal: null
          });
        }

        const entry = groupedInvoices.get(groupKey);
        entry.sumRowsTotal += toNumber(row?.total);

        const invoiceTotalValue = parseFloat(row?.invoice_total);
        if (Number.isFinite(invoiceTotalValue)) {
          entry.maxInvoiceTotal = entry.maxInvoiceTotal === null
            ? invoiceTotalValue
            : Math.max(entry.maxInvoiceTotal, invoiceTotalValue);
        }
      }

      const insuranceByMonth = new Map();
      for (const entry of groupedInvoices.values()) {
        const invoiceTotal = entry.maxInvoiceTotal === null ? entry.sumRowsTotal : entry.maxInvoiceTotal;
        const insurance = invoiceTotal - entry.sumRowsTotal;
        insuranceByMonth.set(entry.monthKey, (insuranceByMonth.get(entry.monthKey) || 0) + insurance);
      }

      const monthlyRows = monthRange.map((monthKey) => {
        const manual = manualByMonth.get(monthKey) || {};
        const grossFuelDiesel = dieselByMonth.has(monthKey)
          ? toNumber(dieselByMonth.get(monthKey))
          : toNumber(manual.fuel_diesel);
        const grossFuel80 = fuel80ByMonth.has(monthKey)
          ? toNumber(fuel80ByMonth.get(monthKey))
          : toNumber(manual.fuel_80);
        const grossFuel92 = fuel92ByMonth.has(monthKey)
          ? toNumber(fuel92ByMonth.get(monthKey))
          : toNumber(manual.fuel_92);
        const grossFuel95 = fuel95ByMonth.has(monthKey)
          ? toNumber(fuel95ByMonth.get(monthKey))
          : toNumber(manual.fuel_95);
        const fuel_diesel = grossFuelDiesel - toNumber(fuelPurchasesByMonth.fuel_diesel.get(monthKey));
        const fuel_80 = grossFuel80 - toNumber(fuelPurchasesByMonth.fuel_80.get(monthKey));
        const fuel_92 = grossFuel92 - toNumber(fuelPurchasesByMonth.fuel_92.get(monthKey));
        const fuel_95 = grossFuel95 - toNumber(fuelPurchasesByMonth.fuel_95.get(monthKey));
        const oil_total = toNumber(manual.oil_total);
        const bonuses = toNumber(manual.bonuses);
        const commission_diff = toNumber(manual.commission_diff);
        const deposit_tax = toNumber(manual.deposit_tax);
        const bonus_tax = toNumber(manual.bonus_tax);

        const fuel_total_month = fuel_diesel + fuel_80 + fuel_92 + fuel_95;
        const oil_total_month = oil_total;
        const wash_lube_month = toNumber(washByMonth.get(monthKey));
        const expenses_month = toNumber(expensesByMonth.get(monthKey));
        const cash_insurance_month = toNumber(insuranceByMonth.get(monthKey));

        const total_positive = fuel_total_month + oil_total_month + wash_lube_month + bonuses + commission_diff;
        const total_deductions = cash_insurance_month + expenses_month + deposit_tax + bonus_tax;
        const net_profit = total_positive - total_deductions;

        return {
          month_key: monthKey,
          fuel_diesel,
          fuel_80,
          fuel_92,
          fuel_95,
          fuel_total_month,
          oil_total: oil_total_month,
          wash_lube_month,
          bonuses,
          commission_diff,
          total_positive,
          cash_insurance_month,
          expenses_month,
          deposit_tax,
          bonus_tax,
          total_deductions,
          net_profit
        };
      });

      return monthlyRows.sort((a, b) => b.month_key.localeCompare(a.month_key));
    } catch (error) {
      console.error('Error getting profit monthly data:', error);
      throw error;
    }
  });

  // Safe book handlers (cashbox movements)
  ipcMain.handle('get-safe-book-movements', async () => {
    try {
      let manualRows = [];
      let shiftRows = [];

      try {
        manualRows = await executeQuery(
          'SELECT id, date, movement_type, amount, direction, created_at FROM safe_book_movements ORDER BY date DESC, created_at DESC, id DESC'
        );
      } catch (err) {
        console.warn('Safe book manual rows query failed:', err.message);
      }

      try {
        shiftRows = await executeQuery(
          'SELECT id, date, shift_number, grand_total, created_at, updated_at FROM shifts WHERE is_saved = 1 ORDER BY date DESC, shift_number DESC, id DESC'
        );
      } catch (err) {
        console.warn('Safe book shifts query failed:', err.message);
      }

      const toTimestamp = (value) => {
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
        if (typeof value === 'string') {
          const num = Number(value);
          if (Number.isFinite(num)) return num < 1e12 ? num * 1000 : num;
          const parsed = Date.parse(value);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const toDateKey = (dateStr) => {
        const parsed = Date.parse(`${dateStr}T00:00:00`);
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const manualMovements = (manualRows || []).map((row) => ({
        id: `manual-${row.id}`,
        date: row.date,
        movement_type: row.movement_type,
        amount: parseFloat(row.amount) || 0,
        direction: row.direction === 'out' ? 'out' : 'in',
        source: 'manual',
        shift_number: null,
        created_at: toTimestamp(row.created_at)
      }));

      const shiftMovements = (shiftRows || []).map((row) => ({
        id: `shift-${row.id}`,
        date: row.date,
        movement_type: null,
        amount: parseFloat(row.grand_total) || 0,
        direction: (parseFloat(row.grand_total) || 0) >= 0 ? 'in' : 'out',
        source: 'shift',
        shift_number: parseInt(row.shift_number, 10) || 1,
        created_at: toTimestamp(row.updated_at || row.created_at)
      }));

      const all = [...shiftMovements, ...manualMovements];
      all.sort((a, b) => {
        const byDate = toDateKey(b.date) - toDateKey(a.date);
        if (byDate !== 0) return byDate;

        const aShiftRank = a.source === 'shift' ? (a.shift_number || 0) : 0;
        const bShiftRank = b.source === 'shift' ? (b.shift_number || 0) : 0;
        if (bShiftRank !== aShiftRank) return bShiftRank - aShiftRank;

        return (b.created_at || 0) - (a.created_at || 0);
      });

      return all;
    } catch (error) {
      console.error('Error getting safe book movements:', error);
      throw error;
    }
  });

  ipcMain.handle('add-safe-book-movement', async (_event, movementData) => {
    try {
      const date = String(movementData?.date || '').trim();
      const movement_type = String(movementData?.movement_type || '').trim();
      const amount = parseFloat(movementData?.amount);
      const direction = movementData?.direction;

      if (!date) throw new Error('يرجى تحديد التاريخ');
      if (!movement_type) throw new Error('يرجى إدخال نوع الحركة');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('يرجى إدخال قيمة صحيحة');
      if (direction !== 'in' && direction !== 'out') throw new Error('نوع الحركة غير صالح');

      const insertQuery = 'INSERT INTO safe_book_movements (date, movement_type, amount, direction) VALUES ($1, $2, $3, $4)';
      return await executeInsert(insertQuery, [date, movement_type, amount, direction], 'safe_book_movements');
    } catch (error) {
      console.error('Error adding safe book movement:', error);
      throw error;
    }
  });

  // Oil movement handlers
  ipcMain.handle('add-oil-movement', async (event, movementData) => {
    try {
      const { oil_type, date, type, quantity, invoice_number } = movementData;
      const insertQuery = 'INSERT INTO oil_movements (oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5)';
      return await executeInsert(insertQuery, [oil_type, date, type, quantity, invoice_number], 'oil_movements');
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
      return await executeInsert(insertQuery, [fuel_type, date, type, quantity, invoice_number, notes], 'fuel_movements');
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
      const safeInvoiceTotal = toNumber(invoice_total);

      // Save each fuel item as a separate record
      for (const item of fuel_items) {
        const invoiceQuery = `
          INSERT INTO fuel_invoices (
            date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await executeInsert(invoiceQuery, [
          date,
          invoice_number,
          item.fuel_type,
          item.quantity,
          item.net_quantity,
          item.purchase_price,
          item.total,
          safeInvoiceTotal
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

        // Also create a stock movement "in" for each oil line
        const movementQuery = 'INSERT INTO oil_movements (oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5)';
        await executeInsert(movementQuery, [item.oil_type, date, 'in', item.quantity, invoice_number], 'oil_movements');
      }

      return true;
    } catch (error) {
      console.error('Error adding oil invoice:', error);
      throw error;
    }
  });

  ipcMain.handle('get-fuel-invoices', async () => {
    try {
      requireOnline('عرض فواتير الوقود');
      return await executeQuery('SELECT * FROM fuel_invoices ORDER BY date DESC');
    } catch (error) {
      console.error('Error getting fuel invoices:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-invoices', async () => {
    try {
      requireOnline('عرض فواتير الزيوت');
      return await executeQuery('SELECT * FROM oil_invoices ORDER BY date DESC');
    } catch (error) {
      console.error('Error getting oil invoices:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-invoices-report', async (event, { startDate, endDate }) => {
    try {
      requireOnline('تقرير فواتير الزيوت');
      const reportQuery = 'SELECT * FROM oil_invoices WHERE date BETWEEN $1 AND $2 ORDER BY date DESC';
      return await executeQuery(reportQuery, [startDate, endDate]);
    } catch (error) {
      console.error('Error getting oil invoices report:', error);
      throw error;
    }
  });

  // Annual inventory handlers
  ipcMain.handle('get-annual-inventory-records', async () => {
    try {
      return await executeQuery(`
        SELECT
          id,
          year,
          prev_balance,
          station_profit,
          bank_balance,
          safe_balance,
          accounting_remainder,
          customers_balance,
          vouchers_balance,
          visa_balance,
          expected_total,
          actual_total,
          difference,
          expected_items,
          actual_items,
          status,
          finalized,
          finalized_at,
          created_at,
          updated_at
        FROM annual_inventories
        ORDER BY year DESC
      `);
    } catch (error) {
      console.error('Error getting annual inventory records:', error);
      throw error;
    }
  });

  ipcMain.handle('save-annual-inventory', async (_event, payload) => {
    try {
      const toNumber = (value) => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const normalizeItems = (items) => {
        let parsed = items;

        if (typeof parsed === 'string' && parsed.trim()) {
          try {
            parsed = JSON.parse(parsed);
          } catch (error) {
            parsed = [];
          }
        }

        if (!Array.isArray(parsed)) return [];

        return parsed
          .map((item) => {
            const label = String(item?.label || '').trim();
            const value = toNumber(item?.value);

            if (!label && Math.abs(value) < 0.0001) {
              return null;
            }

            return {
              label: label || 'بند إضافي',
              value
            };
          })
          .filter(Boolean);
      };

      const year = parseInt(payload?.year, 10);
      if (!Number.isFinite(year)) {
        throw new Error('السنة غير صالحة');
      }

      const finalizedFlag = payload?.finalized ? 1 : 0;
      const prev_balance = toNumber(payload?.prev_balance);
      const station_profit = toNumber(payload?.station_profit);
      const bank_balance = toNumber(payload?.bank_balance);
      const safe_balance = toNumber(payload?.safe_balance);
      const accounting_remainder = toNumber(payload?.accounting_remainder);
      const customers_balance = toNumber(payload?.customers_balance);
      const vouchers_balance = toNumber(payload?.vouchers_balance);
      const visa_balance = toNumber(payload?.visa_balance);
      const expected_total = toNumber(payload?.expected_total);
      const actual_total = toNumber(payload?.actual_total);
      const difference = toNumber(payload?.difference);
      const expected_items = JSON.stringify(normalizeItems(payload?.expected_items));
      const actual_items = JSON.stringify(normalizeItems(payload?.actual_items));
      const status = payload?.status || (difference > 0 ? 'surplus' : (difference < 0 ? 'shortage' : 'balanced'));

      const existing = await executeQuery('SELECT id, finalized FROM annual_inventories WHERE year = $1 LIMIT 1', [year]);
      if (existing.length > 0 && Number(existing[0].finalized) === 1) {
        throw new Error('هذه السنة مقفلة نهائياً ولا يمكن تعديلها');
      }

      if (existing.length > 0) {
        const setFinalizedTimestamp = finalizedFlag === 1 && Number(existing[0].finalized) !== 1 ? 1 : 0;

        const updateQuery = `
          UPDATE annual_inventories
          SET
            prev_balance = $1,
            station_profit = $2,
            bank_balance = $3,
            safe_balance = $4,
            accounting_remainder = $5,
            customers_balance = $6,
            vouchers_balance = $7,
            visa_balance = $8,
            expected_total = $9,
            actual_total = $10,
            difference = $11,
            expected_items = $12,
            actual_items = $13,
            status = $14,
            finalized = $15,
            finalized_at = CASE WHEN $16 = 1 THEN CURRENT_TIMESTAMP ELSE finalized_at END,
            updated_at = CURRENT_TIMESTAMP
          WHERE year = $17
        `;

        await executeUpdate(updateQuery, [
          prev_balance,
          station_profit,
          bank_balance,
          safe_balance,
          accounting_remainder,
          customers_balance,
          vouchers_balance,
          visa_balance,
          expected_total,
          actual_total,
          difference,
          expected_items,
          actual_items,
          status,
          finalizedFlag,
          setFinalizedTimestamp,
          year
        ]);
      } else {
        const insertQuery = `
          INSERT INTO annual_inventories (
            year,
            prev_balance,
            station_profit,
            bank_balance,
            safe_balance,
            accounting_remainder,
            customers_balance,
            vouchers_balance,
            visa_balance,
            expected_total,
            actual_total,
            difference,
            expected_items,
            actual_items,
            status,
            finalized,
            finalized_at,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            CASE WHEN $16 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `;

        await executeInsert(insertQuery, [
          year,
          prev_balance,
          station_profit,
          bank_balance,
          safe_balance,
          accounting_remainder,
          customers_balance,
          vouchers_balance,
          visa_balance,
          expected_total,
          actual_total,
          difference,
          expected_items,
          actual_items,
          status,
          finalizedFlag
        ], 'annual_inventories');
      }

      const saved = await executeQuery('SELECT * FROM annual_inventories WHERE year = $1 LIMIT 1', [year]);
      return saved[0] || null;
    } catch (error) {
      console.error('Error saving annual inventory:', error);
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
      const safeBookMovements = await executeQuery('SELECT * FROM safe_book_movements ORDER BY date DESC, created_at DESC');
      const monthlyProfitInputs = await executeQuery('SELECT * FROM monthly_profit_inputs ORDER BY month_key DESC');
      const monthlyProfitCustomRows = await executeQuery('SELECT * FROM monthly_profit_custom_rows ORDER BY row_type ASC, display_order ASC');
      const monthlyProfitCustomValues = await executeQuery('SELECT * FROM monthly_profit_custom_values ORDER BY month_key DESC');

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
        safeBookMovements,
        monthlyProfitInputs,
        monthlyProfitCustomRows,
        monthlyProfitCustomValues,
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
          const query = `
            INSERT INTO fuel_invoices (
              date, invoice_number, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING
          `;
          await executeInsert(query, [
            invoice.date,
            invoice.invoice_number,
            invoice.fuel_type,
            invoice.quantity,
            invoice.net_quantity,
            invoice.purchase_price,
            invoice.total,
            toNumber(invoice.invoice_total)
          ], 'fuel_invoices');
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
          ], 'oil_invoices');
        }
      }

      // Import products (new format) or legacy fuel/oil prices (old format)
      if (backupData.products) {
        // New format with unified products table
        for (const product of backupData.products) {
          const query = 'INSERT INTO products (product_type, product_name, current_price, vat, is_active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (product_name) DO UPDATE SET current_price = $3, vat = $4, is_active = $5';
          await executeInsert(query, [product.product_type, product.product_name, product.current_price, product.vat || 0, product.is_active !== undefined ? product.is_active : 1], 'products');
        }
      } else {
        // Legacy format - import from old fuelPrices and oilPrices
        if (backupData.fuelPrices) {
          for (const price of backupData.fuelPrices) {
            const query = 'INSERT INTO products (product_type, product_name, current_price) VALUES ($1, $2, $3) ON CONFLICT (product_name) DO UPDATE SET current_price = $3';
            await executeInsert(query, ['fuel', price.fuel_type, price.price], 'products');
          }
        }
        if (backupData.oilPrices) {
          for (const price of backupData.oilPrices) {
            const query = 'INSERT INTO products (product_type, product_name, current_price, vat) VALUES ($1, $2, $3, $4) ON CONFLICT (product_name) DO UPDATE SET current_price = $3, vat = $4';
            await executeInsert(query, ['oil', price.oil_type, price.price, price.vat || 0], 'products');
          }
        }
      }

      // Import purchase prices
      if (backupData.purchasePrices) {
        for (const price of backupData.purchasePrices) {
          const query = 'INSERT INTO purchase_prices (fuel_type, price) VALUES ($1, $2) ON CONFLICT (fuel_type) DO UPDATE SET price = $2';
          await executeInsert(query, [price.fuel_type, price.price], 'purchase_prices');
        }
      }

      // Import price history
      if (backupData.priceHistory) {
        for (const item of backupData.priceHistory) {
          const query = 'INSERT INTO price_history (product_type, product_name, price, start_date, created_at) VALUES ($1, $2, $3, $4, $5)';
          await executeInsert(query, [item.product_type, item.product_name, item.price, item.start_date, item.created_at], 'price_history');
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
          ], 'depot_movements');
        }
      }

      // Import safe book movements
      if (backupData.safeBookMovements) {
        for (const movement of backupData.safeBookMovements) {
          const query = 'INSERT INTO safe_book_movements (date, movement_type, amount, direction, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING';
          await executeInsert(query, [
            movement.date,
            movement.movement_type,
            movement.amount,
            movement.direction,
            movement.created_at
          ], 'safe_book_movements');
        }
      }

      if (backupData.monthlyProfitInputs) {
        for (const row of backupData.monthlyProfitInputs) {
          const query = `
            INSERT INTO monthly_profit_inputs (
              month_key, fuel_diesel, fuel_80, fuel_92, fuel_95, oil_total,
              bonuses, commission_diff, deposit_tax, bonus_tax, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (month_key)
            DO UPDATE SET
              fuel_diesel = EXCLUDED.fuel_diesel,
              fuel_80 = EXCLUDED.fuel_80,
              fuel_92 = EXCLUDED.fuel_92,
              fuel_95 = EXCLUDED.fuel_95,
              oil_total = EXCLUDED.oil_total,
              bonuses = EXCLUDED.bonuses,
              commission_diff = EXCLUDED.commission_diff,
              deposit_tax = EXCLUDED.deposit_tax,
              bonus_tax = EXCLUDED.bonus_tax,
              updated_at = EXCLUDED.updated_at
          `;

          await executeInsert(query, [
            row.month_key,
            toNumber(row.fuel_diesel),
            toNumber(row.fuel_80),
            toNumber(row.fuel_92),
            toNumber(row.fuel_95),
            toNumber(row.oil_total),
            toNumber(row.bonuses),
            toNumber(row.commission_diff),
            toNumber(row.deposit_tax),
            toNumber(row.bonus_tax),
            row.created_at || null,
            row.updated_at || null
          ], 'monthly_profit_inputs');
        }
      }

      if (backupData.monthlyProfitCustomRows) {
        for (const row of backupData.monthlyProfitCustomRows) {
          const rowType = normalizeProfitCustomRowType(row.row_type);
          const rowLabel = normalizeProfitCustomRowLabel(row.row_label, rowType);
          const query = `
            INSERT INTO monthly_profit_custom_rows (
              row_key, row_label, row_type, display_order, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (row_key)
            DO UPDATE SET
              row_label = EXCLUDED.row_label,
              row_type = EXCLUDED.row_type,
              display_order = EXCLUDED.display_order,
              updated_at = EXCLUDED.updated_at
          `;

          await executeInsert(query, [
            String(row.row_key || '').trim(),
            rowLabel,
            rowType,
            parseInt(row.display_order, 10) || 0,
            row.created_at || null,
            row.updated_at || null
          ], 'monthly_profit_custom_rows');
        }
      }

      if (backupData.monthlyProfitCustomValues) {
        for (const entry of backupData.monthlyProfitCustomValues) {
          const rowKey = String(entry.row_key || '').trim();
          const monthKey = normalizeMonthKey(entry.month_key);
          if (!rowKey || !monthKey) continue;

          const query = `
            INSERT INTO monthly_profit_custom_values (
              row_key, month_key, amount, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (row_key, month_key)
            DO UPDATE SET
              amount = EXCLUDED.amount,
              updated_at = EXCLUDED.updated_at
          `;

          await executeInsert(query, [
            rowKey,
            monthKey,
            toNumber(entry.amount),
            entry.created_at || null,
            entry.updated_at || null
          ], 'monthly_profit_custom_values');
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
      pending: dbManager.getPendingSyncCount(),
      mode: dbManager.isOnline ? 'online' : 'offline-limited',
      restricted: OFFLINE_RESTRICTED
    };
  });
} // End of setupIPCHandlers

ipcMain.on('renderer-bootstrap-complete', () => {
  rendererBootstrapReady = true;
  finalizeStartupIfReady();
});

app.whenReady().then(async () => {
  let dbResult;

  startupPhase = { progress: 0, message: '', level: 'info' };
  mainWindowReady = false;
  rendererBootstrapReady = false;
  startupComplete = false;

  try {
    await createSplashWindow();
    emitStartupStatus('Avvio applicazione...', 5, 'info');
    installStartupConsoleMirror();
    emitStartupStatus('Inizializzazione database...', 15, 'info');

    // Initialize database (with 5 second timeout)
    dbResult = await initializeDatabase();
    emitStartupStatus('Database pronto', 60, 'info');

    setupIPCHandlers();
    emitStartupStatus('Canali applicazione pronti', 72, 'info');
    createWindow({ deferShow: true });

    // Show offline warning if needed (after 2 seconds to let UI load)
    if (!dbResult.online) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
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

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-status', {
            online: true,
            syncing: true
          });
        }

        // Trigger automatic sync
        try {
          const syncResult = await syncManager.syncAll();
          console.log('✅ Auto-sync completed:', syncResult);

          if (mainWindow && !mainWindow.isDestroyed()) {
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

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-status', {
            online: false,
            syncing: false
          });
        }
      }

      // Send status update to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', info);
        }
      });

      autoUpdater.on('update-not-available', () => {
        console.log('Update not available');
      });

      autoUpdater.on('error', (err) => {
        console.error('Error in auto-updater:', err);
        if (mainWindow && !mainWindow.isDestroyed()) {
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

        if (mainWindow && !mainWindow.isDestroyed()) {
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
        if (lastProgress < 100 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            percent: 100,
            transferred: info.files?.[0]?.size || 0,
            total: info.files?.[0]?.size || 0,
            bytesPerSecond: 0
          });
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
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
  } catch (error) {
    emitStartupStatus(error.message, startupPhase.progress || 15, 'error');
    restoreStartupConsoleMirror();
    clearStartupFallbackTimer();
    dialog.showErrorBox('Errore di avvio', error.message);
    destroySplashWindow();
    app.quit();
    return;
  }

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
    return await executeInsert(insertQuery, [name], 'customers');
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
    const {
      date,
      shift_number,
      fuel_data,
      fuel_total,
      oil_data,
      oil_total,
      expense_items,
      wash_lube_revenue,
      total_expenses,
      grand_total,
      is_saved
    } = shiftData;

    // Ensure numeric values are valid (convert NaN/undefined/null to 0)
    const safeFuelTotal = parseFloat(fuel_total) || 0;
    const safeOilTotal = parseFloat(oil_total) || 0;
    const safeWashLubeRevenue = parseFloat(wash_lube_revenue) || 0;
    const safeTotalExpenses = parseFloat(total_expenses) || 0;
    const safeGrandTotal = parseFloat(grand_total) || 0;
    const normalizedExpenseItems = normalizeExpenseItems(expense_items);
    const legacyShiftData = JSON.stringify({
      fuel_data: fuel_data || '{}',
      fuel_total: safeFuelTotal,
      oil_data: oil_data || '{}',
      oil_total: safeOilTotal,
      expense_items: normalizedExpenseItems,
      wash_lube_revenue: safeWashLubeRevenue,
      total_expenses: safeTotalExpenses,
      grand_total: safeGrandTotal,
      is_saved: is_saved ? 1 : 0
    });

    // PostgreSQL uses $1, $2, etc. and CURRENT_TIMESTAMP
    const query = `
      INSERT INTO shifts (date, shift_number, data, fuel_data, fuel_total, oil_data, oil_total, wash_lube_revenue, total_expenses, grand_total, is_saved, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (date, shift_number)
      DO UPDATE SET
        data = EXCLUDED.data,
        fuel_data = EXCLUDED.fuel_data,
        fuel_total = EXCLUDED.fuel_total,
        oil_data = EXCLUDED.oil_data,
        oil_total = EXCLUDED.oil_total,
        wash_lube_revenue = EXCLUDED.wash_lube_revenue,
        total_expenses = EXCLUDED.total_expenses,
        grand_total = EXCLUDED.grand_total,
        is_saved = EXCLUDED.is_saved,
        updated_at = CURRENT_TIMESTAMP
    `;

    await executeUpdate(query, [
      date,
      shift_number,
      legacyShiftData,
      fuel_data,
      safeFuelTotal,
      oil_data,
      safeOilTotal,
      safeWashLubeRevenue,
      safeTotalExpenses,
      safeGrandTotal,
      is_saved
    ]);

    const idRows = await executeQuery(
      'SELECT id FROM shifts WHERE date = $1 AND shift_number = $2 ORDER BY id DESC LIMIT 1',
      [date, shift_number]
    );
    const id = idRows[0]?.id || null;

    return { success: true, id: id };
  } catch (error) {
    console.error('Error saving shift:', error);
    return { success: false, error: error.message };
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

// Get last shift (highest ID)
ipcMain.handle('get-last-shift', async (event) => {
  try {
    const query = 'SELECT * FROM shifts ORDER BY id DESC LIMIT 1';
    const result = await executeQuery(query, []);
    if (result.length > 0) {
      // Parse the JSONB/JSON data field
      return {
        ...result[0],
        data: typeof result[0].data === 'string' ? JSON.parse(result[0].data) : result[0].data
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting last shift:', error);
    throw error;
  }
});

ipcMain.handle('get-expense-available-months', async () => {
  try {
    const rows = await executeQuery(
      'SELECT date, data, total_expenses FROM shifts WHERE (is_saved = 1 OR is_saved IS NULL) ORDER BY date ASC, shift_number ASC'
    );

    const months = new Set();
    rows.forEach((row) => {
      const monthKey = normalizeFilterMonthKey(String(row?.date || '').slice(0, 7));
      if (!monthKey) {
        return;
      }

      const snapshot = buildShiftExpenseSnapshot(row);
      if (snapshot.expenseItems.length > 0 || snapshot.totalExpenses > 0) {
        months.add(monthKey);
      }
    });

    return Array.from(months).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Error getting expense available months:', error);
    return [];
  }
});

ipcMain.handle('get-expense-entries', async (_event, filters = {}) => {
  try {
    const bounds = getMonthRangeBounds(filters.fromMonth, filters.toMonth);
    if (!bounds) {
      return [];
    }

    const minAmount = parseOptionalNumber(filters.minAmount);
    const maxAmount = parseOptionalNumber(filters.maxAmount);
    const searchTerm = String(filters.searchTerm || '').trim().toLocaleLowerCase();

    const rows = await executeQuery(
      'SELECT date, shift_number, data, total_expenses FROM shifts WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL) ORDER BY date DESC, shift_number DESC',
      [bounds.startDate, bounds.endDate]
    );

    const entries = [];

    rows.forEach((row) => {
      const snapshot = buildShiftExpenseSnapshot(row);
      if (snapshot.expenseItems.length > 0) {
        snapshot.expenseItems.forEach((item) => {
          entries.push({
            date: String(row?.date || ''),
            shift_number: parseInt(row?.shift_number, 10) === 2 ? 2 : 1,
            description: item.description,
            amount: item.amount,
            is_aggregated: false,
            line_index: item.index
          });
        });
        return;
      }

      if (snapshot.totalExpenses > 0) {
        entries.push({
          date: String(row?.date || ''),
          shift_number: parseInt(row?.shift_number, 10) === 2 ? 2 : 1,
          description: LEGACY_AGGREGATED_EXPENSE_LABEL,
          amount: snapshot.totalExpenses,
          is_aggregated: true,
          line_index: null
        });
      }
    });

    return entries
      .filter((entry) => {
        const amount = toFiniteNumber(entry.amount);
        if (minAmount !== null && amount < minAmount) {
          return false;
        }

        if (maxAmount !== null && amount > maxAmount) {
          return false;
        }

        if (!searchTerm) {
          return true;
        }

        const description = String(entry.description || '').trim().toLocaleLowerCase();
        return description.includes(searchTerm);
      })
      .sort((a, b) => {
        if (a.date !== b.date) {
          return a.date < b.date ? 1 : -1;
        }

        if (a.shift_number !== b.shift_number) {
          return b.shift_number - a.shift_number;
        }

        const aAggregateRank = a.is_aggregated ? 1 : 0;
        const bAggregateRank = b.is_aggregated ? 1 : 0;
        if (aAggregateRank !== bAggregateRank) {
          return aAggregateRank - bAggregateRank;
        }

        const aIndex = a.line_index ?? Number.MAX_SAFE_INTEGER;
        const bIndex = b.line_index ?? Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex;
      });
  } catch (error) {
    console.error('Error getting expense entries:', error);
    return [];
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
    connectionCheckInterval = null;
  }

  // Close database connections
  if (dbManager) {
    try {
      await dbManager.close();
    } catch (error) {
      console.error('Error while closing database connections:', error);
    }
  }
});
