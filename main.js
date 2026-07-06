const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
// Note: autoUpdater initialized after app.whenReady() to avoid initialization issues
const path = require('path');
const util = require('util');
const fs = require('fs');
const nodemailer = require('nodemailer');
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
    'get-price-history',
    'get-purchase-price-history',
    'get-purchase-prices-by-date'
  ]
};
const LEGACY_AGGREGATED_EXPENSE_LABEL = 'مصروفات مجمعة (بيانات قديمة)';
const SHIFT_OIL_STOCK_MOVEMENT_PREFIX = 'وارد وردية زيت';
const SHIFT_OIL_STOCK_EXCLUDED_OIL = 'سايب ١ ك';

function isBrokenPipeError(error) {
  return error && (error.code === 'EPIPE' || /EPIPE/.test(String(error.message || '')));
}

function installConsolePipeGuards() {
  const wrapConsoleMethod = (methodName) => {
    const original = console[methodName]?.bind(console);
    if (typeof original !== 'function') {
      return;
    }

    console[methodName] = (...args) => {
      try {
        original(...args);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
      }
    };
  };

  ['log', 'warn', 'error', 'info', 'debug'].forEach(wrapConsoleMethod);

  const ignoreBrokenPipe = (error) => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  };

  process.stdout?.on?.('error', ignoreBrokenPipe);
  process.stderr?.on?.('error', ignoreBrokenPipe);
}

installConsolePipeGuards();

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

function normalizeShiftOilStockName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getShiftOilStockMovementInvoice(date, shiftNumber) {
  return `${SHIFT_OIL_STOCK_MOVEMENT_PREFIX} ${date} #${shiftNumber}`;
}

async function syncShiftOilStockMovements(shiftData = {}) {
  const date = normalizeIsoDate(shiftData.date);
  const shiftNumber = parseInt(shiftData.shift_number, 10);
  if (!date || !Number.isFinite(shiftNumber)) return;

  const invoiceNumber = getShiftOilStockMovementInvoice(date, shiftNumber);
  await executeUpdate(
    'DELETE FROM oil_movements WHERE type = $1 AND invoice_number = $2',
    ['out', invoiceNumber]
  );

  const oilData = parseStoredObject(shiftData.oil_data, {});
  for (const [rawOilName, data] of Object.entries(oilData)) {
    const product = await getProductByCodeOrName('oil', data?.product_code, data?.product_name || rawOilName);
    const productCode = product?.product_code || data?.product_code || null;
    const oilName = normalizeShiftOilStockName(product?.product_name || data?.product_name || rawOilName);
    if (!oilName || oilName === SHIFT_OIL_STOCK_EXCLUDED_OIL) continue;

    const quantity = parseFloat(data?.added);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    await executeInsert(
      'INSERT INTO oil_movements (product_code, oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5, $6)',
      [productCode, oilName, date, 'out', quantity, invoiceNumber],
      'oil_movements'
    );
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

const CHATGPT_CSV_COLUMNS = [
  'source',
  'date',
  'month',
  'record_type',
  'product',
  'quantity',
  'unit_price',
  'total_amount',
  'payment_method',
  'direction',
  'invoice_number',
  'shift_number',
  'description',
  'notes',
  'raw_details'
];

function normalizeIsoDate(value) {
  const normalized = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function normalizeChatGptDateRange(payload = {}) {
  const startDate = normalizeIsoDate(payload.startDate);
  const endDate = normalizeIsoDate(payload.endDate);

  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
    startMonth: startDate.slice(0, 7),
    endMonth: endDate.slice(0, 7)
  };
}

function getRowMonth(dateValue) {
  const date = normalizeIsoDate(dateValue);
  return date ? date.slice(0, 7) : '';
}

function stringifyRawDetails(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch (_error) {
    return '{}';
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsv(rows) {
  const header = CHATGPT_CSV_COLUMNS.join(',');
  const body = rows.map((row) => (
    CHATGPT_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',')
  ));
  return `\uFEFF${[header, ...body].join('\n')}`;
}

function createChatGptCsvRow(overrides = {}) {
  const row = {};
  CHATGPT_CSV_COLUMNS.forEach((column) => {
    row[column] = '';
  });

  Object.entries(overrides).forEach(([key, value]) => {
    if (CHATGPT_CSV_COLUMNS.includes(key)) {
      row[key] = value ?? '';
    }
  });

  if (!row.month && row.date) {
    row.month = getRowMonth(row.date);
  }

  return row;
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

function normalizeRevenueItems(items) {
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

function getShiftFuelSoldQuantity(fuelType, data) {
  if (!data || typeof data !== 'object') {
    return 0;
  }

  let totalQuantity = toFiniteNumber(data.totalQuantity);
  if (totalQuantity <= 0) {
    const counterCount = getShiftProductDisplayName(fuelType, data) === 'سولار' ? 4 : 2;
    for (let i = 1; i <= counterCount; i += 1) {
      totalQuantity += toFiniteNumber(data[`quantity${i}`]);
    }
  }

  const cars = toFiniteNumber(data.cars);
  return Math.max(totalQuantity - cars, 0);
}

function parseShiftJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function getShiftProductDisplayName(entryKey, data = {}) {
  return String(data?.product_name || data?.oil_type || data?.fuel_type || entryKey || '').trim();
}

function findShiftDataEntryByName(shiftData, productName) {
  const targetName = String(productName || '').trim();
  if (!shiftData || typeof shiftData !== 'object' || !targetName) return null;
  if (shiftData[targetName]) return shiftData[targetName];

  const found = Object.entries(shiftData).find(([entryKey, data]) => (
    getShiftProductDisplayName(entryKey, data) === targetName
  ));
  return found ? found[1] : null;
}

function validateShiftPayload(shiftData = {}) {
  const errors = [];
  const fuelData = parseShiftJsonObject(shiftData.fuel_data);
  const oilData = parseShiftJsonObject(shiftData.oil_data);

  Object.entries(fuelData).forEach(([fuelType, data]) => {
    const fuelName = getShiftProductDisplayName(fuelType, data);
    const countersCount = fuelName === 'سولار' ? 4 : 2;
    for (let i = 1; i <= countersCount; i += 1) {
      const firstShift = parseFloat(data?.[`firstShift${i}`]) || 0;
      const lastShift = parseFloat(data?.[`lastShift${i}`]) || 0;
      if (firstShift > 0 && lastShift < firstShift) {
        errors.push(`${fuelName} (${i}): آخر الوردية يجب أن يكون أكبر من أو يساوي أول الوردية`);
      }
    }
  });

  Object.entries(oilData).forEach(([oilName, data]) => {
    const total = parseFloat(data?.total) || 0;
    const sold = parseFloat(data?.sold) || 0;
    if (sold > total && sold > 0) {
      errors.push(`${getShiftProductDisplayName(oilName, data)}: الكمية المباعة يجب أن تكون أقل من أو تساوي الإجمالي المتاح`);
    }
  });

  return errors;
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
  const isMac = process.platform === 'darwin';

  return new Promise((resolve, reject) => {
    let resolved = false;
    const splashWindowOptions = {
      width: 560,
      height: 360,
      resizable: false,
      show: false,
      autoHideMenuBar: true,
      icon: iconPath,
      title: 'CO-OP',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    };

    if (!isMac) {
      splashWindowOptions.minimizable = false;
      splashWindowOptions.maximizable = false;
      splashWindowOptions.fullscreenable = false;
      splashWindowOptions.frame = false;
    }

    splashWindow = new BrowserWindow(splashWindowOptions);

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

function generateProductCode(productType) {
  const cleanType = String(productType || 'product').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
  return `${cleanType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getProductByCodeOrName(productType, productCode, productName) {
  const cleanType = String(productType || '').trim();
  const cleanCode = String(productCode || '').trim();
  const cleanName = String(productName || '').trim();

  if (cleanCode) {
    const rows = await executeQuery(
      'SELECT id, product_type, product_name, product_code FROM products WHERE product_type = $1 AND product_code = $2 LIMIT 1',
      [cleanType, cleanCode]
    );
    if (rows.length > 0) return rows[0];
  }

  if (cleanName) {
    const rows = await executeQuery(
      'SELECT id, product_type, product_name, product_code FROM products WHERE product_type = $1 AND product_name = $2 LIMIT 1',
      [cleanType, cleanName]
    );
    if (rows.length > 0) return rows[0];
  }

  return null;
}

async function migrateShiftProductDataKeys() {
  try {
    const productRows = await executeQuery(
      'SELECT product_type, product_name, product_code FROM products WHERE product_code IS NOT NULL'
    );
    const byTypeName = new Map();

    productRows.forEach((product) => {
      const type = String(product.product_type || '').trim();
      const name = String(product.product_name || '').trim();
      const code = String(product.product_code || '').trim();
      if (!type || !name || !code) return;
      byTypeName.set(`${type}::${name}`, { code, name });
    });

    const migrateObject = (rawData, productType) => {
      const source = parseStoredObject(rawData, {});
      let changed = false;
      const next = {};

      Object.entries(source).forEach(([entryKey, entryValue]) => {
        const data = entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)
          ? { ...entryValue }
          : {};
        const displayName = getShiftProductDisplayName(entryKey, data);
        const existingCode = String(data.product_code || '').trim();
        const product = existingCode
          ? { code: existingCode, name: data.product_name || displayName }
          : byTypeName.get(`${productType}::${displayName}`);

        if (!product?.code) {
          next[entryKey] = entryValue;
          return;
        }

        data.product_code = product.code;
        data.product_name = data.product_name || product.name || displayName;
        next[product.code] = data;

        if (entryKey !== product.code || !entryValue?.product_code || !entryValue?.product_name) {
          changed = true;
        }
      });

      return { changed, data: next };
    };

    const shiftRows = await executeQuery('SELECT id, data, fuel_data, oil_data FROM shifts');
    let migrated = 0;

    for (const row of shiftRows) {
      const fuelMigration = migrateObject(row.fuel_data, 'fuel');
      const oilMigration = migrateObject(row.oil_data, 'oil');
      if (!fuelMigration.changed && !oilMigration.changed) continue;

      const legacyData = parseStoredObject(row.data, {});
      legacyData.fuel_data = fuelMigration.data;
      legacyData.oil_data = oilMigration.data;

      await executeUpdate(
        'UPDATE shifts SET data = $1, fuel_data = $2, oil_data = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
        [
          JSON.stringify(legacyData),
          JSON.stringify(fuelMigration.data),
          JSON.stringify(oilMigration.data),
          row.id
        ]
      );
      migrated += 1;
    }

    if (migrated > 0) {
      console.log(`Migrated product_code keys in ${migrated} shift rows`);
    }
  } catch (error) {
    console.warn('Unable to migrate shift product_code keys:', error.message);
  }
}

async function createProduct(productType, productName, price, extra = {}) {
  const productCode = generateProductCode(productType);
  const columns = ['product_type', 'product_name', 'product_code', 'current_price'];
  const values = [productType, productName, productCode, price];

  if (Object.prototype.hasOwnProperty.call(extra, 'vat')) {
    columns.push('vat');
    values.push(extra.vat);
  }
  if (Object.prototype.hasOwnProperty.call(extra, 'effective_date')) {
    columns.push('effective_date');
    values.push(extra.effective_date);
  }
  if (Object.prototype.hasOwnProperty.call(extra, 'display_order')) {
    columns.push('display_order');
    values.push(extra.display_order);
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  await executeInsert(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders})`,
    values,
    'products'
  );

  const rows = await executeQuery(
    'SELECT id, product_code FROM products WHERE product_code = $1 LIMIT 1',
    [productCode]
  );
  return rows[0] || { product_code: productCode };
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

    const fuelEntry = fuelData && typeof fuelData === 'object'
      ? findShiftDataEntryByName(fuelData, normalizedFuelType)
      : null;
    if (!fuelEntry || typeof fuelEntry !== 'object') {
      return 0;
    }

    const totalQuantity = toNumber(fuelEntry.totalQuantity);
    const cars = toNumber(fuelEntry.cars);
    const price = toNumber(fuelEntry.price);
    return (totalQuantity - cars) * price;
  };

  const getShiftOilProfitValue = (shiftRow) => {
    let oilData = parseJsonObject(shiftRow?.oil_data, null);

    if (!oilData) {
      const legacyData = parseJsonObject(shiftRow?.data, null);
      oilData = parseJsonObject(legacyData?.oil_data, null);
    }

    if (!oilData || typeof oilData !== 'object') {
      return 0;
    }

    return Object.values(oilData).reduce((sum, oilEntry) => {
      if (!oilEntry || typeof oilEntry !== 'object') {
        return sum;
      }

      const sold = toNumber(oilEntry.sold);
      const open = toNumber(oilEntry.open);
      const price = toNumber(oilEntry.price);
      return sum + ((sold - open) * price);
    }, 0);
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
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${normalized}-${String(lastDay).padStart(2, '0')}`;
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
      const rows = await executeQuery('SELECT SUBSTR(date, 1, 7) AS month_key FROM oil_invoices WHERE date IS NOT NULL');
      rows.forEach((row) => addMonth(row.month_key));
    } catch (error) {
      console.warn('Unable to read oil_invoices months:', error.message);
    }

    try {
      const rows = await executeQuery('SELECT month_key FROM monthly_profit_custom_values WHERE month_key IS NOT NULL');
      rows.forEach((row) => addMonth(row.month_key));
    } catch (error) {
      console.warn('Unable to read monthly_profit_custom_values months:', error.message);
    }

    return Array.from(monthSet).sort((a, b) => a.localeCompare(b));
  };

  const REPORT_FUEL_TYPES = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'غاز سيارات'];
  const REPORT_PURCHASE_FUEL_TYPES = REPORT_FUEL_TYPES.filter((fuelType) => fuelType !== 'غاز سيارات');
  const DEFAULT_EXPENSE_ROW_ORDER = [
    'اكرامية مواد',
    'مجارى',
    'مياة للمحطة',
    'كهرباء للمحطة',
    'سولار للديزل',
    'رسوم البوسطة',
    'تامينات'
  ];
  const REPORT_PROFIT_BASE_ROWS = [
    { key: 'fuel_diesel', label: 'سولار', section: 'revenue' },
    { key: 'fuel_80', label: 'بنزين ٨٠', section: 'revenue' },
    { key: 'fuel_92', label: 'بنزين ٩٢', section: 'revenue' },
    { key: 'fuel_95', label: 'بنزين ٩٥', section: 'revenue' },
    { key: 'oil_total', label: 'الزيوت', section: 'revenue' },
    { key: 'wash_lube_month', label: 'غسيل و تشحيم', section: 'revenue' },
    { key: 'bonuses', label: 'حوافز', section: 'revenue' },
    { key: 'commission_diff', label: 'فرق العمولة', section: 'revenue' },
    { key: 'expenses_month', label: 'المصاريف', section: 'deduction' },
    { key: 'cash_insurance_month', label: 'تأمين نقدى', section: 'deduction' },
    { key: 'deposit_tax', label: 'ضريبة المنبع', section: 'deduction' },
      { key: 'bonus_tax', label: 'ضرائب الحافز', section: 'deduction' }
  ];
  const EMPTY_EXPENSE_DESCRIPTION_LABEL = 'بدون وصف';
  const normalizeReportExpenseDescription = (value) => String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\u0640/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const ARABIC_MONTH_NAMES = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر'
  ];

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const formatReportNumber = (value) => {
    const number = toNumber(value);
    return number.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
      maximumFractionDigits: 2
    });
  };

  const REPORT_CHART_COLORS = [
    '#FF6384',
    '#36A2EB',
    '#FFCE56',
    '#4BC0C0',
    '#9966FF',
    '#2E7D32',
    '#C2185B',
    '#6D4C41',
    '#00838F',
    '#EF6C00'
  ];

  const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

  const readGeneralSettingsFile = () => {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (error) {
      console.warn('Unable to parse settings.json:', error.message);
      return {};
    }
  };

  const getLastCompleteReportRange = () => {
    const now = new Date();
    const year = now.getFullYear();
    const lastCompleteMonth = now.getMonth();

    if (lastCompleteMonth < 1) {
      throw new Error('لا يوجد شهر مكتمل للتقرير');
    }

    const fromMonth = `${year}-01`;
    const toMonth = `${year}-${String(lastCompleteMonth).padStart(2, '0')}`;
    const toRange = monthToRange(toMonth);

    return {
      year,
      fromMonth,
      toMonth,
      startDate: `${fromMonth}-01`,
      endDate: toRange.endDate,
      months: buildMonthRange(fromMonth, toMonth)
    };
  };

  const getMonthDisplayName = (monthKey) => {
    const [yearText, monthText] = String(monthKey || '').split('-');
    const monthIndex = parseInt(monthText, 10) - 1;
    const year = parseInt(yearText, 10);
    return `${ARABIC_MONTH_NAMES[monthIndex] || monthText} ${year}`;
  };

  const createMonthlyBucketMap = (months, fuelTypes = REPORT_FUEL_TYPES) => {
    const map = new Map();
    fuelTypes.forEach((fuelType) => {
      const values = {};
      months.forEach((monthKey) => {
        values[monthKey] = 0;
      });
      map.set(fuelType, values);
    });
    return map;
  };

  const collectReportProfitRows = async ({ fromMonth, toMonth, months, startDate, endDate }) => {
    const manualRows = await executeQuery(
      'SELECT * FROM monthly_profit_inputs WHERE month_key BETWEEN $1 AND $2 ORDER BY month_key ASC',
      [fromMonth, toMonth]
    ).catch(() => []);

    const shiftRows = await executeQuery(
      'SELECT date, fuel_data, oil_data, data, wash_lube_revenue, total_expenses FROM shifts WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)',
      [startDate, endDate]
    ).catch(() => []);

    const invoiceRows = await executeQuery(
      'SELECT date, invoice_number, fuel_type, total, invoice_total FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
      [startDate, endDate]
    ).catch(async () => {
      const fallbackRows = await executeQuery(
        'SELECT date, invoice_number, fuel_type, total FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
        [startDate, endDate]
      ).catch(() => []);
      return fallbackRows.map((row) => ({ ...row, invoice_total: null }));
    });

    const oilInvoiceRows = await executeQuery(
      'SELECT date, invoice_number, total_purchase, immediate_discount, martyrs_tax FROM oil_invoices WHERE date BETWEEN $1 AND $2',
      [startDate, endDate]
    ).catch(() => []);

    const customRowDefinitions = await executeQuery(
      'SELECT row_key, row_label, row_type, display_order FROM monthly_profit_custom_rows ORDER BY row_type ASC, display_order ASC'
    ).catch(() => []);

    const customValueRows = await executeQuery(
      'SELECT row_key, month_key, amount FROM monthly_profit_custom_values WHERE month_key BETWEEN $1 AND $2',
      [fromMonth, toMonth]
    ).catch(() => []);

    const manualByMonth = new Map();
    manualRows.forEach((row) => {
      const monthKey = normalizeMonthKey(row.month_key);
      if (!monthKey) return;
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
    });

    const dieselByMonth = new Map();
    const fuel80ByMonth = new Map();
    const fuel92ByMonth = new Map();
    const fuel95ByMonth = new Map();
    const oilByMonth = new Map();
    const washByMonth = new Map();
    const expensesByMonth = new Map();
    shiftRows.forEach((row) => {
      const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
      if (!monthKey) return;
      dieselByMonth.set(monthKey, (dieselByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'سولار'));
      fuel80ByMonth.set(monthKey, (fuel80ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٨٠'));
      fuel92ByMonth.set(monthKey, (fuel92ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٩٢'));
      fuel95ByMonth.set(monthKey, (fuel95ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٩٥'));
      oilByMonth.set(monthKey, (oilByMonth.get(monthKey) || 0) + getShiftOilProfitValue(row));
      washByMonth.set(monthKey, (washByMonth.get(monthKey) || 0) + toNumber(row.wash_lube_revenue));
      expensesByMonth.set(monthKey, (expensesByMonth.get(monthKey) || 0) + toNumber(row.total_expenses));
    });

    const groupedInvoices = new Map();
    const fuelPurchasesByMonth = {
      fuel_diesel: new Map(),
      fuel_80: new Map(),
      fuel_92: new Map(),
      fuel_95: new Map()
    };
    invoiceRows.forEach((row) => {
      const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
      if (!monthKey) return;
      const fuelProfitKey = normalizeFuelProfitKey(row?.fuel_type);
      if (fuelProfitKey && fuelPurchasesByMonth[fuelProfitKey]) {
        const purchaseMap = fuelPurchasesByMonth[fuelProfitKey];
        purchaseMap.set(monthKey, (purchaseMap.get(monthKey) || 0) + toNumber(row?.total));
      }

      const invoiceNumber = String(row?.invoice_number || '').trim() || '__unknown__';
      const groupKey = `${monthKey}__${invoiceNumber}`;
      if (!groupedInvoices.has(groupKey)) {
        groupedInvoices.set(groupKey, { monthKey, sumRowsTotal: 0, maxInvoiceTotal: null });
      }

      const entry = groupedInvoices.get(groupKey);
      entry.sumRowsTotal += toNumber(row?.total);
      const invoiceTotalValue = parseFloat(row?.invoice_total);
      if (Number.isFinite(invoiceTotalValue)) {
        entry.maxInvoiceTotal = entry.maxInvoiceTotal === null
          ? invoiceTotalValue
          : Math.max(entry.maxInvoiceTotal, invoiceTotalValue);
      }
    });

    const insuranceByMonth = new Map();
    groupedInvoices.forEach((entry) => {
      const invoiceTotal = entry.maxInvoiceTotal === null ? entry.sumRowsTotal : entry.maxInvoiceTotal;
      const insurance = invoiceTotal - entry.sumRowsTotal;
      insuranceByMonth.set(entry.monthKey, (insuranceByMonth.get(entry.monthKey) || 0) + insurance);
    });

    const groupedOilInvoices = new Map();
    oilInvoiceRows.forEach((row) => {
      const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
      if (!monthKey) return;
      const invoiceNumber = String(row?.invoice_number || '').trim() || '__unknown__';
      const groupKey = `${monthKey}__${invoiceNumber}`;
      if (!groupedOilInvoices.has(groupKey)) {
        groupedOilInvoices.set(groupKey, {
          monthKey,
          subtotal: 0,
          immediateDiscount: null,
          martyrsTax: null
        });
      }

      const entry = groupedOilInvoices.get(groupKey);
      entry.subtotal += toNumber(row?.total_purchase);
      const discountValue = parseFloat(row?.immediate_discount);
      if (Number.isFinite(discountValue)) {
        entry.immediateDiscount = entry.immediateDiscount === null
          ? discountValue
          : Math.max(entry.immediateDiscount, discountValue);
      }
      const taxValue = parseFloat(row?.martyrs_tax);
      if (Number.isFinite(taxValue)) {
        entry.martyrsTax = entry.martyrsTax === null
          ? taxValue
          : Math.max(entry.martyrsTax, taxValue);
      }
    });

    const oilPurchasesByMonth = new Map();
    groupedOilInvoices.forEach((entry) => {
      const invoiceTotal = entry.subtotal - toNumber(entry.immediateDiscount) + toNumber(entry.martyrsTax);
      oilPurchasesByMonth.set(entry.monthKey, (oilPurchasesByMonth.get(entry.monthKey) || 0) + invoiceTotal);
    });

    const normalizedCustomRows = customRowDefinitions
      .map((row) => {
        const rowKey = String(row?.row_key || '').trim();
        if (!rowKey) return null;
        const rowType = row?.row_type === 'deduction' ? 'deduction' : 'revenue';
        return {
          row_key: rowKey,
          row_label: String(row?.row_label || rowKey).trim() || rowKey,
          row_type: rowType,
          display_order: parseInt(row?.display_order, 10) || 0
        };
      })
      .filter(Boolean);

    const customValuesByRow = new Map();
    const customRevenueByMonth = new Map();
    const customDeductionByMonth = new Map();
    customValueRows.forEach((row) => {
      const rowKey = String(row?.row_key || '').trim();
      const monthKey = normalizeMonthKey(row?.month_key);
      if (!rowKey || !monthKey) return;
      if (!customValuesByRow.has(rowKey)) customValuesByRow.set(rowKey, new Map());
      const value = toNumber(row?.amount);
      const rowMap = customValuesByRow.get(rowKey);
      rowMap.set(monthKey, (rowMap.get(monthKey) || 0) + value);

      const rowDefinition = normalizedCustomRows.find((definition) => definition.row_key === rowKey);
      if (rowDefinition?.row_type === 'deduction') {
        customDeductionByMonth.set(monthKey, (customDeductionByMonth.get(monthKey) || 0) + value);
      } else {
        customRevenueByMonth.set(monthKey, (customRevenueByMonth.get(monthKey) || 0) + value);
      }
    });

    const rows = months.map((monthKey) => {
      const manual = manualByMonth.get(monthKey) || {};
      const grossFuelDiesel = dieselByMonth.has(monthKey) ? toNumber(dieselByMonth.get(monthKey)) : toNumber(manual.fuel_diesel);
      const grossFuel80 = fuel80ByMonth.has(monthKey) ? toNumber(fuel80ByMonth.get(monthKey)) : toNumber(manual.fuel_80);
      const grossFuel92 = fuel92ByMonth.has(monthKey) ? toNumber(fuel92ByMonth.get(monthKey)) : toNumber(manual.fuel_92);
      const grossFuel95 = fuel95ByMonth.has(monthKey) ? toNumber(fuel95ByMonth.get(monthKey)) : toNumber(manual.fuel_95);
      const fuel_diesel = grossFuelDiesel - toNumber(fuelPurchasesByMonth.fuel_diesel.get(monthKey));
      const fuel_80 = grossFuel80 - toNumber(fuelPurchasesByMonth.fuel_80.get(monthKey));
      const fuel_92 = grossFuel92 - toNumber(fuelPurchasesByMonth.fuel_92.get(monthKey));
      const fuel_95 = grossFuel95 - toNumber(fuelPurchasesByMonth.fuel_95.get(monthKey));
      const grossOilTotal = oilByMonth.has(monthKey) ? toNumber(oilByMonth.get(monthKey)) : toNumber(manual.oil_total);
      const oil_total = grossOilTotal - toNumber(oilPurchasesByMonth.get(monthKey));
      const bonuses = toNumber(manual.bonuses);
      const commission_diff = toNumber(manual.commission_diff);
      const deposit_tax = toNumber(manual.deposit_tax);
      const bonus_tax = toNumber(manual.bonus_tax);
      const fuel_total_month = fuel_diesel + fuel_80 + fuel_92 + fuel_95;
      const oil_total_month = oil_total;
      const wash_lube_month = toNumber(washByMonth.get(monthKey));
      const expenses_month = toNumber(expensesByMonth.get(monthKey));
      const cash_insurance_month = toNumber(insuranceByMonth.get(monthKey));
      const custom_revenue_total = toNumber(customRevenueByMonth.get(monthKey));
      const custom_deduction_total = toNumber(customDeductionByMonth.get(monthKey));
      const total_positive = fuel_total_month + oil_total_month + wash_lube_month + bonuses + commission_diff + custom_revenue_total;
      const total_deductions = cash_insurance_month + expenses_month + deposit_tax + bonus_tax + custom_deduction_total;
      const net_profit = total_positive - total_deductions;

      const custom_values = {};
      normalizedCustomRows.forEach((customRow) => {
        custom_values[customRow.row_key] = toNumber(customValuesByRow.get(customRow.row_key)?.get(monthKey));
      });

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
        custom_revenue_total,
        total_positive,
        expenses_month,
        cash_insurance_month,
        deposit_tax,
        bonus_tax,
        custom_deduction_total,
        total_deductions,
        net_profit,
        custom_values
      };
    });

    return {
      rows,
      customRows: normalizedCustomRows
    };
  };

  const collectMonthlyReportData = async (options = {}) => {
    const range = getLastCompleteReportRange();
    const salesMap = createMonthlyBucketMap(range.months);
    const purchasesMap = createMonthlyBucketMap(range.months, REPORT_PURCHASE_FUEL_TYPES);

    const shiftRows = await executeQuery(
      'SELECT date, shift_number, fuel_data, data, total_expenses FROM shifts WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)',
      [range.startDate, range.endDate]
    ).catch(() => []);

    shiftRows.forEach((row) => {
      const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
      if (!monthKey) return;
      const legacyData = parseJsonObject(row?.data, {});
      const fuelData = parseJsonObject(row?.fuel_data, null) || parseJsonObject(legacyData?.fuel_data, {});
      REPORT_FUEL_TYPES.forEach((fuelType) => {
        const item = findShiftDataEntryByName(fuelData, fuelType);
        if (!item || typeof item !== 'object') return;
        const soldQuantity = getShiftFuelSoldQuantity(fuelType, item);
        salesMap.get(fuelType)[monthKey] += soldQuantity;
      });
    });

    const purchaseRows = await executeQuery(
      'SELECT date, fuel_type, quantity, net_quantity FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
      [range.startDate, range.endDate]
    ).catch(async () => executeQuery(
      'SELECT date, fuel_type, quantity FROM fuel_invoices WHERE date BETWEEN $1 AND $2',
      [range.startDate, range.endDate]
    ).catch(() => []));

    purchaseRows.forEach((row) => {
      const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
      const fuelType = String(row?.fuel_type || '').trim();
      if (!monthKey || !purchasesMap.has(fuelType)) return;
      const hasNetQuantity = row.net_quantity !== null
        && row.net_quantity !== undefined
        && String(row.net_quantity).trim() !== '';
      purchasesMap.get(fuelType)[monthKey] += hasNetQuantity ? toNumber(row.net_quantity) : toNumber(row.quantity);
    });

    const profitData = await collectReportProfitRows(range);
    const expenses = buildMonthlyExpenseReportRows(range.months, shiftRows, options.expenseRowOrder);

    return {
      ...range,
      titleMonth: getMonthDisplayName(range.toMonth),
      sales: Array.from(salesMap.entries()).map(([fuelType, values]) => ({ fuelType, values })),
      purchases: Array.from(purchasesMap.entries()).map(([fuelType, values]) => ({ fuelType, values })),
      expenses,
      profit: profitData.rows,
      profitCustomRows: profitData.customRows
    };
  };

  const buildMonthlyExpenseReportRows = (months, shiftRows, expenseRowOrder = []) => {
    const monthSet = new Set(months);
    const rowMap = new Map();
    const manualOrder = Array.isArray(expenseRowOrder) ? expenseRowOrder : [];
    const manualOrderKeys = manualOrder.map(normalizeReportExpenseDescription);
    const defaultOrderKeys = DEFAULT_EXPENSE_ROW_ORDER.map(normalizeReportExpenseDescription);

    (Array.isArray(shiftRows) ? shiftRows : []).forEach((row) => {
      const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
      if (!monthKey || !monthSet.has(monthKey)) return;

      const snapshot = buildShiftExpenseSnapshot(row);
      const addExpenseValue = (description, amount) => {
        const value = toNumber(amount);
        if (Math.abs(value) < 0.000001) return;
        const label = String(description || '').trim() || EMPTY_EXPENSE_DESCRIPTION_LABEL;
        if (!rowMap.has(label)) {
          const values = {};
          months.forEach((key) => { values[key] = 0; });
          rowMap.set(label, { description: label, values, total: 0 });
        }
        const expenseRow = rowMap.get(label);
        expenseRow.values[monthKey] += value;
        expenseRow.total += value;
      };

      if (snapshot.expenseItems.length > 0) {
        snapshot.expenseItems.forEach((item) => {
          addExpenseValue(item.description, item.amount);
        });
        return;
      }

      addExpenseValue(LEGACY_AGGREGATED_EXPENSE_LABEL, snapshot.totalExpenses);
    });

    return Array.from(rowMap.values()).sort((a, b) => {
      const manualA = manualOrderKeys.indexOf(normalizeReportExpenseDescription(a.description));
      const manualB = manualOrderKeys.indexOf(normalizeReportExpenseDescription(b.description));
      if (manualA !== -1 || manualB !== -1) {
        if (manualA === -1) return 1;
        if (manualB === -1) return -1;
        return manualA - manualB;
      }

      const defaultA = defaultOrderKeys.indexOf(normalizeReportExpenseDescription(a.description));
      const defaultB = defaultOrderKeys.indexOf(normalizeReportExpenseDescription(b.description));
      if (defaultA !== -1 || defaultB !== -1) {
        if (defaultA === -1) return 1;
        if (defaultB === -1) return -1;
        return defaultA - defaultB;
      }

      if (Math.abs(b.total - a.total) > 0.0001) {
        return b.total - a.total;
      }
      return a.description.localeCompare(b.description, 'ar');
    });
  };

  const buildReportMatrixTable = (title, months, rows, labelKey, { includeColumnTotals = false } = {}) => {
    const totalByMonth = {};
    months.forEach((monthKey) => { totalByMonth[monthKey] = 0; });

    const rowHtml = rows.map((row) => {
      let rowTotal = 0;
      const cells = months.map((monthKey) => {
        const value = toNumber(row.values[monthKey]);
        rowTotal += value;
        totalByMonth[monthKey] += value;
        return `<td>${formatReportNumber(value)}</td>`;
      }).join('');
      return `<tr><th>${escapeHtml(row[labelKey])}</th>${cells}<td>${formatReportNumber(rowTotal)}</td></tr>`;
    }).join('');

    const totalRowHtml = includeColumnTotals
      ? (() => {
          const grandTotal = months.reduce((sum, monthKey) => sum + totalByMonth[monthKey], 0);
          const totalCells = months.map((monthKey) => `<td>${formatReportNumber(totalByMonth[monthKey])}</td>`).join('');
          return `<tr class="total-row"><th>الإجمالي</th>${totalCells}<td>${formatReportNumber(grandTotal)}</td></tr>`;
        })()
      : '';

    return `
      <section>
        <h2>${escapeHtml(title)}</h2>
        <table>
          <thead>
            <tr>
              <th>البند</th>
              ${months.map((monthKey) => `<th>${escapeHtml(getMonthDisplayName(monthKey))}</th>`).join('')}
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${rowHtml}
            ${totalRowHtml}
          </tbody>
        </table>
      </section>
    `;
  };

  const buildReportLineChart = (title, months, rows, labelKey) => {
    const width = 980;
    const height = 330;
    const margin = { top: 34, right: 58, bottom: 82, left: 74 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = rows.flatMap((row) => months.map((monthKey) => toNumber(row.values?.[monthKey])));
    const maxValue = Math.max(...values, 0);
    const yMax = maxValue > 0 ? maxValue * 1.12 : 1;
    const xForIndex = (index) => {
      if (months.length <= 1) return margin.left + (plotWidth / 2);
      return margin.left + ((plotWidth / (months.length - 1)) * index);
    };
    const yForValue = (value) => margin.top + plotHeight - ((toNumber(value) / yMax) * plotHeight);
    const yTicks = Array.from({ length: 5 }, (_unused, index) => (yMax / 4) * index);

    const gridLines = yTicks.map((tick) => {
      const y = yForValue(tick);
      return `
        <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />
        <text x="${margin.left - 10}" y="${y + 5}" text-anchor="end" fill="#5f6c76" font-size="13">${escapeHtml(formatReportNumber(tick))}</text>
      `;
    }).join('');

    const xLabels = months.map((monthKey, index) => {
      const x = xForIndex(index);
      return `
        <text x="${x}" y="${height - margin.bottom + 28}" text-anchor="middle" fill="#34495e" font-size="13">
          ${escapeHtml(getMonthDisplayName(monthKey))}
        </text>
      `;
    }).join('');

    const series = rows.map((row, index) => {
      const color = REPORT_CHART_COLORS[index % REPORT_CHART_COLORS.length];
      const points = months.map((monthKey, monthIndex) => `${xForIndex(monthIndex)},${yForValue(row.values?.[monthKey])}`).join(' ');
      const circles = months.map((monthKey, monthIndex) => (
        `<circle cx="${xForIndex(monthIndex)}" cy="${yForValue(row.values?.[monthKey])}" r="3" fill="${color}" />`
      )).join('');
      return `
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
      `;
    }).join('');

    const legend = rows.map((row, index) => {
      const color = REPORT_CHART_COLORS[index % REPORT_CHART_COLORS.length];
      const x = width - margin.right - (index % 5) * 160;
      const y = height - 30 + Math.floor(index / 5) * 18;
      return `
        <g>
          <rect x="${x - 14}" y="${y - 9}" width="10" height="10" rx="2" fill="${color}" />
          <text x="${x - 20}" y="${y + 1}" text-anchor="end" fill="#34495e" font-size="14">${escapeHtml(row[labelKey])}</text>
        </g>
      `;
    }).join('');

    return `
      <div class="report-chart-block">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
          <text x="${width / 2}" y="24" text-anchor="middle" fill="#2c3e50" font-size="20" font-weight="700">${escapeHtml(title)}</text>
          ${gridLines}
          <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#9aa6b2" stroke-width="1.2" />
          <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#9aa6b2" stroke-width="1.2" />
          ${xLabels}
          ${series}
          ${legend}
        </svg>
      </div>
    `;
  };

  const buildExpensesReportTable = (months, expenseRows) => {
    const rows = (Array.isArray(expenseRows) ? expenseRows : []).map((row) => {
      const cells = months.map((monthKey) => {
        const value = toNumber(row.values?.[monthKey]);
        return `<td>${Math.abs(value) > 0.000001 ? formatReportNumber(value) : ''}</td>`;
      }).join('');
      return `<tr><th>${escapeHtml(row.description)}</th>${cells}<td>${formatReportNumber(row.total)}</td></tr>`;
    }).join('');

    return `
      <section>
        <h2>المصاريف</h2>
        <table class="expenses-report-table">
          <colgroup>
            <col class="expense-name-column">
            ${months.map(() => '<col>').join('')}
            <col class="expense-total-column">
          </colgroup>
          <thead>
            <tr>
              <th class="expense-label-col">المصروف</th>
              ${months.map((monthKey) => `<th>${escapeHtml(getMonthDisplayName(monthKey))}</th>`).join('')}
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="99">لا توجد مصاريف</td></tr>'}</tbody>
        </table>
      </section>
    `;
  };

  const buildProfitReportTable = (months, profitRows, customRows = []) => {
    const byMonth = new Map(profitRows.map((row) => [row.month_key, row]));
    const sortedCustomRows = (rowType) => (Array.isArray(customRows) ? customRows : [])
      .filter((row) => row.row_type === rowType)
      .sort((a, b) => (a.display_order - b.display_order) || a.row_key.localeCompare(b.row_key));

    const metrics = [
      ...REPORT_PROFIT_BASE_ROWS.filter((row) => row.section === 'revenue'),
      ...sortedCustomRows('revenue').map((row) => ({
        key: row.row_key,
        label: row.row_label,
        section: 'revenue',
        custom: true
      })),
      ...REPORT_PROFIT_BASE_ROWS.filter((row) => row.section === 'deduction'),
      ...sortedCustomRows('deduction').map((row) => ({
        key: row.row_key,
        label: row.row_label,
        section: 'deduction',
        custom: true
      })),
      { key: 'total_positive', label: 'إجمالي الإيرادات', summary: true, rowClass: 'profit-summary-revenue-row' },
      { key: 'total_deductions', label: 'إجمالي الخصومات', summary: true, rowClass: 'profit-summary-deduction-row' },
      { key: 'net_profit', label: 'صافي المكسب', summary: true, net: true, rowClass: 'profit-net-row' }
    ];

    const getMetricValue = (monthKey, metric) => {
      const monthRow = byMonth.get(monthKey) || {};
      if (metric.custom) {
        return toNumber(monthRow.custom_values?.[metric.key]);
      }
      return toNumber(monthRow[metric.key]);
    };

    const totalNetProfit = months.reduce((sum, monthKey) => (
      sum + toNumber(byMonth.get(monthKey)?.net_profit)
    ), 0);

    const rows = metrics.map((metric) => {
      const values = months.map((monthKey) => getMetricValue(monthKey, metric));
      const hasValue = values.some((value) => Math.abs(value) > 0.000001);
      if (!hasValue) return '';

      let rowTotal = 0;
      const cells = values.map((value) => {
        rowTotal += value;
        return `<td>${formatReportNumber(value)}</td>`;
      }).join('');
      const rowClass = metric.rowClass
        ? ` class="${metric.rowClass}"`
        : (metric.summary ? ' class="total-row"' : '');
      return `<tr${rowClass}><th>${escapeHtml(metric.label)}</th>${cells}<td>${formatReportNumber(rowTotal)}</td></tr>`;
    }).join('');

    return `
      <section>
        <h2>المكسب</h2>
        <table>
          <thead>
            <tr>
              <th>البند</th>
              ${months.map((monthKey) => `<th>${escapeHtml(getMonthDisplayName(monthKey))}</th>`).join('')}
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="99">لا توجد بيانات</td></tr>'}</tbody>
        </table>
        <div class="profit-total-card">
          <span>الربح</span>
          <strong>${formatReportNumber(totalNetProfit)}</strong>
        </div>
      </section>
    `;
  };

  const buildMonthlyReportHtml = (reportData) => {
    const title = `تقرير شهري ${reportData.titleMonth} - محطة بنزين سمنود`;
    return `
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #1f2933;
            font-family: "Noto Naskh Arabic", Arial, sans-serif;
            direction: rtl;
          }
          h1 {
            color: #a91d13;
            font-size: 24px;
            margin: 0 0 8px;
            text-align: center;
          }
          .subtitle {
            color: #52616b;
            margin-bottom: 18px;
            text-align: center;
          }
          section {
            break-inside: avoid;
            margin-top: 18px;
          }
          h2 {
            border-bottom: 2px solid #a91d13;
            color: #2c3e50;
            font-size: 22px;
            margin: 0 0 10px;
            padding-bottom: 5px;
            text-align: center;
          }
          table {
            border-collapse: collapse;
            direction: rtl;
            font-size: 11px;
            width: 100%;
          }
          th, td {
            border: 1px solid #cfd8dc;
            padding: 5px 6px;
            text-align: center;
            white-space: nowrap;
          }
          thead th {
            background: #a91d13;
            color: #ffffff;
          }
          tbody th {
            background: #f4f6f8;
            text-align: right;
          }
          .expenses-report-table {
            table-layout: fixed;
          }
          .expenses-report-table col.expense-name-column {
            width: 12%;
          }
          .expenses-report-table col.expense-total-column {
            width: 9%;
          }
          .expenses-report-table .expense-label-col,
          .expenses-report-table tbody th {
            white-space: normal;
            line-height: 1.25;
          }
          .total-row th,
          .total-row td {
            background: #fff3cd;
            font-weight: 700;
          }
          .profit-summary-revenue-row th,
          .profit-summary-revenue-row td {
            background: #eef7ff;
            color: #154c79;
            font-size: 12px;
            font-weight: 800;
          }
          .profit-summary-deduction-row th,
          .profit-summary-deduction-row td {
            background: #fff5f5;
            color: #8a1c1c;
            font-size: 12px;
            font-weight: 800;
          }
          .profit-net-row th,
          .profit-net-row td {
            background: #e8f5e9;
            color: #1b5e20;
            font-size: 13px;
            font-weight: 700;
          }
          .report-chart-block {
            break-inside: avoid;
            margin: 14px auto 22px;
            width: 78%;
          }
          .report-chart-block h3 {
            color: #2c3e50;
            font-size: 18px;
            margin: 0 0 6px;
            text-align: center;
          }
          .report-chart-block svg {
            border: 1px solid #d8dee4;
            border-radius: 6px;
            display: block;
            height: auto;
            width: 100%;
          }
          .profit-total-card {
            align-items: center;
            background: #e8f5e9;
            border: 1px solid #a5d6a7;
            border-radius: 6px;
            color: #1b5e20;
            display: flex;
            font-size: 15px;
            gap: 12px;
            justify-content: center;
            margin: 12px auto 0;
            padding: 10px 18px;
            width: fit-content;
          }
          .profit-total-card span {
            font-size: 20px;
            font-weight: 800;
          }
          .profit-total-card strong {
            font-size: 22px;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="subtitle">الفترة من ${escapeHtml(getMonthDisplayName(reportData.fromMonth))} إلى ${escapeHtml(reportData.titleMonth)}</div>
        ${buildReportMatrixTable('المبيعات', reportData.months, reportData.sales, 'fuelType')}
        ${buildReportLineChart('رسم بياني للمبيعات الشهرية حسب نوع الوقود', reportData.months, reportData.sales, 'fuelType')}
        ${buildExpensesReportTable(reportData.months, reportData.expenses)}
        ${buildReportMatrixTable('المشتريات', reportData.months, reportData.purchases, 'fuelType')}
        ${buildReportLineChart('رسم بياني للمشتريات الشهرية حسب نوع الوقود', reportData.months, reportData.purchases, 'fuelType')}
        ${buildProfitReportTable(reportData.months, reportData.profit, reportData.profitCustomRows)}
      </body>
      </html>
    `;
  };

  const writeMonthlyReportPdf = async ({ promptSave = false, expenseRowOrder = [] } = {}) => {
    const reportData = await collectMonthlyReportData({ expenseRowOrder });
    const html = buildMonthlyReportHtml(reportData);
    const reportWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    try {
      await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdfBuffer = await reportWindow.webContents.printToPDF({
        printBackground: true,
        landscape: true,
        pageSize: 'A4'
      });
      const fileName = `monthly-report-${reportData.toMonth}.pdf`;
      let filePath = path.join(app.getPath('temp'), fileName);

      if (promptSave) {
        const saveDialogOptions = {
          title: 'حفظ التقرير الشهري PDF',
          defaultPath: path.join(app.getPath('downloads'), fileName),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        };
        const saveResult = mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
          : await dialog.showSaveDialog(saveDialogOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return { canceled: true, reportData };
        }

        filePath = saveResult.filePath;
      } else {
        const tempReportDir = path.join(app.getPath('temp'), 'coop2-monthly-reports');
        fs.mkdirSync(tempReportDir, { recursive: true });
        filePath = path.join(tempReportDir, fileName);
      }

      fs.writeFileSync(filePath, pdfBuffer);
      return { filePath, reportData };
    } finally {
      if (!reportWindow.isDestroyed()) {
        reportWindow.close();
      }
    }
  };

  const parseReportRecipients = (value) => String(value || '')
    .split(/[\n,;]/)
    .map((email) => email.trim())
    .filter(Boolean);

  const getMonthlyReportEmailSettings = () => {
    const settings = readGeneralSettingsFile();
    const recipients = parseReportRecipients(settings.monthlyReportRecipients);
    if (recipients.length === 0) {
      throw new Error('يرجى إدخال إيميلات المستلمين');
    }

    const smtpHost = String(settings.monthlyReportSmtpHost || '').trim();
    const smtpPort = parseInt(settings.monthlyReportSmtpPort, 10);
    const smtpUser = String(settings.monthlyReportSmtpUser || '').trim();
    const smtpPassword = String(settings.monthlyReportSmtpPassword || '');
    const fromEmail = String(settings.monthlyReportFromEmail || smtpUser).trim();

    if (!smtpHost || !Number.isFinite(smtpPort) || !smtpUser || !smtpPassword || !fromEmail) {
      throw new Error('يرجى إكمال إعدادات SMTP والبريد المرسل');
    }

    return {
      recipients,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      fromEmail,
      secure: Boolean(settings.monthlyReportSmtpSecure)
    };
  };

  const sendMonthlyReportEmailWithAttachment = async (filePath, reportData) => {
    const emailSettings = getMonthlyReportEmailSettings();

    const transporter = nodemailer.createTransport({
      host: emailSettings.smtpHost,
      port: emailSettings.smtpPort,
      secure: emailSettings.secure,
      auth: {
        user: emailSettings.smtpUser,
        pass: emailSettings.smtpPassword
      }
    });

    const subject = `تقرير شهري ${reportData.titleMonth} - محطة بنزين سمنود`;
    await transporter.sendMail({
      from: emailSettings.fromEmail,
      to: emailSettings.recipients,
      subject,
      text: `مرفق ${subject}`,
      attachments: [
        {
          filename: path.basename(filePath),
          path: filePath,
          contentType: 'application/pdf'
        }
      ]
    });

    return emailSettings.recipients;
  };

  ipcMain.handle('generate-monthly-report-pdf', async (_event, options = {}) => {
    try {
      const result = await writeMonthlyReportPdf({
        promptSave: true,
        expenseRowOrder: options.expenseRowOrder
      });
      if (result.canceled) {
        return {
          success: false,
          canceled: true,
          error: 'تم إلغاء إنشاء التقرير',
          month: result.reportData?.toMonth || null
        };
      }

      const { filePath, reportData } = result;
      return {
        success: true,
        filePath,
        month: reportData.toMonth
      };
    } catch (error) {
      console.error('Error generating monthly report PDF:', error);
      return {
        success: false,
        error: error.message || 'حدث خطأ أثناء إنشاء التقرير'
      };
    }
  });

  ipcMain.handle('send-monthly-report-email', async (_event, options = {}) => {
    let filePath = null;
    let reportData = null;
    try {
      getMonthlyReportEmailSettings();
      ({ filePath, reportData } = await writeMonthlyReportPdf({
        expenseRowOrder: options.expenseRowOrder
      }));
      const sentTo = await sendMonthlyReportEmailWithAttachment(filePath, reportData);
      return {
        success: true,
        filePath,
        month: reportData.toMonth,
        sentTo
      };
    } catch (error) {
      console.error('Error sending monthly report email:', error);
      return {
        success: false,
        error: error.message ? `فشل إرسال البريد: ${error.message}` : 'حدث خطأ أثناء إرسال التقرير',
        filePath,
        month: reportData?.toMonth || null
      };
    }
  });

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
      const product = await getProductByCodeOrName('fuel', saleData.product_code, fuel_type);
      const productCode = product?.product_code || saleData.product_code || null;
      const productName = product?.product_name || fuel_type;
      const query = 'INSERT INTO sales (date, product_code, fuel_type, quantity, price_per_liter, total_amount, payment_method, customer_name, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
      return await executeInsert(query, [date, productCode, productName, quantity, price_per_liter, total_amount, payment_method, customer_name, notes], 'sales');
    } catch (error) {
      console.error('Error adding sale:', error);
      throw error;
    }
  });

  ipcMain.handle('get-fuel-prices', async () => {
    try {
      return await executeQuery("SELECT id, product_code, product_name as fuel_type, current_price as price, is_active, effective_date FROM products WHERE product_type = 'fuel' ORDER BY product_name");
    } catch (error) {
      console.error('Error getting fuel prices:', error);
      throw error;
    }
  });

  ipcMain.handle('get-purchase-prices', async () => {
    try {
      return await executeQuery(`
        SELECT
          pp.id,
          p.id AS product_id,
          p.product_code,
          p.product_name AS fuel_type,
          pp.price,
          pp.effective_date,
          pp.updated_at
        FROM products p
        LEFT JOIN purchase_prices pp
          ON pp.product_code = p.product_code
          OR (pp.product_code IS NULL AND pp.fuel_type = p.product_name)
        WHERE p.product_type = 'fuel'
        ORDER BY p.product_name
      `);
    } catch (error) {
      console.error('Error getting purchase prices:', error);
      throw error;
    }
  });

  ipcMain.handle('update-purchase-price', async (event, { fuel_type, price }) => {
    try {
      const product = await getProductByCodeOrName('fuel', null, fuel_type);
      const productCode = product?.product_code || null;
      const productId = product?.id || null;
      const productName = product?.product_name || fuel_type;
      const today = new Date().toISOString().slice(0, 10);
      await executeInsert(
        `INSERT INTO purchase_price_history (fuel_type, product_code, price, start_date, product_id, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [productName, productCode, price, today, productId],
        'purchase_price_history'
      );
      return await executeUpdate(
        `INSERT INTO purchase_prices (fuel_type, product_code, price, effective_date, product_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (fuel_type) DO UPDATE
         SET product_code = EXCLUDED.product_code,
             price = EXCLUDED.price,
             effective_date = EXCLUDED.effective_date,
             product_id = EXCLUDED.product_id,
             updated_at = CURRENT_TIMESTAMP`,
        [productName, productCode, price, today, productId]
      );
    } catch (error) {
      console.error('Error updating purchase price:', error);
      throw error;
    }
  });

  // Oil Prices Handlers
  ipcMain.handle('get-oil-prices', async () => {
    try {
      return await executeQuery("SELECT id, product_code, product_name as oil_type, current_price as price, vat, is_active, effective_date, display_order FROM products WHERE product_type = 'oil' ORDER BY CASE WHEN COALESCE(display_order, 0) = 0 THEN 1 ELSE 0 END ASC, COALESCE(display_order, 0) ASC, product_name ASC");
    } catch (error) {
      console.error('Error getting oil prices:', error);
      throw error;
    }
  });

  ipcMain.handle('save-oils-order', async (_event, oilOrder) => {
    try {
      if (!Array.isArray(oilOrder)) {
        throw new Error('ترتيب الزيوت غير صالح');
      }

      const cleanRequestedOrder = oilOrder
        .map((oilName) => String(oilName || '').trim())
        .filter(Boolean);
      const existingRows = await executeQuery(
        "SELECT product_name FROM products WHERE product_type = 'oil' ORDER BY CASE WHEN COALESCE(display_order, 0) = 0 THEN 1 ELSE 0 END ASC, COALESCE(display_order, 0) ASC, product_name ASC"
      );
      const requestedSet = new Set(cleanRequestedOrder);
      const missingRows = existingRows
        .map((row) => String(row.product_name || '').trim())
        .filter((oilName) => oilName && !requestedSet.has(oilName));
      const completeOrder = [...cleanRequestedOrder, ...missingRows];

      for (const [index, oilName] of completeOrder.entries()) {
        const cleanName = String(oilName || '').trim();
        if (!cleanName) continue;
        await executeUpdate(
          'UPDATE products SET display_order = $1 WHERE product_type = $2 AND product_name = $3',
          [index + 1, 'oil', cleanName]
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving oils order:', error);
      return { success: false, error: error.message };
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

      const product = await createProduct('fuel', fuel_type, price);
      return product.id || 1;
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
      const orderRows = await executeQuery(
        'SELECT COALESCE(MAX(display_order), 0) AS max_order FROM products WHERE product_type = $1',
        ['oil']
      );
      const nextOrder = (parseInt(orderRows[0]?.max_order, 10) || 0) + 1;
      const product = await createProduct('oil', oil_type, price, { vat: vatValue, display_order: nextOrder });
      return product.id || 1;
    } catch (error) {
      console.error('Error adding oil price:', error);
      throw error;
    }
  });

  ipcMain.handle('add-excel-import-product', async (_event, productData) => {
    try {
      const productType = String(productData?.product_type || '').trim();
      const productName = String(productData?.product_name || '').trim();
      const price = parseFloat(productData?.price);
      const startDate = String(productData?.start_date || '').trim();

      if (!['fuel', 'oil'].includes(productType)) {
        throw new Error('نوع المنتج غير صالح');
      }

      if (!productName) {
        throw new Error('يرجى إدخال اسم المنتج');
      }

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error('يرجى إدخال سعر صحيح');
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        throw new Error('تاريخ السعر غير صالح');
      }

      const existing = await executeQuery(
        'SELECT * FROM products WHERE product_name = $1',
        [productName]
      );
      if (existing.length > 0) {
        throw new Error('يوجد منتج بهذا الاسم بالفعل');
      }

      const orderRows = await executeQuery(
        'SELECT COALESCE(MAX(display_order), 0) AS max_order FROM products WHERE product_type = $1',
        [productType]
      );
      const nextOrder = (parseInt(orderRows[0]?.max_order, 10) || 0) + 1;

      const product = await createProduct(productType, productName, price, {
        vat: 0,
        effective_date: startDate,
        display_order: nextOrder
      });
      const productId = product?.id || null;
      const productCode = product?.product_code || null;

      await executeInsert(
        'INSERT INTO price_history (product_type, product_name, product_code, price, start_date, product_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [productType, productName, productCode, price, startDate, productId],
        'price_history'
      );

      return { success: true, id: productId };
    } catch (error) {
      console.error('Error adding Excel import product:', error);
      return { success: false, error: error.message };
    }
  });

  // Update product name
  ipcMain.handle('update-product-name', async (event, { type, oldName, newName, id }) => {
    try {
      const oldProductName = String(oldName || '').trim();
      const newProductName = String(newName || '').trim();
      const productId = parseInt(id, 10);

      if (!['fuel', 'oil'].includes(type) || !oldProductName || !newProductName) {
        throw new Error('بيانات المنتج غير صالحة');
      }

      // Check if new name already exists for this product type
      const checkQuery = 'SELECT * FROM products WHERE product_type = $1 AND product_name = $2';
      const existing = await executeQuery(checkQuery, [type, newProductName]);

      if (existing.length > 0) {
        throw new Error('يوجد منتج بهذا الاسم بالفعل');
      }

      const updateQuery = Number.isFinite(productId)
        ? 'UPDATE products SET product_name = $1 WHERE product_type = $2 AND id = $3'
        : 'UPDATE products SET product_name = $1 WHERE product_type = $2 AND product_name = $3';
      await executeUpdate(updateQuery, [newProductName, type, Number.isFinite(productId) ? productId : oldProductName]);

      return { success: true };
    } catch (error) {
      console.error('Error updating product name:', error);
      throw error;
    }
  });

  // Save all prices with history
  ipcMain.handle('save-all-prices', async (event, prices) => {
    try {
      if (!Array.isArray(prices) || prices.length === 0) {
        throw new Error('No prices to save');
      }

      const normalizeDateOnly = (value) => {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return value.toISOString().split('T')[0];
        }

        const raw = String(value).trim();
        const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateOnlyMatch) {
          return dateOnlyMatch[1];
        }

        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0];
      };

      const isValidDateOnly = (value) => {
        const dateOnly = normalizeDateOnly(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;

        const parsed = new Date(`${dateOnly}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().split('T')[0] === dateOnly;
      };

      const skipped = [];
      let saved = 0;
      let updatedCurrent = 0;

      for (const item of prices) {
        const product_type = String(item?.product_type || '').trim();
        const product_name = String(item?.product_name || '').trim();
        const rawPrice = item?.price;
        const normalizedPrice = String(rawPrice ?? '').replace(',', '.').trim();
        const price = parseFloat(normalizedPrice);
        const start_date = normalizeDateOnly(item?.start_date);

        if (!['fuel', 'oil'].includes(product_type) || !product_name || !isValidDateOnly(start_date)) {
          console.warn(`Missing or invalid required fields for price: ${JSON.stringify(item)}`);
          skipped.push({ product_name, reason: 'invalid_fields' });
          continue;
        }

        if (normalizedPrice === '') {
          skipped.push({ product_name, reason: 'empty_price' });
          continue;
        }

        if (!Number.isFinite(price) || price <= 0) {
          console.warn(`Invalid price for ${product_name}: ${item?.price}`);
          skipped.push({ product_name, reason: 'invalid_price' });
          continue;
        }

        // Get product_id and current effective_date from products table
        const productQuery = 'SELECT id, product_code, effective_date FROM products WHERE product_type = $1 AND product_name = $2';
        const productResult = await executeQuery(productQuery, [product_type, product_name]);

        if (productResult.length === 0) {
          console.warn(`Product not found: ${product_type} - ${product_name}`);
          skipped.push({ product_name, reason: 'product_not_found' });
          continue;
        }

        const product_id = productResult[0].id;
        const product_code = productResult[0].product_code || null;
        const current_effective_date = normalizeDateOnly(productResult[0].effective_date);

        // Save to history with product_id (always save to history)
        const historyQuery = 'INSERT INTO price_history (product_type, product_name, product_code, price, start_date, product_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)';
        await executeInsert(historyQuery, [product_type, product_name, product_code, price, start_date, product_id], 'price_history');
        saved++;

        // Update current price in products table ONLY if new date is more recent
        // If no current date exists, always update
        if (!current_effective_date || start_date >= current_effective_date) {
          const updateQuery = 'UPDATE products SET current_price = $1, effective_date = $2 WHERE id = $3';
          await executeUpdate(updateQuery, [price, start_date, product_id]);
          updatedCurrent++;
        }
      }
      return { success: true, saved, skipped, updatedCurrent };
    } catch (error) {
      console.error('Error saving prices:', error);
      throw error;
    }
  });

  ipcMain.handle('save-all-purchase-prices', async (_event, prices) => {
    try {
      if (!Array.isArray(prices) || prices.length === 0) {
        throw new Error('No purchase prices to save');
      }

      const normalizeDateOnly = (value) => {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return value.toISOString().split('T')[0];
        }

        const raw = String(value).trim();
        const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateOnlyMatch) {
          return dateOnlyMatch[1];
        }

        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0];
      };

      const isValidDateOnly = (value) => {
        const dateOnly = normalizeDateOnly(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;

        const parsed = new Date(`${dateOnly}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().split('T')[0] === dateOnly;
      };

      const skipped = [];
      let saved = 0;
      let updatedCurrent = 0;

      for (const item of prices) {
        const product_name = String(item?.product_name || item?.fuel_type || '').trim();
        const product_code_input = String(item?.product_code || '').trim();
        const normalizedPrice = String(item?.price ?? '').replace(',', '.').trim();
        const price = parseFloat(normalizedPrice);
        const start_date = normalizeDateOnly(item?.start_date);

        if (!product_name || !isValidDateOnly(start_date)) {
          skipped.push({ product_name, reason: 'invalid_fields' });
          continue;
        }

        if (normalizedPrice === '') {
          skipped.push({ product_name, reason: 'empty_price' });
          continue;
        }

        if (!Number.isFinite(price) || price <= 0) {
          skipped.push({ product_name, reason: 'invalid_price' });
          continue;
        }

        const product = await getProductByCodeOrName('fuel', product_code_input, product_name);
        if (!product) {
          skipped.push({ product_name, reason: 'product_not_found' });
          continue;
        }

        const product_id = product.id;
        const product_code = product.product_code || product_code_input || null;
        const fuel_type = product.product_name || product_name;
        const currentRows = await executeQuery(
          'SELECT effective_date FROM purchase_prices WHERE product_code = $1 OR (product_code IS NULL AND fuel_type = $2) LIMIT 1',
          [product_code, fuel_type]
        );
        const current_effective_date = normalizeDateOnly(currentRows[0]?.effective_date);

        await executeInsert(
          `INSERT INTO purchase_price_history (fuel_type, product_code, price, start_date, product_id, created_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          [fuel_type, product_code, price, start_date, product_id],
          'purchase_price_history'
        );
        saved++;

        if (!current_effective_date || start_date >= current_effective_date) {
          await executeUpdate(
            `INSERT INTO purchase_prices (fuel_type, product_code, price, effective_date, product_id, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (fuel_type) DO UPDATE
             SET product_code = EXCLUDED.product_code,
                 price = EXCLUDED.price,
                 effective_date = EXCLUDED.effective_date,
                 product_id = EXCLUDED.product_id,
                 updated_at = CURRENT_TIMESTAMP`,
            [fuel_type, product_code, price, start_date, product_id]
          );
          updatedCurrent++;
        }
      }

      return { success: true, saved, skipped, updatedCurrent };
    } catch (error) {
      console.error('Error saving purchase prices:', error);
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

      query += ' ORDER BY created_at DESC';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting price history:', error);
      throw error;
    }
  });

  ipcMain.handle('get-purchase-price-history', async (_event, filter) => {
    try {
      requireOnline('سجل أسعار الشراء');
      let query = 'SELECT * FROM purchase_price_history';
      const params = [];

      if (filter) {
        query += ' WHERE fuel_type = $1';
        params.push(filter);
      }

      query += ' ORDER BY created_at DESC';

      return await executeQuery(query, params);
    } catch (error) {
      console.error('Error getting purchase price history:', error);
      throw error;
    }
  });

  ipcMain.handle('get-purchase-prices-by-date', async (_event, { date }) => {
    try {
      const rawDate = String(date || '').trim();
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

      return await executeQuery(
        `
          SELECT
            p.id AS product_id,
            p.product_code,
            p.product_name AS fuel_type,
            (
              SELECT pph.price
              FROM purchase_price_history pph
              WHERE (
                  pph.product_id = p.id
                  OR pph.product_code = p.product_code
                  OR (pph.product_id IS NULL AND pph.product_code IS NULL AND pph.fuel_type = p.product_name)
                )
                AND pph.start_date <= $1
              ORDER BY pph.start_date DESC, pph.created_at DESC, pph.id DESC
              LIMIT 1
            ) AS price
          FROM products p
          WHERE p.product_type = 'fuel'
          ORDER BY p.product_name
        `,
        [normalizedDate]
      );
    } catch (error) {
      console.error('Error getting purchase prices by date:', error);
      throw error;
    }
  });

  ipcMain.handle('get-price-by-date', async (event, { product_name, date }) => {
    try {
      const productResult = await executeQuery(
        'SELECT id, current_price as price FROM products WHERE product_name = $1',
        [product_name]
      );
      const productId = productResult.length > 0 ? productResult[0].id : null;

      // Get the most recent price that was effective on or before the given date
      const query = productId
        ? `
          SELECT price
          FROM price_history
          WHERE (product_id = $1 OR (product_id IS NULL AND product_name = $2)) AND start_date <= $3
          ORDER BY start_date DESC, created_at DESC, id DESC
          LIMIT 1
        `
        : `
          SELECT price
          FROM price_history
          WHERE product_name = $1 AND start_date <= $2
          ORDER BY start_date DESC, created_at DESC, id DESC
          LIMIT 1
        `;
      const result = await executeQuery(query, productId ? [productId, product_name, date] : [product_name, date]);

      // If no historical price found, try to get current price from products table
      if (result.length === 0) {
        return productResult.length > 0 ? productResult[0].price : null;
      }

      return result[0].price;
    } catch (error) {
      console.error('Error getting price by date:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-prices-by-date', async (event, { date }) => {
    try {
      const shiftDate = String(date || '').trim();
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(shiftDate)
        ? shiftDate
        : new Date().toISOString().slice(0, 10);

      const rows = await executeQuery(
        `
          SELECT
            p.product_name,
            COALESCE(
              (
                SELECT ph.price
                FROM price_history ph
                WHERE (ph.product_id = p.id OR (ph.product_id IS NULL AND ph.product_name = p.product_name))
                  AND ph.start_date <= $1
                ORDER BY ph.start_date DESC, ph.created_at DESC, ph.id DESC
                LIMIT 1
              ),
              p.current_price
            ) AS price
          FROM products p
          WHERE p.product_type = 'oil'
          ORDER BY p.product_name
        `,
        [normalizedDate]
      );

      return rows.map((row) => ({
        product_name: row.product_name,
        price: parseFloat(row.price) || 0
      }));
    } catch (error) {
      console.error('Error getting oil prices by date:', error);
      throw error;
    }
  });

  ipcMain.handle('get-sales-report', async (event, { startDate, endDate }) => {
    try {
      requireOnline('التقارير');
      const reportQuery = 'SELECT * FROM sales WHERE date BETWEEN $1 AND $2 ORDER BY date DESC';
      return await executeQuery(reportQuery, [startDate, endDate]);
    } catch (error) {
      if (error.code !== 'OFFLINE_RESTRICTED') {
        console.error('Error getting sales report:', error);
      }
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

  ipcMain.handle('get-shift-fuel-sales', async () => {
    try {
      const rows = await executeQuery(
        'SELECT date, fuel_data, data FROM shifts WHERE is_saved = 1 ORDER BY date ASC, shift_number ASC, id ASC'
      );

      const entries = [];

      rows.forEach((row) => {
        const legacyData = parseStoredObject(row?.data, {});
        const fuelData = parseStoredObject(row?.fuel_data || legacyData.fuel_data, {});
        const shiftDate = String(row?.date || '').slice(0, 10);
        if (!shiftDate) return;

        Object.entries(fuelData).forEach(([fuelType, data]) => {
          if (!data || typeof data !== 'object') return;

          const quantity = getShiftFuelSoldQuantity(fuelType, data);
          if (quantity <= 0) return;

          entries.push({
            date: shiftDate,
            fuel_type: getShiftProductDisplayName(fuelType, data),
            product_code: String(data.product_code || fuelType || '').trim(),
            quantity
          });
        });
      });

      return entries;
    } catch (error) {
      console.error('Error getting shift fuel sales:', error);
      throw error;
    }
  });

  ipcMain.handle('get-tank-fuel-movements', async (_event, fuelType) => {
    try {
      const selectedFuelType = String(fuelType || '').trim();
      if (!selectedFuelType) {
        return [];
      }

      const invoiceRows = await executeQuery(
        'SELECT date, invoice_number, fuel_type, quantity, net_quantity FROM fuel_invoices WHERE fuel_type = $1 ORDER BY date ASC, id ASC',
        [selectedFuelType]
      ).catch((error) => {
        console.warn('Unable to read fuel invoices for tank movements:', error.message);
        return [];
      });

      const shiftRows = await executeQuery(
        'SELECT date, shift_number, fuel_data, data FROM shifts WHERE is_saved = 1 ORDER BY date ASC, shift_number ASC, id ASC'
      ).catch((error) => {
        console.warn('Unable to read shifts for tank movements:', error.message);
        return [];
      });

      const movements = [];

      invoiceRows.forEach((row) => {
        const quantity = toFiniteNumber(row.net_quantity) > 0
          ? toFiniteNumber(row.net_quantity)
          : toFiniteNumber(row.quantity);
        if (quantity <= 0) return;

        movements.push({
          date: String(row.date || '').slice(0, 10),
          type: 'in',
          quantity,
          source: row.invoice_number ? `فاتورة ${row.invoice_number}` : 'فاتورة وقود'
        });
      });

      shiftRows.forEach((row) => {
        const legacyData = parseStoredObject(row?.data, {});
        const fuelData = parseStoredObject(row?.fuel_data || legacyData.fuel_data, {});
        const data = findShiftDataEntryByName(fuelData, selectedFuelType);
        const quantity = getShiftFuelSoldQuantity(selectedFuelType, data);
        if (quantity <= 0) return;

        const shiftNumber = parseInt(row.shift_number, 10) === 2 ? 2 : 1;
        movements.push({
          date: String(row.date || '').slice(0, 10),
          type: 'out',
          quantity,
          source: shiftNumber === 1 ? 'وردية صباح' : 'وردية ليل'
        });
      });

      movements.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.type !== b.type) return a.type === 'out' ? 1 : -1;
        return String(b.source || '').localeCompare(String(a.source || ''), 'ar');
      });

      return movements;
    } catch (error) {
      console.error('Error getting tank fuel movements:', error);
      throw error;
    }
  });

  ipcMain.handle('get-tank-fuel-types', async () => {
    try {
      const preferredOrder = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'غاز سيارات'];
      const types = new Set(preferredOrder);

      const productRows = await executeQuery(
        "SELECT product_name FROM products WHERE product_type = 'fuel' ORDER BY product_name"
      ).catch(() => []);
      productRows.forEach((row) => {
        const name = String(row.product_name || '').trim();
        if (name) types.add(name);
      });

      const invoiceRows = await executeQuery(
        'SELECT DISTINCT fuel_type FROM fuel_invoices WHERE fuel_type IS NOT NULL'
      ).catch(() => []);
      invoiceRows.forEach((row) => {
        const name = String(row.fuel_type || '').trim();
        if (name) types.add(name);
      });

      const shiftRows = await executeQuery(
        'SELECT fuel_data, data FROM shifts WHERE is_saved = 1'
      ).catch(() => []);
      shiftRows.forEach((row) => {
        const legacyData = parseStoredObject(row?.data, {});
        const fuelData = parseStoredObject(row?.fuel_data || legacyData.fuel_data, {});
        Object.entries(fuelData || {}).forEach(([name, data]) => {
          const cleanName = getShiftProductDisplayName(name, data);
          if (cleanName) types.add(cleanName);
        });
      });

      return Array.from(types).sort((a, b) => {
        const indexA = preferredOrder.indexOf(a);
        const indexB = preferredOrder.indexOf(b);
        if (indexA !== -1 || indexB !== -1) {
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          return indexA - indexB;
        }
        return a.localeCompare(b, 'ar');
      });
    } catch (error) {
      console.error('Error getting tank fuel types:', error);
      throw error;
    }
  });

  ipcMain.handle('get-tank-summary', async () => {
    try {
      const preferredOrder = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'غاز سيارات'];
      const totals = new Map();

      const ensureFuel = (fuelType) => {
        const name = String(fuelType || '').trim();
        if (!name) return null;
        if (!totals.has(name)) {
          totals.set(name, { fuel_type: name, incoming: 0, outgoing: 0, balance: 0 });
        }
        return totals.get(name);
      };

      preferredOrder.forEach(ensureFuel);

      const productRows = await executeQuery(
        "SELECT product_name FROM products WHERE product_type = 'fuel' ORDER BY product_name"
      ).catch(() => []);
      productRows.forEach((row) => ensureFuel(row.product_name));

      const invoiceRows = await executeQuery(
        'SELECT fuel_type, quantity, net_quantity FROM fuel_invoices WHERE fuel_type IS NOT NULL'
      ).catch((error) => {
        console.warn('Unable to read fuel invoices for tank summary:', error.message);
        return [];
      });
      invoiceRows.forEach((row) => {
        const target = ensureFuel(row.fuel_type);
        if (!target) return;
        const quantity = toFiniteNumber(row.net_quantity) > 0
          ? toFiniteNumber(row.net_quantity)
          : toFiniteNumber(row.quantity);
        target.incoming += Math.max(quantity, 0);
      });

      const shiftRows = await executeQuery(
        'SELECT fuel_data, data FROM shifts WHERE is_saved = 1'
      ).catch((error) => {
        console.warn('Unable to read shifts for tank summary:', error.message);
        return [];
      });
      shiftRows.forEach((row) => {
        const legacyData = parseStoredObject(row?.data, {});
        const fuelData = parseStoredObject(row?.fuel_data || legacyData.fuel_data, {});
        Object.entries(fuelData || {}).forEach(([fuelType, data]) => {
          const fuelName = getShiftProductDisplayName(fuelType, data);
          const target = ensureFuel(fuelName);
          if (!target) return;
          target.outgoing += getShiftFuelSoldQuantity(fuelName, data);
        });
      });

      return Array.from(totals.values())
        .map((row) => ({
          ...row,
          balance: row.incoming - row.outgoing
        }))
        .sort((a, b) => {
          const indexA = preferredOrder.indexOf(a.fuel_type);
          const indexB = preferredOrder.indexOf(b.fuel_type);
          if (indexA !== -1 || indexB !== -1) {
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          }
          return a.fuel_type.localeCompare(b.fuel_type, 'ar');
        });
    } catch (error) {
      console.error('Error getting tank summary:', error);
      throw error;
    }
  });

  ipcMain.handle('get-current-tank-stock', async (_event, fuelType) => {
    try {
      const selectedFuelType = String(fuelType || '').trim();
      if (!selectedFuelType) {
        return 0;
      }

      const rows = await executeQuery(
        'SELECT date, invoice_number, fuel_type, quantity, net_quantity FROM fuel_invoices WHERE fuel_type = $1',
        [selectedFuelType]
      ).catch(() => []);

      const shiftRows = await executeQuery(
        'SELECT date, shift_number, fuel_data, data FROM shifts WHERE is_saved = 1'
      ).catch(() => []);

      const incoming = rows.reduce((sum, row) => {
        const quantity = toFiniteNumber(row.net_quantity) > 0
          ? toFiniteNumber(row.net_quantity)
          : toFiniteNumber(row.quantity);
        return sum + Math.max(quantity, 0);
      }, 0);

      const outgoing = shiftRows.reduce((sum, row) => {
        const legacyData = parseStoredObject(row?.data, {});
        const fuelData = parseStoredObject(row?.fuel_data || legacyData.fuel_data, {});
        return sum + getShiftFuelSoldQuantity(selectedFuelType, findShiftDataEntryByName(fuelData, selectedFuelType));
      }, 0);

      return incoming - outgoing;
    } catch (error) {
      console.error('Error getting current tank stock:', error);
      throw error;
    }
  });

  ipcMain.handle('get-shift-oil-sales', async () => {
    try {
      const rows = await executeQuery(
        'SELECT date, oil_data, data FROM shifts WHERE is_saved = 1 ORDER BY date ASC, shift_number ASC, id ASC'
      );

      const entries = [];

      rows.forEach((row) => {
        const legacyData = parseStoredObject(row?.data, {});
        const oilData = parseStoredObject(row?.oil_data || legacyData.oil_data, {});
        const shiftDate = String(row?.date || '').slice(0, 10);
        if (!shiftDate) return;

        Object.entries(oilData).forEach(([oilName, data]) => {
          if (!data || typeof data !== 'object') return;

          const sold = toFiniteNumber(data.sold);
          if (sold <= 0) return;

          entries.push({
            date: shiftDate,
            product_name: getShiftProductDisplayName(oilName, data),
            product_code: String(data.product_code || oilName || '').trim(),
            quantity: sold
          });
        });
      });

      return entries;
    } catch (error) {
      console.error('Error getting shift oil sales:', error);
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
        'SELECT date, fuel_data, oil_data, data, wash_lube_revenue, total_expenses FROM shifts WHERE date BETWEEN $1 AND $2 AND (is_saved = 1 OR is_saved IS NULL)',
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

      const oilInvoiceRows = await executeQuery(
        'SELECT date, invoice_number, total_purchase, immediate_discount, martyrs_tax FROM oil_invoices WHERE date BETWEEN $1 AND $2',
        [startDate, endDate]
      ).catch((error) => {
        console.warn('Unable to read oil invoices for profit calculation:', error.message);
        return [];
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
      const oilByMonth = new Map();
      const washByMonth = new Map();
      const expensesByMonth = new Map();
      for (const row of shiftRows) {
        const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
        if (!monthKey) continue;
        dieselByMonth.set(monthKey, (dieselByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'سولار'));
        fuel80ByMonth.set(monthKey, (fuel80ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٨٠'));
        fuel92ByMonth.set(monthKey, (fuel92ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٩٢'));
        fuel95ByMonth.set(monthKey, (fuel95ByMonth.get(monthKey) || 0) + getShiftFuelProfitValue(row, 'بنزين ٩٥'));
        oilByMonth.set(monthKey, (oilByMonth.get(monthKey) || 0) + getShiftOilProfitValue(row));
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

      const groupedOilInvoices = new Map();
      for (const row of oilInvoiceRows) {
        const monthKey = normalizeMonthKey(String(row?.date || '').slice(0, 7));
        if (!monthKey) continue;

        const invoiceNumber = String(row?.invoice_number || '').trim() || '__unknown__';
        const groupKey = `${monthKey}__${invoiceNumber}`;
        if (!groupedOilInvoices.has(groupKey)) {
          groupedOilInvoices.set(groupKey, {
            monthKey,
            subtotal: 0,
            immediateDiscount: null,
            martyrsTax: null
          });
        }

        const entry = groupedOilInvoices.get(groupKey);
        entry.subtotal += toNumber(row?.total_purchase);

        const discountValue = parseFloat(row?.immediate_discount);
        if (Number.isFinite(discountValue)) {
          entry.immediateDiscount = entry.immediateDiscount === null
            ? discountValue
            : Math.max(entry.immediateDiscount, discountValue);
        }

        const taxValue = parseFloat(row?.martyrs_tax);
        if (Number.isFinite(taxValue)) {
          entry.martyrsTax = entry.martyrsTax === null
            ? taxValue
            : Math.max(entry.martyrsTax, taxValue);
        }
      }

      const oilPurchasesByMonth = new Map();
      for (const entry of groupedOilInvoices.values()) {
        const invoiceTotal = entry.subtotal - toNumber(entry.immediateDiscount) + toNumber(entry.martyrsTax);
        oilPurchasesByMonth.set(entry.monthKey, (oilPurchasesByMonth.get(entry.monthKey) || 0) + invoiceTotal);
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
        const grossOilTotal = oilByMonth.has(monthKey)
          ? toNumber(oilByMonth.get(monthKey))
          : toNumber(manual.oil_total);
        const oil_total = grossOilTotal - toNumber(oilPurchasesByMonth.get(monthKey));
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
      const { oil_type, date, type, invoice_number } = movementData;
      const quantity = parseFloat(movementData.quantity);
      const product = await getProductByCodeOrName('oil', movementData.product_code, oil_type);
      const productCode = product?.product_code || movementData.product_code || null;
      const productName = product?.product_name || oil_type;
      const insertQuery = 'INSERT INTO oil_movements (product_code, oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5, $6)';
      return await executeInsert(insertQuery, [productCode, productName, date, type, quantity, invoice_number], 'oil_movements');
    } catch (error) {
      console.error('Error adding oil movement:', error);
      throw error;
    }
  });

  ipcMain.handle('get-oil-movements', async (event, oilTypeInput) => {
    try {
      const oilType = typeof oilTypeInput === 'object'
        ? String(oilTypeInput?.oilType || '').trim()
        : String(oilTypeInput || '').trim();
      const productCode = typeof oilTypeInput === 'object' ? String(oilTypeInput?.productCode || '').trim() : '';
      const year = typeof oilTypeInput === 'object' ? parseInt(oilTypeInput?.year, 10) : null;
      const product = await getProductByCodeOrName('oil', productCode, oilType);
      const queryCode = product?.product_code || productCode;
      const queryName = product?.product_name || oilType;

      if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
        const movementsQuery = `
          SELECT * FROM oil_movements
          WHERE (product_code = $1 OR (product_code IS NULL AND oil_type = $2)) AND date >= $3 AND date <= $4
          ORDER BY date DESC, created_at DESC
        `;
        return await executeQuery(movementsQuery, [queryCode, queryName, `${year}-01-01`, `${year}-12-31`]);
      }

      const movementsQuery = 'SELECT * FROM oil_movements WHERE product_code = $1 OR (product_code IS NULL AND oil_type = $2) ORDER BY date DESC, created_at DESC';
      return await executeQuery(movementsQuery, [queryCode, queryName]);
    } catch (error) {
      console.error('Error getting oil movements:', error);
      throw error;
    }
  });

  ipcMain.handle('get-current-oil-stock', async (event, oilTypeInput) => {
    try {
      const oilType = typeof oilTypeInput === 'object'
        ? String(oilTypeInput?.oilType || '').trim()
        : String(oilTypeInput || '').trim();
      const productCode = typeof oilTypeInput === 'object' ? String(oilTypeInput?.productCode || '').trim() : '';
      const endDate = typeof oilTypeInput === 'object' ? String(oilTypeInput?.endDate || '').trim() : '';
      const product = await getProductByCodeOrName('oil', productCode, oilType);
      const queryCode = product?.product_code || productCode;
      const queryName = product?.product_name || oilType;
      const params = [queryCode, queryName];
      let stockQuery = 'SELECT type, quantity, invoice_number FROM oil_movements WHERE (product_code = $1 OR (product_code IS NULL AND oil_type = $2))';

      if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        stockQuery += ' AND date <= $3';
        params.push(endDate);
      }

      stockQuery += ' ORDER BY date ASC, created_at ASC, id ASC';
      const result = await executeQuery(stockQuery, params);
      let stock = 0;
      result.forEach(row => {
        if (String(row.invoice_number || '').trim() === 'فرق جرد') return;
        if (row.type === 'in') {
          stock += parseFloat(row.quantity) || 0;
        } else if (row.type === 'out') {
          stock -= parseFloat(row.quantity) || 0;
        } else if (row.type === 'audit') {
          stock = parseFloat(row.quantity) || 0;
        }
      });
      return stock;
    } catch (error) {
      console.error('Error getting oil stock:', error);
      throw error;
    }
  });

  ipcMain.handle('save-oil-stock-audit', async (event, auditData) => {
    try {
      const date = String(auditData?.date || '').trim();
      const items = Array.isArray(auditData?.items) ? auditData.items : [];

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('تاريخ الجرد غير صالح');
      }

      if (items.length === 0) {
        throw new Error('لا توجد زيوت للجرد');
      }

      let counted = 0;
      const auditReference = 'جرد المخزن';

      for (const item of items) {
        const oilType = String(item?.oil_type || '').trim();
        const product = await getProductByCodeOrName('oil', item?.product_code, oilType);
        const productCode = product?.product_code || item?.product_code || null;
        const productName = product?.product_name || oilType;
        const countedQuantity = parseFloat(item?.quantity);

        if (!productName || !Number.isFinite(countedQuantity) || countedQuantity < 0) {
          throw new Error('بيانات الجرد غير صالحة');
        }

        const auditInsertQuery = 'INSERT INTO oil_movements (product_code, oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5, $6)';
        await executeInsert(auditInsertQuery, [productCode, productName, date, 'audit', countedQuantity, auditReference], 'oil_movements');
        counted += 1;
      }

      return { success: true, counted };
    } catch (error) {
      console.error('Error saving oil stock audit:', error);
      throw error;
    }
  });

  // Fuel movement handlers
  ipcMain.handle('add-fuel-movement', async (event, movementData) => {
    try {
      const { fuel_type, date, type, quantity, invoice_number, notes } = movementData;
      const product = await getProductByCodeOrName('fuel', movementData.product_code, fuel_type);
      const productCode = product?.product_code || movementData.product_code || null;
      const productName = product?.product_name || fuel_type;
      const insertQuery = 'INSERT INTO fuel_movements (product_code, fuel_type, date, type, quantity, invoice_number, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)';
      return await executeInsert(insertQuery, [productCode, productName, date, type, quantity, invoice_number, notes], 'fuel_movements');
    } catch (error) {
      console.error('Error adding fuel movement:', error);
      throw error;
    }
  });

  ipcMain.handle('get-fuel-movements', async (event, fuelTypeInput) => {
    try {
      let movementsQuery, params;
      const fuelType = typeof fuelTypeInput === 'object'
        ? String(fuelTypeInput?.fuelType || '').trim()
        : String(fuelTypeInput || '').trim();
      const productCode = typeof fuelTypeInput === 'object' ? String(fuelTypeInput?.productCode || '').trim() : '';
      const product = await getProductByCodeOrName('fuel', productCode, fuelType);
      const queryCode = product?.product_code || productCode;
      const queryName = product?.product_name || fuelType;
      if (queryCode || queryName) {
        movementsQuery = 'SELECT * FROM fuel_movements WHERE product_code = $1 OR (product_code IS NULL AND fuel_type = $2) ORDER BY date DESC, created_at DESC';
        params = [queryCode, queryName];
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

  ipcMain.handle('get-current-fuel-stock', async (event, fuelTypeInput) => {
    try {
      const fuelType = typeof fuelTypeInput === 'object'
        ? String(fuelTypeInput?.fuelType || '').trim()
        : String(fuelTypeInput || '').trim();
      const productCode = typeof fuelTypeInput === 'object' ? String(fuelTypeInput?.productCode || '').trim() : '';
      const product = await getProductByCodeOrName('fuel', productCode, fuelType);
      const queryCode = product?.product_code || productCode;
      const queryName = product?.product_name || fuelType;
      const stockQuery = 'SELECT type, SUM(quantity) as total FROM fuel_movements WHERE product_code = $1 OR (product_code IS NULL AND fuel_type = $2) GROUP BY type';
      const result = await executeQuery(stockQuery, [queryCode, queryName]);
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
        const product = await getProductByCodeOrName('fuel', item.product_code, item.fuel_type);
        const productCode = product?.product_code || item.product_code || null;
        const productName = product?.product_name || item.fuel_type;
        const invoiceQuery = `
          INSERT INTO fuel_invoices (
            date, invoice_number, product_code, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        await executeInsert(invoiceQuery, [
          date,
          invoice_number,
          productCode,
          productName,
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
        const product = await getProductByCodeOrName('oil', item.product_code, item.oil_type);
        const productCode = product?.product_code || item.product_code || null;
        const productName = product?.product_name || item.oil_type;
        const invoiceQuery = 'INSERT INTO oil_invoices (date, invoice_number, product_code, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)';
        await executeInsert(invoiceQuery, [date, invoice_number, productCode, productName, item.quantity, item.purchase_price, item.iva, item.total_purchase, immediate_discount || 0, martyrs_tax || 0], 'oil_invoices');

        // Also create a stock movement "in" for each oil line
        const movementQuery = 'INSERT INTO oil_movements (product_code, oil_type, date, type, quantity, invoice_number) VALUES ($1, $2, $3, $4, $5, $6)';
        await executeInsert(movementQuery, [productCode, productName, date, 'in', item.quantity, invoice_number], 'oil_movements');
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

      let existingSettings = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch (error) {
          existingSettings = {};
        }
      }

      fs.writeFileSync(settingsPath, JSON.stringify({ ...existingSettings, ...settings }, null, 2));
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

  ipcMain.handle('export-chatgpt-csv', async (_event, payload = {}) => {
    try {
      const fs = require('fs');
      const range = normalizeChatGptDateRange(payload);
      if (!range) {
        return { success: false, error: 'Invalid date range' };
      }

      const [
        sales,
        shifts,
        fuelInvoices,
        oilInvoices,
        fuelMovements,
        oilMovements,
        safeBookMovements,
        monthlyProfitInputs,
        monthlyProfitCustomValues
      ] = await Promise.all([
        executeQuery(
          'SELECT * FROM sales WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM shifts WHERE date BETWEEN $1 AND $2 AND is_saved = 1 ORDER BY date ASC, shift_number ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM fuel_invoices WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM oil_invoices WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM fuel_movements WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM oil_movements WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM safe_book_movements WHERE date BETWEEN $1 AND $2 ORDER BY date ASC, id ASC',
          [range.startDate, range.endDate]
        ),
        executeQuery(
          'SELECT * FROM monthly_profit_inputs WHERE month_key BETWEEN $1 AND $2 ORDER BY month_key ASC',
          [range.startMonth, range.endMonth]
        ),
        executeQuery(
          `SELECT v.*, r.row_label, r.row_type
           FROM monthly_profit_custom_values v
           LEFT JOIN monthly_profit_custom_rows r ON r.row_key = v.row_key
           WHERE v.month_key BETWEEN $1 AND $2
           ORDER BY v.month_key ASC, r.display_order ASC, v.row_key ASC`,
          [range.startMonth, range.endMonth]
        )
      ]);

      const rows = [];

      sales.forEach((sale) => {
        rows.push(createChatGptCsvRow({
          source: 'sales',
          date: normalizeIsoDate(sale.date),
          record_type: 'sale',
          product: sale.fuel_type,
          quantity: sale.quantity,
          unit_price: sale.price_per_liter,
          total_amount: sale.total_amount,
          payment_method: sale.payment_method,
          description: sale.customer_name,
          notes: sale.notes,
          raw_details: stringifyRawDetails(sale)
        }));
      });

      shifts.forEach((shift) => {
        const legacyData = parseStoredObject(shift.data, {});
        const fuelData = parseStoredObject(shift.fuel_data || legacyData.fuel_data, {});
        const oilData = parseStoredObject(shift.oil_data || legacyData.oil_data, {});
        const shiftDate = normalizeIsoDate(shift.date);

        rows.push(createChatGptCsvRow({
          source: 'shifts',
          date: shiftDate,
          record_type: 'shift_summary',
          total_amount: shift.grand_total,
          shift_number: shift.shift_number,
          description: 'Saved shift totals',
          notes: `fuel_total=${toFiniteNumber(shift.fuel_total)}, oil_total=${toFiniteNumber(shift.oil_total)}, expenses=${toFiniteNumber(shift.total_expenses)}`,
          raw_details: stringifyRawDetails(shift)
        }));

        Object.entries(fuelData || {}).forEach(([fuelType, data]) => {
          if (!data || typeof data !== 'object') return;
          const fuelName = getShiftProductDisplayName(fuelType, data);
          const quantity = getShiftFuelSoldQuantity(fuelName, data);
          const unitPrice = toFiniteNumber(data.price || data.price_per_liter);
          const totalAmount = toFiniteNumber(data.total || data.totalAmount || data.amount) || (quantity * unitPrice);
          if (quantity <= 0 && totalAmount <= 0) return;

          rows.push(createChatGptCsvRow({
            source: 'shifts',
            date: shiftDate,
            record_type: 'shift_fuel_sale',
            product: fuelName,
            quantity,
            unit_price: unitPrice,
            total_amount: totalAmount,
            shift_number: shift.shift_number,
            description: 'Fuel sold during shift',
            raw_details: stringifyRawDetails(data)
          }));
        });

        Object.entries(oilData || {}).forEach(([oilType, data]) => {
          if (!data || typeof data !== 'object') return;
          const oilName = getShiftProductDisplayName(oilType, data);
          const quantity = toFiniteNumber(data.sold || data.quantity || data.totalQuantity);
          const unitPrice = toFiniteNumber(data.price || data.unit_price);
          const totalAmount = toFiniteNumber(data.total || data.totalAmount || data.amount) || (quantity * unitPrice);
          if (quantity <= 0 && totalAmount <= 0) return;

          rows.push(createChatGptCsvRow({
            source: 'shifts',
            date: shiftDate,
            record_type: 'shift_oil_sale',
            product: oilName,
            quantity,
            unit_price: unitPrice,
            total_amount: totalAmount,
            shift_number: shift.shift_number,
            description: 'Oil sold during shift',
            raw_details: stringifyRawDetails(data)
          }));
        });
      });

      fuelInvoices.forEach((invoice) => {
        rows.push(createChatGptCsvRow({
          source: 'fuel_invoices',
          date: normalizeIsoDate(invoice.date),
          record_type: 'fuel_purchase_invoice',
          product: invoice.fuel_type,
          quantity: invoice.net_quantity || invoice.quantity,
          unit_price: invoice.purchase_price,
          total_amount: invoice.invoice_total || invoice.total,
          direction: 'in',
          invoice_number: invoice.invoice_number,
          description: 'Fuel purchase invoice',
          raw_details: stringifyRawDetails(invoice)
        }));
      });

      oilInvoices.forEach((invoice) => {
        rows.push(createChatGptCsvRow({
          source: 'oil_invoices',
          date: normalizeIsoDate(invoice.date),
          record_type: 'oil_purchase_invoice',
          product: invoice.oil_type,
          quantity: invoice.quantity,
          unit_price: invoice.purchase_price,
          total_amount: invoice.total_purchase,
          direction: 'in',
          invoice_number: invoice.invoice_number,
          description: 'Oil purchase invoice',
          notes: `iva=${toFiniteNumber(invoice.iva)}, immediate_discount=${toFiniteNumber(invoice.immediate_discount)}, martyrs_tax=${toFiniteNumber(invoice.martyrs_tax)}`,
          raw_details: stringifyRawDetails(invoice)
        }));
      });

      fuelMovements.forEach((movement) => {
        rows.push(createChatGptCsvRow({
          source: 'fuel_movements',
          date: normalizeIsoDate(movement.date),
          record_type: 'fuel_stock_movement',
          product: movement.fuel_type,
          quantity: movement.quantity,
          direction: movement.type,
          invoice_number: movement.invoice_number,
          description: 'Fuel inventory movement',
          notes: movement.notes,
          raw_details: stringifyRawDetails(movement)
        }));
      });

      oilMovements.forEach((movement) => {
        rows.push(createChatGptCsvRow({
          source: 'oil_movements',
          date: normalizeIsoDate(movement.date),
          record_type: 'oil_stock_movement',
          product: movement.oil_type,
          quantity: movement.quantity,
          direction: movement.type,
          invoice_number: movement.invoice_number,
          description: 'Oil inventory movement',
          raw_details: stringifyRawDetails(movement)
        }));
      });

      safeBookMovements.forEach((movement) => {
        rows.push(createChatGptCsvRow({
          source: 'safe_book_movements',
          date: normalizeIsoDate(movement.date),
          record_type: 'safe_book_movement',
          total_amount: movement.amount,
          direction: movement.direction,
          description: movement.movement_type,
          raw_details: stringifyRawDetails(movement)
        }));
      });

      const profitFieldLabels = {
        fuel_diesel: 'Fuel diesel profit',
        fuel_80: 'Fuel 80 profit',
        fuel_92: 'Fuel 92 profit',
        fuel_95: 'Fuel 95 profit',
        oil_total: 'Oil profit',
        bonuses: 'Bonuses',
        commission_diff: 'Commission difference',
        deposit_tax: 'Deposit tax',
        bonus_tax: 'Bonus tax'
      };

      monthlyProfitInputs.forEach((profitRow) => {
        Object.entries(profitFieldLabels).forEach(([field, label]) => {
          const amount = toFiniteNumber(profitRow[field]);
          if (amount === 0) return;
          rows.push(createChatGptCsvRow({
            source: 'monthly_profit_inputs',
            date: `${profitRow.month_key}-01`,
            month: profitRow.month_key,
            record_type: 'monthly_profit_input',
            total_amount: amount,
            description: label,
            raw_details: stringifyRawDetails({ month_key: profitRow.month_key, field, amount })
          }));
        });
      });

      monthlyProfitCustomValues.forEach((customValue) => {
        const amount = toFiniteNumber(customValue.amount);
        if (amount === 0) return;
        rows.push(createChatGptCsvRow({
          source: 'monthly_profit_custom_values',
          date: `${customValue.month_key}-01`,
          month: customValue.month_key,
          record_type: customValue.row_type || 'monthly_profit_custom_value',
          total_amount: amount,
          description: customValue.row_label || customValue.row_key,
          raw_details: stringifyRawDetails(customValue)
        }));
      });

      rows.sort((a, b) => {
        if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
        if (a.source !== b.source) return String(a.source).localeCompare(String(b.source));
        return String(a.record_type).localeCompare(String(b.record_type));
      });

      const saveResult = await dialog.showSaveDialog({
        title: 'حفظ ملف ChatGPT CSV',
        defaultPath: `chatgpt-export-${range.startDate}_to_${range.endDate}.csv`,
        filters: [
          { name: 'CSV Files', extensions: ['csv'] }
        ]
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(saveResult.filePath, buildCsv(rows), 'utf8');
      return {
        success: true,
        filePath: saveResult.filePath,
        rowCount: rows.length
      };
    } catch (error) {
      console.error('Error exporting ChatGPT CSV:', error);
      return { success: false, error: error.message };
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
      const purchasePriceHistory = await executeQuery('SELECT * FROM purchase_price_history ORDER BY created_at DESC');
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
        purchasePriceHistory,
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
          const product = await getProductByCodeOrName('fuel', invoice.product_code, invoice.fuel_type);
          const productCode = product?.product_code || invoice.product_code || null;
          const productName = product?.product_name || invoice.fuel_type;
          const query = `
            INSERT INTO fuel_invoices (
              date, invoice_number, product_code, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING
          `;
          await executeInsert(query, [
            invoice.date,
            invoice.invoice_number,
            productCode,
            productName,
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
          const product = await getProductByCodeOrName('oil', invoice.product_code, invoice.oil_type);
          const productCode = product?.product_code || invoice.product_code || null;
          const productName = product?.product_name || invoice.oil_type;
          const query = 'INSERT INTO oil_invoices (date, invoice_number, product_code, oil_type, quantity, purchase_price, iva, total_purchase, immediate_discount, martyrs_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING';
          await executeInsert(query, [
            invoice.date,
            invoice.invoice_number,
            productCode,
            productName,
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
          const productCode = String(product.product_code || '').trim() || generateProductCode(product.product_type);
          const query = 'INSERT INTO products (product_type, product_name, product_code, current_price, vat, is_active, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (product_name) DO UPDATE SET product_code = COALESCE(products.product_code, EXCLUDED.product_code), current_price = $4, vat = $5, is_active = $6, display_order = $7';
          await executeInsert(query, [
            product.product_type,
            product.product_name,
            productCode,
            product.current_price,
            product.vat || 0,
            product.is_active !== undefined ? product.is_active : 1,
            parseInt(product.display_order, 10) || 0
          ], 'products');
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
          const product = await getProductByCodeOrName('fuel', price.product_code, price.fuel_type);
          const productCode = product?.product_code || price.product_code || null;
          const productName = product?.product_name || price.fuel_type;
          const query = `
            INSERT INTO purchase_prices (fuel_type, product_code, price, effective_date, product_id, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (fuel_type) DO UPDATE
            SET product_code = COALESCE(purchase_prices.product_code, EXCLUDED.product_code),
                price = EXCLUDED.price,
                effective_date = EXCLUDED.effective_date,
                product_id = COALESCE(purchase_prices.product_id, EXCLUDED.product_id),
                updated_at = EXCLUDED.updated_at
          `;
          await executeInsert(query, [
            productName,
            productCode,
            price.price,
            price.effective_date || null,
            product?.id || price.product_id || null,
            price.updated_at || new Date().toISOString()
          ], 'purchase_prices');
        }
      }

      // Import price history
      if (backupData.priceHistory) {
        for (const item of backupData.priceHistory) {
          const rawCreatedAt = item.created_at;
          let createdAt = rawCreatedAt || new Date().toISOString();

          if (typeof rawCreatedAt === 'number') {
            createdAt = new Date(rawCreatedAt * 1000).toISOString();
          } else if (typeof rawCreatedAt === 'string' && /^\d+$/.test(rawCreatedAt)) {
            createdAt = new Date(parseInt(rawCreatedAt, 10) * 1000).toISOString();
          }

          const product = await getProductByCodeOrName(item.product_type, item.product_code, item.product_name);
          const productCode = product?.product_code || item.product_code || null;
          const query = 'INSERT INTO price_history (product_type, product_name, product_code, price, start_date, created_at, product_id) VALUES ($1, $2, $3, $4, $5, $6, $7)';
          await executeInsert(query, [
            item.product_type,
            item.product_name,
            productCode,
            item.price,
            item.start_date,
            createdAt,
            item.product_id || null
          ], 'price_history');
        }
      }

      if (backupData.purchasePriceHistory) {
        for (const item of backupData.purchasePriceHistory) {
          const rawCreatedAt = item.created_at;
          let createdAt = rawCreatedAt || new Date().toISOString();

          if (typeof rawCreatedAt === 'number') {
            createdAt = new Date(rawCreatedAt * 1000).toISOString();
          } else if (typeof rawCreatedAt === 'string' && /^\d+$/.test(rawCreatedAt)) {
            createdAt = new Date(parseInt(rawCreatedAt, 10) * 1000).toISOString();
          }

          const product = await getProductByCodeOrName('fuel', item.product_code, item.fuel_type);
          const productCode = product?.product_code || item.product_code || null;
          const productName = product?.product_name || item.fuel_type;
          const query = 'INSERT INTO purchase_price_history (fuel_type, product_code, price, start_date, created_at, product_id) VALUES ($1, $2, $3, $4, $5, $6)';
          await executeInsert(query, [
            productName,
            productCode,
            item.price,
            item.start_date,
            createdAt,
            product?.id || item.product_id || null
          ], 'purchase_price_history');
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
    await migrateShiftProductDataKeys();

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
  if (!dbManager?.isOnline) {
    if (mainWindow) {
      mainWindow.webContents.send('update-check-result', {
        available: false,
        offline: true,
        error: 'لا يوجد اتصال بالإنترنت'
      });
    }
    return;
  }

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
function buildShiftSnapshotFromPayload(payload = {}) {
  const legacyData = parseStoredObject(payload.data, {});
  return {
    date: normalizeIsoDate(payload.date),
    shift_number: parseInt(payload.shift_number, 10) || 1,
    fuel_data: parseStoredObject(payload.fuel_data || legacyData.fuel_data, {}),
    fuel_total: toFiniteNumber(payload.fuel_total ?? legacyData.fuel_total),
    oil_data: parseStoredObject(payload.oil_data || legacyData.oil_data, {}),
    oil_total: toFiniteNumber(payload.oil_total ?? legacyData.oil_total),
    customer_rows: Array.isArray(payload.customer_rows)
      ? payload.customer_rows
      : Array.isArray(legacyData.customer_rows)
        ? legacyData.customer_rows
        : [],
    revenue_items: Array.isArray(payload.revenue_items)
      ? payload.revenue_items
      : Array.isArray(legacyData.revenue_items)
        ? legacyData.revenue_items
        : [],
    expense_items: Array.isArray(payload.expense_items)
      ? payload.expense_items
      : Array.isArray(legacyData.expense_items)
        ? legacyData.expense_items
        : [],
    wash_lube_revenue: toFiniteNumber(payload.wash_lube_revenue ?? legacyData.wash_lube_revenue),
    total_expenses: toFiniteNumber(payload.total_expenses ?? legacyData.total_expenses),
    grand_total: toFiniteNumber(payload.grand_total ?? legacyData.grand_total),
    is_saved: payload.is_saved ? 1 : 0
  };
}

function buildShiftSnapshotFromRow(row = {}) {
  return buildShiftSnapshotFromPayload({
    ...row,
    customer_rows: undefined,
    revenue_items: undefined,
    expense_items: undefined
  });
}

function buildShiftCorrectionDiff(beforeSnapshot, afterSnapshot) {
  const keys = [
    'fuel_data',
    'fuel_total',
    'oil_data',
    'oil_total',
    'customer_rows',
    'revenue_items',
    'expense_items',
    'wash_lube_revenue',
    'total_expenses',
    'grand_total'
  ];
  const changedFields = keys.filter((key) => (
    JSON.stringify(beforeSnapshot?.[key] ?? null) !== JSON.stringify(afterSnapshot?.[key] ?? null)
  ));

  return {
    changed_fields: changedFields,
    changed_count: changedFields.length,
    before_grand_total: toFiniteNumber(beforeSnapshot?.grand_total),
    after_grand_total: toFiniteNumber(afterSnapshot?.grand_total),
    grand_total_difference: toFiniteNumber(afterSnapshot?.grand_total) - toFiniteNumber(beforeSnapshot?.grand_total)
  };
}

async function persistShiftRecord(shiftData) {
  try {
    const {
      date,
      shift_number,
      fuel_data,
      fuel_total,
      oil_data,
      oil_total,
      customer_rows,
      revenue_items,
      expense_items,
      wash_lube_revenue,
      total_expenses,
      grand_total,
      is_saved
    } = shiftData;

    const isSavedShift = is_saved ? 1 : 0;
    if (isSavedShift) {
      const validationErrors = validateShiftPayload(shiftData);
      if (validationErrors.length > 0) {
        return { success: false, error: 'validation_failed', validationErrors };
      }
    }

    // Ensure numeric values are valid (convert NaN/undefined/null to 0)
    const safeFuelTotal = parseFloat(fuel_total) || 0;
    const safeOilTotal = parseFloat(oil_total) || 0;
    const safeWashLubeRevenue = parseFloat(wash_lube_revenue) || 0;
    const safeTotalExpenses = parseFloat(total_expenses) || 0;
    const safeGrandTotal = parseFloat(grand_total) || 0;
    const normalizedRevenueItems = normalizeRevenueItems(revenue_items);
    const normalizedExpenseItems = normalizeExpenseItems(expense_items);
    const normalizedCustomerRows = Array.isArray(customer_rows)
      ? customer_rows
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const diesel = parseFloat(row.diesel) || 0;
            const fuel80 = parseFloat(row['80']) || 0;
            const fuel92 = parseFloat(row['92']) || 0;
            const fuel95 = parseFloat(row['95']) || 0;
            const name = String(row.name || '').trim();
            const voucher = Boolean(row.voucher);
            if (diesel === 0 && fuel80 === 0 && fuel92 === 0 && fuel95 === 0 && !name && !voucher) {
              return null;
            }
            return { diesel, '80': fuel80, '92': fuel92, '95': fuel95, name, voucher };
          })
          .filter(Boolean)
      : [];
    const legacyShiftData = JSON.stringify({
      fuel_data: fuel_data || '{}',
      fuel_total: safeFuelTotal,
      oil_data: oil_data || '{}',
      oil_total: safeOilTotal,
      customer_rows: normalizedCustomerRows,
      revenue_items: normalizedRevenueItems,
      expense_items: normalizedExpenseItems,
      wash_lube_revenue: safeWashLubeRevenue,
      total_expenses: safeTotalExpenses,
      grand_total: safeGrandTotal,
      is_saved: isSavedShift
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
      isSavedShift
    ]);

    if (isSavedShift) {
      await syncShiftOilStockMovements({
        date,
        shift_number,
        oil_data
      });
    }

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
}

ipcMain.handle('save-shift', async (event, shiftData) => {
  return persistShiftRecord(shiftData);
});

ipcMain.handle('correct-saved-shift', async (_event, shiftData) => {
  try {
    const date = normalizeIsoDate(shiftData?.date);
    const shiftNumber = parseInt(shiftData?.shift_number, 10);
    if (!date || !Number.isFinite(shiftNumber)) {
      return { success: false, error: 'invalid_shift_identifier' };
    }

    const existingRows = await executeQuery(
      'SELECT * FROM shifts WHERE date = $1 AND shift_number = $2 AND is_saved = 1',
      [date, shiftNumber]
    );
    if (existingRows.length === 0) {
      return { success: false, error: 'saved_shift_not_found' };
    }

    const beforeSnapshot = buildShiftSnapshotFromRow(existingRows[0]);
    const saveResult = await persistShiftRecord({
      ...shiftData,
      date,
      shift_number: shiftNumber,
      is_saved: 1
    });
    if (!saveResult?.success) {
      return saveResult;
    }

    const updatedRows = await executeQuery(
      'SELECT * FROM shifts WHERE date = $1 AND shift_number = $2 AND is_saved = 1',
      [date, shiftNumber]
    );
    const afterSnapshot = buildShiftSnapshotFromRow(updatedRows[0] || shiftData);
    const diffSummary = buildShiftCorrectionDiff(beforeSnapshot, afterSnapshot);

    const correctionId = await executeInsert(
      `INSERT INTO shift_corrections (date, shift_number, before_data, after_data, diff_summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        date,
        shiftNumber,
        JSON.stringify(beforeSnapshot),
        JSON.stringify(afterSnapshot),
        JSON.stringify(diffSummary)
      ],
      'shift_corrections'
    );

    return { success: true, id: saveResult.id, correction_id: correctionId, diff_summary: diffSummary };
  } catch (error) {
    console.error('Error correcting saved shift:', error);
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

ipcMain.handle('delete-shift-draft', async (_event, { date, shift_number }) => {
  try {
    if (!date || !Number.isFinite(parseInt(shift_number, 10))) {
      return { success: false, error: 'invalid_shift_identifier' };
    }

    const deleted = await executeUpdate(
      'DELETE FROM shifts WHERE date = $1 AND shift_number = $2 AND is_saved = 0',
      [date, parseInt(shift_number, 10)]
    );

    return { success: true, deleted };
  } catch (error) {
    console.error('Error deleting shift draft:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-saved-shift', async (_event, { date, shift_number }) => {
  try {
    const query = 'SELECT * FROM shifts WHERE date = $1 AND shift_number = $2 AND is_saved = 1';
    const result = await executeQuery(query, [date, shift_number]);
    if (result.length > 0) {
      return {
        ...result[0],
        data: typeof result[0].data === 'string' ? JSON.parse(result[0].data) : result[0].data
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting saved shift:', error);
    throw error;
  }
});

ipcMain.handle('get-adjacent-saved-shift', async (_event, { date, shift_number, direction }) => {
  try {
    const shiftNumber = parseInt(shift_number, 10);
    if (!date || !Number.isFinite(shiftNumber)) {
      return null;
    }

    const isNext = direction === 'next';
    const query = isNext
      ? `SELECT * FROM shifts
         WHERE is_saved = 1
           AND (date > $1 OR (date = $1 AND shift_number > $2))
         ORDER BY date ASC, shift_number ASC, id ASC
         LIMIT 1`
      : `SELECT * FROM shifts
         WHERE is_saved = 1
           AND (date < $1 OR (date = $1 AND shift_number < $2))
         ORDER BY date DESC, shift_number DESC, id DESC
         LIMIT 1`;

    const result = await executeQuery(query, [date, shiftNumber]);
    if (result.length > 0) {
      return {
        ...result[0],
        data: typeof result[0].data === 'string' ? JSON.parse(result[0].data) : result[0].data
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting adjacent saved shift:', error);
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

ipcMain.handle('get-last-draft-shift', async () => {
  try {
    const query = 'SELECT * FROM shifts WHERE is_saved = 0 ORDER BY updated_at DESC, id DESC LIMIT 1';
    const result = await executeQuery(query, []);
    if (result.length > 0) {
      return {
        ...result[0],
        data: typeof result[0].data === 'string' ? JSON.parse(result[0].data) : result[0].data
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting last draft shift:', error);
    throw error;
  }
});

ipcMain.handle('get-last-saved-shift', async () => {
  try {
    const query = 'SELECT * FROM shifts WHERE is_saved = 1 ORDER BY id DESC LIMIT 1';
    const result = await executeQuery(query, []);
    if (result.length > 0) {
      return {
        ...result[0],
        data: typeof result[0].data === 'string' ? JSON.parse(result[0].data) : result[0].data
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting last saved shift:', error);
    throw error;
  }
});

ipcMain.handle('record-shift-balance-changes', async (_event, changes = []) => {
  try {
    const validChanges = (Array.isArray(changes) ? changes : []).filter((change) => {
      const shiftDate = normalizeIsoDate(change?.shift_date);
      const shiftNumber = parseInt(change?.shift_number, 10);
      const itemType = String(change?.item_type || '').trim();
      const itemName = String(change?.item_name || '').trim();
      const fieldName = String(change?.field_name || '').trim();
      const newValue = parseOptionalNumber(change?.new_value);
      return shiftDate
        && Number.isFinite(shiftNumber)
        && ['fuel', 'oil'].includes(itemType)
        && itemName
        && fieldName
        && newValue !== null;
    });

    let saved = 0;
    for (const change of validChanges) {
      const shiftDate = normalizeIsoDate(change.shift_date);
      const shiftNumber = parseInt(change.shift_number, 10);
      await executeInsert(
        `INSERT INTO shift_balance_change_history
          (shift_date, shift_number, item_type, item_name, field_name, old_value, new_value, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          shiftDate,
          shiftNumber,
          String(change.item_type).trim(),
          String(change.item_name).trim(),
          String(change.field_name).trim(),
          parseOptionalNumber(change.old_value),
          parseOptionalNumber(change.new_value)
        ],
        'shift_balance_change_history'
      );
      saved += 1;
    }

    return { success: true, saved };
  } catch (error) {
    console.error('Error recording shift balance changes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-shift-balance-change-history', async (_event, filters = {}) => {
  try {
    const clauses = [];
    const params = [];

    const itemType = String(filters.itemType || '').trim();
    if (['fuel', 'oil'].includes(itemType)) {
      params.push(itemType);
      clauses.push(`item_type = $${params.length}`);
    }

    const fromDate = normalizeIsoDate(filters.fromDate);
    if (fromDate) {
      params.push(fromDate);
      clauses.push(`shift_date >= $${params.length}`);
    }

    const toDate = normalizeIsoDate(filters.toDate);
    if (toDate) {
      params.push(toDate);
      clauses.push(`shift_date <= $${params.length}`);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return await executeQuery(
      `SELECT id, shift_date, shift_number, item_type, item_name, field_name, old_value, new_value, changed_at
       FROM shift_balance_change_history
       ${whereSql}
       ORDER BY changed_at DESC, id DESC
       LIMIT 500`,
      params
    );
  } catch (error) {
    console.error('Error getting shift balance change history:', error);
    return [];
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
