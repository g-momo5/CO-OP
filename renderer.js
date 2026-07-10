const { ipcRenderer } = require('electron');

let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (error) {
  console.warn('Excel import library is unavailable:', error.message);
}

// Global variables
let charts = {};
let currentScreen = 'home';
window.__currentScreen = currentScreen;
let currentParentScreen = null;
let oilItemCounter = 0;
let navigationHistory = [];
let isOnline = navigator.onLine !== false;
let offlineRestricted = {
  screens: ['report', 'charts'],
  settingsSections: ['backup']
};
const rootScreens = ['home', 'charts', 'report', 'settings'];
const HOME_CHART_MODE = {
  PURCHASES: 'purchases',
  SALES: 'sales'
};
const HOME_CHART_FORECAST_DASH = [8, 5];
const LEGACY_AGGREGATED_EXPENSE_LABEL = 'مصروفات مجمعة (بيانات قديمة)';
const EMPTY_EXPENSE_DESCRIPTION_LABEL = 'بدون وصف';
const EDITABLE_OIL_INITIAL_NAME = 'سايب ١ ك';
let currentHomeChartMode = HOME_CHART_MODE.SALES;
window.__skipBeforeUnloadWarning = false;
let excelSalesImportState = {
  fileName: '',
  rawRows: [],
  parsedRows: [],
  products: [],
  resolutions: {},
  validationErrors: [],
  conflicts: []
};
let excelExpensesImportState = {
  fileName: '',
  rawRows: [],
  parsedRows: [],
  validationErrors: []
};
const ANNUAL_INVENTORY_FIELDS = [
  { key: 'prev_balance', id: 'annual-prev-balance' },
  { key: 'station_profit', id: 'annual-station-profit' },
  { key: 'bank_balance', id: 'annual-bank-balance' },
  { key: 'safe_balance', id: 'annual-safe-balance' },
  { key: 'accounting_remainder', id: 'annual-accounting-remainder' },
  { key: 'customers_balance', id: 'annual-customers-balance' },
  { key: 'vouchers_balance', id: 'annual-vouchers-balance' },
  { key: 'visa_balance', id: 'annual-visa-balance' }
];
let annualInventoryRecords = {};
let annualInventoryInitialized = false;
let annualCustomItemCounter = 0;

// Screen and section titles mapping
const screenTitles = {
  'home': 'الرئيسية',
  'invoice': 'فاتورة جديدة',
  'shift-entry': 'إدخال وردية جديدة',
  'safe-book': 'دفتر الخزينة',
  'charts': 'الرسوم البيانية',
  'report': 'التقارير',
  'settings': 'الإعدادات',
  'depot': 'المخزن',
  'tank-management': 'ادارة التنكات',
  'annual-inventory': 'جرد سنوي',
  'sales-summary': 'ملخص المبيعات',
  'customer-invoices': 'فواتير العملاء',
  'profit': 'المكسب',
  'expenses': 'المصاريف'
};

const settingsSectionTitles = {
  'manage-products': 'إدارة المنتجات',
  'manage-customers': 'إدارة العملاء',
  'excel-sales-import': 'استيراد مبيعات Excel',
  'excel-expenses-import': 'استيراد مصاريف Excel',
  'balance-history': 'سجل الأرصدة والعدادات',
  'invoices-list': 'عرض الفواتير',
  'general': 'إعدادات عامة',
  'backup': 'النسخ الاحتياطي'
};

function screenRequiresOnline(screenName) {
  return !isOnline && offlineRestricted.screens.includes(screenName);
}

function settingsSectionRequiresOnline(sectionName) {
  return !isOnline && offlineRestricted.settingsSections.includes(sectionName);
}

function isRootScreen(screenName) {
  return rootScreens.includes(screenName);
}

// Lista dei tipi di olio disponibili
const oilTypes = [
  'COOP FACT 20L',
  'COOP FACT 8L', 
  'COOP FACT 5L',
  'COOP FACT 4L',
  'COOP FACT 1L',
  'SUPER STAN 180L',
  'SUPER STAN 20L',
  'SUPER STAN 4L',
  'ONE EXTRA 5W/40',
  'ONE EXTRA 5W/40 5L',
  'CI4 15W/40 20L',
  'CI4 5L',
  'SJ 4L',
  'SJ 1L',
  'CPC 8000 4L',
  'CPC 8000 5L',
  'XPL 4L',
  'SF 20/50 4L',
  'SF 20/50 1L',
  'HYDRAULIC 68',
  'DIXERON 1L',
  'تروس ١٦٠ HP ١٨ لتر',
  'ماء أحمر راديتير',
  'باكم ١\٤ لتر',
  'سايب ١ ك',
  'رويال كلين ٣٢ كيلو',
  'شامبو سيارات',
  'ماء مقطر',
  'نيو فاست رائحة التفاح',
  'منظف الايدي بالمضخة',
  'ملمع كاوتش سيارة',
  'كورال بلومارين',
  'ملمع تابلوه الترشاين',
  'ماء أخضر راديتير'
];

let invoiceOilProductsCache = null;
let invoiceOilProductsLoadingPromise = null;
let invoiceFuelProductsCache = null;
let invoiceFuelProductsCacheDate = '';
let invoiceFuelProductsLoadingPromise = null;
let fuelInvoiceEditState = null;
let customerNameOptionsCache = [];
let customerNameOptionsById = new Map();
let customerNameOptionsByName = new Map();
let customerInvoicesState = {
  weekStart: '',
  weekEnd: '',
  selectedCustomerId: '',
  customers: [],
  invoicesByCustomer: {},
  warnings: []
};

function invalidateInvoiceOilProductsCache() {
  invoiceOilProductsCache = null;
  invoiceOilProductsLoadingPromise = null;
}

function invalidateInvoiceFuelProductsCache() {
  invoiceFuelProductsCache = null;
  invoiceFuelProductsCacheDate = '';
  invoiceFuelProductsLoadingPromise = null;
}

// ============= TOAST NOTIFICATION SYSTEM =============
/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - The type of toast: 'success', 'error', or 'info'
 * @param {number} duration - How long to show the toast in milliseconds (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.error('Toast container not found');
    return;
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Icon based on type
  let icon = '';
  switch (type) {
    case 'success':
      icon = '✓';
      break;
    case 'error':
      icon = '✕';
      break;
    case 'info':
      icon = 'ℹ';
      break;
  }

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${message}</div>
  `;

  // Add to container
  container.appendChild(toast);

  // Auto remove after duration
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300); // Match animation duration
  }, duration);
}

async function bootstrapApp() {
  try {
    // RTL configuration is handled by rtl-config.js before bootstrap runs.
    initializeApp();
    setupEventListeners();
    setupDepotEventListeners();
    initSalesSummaryFilters();
    initSafeBookFilters();
    initializeConnectionMonitoring();
    await updateConnectionStatus();

    await Promise.allSettled([
      loadHomeChart(),
      loadTodayStats(),
      loadFuelPrices(),
      loadPurchasePrices(),
      loadSafeBookMovements()
    ]);
  } catch (error) {
    console.error('Renderer bootstrap failed:', error);
  } finally {
    ipcRenderer.send('renderer-bootstrap-complete');

    // Check for updates on startup if enabled
    setTimeout(() => {
      const autoCheck = localStorage.getItem('auto-check-updates');
      if ((autoCheck === null || autoCheck === 'true') && isOnline) {
        ipcRenderer.send('check-for-updates-manual');
      }
    }, 3000);
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  bootstrapApp();
});

function updateModalScrollLock() {
  const hasOpenModal = Boolean(document.querySelector('.modal.show'));
  document.body.classList.toggle('modal-scroll-lock', hasOpenModal);
}

function initializeModalScrollLock() {
  if (window.modalScrollLockObserver) {
    updateModalScrollLock();
    return;
  }

  window.modalScrollLockObserver = new MutationObserver(updateModalScrollLock);
  window.modalScrollLockObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true
  });
  updateModalScrollLock();
}

// Helper function to get today's date in local timezone (YYYY-MM-DD format)
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initializeApp() {
  // Initialize breadcrumb for home screen
  updateBreadcrumb('home');

  // Set today's date as default
  const today = getTodayDate();
  const dateInput = document.getElementById('fuel-invoice-date');
  if (dateInput) dateInput.value = today;

  // Set today's date for oil invoice as well
  const oilDateInput = document.getElementById('oil-invoice-date');
  if (oilDateInput) oilDateInput.value = today;

  // Set today's date for shift entry
  const shiftDateInput = document.getElementById('shift-date');
  if (shiftDateInput) shiftDateInput.value = today;

  // Set default date range for reports
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDay = `${firstDayOfMonth.getFullYear()}-${String(firstDayOfMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const startDateInput = document.getElementById('start-date');
  const endDateInput = document.getElementById('end-date');
  if (startDateInput) startDateInput.value = firstDay;
  if (endDateInput) endDateInput.value = today;

  // Generate invoice number
  generateInvoiceNumber();
  renderFuelInvoiceItems();

  // Sync home chart title with the selected mode
  updateHomeChartToggleUI();

  scheduleHomeChartHeightSync();
  setTimeout(scheduleHomeChartHeightSync, 80);
  setTimeout(scheduleHomeChartHeightSync, 220);
  
  // Setup fuel calculation listeners
  setupFuelCalculationListeners();

  // Setup oil calculation listeners
  setupOilCalculationListeners();

  // Setup listener for actual invoice total input
  const actualTotalInput = document.getElementById('actual-invoice-total');
  if (actualTotalInput) {
    actualTotalInput.addEventListener('input', calculateCashDeposit);
  }
  const fuelInvoiceDateInput = document.getElementById('fuel-invoice-date');
  if (fuelInvoiceDateInput) {
    fuelInvoiceDateInput.addEventListener('change', refreshFuelInvoicePurchasePricesForDate);
  }

  // Apply RTL formatting to all elements
  setTimeout(() => {
    applyRTLFormatting();
  }, 100);
}

function setupEventListeners() {
  setupHomeChartToggle();
  setupAnnualInventoryCalculator();
  window.addEventListener('resize', scheduleHomeChartHeightSync);
  window.addEventListener('resize', scheduleSafeBookTableViewportSync);

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
       if (screenRequiresOnline(screen)) {
        showMessage('هذه الشاشة تتطلب اتصالاً بالإنترنت', 'warning');
        return;
      }
      showScreen(screen);
    });
  });

  // Invoice type selector
  document.querySelectorAll('#invoice-screen .price-type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const type = tab.dataset.type;
      showInvoiceType(type);
    });
  });

  // Settings sidebar navigation
  document.querySelectorAll('.settings-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.settingsSection;

      if (settingsSectionRequiresOnline(section)) {
        showMessage('هذه الصفحة من الإعدادات تتطلب اتصالاً بالإنترنت', 'warning');
        return;
      }

      // Update breadcrumb to show: الإعدادات > [Section Name]
      updateBreadcrumb('settings', section);

      // Show the section
      showSettingsSectionWithoutHistory(section);
    });
  });

  // Oil sidebar menu items
  document.querySelectorAll('.oil-item').forEach(item => {
    item.addEventListener('click', () => {
      const oilType = item.dataset.oil;
      selectOilType(oilType);
    });
  });

  // Header scroll effect
  window.addEventListener('scroll', handleHeaderScroll);
  // Ensure header renders at full height on initial load
  handleHeaderScroll();
  initializeModalScrollLock();

  // Modal click outside to close
  document.addEventListener('click', (e) => {
    const movementModal = document.getElementById('movement-modal');
    if (e.target === movementModal) {
      closeMovementModal();
    }

    const stockAuditModal = document.getElementById('stock-audit-modal');
    if (e.target === stockAuditModal) {
      closeStockAuditModal();
    }

    const addDepotOilModal = document.getElementById('add-depot-oil-modal');
    if (e.target === addDepotOilModal) {
      closeAddDepotOilModal();
    }

    const priceEditModal = document.getElementById('price-edit-modal');
    if (e.target === priceEditModal) {
      closePriceEditModal();
    }

    const addProductModal = document.getElementById('add-product-modal');
    if (e.target === addProductModal) {
      closeAddProductModal();
    }
  });

  // Edit product name modal - Enter key to save
  const editProductNewNameInput = document.getElementById('edit-product-new-name');
  if (editProductNewNameInput) {
    editProductNewNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEditProductName();
      }
    });
  }

  // Shift date change listener - reload oil prices when date changes
  const shiftDateInput = document.getElementById('shift-date');
  if (shiftDateInput) {
    shiftDateInput.addEventListener('change', async () => {
      console.log('Shift date changed, reloading oil prices...');
      await loadAllOilPrices();
    });
  }
}

function setupFuelCalculationListeners() {
  // Remove existing listeners first
  document.querySelectorAll('.fuel-quantity, .fuel-purchase-price').forEach(input => {
    input.removeEventListener('input', calculateFuelItem);
    input.removeEventListener('focus', handleInputFocus);
    input.removeEventListener('blur', handleInputBlur);
  });

  // Add new listeners
  document.querySelectorAll('.fuel-quantity, .fuel-purchase-price').forEach(input => {
    input.addEventListener('input', calculateFuelItem);
    input.addEventListener('focus', handleInputFocus);
    input.addEventListener('blur', handleInputBlur);
  });
}

function setupOilCalculationListeners() {
  // Remove existing listeners first
  document.querySelectorAll('.oil-quantity, .oil-purchase-price, .oil-iva').forEach(input => {
    input.removeEventListener('input', calculateOilItem);
    input.removeEventListener('focus', handleInputFocus);
    input.removeEventListener('blur', handleInputBlur);
  });

  // Add new listeners
  document.querySelectorAll('.oil-quantity, .oil-purchase-price, .oil-iva').forEach(input => {
    input.addEventListener('input', calculateOilItem);
    input.addEventListener('focus', handleInputFocus);
    input.addEventListener('blur', handleInputBlur);
  });

  // Add listeners for discount and tax inputs
  const discountInput = document.getElementById('immediate-discount');
  const taxInput = document.getElementById('martyrs-tax');

  if (discountInput) {
    discountInput.removeEventListener('input', calculateOilInvoiceSummary);
    discountInput.addEventListener('input', calculateOilInvoiceSummary);
  }

  if (taxInput) {
    taxInput.removeEventListener('input', calculateOilInvoiceSummary);
    taxInput.addEventListener('input', calculateOilInvoiceSummary);
  }
}

// Breadcrumb Navigation Functions
function updateBreadcrumb(currentScreen, currentSection = null, parentScreen = null) {
  const breadcrumbNav = document.getElementById('breadcrumb-nav');
  const breadcrumbTrail = document.getElementById('breadcrumb-trail');
  const mainContent = document.querySelector('.main-content');

  // Hide breadcrumb for root screens (and always for settings)
  const isRoot = currentScreen ? isRootScreen(currentScreen) : false;
  const shouldHide =
    !currentScreen ||
    currentScreen === 'settings' ||
    (isRoot && !parentScreen && !(currentScreen === 'settings' && currentSection));

  if (shouldHide) {
    breadcrumbNav.style.display = 'none';
    mainContent.classList.remove('with-breadcrumb');
    return;
  }

  // Build hierarchical path based on current location
  const path = [];

  // Add parent screen if exists (e.g., الرئيسية for depot)
  if (parentScreen) {
    path.push({ screen: parentScreen, section: null, parent: null });
  }

  // Add current screen to path
  path.push({ screen: currentScreen, section: null, parent: parentScreen });

  // Add section if in settings
  if (currentScreen === 'settings' && currentSection) {
    path.push({ screen: currentScreen, section: currentSection, parent: parentScreen });
  }

  // Show breadcrumb
  breadcrumbNav.style.display = 'flex';
  mainContent.classList.add('with-breadcrumb');

  // Build breadcrumb trail
  breadcrumbTrail.innerHTML = '';

  path.forEach((item, index) => {
    const isLast = index === path.length - 1;
    const breadcrumbItem = document.createElement('div');
    breadcrumbItem.className = isLast ? 'breadcrumb-item current' : 'breadcrumb-item';

    let title = '';
    if (item.section) {
      title = settingsSectionTitles[item.section] || item.section;
    } else if (item.screen) {
      title = screenTitles[item.screen] || item.screen;
    }

    if (isLast) {
      breadcrumbItem.textContent = title;
    } else {
      const link = document.createElement('a');
      link.textContent = title;
      link.onclick = () => {
        if (item.screen && !item.section) {
          showScreen(item.screen);
        } else if (item.screen === 'settings' && item.section) {
          showSettingsSection(item.section);
        }
      };
      breadcrumbItem.appendChild(link);
    }

    breadcrumbTrail.appendChild(breadcrumbItem);

    // Add separator if not last item
    if (!isLast) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '›';
      breadcrumbTrail.appendChild(separator);
    }
  });
}

function pushNavigation(item) {
  // No longer needed - we build path based on current location
  updateBreadcrumb(item.screen, item.section, item.parent);
}

function navigateBack() {
  // If we're inside settings, go back to settings root first
  if (currentScreen === 'settings') {
    const activeSettingsSection = document.querySelector('.settings-section.active');
    if (activeSettingsSection) {
      // Clear section and show settings root
      showSettingsSectionWithoutHistory(null);
      showScreenWithoutHistory('settings');
      return;
    }
  }

  // If screen has a parent (e.g., invoice/shift/depot under home), go to parent
  if (currentParentScreen) {
    showScreen(currentParentScreen);
    return;
  }

  // Fallback: go to home unless already there
  if (currentScreen !== 'home') {
    showScreen('home');
  }
}

async function loadShiftFromHistory() {
  const dateInput = document.getElementById('history-shift-date');
  const shiftSelect = document.getElementById('history-shift-number');
  const msg = document.getElementById('history-shift-message');

  const date = dateInput?.value;
  const shiftNumber = parseInt(shiftSelect?.value || '0', 10);

  if (!date || !shiftNumber) {
    if (msg) msg.textContent = 'يرجى اختيار التاريخ والوردية';
    return;
  }

  // Warn if unsaved changes on shift-entry
  if (currentShiftData.hasUnsavedChanges && currentScreen === 'shift-entry') {
    const confirmed = confirm('لديك تغييرات غير محفوظة في الوردية الحالية. هل تريد المتابعة؟');
    if (!confirmed) return;
  }

  try {
    const existingShift = await ipcRenderer.invoke('get-shift', { date, shift_number: shiftNumber });

    if (!existingShift) {
      if (msg) msg.textContent = 'لا توجد بيانات لهذه الوردية';
      return;
    }

    const dateField = document.getElementById('shift-date');
    const shiftField = document.getElementById('shift-number');
    if (dateField) dateField.value = date;
    if (shiftField) shiftField.value = shiftNumber.toString();

    showScreen('shift-entry', 'home');
    await loadShiftData(date, shiftNumber);

    if (msg) msg.textContent = '';
    closeShiftHistoryModal();
    showMessage('تم تحميل الوردية بنجاح', 'success');
  } catch (error) {
    console.error('Error loading shift from history:', error);
    if (msg) msg.textContent = 'حدث خطأ أثناء تحميل الوردية';
  }
}

function closeShiftHistoryModal() {
  const modal = document.getElementById('shift-history-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function showScreenWithoutHistory(screenName) {
  if (screenRequiresOnline(screenName)) {
    showMessage('هذه الشاشة تتطلب اتصالاً بالإنترنت', 'warning');
    return;
  }
  // Hide all screens
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });

  // Show selected screen
  document.getElementById(`${screenName}-screen`).classList.add('active');

  // Update navigation buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const navBtn = document.querySelector(`[data-screen="${screenName}"]`);
  if (navBtn) {
    navBtn.classList.add('active');
  }

  currentScreen = screenName;
  window.__currentScreen = currentScreen;
  syncSafeBookScrollMode();

  // Reset scroll position to top
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    mainContent.scrollTop = 0;
  }
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
  });

  // Load specific data for each screen
  switch (screenName) {
    case 'home':
      loadHomeChart();
      loadTodayStats();
      loadSafeBookMovements();
      scheduleHomeChartHeightSync();
      setTimeout(scheduleHomeChartHeightSync, 60);
      setTimeout(scheduleHomeChartHeightSync, 180);
      break;
    case 'invoice':
      setupFuelCalculationListeners();
      setupOilCalculationListeners();
      break;
    case 'charts':
      loadCharts();
      break;
    case 'report':
      generateReport();
      break;
    case 'settings':
      // Load manage products when opening settings
      loadManageProducts();
      break;
    case 'sales-summary':
      initSalesSummaryFilters();
      loadSalesSummary();
      break;
    case 'customer-invoices':
      initializeCustomerInvoicesPage();
      break;
    case 'safe-book':
      initSafeBookFilters();
      loadSafeBookMovements();
      break;
    case 'profit':
      initializeProfitDashboard();
      break;
    case 'expenses':
      initializeExpensesDashboard();
      break;
    case 'shift-entry':
      if (shiftViewMode === 'edit') {
        // Initialize entry-only helpers. History view renders from saved shift data only.
        initializeCustomersTable();
        loadCustomerNameOptions();
        initializeShiftEntry();
      }
      break;
    case 'depot':
      resetDepotView();
      break;
    case 'tank-management':
      initializeTankManagement();
      break;
    case 'annual-inventory':
      refreshAnnualInventoryView();
      break;
  }
}

function showScreen(screenName, parentScreen = null) {
  if (screenRequiresOnline(screenName)) {
    showMessage('هذه الشاشة تتطلب اتصالاً بالإنترنت', 'warning');
    return;
  }

  if (currentScreen === 'shift-entry' && screenName !== 'shift-entry') {
    if (shiftViewMode === 'correction' && currentShiftData.hasUnsavedChanges) {
      const confirmed = confirm('لديك تصحيح غير محفوظ. هل تريد مغادرة الشاشة؟');
      if (!confirmed) return;
    }
    flushShiftDraftAutoSave();
  }

  // Update global parent screen tracker
  currentParentScreen = parentScreen;

  // Update breadcrumb with current screen and parent
  updateBreadcrumb(screenName, null, parentScreen);

  // Call the version without history
  showScreenWithoutHistory(screenName);

  if (screenName !== 'shift-entry') {
    lockResetInlineFields();
  }

  // Reset shift view mode when leaving shift-entry
  if (screenName !== 'shift-entry' && shiftViewMode !== 'edit') {
    shiftViewMode = 'edit';
    disableReadOnlyMode();
    setShiftIdentifierFieldsLocked(false);
    updateShiftTitle();
    toggleHistoryBar(false);
    currentShiftData.hasUnsavedChanges = false;
  }
}

function openNewShiftEntry() {
  shiftViewMode = 'edit';
  disableReadOnlyMode();
  setShiftIdentifierFieldsLocked(false);
  updateShiftTitle();
  toggleHistoryBar(false);
  setShiftDraftStatus('idle');
  clearShiftForm();
  setCustomerRowsData([]);
  currentShiftData.date = null;
  currentShiftData.shiftNumber = null;
  currentShiftData.isSaved = false;
  currentShiftData.hasUnsavedChanges = false;
  currentShiftData.draftCleanupQueue = [];

  showScreen('shift-entry', 'home');
}

function syncSafeBookScrollMode() {
  const isSafeBookScreen = currentScreen === 'safe-book';
  document.body.classList.toggle('safe-book-scroll-lock', isSafeBookScreen);

  if (isSafeBookScreen) {
    bindSafeBookStickyMonthTracking();
    scheduleSafeBookTableViewportSync();
    setTimeout(scheduleSafeBookTableViewportSync, 80);
    updateSafeBookStickyMonthSummary();
    setTimeout(updateSafeBookStickyMonthSummary, 80);
    return;
  }

  clearSafeBookStickyMonthSummary();
}

function resetDepotView() {
  document.querySelectorAll('.oil-item').forEach(item => {
    item.classList.remove('selected');
  });

  const resultsSection = document.getElementById('results-section');
  if (resultsSection) {
    resultsSection.style.display = 'block';
  }

  const stockAmount = document.getElementById('current-stock-amount');
  if (stockAmount) {
    stockAmount.textContent = convertToArabicNumerals(0);
  }

  const productLabel = document.getElementById('breadcrumb-product');
  if (productLabel) {
    productLabel.textContent = '-';
  }

  const movementsTable = document.getElementById('movements-table');
  if (movementsTable) {
    movementsTable.innerHTML = '<div class="empty-movements">اختر نوع الزيت لعرض الحركات</div>';
  }

  loadDepotOils();
}

function setTodayStatsUnavailable() {
  const todaySalesEl = document.getElementById('today-sales');
  const todayRevenueEl = document.getElementById('today-revenue');
  const todayTransactionsEl = document.getElementById('today-transactions');
  if (todaySalesEl) todaySalesEl.textContent = '-';
  if (todayRevenueEl) todayRevenueEl.textContent = '-';
  if (todayTransactionsEl) todayTransactionsEl.textContent = '-';
}

function isOfflineRequiredError(error) {
  const message = String(error?.message || error || '');
  return message.includes('تتطلب اتصالاً بالإنترنت') || message.includes('requires an internet connection');
}

async function loadTodayStats() {
  if (!isOnline) {
    setTodayStatsUnavailable();
    return;
  }
  try {
    const today = new Date().toISOString().split('T')[0];
    const sales = await ipcRenderer.invoke('get-sales-report', { startDate: today, endDate: today });

    const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
    const totalTransactions = sales.length;

    const todaySalesEl = document.getElementById('today-sales');
    const todayRevenueEl = document.getElementById('today-revenue');
    const todayTransactionsEl = document.getElementById('today-transactions');

    if (todaySalesEl) todaySalesEl.textContent = formatArabicNumber(totalQuantity) + ' لتر';
    if (todayRevenueEl) todayRevenueEl.textContent = formatArabicCurrency(totalRevenue);
    if (todayTransactionsEl) todayTransactionsEl.textContent = convertToArabicNumerals(totalTransactions);
  } catch (error) {
    if (isOfflineRequiredError(error)) {
      setTodayStatsUnavailable();
      return;
    }
    console.error('Error loading today stats:', error);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeInlineJsString(value) {
  return escapeHtml(escapeJsString(value));
}

function parseIsoDateParts(dateString) {
  const normalized = String(dateString || '').split('T')[0];
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10)
  };
}

function formatSafeBookDate(dateString) {
  const parts = parseIsoDateParts(dateString);
  if (!parts) return '-';
  return `${convertToArabicNumerals(parts.day)}/${convertToArabicNumerals(parts.month)}/${convertToArabicNumerals(parts.year)}`;
}

function formatDateOnlyDisplay(dateString) {
  const parts = parseIsoDateParts(dateString);
  if (parts) {
    return `${convertToArabicNumerals(parts.day)}/${convertToArabicNumerals(parts.month)}/${convertToArabicNumerals(parts.year)}`;
  }

  const parsedDate = dateString instanceof Date ? dateString : new Date(dateString);
  if (!Number.isNaN(parsedDate.getTime())) {
    const day = parsedDate.getDate();
    const month = parsedDate.getMonth() + 1;
    const year = parsedDate.getFullYear();
    return `${convertToArabicNumerals(day)}/${convertToArabicNumerals(month)}/${convertToArabicNumerals(year)}`;
  }

  const rawValue = String(dateString || '').trim();
  const dateOnly = rawValue.split('T')[0];
  return convertToArabicNumerals(dateOnly);
}

const SAFE_BOOK_MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];
const SAFE_BOOK_DEFAULT_VISIBLE_ROWS = 15;
let safeBookCurrentBalance = 0;

function formatSafeBookArabicLongDate(dateString) {
  const parts = parseIsoDateParts(dateString);
  if (!parts) return formatArabicDate(dateString);

  const monthName = SAFE_BOOK_MONTH_NAMES[Math.max(0, Math.min(11, parts.month - 1))];
  return `${convertToArabicNumerals(parts.day)} ${monthName} ${convertToArabicNumerals(parts.year)}`;
}

function formatShiftSafeBookType(date, shiftNumber) {
  const shiftLabel = shiftNumber === 1 ? 'صباحا' : 'ليلا';
  return `إيراد وردية يوم ${formatSafeBookArabicLongDate(date)} ${shiftLabel}`;
}

function getSafeBookMonthInfo(dateString) {
  const parts = parseIsoDateParts(dateString);
  if (!parts) {
    return { key: 'unknown', label: 'غير محدد' };
  }

  const monthName = SAFE_BOOK_MONTH_NAMES[Math.max(0, Math.min(11, parts.month - 1))];
  return {
    key: `${parts.year}-${String(parts.month).padStart(2, '0')}`,
    label: `${monthName} ${convertToArabicNumerals(parts.year)}`
  };
}

function initSafeBookFilters() {
  const startMonthSel = document.getElementById('safe-book-start-month');
  const startYearSel = document.getElementById('safe-book-start-year');
  const endMonthSel = document.getElementById('safe-book-end-month');
  const endYearSel = document.getElementById('safe-book-end-year');
  if (!startMonthSel || !startYearSel || !endMonthSel || !endYearSel) return;

  const end = new Date();
  const years = [];
  for (let year = 2025; year <= end.getFullYear(); year++) {
    years.push(year);
  }

  const months = SAFE_BOOK_MONTH_NAMES.map((label, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label: label
  }));

  const fillOptions = (select, opts, selectedValue) => {
    if (!select) return;
    select.innerHTML = [
      '<option value="">—</option>',
      ...opts.map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    ].join('');
    select.value = String(selectedValue);
  };

  fillOptions(startMonthSel, months, '');
  fillOptions(endMonthSel, months, '');
  fillOptions(startYearSel, years.map((year) => ({ value: year, label: year })), '');
  fillOptions(endYearSel, years.map((year) => ({ value: year, label: year })), '');

  [startMonthSel, startYearSel, endMonthSel, endYearSel].forEach((select) => {
    if (!select || select.dataset.bound) return;
    select.addEventListener('change', () => {
      loadSafeBookMovements();
    });
    select.dataset.bound = 'true';
  });

  const clearBtn = document.getElementById('safe-book-clear-filter-btn');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.addEventListener('click', () => {
      clearSafeBookFilters();
    });
    clearBtn.dataset.bound = 'true';
  }

  updateSafeBookClearFilterButtonState(false);
}

function formatDateYmd(dateObject) {
  const year = dateObject.getFullYear();
  const month = String(dateObject.getMonth() + 1).padStart(2, '0');
  const day = String(dateObject.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSafeBookFiltersRange() {
  const startMonthSel = document.getElementById('safe-book-start-month');
  const startYearSel = document.getElementById('safe-book-start-year');
  const endMonthSel = document.getElementById('safe-book-end-month');
  const endYearSel = document.getElementById('safe-book-end-year');

  if (!startMonthSel || !startYearSel || !endMonthSel || !endYearSel) {
    return { valid: true, isFiltered: false, hasSelection: false, startDate: null, endDate: null };
  }

  const startMonthVal = startMonthSel.value;
  const startYearVal = startYearSel.value;
  const endMonthVal = endMonthSel.value;
  const endYearVal = endYearSel.value;
  const values = [startMonthVal, startYearVal, endMonthVal, endYearVal];
  const hasSelection = values.some((value) => Boolean(value));
  const hasFullSelection = values.every((value) => Boolean(value));

  if (!hasSelection) {
    return { valid: true, isFiltered: false, hasSelection: false, startDate: null, endDate: null };
  }

  if (!hasFullSelection) {
    return { valid: true, isFiltered: false, hasSelection: true, startDate: null, endDate: null };
  }

  const startYear = parseInt(startYearVal, 10);
  const startMonth = parseInt(startMonthVal, 10);
  const endYear = parseInt(endYearVal, 10);
  const endMonth = parseInt(endMonthVal, 10);

  if (!startYear || !startMonth || !endYear || !endMonth) {
    return { valid: false, isFiltered: false, hasSelection: true, message: 'صيغة الشهر غير صحيحة' };
  }

  const startDateObj = new Date(startYear, startMonth - 1, 1);
  const endDateObj = new Date(endYear, endMonth, 0);
  if (startDateObj > endDateObj) {
    return { valid: false, isFiltered: false, hasSelection: true, message: 'فترة زمنية غير صحيحة' };
  }

  return {
    valid: true,
    isFiltered: true,
    hasSelection: true,
    startDate: formatDateYmd(startDateObj),
    endDate: formatDateYmd(endDateObj)
  };
}

function clearSafeBookFilters() {
  const startMonthSel = document.getElementById('safe-book-start-month');
  const startYearSel = document.getElementById('safe-book-start-year');
  const endMonthSel = document.getElementById('safe-book-end-month');
  const endYearSel = document.getElementById('safe-book-end-year');

  if (startMonthSel) startMonthSel.value = '';
  if (startYearSel) startYearSel.value = '';
  if (endMonthSel) endMonthSel.value = '';
  if (endYearSel) endYearSel.value = '';

  updateSafeBookClearFilterButtonState(false);
  loadSafeBookMovements();
}

function updateSafeBookClearFilterButtonState(enabled) {
  const clearBtn = document.getElementById('safe-book-clear-filter-btn');
  if (!clearBtn) return;
  clearBtn.disabled = !enabled;
}

function updateSafeBookBalanceDisplay(balance) {
  const balanceEl = document.getElementById('safe-book-balance-value');
  if (!balanceEl) return;

  const numericBalance = Number.isFinite(balance) ? balance : 0;
  balanceEl.textContent = formatArabicCurrency(numericBalance);
  balanceEl.classList.toggle('negative', numericBalance < 0);
}

function updateSafeBookPeriodBalancesDisplay(startBalance, endBalance) {
  const startEl = document.getElementById('safe-book-period-start-value');
  const endEl = document.getElementById('safe-book-period-end-value');

  const safeStart = Number.isFinite(startBalance) ? startBalance : 0;
  const safeEnd = Number.isFinite(endBalance) ? endBalance : 0;

  if (startEl) {
    startEl.textContent = formatArabicCurrency(safeStart);
    startEl.classList.toggle('negative', safeStart < 0);
  }

  if (endEl) {
    endEl.textContent = formatArabicCurrency(safeEnd);
    endEl.classList.toggle('negative', safeEnd < 0);
  }
}

function setSafeBookPeriodBalancesVisibility(visible) {
  const container = document.getElementById('safe-book-period-balances');
  if (!container) return;
  container.style.display = visible ? 'flex' : 'none';
}

function syncSafeBookTableViewportHeight() {
  const safeBookScreen = document.getElementById('safe-book-screen');
  if (!safeBookScreen || !safeBookScreen.classList.contains('active')) return;

  const tableWrapper = safeBookScreen.querySelector('.safe-book-table-wrapper');
  if (!tableWrapper) return;

  const viewportHeight = window.innerHeight;
  const wrapperTop = tableWrapper.getBoundingClientRect().top;
  const bottomNav = document.querySelector('.bottom-navigation');

  let bottomReserve = 16;
  if (bottomNav) {
    const navRect = bottomNav.getBoundingClientRect();
    if (navRect.top < viewportHeight) {
      bottomReserve = Math.max(bottomReserve, (viewportHeight - navRect.top) + 12);
    }
  }

  const availableHeight = Math.floor(viewportHeight - wrapperTop - bottomReserve);
  if (availableHeight > 80) {
    tableWrapper.style.maxHeight = `${availableHeight}px`;
  }
}

function scheduleSafeBookTableViewportSync() {
  window.requestAnimationFrame(() => {
    syncSafeBookTableViewportHeight();
  });
}

function clearSafeBookStickyMonthSummary() {
  const stickyMonth = document.getElementById('safe-book-sticky-month');
  if (!stickyMonth) return;
  stickyMonth.style.display = 'none';
  stickyMonth.innerHTML = '';
  stickyMonth.dataset.monthKey = '';
}

function updateSafeBookStickyMonthSummary() {
  const safeBookScreen = document.getElementById('safe-book-screen');
  if (!safeBookScreen || !safeBookScreen.classList.contains('active')) {
    clearSafeBookStickyMonthSummary();
    return;
  }

  const tableWrapper = safeBookScreen.querySelector('.safe-book-table-wrapper');
  const stickyMonth = document.getElementById('safe-book-sticky-month');
  if (!tableWrapper || !stickyMonth) return;

  const monthRows = Array.from(tableWrapper.querySelectorAll('tr.safe-book-month-row'));
  if (!monthRows.length || tableWrapper.scrollTop <= 0) {
    clearSafeBookStickyMonthSummary();
    return;
  }

  let activeMonthRow = monthRows[0];
  const threshold = tableWrapper.scrollTop + 1;
  for (const monthRow of monthRows) {
    if (monthRow.offsetTop <= threshold) {
      activeMonthRow = monthRow;
      continue;
    }
    break;
  }

  const activeHeader = activeMonthRow.querySelector('.safe-book-month-header');
  if (!activeHeader) {
    clearSafeBookStickyMonthSummary();
    return;
  }

  const monthKey = activeMonthRow.dataset.monthKey || '';
  if (stickyMonth.dataset.monthKey !== monthKey) {
    stickyMonth.innerHTML = `<div class="safe-book-month-header">${activeHeader.innerHTML}</div>`;
    stickyMonth.dataset.monthKey = monthKey;
  }
  stickyMonth.style.display = 'block';
}

function bindSafeBookStickyMonthTracking() {
  const safeBookScreen = document.getElementById('safe-book-screen');
  if (!safeBookScreen) return;

  const tableWrapper = safeBookScreen.querySelector('.safe-book-table-wrapper');
  if (!tableWrapper) return;

  if (typeof tableWrapper.__safeBookStickyHandler === 'function') {
    tableWrapper.removeEventListener('scroll', tableWrapper.__safeBookStickyHandler);
  }

  tableWrapper.__safeBookStickyHandler = () => {
    updateSafeBookStickyMonthSummary();
  };
  tableWrapper.addEventListener('scroll', tableWrapper.__safeBookStickyHandler, { passive: true });

  const mainContent = document.querySelector('.main-content');
  if (mainContent && typeof mainContent.__safeBookStickyHandler !== 'function') {
    mainContent.__safeBookStickyHandler = () => {
      updateSafeBookStickyMonthSummary();
    };
    mainContent.addEventListener('scroll', mainContent.__safeBookStickyHandler, { passive: true });
  }
}

async function loadSafeBookMovements() {
  const tableBody = document.getElementById('safe-book-body');
  if (!tableBody) return;

  try {
    const allMovements = await ipcRenderer.invoke('get-safe-book-movements');

    if (!Array.isArray(allMovements) || allMovements.length === 0) {
      const filtersRange = getSafeBookFiltersRange();
      safeBookCurrentBalance = 0;
      updateSafeBookBalanceDisplay(0);
      updateSafeBookPeriodBalancesDisplay(0, 0);
      setSafeBookPeriodBalancesVisibility(false);
      updateSafeBookClearFilterButtonState(Boolean(filtersRange.hasSelection));
      clearSafeBookStickyMonthSummary();
      tableBody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:center; color:#777;">لا توجد حركات حالياً</td>
        </tr>
      `;
      return;
    }

    const signedAmount = (movement) => {
      const direction = movement.direction === 'out' ? 'out' : 'in';
      const amount = Math.abs(parseFloat(movement.amount) || 0);
      return direction === 'out' ? -amount : amount;
    };

    const getMovementDate = (movement) => String(movement?.date || '').split('T')[0];

    const currentBalance = allMovements.reduce((sum, movement) => sum + signedAmount(movement), 0);
    safeBookCurrentBalance = currentBalance;
    updateSafeBookBalanceDisplay(currentBalance);

    const filtersRange = getSafeBookFiltersRange();
    updateSafeBookClearFilterButtonState(Boolean(filtersRange.hasSelection));
    if (!filtersRange.valid) {
      updateSafeBookPeriodBalancesDisplay(0, 0);
      setSafeBookPeriodBalancesVisibility(false);
      clearSafeBookStickyMonthSummary();
      tableBody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:center; color:#777;">${filtersRange.message}</td>
        </tr>
      `;
      return;
    }

    const hasDateFilter = Boolean(filtersRange.isFiltered && filtersRange.startDate && filtersRange.endDate);
    if (hasDateFilter) {
      const startBalance = allMovements.reduce((sum, movement) => {
        const movementDate = getMovementDate(movement);
        if (!movementDate || movementDate >= filtersRange.startDate) return sum;
        return sum + signedAmount(movement);
      }, 0);

      const endBalance = allMovements.reduce((sum, movement) => {
        const movementDate = getMovementDate(movement);
        if (!movementDate || movementDate > filtersRange.endDate) return sum;
        return sum + signedAmount(movement);
      }, 0);

      updateSafeBookPeriodBalancesDisplay(startBalance, endBalance);
      setSafeBookPeriodBalancesVisibility(true);
    } else {
      updateSafeBookPeriodBalancesDisplay(0, currentBalance);
      setSafeBookPeriodBalancesVisibility(false);
    }

    const filteredMovements = hasDateFilter
      ? allMovements.filter((movement) => {
          const movementDate = getMovementDate(movement);
          if (!movementDate) return false;
          return movementDate >= filtersRange.startDate && movementDate <= filtersRange.endDate;
        })
      : allMovements;

    const movements = hasDateFilter
      ? filteredMovements
      : filteredMovements.slice(0, SAFE_BOOK_DEFAULT_VISIBLE_ROWS);

    if (movements.length === 0) {
      clearSafeBookStickyMonthSummary();
      tableBody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:center; color:#777;">
            ${hasDateFilter ? 'لا توجد حركات في الفترة المحددة' : 'لا توجد حركات حالياً'}
          </td>
        </tr>
      `;
      return;
    }

    const monthlyGroups = new Map();
    movements.forEach((movement) => {
      const direction = movement.direction === 'out' ? 'out' : 'in';
      const amount = Math.abs(parseFloat(movement.amount) || 0);
      const dateText = formatSafeBookDate(movement.date);
      const movementType = movement.source === 'shift'
        ? formatShiftSafeBookType(movement.date, parseInt(movement.shift_number, 10) || 1)
        : (movement.movement_type || 'حركة يدوية');

      const monthInfo = getSafeBookMonthInfo(movement.date);
      if (!monthlyGroups.has(monthInfo.key)) {
        monthlyGroups.set(monthInfo.key, {
          key: monthInfo.key,
          label: monthInfo.label,
          totalIn: 0,
          totalOut: 0,
          rows: []
        });
      }

      const monthGroup = monthlyGroups.get(monthInfo.key);
      if (direction === 'out') {
        monthGroup.totalOut += amount;
      } else {
        monthGroup.totalIn += amount;
      }

      monthGroup.rows.push(`
        <tr>
          <td>${dateText}</td>
          <td>${escapeHtml(movementType)}</td>
          <td class="safe-book-value ${direction}">${formatArabicCurrency(amount)}</td>
        </tr>
      `);
    });

    const rowsHtml = Array.from(monthlyGroups.values()).map((monthGroup) => {
      const monthHeader = `
        <tr class="safe-book-month-row" data-month-key="${escapeHtml(monthGroup.key)}">
          <td colspan="3" class="safe-book-month-cell">
            <div class="safe-book-month-header">
              <span class="safe-book-month-name">${escapeHtml(monthGroup.label)}</span>
              <div class="safe-book-month-totals">
                <span class="safe-book-month-in">${formatArabicCurrency(monthGroup.totalIn)}</span>
                <span class="safe-book-month-out">${formatArabicCurrency(monthGroup.totalOut)}</span>
              </div>
            </div>
          </td>
        </tr>
      `;

      return `${monthHeader}${monthGroup.rows.join('')}`;
    }).join('');

    tableBody.innerHTML = rowsHtml;
    bindSafeBookStickyMonthTracking();
    updateSafeBookStickyMonthSummary();
    scheduleSafeBookTableViewportSync();
    setTimeout(updateSafeBookStickyMonthSummary, 80);
  } catch (error) {
    console.error('Error loading safe book movements:', error);
    safeBookCurrentBalance = 0;
    updateSafeBookBalanceDisplay(0);
    updateSafeBookPeriodBalancesDisplay(0, 0);
    setSafeBookPeriodBalancesVisibility(false);
    clearSafeBookStickyMonthSummary();
    tableBody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center; color:#c4291d;">حدث خطأ أثناء تحميل دفتر الخزينة</td>
      </tr>
    `;
    scheduleSafeBookTableViewportSync();
  }
}

function toggleSafeBookForm(forceShow) {
  const form = document.getElementById('safe-book-form');
  if (!form) return;

  const shouldShow = typeof forceShow === 'boolean'
    ? forceShow
    : form.style.display === 'none';

  if (shouldShow) {
    toggleSafeBookAuditForm(false);
    form.style.display = 'block';
    const dateInput = document.getElementById('safe-book-date');
    const typeInput = document.getElementById('safe-book-type');
    if (dateInput && !dateInput.value) {
      dateInput.value = getTodayDate();
    }
    if (typeInput) {
      setTimeout(() => typeInput.focus(), 0);
    }
    scheduleSafeBookTableViewportSync();
    setTimeout(scheduleSafeBookTableViewportSync, 60);
    setTimeout(updateSafeBookStickyMonthSummary, 60);
  } else {
    form.style.display = 'none';
    const dateInput = document.getElementById('safe-book-date');
    const typeInput = document.getElementById('safe-book-type');
    const amountInput = document.getElementById('safe-book-amount');
    const directionSelect = document.getElementById('safe-book-direction');

    if (dateInput) dateInput.value = '';
    if (typeInput) typeInput.value = '';
    if (amountInput) amountInput.value = '';
    if (directionSelect) directionSelect.value = 'in';
    scheduleSafeBookTableViewportSync();
    setTimeout(scheduleSafeBookTableViewportSync, 60);
    setTimeout(updateSafeBookStickyMonthSummary, 60);
  }
}

function toggleSafeBookAuditForm(forceShow) {
  const form = document.getElementById('safe-book-audit-form');
  if (!form) return;

  const shouldShow = typeof forceShow === 'boolean'
    ? forceShow
    : form.style.display === 'none';

  const balanceEl = document.getElementById('safe-book-audit-program-balance');
  const actualInput = document.getElementById('safe-book-audit-actual');

  if (shouldShow) {
    toggleSafeBookForm(false);
    if (balanceEl) {
      balanceEl.textContent = formatArabicCurrency(safeBookCurrentBalance);
      balanceEl.classList.toggle('negative', safeBookCurrentBalance < 0);
    }
    if (actualInput) {
      actualInput.value = '';
      actualInput.placeholder = formatPrice(Math.max(safeBookCurrentBalance, 0));
      if (!actualInput.dataset.bound) {
        actualInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            saveSafeBookAuditMovement();
          }
        });
        actualInput.dataset.bound = 'true';
      }
      setTimeout(() => actualInput.focus(), 0);
    }
    form.style.display = 'block';
  } else {
    form.style.display = 'none';
    if (actualInput) actualInput.value = '';
  }

  scheduleSafeBookTableViewportSync();
  setTimeout(scheduleSafeBookTableViewportSync, 60);
  setTimeout(updateSafeBookStickyMonthSummary, 60);
}

async function saveSafeBookAuditMovement() {
  const actualInput = document.getElementById('safe-book-audit-actual');
  const actualBalance = parseFloat(actualInput?.value);

  if (!Number.isFinite(actualBalance) || actualBalance < 0) {
    showMessage('يرجى إدخال رصيد فعلي صحيح', 'error');
    return;
  }

  const difference = Math.round((actualBalance - safeBookCurrentBalance + Number.EPSILON) * 100) / 100;
  if (Math.abs(difference) < 0.005) {
    showMessage('رصيد الخزينة مطابق للرصيد الفعلي', 'info');
    toggleSafeBookAuditForm(false);
    return;
  }

  try {
    await ipcRenderer.invoke('add-safe-book-movement', {
      date: getTodayDate(),
      movement_type: 'فرق الجرد',
      amount: Math.abs(difference),
      direction: difference > 0 ? 'in' : 'out'
    });

    showMessage('تمت إضافة فرق الجرد وتحديث رصيد الخزينة', 'success');
    toggleSafeBookAuditForm(false);
    await loadSafeBookMovements();
  } catch (error) {
    console.error('Error saving safe book audit movement:', error);
    showMessage(error.message || 'حدث خطأ أثناء حفظ جرد الخزينة', 'error');
  }
}

async function saveSafeBookMovement() {
  const dateInput = document.getElementById('safe-book-date');
  const typeInput = document.getElementById('safe-book-type');
  const amountInput = document.getElementById('safe-book-amount');
  const directionSelect = document.getElementById('safe-book-direction');

  const date = dateInput?.value || '';
  const movementType = (typeInput?.value || '').trim();
  const amount = parseFloat(amountInput?.value);
  const direction = directionSelect?.value || 'in';

  if (!date) {
    showMessage('يرجى تحديد التاريخ', 'error');
    return;
  }

  if (!movementType) {
    showMessage('يرجى إدخال نوع الحركة', 'error');
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showMessage('يرجى إدخال قيمة صحيحة', 'error');
    return;
  }

  if (direction !== 'in' && direction !== 'out') {
    showMessage('نوع الحركة غير صالح', 'error');
    return;
  }

  try {
    await ipcRenderer.invoke('add-safe-book-movement', {
      date: date,
      movement_type: movementType,
      amount: amount,
      direction: direction
    });

    showMessage('تمت إضافة حركة الخزينة بنجاح', 'success');
    toggleSafeBookForm(false);
    await loadSafeBookMovements();
  } catch (error) {
    console.error('Error saving safe book movement:', error);
    showMessage(error.message || 'حدث خطأ أثناء إضافة حركة الخزينة', 'error');
  }
}

function openCustomerInvoices() {
  if (!customerInvoicesState.weekStart || !customerInvoicesState.weekEnd) {
    setCustomerInvoiceWeekFromDate(new Date());
  }
  showScreen('customer-invoices', 'home');
}

function getLocalDateFromIso(dateString) {
  const parts = parseIsoDateParts(dateString);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

function formatLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSaturdayWeekRange(date = new Date()) {
  const baseDate = date instanceof Date && !Number.isNaN(date.getTime()) ? new Date(date) : new Date();
  baseDate.setHours(12, 0, 0, 0);
  const daysSinceSaturday = (baseDate.getDay() + 1) % 7;
  const start = new Date(baseDate);
  start.setDate(baseDate.getDate() - daysSinceSaturday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekStart: formatLocalIsoDate(start),
    weekEnd: formatLocalIsoDate(end)
  };
}

function setCustomerInvoiceWeekFromDate(date) {
  const range = getSaturdayWeekRange(date);
  customerInvoicesState.weekStart = range.weekStart;
  customerInvoicesState.weekEnd = range.weekEnd;
}

async function initializeCustomerInvoicesPage() {
  if (!customerInvoicesState.weekStart || !customerInvoicesState.weekEnd) {
    setCustomerInvoiceWeekFromDate(new Date());
  }
  await loadCustomerWeeklyInvoices();
}

async function changeCustomerInvoiceWeek(direction) {
  const currentStart = getLocalDateFromIso(customerInvoicesState.weekStart) || new Date();
  currentStart.setDate(currentStart.getDate() + (parseInt(direction, 10) || 0) * 7);
  setCustomerInvoiceWeekFromDate(currentStart);
  await loadCustomerWeeklyInvoices();
}

function handleCustomerInvoiceClientChange() {
  const select = document.getElementById('customer-invoices-select');
  customerInvoicesState.selectedCustomerId = select?.value || '';
  renderCustomerInvoices();
}

async function saveCustomerInvoiceOpeningBalance() {
  const customerId = parseInt(customerInvoicesState.selectedCustomerId, 10);
  const customer = customerInvoicesState.customers.find((item) => String(item.id) === String(customerInvoicesState.selectedCustomerId));
  const input = document.getElementById('customer-invoices-previous-balance');
  if (!Number.isFinite(customerId) || customerId <= 0) {
    showMessage('اختر العميل أولاً', 'warning');
    return;
  }

  const balance = parseSummaryNumber(input?.value);
  try {
    const result = await ipcRenderer.invoke('upsert-customer-balance-adjustment', {
      customer_id: customerId,
      customer_name: customer?.name || '',
      effective_date: customerInvoicesState.weekStart,
      balance
    });

    if (!result?.success) {
      throw new Error(result?.error || 'save_failed');
    }

    showMessage('تم حفظ الرصيد السابق', 'success');
    closeCustomerInvoiceBalanceModal();
    await loadCustomerWeeklyInvoices();
  } catch (error) {
    console.error('Error saving customer balance adjustment:', error);
    showMessage('خطأ في حفظ الرصيد السابق', 'error');
  }
}

function getSelectedCustomerInvoice() {
  return customerInvoicesState.invoicesByCustomer[customerInvoicesState.selectedCustomerId] || {
    total: 0,
    previous_balance: 0,
    purchases_total: 0,
    payments_total: 0,
    current_balance: 0,
    items: [],
    payments: []
  };
}

function openCustomerInvoiceBalanceModal() {
  if (!customerInvoicesState.selectedCustomerId) {
    showMessage('اختر العميل أولاً', 'warning');
    return;
  }

  const modal = document.getElementById('customer-balance-modal');
  const input = document.getElementById('customer-invoices-previous-balance');
  const note = document.getElementById('customer-balance-modal-note');
  const selectedInvoice = getSelectedCustomerInvoice();
  const previousBalance = parseFloat(selectedInvoice.previous_balance) || 0;

  if (input) {
    input.value = formatPrice(previousBalance);
    input.disabled = false;
  }

  if (note) {
    note.textContent = 'سيتم تسجيل الفرق كتصحيح في جدول المدفوعات.';
  }

  if (modal) {
    modal.classList.add('show');
    setTimeout(() => input?.focus(), 0);
  }
}

function closeCustomerInvoiceBalanceModal() {
  const modal = document.getElementById('customer-balance-modal');
  if (modal) modal.classList.remove('show');
}

async function loadCustomerWeeklyInvoices() {
  const body = document.getElementById('customer-invoices-body');
  const empty = document.getElementById('customer-invoices-empty');
  const paymentsBody = document.getElementById('customer-invoices-payments-body');
  const paymentsEmpty = document.getElementById('customer-invoices-payments-empty');
  const previousCustomerId = customerInvoicesState.selectedCustomerId;

  if (body) {
    body.innerHTML = '<tr><td colspan="4" class="customer-invoices-loading">جاري تحميل فواتير العملاء...</td></tr>';
  }
  if (empty) empty.style.display = 'none';
  if (paymentsBody) {
    paymentsBody.innerHTML = '<tr><td colspan="3" class="customer-invoices-loading">جاري تحميل المدفوعات...</td></tr>';
  }
  if (paymentsEmpty) paymentsEmpty.style.display = 'none';

  try {
    const result = await ipcRenderer.invoke('get-customer-weekly-invoices', {
      weekStart: customerInvoicesState.weekStart,
      weekEnd: customerInvoicesState.weekEnd
    });

    customerInvoicesState.customers = normalizeCustomerInvoiceCustomers(result?.customers);
    customerInvoicesState.invoicesByCustomer = result?.invoicesByCustomer || {};
    customerInvoicesState.warnings = filterCustomerInvoiceWarnings(result?.warnings);

    if (previousCustomerId && customerInvoicesState.customers.some((customer) => String(customer.id) === String(previousCustomerId))) {
      customerInvoicesState.selectedCustomerId = previousCustomerId;
    } else {
      customerInvoicesState.selectedCustomerId = customerInvoicesState.customers[0]?.id ? String(customerInvoicesState.customers[0].id) : '';
    }

    renderCustomerInvoices();
  } catch (error) {
    console.error('Error loading customer weekly invoices:', error);
    customerInvoicesState.customers = [];
    customerInvoicesState.invoicesByCustomer = {};
    customerInvoicesState.warnings = [];
    if (body) {
      body.innerHTML = '<tr><td colspan="4" class="customer-invoices-loading error">حدث خطأ أثناء تحميل فواتير العملاء</td></tr>';
    }
    if (paymentsBody) {
      paymentsBody.innerHTML = '<tr><td colspan="3" class="customer-invoices-loading error">حدث خطأ أثناء تحميل المدفوعات</td></tr>';
    }
    showMessage('حدث خطأ أثناء تحميل فواتير العملاء', 'error');
  }
}

function normalizeCustomerInvoiceCustomers(customers = []) {
  if (!Array.isArray(customers)) return [];

  return customers
    .map((customer) => {
      if (customer && typeof customer === 'object') {
        const id = parseInt(customer.id ?? customer.customer_id, 10);
        const name = String(customer.name ?? customer.customer ?? customer.customer_name ?? '').trim();
        if (Number.isFinite(id) && id > 0 && name) return { id, name };
        return null;
      }

      const legacyName = String(customer || '').trim();
      return legacyName ? { id: legacyName, name: legacyName } : null;
    })
    .filter(Boolean);
}

function filterCustomerInvoiceWarnings(warnings = []) {
  if (!Array.isArray(warnings)) return [];

  const hiddenPatterns = [
    'صفوف وقود عملاء قديمة غير مرتبطة بكود عميل',
    'صفوف زيوت عملاء قديمة غير مرتبطة بكود عميل',
    'مدفوعات عملاء غير مرتبطة بكود عميل'
  ];

  return warnings.filter((warning) => {
    const text = String(warning || '').trim();
    return text && !hiddenPatterns.some((pattern) => text.includes(pattern));
  });
}

function renderCustomerInvoices() {
  const weekLabel = document.getElementById('customer-invoices-week-label');
  const select = document.getElementById('customer-invoices-select');
  const previousInput = document.getElementById('customer-invoices-previous-balance');
  const editBalanceBtn = document.getElementById('customer-invoices-edit-balance-btn');
  const previousTotalEl = document.getElementById('customer-invoices-previous-total');
  const totalEl = document.getElementById('customer-invoices-total');
  const paymentsTotalEl = document.getElementById('customer-invoices-payments-total');
  const currentBalanceEl = document.getElementById('customer-invoices-current-balance');
  const warningEl = document.getElementById('customer-invoices-warning');
  const body = document.getElementById('customer-invoices-body');
  const empty = document.getElementById('customer-invoices-empty');
  const paymentsBody = document.getElementById('customer-invoices-payments-body');
  const paymentsEmpty = document.getElementById('customer-invoices-payments-empty');

  if (weekLabel) {
    weekLabel.textContent = `${formatDateOnlyDisplay(customerInvoicesState.weekStart)} - ${formatDateOnlyDisplay(customerInvoicesState.weekEnd)}`;
  }

  if (select) {
    select.innerHTML = '';
    customerInvoicesState.customers.forEach((customer) => {
      const option = document.createElement('option');
      option.value = String(customer.id);
      option.textContent = customer.name;
      select.appendChild(option);
    });
    select.value = customerInvoicesState.selectedCustomerId || '';
    select.disabled = customerInvoicesState.customers.length === 0;
  }

  const selectedInvoice = getSelectedCustomerInvoice();
  const items = Array.isArray(selectedInvoice.items) ? selectedInvoice.items : [];
  const payments = Array.isArray(selectedInvoice.payments) ? selectedInvoice.payments : [];
  const previousBalance = parseFloat(selectedInvoice.previous_balance) || 0;
  const purchasesTotal = parseFloat(selectedInvoice.purchases_total ?? selectedInvoice.total) || 0;
  const paymentsTotal = parseFloat(selectedInvoice.payments_total) || 0;
  const currentBalance = parseFloat(selectedInvoice.current_balance) || 0;

  if (previousInput) {
    previousInput.value = customerInvoicesState.selectedCustomerId ? formatPrice(previousBalance) : '';
    previousInput.disabled = !customerInvoicesState.selectedCustomerId;
  }

  if (editBalanceBtn) {
    editBalanceBtn.disabled = !customerInvoicesState.selectedCustomerId;
  }

  if (previousTotalEl) {
    previousTotalEl.textContent = formatArabicCurrency(previousBalance);
  }

  if (totalEl) {
    totalEl.textContent = formatArabicCurrency(purchasesTotal);
  }

  if (paymentsTotalEl) {
    paymentsTotalEl.textContent = formatArabicCurrency(paymentsTotal);
  }

  if (currentBalanceEl) {
    currentBalanceEl.textContent = formatArabicCurrency(currentBalance);
  }

  if (warningEl) {
    if (customerInvoicesState.warnings.length > 0) {
      warningEl.textContent = customerInvoicesState.warnings.join(' - ');
      warningEl.style.display = 'block';
    } else {
      warningEl.textContent = '';
      warningEl.style.display = 'none';
    }
  }

  if (!body || !empty || !paymentsBody || !paymentsEmpty) return;

  if (items.length === 0) {
    body.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    body.innerHTML = items.map((item) => `
      <tr>
        <td>${escapeHtml(formatDateOnlyDisplay(item.date))}</td>
        <td>${escapeHtml(item.fuel_name || '')}</td>
        <td>${formatArabicNumber(parseFloat(item.quantity) || 0)}</td>
        <td>${formatArabicCurrency(parseFloat(item.total) || 0)}</td>
      </tr>
    `).join('');
  }

  if (payments.length === 0) {
    paymentsBody.innerHTML = '';
    paymentsEmpty.style.display = 'block';
    return;
  }

  paymentsEmpty.style.display = 'none';
  paymentsBody.innerHTML = payments.map((payment) => `
    <tr>
      <td>${escapeHtml(formatDateOnlyDisplay(payment.date))}</td>
      <td>${escapeHtml(payment.label || (payment.type === 'balance_adjustment' ? 'تصحيح الرصيد السابق' : 'مدفوعات العملاء'))}</td>
      <td>${formatArabicCurrency(parseFloat(payment.amount) || 0)}</td>
    </tr>
  `).join('');
}

function setupHomeChartToggle() {
  const toggleButtons = document.querySelectorAll('.home-chart-toggle-btn');
  if (!toggleButtons.length) return;

  toggleButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const selectedMode = button.dataset.homeChartMode;
      if (!selectedMode || selectedMode === currentHomeChartMode) {
        return;
      }

      if (selectedMode === HOME_CHART_MODE.SALES && !isOnline) {
        showMessage('عرض الكميات المباعة يتطلب اتصالاً بالإنترنت', 'warning');
        return;
      }

      currentHomeChartMode = selectedMode;
      updateHomeChartToggleUI();
      await loadHomeChart();
    });
  });

  updateHomeChartToggleUI();
}

function getChartConstructor() {
  return window.Chart || (typeof Chart !== 'undefined' ? Chart : null);
}

function clearChartCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getDaysInMonthKey(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(value => parseInt(value, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0;
  return new Date(year, month, 0).getDate();
}

function getCurrentMonthForecastValue(actualQuantity, monthKey, registeredDays, now = new Date()) {
  if (monthKey !== getMonthKey(now)) return actualQuantity;

  const elapsedDays = Math.max(1, parseInt(registeredDays, 10) || 0);
  const daysInMonth = getDaysInMonthKey(monthKey);
  if (!daysInMonth) return actualQuantity;

  return (actualQuantity / elapsedDays) * daysInMonth;
}

function syncHomeChartHeightToCardRows() {
  const homeScreen = document.getElementById('home-screen');
  if (!homeScreen || !homeScreen.classList.contains('active')) return;

  const chartContainer = homeScreen.querySelector('.home-chart-container');
  const cardsGrid = homeScreen.querySelector('.action-cards-grid');
  if (!chartContainer || !cardsGrid) return;

  // Keep mobile sizing delegated to CSS media rules.
  if (window.matchMedia('(max-width: 768px)').matches) {
    chartContainer.style.removeProperty('height');
    return;
  }

  const cards = Array.from(cardsGrid.querySelectorAll('.action-card'));
  if (!cards.length) return;

  const rowTolerance = 4;
  const rowGroups = [];
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    const top = rect.top;
    const existingGroup = rowGroups.find(group => Math.abs(group.top - top) <= rowTolerance);

    if (!existingGroup) {
      rowGroups.push({ top, height: rect.height });
      return;
    }

    existingGroup.height = Math.max(existingGroup.height, rect.height);
  });

  const sortedRowHeights = rowGroups
    .sort((a, b) => a.top - b.top)
    .map(group => group.height);

  if (!sortedRowHeights.length) return;

  const targetRows = 2;
  const usedRows = sortedRowHeights.slice(0, targetRows);
  const rowsHeight = usedRows.reduce((total, height) => total + height, 0);
  const gridStyle = window.getComputedStyle(cardsGrid);
  const rowGap = parseFloat(gridStyle.rowGap || gridStyle.gap || '0') || 0;
  const totalGap = rowGap * Math.max(0, usedRows.length - 1);

  chartContainer.style.height = `${Math.round(rowsHeight + totalGap)}px`;
}

function scheduleHomeChartHeightSync() {
  window.requestAnimationFrame(() => {
    syncHomeChartHeightToCardRows();
  });
}

function updateHomeChartToggleUI() {
  const chartTitle = document.getElementById('home-chart-title');
  if (chartTitle) {
    chartTitle.textContent = currentHomeChartMode === HOME_CHART_MODE.SALES
      ? 'كميات المبيعات الشهرية حسب نوع الوقود'
      : 'كميات المشتريات الشهرية حسب نوع الوقود';
  }

  document.querySelectorAll('.home-chart-toggle-btn').forEach(button => {
    const isActive = button.dataset.homeChartMode === currentHomeChartMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

async function setupAnnualInventoryCalculator() {
  if (annualInventoryInitialized) return;

  const yearSelect = document.getElementById('annual-inventory-year');
  if (!yearSelect) return;

  annualInventoryInitialized = true;

  yearSelect.addEventListener('change', () => {
    loadAnnualInventoryForYear(getSelectedAnnualInventoryYear());
  });

  document.querySelectorAll('.annual-inventory-input').forEach(input => {
    input.addEventListener('input', calculateAnnualInventory);
    input.addEventListener('blur', normalizeAnnualInventoryInput);
  });

  document.querySelectorAll('.annual-add-item-btn').forEach(button => {
    button.addEventListener('click', () => {
      const group = button.dataset.annualAddGroup;
      if (!group) return;
      addAnnualCustomRow(group);
    });
  });

  const saveBtn = document.getElementById('annual-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveAnnualInventory(false);
    });
  }

  const finalizeBtn = document.getElementById('annual-finalize-btn');
  if (finalizeBtn) {
    finalizeBtn.addEventListener('click', () => {
      saveAnnualInventory(true);
    });
  }

  await refreshAnnualInventoryView(String(new Date().getFullYear()));
}

function normalizeAnnualInventoryInput(event) {
  const input = event.target;
  const rawValue = convertFromArabicNumerals(input.value || '').trim();

  if (!rawValue || !/[0-9]/.test(rawValue)) {
    input.value = '';
    calculateAnnualInventory();
    return;
  }

  const value = parseAnnualInventoryValue(rawValue);
  input.value = formatArabicNumberFixed(value);
  calculateAnnualInventory();
}

function parseAnnualInventoryValue(value) {
  const normalized = convertFromArabicNumerals(String(value || ''))
    .replace(/[٬\s]/g, '')
    .replace(/[٫،,]/g, '.')
    .replace(/[^\d.-]/g, '');

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAnnualInventoryItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
}

function normalizeAnnualCustomItem(item) {
  if (!item || typeof item !== 'object') return null;

  const label = String(item.label || '').trim();
  const value = parseAnnualInventoryValue(item.value);

  if (!label && Math.abs(value) < 0.0001) {
    return null;
  }

  return {
    label: label || 'بند إضافي',
    value
  };
}

function normalizeAnnualCustomItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeAnnualCustomItem).filter(Boolean);
}

function createAnnualCustomItemId() {
  annualCustomItemCounter += 1;
  return `annual-custom-${Date.now()}-${annualCustomItemCounter}`;
}

function createAnnualCustomRowElement(group, item = {}) {
  const row = document.createElement('div');
  row.className = 'annual-inventory-row annual-custom-row';
  row.dataset.annualCustomRow = '1';
  row.dataset.annualGroup = group;
  row.dataset.customId = createAnnualCustomItemId();

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'annual-custom-label-input';
  labelInput.placeholder = 'اسم البند';
  labelInput.value = String(item.label || '');

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'annual-inventory-input annual-custom-value-input';
  valueInput.dataset.annualGroup = group;
  valueInput.inputMode = 'decimal';
  valueInput.placeholder = '0';

  const hasValue = item.value !== null && item.value !== undefined && item.value !== '';
  valueInput.value = hasValue ? formatArabicNumberFixed(parseAnnualInventoryValue(item.value)) : '';
  valueInput.addEventListener('input', calculateAnnualInventory);
  valueInput.addEventListener('blur', normalizeAnnualInventoryInput);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'annual-remove-item-btn';
  removeButton.title = 'حذف البند';
  removeButton.textContent = '×';
  removeButton.addEventListener('click', () => {
    row.remove();
    calculateAnnualInventory();
  });

  row.appendChild(labelInput);
  row.appendChild(valueInput);
  row.appendChild(removeButton);

  return row;
}

function addAnnualCustomRow(group, item = {}) {
  const container = document.getElementById(`annual-${group}-custom-items`);
  if (!container) return;

  container.appendChild(createAnnualCustomRowElement(group, item));
  calculateAnnualInventory();
}

function renderAnnualCustomItems(group, items = []) {
  const container = document.getElementById(`annual-${group}-custom-items`);
  if (!container) return;

  container.innerHTML = '';
  const normalizedItems = normalizeAnnualCustomItems(items);
  normalizedItems.forEach((item) => {
    container.appendChild(createAnnualCustomRowElement(group, item));
  });
}

function collectAnnualCustomItemsByGroup(group) {
  const container = document.getElementById(`annual-${group}-custom-items`);
  if (!container) return [];

  const rows = container.querySelectorAll('.annual-custom-row');
  const items = [];

  rows.forEach((row) => {
    const labelInput = row.querySelector('.annual-custom-label-input');
    const valueInput = row.querySelector('.annual-custom-value-input');

    const normalized = normalizeAnnualCustomItem({
      label: labelInput?.value || '',
      value: valueInput?.value || ''
    });

    if (normalized) {
      items.push(normalized);
    }
  });

  return items;
}

function collectAnnualCustomItems() {
  return {
    expected_items: collectAnnualCustomItemsByGroup('expected'),
    actual_items: collectAnnualCustomItemsByGroup('actual')
  };
}

function normalizeAnnualInventoryRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const normalized = {
    id: record.id,
    year: String(record.year),
    fields: {},
    finalized: Number(record.finalized) === 1 || record.finalized === true,
    status: record.status || 'balanced'
  };

  ANNUAL_INVENTORY_FIELDS.forEach(({ key }) => {
    normalized.fields[key] = parseAnnualInventoryValue(record[key]);
  });

  normalized.expected_total = parseAnnualInventoryValue(record.expected_total);
  normalized.actual_total = parseAnnualInventoryValue(record.actual_total);
  normalized.difference = parseAnnualInventoryValue(record.difference);
  normalized.expected_items = normalizeAnnualCustomItems(parseAnnualInventoryItems(record.expected_items));
  normalized.actual_items = normalizeAnnualCustomItems(parseAnnualInventoryItems(record.actual_items));
  normalized.finalized_at = record.finalized_at || null;
  normalized.updated_at = record.updated_at || null;

  return normalized;
}

async function loadAnnualInventoryRecordsFromDatabase(showError = false) {
  try {
    const records = await ipcRenderer.invoke('get-annual-inventory-records');
    annualInventoryRecords = {};

    if (!Array.isArray(records)) return;

    records.forEach((record) => {
      const normalized = normalizeAnnualInventoryRecord(record);
      if (!normalized) return;
      annualInventoryRecords[normalized.year] = normalized;
    });
  } catch (error) {
    console.error('Error loading annual inventory records from database:', error);
    annualInventoryRecords = {};
    if (showError) {
      showMessage('تعذر تحميل بيانات الجرد السنوي', 'error');
    }
  }
}

function getSelectedAnnualInventoryYear() {
  const yearSelect = document.getElementById('annual-inventory-year');
  return String(yearSelect?.value || new Date().getFullYear());
}

function updateAnnualInventoryTitle(year) {
  const titleEl = document.getElementById('annual-inventory-title');
  if (!titleEl) return;

  const normalizedYear = String(year || new Date().getFullYear());
  titleEl.textContent = `جرد سنوي - عام ${convertToArabicNumerals(normalizedYear)}`;
}

function getAnnualInventoryRecord(year) {
  return annualInventoryRecords[String(year)] || null;
}

function getAutoPreviousYearBalance(year) {
  const parsedYear = parseInt(String(year), 10);
  if (!Number.isFinite(parsedYear)) return null;

  const previousYearRecord = getAnnualInventoryRecord(String(parsedYear - 1));
  if (!previousYearRecord) return null;

  const value = parseAnnualInventoryValue(previousYearRecord.actual_total);
  return Number.isFinite(value) ? value : null;
}

function populateAnnualInventoryYearOptions(selectedYear = null) {
  const yearSelect = document.getElementById('annual-inventory-year');
  if (!yearSelect) return;

  const currentYear = String(new Date().getFullYear());
  const yearsSet = new Set([currentYear]);

  Object.entries(annualInventoryRecords).forEach(([year, record]) => {
    if (record?.finalized) {
      yearsSet.add(String(year));
    }
  });

  if (selectedYear) {
    yearsSet.add(String(selectedYear));
  }

  const sortedYears = Array.from(yearsSet).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

  yearSelect.innerHTML = sortedYears.map((year) => {
    const record = getAnnualInventoryRecord(year);
    const isCurrent = year === currentYear;
    const suffix = record?.finalized ? ' - مقفل' : (isCurrent ? ' - الحالي' : '');
    return `<option value="${year}">${convertToArabicNumerals(year)}${suffix}</option>`;
  }).join('');

  if (selectedYear) {
    yearSelect.value = String(selectedYear);
  }
}

function applyAnnualInventoryFields(fields = {}) {
  ANNUAL_INVENTORY_FIELDS.forEach(({ key, id }) => {
    const input = document.getElementById(id);
    if (!input) return;

    const value = fields[key];
    if (value === null || value === undefined || value === '') {
      input.value = '';
      return;
    }

    input.value = formatArabicNumberFixed(parseAnnualInventoryValue(value));
  });
}

function collectAnnualInventoryFields() {
  const values = {};
  ANNUAL_INVENTORY_FIELDS.forEach(({ key, id }) => {
    const input = document.getElementById(id);
    values[key] = parseAnnualInventoryValue(input?.value || '');
  });
  return values;
}

function setAnnualInventoryLocked(isLocked) {
  document.querySelectorAll('.annual-inventory-input').forEach(input => {
    input.disabled = isLocked;
  });
  document.querySelectorAll('.annual-custom-label-input').forEach(input => {
    input.disabled = isLocked;
  });
  document.querySelectorAll('.annual-remove-item-btn').forEach(button => {
    button.disabled = isLocked;
  });
  document.querySelectorAll('.annual-add-item-btn').forEach(button => {
    button.disabled = isLocked;
  });

  const saveBtn = document.getElementById('annual-save-btn');
  if (saveBtn) saveBtn.disabled = isLocked;

  const finalizeBtn = document.getElementById('annual-finalize-btn');
  if (finalizeBtn) {
    finalizeBtn.disabled = isLocked;
    finalizeBtn.textContent = isLocked ? 'تم الإقفال النهائي' : 'حفظ وإقفال';
  }

  const lockNote = document.getElementById('annual-lock-note');
  if (lockNote) {
    if (isLocked) {
      lockNote.style.display = 'block';
      lockNote.textContent = 'هذه السنة مقفلة نهائياً ولا يمكن تعديلها مستقبلاً.';
    } else {
      lockNote.style.display = 'none';
      lockNote.textContent = '';
    }
  }
}

function loadAnnualInventoryForYear(year) {
  const normalizedYear = String(year || new Date().getFullYear());
  const record = getAnnualInventoryRecord(normalizedYear);
  updateAnnualInventoryTitle(normalizedYear);

  if (record) {
    applyAnnualInventoryFields(record.fields || {});
  } else {
    const defaultFields = {};
    const autoPrevBalance = getAutoPreviousYearBalance(normalizedYear);
    if (autoPrevBalance !== null) {
      defaultFields.prev_balance = autoPrevBalance;
    }
    applyAnnualInventoryFields(defaultFields);
  }

  renderAnnualCustomItems('expected', record?.expected_items || []);
  renderAnnualCustomItems('actual', record?.actual_items || []);
  setAnnualInventoryLocked(Boolean(record?.finalized));
  calculateAnnualInventory();
}

async function refreshAnnualInventoryView(preferredYear = null) {
  const previousYear = preferredYear || getSelectedAnnualInventoryYear() || String(new Date().getFullYear());
  await loadAnnualInventoryRecordsFromDatabase(true);
  populateAnnualInventoryYearOptions(previousYear);
  loadAnnualInventoryForYear(getSelectedAnnualInventoryYear());
}

function getAnnualInventoryComputedTotals(fields, customItems) {
  const values = fields || collectAnnualInventoryFields();
  const extras = customItems || collectAnnualCustomItems();
  const expectedExtrasTotal = (extras.expected_items || []).reduce((sum, item) => {
    return sum + parseAnnualInventoryValue(item.value);
  }, 0);
  const actualExtrasTotal = (extras.actual_items || []).reduce((sum, item) => {
    return sum + parseAnnualInventoryValue(item.value);
  }, 0);

  const expectedTotal = (values.prev_balance || 0) + (values.station_profit || 0);
  const actualTotal =
    (values.bank_balance || 0) +
    (values.safe_balance || 0) +
    (values.accounting_remainder || 0) +
    (values.customers_balance || 0) +
    (values.vouchers_balance || 0) +
    (values.visa_balance || 0);
  const finalExpectedTotal = expectedTotal + expectedExtrasTotal;
  const finalActualTotal = actualTotal + actualExtrasTotal;
  const difference = finalActualTotal - finalExpectedTotal;

  let status = 'balanced';
  if (difference > 0.009) {
    status = 'surplus';
  } else if (difference < -0.009) {
    status = 'shortage';
  }

  return { expectedTotal: finalExpectedTotal, actualTotal: finalActualTotal, difference, status };
}

async function saveAnnualInventory(finalize = false) {
  const year = getSelectedAnnualInventoryYear();
  const currentRecord = getAnnualInventoryRecord(year);

  if (currentRecord?.finalized) {
    showMessage('هذه السنة مقفلة نهائياً ولا يمكن تعديلها', 'warning');
    loadAnnualInventoryForYear(year);
    return;
  }

  if (finalize) {
    const confirmFinalize = confirm('هل تريد حفظ الجرد وإقفاله نهائياً؟ بعد الإقفال لن تتمكن من تعديل البيانات.');
    if (!confirmFinalize) {
      return;
    }
  }

  const parsedYear = parseInt(year, 10);
  if (!Number.isFinite(parsedYear)) {
    showMessage('السنة غير صالحة', 'error');
    return;
  }

  const fields = collectAnnualInventoryFields();
  const customItems = collectAnnualCustomItems();
  const totals = getAnnualInventoryComputedTotals(fields, customItems);

  try {
    await ipcRenderer.invoke('save-annual-inventory', {
      year: parsedYear,
      ...fields,
      expected_items: customItems.expected_items,
      actual_items: customItems.actual_items,
      expected_total: totals.expectedTotal,
      actual_total: totals.actualTotal,
      difference: totals.difference,
      status: totals.status,
      finalized: Boolean(finalize)
    });

    await refreshAnnualInventoryView(String(parsedYear));
    showMessage(finalize ? 'تم حفظ الجرد وإقفاله نهائياً' : 'تم حفظ بيانات الجرد بنجاح', 'success');
  } catch (error) {
    console.error('Error saving annual inventory:', error);
    showMessage(error.message || 'حدث خطأ أثناء حفظ بيانات الجرد', 'error');
  }
}

function getAnnualInventoryGroupTotal(group) {
  return Array.from(document.querySelectorAll(`.annual-inventory-input[data-annual-group="${group}"]`))
    .reduce((sum, input) => sum + parseAnnualInventoryValue(input.value), 0);
}

function calculateAnnualInventory() {
  const expectedTotal = getAnnualInventoryGroupTotal('expected');
  const actualTotal = getAnnualInventoryGroupTotal('actual');
  const netWorthTotal = actualTotal;
  const difference = actualTotal - expectedTotal;

  const expectedTotalEl = document.getElementById('annual-expected-total');
  const netWorthTotalEl = document.getElementById('annual-net-worth-total');
  const diffValueEl = document.getElementById('annual-diff-value');
  const diffLabelEl = document.getElementById('annual-diff-label');

  if (expectedTotalEl) expectedTotalEl.textContent = formatArabicCurrencyFixed(expectedTotal);
  if (netWorthTotalEl) netWorthTotalEl.textContent = formatArabicCurrencyFixed(netWorthTotal);
  if (diffValueEl) diffValueEl.textContent = formatArabicCurrencyFixed(Math.abs(difference));

  if (!diffLabelEl) return;

  diffLabelEl.classList.remove('balanced', 'shortage', 'surplus');

  if (difference > 0.009) {
    diffLabelEl.textContent = 'زيادة';
    diffLabelEl.classList.add('surplus');
  } else if (difference < -0.009) {
    diffLabelEl.textContent = 'عجز';
    diffLabelEl.classList.add('shortage');
  } else {
    diffLabelEl.textContent = 'متوازن';
    diffLabelEl.classList.add('balanced');
  }
}

async function loadHomeChart() {
  const isSalesMode = currentHomeChartMode === HOME_CHART_MODE.SALES;

  try {
    let chartData = [];

    if (isSalesMode) {
      const [salesResult, shiftFuelSalesResult] = await Promise.allSettled([
        ipcRenderer.invoke('get-sales'),
        ipcRenderer.invoke('get-shift-fuel-sales')
      ]);

      const sales = salesResult.status === 'fulfilled' && Array.isArray(salesResult.value)
        ? salesResult.value
        : [];
      const shiftFuelSales = shiftFuelSalesResult.status === 'fulfilled' && Array.isArray(shiftFuelSalesResult.value)
        ? shiftFuelSalesResult.value
        : [];

      chartData = [...sales, ...shiftFuelSales];
    } else {
      const movements = await ipcRenderer.invoke('get-fuel-movements');
      if (!movements || !Array.isArray(movements)) {
        console.error('Invalid movements data');
        return;
      }
      chartData = movements.filter(movement => movement.type === 'in');
    }

    createMonthlyFuelSalesChart(chartData, currentHomeChartMode);
    scheduleHomeChartHeightSync();
  } catch (error) {
    if (isSalesMode) {
      showMessage('عرض الكميات المباعة غير متاح حالياً', 'warning');
    }
    console.error('Error loading home chart:', error);
    createMonthlyFuelSalesChart([], currentHomeChartMode);
    scheduleHomeChartHeightSync();
  }
}

function normalizeFuelTypeForHomeChart(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const normalized = text
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .toLowerCase();

  if (normalized === 'سولار' || normalized === 'ديزل' || normalized === 'diesel') return 'سولار';
  if (normalized === 'غاز سيارات' || normalized === 'gas') return 'غاز سيارات';

  const isFuelName = /بنزين|benz|gasoline|petrol/.test(normalized);
  const hasOctane = (octane) => new RegExp(`(^|[^0-9])${octane}([^0-9]|$)`).test(normalized);
  if (isFuelName && hasOctane('95')) return 'بنزين ٩٥';
  if (isFuelName && hasOctane('92')) return 'بنزين ٩٢';
  if (isFuelName && (hasOctane('80') || normalized === 'بنزين 8')) return 'بنزين ٨٠';

  return text;
}

async function loadFuelPrices() {
  try {
    const [pricesRaw, purchasePricesRaw] = await Promise.all([
      ipcRenderer.invoke('get-fuel-prices'),
      ipcRenderer.invoke('get-purchase-prices').catch((error) => {
        console.warn('Unable to load purchase prices for price edit:', error);
        return [];
      })
    ]);
    const prices = Array.isArray(pricesRaw) ? pricesRaw : [];
    const purchasePrices = Array.isArray(purchasePricesRaw) ? purchasePricesRaw : [];
    fuelProductCodesByName = new Map((Array.isArray(prices) ? prices : [])
      .map(product => [String(product.fuel_type || '').trim(), String(product.product_code || '').trim()])
      .filter(([name]) => Boolean(name)));
    renderFuelPriceRows(prices, purchasePrices);
  } catch (error) {
    console.error('Error loading fuel prices:', error);
  }
}

function renderFuelPriceRows(prices, purchasePrices = []) {
  const tbody = document.getElementById('fuel-prices-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  tbody.dataset.loaded = '1';

  if (prices.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="5" style="text-align:center; color:#666;">لا توجد منتجات وقود</td>';
    tbody.appendChild(row);
    initializePriceDate();
    return;
  }

  const purchaseByCode = new Map();
  const purchaseByName = new Map();
  purchasePrices.forEach((item) => {
    const productCode = String(item?.product_code || '').trim();
    const fuelType = String(item?.fuel_type || '').trim();
    if (productCode) purchaseByCode.set(productCode, item);
    if (fuelType) purchaseByName.set(fuelType, item);
  });

  prices.forEach((product, index) => {
    const productName = product.fuel_type || '';
    const productCode = String(product.product_code || '').trim();
    const purchase = purchaseByCode.get(productCode) || purchaseByName.get(productName) || {};
    const row = document.createElement('tr');
    row.dataset.product = productName;

    const nameCell = document.createElement('td');
    nameCell.className = 'product-name';
    nameCell.textContent = productName;

    const currentPriceCell = document.createElement('td');
    currentPriceCell.style.textAlign = 'center';
    currentPriceCell.textContent = formatArabicCurrency(parseFloat(product.price) || 0);

    const newPriceCell = document.createElement('td');
    newPriceCell.style.textAlign = 'center';
    const saleInput = document.createElement('input');
    saleInput.type = 'number';
    saleInput.id = `price-fuel-sale-${product.id || index}`;
    saleInput.step = '0.01';
    saleInput.min = '0';
    saleInput.className = 'table-price-input';
    saleInput.placeholder = '0.00';
    saleInput.autocomplete = 'off';
    saleInput.dataset.priceKind = 'sale';
    saleInput.dataset.productType = 'fuel';
    saleInput.dataset.productName = productName;
    saleInput.dataset.productCode = productCode;
    saleInput.dataset.currentPrice = String(parseFloat(product.price) || 0);
    saleInput.dataset.dirty = '0';
    saleInput.addEventListener('input', () => {
      saleInput.dataset.dirty = '1';
    });
    newPriceCell.appendChild(saleInput);

    const currentPurchaseCell = document.createElement('td');
    currentPurchaseCell.style.textAlign = 'center';
    const purchasePrice = parseFloat(purchase.price);
    currentPurchaseCell.textContent = Number.isFinite(purchasePrice) && purchasePrice > 0
      ? formatArabicCurrencyPreserveDecimals(purchase.price)
      : '-';

    const newPurchaseCell = document.createElement('td');
    newPurchaseCell.style.textAlign = 'center';
    const purchaseInput = document.createElement('input');
    purchaseInput.type = 'number';
    purchaseInput.id = `price-fuel-purchase-${product.id || index}`;
    purchaseInput.step = 'any';
    purchaseInput.min = '0';
    purchaseInput.className = 'table-price-input';
    purchaseInput.placeholder = '0.00';
    purchaseInput.autocomplete = 'off';
    purchaseInput.dataset.priceKind = 'purchase';
    purchaseInput.dataset.productType = 'fuel';
    purchaseInput.dataset.productName = productName;
    purchaseInput.dataset.productCode = productCode;
    purchaseInput.dataset.currentPrice = String(Number.isFinite(purchasePrice) ? purchasePrice : 0);
    purchaseInput.dataset.dirty = '0';
    purchaseInput.addEventListener('input', () => {
      purchaseInput.dataset.dirty = '1';
    });
    newPurchaseCell.appendChild(purchaseInput);

    row.appendChild(nameCell);
    row.appendChild(currentPriceCell);
    row.appendChild(newPriceCell);
    row.appendChild(currentPurchaseCell);
    row.appendChild(newPurchaseCell);
    tbody.appendChild(row);
  });

  initializePriceDate();
}

async function loadPurchasePrices() {
  try {
    const prices = await ipcRenderer.invoke('get-purchase-prices');
    prices.forEach(price => {
      const inputId = `purchase-price-${price.fuel_type.replace(/\s+/g, '-').toLowerCase()}`;
      const input = document.getElementById(inputId);
      if (input) {
        input.value = price.price;
      }
    });
  } catch (error) {
    console.error('Error loading purchase prices:', error);
  }
}

function isGasFuelType(fuelType) {
  return normalizeFuelTypeForHomeChart(fuelType) === 'غاز سيارات';
}

function normalizeInvoiceFuelProducts(rows) {
  const fallbackFuelTypes = ['بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'سولار'];
  const sourceRows = Array.isArray(rows) && rows.length > 0
    ? rows
    : fallbackFuelTypes.map((fuelType) => ({ fuel_type: fuelType, product_code: '' }));

  const seen = new Set();
  return sourceRows
    .map((row) => {
      const name = String(row?.fuel_type || row?.product_name || '').trim();
      if (!name || isGasFuelType(name)) return null;

      const productCode = String(row?.product_code || '').trim();
      const key = productCode || name;
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        id: row?.id || key,
        product_code: productCode,
        fuel_type: name
      };
    })
    .filter(Boolean);
}

function getFuelInvoiceDateValue() {
  return document.getElementById('fuel-invoice-date')?.value || getTodayDate();
}

async function loadInvoiceFuelProducts(forceReload = false) {
  const invoiceDate = getFuelInvoiceDateValue();
  if (invoiceFuelProductsCache && invoiceFuelProductsCacheDate === invoiceDate && !forceReload) {
    return invoiceFuelProductsCache;
  }

  if (invoiceFuelProductsLoadingPromise && invoiceFuelProductsCacheDate === invoiceDate && !forceReload) {
    return invoiceFuelProductsLoadingPromise;
  }

  invoiceFuelProductsLoadingPromise = (async () => {
    try {
      const [products, purchasePricesRaw] = await Promise.all([
        ipcRenderer.invoke('get-fuel-prices'),
        ipcRenderer.invoke('get-purchase-prices-by-date', { date: invoiceDate }).catch((error) => {
          console.warn('Unable to load purchase prices by invoice date:', error);
          return [];
        })
      ]);
      const purchaseByCode = new Map();
      const purchaseByName = new Map();
      (Array.isArray(purchasePricesRaw) ? purchasePricesRaw : []).forEach((item) => {
        const productCode = String(item?.product_code || '').trim();
        const fuelType = String(item?.fuel_type || '').trim();
        if (productCode) purchaseByCode.set(productCode, item);
        if (fuelType) purchaseByName.set(fuelType, item);
      });

      invoiceFuelProductsCache = normalizeInvoiceFuelProducts(products).map((product) => {
        const purchase = purchaseByCode.get(product.product_code) || purchaseByName.get(product.fuel_type) || {};
        const purchasePrice = parseFloat(purchase.price);
        return {
          ...product,
          purchase_price: Number.isFinite(purchasePrice) && purchasePrice > 0 ? purchasePrice : null
        };
      });
      invoiceFuelProductsCacheDate = invoiceDate;
    } catch (error) {
      console.error('Error loading fuel products for invoice:', error);
      invoiceFuelProductsCache = normalizeInvoiceFuelProducts([]);
      invoiceFuelProductsCacheDate = invoiceDate;
      showMessage?.('تعذر تحميل قائمة الوقود من قاعدة البيانات، سيتم استخدام القائمة الاحتياطية', 'warning');
    } finally {
      invoiceFuelProductsLoadingPromise = null;
    }

    return invoiceFuelProductsCache;
  })();

  return invoiceFuelProductsLoadingPromise;
}

function createFuelInvoiceRow(product) {
  const item = document.createElement('div');
  item.className = 'fuel-item';
  item.dataset.fuel = product.fuel_type;
  item.dataset.fuelCode = product.product_code || '';

  const row = document.createElement('div');
  row.className = 'fuel-row';

  const name = document.createElement('div');
  name.className = 'fuel-name';
  name.textContent = product.fuel_type;

  const quantityGroup = document.createElement('div');
  quantityGroup.className = 'fuel-input-group';
  const quantityInput = document.createElement('input');
  quantityInput.type = 'text';
  quantityInput.className = 'fuel-quantity';
  quantityInput.placeholder = 'الكمية';
  quantityGroup.appendChild(quantityInput);

  if (String(product.fuel_type || '').includes('بنزين')) {
    const netQuantity = document.createElement('div');
    netQuantity.className = 'net-quantity';
    netQuantity.dataset.fuel = product.fuel_type;
    netQuantity.append('الكمية الصافية: ');
    const span = document.createElement('span');
    span.textContent = '0';
    netQuantity.appendChild(span);
    netQuantity.append(' لتر');
    quantityGroup.appendChild(netQuantity);
  }

  const purchaseGroup = document.createElement('div');
  purchaseGroup.className = 'fuel-input-group';
  const purchaseInput = document.createElement('input');
  purchaseInput.type = 'text';
  purchaseInput.className = 'fuel-purchase-price';
  purchaseInput.placeholder = 'سعر الشراء';
  if (Number.isFinite(product.purchase_price) && product.purchase_price > 0) {
    purchaseInput.value = formatPrice(product.purchase_price);
  }
  purchaseGroup.appendChild(purchaseInput);

  const totalGroup = document.createElement('div');
  totalGroup.className = 'fuel-input-group';
  const totalInput = document.createElement('input');
  totalInput.type = 'text';
  totalInput.className = 'fuel-total';
  totalInput.readOnly = true;
  totalInput.placeholder = 'الإجمالي';
  totalGroup.appendChild(totalInput);

  row.appendChild(name);
  row.appendChild(quantityGroup);
  row.appendChild(purchaseGroup);
  row.appendChild(totalGroup);
  item.appendChild(row);

  return item;
}

async function refreshFuelInvoicePurchasePricesForDate() {
  const fuelItemsList = document.getElementById('fuel-items-list');
  if (!fuelItemsList) return;

  const products = await loadInvoiceFuelProducts(true);
  const purchaseByCode = new Map();
  const purchaseByName = new Map();
  products.forEach((product) => {
    if (product.product_code) purchaseByCode.set(product.product_code, product);
    if (product.fuel_type) purchaseByName.set(product.fuel_type, product);
  });

  fuelItemsList.querySelectorAll('.fuel-item').forEach((item) => {
    const product = purchaseByCode.get(item.dataset.fuelCode || '') || purchaseByName.get(item.dataset.fuel || '');
    const purchaseInput = item.querySelector('.fuel-purchase-price');
    if (!purchaseInput) return;

    if (Number.isFinite(product?.purchase_price) && product.purchase_price > 0) {
      purchaseInput.value = formatPrice(product.purchase_price);
    } else {
      purchaseInput.value = '';
    }
    calculateFuelItem.call(purchaseInput);
  });
}

async function renderFuelInvoiceItems(forceReload = false) {
  const fuelItemsList = document.getElementById('fuel-items-list');
  if (!fuelItemsList) return;

  const products = await loadInvoiceFuelProducts(forceReload);
  fuelItemsList.innerHTML = '';

  if (products.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.style.textAlign = 'center';
    emptyMessage.style.color = '#666';
    emptyMessage.style.padding = '1rem';
    emptyMessage.textContent = 'لا توجد منتجات وقود متاحة للفواتير';
    fuelItemsList.appendChild(emptyMessage);
    calculateInvoiceSummary();
    return;
  }

  products.forEach((product) => {
    fuelItemsList.appendChild(createFuelInvoiceRow(product));
  });

  setupFuelCalculationListeners();
  calculateInvoiceSummary();
}



function setFuelInvoiceEditMode(invoice = null) {
  fuelInvoiceEditState = invoice
    ? { original_invoice_number: invoice.invoice_number, invoice }
    : null;

  const title = document.getElementById('invoice-screen-title');
  const saveBtn = document.getElementById('fuel-invoice-save-btn');
  const resetBtn = document.getElementById('fuel-invoice-reset-btn');
  const cancelBtn = document.getElementById('fuel-invoice-cancel-edit-btn');
  const oilTab = document.querySelector('#invoice-screen .price-type-tab[data-type="oil"]');

  const isEditing = Boolean(fuelInvoiceEditState);
  if (title) title.textContent = isEditing ? 'تعديل فاتورة وقود' : 'فاتورة جديدة';
  if (saveBtn) saveBtn.textContent = isEditing ? 'حفظ التعديل' : 'حفظ فاتورة الوقود';
  if (resetBtn) resetBtn.textContent = isEditing ? 'استرجاع بيانات الفاتورة' : 'إعادة تعيين';
  if (cancelBtn) cancelBtn.style.display = isEditing ? '' : 'none';
  if (oilTab) {
    oilTab.classList.toggle('disabled', isEditing);
    oilTab.setAttribute('aria-disabled', isEditing ? 'true' : 'false');
  }
}

function getFuelInvoiceInputNumber(value) {
  const parsed = parseAnnualInventoryValue(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureFuelInvoiceItemRow(item) {
  const fuelItemsList = document.getElementById('fuel-items-list');
  if (!fuelItemsList) return null;

  const productCode = String(item?.product_code || '').trim();
  const fuelType = String(item?.fuel_type || '').trim();
  let row = Array.from(fuelItemsList.querySelectorAll('.fuel-item')).find((element) => (
    (productCode && element.dataset.fuelCode === productCode)
    || (!productCode && element.dataset.fuel === fuelType)
    || (fuelType && element.dataset.fuel === fuelType)
  ));

  if (!row && fuelType) {
    row = createFuelInvoiceRow({
      product_code: productCode,
      fuel_type: fuelType,
      purchase_price: parseFloat(item?.purchase_price)
    });
    fuelItemsList.appendChild(row);
    setupFuelCalculationListeners();
  }

  return row;
}

async function populateFuelInvoiceFormForEdit(invoice) {
  const dateInput = document.getElementById('fuel-invoice-date');
  const numberInput = document.getElementById('fuel-invoice-number');
  const actualTotalInput = document.getElementById('actual-invoice-total');

  if (dateInput) dateInput.value = invoice.date || getTodayDate();
  invalidateInvoiceFuelProductsCache();
  await renderFuelInvoiceItems(true);

  if (numberInput) numberInput.value = invoice.invoice_number || '';
  if (actualTotalInput) {
    actualTotalInput.value = invoice.invoice_total > 0
      ? invoice.invoice_total
      : invoice.total || '';
  }

  document.querySelectorAll('#fuel-items-list .fuel-item').forEach((row) => {
    const quantityInput = row.querySelector('.fuel-quantity');
    const purchaseInput = row.querySelector('.fuel-purchase-price');
    const totalInput = row.querySelector('.fuel-total');
    if (quantityInput) quantityInput.value = '';
    if (purchaseInput) purchaseInput.value = '';
    if (totalInput) totalInput.value = '';
    const netQuantityElement = row.querySelector('.net-quantity span');
    if (netQuantityElement) netQuantityElement.textContent = '0';
  });

  (invoice.items || []).forEach((item) => {
    const row = ensureFuelInvoiceItemRow(item);
    if (!row) return;

    const quantityInput = row.querySelector('.fuel-quantity');
    const purchaseInput = row.querySelector('.fuel-purchase-price');
    if (quantityInput) quantityInput.value = parseFloat(item.quantity) || '';
    if (purchaseInput) purchaseInput.value = parseFloat(item.purchase_price) || '';
    calculateFuelItem.call(quantityInput || purchaseInput);
  });

  calculateInvoiceSummary();
}

async function editFuelInvoice(invoiceNumber) {
  const invoice = allInvoices.find(inv => inv.invoice_number === invoiceNumber && inv.type === 'fuel');

  if (!invoice) {
    showMessage('لم يتم العثور على فاتورة الوقود', 'error');
    return;
  }

  setFuelInvoiceEditMode(invoice);
  await showScreen('invoice', 'settings');
  await showInvoiceType('fuel');
  await populateFuelInvoiceFormForEdit(invoice);
  closeInvoiceDetailsModal();
}

function cancelFuelInvoiceEdit() {
  setFuelInvoiceEditMode(null);
  resetFuelInvoiceForm();
}

function collectFuelInvoiceFormData() {
  const actualInvoiceTotalInput = document.getElementById('actual-invoice-total');
  const parsedInvoiceTotal = parseAnnualInventoryValue(actualInvoiceTotalInput?.value || '');

  const invoiceData = {
    date: document.getElementById('fuel-invoice-date').value,
    invoice_number: document.getElementById('fuel-invoice-number').value,
    invoice_total: parsedInvoiceTotal,
    fuel_items: []
  };

  document.querySelectorAll('#fuel-items-list .fuel-item').forEach(item => {
    const fuelType = item.dataset.fuel;
    const fuelCode = item.dataset.fuelCode || '';
    const quantity = getFuelInvoiceInputNumber(item.querySelector('.fuel-quantity')?.value || '');
    const purchasePrice = getFuelInvoiceInputNumber(item.querySelector('.fuel-purchase-price')?.value || '');
    const total = getFuelInvoiceInputNumber(item.querySelector('.fuel-total')?.value || '');

    if (quantity > 0) {
      let netQuantity = quantity;
      if (fuelType.includes('بنزين')) {
        netQuantity = quantity * 0.995;
      }

      invoiceData.fuel_items.push({
        product_code: fuelCode || null,
        fuel_type: fuelType,
        quantity: quantity,
        net_quantity: netQuantity,
        purchase_price: purchasePrice,
        total: total
      });
    }
  });

  if (invoiceData.invoice_total <= 0) {
    invoiceData.invoice_total = invoiceData.fuel_items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  }

  return invoiceData;
}

async function saveFuelInvoice() {
  const invoiceData = collectFuelInvoiceFormData();

  if (invoiceData.fuel_items.length === 0) {
    showMessage('يرجى إدخال بيانات على الأقل لنوع واحد من الوقود', 'error');
    return;
  }

  try {
    if (fuelInvoiceEditState) {
      await ipcRenderer.invoke('update-fuel-invoice', {
        ...invoiceData,
        original_invoice_number: fuelInvoiceEditState.original_invoice_number
      });
      showMessage('تم تعديل فاتورة الوقود بنجاح', 'success');
      setFuelInvoiceEditMode(null);
      resetFuelInvoiceForm();
      showScreen('settings');
      showSettingsSectionWithoutHistory('invoices-list');
      loadTodayStats();
      if (currentScreen === 'home') {
        loadHomeChart();
      }
      return;
    } else {
      await ipcRenderer.invoke('add-fuel-invoice', invoiceData);

      for (const item of invoiceData.fuel_items) {
        await ipcRenderer.invoke('add-fuel-movement', {
          product_code: item.product_code || null,
          fuel_type: item.fuel_type,
          date: invoiceData.date,
          type: 'in',
          quantity: item.quantity,
          invoice_number: invoiceData.invoice_number,
          notes: `Acquisto - Prezzo: ${item.purchase_price} جنيه/لتر - Totale: ${item.total} جنيه`
        });
      }
      showMessage('تم حفظ فاتورة الوقود بنجاح', 'success');
    }

    resetFuelInvoiceForm();
    loadTodayStats();

    // Update home chart if currently on home screen
    if (currentScreen === 'home') {
      loadHomeChart();
    }
  } catch (error) {
    showMessage(fuelInvoiceEditState ? 'حدث خطأ أثناء تعديل فاتورة الوقود' : 'حدث خطأ أثناء حفظ فاتورة الوقود', 'error');
    console.error('Error saving fuel invoice:', error);
  }
}

function resetFuelInvoiceForm() {
  if (fuelInvoiceEditState?.invoice) {
    populateFuelInvoiceFormForEdit(fuelInvoiceEditState.invoice);
    return;
  }

  // Reset all fuel items
  document.querySelectorAll('#fuel-items-list .fuel-item').forEach(item => {
    const quantityInput = item.querySelector('.fuel-quantity');
    const purchaseInput = item.querySelector('.fuel-purchase-price');

    quantityInput.value = '';
    purchaseInput.value = '';
    item.querySelector('.fuel-total').value = '';

    // Restore placeholders
    quantityInput.placeholder = 'الكمية';
    purchaseInput.placeholder = 'سعر الشراء';

    // Reset net quantity display
    const netQuantityElement = item.querySelector('.net-quantity span');
    if (netQuantityElement) {
      netQuantityElement.textContent = '0';
    }
  });

  // Reset date and generate new invoice number
  document.getElementById('fuel-invoice-date').value = new Date().toISOString().split('T')[0];
  generateInvoiceNumber();

  // Reset actual invoice total
  const actualTotalInput = document.getElementById('actual-invoice-total');
  if (actualTotalInput) {
    actualTotalInput.value = '';
  }

  // Reset summary
  calculateInvoiceSummary();
}

async function updatePurchasePrice(fuelType) {
  const inputId = `purchase-price-${fuelType.replace(/\s+/g, '-').toLowerCase()}`;
  const price = parseFloat(document.getElementById(inputId).value.replace(',', '.'));

  if (isNaN(price) || price <= 0) {
    showMessage('يرجى إدخال سعر صحيح', 'error');
    return;
  }

  try {
    await ipcRenderer.invoke('update-purchase-price', { fuel_type: fuelType, price });
    showMessage('تم تحديث سعر الشراء بنجاح', 'success');
  } catch (error) {
    showMessage('حدث خطأ أثناء تحديث سعر الشراء', 'error');
    console.error('Error updating purchase price:', error);
  }
}

async function loadCharts() {
  if (!isOnline) {
    showMessage('الرسوم البيانية غير متاحة دون اتصال بالإنترنت', 'warning');
    return;
  }
  try {
    const summary = await ipcRenderer.invoke('get-sales-summary');
    const sales = await ipcRenderer.invoke('get-sales');

    createFuelSalesChart(summary);
    createMonthlyRevenueChart(sales);
    createPaymentMethodsChart(sales);
  } catch (error) {
    console.error('Error loading charts:', error);
  }
}

function createFuelSalesChart(summary) {
  const ctx = document.getElementById('fuel-sales-chart').getContext('2d');
  const ChartCtor = getChartConstructor();
  if (!ChartCtor) {
    clearChartCanvas('fuel-sales-chart');
    return;
  }

  if (charts.fuelSales) {
    charts.fuelSales.destroy();
  }

  charts.fuelSales = new ChartCtor(ctx, {
    type: 'doughnut',
    data: {
      labels: summary.map(item => item.fuel_type),
      datasets: [{
        data: summary.map(item => item.total_quantity),
        backgroundColor: [
          '#FF6384',
          '#36A2EB',
          '#FFCE56',
          '#4BC0C0'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        }
      }
    }
  });
}

function createMonthlyRevenueChart(sales) {
  const ctx = document.getElementById('monthly-revenue-chart').getContext('2d');
  const ChartCtor = getChartConstructor();
  if (!ChartCtor) {
    clearChartCanvas('monthly-revenue-chart');
    return;
  }

  if (charts.monthlyRevenue) {
    charts.monthlyRevenue.destroy();
  }

  // Group sales by month
  const monthlyData = {};
  sales.forEach(sale => {
    const month = sale.date.substring(0, 7); // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = 0;
    }
    monthlyData[month] += sale.total_amount;
  });

  const months = Object.keys(monthlyData).sort();
  const revenues = months.map(month => monthlyData[month]);

  charts.monthlyRevenue = new ChartCtor(ctx, {
    type: 'line',
    data: {
      labels: months.map(month => {
        const [year, monthNum] = month.split('-');
        const monthNames = [
          'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
          'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
        ];
        return `${monthNames[parseInt(monthNum) - 1]} ${year}`;
      }),
      datasets: [{
        label: 'المصروفات الشهرية',
        data: revenues,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        },
        x: {
          ticks: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        }
      }
    }
  });
}

function createPaymentMethodsChart(sales) {
  const ctx = document.getElementById('payment-methods-chart').getContext('2d');
  const ChartCtor = getChartConstructor();
  if (!ChartCtor) {
    clearChartCanvas('payment-methods-chart');
    return;
  }

  if (charts.paymentMethods) {
    charts.paymentMethods.destroy();
  }

  // Count payment methods
  const paymentCounts = {};
  sales.forEach(sale => {
    paymentCounts[sale.payment_method] = (paymentCounts[sale.payment_method] || 0) + 1;
  });

  charts.paymentMethods = new ChartCtor(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(paymentCounts),
      datasets: [{
        label: 'عدد فواتير الشراء',
        data: Object.values(paymentCounts),
        backgroundColor: [
          '#FF6384',
          '#36A2EB',
          '#FFCE56'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        },
        x: {
          ticks: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        }
      }
    }
  });
}

function createMonthlyFuelSalesChart(entries, mode = HOME_CHART_MODE.PURCHASES) {
  const ctx = document.getElementById('monthly-fuel-sales-chart').getContext('2d');
  const ChartCtor = getChartConstructor();
  if (!ChartCtor) {
    clearChartCanvas('monthly-fuel-sales-chart');
    return;
  }

  if (charts.monthlyFuelSales) {
    charts.monthlyFuelSales.destroy();
  }

  const chartTitle = mode === HOME_CHART_MODE.SALES
    ? 'كميات المبيعات الشهرية حسب نوع الوقود'
    : 'كميات المشتريات الشهرية حسب نوع الوقود';

  // Group entries by month and fuel type
  const monthlyData = {};
  const salesDaysByMonth = {};
  const fuelTypes = ['بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'سولار', 'غاز سيارات'];
  const colors = [
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

  // Initialize data structure
  entries.forEach(entry => {
    if (!entry || !entry.date || !entry.fuel_type) return;

    const month = entry.date.substring(0, 7); // YYYY-MM
    const normalizedFuelType = normalizeFuelTypeForHomeChart(entry.fuel_type);
    if (!normalizedFuelType) return;

    if (!monthlyData[month]) {
      monthlyData[month] = {};
      salesDaysByMonth[month] = new Set();
      fuelTypes.forEach(type => {
        monthlyData[month][type] = 0;
      });
    }

    const quantity = parseFloat(entry.quantity) || 0;
    if (mode === HOME_CHART_MODE.SALES && quantity > 0) {
      salesDaysByMonth[month].add(entry.date.substring(0, 10));
    }

    if (Object.prototype.hasOwnProperty.call(monthlyData[month], normalizedFuelType)) {
      monthlyData[month][normalizedFuelType] += quantity;
    }
  });

  // Sort months
  const months = Object.keys(monthlyData).sort();
  const currentMonthKey = getMonthKey();
  const forecastMonthIndex = mode === HOME_CHART_MODE.SALES ? months.indexOf(currentMonthKey) : -1;

  if (forecastMonthIndex !== -1) {
    const registeredDays = salesDaysByMonth[currentMonthKey]?.size || 0;
    fuelTypes.forEach(type => {
      monthlyData[currentMonthKey][type] = getCurrentMonthForecastValue(
        monthlyData[currentMonthKey][type] || 0,
        currentMonthKey,
        registeredDays
      );
    });
  }
  
  // Create datasets for each fuel type
  const datasets = fuelTypes.map((fuelType, index) => ({
    label: fuelType,
    data: months.map(month => monthlyData[month][fuelType] || 0),
    backgroundColor: colors[index % colors.length],
    borderColor: colors[index % colors.length],
    borderWidth: 2,
    segment: forecastMonthIndex !== -1 ? {
      borderDash: (context) => (
        context.p1DataIndex === forecastMonthIndex ? HOME_CHART_FORECAST_DASH : undefined
      )
    } : undefined,
    fill: false
  }));

  charts.monthlyFuelSales = new ChartCtor(ctx, {
    type: 'line',
    data: {
      labels: months.map(month => {
        const [year, monthNum] = month.split('-');
        const monthNames = [
          'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
          'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
        ];
        return `${monthNames[parseInt(monthNum) - 1]} ${year}`;
      }),
      datasets: datasets
    },
    options: {
      rtl: true, // Enable RTL support for charts
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        },
        title: {
          display: true,
          text: chartTitle,
          font: {
            family: 'Noto Naskh Arabic',
            size: 16
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'الكمية (لتر)',
            font: {
              family: 'Noto Naskh Arabic'
            }
          },
          ticks: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        },
        x: {
          title: {
            display: true,
            text: 'الشهر',
            font: {
              family: 'Noto Naskh Arabic'
            }
          },
          ticks: {
            font: {
              family: 'Noto Naskh Arabic'
            }
          }
        }
      }
    }
  });
}

async function generateReport() {
  if (!isOnline) {
    showMessage('التقارير غير متاحة دون اتصال بالإنترنت', 'warning');
    return;
  }
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  if (!startDate || !endDate) {
    showMessage('يرجى تحديد فترة تقرير المشتريات', 'error');
    return;
  }

  try {
    const sales = await ipcRenderer.invoke('get-sales-report', { startDate, endDate });
    displayReport(sales);
  } catch (error) {
    showMessage('حدث خطأ أثناء إنشاء تقرير المشتريات', 'error');
    console.error('Error generating report:', error);
  }
}

function displayReport(sales) {
  // Summary
  const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
  const totalRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalTransactions = sales.length;

  const summaryHTML = `
        <div class="report-summary-grid">
            <div class="summary-item">
                <strong>إجمالي الكمية:</strong> ${formatArabicNumber(totalQuantity)} لتر
            </div>
            <div class="summary-item">
                <strong>إجمالي المصروفات:</strong> ${formatArabicCurrency(totalRevenue)}
            </div>
            <div class="summary-item">
                <strong>عدد فواتير الشراء:</strong> ${formatArabicNumber(totalTransactions)}
            </div>
        </div>
    `;

  document.getElementById('report-summary-data').innerHTML = summaryHTML;

  // Details table
  if (sales.length > 0) {
    const tableHTML = `
            <table>
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>نوع الوقود</th>
                        <th>الكمية</th>
                        <th>سعر اللتر</th>
                        <th>إجمالي الفاتورة</th>
                        <th>طريقة الدفع</th>
                        <th>اسم العميل</th>
                    </tr>
                </thead>
                <tbody>
                    ${sales.map(sale => `
                        <tr>
                            <td>${formatArabicDate(sale.date)}</td>
                            <td>${sale.fuel_type}</td>
                            <td>${formatArabicNumber(sale.quantity)} لتر</td>
                            <td>${formatArabicCurrency(sale.price_per_liter)}</td>
                            <td>${formatArabicCurrency(sale.total_amount)}</td>
                            <td>${sale.payment_method}</td>
                            <td>${sale.customer_name || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    document.getElementById('report-details-table').innerHTML = tableHTML;
  } else {
    document.getElementById('report-details-table').innerHTML = '<p>لا توجد مشتريات في الفترة المحددة</p>';
  }
}

async function exportToPDF() {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  if (!startDate || !endDate) {
    showMessage('يرجى تحديد فترة تقرير المشتريات أولاً', 'error');
    return;
  }

  try {
    const sales = await ipcRenderer.invoke('get-sales-report', { startDate, endDate });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Add title
    doc.setFontSize(20);
    doc.text('تقرير المشتريات', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`من ${formatArabicDate(startDate)} إلى ${formatArabicDate(endDate)}`, 105, 30, { align: 'center' });

    // Add summary
    const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
    const totalTransactions = sales.length;

    doc.setFontSize(14);
    doc.text('ملخص التقرير:', 20, 50);
    doc.setFontSize(12);
    doc.text(`إجمالي الكمية: ${formatArabicNumber(totalQuantity)} لتر`, 20, 60);
    doc.text(`إجمالي المصروفات: ${formatArabicCurrency(totalRevenue)}`, 20, 70);
    doc.text(`عدد فواتير الشراء: ${formatArabicNumber(totalTransactions)}`, 20, 80);

    // Add sales table
    if (sales.length > 0) {
      doc.setFontSize(14);
      doc.text('تفاصيل المشتريات:', 20, 100);

      let y = 110;
      sales.forEach((sale, index) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(10);
        doc.text(`${index + 1}. ${formatArabicDate(sale.date)} - ${sale.fuel_type} - ${formatArabicNumber(sale.quantity)} لتر - ${formatArabicCurrency(sale.total_amount)}`, 20, y);
        y += 10;
      });
    }

    // Save the PDF
    const fileName = `تقرير_المشتريات_${formatArabicDate(startDate).replace(/\s+/g, '_')}_${formatArabicDate(endDate).replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);

    showMessage('تم تصدير تقرير المشتريات بنجاح', 'success');
  } catch (error) {
    showMessage('حدث خطأ أثناء تصدير تقرير المشتريات', 'error');
    console.error('Error exporting PDF:', error);
  }
}

// Format numbers in Arabic locale with Arabic numerals
// Format number with decimals only if needed
// Format number with Arabic numerals (default: no decimals unless needed)
function formatArabicNumber(number) {
  const hasDecimals = number % 1 !== 0;
  const formatted = new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
    useGrouping: false
  }).format(number);
  return convertToArabicNumerals(formatted);
}

// Format number with forced 2 decimals (use only when explicitly requested)
function formatArabicNumberFixed(number) {
  const formatted = new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false
  }).format(number);
  return convertToArabicNumerals(formatted);
}

function formatArabicNumberWhole(number) {
  const formatted = new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: false
  }).format(number);
  return convertToArabicNumerals(formatted);
}

// Format currency with Arabic numerals (default: no decimals unless needed)
function formatArabicCurrency(amount) {
  const hasDecimals = amount % 1 !== 0;
  const formatted = new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
    useGrouping: false
  }).format(amount);
  return convertToArabicNumerals(formatted);
}

function getStoredDecimalPlaces(value) {
  const normalized = convertFromArabicNumerals(String(value ?? ''))
    .trim()
    .replace(/[٫،,]/g, '.');
  const match = normalized.match(/^-?\d+\.(\d+)/);
  return match ? Math.min(match[1].length, 12) : 0;
}

function formatArabicCurrencyPreserveDecimals(amount) {
  const numericAmount = parseFloat(amount);
  if (!Number.isFinite(numericAmount)) return '-';

  const decimalPlaces = getStoredDecimalPlaces(amount);
  const formatted = new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
    useGrouping: false
  }).format(numericAmount);
  return convertToArabicNumerals(formatted);
}

// Format currency with forced 2 decimals (use only when explicitly requested)
function formatArabicCurrencyFixed(amount) {
  const formatted = new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false
  }).format(amount);
  return convertToArabicNumerals(formatted);
}

function formatArabicCurrencyWhole(amount) {
  const formatted = new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: false
  }).format(amount);
  return convertToArabicNumerals(formatted);
}

// Format date in Arabic locale
function formatArabicDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

// Format date as d/m/yyyy (without leading zeros)
function formatDateDDMMYYYY(dateString) {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return `${convertToArabicNumerals(day)}/${convertToArabicNumerals(month)}/${convertToArabicNumerals(year)}`;
}

// Convert Western numerals to Arabic numerals
function convertToArabicNumerals(number) {
  const westernToArabic = {
    '0': '٠',
    '1': '١',
    '2': '٢',
    '3': '٣',
    '4': '٤',
    '5': '٥',
    '6': '٦',
    '7': '٧',
    '8': '٨',
    '9': '٩'
  };

  return String(number).replace(/[0-9]/g, digit => westernToArabic[digit]);
}

function convertFromArabicNumerals(str) {
  const arabicToWestern = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9'
  };

  return String(str).replace(/[٠-٩]/g, digit => arabicToWestern[digit]);
}

// Convert Arabic numerals back to Western numerals
function convertToWesternNumerals(number) {
  const arabicToWestern = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9'
  };
  
  return String(number).replace(/[٠-٩]/g, digit => arabicToWestern[digit]);
}

// Function to apply RTL formatting to all numeric and currency values
function applyRTLFormatting() {
  // Format all currency values
  const currencyElements = document.querySelectorAll('.stat-value, .fuel-total, #fuel-invoice-total');
  currencyElements.forEach(element => {
    if (element.textContent && element.textContent.includes('جنيه')) {
      const numericValue = parseFloat(element.textContent.replace(/[^\d.-]/g, ''));
      if (!isNaN(numericValue)) {
        element.textContent = formatArabicCurrency(numericValue);
      }
    }
  });
  
  // Format all numeric values
  const numericElements = document.querySelectorAll('.stat-value:not([id*="revenue"]):not([id*="total"]):not([id*="profit"])');
  numericElements.forEach(element => {
    const numericValue = parseFloat(element.textContent);
    if (!isNaN(numericValue)) {
      element.textContent = formatArabicNumber(numericValue);
    }
  });
  
  // Apply RTL to all new elements
  if (window.applyRTLToNewElement) {
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      if (!element.hasAttribute('data-rtl-applied')) {
        window.applyRTLToNewElement(element);
        element.setAttribute('data-rtl-applied', 'true');
      }
    });
  }
}

async function showInvoiceType(type) {
  if (fuelInvoiceEditState && type !== 'fuel') {
    showMessage('أكمل تعديل فاتورة الوقود أو ألغِ التعديل أولاً', 'warning');
    return;
  }

  // Update active tab
  document.querySelectorAll('#invoice-screen .price-type-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`#invoice-screen [data-type="${type}"]`).classList.add('active');

  // Show/hide forms
  document.querySelectorAll('.invoice-form').forEach(form => {
    form.classList.remove('active');
  });
  
  if (type === 'fuel') {
    document.getElementById('fuel-invoice-form').classList.add('active');
    const hasFuelRows = Boolean(document.querySelector('#fuel-items-list .fuel-item'));
    const invoiceDate = getFuelInvoiceDateValue();
    if (!hasFuelRows || !invoiceFuelProductsCache || invoiceFuelProductsCacheDate !== invoiceDate) {
      await renderFuelInvoiceItems(!invoiceFuelProductsCache || invoiceFuelProductsCacheDate !== invoiceDate);
    }
  } else if (type === 'oil') {
    document.getElementById('oil-invoice-form').classList.add('active');
    const products = await loadInvoiceOilProducts(true);
    refreshOilInvoiceProductSelects(products);
  }

  // Reset scroll position to top of the invoice screen
  const invoiceScreen = document.getElementById('invoice-screen');
  if (invoiceScreen) {
    invoiceScreen.scrollTop = 0;
  }
}

function generateInvoiceNumber() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  
  // Generate a random 3-digit number
  const randomNum = Math.floor(Math.random() * 900) + 100;
  
  const invoiceNumber = `INV-${day}${month}${year}-${randomNum}`;
  document.getElementById('fuel-invoice-number').value = invoiceNumber;
}


function handleInputFocus() {
  // Clear placeholder when input is focused
  this.setAttribute('data-placeholder', this.placeholder);
  this.placeholder = '';
}

function handleInputBlur() {
  // Restore placeholder if input is empty
  if (this.value === '') {
    this.placeholder = this.getAttribute('data-placeholder');
  }
}

function calculateFuelItem() {
  const fuelItem = this.closest('.fuel-item');
  if (!fuelItem) return;

  const fuelType = fuelItem.dataset.fuel;
  const quantityInput = fuelItem.querySelector('.fuel-quantity');
  const purchasePriceInput = fuelItem.querySelector('.fuel-purchase-price');
  const totalInput = fuelItem.querySelector('.fuel-total');

  if (!quantityInput || !purchasePriceInput || !totalInput) return;

  // Replace comma with dot for decimal parsing
  const quantity = parseFloat(quantityInput.value.replace(',', '.')) || 0;
  const purchasePrice = parseFloat(purchasePriceInput.value.replace(',', '.')) || 0;

  // Calculate net quantity for gasoline (0.995 factor for evaporation)
  let netQuantity = quantity;
  if (fuelType && fuelType.includes('بنزين')) {
    netQuantity = quantity * 0.995;
    // Update net quantity display
    const netQuantityElement = fuelItem.querySelector('.net-quantity span');
    if (netQuantityElement) {
      netQuantityElement.textContent = formatArabicNumber(netQuantity);
    }
  }

  const total = netQuantity * purchasePrice;

  totalInput.value = total > 0 ? formatArabicNumber(total) : '';

  calculateInvoiceSummary();
}

function calculateInvoiceSummary() {
  // Calculate cash deposit whenever fuel totals change
  calculateCashDeposit();
}

function calculateCashDeposit() {
  const actualTotalInput = document.getElementById('actual-invoice-total');
  const cashDepositElement = document.getElementById('cash-deposit');

  if (!actualTotalInput || !cashDepositElement) return;

  // Calculate fuel subtotal
  let fuelSubtotal = 0;
  document.querySelectorAll('.fuel-item').forEach(item => {
    const totalInput = item.querySelector('.fuel-total');
    if (totalInput && totalInput.value) {
      // Get the raw value without any formatting
      let rawValue = totalInput.value.trim();

      // Remove all non-numeric characters except dots, comma, Arabic numerals and Arabic decimal separator
      rawValue = rawValue.replace(/[^\d.٠-٩,٫\-]/g, '');

      // Convert Arabic decimal separator ٫ to western dot
      rawValue = rawValue.replace(/٫/g, '.');

      // Convert Arabic numerals to Western
      rawValue = convertToWesternNumerals(rawValue);

      // Replace comma with dot for decimal parsing
      rawValue = rawValue.replace(',', '.');

      const total = parseFloat(rawValue) || 0;
      fuelSubtotal += total;

      console.log('Fuel item:', totalInput.value, '-> cleaned:', rawValue, '-> parsed:', total);
    }
  });

  const actualTotal = parseFloat(actualTotalInput.value.replace(',', '.')) || 0;
  const cashDeposit = actualTotal - fuelSubtotal;

  console.log('===================');
  console.log('Fuel Subtotal:', fuelSubtotal);
  console.log('Actual Total:', actualTotal);
  console.log('Cash Deposit:', cashDeposit);
  console.log('===================');

  // Format in Arabic numerals
  if (cashDeposit === 0) {
    cashDepositElement.textContent = '٠٫٠٠ جنيه';
  } else {
    cashDepositElement.textContent = formatArabicCurrency(cashDeposit);
  }
}

function calculateOilItem() {
  const oilItem = this.closest('.oil-item');
  if (!oilItem) return;
  
  const oilType = oilItem.dataset.oil;
  const quantityInput = oilItem.querySelector('.oil-quantity');
  const purchasePriceInput = oilItem.querySelector('.oil-purchase-price');
  const ivaInput = oilItem.querySelector('.oil-iva');
  const totalPurchaseInput = oilItem.querySelector('.oil-total-purchase');
  
  if (!quantityInput || !purchasePriceInput || !ivaInput || !totalPurchaseInput) return;
  
  const quantity = parseFloat(quantityInput.value.replace(',', '.')) || 0;
  const purchasePrice = parseFloat(purchasePriceInput.value.replace(',', '.')) || 0;
  const iva = parseFloat(ivaInput.value.replace(',', '.')) || 0;
  
  const subtotal = quantity * purchasePrice;
  // Se l'IVA è inserita come percentuale (es. 14 per 14%), dividiamo per 100
  const ivaAmount = subtotal * (iva / 100);
  const totalPurchase = subtotal + ivaAmount;
  
  totalPurchaseInput.value = totalPurchase > 0 ? formatArabicNumber(totalPurchase) : '';
  totalPurchaseInput.dataset.numericValue = totalPurchase; // Salva il valore numerico originale
  
  calculateOilInvoiceSummary();
}

function calculateOilInvoiceSummary() {
  let subtotal = 0;

  document.querySelectorAll('.oil-item').forEach((item, index) => {
    const totalInput = item.querySelector('.oil-total-purchase');

    if (totalInput && totalInput.dataset.numericValue) {
      // Usa il valore numerico salvato invece di convertire i numeri arabi
      const total = parseFloat(totalInput.dataset.numericValue) || 0;
      subtotal += total;
    }
  });

  // Get discount and tax values (default to 0 if empty or not initialized)
  const discountInput = document.getElementById('immediate-discount');
  const taxInput = document.getElementById('martyrs-tax');

  const discount = discountInput ? (parseFloat(discountInput.value.replace(',', '.')) || 0) : 0;
  const tax = taxInput ? (parseFloat(taxInput.value.replace(',', '.')) || 0) : 0;

  // Calculate final total: subtotal - discount + tax
  const finalTotal = subtotal - discount + tax;

  const totalElement = document.getElementById('oil-invoice-total');
  if (totalElement) {
    totalElement.textContent = formatArabicNumber(finalTotal) + ' جنيه';
  }
}

function handleHeaderScroll() {
  const header = document.querySelector('.header');
  const appTitle = document.querySelector('.app-title');
  const breadcrumbNav = document.querySelector('.breadcrumb-nav');
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  // Define scroll range for header resize (0 to 100px of scroll)
  const maxScroll = 100;
  const scrollProgress = Math.min(scrollTop / maxScroll, 1); // 0 to 1

  // Calculate padding (from 2rem to 1rem)
  const minPadding = 1; // rem
  const maxPadding = 2; // rem
  const currentPadding = maxPadding - (scrollProgress * (maxPadding - minPadding));

  // Calculate font size (from 2.5rem to 1.8rem)
  const minFontSize = 1.8; // rem
  const maxFontSize = 2.5; // rem
  const currentFontSize = maxFontSize - (scrollProgress * (maxFontSize - minFontSize));

  // Calculate title margin bottom (from 1rem to 0.5rem)
  const minMargin = 0.5; // rem
  const maxMargin = 1; // rem
  const currentMargin = maxMargin - (scrollProgress * (maxMargin - minMargin));

  // Apply styles to header and title
  header.style.padding = `${currentPadding}rem`;
  header.style.paddingBottom = '0';
  appTitle.style.fontSize = `${currentFontSize}rem`;
  appTitle.style.marginBottom = `${currentMargin}rem`;

  // Adjust breadcrumb margins to compensate for header padding
  if (breadcrumbNav) {
    const breadcrumbMargin = currentPadding * 16; // Convert rem to px (assuming 16px = 1rem)
    breadcrumbNav.style.marginLeft = `-${breadcrumbMargin}px`;
    breadcrumbNav.style.marginRight = `-${breadcrumbMargin}px`;
    breadcrumbNav.style.width = `calc(100% + ${breadcrumbMargin * 2}px)`;
  }

  // Update settings sidebar padding-top to match actual header height
  const settingsSidebar = document.querySelector('.settings-sidebar');
  if (settingsSidebar) {
    const headerHeight = header.offsetHeight;
    settingsSidebar.style.paddingTop = `${headerHeight}px`;
  }

  // Add/remove scrolled class for other CSS rules
  if (scrollTop > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
}

function showMessage(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Create toast notification
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  toast.innerHTML = `
    <div class="toast-message">${message}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  // Add to container
  container.appendChild(toast);

  // Trigger animation with gentle delay
  setTimeout(() => {
    toast.classList.add('show');
  }, 50);

  // Auto-remove after 6 seconds with smooth fade out
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 600); // Longer fade out duration
  }, 6000); // Stays visible for 6 seconds
}

// Depot Management Functions
const DEPOT_VISIBLE_OILS_FILTER_KEY = 'depot-visible-oils-filter';
let depotAllOilTypes = [];
let depotVisibleOilTypes = [];

function showDepotScreen() {
  showScreen('depot', 'home');
}

function getStoredDepotVisibleOilFilter() {
  try {
    const rawValue = localStorage.getItem(DEPOT_VISIBLE_OILS_FILTER_KEY);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(oilType => String(oilType || '').trim()).filter(Boolean);
  } catch (error) {
    console.error('Error reading depot oil filter:', error);
    return null;
  }
}

function getFilteredDepotOilTypes(allOilTypes) {
  const storedFilter = getStoredDepotVisibleOilFilter();
  if (!storedFilter) return allOilTypes;
  const visibleSet = new Set(storedFilter);
  return allOilTypes.filter(oilType => visibleSet.has(oilType));
}

async function loadDepotOils(preferredOilType = '') {
  const list = document.getElementById('depot-oil-list');
  const mobileList = document.getElementById('depot-oil-list-modal');

  if (!list || !mobileList) return;

  list.innerHTML = '<div class="empty-movements">جاري تحميل المنتجات...</div>';
  mobileList.innerHTML = '<div class="empty-movements">جاري تحميل المنتجات...</div>';

  try {
    const oils = await ipcRenderer.invoke('get-oil-prices');
    const sortedOils = sortOilsByOrder(Array.isArray(oils) ? oils : [], []);
    depotAllOilTypes = sortedOils.map(row => String(row.oil_type || '').trim()).filter(Boolean);
    depotVisibleOilTypes = getFilteredDepotOilTypes(depotAllOilTypes);

    renderDepotOilLists(depotVisibleOilTypes);

    if (depotVisibleOilTypes.length === 0) {
      selectOilType('');
      return;
    }

    const currentSelected = preferredOilType
      || document.querySelector('.oil-item.selected')?.dataset?.oil
      || '';
    const nextSelection = depotVisibleOilTypes.includes(currentSelected)
      ? currentSelected
      : depotVisibleOilTypes[0];
    selectOilType(nextSelection);
  } catch (error) {
    console.error('Error loading depot oils:', error);
    list.innerHTML = '<div class="empty-movements error">حدث خطأ أثناء تحميل منتجات المخزن</div>';
    mobileList.innerHTML = '<div class="empty-movements error">حدث خطأ أثناء تحميل منتجات المخزن</div>';
    showMessage('حدث خطأ أثناء تحميل منتجات المخزن', 'error');
  }
}

function renderDepotOilLists(oilTypes) {
  const list = document.getElementById('depot-oil-list');
  const mobileList = document.getElementById('depot-oil-list-modal');
  if (!list || !mobileList) return;

  if (!oilTypes.length) {
    const emptyHtml = '<div class="empty-movements">لا توجد زيوت ظاهرة. افتح التصفية لاختيار الزيوت.</div>';
    list.innerHTML = emptyHtml;
    mobileList.innerHTML = emptyHtml;
    return;
  }

  list.innerHTML = oilTypes.map(oilType => `
    <div class="oil-item" data-oil="${escapeHtml(oilType)}">${escapeHtml(oilType)}</div>
  `).join('');

  mobileList.innerHTML = oilTypes.map(oilType => `
    <div class="oil-item-modal" data-oil="${escapeHtml(oilType)}">${escapeHtml(oilType)}</div>
  `).join('');

  list.querySelectorAll('.oil-item').forEach(item => {
    item.addEventListener('click', () => selectOilType(item.dataset.oil));
  });

  mobileList.querySelectorAll('.oil-item-modal').forEach(item => {
    item.addEventListener('click', () => {
      selectOilType(item.dataset.oil);
      closeProductsModal();
    });
  });
}

async function openAddDepotOilModal() {
  const modal = document.getElementById('add-depot-oil-modal');
  const list = document.getElementById('add-depot-oil-select');
  const message = document.getElementById('add-depot-oil-message');

  if (!modal || !list) return;

  if (message) message.textContent = '';
  list.innerHTML = '<div class="stock-audit-empty">جاري تحميل الزيوت...</div>';
  modal.classList.add('show');

  try {
    if (!depotAllOilTypes.length) {
      const oils = await ipcRenderer.invoke('get-oil-prices');
      depotAllOilTypes = sortOilsByOrder(Array.isArray(oils) ? oils : [], [])
        .map(oil => String(oil.oil_type || '').trim())
        .filter(Boolean);
    }

    const storedFilter = getStoredDepotVisibleOilFilter();
    const visibleSet = new Set(storedFilter || depotAllOilTypes);
    list.innerHTML = depotAllOilTypes.map(oilType => `
      <label class="depot-filter-item">
        <input type="checkbox" class="depot-filter-checkbox" value="${escapeHtml(oilType)}" ${visibleSet.has(oilType) ? 'checked' : ''}>
        <span>${escapeHtml(oilType)}</span>
      </label>
    `).join('');
  } catch (error) {
    console.error('Error loading oils for depot add modal:', error);
    list.innerHTML = '<div class="stock-audit-empty error">تعذر تحميل الزيوت</div>';
    if (message) message.textContent = 'حدث خطأ أثناء تحميل الزيوت';
  }
}

function closeAddDepotOilModal() {
  const modal = document.getElementById('add-depot-oil-modal');
  if (modal) modal.classList.remove('show');
}

async function saveDepotVisibleOil() {
  const checkedInputs = Array.from(document.querySelectorAll('#add-depot-oil-select .depot-filter-checkbox:checked'));
  const message = document.getElementById('add-depot-oil-message');

  if (message) message.textContent = '';

  try {
    const selectedOilTypes = checkedInputs.map(input => String(input.value || '').trim()).filter(Boolean);
    localStorage.setItem(DEPOT_VISIBLE_OILS_FILTER_KEY, JSON.stringify(selectedOilTypes));
    closeAddDepotOilModal();
    await loadDepotOils();
    showMessage('تم تطبيق تصفية الزيوت', 'success');
  } catch (error) {
    console.error('Error saving depot oil filter:', error);
    if (message) message.textContent = 'حدث خطأ أثناء حفظ التصفية';
  }
}

function selectAllDepotFilterOils() {
  document.querySelectorAll('#add-depot-oil-select .depot-filter-checkbox').forEach(input => {
    input.checked = true;
  });
}

function clearDepotFilterOils() {
  document.querySelectorAll('#add-depot-oil-select .depot-filter-checkbox').forEach(input => {
    input.checked = false;
  });
}

function renameDepotVisibleOilFilter(oldName, newName) {
  const oldOilName = String(oldName || '').trim();
  const newOilName = String(newName || '').trim();
  if (!oldOilName || !newOilName || oldOilName === newOilName) return;

  const storedFilter = getStoredDepotVisibleOilFilter();
  if (!storedFilter) return;

  let changed = false;
  const nextFilter = storedFilter.map(oilType => {
    if (oilType === oldOilName) {
      changed = true;
      return newOilName;
    }
    return oilType;
  });

  if (changed) {
    localStorage.setItem(DEPOT_VISIBLE_OILS_FILTER_KEY, JSON.stringify(Array.from(new Set(nextFilter))));
  }
}

async function initializeTankManagement() {
  const container = document.getElementById('tank-ledgers-container');
  if (!container) return;

  try {
    container.innerHTML = '<div class="tank-ledger-loading">جاري تحميل بيانات التنكات...</div>';
    const ledgers = await loadTankLedgerData();
    renderTankLedgers(ledgers);
  } catch (error) {
    console.error('Error initializing tank management:', error);
    container.innerHTML = '<div class="tank-ledger-error">حدث خطأ أثناء تحميل بيانات التنكات</div>';
    showMessage('حدث خطأ أثناء تحميل إدارة التنكات', 'error');
  }
}

async function loadTankLedgerData() {
  const fuelTypes = await loadTankFuelTypes();
  const tankFuelTypes = fuelTypes.filter((fuelType) => String(fuelType || '').trim() !== 'غاز سيارات');
  const ledgers = await Promise.all(tankFuelTypes.map(async (fuelType) => {
    const movements = await loadTankFuelMovements(fuelType);
    const balance = movements.reduce((sum, movement) => {
      const quantity = Math.abs(parseFloat(movement.quantity) || 0);
      return sum + (movement.type === 'out' ? -quantity : quantity);
    }, 0);

    return {
      fuel_type: fuelType,
      balance,
      movements: sortTankMovementsNewestFirst(movements)
    };
  }));

  return ledgers;
}

async function loadTankFuelTypes() {
  try {
    const fuelTypes = await ipcRenderer.invoke('get-tank-fuel-types');
    if (Array.isArray(fuelTypes) && fuelTypes.length > 0) {
      return fuelTypes.map((type) => String(type || '').trim()).filter(Boolean);
    }
  } catch (error) {
    if (!String(error?.message || error).includes('No handler registered')) {
      throw error;
    }

    console.warn('get-tank-fuel-types IPC is not available, using renderer fallback:', error);
  }

  return loadTankFuelTypesFallback();
}

async function loadTankFuelTypesFallback() {
  const preferredOrder = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥'];
  const types = new Set(preferredOrder);

  const addFuel = (fuelType) => {
    const name = String(fuelType || '').trim();
    if (name) types.add(name);
  };

  const fuelProducts = await ipcRenderer.invoke('get-fuel-prices').catch(() => []);
  fuelProducts.forEach((row) => addFuel(row.fuel_type || row.product_name));

  const invoices = await ipcRenderer.invoke('get-fuel-invoices').catch(() => []);
  invoices.forEach((row) => addFuel(row.fuel_type));

  const shiftFuelSales = await ipcRenderer.invoke('get-shift-fuel-sales').catch(() => []);
  shiftFuelSales.forEach((row) => addFuel(row.fuel_type));

  return Array.from(types).sort((a, b) => sortTankFuelTypes(a, b, preferredOrder));
}

async function loadTankFuelMovements(fuelType) {
  try {
    const movements = await ipcRenderer.invoke('get-tank-fuel-movements', fuelType);
    return Array.isArray(movements) ? movements : [];
  } catch (error) {
    if (!String(error?.message || error).includes('No handler registered')) {
      throw error;
    }

    console.warn('get-tank-fuel-movements IPC is not available, using renderer fallback:', error);
    return loadTankFuelMovementsFallback(fuelType);
  }
}

async function loadTankFuelMovementsFallback(fuelType) {
  const selectedFuelType = String(fuelType || '').trim();
  if (!selectedFuelType) return [];

  const invoiceRows = await ipcRenderer.invoke('get-fuel-invoices').catch(() => []);
  const invoiceMovements = invoiceRows
    .filter((row) => String(row.fuel_type || '').trim() === selectedFuelType)
    .map((row) => {
      const netQuantity = parseFloat(row.net_quantity) || 0;
      const quantity = netQuantity > 0 ? netQuantity : (parseFloat(row.quantity) || 0);
      return {
        date: String(row.date || '').slice(0, 10),
        type: 'in',
        quantity,
        source: row.invoice_number ? `فاتورة ${row.invoice_number}` : 'فاتورة وقود'
      };
    })
    .filter((movement) => movement.date && movement.quantity > 0);

  const shiftRows = await ipcRenderer.invoke('get-shift-fuel-sales').catch(() => []);
  const shiftMovements = shiftRows
    .filter((row) => String(row.fuel_type || '').trim() === selectedFuelType)
    .map((row) => ({
      date: String(row.date || '').slice(0, 10),
      type: 'out',
      quantity: Math.max(parseFloat(row.quantity) || 0, 0),
      source: 'وردية'
    }))
    .filter((movement) => movement.date && movement.quantity > 0);

  return [...invoiceMovements, ...shiftMovements];
}

function sortTankFuelTypes(a, b, preferredOrder = ['سولار', 'بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥']) {
  const indexA = preferredOrder.indexOf(a);
  const indexB = preferredOrder.indexOf(b);
  if (indexA !== -1 || indexB !== -1) {
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  }
  return String(a || '').localeCompare(String(b || ''), 'ar');
}

function sortTankMovementsNewestFirst(movements) {
  return [...movements].sort((a, b) => {
    const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCompare !== 0) return dateCompare;
    if (a.type !== b.type) return a.type === 'out' ? -1 : 1;
    return String(b.source || '').localeCompare(String(a.source || ''), 'ar');
  });
}

function renderTankLedgers(ledgers) {
  const container = document.getElementById('tank-ledgers-container');
  if (!container) return;

  if (!Array.isArray(ledgers) || ledgers.length === 0) {
    container.innerHTML = '<div class="tank-ledger-empty">لا توجد بيانات للتنكات</div>';
    return;
  }

  container.innerHTML = ledgers.map((ledger) => {
    const fuelType = ledger.fuel_type || '-';
    const balance = parseFloat(ledger.balance) || 0;
    const movements = Array.isArray(ledger.movements) ? ledger.movements : [];
    const rowsHtml = movements.length > 0
      ? movements.map((movement) => renderTankLedgerMovementRow(movement)).join('')
      : '<tr><td colspan="2" class="tank-ledger-empty-row">لا توجد حركات لهذا الوقود</td></tr>';

    return `
      <section class="tank-ledger-section">
        <div class="tank-ledger-header">
          <h4>${escapeHtml(fuelType)}</h4>
          <div class="tank-current-balance ${balance < 0 ? 'negative' : ''}">
            <span>الرصيد الحالي</span>
            <strong>${formatArabicNumber(balance)}</strong>
          </div>
        </div>
        <div class="tank-ledger-table-wrap">
          <table class="base-table tank-ledger-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الحركة</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');
}

function renderTankLedgerMovementRow(movement) {
  const type = movement.type === 'out' ? 'out' : 'in';
  const quantity = Math.abs(parseFloat(movement.quantity) || 0);
  const sign = type === 'out' ? '-' : '+';
  const label = type === 'out' ? '' : 'دخول';
  const source = String(movement.source || '').trim();
  const showSource = type !== 'out' && source;
  const sourceHtml = showSource ? `<span class="tank-ledger-source">- ${escapeHtml(source)}</span>` : '';

  return `
    <tr class="tank-ledger-row ${type === 'out' ? 'row-out' : 'row-in'}">
      <td class="tank-ledger-date">${formatDateDDMMYYYY(movement.date)}</td>
      <td class="tank-ledger-movement">
        ${label ? `<span class="tank-ledger-type ${type === 'out' ? 'out' : 'in'}">${label}</span>` : ''}
        <span class="tank-ledger-quantity ${type === 'out' ? 'out' : 'in'}">${sign}${formatArabicNumber(quantity)}</span>
        ${sourceHtml}
      </td>
    </tr>
  `;
}

function selectOilType(oilType) {
  // Remove selected class from all items (sidebar e modal)
  document.querySelectorAll('.oil-item, .oil-item-modal').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to all items with this oil type (sidebar e modal)
  document.querySelectorAll('.oil-item, .oil-item-modal').forEach(item => {
    if (item.dataset.oil === oilType) {
      item.classList.add('selected');
    }
  });

  // Update breadcrumb with selected oil name
  const breadcrumbProduct = document.getElementById('breadcrumb-product');
  if (oilType) {
    if (breadcrumbProduct) breadcrumbProduct.textContent = oilType;
  } else {
    if (breadcrumbProduct) breadcrumbProduct.textContent = '';
  }

  // Show results section (già visibile con CSS, ma manteniamo per compatibilità)
  const resultsSection = document.getElementById('results-section');
  if (resultsSection) resultsSection.style.display = 'block';

  // Scroll to results section su mobile
  if (resultsSection && window.innerWidth <= 768) {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Load movements for selected oil
  loadOilMovements(oilType);
}

async function loadOilMovements(oilType) {
  if (!oilType) {
    document.getElementById('current-stock-amount').textContent = formatArabicNumber(0);
    document.getElementById('movements-table').innerHTML = '<div class="empty-movements">اختر نوع الزيت لعرض الحركات</div>';
    return;
  }

  try {
    const movements = await ipcRenderer.invoke('get-oil-movements', {
      oilType
    });
    const currentStock = await ipcRenderer.invoke('get-current-oil-stock', {
      oilType
    });

    // Update current stock display with Arabic number formatting
    document.getElementById('current-stock-amount').textContent = formatArabicNumber(currentStock || 0);
    
    // Display movements table
    displayOilMovements(movements);
  } catch (error) {
    console.error('Error loading oil movements:', error);
    showMessage('حدث خطأ أثناء تحميل حركات المخزون', 'error');
  }
}

function displayOilMovements(movements) {
  const container = document.getElementById('movements-table');
  
  if (!movements || movements.length === 0) {
    container.innerHTML = '<div class="empty-movements">لا توجد حركات مخزون لهذا النوع</div>';
    return;
  }

  const movementsWithBalance = calculateOilMovementBalances(movements);
  const tableHTML = `
    <table class="movements-table-modern">
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>نوع الحركة</th>
          <th>الكمية</th>
          <th>الرصيد</th>
          <th>رقم الفاتورة</th>
        </tr>
      </thead>
      <tbody>
        ${movementsWithBalance.map(movement => {
          const movementReference = String(movement.invoice_number || '').trim();
          const isAuditCount = movement.type === 'audit' || movementReference === 'جرد المخزن';
          const isAuditDifference = movementReference === 'فرق جرد';
          const rowClass = isAuditCount ? 'row-audit' : (movement.type === 'in' ? 'row-in' : 'row-out');
          const badgeClass = isAuditCount ? 'badge-audit' : (movement.type === 'in' ? 'badge-in' : 'badge-out');
          const quantityClass = isAuditCount ? 'neutral' : (movement.type === 'in' ? 'positive' : 'negative');
          const movementLabel = isAuditCount ? 'جرد المخزن' : (isAuditDifference ? 'فرق جرد' : (movement.type === 'in' ? 'دخول' : 'خروج'));
          return `
          <tr class="table-row ${rowClass}">
            <td class="date-cell">${formatDateDDMMYYYY(movement.date)}</td>
            <td class="type-cell">
              <span class="type-badge ${badgeClass}">
                ${movementLabel}
              </span>
            </td>
            <td class="quantity-cell">
              <span class="quantity-value ${quantityClass}">
                ${convertToArabicNumerals(movement.quantity)}
              </span>
            </td>
            <td class="quantity-cell">
              <span class="quantity-value neutral">
                ${formatArabicNumber(movement.balance_after || 0)}
              </span>
            </td>
            <td class="invoice-cell">${movement.invoice_number || '-'}</td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = tableHTML;
}

function calculateOilMovementBalances(movements) {
  const chronological = [...movements].sort((a, b) => {
    const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCompare !== 0) return dateCompare;
    const createdCompare = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (createdCompare !== 0) return createdCompare;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  let balance = 0;
  chronological.forEach((movement) => {
    const quantity = parseFloat(movement.quantity) || 0;
    const movementReference = String(movement.invoice_number || '').trim();
    if (movementReference === 'فرق جرد') {
      // Old audit-difference rows are shown for history, but audit rows now set the balance directly.
    } else if (movement.type === 'in') {
      balance += quantity;
    } else if (movement.type === 'out') {
      balance -= quantity;
    } else if (movement.type === 'audit') {
      balance = quantity;
    }
    movement.balance_after = balance;
  });

  const balanceById = new Map(chronological.map((movement, index) => [
    movement.id != null ? `id:${movement.id}` : `idx:${index}`,
    movement.balance_after
  ]));

  return movements.map((movement, index) => ({
    ...movement,
    balance_after: balanceById.get(movement.id != null ? `id:${movement.id}` : `idx:${index}`) ?? movement.balance_after ?? 0
  }));
}

function showAddMovementModal() {
  const selectedOilItem = document.querySelector('.oil-item.selected');
  const oilType = selectedOilItem ? selectedOilItem.dataset.oil : '';
  
  if (!oilType) {
    showMessage('يرجى اختيار نوع الزيت أولاً', 'error');
    return;
  }
  
  document.getElementById('movement-date').value = new Date().toISOString().split('T')[0];
  
  // Clear form
  document.getElementById('movement-type').value = '';
  document.getElementById('movement-quantity').value = '';
  document.getElementById('movement-invoice').value = '';
  
  // Hide invoice field initially
  document.getElementById('invoice-field').style.display = 'none';
  document.getElementById('movement-invoice').removeAttribute('required');
  
  // Show modal
  document.getElementById('movement-modal').classList.add('show');
}

function openMovementModal() {
  showAddMovementModal();
}

function toggleInvoiceField() {
  const movementType = document.getElementById('movement-type').value;
  const invoiceField = document.getElementById('invoice-field');
  const invoiceInput = document.getElementById('movement-invoice');
  
  if (movementType === 'in') {
    invoiceField.style.display = 'block';
    invoiceInput.setAttribute('required', 'required');
  } else {
    invoiceField.style.display = 'none';
    invoiceInput.removeAttribute('required');
    invoiceInput.value = ''; // Clear the value when hiding
  }
}

function resetMovementForm() {
  document.getElementById('movement-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('movement-type').value = 'in';
  document.getElementById('movement-quantity').value = '';
  document.getElementById('movement-invoice').value = '';
}

function closeMovementModal() {
  document.getElementById('movement-modal').classList.remove('show');
}

async function getActiveOilsForStockAudit() {
  if (!depotVisibleOilTypes.length) {
    await loadDepotOils();
  }

  return depotVisibleOilTypes.map((oilType, index) => ({
    oil_type: oilType,
    display_order: index + 1,
    is_active: 1
  }));
}

async function openStockAuditModal() {
  const modal = document.getElementById('stock-audit-modal');
  const dateInput = document.getElementById('stock-audit-date');

  if (!modal || !dateInput) return;

  dateInput.value = new Date().toISOString().split('T')[0];
  dateInput.onchange = loadStockAuditRows;
  modal.classList.add('show');
  await loadStockAuditRows();
}

async function loadStockAuditRows() {
  const dateInput = document.getElementById('stock-audit-date');
  const tableBody = document.getElementById('stock-audit-oils-body');
  const auditDate = dateInput?.value;

  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="3" class="stock-audit-empty">جاري تحميل الزيوت...</td></tr>';

  try {
    const oils = await getActiveOilsForStockAudit();

    if (!oils.length) {
      tableBody.innerHTML = '<tr><td colspan="3" class="stock-audit-empty">لا توجد زيوت نشطة للجرد</td></tr>';
      return;
    }

    const rows = await Promise.all(oils.map(async (oil) => {
      const oilType = String(oil.oil_type || '').trim();
      const expectedStock = await ipcRenderer.invoke('get-current-oil-stock', {
        oilType,
        endDate: auditDate
      }).catch(() => 0);
      return `
        <tr>
          <td class="stock-audit-oil-name">${escapeHtml(oilType)}</td>
          <td class="stock-audit-current">${formatArabicNumber(expectedStock || 0)}</td>
          <td>
            <input type="text" inputmode="decimal" class="stock-audit-quantity"
                   oninput="normalizeStockAuditQuantityInput(this)"
                   data-oil="${escapeHtml(oilType)}" placeholder="0">
          </td>
        </tr>
      `;
    }));

    tableBody.innerHTML = rows.join('');
    bindStockAuditKeyboardNavigation();
  } catch (error) {
    console.error('Error loading stock audit oils:', error);
    tableBody.innerHTML = '<tr><td colspan="3" class="stock-audit-empty error">حدث خطأ أثناء تحميل الزيوت</td></tr>';
  }
}

function bindStockAuditKeyboardNavigation() {
  const inputs = Array.from(document.querySelectorAll('#stock-audit-oils-body .stock-audit-quantity'));
  inputs.forEach((input, index) => {
    input.onkeydown = (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

      const nextIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
      const nextInput = inputs[nextIndex];
      if (!nextInput) return;

      event.preventDefault();
      nextInput.focus();
      nextInput.select();
    };
  });
}

function closeStockAuditModal() {
  const modal = document.getElementById('stock-audit-modal');
  if (modal) modal.classList.remove('show');
}

function parseStockAuditQuantity(value) {
  const normalized = String(value || '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(',', '.')
    .trim();
  return parseFloat(normalized);
}

function normalizeStockAuditQuantityInput(input) {
  if (!input) return;
  const normalized = String(input.value || '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(',', '.')
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*)\./g, '$1');
  if (input.value !== normalized) {
    input.value = normalized;
  }
}

async function saveStockAudit() {
  const date = document.getElementById('stock-audit-date')?.value;
  const inputs = Array.from(document.querySelectorAll('#stock-audit-oils-body .stock-audit-quantity'));

  if (!date) {
    showMessage('يرجى تحديد تاريخ الجرد', 'error');
    return;
  }

  if (!inputs.length) {
    showMessage('لا توجد زيوت للحفظ', 'error');
    return;
  }

  const items = [];
  for (const input of inputs) {
    const oilType = String(input.dataset.oil || '').trim();
    const rawValue = String(input.value || '').trim();

    if (!rawValue) {
      continue;
    }

    const quantity = parseStockAuditQuantity(rawValue);
    if (!oilType || !Number.isFinite(quantity) || quantity < 0) {
      showMessage('يرجى إدخال كميات صحيحة', 'error');
      input.focus();
      return;
    }

    items.push({ oil_type: oilType, quantity });
  }

  if (items.length === 0) {
    showMessage('يرجى إدخال كمية لزيت واحد على الأقل', 'error');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('save-oil-stock-audit', { date, items });
    if (!result?.success) {
      throw new Error(result?.error || 'save_failed');
    }

    const counted = Number(result.counted) || 0;
    showMessage(`تم حفظ الجرد: ${convertToArabicNumerals(counted)} صنف`, 'success');
    closeStockAuditModal();

    const selectedOilItem = document.querySelector('.oil-item.selected');
    const selectedOilType = selectedOilItem ? selectedOilItem.dataset.oil : '';
    await loadDepotOils(selectedOilType);
  } catch (error) {
    console.error('Error saving stock audit:', error);
    showMessage('حدث خطأ أثناء حفظ جرد المخزن', 'error');
  }
}

async function saveMovement() {
  const selectedOilItem = document.querySelector('.oil-item.selected');
  const oilType = selectedOilItem ? selectedOilItem.dataset.oil : '';
  const date = document.getElementById('movement-date').value;
  const type = document.getElementById('movement-type').value;
  const quantity = parseFloat(document.getElementById('movement-quantity').value);
  const invoiceNumber = document.getElementById('movement-invoice').value;
  
  // Basic validation
  if (!oilType || !date || !type || !Number.isFinite(quantity)) {
    showMessage('يرجى ملء جميع الحقول المطلوبة', 'error');
    return;
  }

  // For 'in' movements, invoice number is required
  if (type === 'in' && !invoiceNumber) {
    showMessage('رقم الفاتورة مطلوب لحركات الدخول', 'error');
    return;
  }
  
  if (quantity <= 0) {
    showMessage('يرجى إدخال كمية صحيحة', 'error');
    return;
  }
  
  try {
    await ipcRenderer.invoke('add-oil-movement', {
      oil_type: oilType,
      date: date,
      type: type,
      quantity: quantity,
      invoice_number: type === 'in' ? invoiceNumber : null
    });
    
    showMessage('تم حفظ الحركة بنجاح', 'success');
    resetMovementForm();
    closeMovementModal();
    await loadDepotOils(oilType);
  } catch (error) {
    console.error('Error saving movement:', error);
    showMessage('حدث خطأ أثناء حفظ الحركة', 'error');
  }
}

// Oil Invoice Functions
async function saveOilInvoice() {
  const discountInput = document.getElementById('immediate-discount');
  const taxInput = document.getElementById('martyrs-tax');

  const invoiceData = {
    date: document.getElementById('oil-invoice-date').value,
    invoice_number: document.getElementById('oil-invoice-number').value,
    immediate_discount: parseFloat(discountInput?.value) || 0,
    martyrs_tax: parseFloat(taxInput?.value) || 0,
    oil_items: []
  };

  // Collect oil items data
  document.querySelectorAll('#oil-items-list .oil-item').forEach(item => {
    const oilType = item.dataset.oil;
    const oilCode = item.dataset.oilCode || '';
    const quantity = parseFloat(item.querySelector('.oil-quantity').value) || 0;
    const purchasePrice = parseFloat(item.querySelector('.oil-purchase-price').value) || 0;
    const iva = parseFloat(item.querySelector('.oil-iva').value) || 0;
    const totalPurchaseInput = item.querySelector('.oil-total-purchase');
    const totalPurchase = parseFloat(totalPurchaseInput.dataset.numericValue) || 0;

    if (oilType && quantity > 0) {
      invoiceData.oil_items.push({
        product_code: oilCode || null,
        oil_type: oilType,
        quantity: quantity,
        purchase_price: purchasePrice,
        iva: iva,
        total_purchase: totalPurchase
      });
    }
  });

  if (invoiceData.oil_items.length === 0) {
    showMessage('يرجى إدخال بيانات على الأقل لنوع واحد من الزيوت', 'error');
    return;
  }

  try {
    // Save the oil invoice
    await ipcRenderer.invoke('add-oil-invoice', invoiceData);

    showMessage('تم حفظ فاتورة الزيوت بنجاح', 'success');
    resetOilInvoiceForm();
    
    // Update depot screen if currently on depot screen
    if (currentScreen === 'depot') {
      const selectedOilItem = document.querySelector('.oil-item.selected');
      const selectedOilType = selectedOilItem ? selectedOilItem.dataset.oil : '';
      if (selectedOilType) {
        loadOilMovements(selectedOilType);
      }
    }
  } catch (error) {
    showMessage('حدث خطأ أثناء حفظ فاتورة الزيوت', 'error');
    console.error('Error saving oil invoice:', error);
  }
}

function resetOilInvoiceForm() {
  // Clear all oil items
  const oilItemsList = document.getElementById('oil-items-list');
  oilItemsList.innerHTML = '';
  oilItemCounter = 0;

  // Reset date
  document.getElementById('oil-invoice-date').value = new Date().toISOString().split('T')[0];

  // Reset invoice number
  document.getElementById('oil-invoice-number').value = '';

  // Reset discount and tax
  const discountInput = document.getElementById('immediate-discount');
  const taxInput = document.getElementById('martyrs-tax');
  if (discountInput) discountInput.value = '0';
  if (taxInput) taxInput.value = '0';

  // Reset summary
  calculateOilInvoiceSummary();
}

function normalizeInvoiceOilProducts(rows) {
  const sourceRows = Array.isArray(rows) && rows.length > 0
    ? rows
    : oilTypes.map((oilType) => ({ oil_type: oilType, vat: 0, product_code: '' }));

  const seen = new Set();
  return sourceRows
    .map((row) => {
      const name = String(row?.oil_type || row?.product_name || '').trim();
      if (!name) return null;
      const productCode = String(row?.product_code || '').trim();
      const key = productCode || name;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: row?.id || key,
        product_code: productCode,
        oil_type: name,
        vat: parseFloat(row?.vat) || 0
      };
    })
    .filter(Boolean);
}

async function loadInvoiceOilProducts(forceReload = false) {
  if (invoiceOilProductsCache && !forceReload) {
    return invoiceOilProductsCache;
  }

  if (invoiceOilProductsLoadingPromise && !forceReload) {
    return invoiceOilProductsLoadingPromise;
  }

  invoiceOilProductsLoadingPromise = (async () => {
    try {
      const products = await ipcRenderer.invoke('get-oil-prices');
      invoiceOilProductsCache = normalizeInvoiceOilProducts(products);
    } catch (error) {
      console.error('Error loading oil products for invoice:', error);
      invoiceOilProductsCache = normalizeInvoiceOilProducts([]);
      showMessage?.('تعذر تحميل قائمة الزيوت من قاعدة البيانات، سيتم استخدام القائمة الاحتياطية', 'warning');
    } finally {
      invoiceOilProductsLoadingPromise = null;
    }

    return invoiceOilProductsCache;
  })();

  return invoiceOilProductsLoadingPromise;
}

function findInvoiceOilProduct(selectedValue) {
  const value = String(selectedValue || '').trim();
  if (!value) return null;

  return (invoiceOilProductsCache || []).find((product) => (
    product.product_code === value || product.oil_type === value
  )) || null;
}

function populateOilTypeSelect(select, products, selectedValue = '') {
  if (!select) return;

  const currentValue = selectedValue || select.value;
  select.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'اختر نوع الزيت';
  select.appendChild(placeholder);

  products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.product_code || product.oil_type;
    option.textContent = product.oil_type;
    option.dataset.oilName = product.oil_type;
    option.dataset.oilCode = product.product_code || '';
    option.dataset.vat = String(product.vat || 0);
    select.appendChild(option);
  });

  if (currentValue) {
    select.value = currentValue;
  }
}

function refreshOilInvoiceProductSelects(products = invoiceOilProductsCache || []) {
  document.querySelectorAll('#oil-items-list .oil-item').forEach((item) => {
    const select = item.querySelector('.oil-type-select');
    if (!select) return;

    const selectedValue = item.dataset.oilCode || item.dataset.oil || select.value;
    populateOilTypeSelect(select, products, selectedValue);
    if (select.value) {
      updateOilType(item.id, select.value);
    } else {
      updateOilType(item.id, '');
    }
  });
}

// Funzioni per gestire le righe dinamiche degli oli
async function addOilItem() {
  const oilItemsList = document.getElementById('oil-items-list');
  const itemId = `oil-item-${oilItemCounter}`;
  const products = await loadInvoiceOilProducts();
  const safeItemId = escapeHtml(itemId);

  const oilItemHTML = `
    <div class="oil-item" id="${safeItemId}" data-oil="" data-oil-code="">
      <div class="oil-row">
        <div class="oil-input-group oil-type-group">
          <select class="oil-type-select" onchange="updateOilType('${safeItemId}', this.value)">
          </select>
        </div>
        <div class="oil-input-group">
          <input type="number" class="oil-quantity" placeholder="الكمية" min="1">
        </div>
        <div class="oil-input-group">
          <input type="number" class="oil-purchase-price" placeholder="سعر الشراء" step="0.01" min="0">
        </div>
        <div class="oil-input-group">
          <input type="number" class="oil-iva" placeholder="الضريبة" step="0.01" min="0" max="100">
        </div>
        <div class="oil-input-group">
          <input type="text" class="oil-total-purchase" readonly placeholder="إجمالي الشراء">
        </div>
        <div class="oil-delete-btn">
          <button type="button" class="btn-delete" onclick="removeOilItem('${safeItemId}')" title="حذف">
            ✕
          </button>
        </div>
      </div>
    </div>
  `;

  oilItemsList.insertAdjacentHTML('beforeend', oilItemHTML);
  const oilItem = document.getElementById(itemId);
  populateOilTypeSelect(oilItem?.querySelector('.oil-type-select'), products);
  oilItemCounter++;

  // Setup listeners for the new item
  setupOilCalculationListeners();
}

function removeOilItem(itemId) {
  const item = document.getElementById(itemId);
  if (item) {
    item.remove();
    calculateOilInvoiceSummary();
  }
}

function updateOilType(itemId, oilType) {
  const item = document.getElementById(itemId);
  if (item) {
    if (!oilType) {
      item.dataset.oil = '';
      item.dataset.oilCode = '';
      const ivaInput = item.querySelector('.oil-iva');
      if (ivaInput) {
        ivaInput.value = '';
        calculateOilItem.call(ivaInput);
      }
      return;
    }

    const select = item.querySelector('.oil-type-select');
    const selectedOption = select?.selectedOptions?.[0];
    const product = findInvoiceOilProduct(oilType);
    const oilName = product?.oil_type || selectedOption?.dataset.oilName || oilType;
    const oilCode = product?.product_code || selectedOption?.dataset.oilCode || '';
    const vat = product ? product.vat : (parseFloat(selectedOption?.dataset.vat) || 0);

    item.dataset.oil = oilName;
    item.dataset.oilCode = oilCode;

    const ivaInput = item.querySelector('.oil-iva');
    if (ivaInput) {
      ivaInput.value = formatPrice(vat);
      calculateOilItem.call(ivaInput);
    }
  }
}

// Oil Prices Functions
async function loadOilPrices() {
  try {
    const prices = await ipcRenderer.invoke('get-oil-prices');
    const tbody = document.getElementById('oil-prices-table-body');

    if (!tbody) return;

    tbody.innerHTML = '';
    tbody.dataset.loaded = '1';

    if (!Array.isArray(prices) || prices.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="3" style="text-align:center; color:#666;">لا توجد منتجات زيوت</td>';
      tbody.appendChild(row);
      initializePriceDate();
      return;
    }

    prices.forEach((oil, index) => {
      const oilName = oil.oil_type || '';
      const row = document.createElement('tr');
      row.dataset.product = oilName;

      const nameCell = document.createElement('td');
      nameCell.className = 'product-name';
      nameCell.textContent = oilName;

      const currentPriceCell = document.createElement('td');
      currentPriceCell.style.textAlign = 'center';
      currentPriceCell.textContent = formatArabicCurrency(parseFloat(oil.price) || 0);

      const newPriceCell = document.createElement('td');
      newPriceCell.style.textAlign = 'center';
      const input = document.createElement('input');
      input.type = 'number';
      input.id = `price-oil-${oil.id || index}`;
      input.step = '0.01';
      input.min = '0';
      input.className = 'table-price-input';
      input.placeholder = '0.00';
      input.autocomplete = 'off';
      input.dataset.productType = 'oil';
      input.dataset.productName = oilName;
      input.dataset.currentPrice = String(parseFloat(oil.price) || 0);
      input.dataset.dirty = '0';
      input.addEventListener('input', () => {
        input.dataset.dirty = '1';
      });
      newPriceCell.appendChild(input);

      row.appendChild(nameCell);
      row.appendChild(currentPriceCell);
      row.appendChild(newPriceCell);
      tbody.appendChild(row);
    });

    // Initialize price date
    initializePriceDate();
  } catch (error) {
    console.error('Error loading oil prices:', error);
  }
}

// Switch between fuel and oil price tabs
function switchPriceType(type) {
  const priceEditModal = document.getElementById('price-edit-modal');
  const scope = priceEditModal || document;

  // Update tab buttons
  scope.querySelectorAll('.price-type-tab').forEach(tab => {
    if (tab.dataset.priceType === type) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update sections
  scope.querySelectorAll('.price-type-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeSection = document.getElementById(`${type}-prices-section`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Load missing data without clearing unsaved inputs on tab switches.
  if (type === 'fuel' && document.getElementById('fuel-prices-table-body')?.dataset.loaded !== '1') {
    loadFuelPrices();
  } else if (type === 'oil' && document.getElementById('oil-prices-table-body')?.dataset.loaded !== '1') {
    loadOilPrices();
  }
}

// Set default date to today
function initializePriceDate() {
  const today = getTodayDate();
  const dateInput = document.getElementById('price-start-date');
  if (dateInput && !dateInput.value) dateInput.value = today;
}

// Reset all price inputs
function resetPriceInputs() {
  document.querySelectorAll('#price-edit-modal .table-price-input').forEach(input => {
    input.value = '';
    input.dataset.dirty = '0';
  });
}

function normalizeSalePriceInput(value) {
  return convertFromArabicNumerals(String(value ?? '')).replace(',', '.').trim();
}

function parseSalePriceInputValue(value) {
  const normalized = normalizeSalePriceInput(value);
  if (normalized === '') return null;

  const price = parseFloat(normalized);
  return Number.isFinite(price) ? price : NaN;
}

// Save all prices at once
async function saveAllPrices() {
  const startDate = document.getElementById('price-start-date').value;

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    showMessage('يرجى تحديد تاريخ بدء سريان الأسعار', 'error');
    return;
  }

  try {
    const salePrices = [];
    const purchasePrices = [];
    const invalidProducts = [];
    const priceInputs = document.querySelectorAll(
      '#price-edit-modal .table-price-input[data-product-type][data-product-name]'
    );

    priceInputs.forEach(input => {
      if (input.dataset.dirty !== '1') {
        return;
      }

      const rawPrice = normalizeSalePriceInput(input.value);
      if (rawPrice === '') {
        return;
      }

      const productType = input.dataset.productType;
      const productName = input.dataset.productName;
      const productCode = input.dataset.productCode || '';
      const priceKind = input.dataset.priceKind || 'sale';
      const price = parseSalePriceInputValue(rawPrice);

      if (!productType || !productName || isNaN(price) || price <= 0) {
        invalidProducts.push(productName || '');
        return;
      }

      if (priceKind === 'purchase') {
        purchasePrices.push({
          product_name: productName,
          product_code: productCode,
          price,
          start_date: startDate
        });
      } else {
        salePrices.push({
          product_type: productType,
          product_name: productName,
          price,
          start_date: startDate
        });
      }
    });

    if (invalidProducts.length > 0) {
      showMessage(`يرجى إدخال سعر صحيح للمنتج: ${invalidProducts[0]}`, 'error');
      return;
    }

    if (salePrices.length === 0 && purchasePrices.length === 0) {
      showMessage('لم يتم إدخال أي أسعار', 'error');
      return;
    }

    const [saleResult, purchaseResult] = await Promise.all([
      salePrices.length > 0
        ? ipcRenderer.invoke('save-all-prices', salePrices)
        : Promise.resolve({ saved: 0, skipped: [] }),
      purchasePrices.length > 0
        ? ipcRenderer.invoke('save-all-purchase-prices', purchasePrices)
        : Promise.resolve({ saved: 0, skipped: [] })
    ]);
    const savedCount = (saleResult?.saved || 0) + (purchaseResult?.saved || 0);
    const skippedCount = [
      ...(Array.isArray(saleResult?.skipped) ? saleResult.skipped : []),
      ...(Array.isArray(purchaseResult?.skipped) ? purchaseResult.skipped : [])
    ].length;

    if (savedCount === 0 && skippedCount > 0) {
      showMessage('لم يتم حفظ أي سعر. راجع البيانات المدخلة.', 'error');
      return;
    } else if (skippedCount > 0) {
      showMessage(`تم حفظ ${convertToArabicNumerals(savedCount)} سعر وتجاهل ${convertToArabicNumerals(skippedCount)}`, 'warning');
    } else {
      showMessage('تم حفظ الأسعار بنجاح', 'success');
    }

    if (purchasePrices.length > 0) {
      invalidateInvoiceFuelProductsCache();
      await refreshFuelInvoicePurchasePricesForDate();
    }

    // Reset all price inputs
    resetPriceInputs();

    // Reload prices to show current values
    await Promise.all([
      loadFuelPrices(),
      loadOilPrices(),
      loadManageProducts()
    ]);

    closePriceEditModal();
    showSettingsSectionWithoutHistory('manage-products');
  } catch (error) {
    showMessage('حدث خطأ أثناء حفظ الأسعار', 'error');
    console.error('Error saving prices:', error);
  }
}

// Toggle VAT field visibility
function toggleVatField() {
  const typeInput = document.getElementById('new-product-type');
  const vatField = document.getElementById('vat-field');

  if (typeInput && vatField) {
    if (typeInput.value === 'oil') {
      vatField.classList.remove('is-hidden');
    } else {
      vatField.classList.add('is-hidden');
      const vatInput = document.getElementById('new-product-vat');
      if (vatInput) {
        vatInput.value = '';
      }
    }
  }
}

function resetAddProductForm() {
  const nameInput = document.getElementById('new-product-name');
  const typeInput = document.getElementById('new-product-type');
  const priceInput = document.getElementById('new-product-price');
  const vatInput = document.getElementById('new-product-vat');
  const vatField = document.getElementById('vat-field');

  if (nameInput) nameInput.value = '';
  if (typeInput) typeInput.value = '';
  if (priceInput) priceInput.value = '';
  if (vatInput) vatInput.value = '';
  if (vatField) vatField.classList.add('is-hidden');
}

// Add new product
async function addNewProduct() {
  const nameInput = document.getElementById('new-product-name');
  const typeInput = document.getElementById('new-product-type');
  const priceInput = document.getElementById('new-product-price');
  const vatInput = document.getElementById('new-product-vat');

  const name = nameInput.value.trim();
  const type = typeInput.value;
  const price = parseFloat(priceInput.value.replace(',', '.'));
  const vat = type === 'oil' ? (parseFloat(vatInput.value.replace(',', '.')) || 0) : 0;

  // Validation
  if (!name) {
    showMessage('يرجى إدخال اسم المنتج', 'error');
    return;
  }

  if (!type) {
    showMessage('يرجى اختيار نوع المنتج', 'error');
    return;
  }

  if (isNaN(price) || price <= 0) {
    showMessage('يرجى إدخال سعر صحيح', 'error');
    return;
  }

  try {
    // Add product to appropriate price table
    if (type === 'fuel') {
      await ipcRenderer.invoke('add-fuel-price', { fuel_type: name, price });
      invalidateInvoiceFuelProductsCache();
    } else if (type === 'oil') {
      await ipcRenderer.invoke('add-oil-price', { oil_type: name, price, vat });
      invalidateInvoiceOilProductsCache();
    }

    showMessage('تم إضافة المنتج بنجاح', 'success');

    closeAddProductModal();

    await Promise.all([
      loadFuelPrices(),
      loadOilPrices()
    ]);
    showSettingsSectionWithoutHistory('manage-products');
  } catch (error) {
    showMessage('حدث خطأ أثناء إضافة المنتج: ' + error.message, 'error');
    console.error('Error adding new product:', error);
  }
}

// Switch product type in manage products section
function switchManageProductType(type) {
  // Update tabs
  const tabs = document.querySelectorAll('#settings-section-manage-products .price-type-tab');
  tabs.forEach(tab => {
    if (tab.dataset.priceType === type) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update sections
  const fuelSection = document.getElementById('manage-fuel-section');
  const oilSection = document.getElementById('manage-oil-section');

  if (type === 'fuel') {
    if (fuelSection) fuelSection.classList.add('active');
    if (oilSection) oilSection.classList.remove('active');
  } else {
    if (fuelSection) fuelSection.classList.remove('active');
    if (oilSection) oilSection.classList.add('active');
  }
}

// Shift Entry Tab Switching
function switchShiftTab(tab) {
  if (fuelInlineResetMode && tab !== 'fuel') {
    fuelInlineResetMode = false;
    lockFuelFirstShiftInputs();
  }

  if (oilInlineResetMode && tab !== 'oil') {
    oilInlineResetMode = false;
    lockOilInitialInputs();
  }

  // Update tabs
  const tabs = document.querySelectorAll('#shift-entry-screen .price-type-tab');
  tabs.forEach(t => {
    if (t.dataset.shiftTab === tab) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  // Update sections
  const fuelSection = document.getElementById('shift-fuel-section');
  const oilSection = document.getElementById('shift-oil-section');

  // Remove active from all
  if (fuelSection) fuelSection.classList.remove('active');
  if (oilSection) oilSection.classList.remove('active');

  // Add active to selected
  if (tab === 'fuel' && fuelSection) {
    fuelSection.classList.add('active');
  } else if (tab === 'oil' && oilSection) {
    oilSection.classList.add('active');
  }

  updateShiftHorizontalScrollControls();
}

// Show settings section without adding to history
function showSettingsSectionWithoutHistory(sectionName) {
  if (settingsSectionRequiresOnline(sectionName)) {
    showMessage('هذه الصفحة من الإعدادات تتطلب اتصالاً بالإنترنت', 'warning');
    return;
  }
  // Update active state in settings menu
  document.querySelectorAll('.settings-menu-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.settingsSection === sectionName) {
      item.classList.add('active');
    }
  });

  // Show the selected settings section
  document.querySelectorAll('.settings-section').forEach(section => {
    section.classList.remove('active');
  });
  const targetSection = document.getElementById(`settings-section-${sectionName}`);
  if (targetSection) {
    targetSection.classList.add('active');

    // Load data relevant to the section
    if (sectionName === 'manage-products') {
      loadManageProducts();
    } else if (sectionName === 'manage-customers') {
      loadCustomersSettings();
    } else if (sectionName === 'general') {
      loadGeneralSettings();
      loadUpdateSettings();
      updateUpdatesPageUI(); // Show install button if update is ready
    } else if (sectionName === 'invoices-list') {
      loadInvoicesList();
    } else if (sectionName === 'excel-sales-import') {
      loadExcelSalesImportProducts();
    } else if (sectionName === 'balance-history') {
      loadShiftBalanceHistory();
    }
  }
}

async function openPriceEditModal() {
  const modal = document.getElementById('price-edit-modal');
  if (!modal) return;

  const dateInput = document.getElementById('price-start-date');
  if (dateInput) {
    dateInput.value = getTodayDate();
  }

  const fuelBody = document.getElementById('fuel-prices-table-body');
  const oilBody = document.getElementById('oil-prices-table-body');
  if (fuelBody) fuelBody.dataset.loaded = '';
  if (oilBody) oilBody.dataset.loaded = '';

  modal.classList.add('show');

  await Promise.all([
    loadFuelPrices(),
    loadOilPrices()
  ]);

  switchPriceType('fuel');
}

function closePriceEditModal() {
  const modal = document.getElementById('price-edit-modal');
  if (!modal) return;

  modal.classList.remove('show');
  resetPriceInputs();
}

function navigateToEditPrices() {
  openPriceEditModal();
}

function openAddProductModal() {
  const modal = document.getElementById('add-product-modal');
  if (!modal) return;

  resetAddProductForm();
  modal.classList.add('show');

  const nameInput = document.getElementById('new-product-name');
  if (nameInput) {
    setTimeout(() => nameInput.focus(), 0);
  }
}

function closeAddProductModal() {
  const modal = document.getElementById('add-product-modal');
  if (!modal) return;

  modal.classList.remove('show');
  resetAddProductForm();
}

function navigateToAddProduct() {
  openAddProductModal();
}

function getActionEditIconSvg() {
  return `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
    </svg>
  `;
}

function getActionDeleteIconSvg() {
  return `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
      <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
    </svg>
  `;
}

// Format date for display
function formatUpdateDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${day}/${month}/${year}`;
  return ` (${convertToArabicNumerals(dateStr)})`;
}

// Load manage products tables
async function loadManageProducts() {
  try {
    // Remember which tab was active before reload
    const activeTab = document.querySelector('#settings-section-manage-products .price-type-tab.active');
    const activeType = activeTab ? activeTab.dataset.priceType : 'fuel';

    // Load fuel products
    const [fuelPrices, purchasePricesRaw] = await Promise.all([
      ipcRenderer.invoke('get-fuel-prices'),
      ipcRenderer.invoke('get-purchase-prices').catch((error) => {
        console.warn('Unable to load purchase prices for manage products:', error);
        return [];
      })
    ]);
    console.log('Loaded fuel prices:', fuelPrices);
    const fuelTableBody = document.getElementById('manage-fuel-table-body');

    if (fuelTableBody) {
      fuelTableBody.innerHTML = '';
      const purchaseByCode = new Map();
      const purchaseByName = new Map();
      (Array.isArray(purchasePricesRaw) ? purchasePricesRaw : []).forEach((item) => {
        const productCode = String(item?.product_code || '').trim();
        const fuelType = String(item?.fuel_type || '').trim();
        if (productCode) purchaseByCode.set(productCode, item);
        if (fuelType) purchaseByName.set(fuelType, item);
      });

      // Remove duplicates - keep only the latest version of each product
      const uniqueFuels = {};
      fuelPrices.forEach(product => {
        if (!uniqueFuels[product.fuel_type] ||
            new Date(product.effective_date) > new Date(uniqueFuels[product.fuel_type].effective_date)) {
          uniqueFuels[product.fuel_type] = product;
        }
      });

      Object.values(uniqueFuels).forEach((product, index) => {
        const productCode = String(product.product_code || '').trim();
        const purchase = purchaseByCode.get(productCode) || purchaseByName.get(product.fuel_type) || {};
        const row = document.createElement('tr');

        const td1 = document.createElement('td');
        td1.textContent = index + 1;

        const td2 = document.createElement('td');
        td2.className = 'product-name';
        td2.textContent = product.fuel_type;

        const td3 = document.createElement('td');
        td3.style.textAlign = 'center';
        td3.textContent = formatArabicCurrency(product.price);

        const td4 = document.createElement('td');
        td4.style.textAlign = 'center';
        td4.textContent = product.effective_date ? formatDateOnlyDisplay(product.effective_date) : '-';

        const td5 = document.createElement('td');
        td5.style.textAlign = 'center';
        const purchasePrice = parseFloat(purchase.price);
        td5.textContent = Number.isFinite(purchasePrice) && purchasePrice > 0 ? formatArabicCurrencyPreserveDecimals(purchase.price) : '-';

        const td6 = document.createElement('td');
        td6.style.textAlign = 'center';
        td6.textContent = purchase.effective_date ? formatDateOnlyDisplay(purchase.effective_date) : '-';

        const td7 = document.createElement('td');
        td7.style.textAlign = 'center';

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-icon';
        editBtn.title = 'تعديل الاسم';
        editBtn.onclick = () => editProductName('fuel', product.fuel_type, product.id);
        editBtn.innerHTML = getActionEditIconSvg();

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon btn-icon-danger';
        deleteBtn.title = 'حذف المنتج';
        deleteBtn.style.marginLeft = '0.5rem';
        deleteBtn.onclick = () => deleteFuelProduct(product.fuel_type);
        deleteBtn.innerHTML = getActionDeleteIconSvg();

        td7.appendChild(editBtn);
        td7.appendChild(deleteBtn);

        row.appendChild(td1);
        row.appendChild(td2);
        row.appendChild(td3);
        row.appendChild(td4);
        row.appendChild(td5);
        row.appendChild(td6);
        row.appendChild(td7);
        fuelTableBody.appendChild(row);
      });
    }

    // Load oil products
    const oilPrices = await ipcRenderer.invoke('get-oil-prices');
    const oilTableBody = document.getElementById('manage-oil-table-body');

    if (oilTableBody) {
      oilTableBody.innerHTML = '';

      // Remove duplicates - keep only the latest version of each product
      const uniqueOils = {};
      oilPrices.forEach(product => {
        if (!uniqueOils[product.oil_type] ||
            new Date(product.effective_date) > new Date(uniqueOils[product.oil_type].effective_date)) {
          uniqueOils[product.oil_type] = product;
        }
      });

      Object.values(uniqueOils).forEach((product, index) => {
        const vat = product.vat || 0;
        const isActive = product.is_active !== 0; // Default to true if undefined
        const row = document.createElement('tr');

        // Checkbox column for "in vendita"
        const tdCheckbox = document.createElement('td');
        tdCheckbox.style.textAlign = 'center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isActive;
        checkbox.onchange = async () => {
          await ipcRenderer.invoke('toggle-oil-active', product.oil_type, checkbox.checked);
        };
        tdCheckbox.appendChild(checkbox);

        const td1 = document.createElement('td');
        td1.textContent = index + 1;

        const td2 = document.createElement('td');
        td2.className = 'product-name';
        td2.textContent = product.oil_type;

        const td3 = document.createElement('td');
        td3.style.textAlign = 'center';
        td3.textContent = formatArabicCurrency(product.price);

        const td4 = document.createElement('td');
        td4.style.textAlign = 'center';
        td4.textContent = formatArabicNumber(vat) + '%';

        const td5 = document.createElement('td');
        td5.style.textAlign = 'center';

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-icon';
        editBtn.title = 'تعديل الاسم';
        editBtn.onclick = () => editProductName('oil', product.oil_type, product.id);
        editBtn.innerHTML = getActionEditIconSvg();

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon btn-icon-danger';
        deleteBtn.title = 'حذف المنتج';
        deleteBtn.style.marginLeft = '0.5rem';
        deleteBtn.onclick = () => deleteOilProduct(product.oil_type);
        deleteBtn.innerHTML = getActionDeleteIconSvg();

        td5.appendChild(editBtn);
        td5.appendChild(deleteBtn);

        row.appendChild(td1);
        row.appendChild(td2);
        row.appendChild(td3);
        row.appendChild(td4);
        row.appendChild(td5);
        row.appendChild(tdCheckbox);
        oilTableBody.appendChild(row);
      });
    }

    // Restore the previously active tab after loading data
    if (activeType) {
      switchManageProductType(activeType);
    }
  } catch (error) {
    console.error('Error loading manage products:', error);
  }
}

// Edit product name - Store current edit context
let currentEditContext = null;

function editProductName(type, currentName, productId) {
  // Store the context for later use
  currentEditContext = { type, currentName, productId };

  // Open modal and populate fields
  const modal = document.getElementById('edit-product-modal');
  const currentNameInput = document.getElementById('edit-product-current-name');
  const newNameInput = document.getElementById('edit-product-new-name');

  if (modal && currentNameInput && newNameInput) {
    currentNameInput.value = currentName;
    newNameInput.value = currentName;
    modal.classList.add('show');

    // Focus on new name input
    setTimeout(() => {
      newNameInput.focus();
      newNameInput.select();
    }, 100);
  }
}

// Close edit product modal
function closeEditProductModal() {
  const modal = document.getElementById('edit-product-modal');
  if (modal) {
    modal.classList.remove('show');
    currentEditContext = null;
    document.getElementById('edit-product-new-name').value = '';
  }
}

// Save edited product name
async function saveEditProductName() {
  if (!currentEditContext) return;

  const newNameInput = document.getElementById('edit-product-new-name');
  const newName = newNameInput.value.trim();

  if (!newName) {
    showMessage('الرجاء إدخال اسم المنتج', 'error');
    return;
  }

  if (newName === currentEditContext.currentName) {
    showMessage('الاسم الجديد مطابق للاسم الحالي', 'error');
    return;
  }

  try {
    await ipcRenderer.invoke('update-product-name', {
      type: currentEditContext.type,
      oldName: currentEditContext.currentName,
      newName: newName,
      id: currentEditContext.productId
    });

    if (currentEditContext.type === 'fuel') {
      invalidateInvoiceFuelProductsCache();
    }

    if (currentEditContext.type === 'oil') {
      renameDepotVisibleOilFilter(currentEditContext.currentName, newName);
      invalidateInvoiceOilProductsCache();
    }

    showMessage('تم تحديث اسم المنتج بنجاح', 'success');
    closeEditProductModal();

    // Reload tables
    loadManageProducts();
    loadFuelPrices();
    loadOilPrices();
    if (typeof loadDepotOils === 'function') {
      loadDepotOils(newName);
    }
  } catch (error) {
    showMessage('حدث خطأ أثناء تحديث اسم المنتج: ' + error.message, 'error');
    console.error('Error updating product name:', error);
  }
}

// Delete fuel product
async function deleteFuelProduct(fuelType) {
  // Confirm deletion
  const confirmDelete = confirm(`هل أنت متأكد من حذف المنتج "${fuelType}"؟\n\nتحذير: لن تتمكن من التراجع عن هذا الإجراء.`);

  if (!confirmDelete) {
    return;
  }

  try {
    console.log('Deleting fuel product:', fuelType);
    const result = await ipcRenderer.invoke('delete-fuel-product', fuelType);
    console.log('Delete result:', result);
    invalidateInvoiceFuelProductsCache();
    showMessage('تم حذف المنتج بنجاح', 'success');

    // Reload tables
    console.log('Reloading manage products...');
    await loadManageProducts();
    console.log('Reloading fuel prices...');
    await loadFuelPrices();
    console.log('Reload complete');
  } catch (error) {
    showMessage('حدث خطأ أثناء حذف المنتج: ' + error.message, 'error');
    console.error('Error deleting fuel product:', error);
  }
}

// Delete oil product
async function deleteOilProduct(oilType) {
  // Confirm deletion
  const confirmDelete = confirm(`هل أنت متأكد من حذف المنتج "${oilType}"؟\n\nتحذير: لن تتمكن من التراجع عن هذا الإجراء.`);

  if (!confirmDelete) {
    return;
  }

  try {
    await ipcRenderer.invoke('delete-oil-product', oilType);
    invalidateInvoiceOilProductsCache();
    showMessage('تم حذف المنتج بنجاح', 'success');

    // Reload tables
    loadManageProducts();
    loadOilPrices();
  } catch (error) {
    showMessage('حدث خطأ أثناء حذف المنتج: ' + error.message, 'error');
    console.error('Error deleting oil product:', error);
  }
}

// Show price history modal
async function showPriceHistory() {
  const modal = document.getElementById('price-history-modal');
  if (modal) {
    const fuelFilterGroup = document.getElementById('fuel-filter-group');
    const oilFilterGroup = document.getElementById('oil-filter-group');
    if (fuelFilterGroup) {
      fuelFilterGroup.innerHTML = '';
      let fuels = [];
      try {
        fuels = await ipcRenderer.invoke('get-fuel-prices');
      } catch (error) {
        console.warn('Unable to load fuel products for price history filter:', error);
      }

      const fuelNames = Array.isArray(fuels) && fuels.length > 0
        ? fuels.map(fuel => fuel.fuel_type).filter(Boolean)
        : ['بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'سولار'];

      for (const fuelType of fuelNames) {
        const option = document.createElement('option');
        option.value = fuelType;
        option.textContent = fuelType;
        fuelFilterGroup.appendChild(option);
      }
    }

    if (oilFilterGroup) {
      oilFilterGroup.innerHTML = '';
      let oils = [];
      try {
        oils = await ipcRenderer.invoke('get-oil-prices');
      } catch (error) {
        console.warn('Unable to load oil products for price history filter:', error);
      }

      const oilNames = Array.isArray(oils) && oils.length > 0
        ? oils.map(oil => oil.oil_type).filter(Boolean)
        : oilTypes;

      for (const oilType of oilNames) {
        const option = document.createElement('option');
        option.value = oilType;
        option.textContent = oilType;
        oilFilterGroup.appendChild(option);
      }
    }

    modal.classList.add('show');
    loadPriceHistory();
  }
}

// Close price history modal
function closePriceHistoryModal() {
  const modal = document.getElementById('price-history-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

// Load price history
async function loadPriceHistory() {
  if (!isOnline) {
    showMessage('عرض سجل الأسعار يتطلب اتصالاً بالإنترنت', 'warning');
    return;
  }
  try {
    const filter = document.getElementById('history-product-filter').value;
    let serverFilter = '';
    let historyTypeFilter = '';

    if (filter === '__all_fuel__') {
      historyTypeFilter = 'fuel';
    } else if (filter === '__all_oil__') {
      historyTypeFilter = 'oil';
    } else if (filter) {
      serverFilter = filter;
    }

    const [historyRaw, purchaseHistoryRaw, fuelProductsRaw, purchaseProductsRaw, oilProductsRaw] = await Promise.all([
      ipcRenderer.invoke('get-price-history', serverFilter),
      ipcRenderer.invoke('get-purchase-price-history', serverFilter),
      ipcRenderer.invoke('get-fuel-prices'),
      ipcRenderer.invoke('get-purchase-prices').catch(() => []),
      ipcRenderer.invoke('get-oil-prices')
    ]);

    let history = historyTypeFilter
      ? (Array.isArray(historyRaw) ? historyRaw : []).filter((item) => item?.product_type === historyTypeFilter)
      : (Array.isArray(historyRaw) ? historyRaw : []);
    const purchaseHistory = Array.isArray(purchaseHistoryRaw)
      ? purchaseHistoryRaw
        .filter((item) => {
          if (historyTypeFilter === 'oil') return false;
          if (historyTypeFilter === 'fuel') return true;
          if (filter && !filter.startsWith('__all_')) return String(item?.fuel_type || '').trim() === filter;
          return true;
        })
        .map((item) => ({
          product_type: 'fuel_purchase',
          product_name: `${String(item?.fuel_type || '').trim()} - سعر الشراء`,
          base_product_name: String(item?.fuel_type || '').trim(),
          price: item?.price,
          start_date: item?.start_date,
          created_at: item?.created_at
        }))
      : [];
    history = [...history, ...purchaseHistory];
    const container = document.getElementById('price-history-content');

    if (!container) return;

    const parseDateKey = (value) => {
      const raw = String(value || '').trim().replace(/^"+|"+$/g, '');

      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
      }

      const parsedDate = value instanceof Date ? value : new Date(raw);
      if (Number.isNaN(parsedDate.getTime())) {
        return '';
      }

      const year = parsedDate.getFullYear();
      const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const day = String(parsedDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const existingHistoryKeys = new Set();
    history.forEach((item) => {
      const productName = String(item?.product_name || '').trim();
      const dateKey = parseDateKey(item?.start_date);
      if (productName && dateKey) {
        existingHistoryKeys.add(`${productName}@@${dateKey}`);
      }
    });

    const fuelProducts = Array.isArray(fuelProductsRaw) ? fuelProductsRaw : [];
    const purchaseProducts = Array.isArray(purchaseProductsRaw) ? purchaseProductsRaw : [];
    const oilProducts = Array.isArray(oilProductsRaw) ? oilProductsRaw : [];
    const allProducts = [
      ...fuelProducts.map((item) => ({ type: 'fuel', name: item?.fuel_type, price: item?.price, effective_date: item?.effective_date })),
      ...purchaseProducts.map((item) => ({ type: 'fuel_purchase', name: `${item?.fuel_type} - سعر الشراء`, baseName: item?.fuel_type, price: item?.price, effective_date: item?.effective_date })),
      ...oilProducts.map((item) => ({ type: 'oil', name: item?.oil_type, price: item?.price, effective_date: item?.effective_date }))
    ].filter((item) => String(item?.name || '').trim() !== '');

    const fallbackRows = allProducts.reduce((rows, product) => {
      if (filter === '__all_fuel__' && !['fuel', 'fuel_purchase'].includes(product.type)) return rows;
      if (filter === '__all_oil__' && product.type !== 'oil') return rows;
      if (filter && !filter.startsWith('__all_') && product.name !== filter && product.baseName !== filter) return rows;

      const dateKey = parseDateKey(product.effective_date);
      const numericPrice = parseFloat(product.price);
      const productName = String(product.name || '').trim();

      if (!productName || !dateKey || !Number.isFinite(numericPrice)) return rows;
      if (existingHistoryKeys.has(`${productName}@@${dateKey}`)) return rows;

      rows.push({
        product_type: product.type,
        product_name: productName,
        price: numericPrice,
        start_date: dateKey,
        created_at: 0
      });
      return rows;
    }, []);

    history = [...history, ...fallbackRows];

    if (history.length === 0) {
      container.innerHTML = '<p class="price-history-empty">لا يوجد سجل للأسعار</p>';
      return;
    }

    const dateSet = new Set();
    const changesByProduct = new Map();
    const productTypeByName = new Map();

    history.forEach((item) => {
      const productName = String(item?.product_name || '').trim();
      const dateKey = parseDateKey(item?.start_date);
      const priceValue = parseFloat(item?.price);

      if (!productName || !dateKey || !Number.isFinite(priceValue)) {
        return;
      }

      dateSet.add(dateKey);

      if (!changesByProduct.has(productName)) {
        changesByProduct.set(productName, new Map());
      }
      if (!productTypeByName.has(productName)) {
        productTypeByName.set(productName, item?.product_type || '');
      }

      const perDate = changesByProduct.get(productName);
      const createdAtMs = (() => {
        if (typeof item?.created_at === 'number') return item.created_at * 1000;
        const parsed = new Date(item?.created_at).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      })();

      const existing = perDate.get(dateKey);
      if (!existing || createdAtMs >= existing.createdAtMs) {
        perDate.set(dateKey, { price: priceValue, createdAtMs });
      }
    });

    const dateColumns = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
    const typeRank = (productName) => {
      const t = productTypeByName.get(productName);
      if (t === 'fuel') return 0;
      if (t === 'fuel_purchase') return 1;
      if (t === 'oil') return 2;
      return 3;
    };
    const products = Array.from(changesByProduct.keys()).sort((a, b) => {
      const rankDiff = typeRank(a) - typeRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.localeCompare(b);
    });

    if (dateColumns.length === 0 || products.length === 0) {
      container.innerHTML = '<p class="price-history-empty">لا يوجد سجل للأسعار</p>';
      return;
    }

    const getEffectivePriceAtDate = (productName, targetDateKey) => {
      const perDate = changesByProduct.get(productName);
      if (!perDate) return null;

      let bestDate = null;
      perDate.forEach((_entry, dateKey) => {
        if (dateKey <= targetDateKey && (!bestDate || dateKey > bestDate)) {
          bestDate = dateKey;
        }
      });

      if (!bestDate) return null;
      return perDate.get(bestDate)?.price ?? null;
    };

    let html = '<div class="price-history-table-wrapper"><table class="base-table price-history-table">';
    html += '<thead><tr>';
    html += '<th class="price-history-product-col">المنتج</th>';
    html += dateColumns
      .map((dateKey) => `<th>${escapeHtml(formatDateOnlyDisplay(dateKey))}</th>`)
      .join('');
    html += '</tr></thead><tbody>';

    for (const productName of products) {
      html += '<tr>';
      html += `<td class="price-history-product-col">${escapeHtml(productName)}</td>`;
      html += dateColumns.map((dateKey) => {
        const price = getEffectivePriceAtDate(productName, dateKey);
        if (!Number.isFinite(price)) {
          return '<td>-</td>';
        }
        return `<td class="price-history-price">${escapeHtml(formatArabicNumber(price))}</td>`;
      }).join('');
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (error) {
    console.error('Error loading price history:', error);
    showMessage('حدث خطأ أثناء تحميل السجل', 'error');
  }
}

// General Settings Functions
async function saveGeneralSettings(silent = false) {
  const stationName = document.getElementById('station-name').value;
  const stationAddress = document.getElementById('station-address').value;
  const stationPhone = document.getElementById('station-phone').value;
  const monthlyReportRecipients = document.getElementById('monthly-report-recipients')?.value || '';
  const monthlyReportSmtpHost = document.getElementById('monthly-report-smtp-host')?.value || '';
  const monthlyReportSmtpPort = document.getElementById('monthly-report-smtp-port')?.value || '';
  const monthlyReportSmtpSecure = Boolean(document.getElementById('monthly-report-smtp-secure')?.checked);
  const monthlyReportSmtpUser = document.getElementById('monthly-report-smtp-user')?.value || '';
  const monthlyReportSmtpPassword = document.getElementById('monthly-report-smtp-password')?.value || '';
  const monthlyReportFromEmail = document.getElementById('monthly-report-from-email')?.value || '';

  try {
    await ipcRenderer.invoke('save-general-settings', {
      stationName,
      stationAddress,
      stationPhone,
      monthlyReportRecipients,
      monthlyReportSmtpHost,
      monthlyReportSmtpPort,
      monthlyReportSmtpSecure,
      monthlyReportSmtpUser,
      monthlyReportSmtpPassword,
      monthlyReportFromEmail
    });
    if (!silent) {
      showMessage('تم حفظ الإعدادات بنجاح', 'success');
    }
  } catch (error) {
    if (!silent) {
      showMessage('حدث خطأ أثناء حفظ الإعدادات', 'error');
    }
    console.error('Error saving general settings:', error);
    throw error;
  }
}

async function loadGeneralSettings() {
  try {
    const settings = await ipcRenderer.invoke('get-general-settings');
    initMonthlyReportRecipientsControl();
    if (settings) {
      document.getElementById('station-name').value = settings.stationName || 'محطة بنزين سمنود - الجمعية التعاونية للبترول';
      document.getElementById('station-address').value = settings.stationAddress || '';
      document.getElementById('station-phone').value = settings.stationPhone || '';
      const recipientsInput = document.getElementById('monthly-report-recipients');
      const smtpHostInput = document.getElementById('monthly-report-smtp-host');
      const smtpPortInput = document.getElementById('monthly-report-smtp-port');
      const smtpSecureInput = document.getElementById('monthly-report-smtp-secure');
      const smtpUserInput = document.getElementById('monthly-report-smtp-user');
      const smtpPasswordInput = document.getElementById('monthly-report-smtp-password');
      const fromEmailInput = document.getElementById('monthly-report-from-email');
      if (recipientsInput) {
        recipientsInput.value = settings.monthlyReportRecipients || '';
        renderMonthlyReportRecipientChips();
      }
      if (smtpHostInput) smtpHostInput.value = settings.monthlyReportSmtpHost || '';
      if (smtpPortInput) smtpPortInput.value = settings.monthlyReportSmtpPort || '';
      if (smtpSecureInput) smtpSecureInput.checked = Boolean(settings.monthlyReportSmtpSecure);
      if (smtpUserInput) smtpUserInput.value = settings.monthlyReportSmtpUser || '';
      if (smtpPasswordInput) smtpPasswordInput.value = settings.monthlyReportSmtpPassword || '';
      if (fromEmailInput) fromEmailInput.value = settings.monthlyReportFromEmail || '';
    }
  } catch (error) {
    console.error('Error loading general settings:', error);
  }
}

function parseMonthlyReportRecipients(value) {
  return String(value || '')
    .split(/[\n,;]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function getMonthlyReportRecipients() {
  return parseMonthlyReportRecipients(document.getElementById('monthly-report-recipients')?.value || '');
}

function setMonthlyReportRecipients(recipients) {
  const hiddenInput = document.getElementById('monthly-report-recipients');
  if (!hiddenInput) return;
  const normalized = [];
  const seen = new Set();
  (Array.isArray(recipients) ? recipients : []).forEach((email) => {
    const cleanEmail = String(email || '').trim();
    const dedupeKey = cleanEmail.toLowerCase();
    if (!cleanEmail || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push(cleanEmail);
  });
  hiddenInput.value = normalized.join('\n');
  renderMonthlyReportRecipientChips();
}

function isMonthlyReportRecipientEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function renderMonthlyReportRecipientChips() {
  const chipsContainer = document.getElementById('monthly-report-recipient-chips');
  if (!chipsContainer) return;
  const recipients = getMonthlyReportRecipients();
  if (recipients.length === 0) {
    chipsContainer.innerHTML = '<div class="email-chip-empty">لا يوجد مستلمون</div>';
    return;
  }

  chipsContainer.innerHTML = recipients.map((email, index) => `
    <span class="email-chip">
      <span>${escapeHtml(email)}</span>
      <button type="button" title="حذف" onclick="removeMonthlyReportRecipientAt(${index})">×</button>
    </span>
  `).join('');
}

function addMonthlyReportRecipients(rawValue) {
  const newRecipients = parseMonthlyReportRecipients(rawValue);
  if (newRecipients.length === 0) return false;
  const validRecipients = newRecipients.filter(isMonthlyReportRecipientEmailValid);
  const invalidRecipients = newRecipients.filter((email) => !isMonthlyReportRecipientEmailValid(email));

  if (validRecipients.length > 0) {
    setMonthlyReportRecipients([...getMonthlyReportRecipients(), ...validRecipients]);
  }

  if (invalidRecipients.length > 0) {
    setMonthlyReportStatus(`إيميل غير صالح: ${invalidRecipients.join(', ')}`, 'error');
  }

  return validRecipients.length > 0;
}

function addMonthlyReportRecipientFromInput() {
  const input = document.getElementById('monthly-report-recipient-input');
  if (!input) return;
  const added = addMonthlyReportRecipients(input.value);
  if (added) {
    input.value = '';
    input.focus();
  }
}

function removeMonthlyReportRecipient(email) {
  const target = String(email || '').trim().toLowerCase();
  setMonthlyReportRecipients(getMonthlyReportRecipients().filter((recipient) => (
    recipient.toLowerCase() !== target
  )));
}

function removeMonthlyReportRecipientAt(index) {
  const removeIndex = parseInt(index, 10);
  if (!Number.isFinite(removeIndex)) return;
  setMonthlyReportRecipients(getMonthlyReportRecipients().filter((_recipient, recipientIndex) => (
    recipientIndex !== removeIndex
  )));
}

function initMonthlyReportRecipientsControl() {
  const input = document.getElementById('monthly-report-recipient-input');
  if (!input || input.dataset.bound === 'true') return;

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      addMonthlyReportRecipientFromInput();
    }
  });

  input.addEventListener('paste', (event) => {
    const pastedText = event.clipboardData?.getData('text') || '';
    if (!/[\n,;]/.test(pastedText)) return;
    event.preventDefault();
    addMonthlyReportRecipients(pastedText);
  });

  input.dataset.bound = 'true';
  renderMonthlyReportRecipientChips();
}

function setMonthlyReportStatus(message, type = '') {
  const status = document.getElementById('monthly-report-status');
  if (!status) return;
  status.style.display = 'block';
  status.className = `excel-import-status${type ? ` ${type}` : ''}`;
  status.textContent = message;
}

function getMonthlyReportErrorMessage(error, fallback) {
  const message = error?.message || '';
  if (message.includes('No handler registered')) {
    return 'يرجى إغلاق التطبيق وفتحه من جديد لتفعيل التقرير الشهري';
  }
  return message || fallback;
}

async function ensureMonthlyReportSettingsSaved() {
  await saveGeneralSettings(true);
}

function getMonthlyReportOptions() {
  return {
    expenseRowOrder: getSavedExpenseRowOrder()
  };
}

async function generateMonthlyReportPdf() {
  try {
    setMonthlyReportStatus('جاري إنشاء التقرير الشهري...');
    await ensureMonthlyReportSettingsSaved();
    const result = await ipcRenderer.invoke('generate-monthly-report-pdf', getMonthlyReportOptions());
    if (result?.canceled) {
      setMonthlyReportStatus('تم إلغاء إنشاء التقرير');
      return;
    }
    if (!result?.success) {
      throw new Error(result?.error || 'report_failed');
    }
    setMonthlyReportStatus(`تم إنشاء التقرير: ${result.filePath}`, 'success');
    showMessage('تم إنشاء التقرير الشهري PDF بنجاح', 'success');
  } catch (error) {
    console.error('Error generating monthly report PDF:', error);
    const errorMessage = getMonthlyReportErrorMessage(error, 'حدث خطأ أثناء إنشاء التقرير');
    setMonthlyReportStatus(errorMessage, 'error');
    showMessage(errorMessage, 'error');
  }
}

async function sendMonthlyReportEmail() {
  try {
    setMonthlyReportStatus('جاري إنشاء وإرسال التقرير الشهري...');
    await ensureMonthlyReportSettingsSaved();
    const result = await ipcRenderer.invoke('send-monthly-report-email', getMonthlyReportOptions());
    if (!result?.success) {
      const errorMessage = result?.error || 'send_failed';
      const statusMessage = result?.filePath
        ? `${errorMessage}\nتم إنشاء التقرير هنا: ${result.filePath}`
        : errorMessage;
      setMonthlyReportStatus(statusMessage, 'error');
      showMessage(errorMessage, 'error');
      return;
    }
    setMonthlyReportStatus(`تم إرسال التقرير إلى ${result.sentTo.join(', ')}`, 'success');
    showMessage('تم إرسال التقرير الشهري بالبريد بنجاح', 'success');
  } catch (error) {
    console.error('Error sending monthly report email:', error);
    const errorMessage = getMonthlyReportErrorMessage(error, 'حدث خطأ أثناء إرسال التقرير');
    setMonthlyReportStatus(errorMessage, 'error');
    showMessage(errorMessage, 'error');
  }
}

function getShiftBalanceHistoryFilters() {
  return {
    itemType: document.getElementById('balance-history-type')?.value || '',
    fromDate: document.getElementById('balance-history-from')?.value || '',
    toDate: document.getElementById('balance-history-to')?.value || ''
  };
}

function formatBalanceHistoryChangedAt(value) {
  if (!value) return '';
  const rawValue = String(value);
  const timestamp = typeof value === 'number' || /^\d+$/.test(rawValue)
    ? Number(value) * 1000
    : new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return escapeHtml(rawValue);
  }

  return escapeHtml(new Date(timestamp).toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }));
}

function getBalanceHistoryTypeLabel(itemType) {
  return itemType === 'oil' ? 'زيوت' : itemType === 'fuel' ? 'وقود' : itemType || '';
}

function setBalanceHistoryStatus(message, type = '') {
  const status = document.getElementById('balance-history-status');
  if (!status) return;
  status.className = `excel-import-status${type ? ` ${type}` : ''}`;
  status.textContent = message;
}

function renderShiftBalanceHistory(rows = []) {
  const tbody = document.getElementById('balance-history-table-body');
  if (!tbody) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="balance-history-empty">لا توجد تغييرات مسجلة</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${formatBalanceHistoryChangedAt(row.changed_at)}</td>
      <td>${escapeHtml(formatDateOnlyDisplay(row.shift_date))}</td>
      <td>${convertToArabicNumerals(row.shift_number || '')}</td>
      <td>${escapeHtml(getBalanceHistoryTypeLabel(row.item_type))}</td>
      <td>${escapeHtml(row.item_name || '')}</td>
      <td>${escapeHtml(row.field_name || '')}</td>
      <td>${row.old_value === null || row.old_value === undefined ? '' : formatArabicNumber(row.old_value)}</td>
      <td>${formatArabicNumber(row.new_value)}</td>
    </tr>
  `).join('');
}

async function loadShiftBalanceHistory() {
  try {
    setBalanceHistoryStatus('جاري تحميل السجل...');
    const rows = await ipcRenderer.invoke('get-shift-balance-change-history', getShiftBalanceHistoryFilters());
    renderShiftBalanceHistory(rows);
    setBalanceHistoryStatus(`تم تحميل ${convertToArabicNumerals(Array.isArray(rows) ? rows.length : 0)} تغيير`, 'success');
  } catch (error) {
    console.error('Error loading shift balance history:', error);
    renderShiftBalanceHistory([]);
    setBalanceHistoryStatus('حدث خطأ أثناء تحميل السجل', 'error');
  }
}

function resetShiftBalanceHistoryFilters() {
  const typeInput = document.getElementById('balance-history-type');
  const fromInput = document.getElementById('balance-history-from');
  const toInput = document.getElementById('balance-history-to');
  if (typeInput) typeInput.value = '';
  if (fromInput) fromInput.value = '';
  if (toInput) toInput.value = '';
  loadShiftBalanceHistory();
}

function parseBalanceHistoryNumber(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCurrentShiftBalanceIdentifier() {
  return {
    shift_date: document.getElementById('shift-date')?.value || getTodayDate(),
    shift_number: parseInt(document.getElementById('shift-number')?.value || '1', 10) || 1
  };
}

async function recordShiftBalanceChanges(changes) {
  const validChanges = (Array.isArray(changes) ? changes : []).filter((change) => {
    const oldValue = parseBalanceHistoryNumber(change.old_value);
    const newValue = parseBalanceHistoryNumber(change.new_value);
    return newValue !== null && (oldValue === null || Math.abs(oldValue - newValue) > 0.000001);
  }).map((change) => ({
    ...getCurrentShiftBalanceIdentifier(),
    ...change,
    old_value: parseBalanceHistoryNumber(change.old_value),
    new_value: parseBalanceHistoryNumber(change.new_value)
  }));

  if (validChanges.length === 0) return;

  try {
    const result = await ipcRenderer.invoke('record-shift-balance-changes', validChanges);
    if (!result?.success) {
      throw new Error(result?.error || 'record_failed');
    }
  } catch (error) {
    console.warn('Unable to record shift balance history:', error);
  }
}

// Backup Functions
async function exportBackup() {
  try {
    const result = await ipcRenderer.invoke('export-backup');
    if (result.success) {
      showMessage('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } else {
      showMessage('حدث خطأ أثناء تصدير النسخة الاحتياطية', 'error');
    }
  } catch (error) {
    showMessage('حدث خطأ أثناء تصدير النسخة الاحتياطية', 'error');
    console.error('Error exporting backup:', error);
  }
}

function openChatGptExportModal() {
  const modal = document.getElementById('chatgpt-export-modal');
  const startInput = document.getElementById('chatgpt-export-start-date');
  const endInput = document.getElementById('chatgpt-export-end-date');
  const message = document.getElementById('chatgpt-export-message');

  if (!modal || !startInput || !endInput) return;

  const today = getTodayDate();
  const currentDate = new Date();
  const firstDay = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;
  startInput.value = startInput.value || firstDay;
  endInput.value = endInput.value || today;
  if (message) message.textContent = '';

  modal.classList.add('show');
}

function closeChatGptExportModal() {
  const modal = document.getElementById('chatgpt-export-modal');
  const message = document.getElementById('chatgpt-export-message');
  if (modal) modal.classList.remove('show');
  if (message) message.textContent = '';
}

async function exportToChatGPT() {
  const startInput = document.getElementById('chatgpt-export-start-date');
  const endInput = document.getElementById('chatgpt-export-end-date');
  const message = document.getElementById('chatgpt-export-message');
  const button = document.getElementById('chatgpt-export-confirm-btn');
  const startDate = String(startInput?.value || '').trim();
  const endDate = String(endInput?.value || '').trim();

  const setModalMessage = (text) => {
    if (message) message.textContent = text;
  };

  if (!startDate || !endDate) {
    setModalMessage('يرجى تحديد تاريخ البداية والنهاية');
    return;
  }

  if (startDate > endDate) {
    setModalMessage('فترة زمنية غير صحيحة');
    return;
  }

  try {
    setModalMessage('');
    if (button) button.disabled = true;
    const result = await ipcRenderer.invoke('export-chatgpt-csv', { startDate, endDate });

    if (result?.success) {
      closeChatGptExportModal();
      const rowsText = Number(result.rowCount) === 1 ? 'صف واحد' : `${result.rowCount || 0} صف`;
      showMessage(`تم تصدير ملف ChatGPT CSV بنجاح (${rowsText})`, 'success');
    } else if (!result?.canceled) {
      showMessage('حدث خطأ أثناء تصدير ملف ChatGPT', 'error');
      setModalMessage(result?.error || 'حدث خطأ أثناء التصدير');
    }
  } catch (error) {
    showMessage('حدث خطأ أثناء تصدير ملف ChatGPT', 'error');
    setModalMessage('حدث خطأ أثناء التصدير');
    console.error('Error exporting ChatGPT CSV:', error);
  } finally {
    if (button) button.disabled = false;
  }
}

function importBackup() {
  const fileInput = document.getElementById('backup-file-input');
  fileInput.click();
}

async function handleBackupFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backupData = JSON.parse(e.target.result);
        const result = await ipcRenderer.invoke('import-backup', backupData);
        if (result.success) {
          showMessage('تم استيراد النسخة الاحتياطية بنجاح', 'success');
          // Reload the page to reflect changes
          setTimeout(() => {
            location.reload();
          }, 2000);
        } else {
          showMessage('حدث خطأ أثناء استيراد النسخة الاحتياطية', 'error');
        }
      } catch (error) {
        showMessage('ملف النسخة الاحتياطية غير صالح', 'error');
        console.error('Error parsing backup file:', error);
      }
    };
    reader.readAsText(file);
  } catch (error) {
    showMessage('حدث خطأ أثناء قراءة الملف', 'error');
    console.error('Error reading backup file:', error);
  }
}

function normalizeExcelText(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\u0640/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExcelProductKey(value) {
  return normalizeExcelText(value).toLowerCase().replace(/\s+/g, '');
}

function isExcelWashLubeProduct(value) {
  const key = normalizeExcelProductKey(value).replace(/[^\p{L}\p{N}]/gu, '');
  return key === 'غسيلوتشحيم' || key === 'غسيلتشحيم';
}

function normalizeExcelHeader(value) {
  return normalizeExcelText(value).toLowerCase().replace(/\s+/g, '');
}

function parseExcelNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = normalizeExcelText(value)
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');

  if (!text || text === '-' || text === '.') {
    return null;
  }

  const parsed = parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDateFromParts(year, month, day) {
  const fullYear = year < 100 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== fullYear ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${fullYear.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseExcelSalesDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDateFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number' && XLSX?.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return toIsoDateFromParts(parsed.y, parsed.m, parsed.d);
    }
  }

  const text = normalizeExcelText(value);
  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    return toIsoDateFromParts(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10), parseInt(isoMatch[3], 10));
  }

  const dayMonthYearMatch = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dayMonthYearMatch) {
    return toIsoDateFromParts(
      parseInt(dayMonthYearMatch[3], 10),
      parseInt(dayMonthYearMatch[2], 10),
      parseInt(dayMonthYearMatch[1], 10)
    );
  }

  return null;
}

function getExcelHeaderIndex(headers, acceptedNames) {
  const accepted = acceptedNames.map(normalizeExcelHeader);
  return headers.findIndex((header) => accepted.includes(normalizeExcelHeader(header)));
}

function getExcelProductOptionsHtml(selectedValue = '') {
  const options = ['<option value="">اختر منتج موجود</option>'];
  excelSalesImportState.products.forEach((product) => {
    const value = `${product.type}\u001f${product.name}`;
    options.push(
      `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(product.name)} - ${product.type === 'fuel' ? 'وقود' : 'زيت'}</option>`
    );
  });
  return options.join('');
}

function findExcelProductMatch(name) {
  if (isExcelWashLubeProduct(name)) {
    return { type: 'wash_lube', name: 'غسيل و تشحيم', key: 'wash_lube' };
  }

  const key = normalizeExcelProductKey(name);
  if (!key) return null;

  const exact = excelSalesImportState.products.find((product) => product.name === String(name || '').trim());
  if (exact) return exact;

  return excelSalesImportState.products.find((product) => product.key === key) || null;
}

async function loadExcelSalesImportProducts() {
  try {
    const [fuelRows, oilRows] = await Promise.all([
      ipcRenderer.invoke('get-fuel-prices'),
      ipcRenderer.invoke('get-oil-prices')
    ]);

    const fuelProducts = Array.isArray(fuelRows)
      ? fuelRows.map((row) => ({
          type: 'fuel',
          name: String(row.fuel_type || '').trim(),
          price: parseFloat(row.price) || 0
        }))
      : [];
    const oilProducts = Array.isArray(oilRows)
      ? oilRows.map((row) => ({
          type: 'oil',
          name: String(row.oil_type || '').trim(),
          price: parseFloat(row.price) || 0
        }))
      : [];

    excelSalesImportState.products = [...fuelProducts, ...oilProducts]
      .filter((product) => product.name)
      .map((product) => ({
        ...product,
        key: normalizeExcelProductKey(product.name)
      }));

    renderExcelSalesUnknownProducts();
  } catch (error) {
    console.error('Error loading products for Excel import:', error);
    setExcelSalesImportStatus('حدث خطأ أثناء تحميل المنتجات', 'error');
  }
}

function setExcelSalesImportStatus(message, type = '') {
  const status = document.getElementById('excel-sales-import-status');
  if (!status) return;

  status.className = `excel-import-status${type ? ` ${type}` : ''}`;
  status.textContent = message;
}

function openExcelSalesFilePicker() {
  const input = document.getElementById('excel-sales-file-input');
  if (!input) return;
  input.value = '';
  input.click();
}

function resetExcelSalesImport() {
  excelSalesImportState = {
    fileName: '',
    rawRows: [],
    parsedRows: [],
    products: excelSalesImportState.products || [],
    resolutions: {},
    validationErrors: [],
    conflicts: []
  };

  const fileInput = document.getElementById('excel-sales-file-input');
  if (fileInput) fileInput.value = '';

  setExcelSalesImportStatus('اختر ملف Excel يحتوي على الأعمدة الإلزامية: اليوم، الصنف، الكمية، السعر. الأعمدة الاختيارية: سايب، عيارات، عملاء. تعرض المعاينة أيضاً النوع والإجمالي المحسوب.');
  renderExcelSalesSummary();
  renderExcelSalesUnknownProducts();
  renderExcelSalesPreview();
}

async function handleExcelSalesFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!XLSX) {
    setExcelSalesImportStatus('مكتبة قراءة Excel غير متاحة. تأكد من تثبيت xlsx.', 'error');
    return;
  }

  try {
    await loadExcelSalesImportProducts();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('empty_workbook');
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      raw: true,
      defval: ''
    });

    const parsedRows = parseExcelSalesRows(rows);
    excelSalesImportState.fileName = file.name;
    excelSalesImportState.rawRows = parsedRows;
    excelSalesImportState.resolutions = {};
    await refreshExcelSalesImportPreview();
  } catch (error) {
    console.error('Error reading Excel sales file:', error);
    setExcelSalesImportStatus('تعذر قراءة ملف Excel. تأكد من أن الأعمدة موجودة وأن الملف غير تالف.', 'error');
    excelSalesImportState.rawRows = [];
    excelSalesImportState.parsedRows = [];
    renderExcelSalesSummary();
    renderExcelSalesUnknownProducts();
    renderExcelSalesPreview();
  }
}

function parseExcelSalesRows(rows) {
  const headerRowIndex = rows.findIndex((row) => {
    const headers = Array.isArray(row) ? row : [];
    return getExcelHeaderIndex(headers, ['اليوم']) !== -1 && getExcelHeaderIndex(headers, ['الصنف']) !== -1;
  });

  if (headerRowIndex === -1) {
    throw new Error('missing_headers');
  }

  const headers = rows[headerRowIndex];
  const indexes = {
    date: getExcelHeaderIndex(headers, ['اليوم']),
    product: getExcelHeaderIndex(headers, ['الصنف']),
    quantity: getExcelHeaderIndex(headers, ['الكمية']),
    open: getExcelHeaderIndex(headers, ['سايب']),
    cars: getExcelHeaderIndex(headers, ['عيارات']),
    clients: getExcelHeaderIndex(headers, ['عملاء']),
    price: getExcelHeaderIndex(headers, ['السعر'])
  };

  const missingRequired = ['date', 'product', 'quantity', 'price'].filter((key) => indexes[key] === -1);
  if (missingRequired.length > 0) {
    throw new Error(`missing_required_headers:${missingRequired.join(',')}`);
  }

  return rows.slice(headerRowIndex + 1).map((row, offset) => {
    const sourceRowNumber = headerRowIndex + offset + 2;
    const rawProductName = String(row[indexes.product] || '').trim();
    const date = parseExcelSalesDate(row[indexes.date]);
    const quantity = parseExcelNumber(row[indexes.quantity]);
    const open = indexes.open === -1 ? 0 : parseExcelNumber(row[indexes.open]) ?? 0;
    const cars = indexes.cars === -1 ? 0 : parseExcelNumber(row[indexes.cars]) ?? 0;
    const clients = indexes.clients === -1 ? 0 : parseExcelNumber(row[indexes.clients]) ?? 0;
    const price = parseExcelNumber(row[indexes.price]);
    const empty = !rawProductName && !date && quantity === null && price === null;

    return {
      sourceRowNumber,
      rawProductName,
      date,
      quantity,
      open,
      cars,
      clients,
      price,
      empty,
      errors: []
    };
  }).filter((row) => !row.empty);
}

function getExcelSalesUnknownKeys() {
  const unknownMap = new Map();
  excelSalesImportState.rawRows.forEach((row) => {
    const key = normalizeExcelProductKey(row.rawProductName);
    if (!key || isExcelWashLubeProduct(row.rawProductName) || findExcelProductMatch(row.rawProductName) || excelSalesImportState.resolutions[key]) {
      return;
    }

    if (!unknownMap.has(key)) {
      unknownMap.set(key, {
        key,
        name: row.rawProductName,
        price: row.price,
        date: row.date
      });
    }
  });

  return Array.from(unknownMap.values());
}

function validateExcelSalesRows(rows) {
  const errors = [];
  const priceByGroup = new Map();

  rows.forEach((row) => {
    row.errors = [];
    if (!row.date) row.errors.push('تاريخ غير صالح');
    if (!row.rawProductName) row.errors.push('اسم المنتج مفقود');
    if (!Number.isFinite(row.quantity) && row.product?.type !== 'wash_lube') {
      row.errors.push('كمية غير صالحة');
    }
    if (
      row.product?.type !== 'wash_lube' &&
      row.product?.name !== 'غاز سيارات' &&
      (!Number.isFinite(row.price) || row.price <= 0)
    ) {
      row.errors.push('سعر غير صالح');
    }
    if (row.product && row.date && row.product.type !== 'wash_lube' && row.product.name !== 'غاز سيارات') {
      const groupKey = `${row.date}\u001f${row.product.type}\u001f${normalizeExcelProductKey(row.product.name)}`;
      const previousPrice = priceByGroup.get(groupKey);
      if (previousPrice !== undefined && Math.abs(previousPrice - row.price) > 0.0001) {
        row.errors.push('نفس المنتج في نفس التاريخ له أكثر من سعر');
      } else {
        priceByGroup.set(groupKey, row.price);
      }
    }

    if (row.errors.length > 0) {
      errors.push(`صف ${row.sourceRowNumber}: ${row.errors.join('، ')}`);
    }
  });

  return errors;
}

async function refreshExcelSalesImportPreview() {
  const parsedRows = excelSalesImportState.rawRows.map((row) => {
    const unknownKey = normalizeExcelProductKey(row.rawProductName);
    const resolution = excelSalesImportState.resolutions[unknownKey];
    const product = resolution || findExcelProductMatch(row.rawProductName);
    return {
      ...row,
      product,
      productName: product?.name || row.rawProductName,
      productType: product?.type || ''
    };
  });

  excelSalesImportState.parsedRows = parsedRows;
  excelSalesImportState.validationErrors = validateExcelSalesRows(parsedRows);
  await refreshExcelSalesConflicts();
  renderExcelSalesSummary();
  renderExcelSalesUnknownProducts();
  renderExcelSalesPreview();
  updateExcelSalesImportButton();
}

function hasExcelSalesData(existingShift) {
  if (!existingShift) return false;

  const legacyData = parseShiftJsonValue(existingShift.data, {});
  const fuelData = parseShiftJsonValue(existingShift.fuel_data ?? legacyData.fuel_data, {});
  const oilData = parseShiftJsonValue(existingShift.oil_data ?? legacyData.oil_data, {});
  const fuelTotal = parseFloat(existingShift.fuel_total ?? legacyData.fuel_total) || 0;
  const oilTotal = parseFloat(existingShift.oil_total ?? legacyData.oil_total) || 0;
  const washLubeRevenue = parseFloat(existingShift.wash_lube_revenue ?? legacyData.wash_lube_revenue) || 0;

  return Object.keys(fuelData).length > 0
    || Object.keys(oilData).length > 0
    || Math.abs(fuelTotal) > 0.0001
    || Math.abs(oilTotal) > 0.0001
    || Math.abs(washLubeRevenue) > 0.0001;
}

async function refreshExcelSalesConflicts() {
  const dates = Array.from(new Set(
    excelSalesImportState.parsedRows
      .map((row) => row.date)
      .filter(Boolean)
  ));
  const conflicts = [];

  for (const date of dates) {
    try {
      const existing = await ipcRenderer.invoke('get-saved-shift', { date, shift_number: 1 });
      if (hasExcelSalesData(existing)) {
        conflicts.push(date);
      }
    } catch (error) {
      console.warn('Unable to check existing shift for Excel import:', date, error);
    }
  }

  excelSalesImportState.conflicts = conflicts;
}

function renderExcelSalesSummary() {
  const container = document.getElementById('excel-sales-summary');
  if (!container) return;

  if (excelSalesImportState.rawRows.length === 0) {
    container.style.display = 'none';
    return;
  }

  const unresolvedCount = getExcelSalesUnknownKeys().length;
  const datesCount = new Set(excelSalesImportState.parsedRows.map((row) => row.date).filter(Boolean)).size;
  const conflictsCount = excelSalesImportState.conflicts.length;

  container.style.display = 'grid';
  container.innerHTML = `
    <div class="excel-import-summary-item"><strong>${convertToArabicNumerals(excelSalesImportState.rawRows.length)}</strong>صفوف مقروءة</div>
    <div class="excel-import-summary-item"><strong>${convertToArabicNumerals(datesCount)}</strong>تواريخ</div>
    <div class="excel-import-summary-item"><strong>${convertToArabicNumerals(unresolvedCount)}</strong>منتجات تحتاج مراجعة</div>
    <div class="excel-import-summary-item"><strong>${convertToArabicNumerals(conflictsCount)}</strong>مبيعات موجودة مسبقاً</div>
  `;

  if (excelSalesImportState.validationErrors.length > 0) {
    setExcelSalesImportStatus(excelSalesImportState.validationErrors.slice(0, 4).join(' | '), 'error');
  } else if (unresolvedCount > 0) {
    setExcelSalesImportStatus('راجع المنتجات غير الموجودة قبل الاستيراد.', 'error');
  } else if (conflictsCount > 0) {
    setExcelSalesImportStatus(`تم تجهيز الملف: توجد مبيعات محفوظة مسبقاً في ${convertToArabicNumerals(conflictsCount)} من أصل ${convertToArabicNumerals(datesCount)} تاريخ، وسيطلب البرنامج تأكيد قبل الكتابة فوقها.`);
  } else {
    setExcelSalesImportStatus(`تم تجهيز الملف: ${excelSalesImportState.fileName}`, 'success');
  }
}

function renderExcelSalesUnknownProducts() {
  const wrapper = document.getElementById('excel-sales-unknown-products');
  const list = document.getElementById('excel-sales-unknown-products-list');
  if (!wrapper || !list) return;

  const unknownProducts = getExcelSalesUnknownKeys();
  if (unknownProducts.length === 0) {
    wrapper.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  wrapper.style.display = 'block';
  list.innerHTML = unknownProducts.map((item) => `
    <div class="excel-import-unknown-row" data-key="${escapeHtml(item.key)}">
      <div class="excel-import-unknown-grid">
        <div>
          <label>الاسم المقروء</label>
          <div>${escapeHtml(item.name)}</div>
        </div>
        <div>
          <label>ربط بمنتج موجود</label>
          <select data-action="existing-product">${getExcelProductOptionsHtml()}</select>
        </div>
        <div>
          <label>تصحيح الاسم</label>
          <input type="text" data-action="corrected-name" value="${escapeHtml(item.name)}">
        </div>
        <button type="button" class="btn btn-secondary" data-action="match-corrected">تطبيق</button>
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" class="btn btn-primary" data-action="add-fuel">إضافة كوقود</button>
          <button type="button" class="btn btn-primary" data-action="add-oil">إضافة كزيت</button>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('select[data-action="existing-product"]').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const row = event.target.closest('.excel-import-unknown-row');
      const key = row?.dataset.key;
      const value = event.target.value;
      if (!key || !value) return;

      const [type, name] = value.split('\u001f');
      excelSalesImportState.resolutions[key] = { type, name, key: normalizeExcelProductKey(name) };
      await refreshExcelSalesImportPreview();
    });
  });

  list.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const row = button.closest('.excel-import-unknown-row');
      const key = row?.dataset.key;
      const correctedName = row?.querySelector('input[data-action="corrected-name"]')?.value?.trim() || '';
      if (!key) return;

      if (action === 'match-corrected') {
        const match = findExcelProductMatch(correctedName);
        if (!match) {
          showMessage('لم يتم العثور على منتج بهذا الاسم المصحح', 'error');
          return;
        }
        excelSalesImportState.resolutions[key] = match;
        await refreshExcelSalesImportPreview();
        return;
      }

      if (action === 'add-fuel' || action === 'add-oil') {
        await addExcelImportProduct(key, correctedName, action === 'add-fuel' ? 'fuel' : 'oil', button);
      }
    });
  });
}

async function addExcelImportProduct(key, productName, productType, button) {
  if (!productName) {
    showMessage('يرجى إدخال اسم المنتج', 'error');
    return;
  }

  const sourceRow = excelSalesImportState.rawRows.find((row) => normalizeExcelProductKey(row.rawProductName) === key);
  const price = sourceRow?.price;
  const startDate = sourceRow?.date;
  if (!Number.isFinite(price) || price <= 0 || !startDate) {
    showMessage('لا يمكن إضافة المنتج بدون سعر وتاريخ صحيح من Excel', 'error');
    return;
  }

  try {
    if (button) button.disabled = true;
    const result = await ipcRenderer.invoke('add-excel-import-product', {
      product_type: productType,
      product_name: productName,
      price,
      start_date: startDate
    });

    if (!result?.success) {
      throw new Error(result?.error || 'add_failed');
    }

    await loadExcelSalesImportProducts();
    const match = findExcelProductMatch(productName) || { type: productType, name: productName, key: normalizeExcelProductKey(productName) };
    excelSalesImportState.resolutions[key] = match;
    showMessage('تم إضافة المنتج بنجاح', 'success');
    await refreshExcelSalesImportPreview();
  } catch (error) {
    console.error('Error adding Excel import product:', error);
    showMessage(error.message || 'حدث خطأ أثناء إضافة المنتج', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderExcelSalesPreview() {
  const wrapper = document.getElementById('excel-sales-preview');
  const body = document.getElementById('excel-sales-preview-body');
  if (!wrapper || !body) return;

  if (excelSalesImportState.parsedRows.length === 0) {
    wrapper.style.display = 'none';
    body.innerHTML = '';
    updateExcelSalesImportButton();
    return;
  }

  wrapper.style.display = 'block';
  body.innerHTML = excelSalesImportState.parsedRows.map((row) => {
    const typeLabel = row.productType === 'fuel'
      ? 'وقود'
      : row.productType === 'oil'
        ? 'زيت'
        : row.productType === 'wash_lube'
          ? 'غسيل و تشحيم'
          : 'غير معروف';
    const lineTotal = row.productType === 'fuel'
      ? row.productName === 'غاز سيارات'
        ? 0
        : ((row.quantity || 0) - ((row.clients || 0) + (row.cars || 0))) * (row.price || 0)
      : row.productType === 'oil'
        ? ((row.quantity || 0) - ((row.clients || 0) + (row.open || 0))) * (row.price || 0)
        : (row.quantity || 0);
    return `
      <tr class="${row.errors?.length ? 'excel-import-row-error' : ''}">
        <td>${convertToArabicNumerals(row.sourceRowNumber || '')}</td>
        <td>${escapeHtml(row.date || '')}</td>
        <td>${escapeHtml(row.productName || row.rawProductName || '')}</td>
        <td>${typeLabel}</td>
        <td>${formatPrice(row.quantity || 0)}</td>
        <td>${formatPrice(row.open || 0)}</td>
        <td>${formatPrice(row.cars || 0)}</td>
        <td>${formatPrice(row.clients || 0)}</td>
        <td>${formatPrice(row.price || 0)}</td>
        <td>${formatPrice(lineTotal)}</td>
      </tr>
    `;
  }).join('');

  updateExcelSalesImportButton();
}

function updateExcelSalesImportButton() {
  const button = document.getElementById('excel-sales-import-btn');
  if (!button) return;

  button.disabled =
    excelSalesImportState.parsedRows.length === 0 ||
    getExcelSalesUnknownKeys().length > 0 ||
    excelSalesImportState.validationErrors.length > 0;
}

async function buildExcelSalesShiftPayloads() {
  const shiftsByDate = new Map();

  excelSalesImportState.parsedRows.forEach((row) => {
    if (!row.product || !row.date) return;

    if (!shiftsByDate.has(row.date)) {
      shiftsByDate.set(row.date, {
        date: row.date,
        shift_number: 1,
        fuelRows: new Map(),
        oilRows: new Map(),
        washLubeRevenue: 0
      });
    }

    const shift = shiftsByDate.get(row.date);
    if (row.product.type === 'wash_lube') {
      shift.washLubeRevenue += Number.isFinite(row.quantity) ? row.quantity : 0;
      return;
    }

    const targetMap = row.product.type === 'fuel' ? shift.fuelRows : shift.oilRows;
    const key = normalizeExcelProductKey(row.product.name);
    if (!targetMap.has(key)) {
      targetMap.set(key, {
        name: row.product.name,
        quantity: 0,
        open: 0,
        cars: 0,
        clients: 0,
        price: row.price
      });
    }

    const item = targetMap.get(key);
    item.quantity += row.quantity || 0;
    item.open += row.open || 0;
    item.cars += row.cars || 0;
    item.clients += row.clients || 0;
  });

  const payloads = [];

  for (const shift of shiftsByDate.values()) {
    const fuelData = {};
    let fuelTotal = 0;
    shift.fuelRows.forEach((item) => {
      const isGasCars = item.name === 'غاز سيارات';
      const cash = isGasCars ? 0 : (item.quantity - (item.clients + item.cars)) * item.price;
      fuelTotal += cash;
      const base = {
        lastShift1: 0,
        firstShift1: 0,
        lastShift2: 0,
        firstShift2: 0,
        quantity1: 0,
        quantity2: 0,
        totalQuantity: item.quantity,
        clients: item.clients,
        cars: item.cars,
        price: isGasCars ? 0 : item.price,
        cash
      };

      if (item.name === 'سولار') {
        base.lastShift3 = 0;
        base.firstShift3 = 0;
        base.lastShift4 = 0;
        base.firstShift4 = 0;
        base.quantity3 = 0;
        base.quantity4 = 0;
      }

      fuelData[item.name] = base;
    });

    const oilData = {};
    let oilTotal = 0;
    shift.oilRows.forEach((item) => {
      const revenue = (item.quantity - (item.clients + item.open)) * item.price;
      oilTotal += revenue;
      oilData[item.name] = {
        initial: item.quantity,
        added: 0,
        total: item.quantity,
        sold: item.quantity,
        remaining: 0,
        open: item.open,
        customers: item.clients,
        price: item.price,
        revenue
      };
    });

    const washLubeRevenue = shift.washLubeRevenue || 0;
    let existingShift = null;
    try {
      existingShift = await ipcRenderer.invoke('get-saved-shift', { date: shift.date, shift_number: 1 });
    } catch (error) {
      console.warn('Unable to preserve existing shift details during Excel sales import:', shift.date, error);
    }

    const legacyData = parseShiftJsonValue(existingShift?.data, {});
    const existingExpenseItems = normalizeExpenseItems(legacyData.expense_items);
    const existingTotalExpenses = parseFloat(existingShift?.total_expenses ?? legacyData.total_expenses) || 0;
    const effectiveExpenseItems = existingExpenseItems.length > 0
      ? existingExpenseItems
      : existingTotalExpenses > 0
        ? [{ index: 1, description: LEGACY_AGGREGATED_EXPENSE_LABEL, amount: existingTotalExpenses }]
        : [];
    const revenueItems = normalizeRevenueItems(legacyData.revenue_items);
    const customerRows = Array.isArray(legacyData.customer_rows) ? legacyData.customer_rows : [];
    const extraRevenueTotal = revenueItems.reduce((sum, item) => sum + (parseFloat(item?.amount) || 0), 0);
    const grandTotal = fuelTotal + oilTotal + washLubeRevenue + extraRevenueTotal - existingTotalExpenses;

    payloads.push({
      date: shift.date,
      shift_number: 1,
      fuel_data: JSON.stringify(fuelData),
      fuel_total: fuelTotal,
      oil_data: JSON.stringify(oilData),
      oil_total: oilTotal,
      customer_rows: customerRows,
      revenue_items: revenueItems,
      expense_items: effectiveExpenseItems,
      wash_lube_revenue: washLubeRevenue,
      total_expenses: existingTotalExpenses,
      grand_total: grandTotal,
      is_saved: 1
    });
  }

  return payloads;
}

async function refreshViewsAfterExcelSalesImport() {
  await Promise.allSettled([
    loadHomeChart(),
    loadTodayStats(),
    loadSafeBookMovements()
  ]);

  if (currentScreen === 'sales-summary') {
    await loadSalesSummary().catch((error) => {
      console.warn('Unable to refresh sales summary after Excel import:', error);
    });
  }
}

async function importExcelSales() {
  try {
    await refreshExcelSalesImportPreview();
    if (getExcelSalesUnknownKeys().length > 0) {
      showMessage('راجع المنتجات غير الموجودة قبل الاستيراد', 'error');
      return;
    }

    if (excelSalesImportState.validationErrors.length > 0) {
      showMessage('يوجد أخطاء في بيانات Excel', 'error');
      return;
    }

    const payloads = await buildExcelSalesShiftPayloads();
    if (payloads.length === 0) {
      showMessage('لا توجد بيانات صالحة للاستيراد', 'error');
      return;
    }

    if (excelSalesImportState.conflicts.length > 0) {
      const dates = excelSalesImportState.conflicts.join(', ');
      const confirmed = confirm(`توجد مبيعات محفوظة بالفعل في وردية رقم 1 لهذه التواريخ:\n${dates}\n\nهل تريد الكتابة فوق بيانات المبيعات؟`);
      if (!confirmed) return;
    }

    const button = document.getElementById('excel-sales-import-btn');
    if (button) button.disabled = true;

    let saved = 0;
    for (const payload of payloads) {
      const result = await ipcRenderer.invoke('save-shift', payload);
      if (!result?.success) {
        throw new Error(result?.validationErrors?.join('\n') || result?.error || 'save_failed');
      }
      saved += 1;
    }

    showMessage('تم استيراد مبيعات Excel بنجاح', 'success');
    await refreshViewsAfterExcelSalesImport();
    resetExcelSalesImport();
    setExcelSalesImportStatus(`تم استيراد ${convertToArabicNumerals(saved)} وردية بنجاح`, 'success');
  } catch (error) {
    console.error('Error importing Excel sales:', error);
    showMessage(error.message || 'حدث خطأ أثناء استيراد مبيعات Excel', 'error');
    updateExcelSalesImportButton();
  }
}

function setExcelExpensesImportStatus(message, type = '') {
  const status = document.getElementById('excel-expenses-import-status');
  if (!status) return;

  status.className = `excel-import-status${type ? ` ${type}` : ''}`;
  status.textContent = message;
}

function openExcelExpensesFilePicker() {
  const input = document.getElementById('excel-expenses-file-input');
  if (!input) return;
  input.value = '';
  input.click();
}

function resetExcelExpensesImport() {
  excelExpensesImportState = {
    fileName: '',
    rawRows: [],
    parsedRows: [],
    validationErrors: []
  };

  const fileInput = document.getElementById('excel-expenses-file-input');
  if (fileInput) fileInput.value = '';

  setExcelExpensesImportStatus('اختر ملف Excel يحتوي على الأعمدة: التاريخ، المصروف، المبلغ.');
  renderExcelExpensesSummary();
  renderExcelExpensesPreview();
  updateExcelExpensesImportButton();
}

async function handleExcelExpensesFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!XLSX) {
    setExcelExpensesImportStatus('مكتبة قراءة Excel غير متاحة. تأكد من تثبيت xlsx.', 'error');
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('empty_workbook');
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      raw: true,
      defval: ''
    });

    const parsedRows = parseExcelExpensesRows(rows);
    excelExpensesImportState.fileName = file.name;
    excelExpensesImportState.rawRows = parsedRows;
    await refreshExcelExpensesImportPreview();
  } catch (error) {
    console.error('Error reading Excel expenses file:', error);
    setExcelExpensesImportStatus('تعذر قراءة ملف Excel. تأكد من وجود أعمدة التاريخ والمصروف والمبلغ.', 'error');
    excelExpensesImportState.rawRows = [];
    excelExpensesImportState.parsedRows = [];
    renderExcelExpensesSummary();
    renderExcelExpensesPreview();
    updateExcelExpensesImportButton();
  }
}

function parseExcelExpensesRows(rows) {
  const headerRowIndex = rows.findIndex((row) => {
    const headers = Array.isArray(row) ? row : [];
    return getExcelHeaderIndex(headers, ['التاريخ', 'اليوم', 'date']) !== -1
      && getExcelHeaderIndex(headers, ['المصروف', 'المصاريف', 'spesa', 'expense']) !== -1;
  });

  if (headerRowIndex === -1) {
    throw new Error('missing_headers');
  }

  const headers = rows[headerRowIndex];
  const indexes = {
    date: getExcelHeaderIndex(headers, ['التاريخ', 'اليوم', 'date']),
    description: getExcelHeaderIndex(headers, ['المصروف', 'المصاريف', 'spesa', 'expense']),
    amount: getExcelHeaderIndex(headers, ['المبلغ', 'القيمة', 'importo', 'amount'])
  };

  const missingRequired = ['date', 'description', 'amount'].filter((key) => indexes[key] === -1);
  if (missingRequired.length > 0) {
    throw new Error(`missing_required_headers:${missingRequired.join(',')}`);
  }

  return rows.slice(headerRowIndex + 1).map((row, offset) => {
    const sourceRowNumber = headerRowIndex + offset + 2;
    const description = String(row[indexes.description] || '').trim();
    const date = parseExcelSalesDate(row[indexes.date]);
    const amount = parseExcelNumber(row[indexes.amount]);
    const empty = !description && !date && amount === null;

    return {
      sourceRowNumber,
      date,
      description,
      amount,
      empty,
      errors: []
    };
  }).filter((row) => !row.empty);
}

function validateExcelExpensesRows(rows) {
  const errors = [];

  rows.forEach((row) => {
    row.errors = [];
    if (!row.date) row.errors.push('تاريخ غير صالح');
    if (!Number.isFinite(row.amount) || row.amount <= 0) row.errors.push('مبلغ غير صالح');

    if (row.errors.length > 0) {
      errors.push(`صف ${row.sourceRowNumber}: ${row.errors.join('، ')}`);
    }
  });

  return errors;
}

async function refreshExcelExpensesImportPreview() {
  excelExpensesImportState.parsedRows = excelExpensesImportState.rawRows.map((row) => ({ ...row }));
  excelExpensesImportState.validationErrors = validateExcelExpensesRows(excelExpensesImportState.parsedRows);
  renderExcelExpensesSummary();
  renderExcelExpensesPreview();
  updateExcelExpensesImportButton();
}

function renderExcelExpensesSummary() {
  const container = document.getElementById('excel-expenses-summary');
  if (!container) return;

  if (excelExpensesImportState.rawRows.length === 0) {
    container.style.display = 'none';
    return;
  }

  const datesCount = new Set(excelExpensesImportState.parsedRows.map((row) => row.date).filter(Boolean)).size;
  const totalAmount = excelExpensesImportState.parsedRows.reduce((sum, row) => (
    sum + (Number.isFinite(row.amount) ? row.amount : 0)
  ), 0);

  container.style.display = 'grid';
  container.innerHTML = `
    <div class="excel-import-summary-item"><strong>${convertToArabicNumerals(excelExpensesImportState.rawRows.length)}</strong>صفوف مقروءة</div>
    <div class="excel-import-summary-item"><strong>${convertToArabicNumerals(datesCount)}</strong>تواريخ</div>
    <div class="excel-import-summary-item"><strong>${formatPrice(totalAmount)}</strong>إجمالي المصاريف</div>
  `;

  if (excelExpensesImportState.validationErrors.length > 0) {
    setExcelExpensesImportStatus(excelExpensesImportState.validationErrors.slice(0, 4).join(' | '), 'error');
  } else {
    setExcelExpensesImportStatus(`تم تجهيز الملف: ${excelExpensesImportState.fileName}`, 'success');
  }
}

function renderExcelExpensesPreview() {
  const wrapper = document.getElementById('excel-expenses-preview');
  const body = document.getElementById('excel-expenses-preview-body');
  if (!wrapper || !body) return;

  if (excelExpensesImportState.parsedRows.length === 0) {
    wrapper.style.display = 'none';
    body.innerHTML = '';
    updateExcelExpensesImportButton();
    return;
  }

  wrapper.style.display = 'block';
  body.innerHTML = excelExpensesImportState.parsedRows.map((row) => `
    <tr class="${row.errors?.length ? 'excel-import-row-error' : ''}">
      <td>${convertToArabicNumerals(row.sourceRowNumber || '')}</td>
      <td>${escapeHtml(row.date || '')}</td>
      <td>${escapeHtml(row.description || 'غير محدد')}</td>
      <td>${formatPrice(row.amount || 0)}</td>
    </tr>
  `).join('');

  updateExcelExpensesImportButton();
}

function updateExcelExpensesImportButton() {
  const button = document.getElementById('excel-expenses-import-btn');
  if (!button) return;

  button.disabled =
    excelExpensesImportState.parsedRows.length === 0 ||
    excelExpensesImportState.validationErrors.length > 0;
}

function parseShiftJsonValue(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function groupExcelExpensesByDate() {
  const grouped = new Map();

  excelExpensesImportState.parsedRows.forEach((row) => {
    if (!row.date || !Number.isFinite(row.amount) || row.amount <= 0) return;
    if (!grouped.has(row.date)) {
      grouped.set(row.date, []);
    }
    grouped.get(row.date).push({
      index: grouped.get(row.date).length + 1,
      description: row.description || 'غير محدد',
      amount: row.amount
    });
  });

  return grouped;
}

async function buildExcelExpenseShiftPayload(date, importedExpenseItems) {
  const existingShift = await ipcRenderer.invoke('get-saved-shift', { date, shift_number: 1 });
  const legacyData = parseShiftJsonValue(existingShift?.data, {});
  const existingExpenses = normalizeExpenseItems(legacyData.expense_items);
  const existingTotalExpenses = parseFloat(existingShift?.total_expenses ?? legacyData.total_expenses) || 0;

  const preservedFuelData = existingShift
    ? (existingShift.fuel_data || legacyData.fuel_data || '{}')
    : '{}';
  const preservedOilData = existingShift
    ? (existingShift.oil_data || legacyData.oil_data || '{}')
    : '{}';
  const preservedFuelTotal = parseFloat(existingShift?.fuel_total ?? legacyData.fuel_total) || 0;
  const preservedOilTotal = parseFloat(existingShift?.oil_total ?? legacyData.oil_total) || 0;
  const preservedWashLubeRevenue = parseFloat(existingShift?.wash_lube_revenue ?? legacyData.wash_lube_revenue) || 0;
  const preservedCustomerRows = Array.isArray(legacyData.customer_rows) ? legacyData.customer_rows : [];
  const preservedRevenueItems = Array.isArray(legacyData.revenue_items) ? legacyData.revenue_items : [];
  const effectiveExistingExpenses = existingExpenses.length > 0
    ? existingExpenses
    : existingTotalExpenses > 0
      ? [{ index: 1, description: LEGACY_AGGREGATED_EXPENSE_LABEL, amount: existingTotalExpenses }]
      : [];

  const baseIndex = effectiveExistingExpenses.length;
  const mergedExpenseItems = [
    ...effectiveExistingExpenses,
    ...importedExpenseItems.map((item, index) => ({
      index: baseIndex + index + 1,
      description: item.description,
      amount: item.amount
    }))
  ];
  const importedTotalExpenses = importedExpenseItems.reduce((sum, item) => sum + item.amount, 0);
  const totalExpenses = existingTotalExpenses + importedTotalExpenses;
  const extraRevenueTotal = preservedRevenueItems.reduce((sum, item) => (
    sum + (parseFloat(item?.amount) || 0)
  ), 0);
  const grandTotal = preservedFuelTotal + preservedOilTotal + preservedWashLubeRevenue + extraRevenueTotal - totalExpenses;

  return {
    date,
    shift_number: 1,
    fuel_data: typeof preservedFuelData === 'string' ? preservedFuelData : JSON.stringify(preservedFuelData),
    fuel_total: preservedFuelTotal,
    oil_data: typeof preservedOilData === 'string' ? preservedOilData : JSON.stringify(preservedOilData),
    oil_total: preservedOilTotal,
    customer_rows: preservedCustomerRows,
    revenue_items: preservedRevenueItems,
    expense_items: mergedExpenseItems,
    wash_lube_revenue: preservedWashLubeRevenue,
    total_expenses: totalExpenses,
    grand_total: grandTotal,
    is_saved: 1
  };
}

async function refreshViewsAfterExcelExpensesImport() {
  await Promise.allSettled([
    loadSafeBookMovements(),
    loadTodayStats()
  ]);

  if (currentScreen === 'expenses') {
    await loadExpenseEntries().catch((error) => {
      console.warn('Unable to refresh expenses after Excel import:', error);
    });
  }
  if (currentScreen === 'profit') {
    await loadProfitMonthlyData().catch((error) => {
      console.warn('Unable to refresh profit after Excel expenses import:', error);
    });
  }
}

async function importExcelExpenses() {
  try {
    await refreshExcelExpensesImportPreview();
    if (excelExpensesImportState.validationErrors.length > 0) {
      showMessage('يوجد أخطاء في بيانات Excel', 'error');
      return;
    }

    const grouped = groupExcelExpensesByDate();
    if (grouped.size === 0) {
      showMessage('لا توجد مصاريف صالحة للاستيراد', 'error');
      return;
    }

    const button = document.getElementById('excel-expenses-import-btn');
    if (button) button.disabled = true;

    let saved = 0;
    for (const [date, expenseItems] of grouped.entries()) {
      const payload = await buildExcelExpenseShiftPayload(date, expenseItems);
      const result = await ipcRenderer.invoke('save-shift', payload);
      if (!result?.success) {
        throw new Error(result?.validationErrors?.join('\n') || result?.error || 'save_failed');
      }
      saved += 1;
    }

    showMessage('تم استيراد مصاريف Excel بنجاح', 'success');
    await refreshViewsAfterExcelExpensesImport();
    resetExcelExpensesImport();
    setExcelExpensesImportStatus(`تم استيراد المصاريف في ${convertToArabicNumerals(saved)} وردية بنجاح`, 'success');
  } catch (error) {
    console.error('Error importing Excel expenses:', error);
    showMessage(error.message || 'حدث خطأ أثناء استيراد مصاريف Excel', 'error');
    updateExcelExpensesImportButton();
  }
}

// Add CSS for report summary grid
const style = document.createElement('style');
style.textContent = `
    .report-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
    }

    .summary-item {
        background: white;
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid #e9ecef;
        text-align: center;
    }
`;
document.head.appendChild(style);

// Invoices List Functions
let allInvoices = [];

async function loadInvoicesList() {
  try {
    // Set default date filters
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    const startDateInput = document.getElementById('invoice-start-date');
    const endDateInput = document.getElementById('invoice-end-date');

    if (startDateInput) startDateInput.value = firstDayOfMonth;
    if (endDateInput) endDateInput.value = today;

    // Load both fuel and oil invoices
    const fuelInvoices = await ipcRenderer.invoke('get-fuel-invoices');
    const oilInvoices = await ipcRenderer.invoke('get-oil-invoices');

    // Process fuel invoices - group by invoice number
    const fuelInvoicesMap = {};
    fuelInvoices.forEach(inv => {
      if (!fuelInvoicesMap[inv.invoice_number]) {
        fuelInvoicesMap[inv.invoice_number] = {
          type: 'fuel',
          date: inv.date,
          invoice_number: inv.invoice_number,
          invoice_total: 0,
          items_subtotal: 0,
          items: []
        };
      }
      const invoiceTotal = parseFloat(inv.invoice_total);
      if (Number.isFinite(invoiceTotal) && invoiceTotal > fuelInvoicesMap[inv.invoice_number].invoice_total) {
        fuelInvoicesMap[inv.invoice_number].invoice_total = invoiceTotal;
      }
      fuelInvoicesMap[inv.invoice_number].items.push(inv);
    });

    // Calculate totals for fuel invoices. The invoice total includes cash deposit.
    Object.values(fuelInvoicesMap).forEach(invoice => {
      invoice.items_subtotal = invoice.items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
      invoice.total = invoice.invoice_total > 0 ? invoice.invoice_total : invoice.items_subtotal;
    });

    // Process oil invoices - group by invoice number and calculate total
    const oilInvoicesMap = {};
    oilInvoices.forEach(inv => {
      if (!oilInvoicesMap[inv.invoice_number]) {
        oilInvoicesMap[inv.invoice_number] = {
          type: 'oil',
          date: inv.date,
          invoice_number: inv.invoice_number,
          immediate_discount: inv.immediate_discount || 0,
          martyrs_tax: inv.martyrs_tax || 0,
          items: []
        };
      }
      oilInvoicesMap[inv.invoice_number].items.push(inv);
    });

    // Calculate totals for oil invoices
    Object.values(oilInvoicesMap).forEach(invoice => {
      let subtotal = invoice.items.reduce((sum, item) => sum + (item.total_purchase || 0), 0);
      invoice.total = subtotal - invoice.immediate_discount + invoice.martyrs_tax;
    });

    // Combine and sort all invoices
    allInvoices = [
      ...Object.values(fuelInvoicesMap),
      ...Object.values(oilInvoicesMap)
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    filterInvoices();
  } catch (error) {
    console.error('Error loading invoices:', error);
    showMessage('حدث خطأ أثناء تحميل الفواتير', 'error');
  }
}

function filterInvoices() {
  const typeFilter = document.getElementById('invoice-type-filter')?.value || 'all';
  const startDate = document.getElementById('invoice-start-date')?.value;
  const endDate = document.getElementById('invoice-end-date')?.value;

  let filtered = allInvoices.filter(inv => {
    // Filter by type
    if (typeFilter !== 'all' && inv.type !== typeFilter) return false;

    // Filter by date range (inclusive)
    if (startDate && inv.date < startDate) return false;
    if (endDate && inv.date > endDate) return false;

    return true;
  });

  displayInvoices(filtered);
}

function displayInvoices(invoices) {
  const tbody = document.getElementById('invoices-list-body');
  const emptyState = document.getElementById('invoices-empty-state');

  if (!tbody) return;

  if (invoices.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = invoices.map(inv => `
    <tr>
      <td>${escapeHtml(inv.date)}</td>
      <td>${escapeHtml(inv.invoice_number)}</td>
      <td>${inv.type === 'fuel' ? 'وقود' : 'زيوت'}</td>
      <td>${formatArabicNumber(inv.total)} جنيه</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="showInvoiceDetails('${escapeInlineJsString(inv.type)}', '${escapeInlineJsString(inv.invoice_number)}')">
          تفاصيل
        </button>
        ${inv.type === 'fuel' ? `
          <button class="btn btn-sm btn-secondary" onclick="editFuelInvoice('${escapeInlineJsString(inv.invoice_number)}')">
            تعديل
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function resetInvoiceFilters() {
  document.getElementById('invoice-type-filter').value = 'all';
  document.getElementById('invoice-start-date').value = '';
  document.getElementById('invoice-end-date').value = '';
  filterInvoices();
}

async function showInvoiceDetails(type, invoiceNumber) {
  const invoice = allInvoices.find(inv => inv.invoice_number === invoiceNumber && inv.type === type);

  if (!invoice) {
    showMessage('لم يتم العثور على الفاتورة', 'error');
    return;
  }

  const detailsContent = document.getElementById('invoice-details-content');

  let html = `
    <div class="invoice-details">
      <div class="invoice-header-info">
        <p><strong>رقم الفاتورة:</strong> ${invoice.invoice_number}</p>
        <p><strong>التاريخ:</strong> ${invoice.date}</p>
        <p><strong>النوع:</strong> ${type === 'fuel' ? 'فاتورة وقود' : 'فاتورة زيوت'}</p>
      </div>

      <h4 style="margin-top: 1.5rem; margin-bottom: 1rem;">العناصر:</h4>
      <table class="invoice-details-table">
        <thead>
          <tr>
  `;

  if (type === 'fuel') {
    html += `
            <th>نوع الوقود</th>
            <th>الكمية</th>
            <th>الكمية الصافية</th>
            <th>سعر الشراء</th>
            <th>الإجمالي</th>
    `;
  } else {
    html += `
            <th>نوع الزيت</th>
            <th>الكمية</th>
            <th>سعر الشراء</th>
            <th>الضريبة (%)</th>
            <th>الإجمالي</th>
    `;
  }

  html += `
          </tr>
        </thead>
        <tbody>
  `;

  invoice.items.forEach(item => {
    html += '<tr>';
    if (type === 'fuel') {
      html += `
        <td>${item.fuel_type}</td>
        <td>${formatArabicNumber(item.quantity)}</td>
        <td>${formatArabicNumber(item.net_quantity || 0)}</td>
        <td>${formatArabicCurrencyPreserveDecimals(item.purchase_price)}</td>
        <td>${formatArabicNumber(item.total)} جنيه</td>
      `;
    } else {
      html += `
        <td>${item.oil_type}</td>
        <td>${formatArabicNumber(item.quantity)}</td>
        <td>${formatArabicCurrencyPreserveDecimals(item.purchase_price)}</td>
        <td>${formatArabicNumber(item.iva)}%</td>
        <td>${formatArabicNumber(item.total_purchase)} جنيه</td>
      `;
    }
    html += '</tr>';
  });

  html += `
        </tbody>
      </table>
  `;

  // Add oil invoice specific fields
  if (type === 'oil') {
    const subtotal = invoice.items.reduce((sum, item) => sum + (item.total_purchase || 0), 0);
    html += `
      <div class="invoice-summary-details">
        <p><strong>المجموع الفرعي:</strong> ${formatArabicNumber(subtotal)} جنيه</p>
        ${invoice.immediate_discount > 0 ? `<p><strong>خصم فورى:</strong> ${formatArabicNumber(invoice.immediate_discount)} جنيه</p>` : ''}
        ${invoice.martyrs_tax > 0 ? `<p><strong>ضريبة تكريم شهداء:</strong> ${formatArabicNumber(invoice.martyrs_tax)} جنيه</p>` : ''}
        <p style="font-size: 1.2rem; font-weight: bold; margin-top: 1rem; border-top: 2px solid #c4291d; padding-top: 0.5rem;">
          <strong>الإجمالي النهائي:</strong> ${formatArabicNumber(invoice.total)} جنيه
        </p>
      </div>
    `;
  } else {
    // Fuel invoice summary
    const itemsSubtotal = invoice.items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
    const invoiceTotalValue = parseFloat(invoice.invoice_total);
    const invoiceTotal = Number.isFinite(invoiceTotalValue) && invoiceTotalValue > 0
      ? invoiceTotalValue
      : (parseFloat(invoice.total) || 0);
    const cashDeposit = invoiceTotal - itemsSubtotal;

    html += `
      <div class="invoice-summary-details">
        <p><strong>تأمين نقدى:</strong> ${formatArabicNumber(cashDeposit)} جنيه</p>
        <p style="font-size: 1.2rem; font-weight: bold; margin-top: 1rem; border-top: 2px solid #c4291d; padding-top: 0.5rem;">
          <strong>الإجمالي:</strong> ${formatArabicNumber(invoiceTotal)} جنيه
        </p>
      </div>
    `;
  }

  html += '</div>';

  detailsContent.innerHTML = html;
  document.getElementById('invoice-details-modal').classList.add('show');
}

function closeInvoiceDetailsModal() {
  document.getElementById('invoice-details-modal').classList.remove('show');
}

// Auto-update functionality
let updateInfo = null;

function isNetworkDisconnectedError(errorInfo) {
  const message = String(errorInfo?.message || errorInfo || '');
  return message.includes('ERR_INTERNET_DISCONNECTED') ||
    message.includes('ENOTFOUND') ||
    message.includes('EAI_AGAIN') ||
    message.includes('ECONNREFUSED');
}

function setUpdateOfflineStatus() {
  const statusEl = document.getElementById('update-status');
  const downloadBtn = document.getElementById('download-update-btn');
  const installBtn = document.getElementById('install-update-btn');
  const changelogBtn = document.getElementById('view-changelog-btn');

  if (statusEl) {
    statusEl.textContent = 'لا يوجد اتصال بالإنترنت';
    statusEl.style.color = '#c4291d';
    statusEl.style.fontWeight = 'bold';
  }
  if (downloadBtn) downloadBtn.style.display = 'none';
  if (installBtn) installBtn.style.display = 'none';
  if (changelogBtn) changelogBtn.style.display = 'none';
}

ipcRenderer.on('update-available', (event, info) => {
  updateInfo = info;
  showUpdateNotification('يوجد تحديث جديد', `الإصدار ${info.version} متاح الآن. هل تريد تنزيله؟`, true);
});

ipcRenderer.on('download-progress', (event, progressObj) => {
  const percent = Math.round(progressObj.percent);
  updateDownloadProgress(percent);
});

ipcRenderer.on('update-downloaded', (event, info) => {
  // Save update ready state
  updateInfo = info;
  updateInfo.downloaded = true;

  // Show notification with install button
  showUpdateNotification(
    'التحديث جاهز للتثبيت',
    `تم تنزيل الإصدار ${info.version} بنجاح. يمكنك تثبيته الآن.`,
    false,
    true // show install button
  );

  // Update the updates page if currently viewing it
  updateUpdatesPageUI();
});

ipcRenderer.on('update-error', (event, errorInfo) => {
  if (!isOnline && isNetworkDisconnectedError(errorInfo)) {
    setUpdateOfflineStatus();
    return;
  }

  console.error('Update error:', errorInfo);
  
  // Create a more user-friendly error message
  let errorMessage = 'حدث خطأ أثناء تنزيل التحديث';
  if (errorInfo.message) {
    errorMessage = errorInfo.message;
    // Check for common error codes
    if (errorInfo.code === 'ENOTFOUND' || errorInfo.message.includes('ENOTFOUND')) {
      errorMessage = 'لا يمكن الاتصال بالخادم. تحقق من اتصالك بالإنترنت.';
    } else if (errorInfo.code === 'ECONNREFUSED' || errorInfo.message.includes('ECONNREFUSED')) {
      errorMessage = 'تم رفض الاتصال. يرجى المحاولة مرة أخرى لاحقاً.';
    } else if (errorInfo.message.includes('404') || errorInfo.code === 'ERR_NOT_FOUND') {
      errorMessage = 'لم يتم العثور على التحديث. تأكد من أن الإصدار متوفر على GitHub.';
    } else if (errorInfo.message.includes('403') || errorInfo.code === 'ERR_FORBIDDEN') {
      errorMessage = 'تم رفض الوصول. قد يكون المستودع خاصاً.';
    }
  }
  
  showMessage(errorMessage, 'error');
  
  // Hide progress bar if download was in progress
  const progressContainer = document.getElementById('download-progress-container');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
  
  // Show download button again in case of error
  const notification = document.querySelector('.update-notification');
  if (notification && updateInfo) {
    const actionsDiv = notification.querySelector('.update-actions');
    if (actionsDiv && !actionsDiv.querySelector('.btn-primary')) {
      actionsDiv.innerHTML = `
        <button class="btn btn-primary" onclick="downloadUpdate()">تنزيل الآن</button>
        <button class="btn btn-secondary" onclick="closeUpdateNotification()">لاحقاً</button>
      `;
    }
  }
});

function showUpdateNotification(title, message, showDownloadButton, showInstallButton = false) {
  const notification = document.createElement('div');
  notification.className = 'update-notification';

  let buttonsHTML = '';
  if (showDownloadButton) {
    buttonsHTML = '<button class="btn btn-primary" onclick="downloadUpdate()">تنزيل الآن</button>';
  } else if (showInstallButton) {
    buttonsHTML = '<button class="btn btn-primary" onclick="installUpdate()">إعادة التشغيل والتثبيت</button>';
  }

  notification.innerHTML = `
    <div class="update-notification-content">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="update-actions">
        ${buttonsHTML}
        <button class="btn btn-secondary" onclick="closeUpdateNotification()">لاحقاً</button>
      </div>
    </div>
  `;

  // Remove existing notification if any
  const existing = document.querySelector('.update-notification');
  if (existing) existing.remove();

  document.body.appendChild(notification);
}

function showDownloadToast() {
  // Remove existing toast if any
  const existing = document.querySelector('.download-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'download-toast';
  toast.innerHTML = `
    <div class="download-toast-header">
      <div class="download-toast-title">
        <img src="assets/scaricamento.png" class="download-toast-icon" alt="Download">
        <span>جاري تنزيل التحديث</span>
      </div>
      <button class="download-toast-close" onclick="closeDownloadToast()">&times;</button>
    </div>
    <div class="download-toast-body">
      <div class="download-toast-progress">
        <div class="download-toast-progress-bar">
          <div class="download-toast-progress-fill" id="download-toast-fill"></div>
        </div>
      </div>
      <div class="download-toast-percentage" id="download-toast-percentage">0%</div>
      <div class="download-toast-text">يمكنك الاستمرار في استخدام البرنامج أثناء التنزيل</div>
    </div>
  `;

  document.body.appendChild(toast);
}

function closeDownloadToast() {
  const toast = document.querySelector('.download-toast');
  if (toast) toast.remove();
}

function downloadUpdate() {
  // Close the update notification modal
  closeUpdateNotification();

  // Show the download toast notification
  showDownloadToast();

  // Send download request
  ipcRenderer.send('download-update');
}

function installUpdate() {
  // Close notification if exists
  const notification = document.querySelector('.update-notification');
  if (notification) {
    notification.remove();
  }

  // Show installing message
  showMessage('جاري إغلاق البرنامج وتثبيت التحديث...', 'info');

  // Send install command
  setTimeout(() => {
    ipcRenderer.send('install-update');
  }, 500);
}

function updateUpdatesPageUI() {
  // Update the updates page UI to show download/install buttons based on update state
  const downloadBtn = document.getElementById('download-update-btn');
  const installBtn = document.getElementById('install-update-btn');
  const updateStatus = document.getElementById('update-status');

  if (updateInfo && updateInfo.downloaded) {
    // Update is downloaded and ready to install
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (installBtn) installBtn.style.display = 'inline-flex';

    // Update status text
    if (updateStatus) {
      updateStatus.textContent = `تحديث جاهز: الإصدار ${updateInfo.version}`;
      updateStatus.style.color = '#28a745'; // Green color
      updateStatus.style.fontWeight = 'bold';
    }
  } else if (updateInfo && !updateInfo.downloaded) {
    // Update is available but not downloaded yet
    if (downloadBtn) downloadBtn.style.display = 'inline-flex';
    if (installBtn) installBtn.style.display = 'none';

    // Update status text
    if (updateStatus) {
      updateStatus.textContent = `تحديث متاح: الإصدار ${updateInfo.version}`;
      updateStatus.style.color = '#17a2b8'; // Blue color
      updateStatus.style.fontWeight = 'bold';
    }
  } else {
    // No update available
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (installBtn) installBtn.style.display = 'none';
  }
}

function closeUpdateNotification() {
  const notification = document.querySelector('.update-notification');
  if (notification) notification.remove();

  // Update the settings page UI to show download button if update was postponed
  updateUpdatesPageUI();
}

function updateDownloadProgress(percent) {
  // Update toast progress
  const toastFill = document.getElementById('download-toast-fill');
  const toastPercentage = document.getElementById('download-toast-percentage');

  if (toastFill) toastFill.style.width = `${percent}%`;
  if (toastPercentage) toastPercentage.textContent = `${percent}%`;

  // If download is complete, show completion message
  if (percent >= 100) {
    setTimeout(() => {
      const toast = document.querySelector('.download-toast');
      if (toast) {
        const toastTitle = toast.querySelector('.download-toast-title');
        const toastTitleSpan = toast.querySelector('.download-toast-title span');
        const toastText = toast.querySelector('.download-toast-text');
        const toastIcon = toast.querySelector('.download-toast-icon');

        if (toastTitleSpan) toastTitleSpan.textContent = 'اكتمل التنزيل';
        if (toastTitle) toastTitle.classList.add('completed');
        if (toastText) toastText.textContent = 'التحديث جاهز للتثبيت';
        if (toastIcon) {
          toastIcon.style.animation = 'none';
          toastIcon.src = 'assets/scaricato.png';
        }

        // Auto-close after 3 seconds and show install notification
        setTimeout(() => {
          closeDownloadToast();
        }, 3000);
      }
    }, 500);
  }
}

// Manual update check from settings
function checkForUpdatesManually() {
  const statusEl = document.getElementById('update-status');
  const checkBtn = document.querySelector('.update-actions-group .btn-primary');

  if (!isOnline) {
    setUpdateOfflineStatus();
    showMessage('لا يوجد اتصال بالإنترنت', 'warning');
    return;
  }

  if (statusEl) statusEl.textContent = 'جاري الفحص...';
  if (checkBtn) checkBtn.disabled = true;

  ipcRenderer.send('check-for-updates-manual');

  // Update last check time
  const now = new Date();
  const timeStr = now.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const lastCheckEl = document.getElementById('last-update-check');
  if (lastCheckEl) lastCheckEl.textContent = timeStr;

  // Re-enable button after 3 seconds
  setTimeout(() => {
    if (checkBtn) checkBtn.disabled = false;
  }, 3000);
}

// Listen for manual check results
ipcRenderer.on('update-check-result', (event, result) => {
  const statusEl = document.getElementById('update-status');
  const changelogBtn = document.getElementById('view-changelog-btn');

  if (result.offline) {
    setUpdateOfflineStatus();
    return;
  }

  if (result.error) {
    if (statusEl) statusEl.textContent = result.error;
    if (changelogBtn) changelogBtn.style.display = 'none';
    return;
  }

  if (result.available) {
    if (statusEl) statusEl.textContent = `تحديث متاح: الإصدار ${result.version}`;
    if (changelogBtn) changelogBtn.style.display = 'inline-block';
    updateInfo = result;
  } else {
    if (statusEl) statusEl.textContent = 'أنت تستخدم أحدث إصدار';
    if (changelogBtn) changelogBtn.style.display = 'none';
    showMessage('أنت تستخدم أحدث إصدار', 'success');
  }
});

// View changelog
function viewChangelog() {
  if (updateInfo && updateInfo.releaseNotes) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h3>ما الجديد في الإصدار ${updateInfo.version}</h3>
          <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
        </div>
        <div class="modal-body" style="direction: ltr; text-align: left;">
          <pre style="white-space: pre-wrap; font-family: 'Noto Naskh Arabic', serif;">${updateInfo.releaseNotes}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="downloadUpdate(); this.closest('.modal').remove();">تنزيل التحديث</button>
          <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">إغلاق</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

// Load current version on settings page
function loadUpdateSettings() {
  // Get version from package.json via IPC
  ipcRenderer.invoke('get-app-version').then(version => {
    const versionEl = document.getElementById('current-version');
    if (versionEl) versionEl.textContent = version;
  });

  // Load auto-check preference
  const autoCheckPref = localStorage.getItem('auto-check-updates');
  const checkbox = document.getElementById('auto-check-updates');
  if (checkbox && autoCheckPref !== null) {
    checkbox.checked = autoCheckPref === 'true';
  }

  // Save preference when changed
  if (checkbox) {
    checkbox.addEventListener('change', (e) => {
      localStorage.setItem('auto-check-updates', e.target.checked);
      showMessage('تم حفظ التفضيلات', 'success');
    });
  }
}

// Depot Management: Setup event listeners
function setupDepotEventListeners() {
  // Desktop: sidebar items
  document.querySelectorAll('.oil-list .oil-item').forEach(item => {
    item.addEventListener('click', function() {
      const oilType = this.getAttribute('data-oil');
      selectOilType(oilType);
    });
  });

  // Mobile: modal items
  document.querySelectorAll('.oil-item-modal').forEach(item => {
    item.addEventListener('click', function() {
      const oilType = this.getAttribute('data-oil');
      selectOilType(oilType);
      closeProductsModal(); // Chiude modal dopo selezione
    });
  });

  // Mobile: pulsante apri modal
  const mobileBtn = document.getElementById('mobile-products-btn');
  if (mobileBtn) {
    mobileBtn.addEventListener('click', openProductsModal);
  }

  // Chiudi modal cliccando fuori
  const productsModal = document.getElementById('products-modal');
  if (productsModal) {
    productsModal.addEventListener('click', function(e) {
      if (e.target === this) {
        closeProductsModal();
      }
    });
  }
}

// Funzioni modal prodotti mobile
function openProductsModal() {
  document.getElementById('products-modal').classList.add('show');
}

function closeProductsModal() {
  document.getElementById('products-modal').classList.remove('show');
}

// ============================================================
// SHIFT ENTRY FUNCTIONS
// ============================================================

// Global state for shift entry
let currentShiftData = {
  date: null,
  shiftNumber: null,
  isSaved: false,
  hasUnsavedChanges: false,
  draftCleanupQueue: []
};
let shiftViewMode = 'edit'; // 'edit' | 'history' | 'correction'
const SHIFT_DRAFT_AUTOSAVE_DELAY_MS = 900;
let shiftDraftAutoSaveTimer = null;
let shiftDraftAutoSaveInFlight = false;
let shiftDraftAutoSaveQueued = false;
let shiftDraftAutoSavePromise = null;
let summaryRevenueRowCounter = 0;
let summaryExpenseRowCounter = 0;
let customerPaymentRowCounter = 0;
const SHIFT_DRAFT_STATUS_MESSAGES = {
  idle: 'جاهز',
  dirty: 'تغييرات غير محفوظة',
  saving: 'جاري حفظ المسودة...',
  saved: 'تم حفظ المسودة',
  error: 'تعذر حفظ المسودة'
};
let salesSummaryCache = { sales: [], months: [], products: [] };
let expandedSalesMonth = null;
const SALES_SUMMARY_ORDER_KEY = 'sales-summary-order';
const PROFIT_MANUAL_FIELDS = [
  'bonuses',
  'commission_diff',
  'deposit_tax',
  'bonus_tax'
];
let profitRowsCache = [];
let profitDefaultRange = null;
let profitCustomRowsCache = [];
let profitCustomValuesMap = new Map();
let profitLoadRequestId = 0;
let expenseEntriesCache = [];
let expenseDefaultRange = null;
let expenseFilterDebounceTimer = null;
const EXPENSE_ROW_ORDER_KEY = 'expenses-row-order';
const DEFAULT_EXPENSE_ROW_ORDER = [
  'اكرامية مواد',
  'مجارى',
  'مياة للمحطة',
  'كهرباء للمحطة',
  'سولار للديزل',
  'رسوم البوسطة',
  'تامينات'
];

function getCurrentShiftIdentifier() {
  const date = document.getElementById('shift-date')?.value || '';
  const shiftNumber = document.getElementById('shift-number')?.value || '';
  return { date, shiftNumber };
}

function getShiftIdentifierKey(date, shiftNumber) {
  const shift = parseInt(shiftNumber, 10);
  if (!date || !Number.isFinite(shift)) return '';
  return `${date}#${shift}`;
}

function queueDraftIdentifierForCleanup(date, shiftNumber) {
  const key = getShiftIdentifierKey(date, shiftNumber);
  if (!key) return;
  if (!Array.isArray(currentShiftData.draftCleanupQueue)) {
    currentShiftData.draftCleanupQueue = [];
  }
  if (!currentShiftData.draftCleanupQueue.includes(key)) {
    currentShiftData.draftCleanupQueue.push(key);
  }
}

async function cleanupQueuedDraftIdentifiers() {
  const queue = Array.isArray(currentShiftData.draftCleanupQueue)
    ? [...currentShiftData.draftCleanupQueue]
    : [];
  if (queue.length === 0) return;

  const { date, shiftNumber } = getCurrentShiftIdentifier();
  const activeKey = getShiftIdentifierKey(date, shiftNumber);
  const remaining = [];

  for (const key of queue) {
    if (!key || key === activeKey) {
      continue;
    }

    const [draftDate, draftShiftText] = key.split('#');
    const draftShift = parseInt(draftShiftText, 10);
    if (!draftDate || !Number.isFinite(draftShift)) {
      continue;
    }

    try {
      const result = await ipcRenderer.invoke('delete-shift-draft', {
        date: draftDate,
        shift_number: draftShift
      });
      if (!result?.success) {
        remaining.push(key);
      }
    } catch (error) {
      console.warn('Failed cleaning old draft identifier:', key, error);
      remaining.push(key);
    }
  }

  currentShiftData.draftCleanupQueue = remaining;
}

function getShiftInputDisplayValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const textValue = String(value).trim();
  if (textValue === '') {
    return '';
  }

  const numericValue = Number(textValue);
  if (Number.isFinite(numericValue) && Math.abs(numericValue) < 0.0000001) {
    return '';
  }

  return textValue;
}

function setShiftDraftStatus(state = 'idle', customMessage = '') {
  const statusEl = document.getElementById('shift-draft-status');
  if (!statusEl) return;

  statusEl.classList.remove('idle', 'dirty', 'saving', 'saved', 'error');
  statusEl.classList.add(state || 'idle');
  statusEl.textContent = customMessage || SHIFT_DRAFT_STATUS_MESSAGES[state] || SHIFT_DRAFT_STATUS_MESSAGES.idle;
}

async function persistCurrentShiftDraftToDatabase() {
  const { date, shiftNumber } = getCurrentShiftIdentifier();
  const shiftNumberValue = parseInt(shiftNumber, 10);

  if (!date || !Number.isFinite(shiftNumberValue)) {
    return { success: false, error: 'invalid_shift_identifier' };
  }

  const draftPayload = {
    date,
    shift_number: shiftNumberValue,
    fuel_data: JSON.stringify(collectFuelData()),
    fuel_total: calculateFuelTotal(),
    oil_data: JSON.stringify(collectOilData()),
    oil_total: calculateOilTotal(),
    customer_rows: collectCustomerRowsData(),
    revenue_items: collectRevenueItems(),
    customer_payments: collectCustomerPayments(),
    expense_items: collectExpenseItems(),
    wash_lube_revenue: parseSummaryNumber(document.getElementById('total-wash-lube-revenue')?.value),
    total_expenses: parseSummaryNumber(document.getElementById('total-expenses')?.value),
    grand_total: calculateGrandTotal(),
    is_saved: 0
  };

  try {
    const result = await ipcRenderer.invoke('save-shift', draftPayload);
    if (!result?.success) {
      return { success: false, error: result?.error || 'save_failed' };
    }
    return { success: true };
  } catch (error) {
    console.error('Error persisting shift draft:', error);
    return { success: false, error: error?.message || 'save_failed' };
  }
}

function canAutoSaveShiftDraft() {
  if (currentScreen !== 'shift-entry') return false;
  if (shiftViewMode !== 'edit') return false;
  if (currentShiftData.isSaved) return false;
  const { date, shiftNumber } = getCurrentShiftIdentifier();
  return Boolean(date && shiftNumber);
}

async function runShiftDraftAutoSave() {
  if (!canAutoSaveShiftDraft() || !currentShiftData.hasUnsavedChanges) {
    return;
  }

  if (shiftDraftAutoSaveInFlight) {
    shiftDraftAutoSaveQueued = true;
    return;
  }

  setShiftDraftStatus('saving');
  shiftDraftAutoSaveInFlight = true;
  const saveResult = await persistCurrentShiftDraftToDatabase();
  shiftDraftAutoSaveInFlight = false;

  if (saveResult.success) {
    currentShiftData.hasUnsavedChanges = false;
    await cleanupQueuedDraftIdentifiers();
    setShiftDraftStatus('saved');
  } else {
    if (saveResult.error === 'validation_failed') {
      setShiftDraftStatus('dirty');
    } else {
      setShiftDraftStatus('error');
    }
  }

  if (shiftDraftAutoSaveQueued) {
    shiftDraftAutoSaveQueued = false;
    if (currentShiftData.hasUnsavedChanges) {
      runShiftDraftAutoSave();
    }
  }
}

function startShiftDraftAutoSave() {
  const promise = runShiftDraftAutoSave();
  shiftDraftAutoSavePromise = promise;
  promise.finally(() => {
    if (shiftDraftAutoSavePromise === promise) {
      shiftDraftAutoSavePromise = null;
    }
  });
  return promise;
}

function scheduleShiftDraftAutoSave() {
  if (!canAutoSaveShiftDraft()) return;

  if (shiftDraftAutoSaveTimer) {
    clearTimeout(shiftDraftAutoSaveTimer);
  }

  setShiftDraftStatus('dirty');

  shiftDraftAutoSaveTimer = setTimeout(() => {
    shiftDraftAutoSaveTimer = null;
    startShiftDraftAutoSave();
  }, SHIFT_DRAFT_AUTOSAVE_DELAY_MS);
}

function markShiftDraftDirty() {
  if (shiftViewMode === 'history') return;

  currentShiftData.hasUnsavedChanges = true;
  if (shiftViewMode === 'correction') {
    setShiftDraftStatus('dirty', 'تصحيح غير محفوظ');
    return;
  }
  scheduleShiftDraftAutoSave();
}

function isShiftAutoFilledField(target) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return false;
  }

  if (target.classList.contains('auto-calculated')) {
    return true;
  }

  const id = String(target.id || '');
  if (!id) return false;

  return (
    /-price$/.test(id) ||
    /-cash$/.test(id) ||
    /-quantity-\d+$/.test(id) ||
    /-total-qty$/.test(id) ||
    id === 'final-net-total' ||
    // Oil derived fields (الإجمالى بعد وارد + المباع + اجمالى النقدى)
    /^oil-.+-total$/.test(id) ||
    /^oil-.+-sold$/.test(id) ||
    /^oil-.+-revenue$/.test(id)
  );
}

function getShiftNavigableFields(container) {
  if (!container) return [];

  const elements = Array.from(container.querySelectorAll('input, textarea, select'));
  return elements.filter(isShiftNavigationField);
}

function normalizeShiftNumericText(value) {
  const digitMap = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    '۰': '0',
    '۱': '1',
    '۲': '2',
    '۳': '3',
    '۴': '4',
    '۵': '5',
    '۶': '6',
    '۷': '7',
    '۸': '8',
    '۹': '9'
  };

  return String(value ?? '')
    .replace(/[٠-٩۰-۹]/g, (digit) => digitMap[digit] || digit)
    .replace(/[٫،,]/g, '.')
    .replace(/٬/g, '');
}

function hasShiftArabicNumericText(value) {
  return /[٠-٩۰-۹٫٬،]/.test(String(value ?? ''));
}

function hasShiftNumericInsertText(value) {
  const text = String(value ?? '').trim();
  return text !== '' && /^[0-9٠-٩۰-۹.,٫٬،\s]+$/.test(text);
}

function isShiftNumericInputTarget(target) {
  if (!(target instanceof HTMLInputElement)) return false;
  if (target.disabled || target.readOnly) return false;

  return target.type === 'number'
    || target.inputMode === 'decimal'
    || target.classList.contains('fuel-table-input')
    || target.classList.contains('customer-fuel-input')
    || target.classList.contains('summary-numeric-input')
    || target.classList.contains('shift-revenue-amount')
    || target.classList.contains('shift-expense-amount');
}

function getShiftInputSelection(input) {
  try {
    const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
    return { start, end };
  } catch (_error) {
    return { start: input.value.length, end: input.value.length };
  }
}

function setShiftInputSelection(input, position) {
  try {
    input.setSelectionRange(position, position);
  } catch (_error) {
    // Number inputs do not expose selection APIs in all browsers.
  }
}

function insertShiftNormalizedNumericText(input, text) {
  const normalized = normalizeShiftNumericText(text);
  const { start, end } = getShiftInputSelection(input);
  const currentValue = String(input.value ?? '');
  input.value = `${currentValue.slice(0, start)}${normalized}${currentValue.slice(end)}`;
  setShiftInputSelection(input, start + normalized.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceShiftNumericText(input, text) {
  const normalized = normalizeShiftNumericText(text);
  input.value = normalized;
  setShiftInputSelection(input, normalized.length);
  delete input.dataset.shiftClearOnNextInput;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function normalizeShiftNumericInputValue(input) {
  const normalized = normalizeShiftNumericText(input.value);
  if (normalized !== input.value) {
    input.value = normalized;
  }
}

function getShiftNavigationScope(currentField, fallbackContainer) {
  if (!(currentField instanceof Element)) return fallbackContainer;

  return currentField.closest('.shift-summary-sidebar')
    || currentField.closest('.customers-table-container')
    || currentField.closest('.fuel-tables-left')
    || currentField.closest('.shift-oil-table-container')
    || currentField.closest('.shift-tab-section.active')
    || fallbackContainer;
}

function ensureShiftFieldVisible(field) {
  if (!(field instanceof Element)) return;

  requestAnimationFrame(() => {
    field.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto'
    });

    requestAnimationFrame(() => {
      const header = document.querySelector('.header');
      const bottomNavigation = document.querySelector('.bottom-navigation');
      const viewportMargin = 14;
      const headerRect = header?.getBoundingClientRect();
      const bottomNavRect = bottomNavigation?.getBoundingClientRect();
      const topLimit = (
        headerRect
        && headerRect.bottom > 0
        && headerRect.top < window.innerHeight
      )
        ? headerRect.bottom + viewportMargin
        : viewportMargin;
      const bottomLimit = (
        bottomNavRect
        && bottomNavRect.top < window.innerHeight
        && bottomNavRect.bottom > 0
      )
        ? bottomNavRect.top - viewportMargin
        : window.innerHeight - viewportMargin;
      const rect = field.getBoundingClientRect();

      if (rect.top < topLimit) {
        window.scrollBy({ top: rect.top - topLimit, behavior: 'auto' });
      } else if (rect.bottom > bottomLimit) {
        window.scrollBy({ top: rect.bottom - bottomLimit, behavior: 'auto' });
      }
    });
  });
}

function shouldClearShiftNumericOnFocus(target) {
  if (!isShiftNumericInputTarget(target)) return false;
  if (target.classList.contains('auto-calculated')) return false;
  if (target.classList.contains(INLINE_RESET_ACTIVE_CLASS)) return false;
  if (target.id === 'shift-date' || target.id === 'shift-number') return false;
  return String(target.value || '').trim() !== '';
}

function clearShiftNumericFieldOnFocus(target) {
  if (!shouldClearShiftNumericOnFocus(target)) return;

  target.dataset.shiftClearOnNextInput = '1';
}

function clearShiftNumericFieldPendingState(target) {
  if (target instanceof HTMLInputElement) {
    delete target.dataset.shiftClearOnNextInput;
  }
}

function shouldReplaceShiftNumericOnInsert(target, text) {
  return (
    isShiftNumericInputTarget(target)
    && target.dataset.shiftClearOnNextInput === '1'
    && hasShiftNumericInsertText(text)
  );
}

function isShiftNavigationField(el) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    return false;
  }

  if (el.disabled || el.readOnly) return false;
  if (el.id === 'shift-date' || el.id === 'shift-number') return false;
  if (el instanceof HTMLInputElement) {
    if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit') return false;
  }

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getShiftTableNavigationEntries(container) {
  if (!container) return [];

  const entries = [];
  const rows = Array.from(container.querySelectorAll('tr'));
  rows.forEach((row, rowIndex) => {
    let colIndex = 0;
    Array.from(row.children).forEach((cell) => {
      const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
      const width = Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
      const fields = Array.from(cell.querySelectorAll('input, textarea, select')).filter(isShiftNavigationField);

      fields.forEach((field, fieldIndex) => {
        entries.push({
          field,
          rowIndex,
          startCol: colIndex,
          endCol: colIndex + width - 1,
          centerCol: colIndex + ((width - 1) / 2),
          fieldIndex
        });
      });

      colIndex += width;
    });
  });

  return entries;
}

function pickShiftVerticalTableField(currentEntry, candidates) {
  if (!currentEntry || candidates.length === 0) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  candidates.forEach((entry) => {
    const overlaps = entry.startCol <= currentEntry.endCol && entry.endCol >= currentEntry.startCol;
    const columnDistance = overlaps
      ? 0
      : Math.min(
          Math.abs(entry.startCol - currentEntry.centerCol),
          Math.abs(entry.endCol - currentEntry.centerCol),
          Math.abs(entry.centerCol - currentEntry.centerCol)
        );
    const score = (columnDistance * 100) + entry.fieldIndex;
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  });

  return best?.field || null;
}

function findAdjacentShiftTableField(currentField, direction) {
  const table = currentField?.closest?.('.shift-fuel-table, .shift-oil-table, .customers-table');
  if (!table) {
    return { handled: false, field: null };
  }

  const navigationContainer = table.classList.contains('shift-fuel-table')
    ? (table.closest('.fuel-tables-left') || table)
    : table.classList.contains('shift-oil-table')
      ? (table.closest('.shift-oil-table-container') || table)
      : table;
  const entries = getShiftTableNavigationEntries(navigationContainer);
  const currentEntry = entries.find((entry) => entry.field === currentField);
  if (!currentEntry) {
    return { handled: true, field: null };
  }

  if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
    const sameRow = entries
      .filter((entry) => entry.rowIndex === currentEntry.rowIndex && entry.field !== currentField)
      .sort((a, b) => a.startCol - b.startCol || a.fieldIndex - b.fieldIndex);

    const nextEntry = direction === 'ArrowLeft'
      ? sameRow.find((entry) => entry.startCol > currentEntry.startCol)
      : [...sameRow].reverse().find((entry) => entry.endCol < currentEntry.endCol);

    return { handled: true, field: nextEntry?.field || null };
  }

  if (direction === 'ArrowDown' || direction === 'ArrowUp') {
    const rowIndexes = Array.from(new Set(entries.map((entry) => entry.rowIndex))).sort((a, b) => a - b);
    const targetRows = direction === 'ArrowDown'
      ? rowIndexes.filter((rowIndex) => rowIndex > currentEntry.rowIndex)
      : rowIndexes.filter((rowIndex) => rowIndex < currentEntry.rowIndex).reverse();

    for (const rowIndex of targetRows) {
      const rowCandidates = entries.filter((entry) => entry.rowIndex === rowIndex);
      const field = pickShiftVerticalTableField(currentEntry, rowCandidates);
      if (field) {
        return { handled: true, field };
      }
    }
  }

  return { handled: true, field: null };
}

function findAdjacentShiftField(currentField, fields, direction) {
  if (!currentField || !Array.isArray(fields) || fields.length === 0) return null;

  const currentRect = currentField.getBoundingClientRect();
  const currentX = currentRect.left + (currentRect.width / 2);
  const currentY = currentRect.top + (currentRect.height / 2);

  let bestField = null;
  let bestScore = Number.POSITIVE_INFINITY;

  fields.forEach((field) => {
    if (field === currentField) return;
    const rect = field.getBoundingClientRect();
    const x = rect.left + (rect.width / 2);
    const y = rect.top + (rect.height / 2);
    const dx = x - currentX;
    const dy = y - currentY;

    let primary = 0;
    let secondary = 0;

    if (direction === 'ArrowUp') {
      if (dy >= -1) return;
      primary = Math.abs(dy);
      secondary = Math.abs(dx);
    } else if (direction === 'ArrowDown') {
      if (dy <= 1) return;
      primary = Math.abs(dy);
      secondary = Math.abs(dx);
    } else if (direction === 'ArrowLeft') {
      if (dx >= -1) return;
      primary = Math.abs(dx);
      secondary = Math.abs(dy);
    } else if (direction === 'ArrowRight') {
      if (dx <= 1) return;
      primary = Math.abs(dx);
      secondary = Math.abs(dy);
    } else {
      return;
    }

    const score = (primary * 1000) + secondary;
    if (score < bestScore) {
      bestScore = score;
      bestField = field;
    }
  });

  return bestField;
}

function flushShiftDraftAutoSave() {
  if (shiftDraftAutoSaveTimer) {
    clearTimeout(shiftDraftAutoSaveTimer);
    shiftDraftAutoSaveTimer = null;
  }
  if (currentShiftData.hasUnsavedChanges) {
    return startShiftDraftAutoSave();
  }
  return shiftDraftAutoSavePromise || Promise.resolve();
}
const PROFIT_TABLE_ROWS = [
  { key: 'fuel_diesel', label: 'سولار', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'fuel_80', label: 'بنزين ٨٠', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'fuel_92', label: 'بنزين ٩٢', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'fuel_95', label: 'بنزين ٩٥', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'oil_total', label: 'الزيوت', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'wash_lube_month', label: 'غسيل و تشحيم', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'bonuses', label: 'حوافز', type: 'manual-fixed', section: 'revenue', cellClass: 'positive-col' },
  { key: 'commission_diff', label: 'فرق العمولة', type: 'manual-fixed', section: 'revenue', cellClass: 'positive-col' },
  { key: 'expenses_month', label: 'المصاريف', type: 'auto', section: 'deduction', cellClass: 'deduction-col auto-col' },
  { key: 'cash_insurance_month', label: 'تأمين نقدى', type: 'auto', section: 'deduction', cellClass: 'deduction-col auto-col' },
  { key: 'deposit_tax', label: 'ضريبة المنبع', type: 'manual-fixed', section: 'deduction', cellClass: 'deduction-col' },
  { key: 'bonus_tax', label: 'ضرائب الحافز', type: 'manual-fixed', section: 'deduction', cellClass: 'deduction-col' }
];

// Default summary date range (current year to date)
function initSalesSummaryFilters() {
  const end = new Date();
  const start = new Date(end.getFullYear(), 0, 1); // from Jan 1 of current year

  const toLocalMonth = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  const startMonthSel = document.getElementById('summary-start-month');
  const startYearSel = document.getElementById('summary-start-year');
  const endMonthSel = document.getElementById('summary-end-month');
  const endYearSel = document.getElementById('summary-end-year');

  const years = [];
  for (let y = 2025; y <= end.getFullYear(); y++) years.push(y);
  const months = [
    { value: '01', label: 'يناير' },
    { value: '02', label: 'فبراير' },
    { value: '03', label: 'مارس' },
    { value: '04', label: 'أبريل' },
    { value: '05', label: 'مايو' },
    { value: '06', label: 'يونيو' },
    { value: '07', label: 'يوليو' },
    { value: '08', label: 'أغسطس' },
    { value: '09', label: 'سبتمبر' },
    { value: '10', label: 'أكتوبر' },
    { value: '11', label: 'نوفمبر' },
    { value: '12', label: 'ديسمبر' },
  ];

  const fillOptions = (select, opts, selectedValue) => {
    if (!select) return;
    select.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    select.value = selectedValue;
  };

  fillOptions(startMonthSel, months, months[start.getMonth()].value);
  fillOptions(endMonthSel, months, months[end.getMonth()].value);
  fillOptions(startYearSel, years.map(y => ({ value: y, label: y })), start.getFullYear());
  fillOptions(endYearSel, years.map(y => ({ value: y, label: y })), end.getFullYear());

  const btn = document.getElementById('summary-filter-btn');
  if (btn && !btn.dataset.bound) {
    btn.addEventListener('click', () => {
      loadSalesSummary();
    });
    btn.dataset.bound = 'true';
  }
}

async function loadSalesSummary() {
  const startMonthSel = document.getElementById('summary-start-month');
  const startYearSel = document.getElementById('summary-start-year');
  const endMonthSel = document.getElementById('summary-end-month');
  const endYearSel = document.getElementById('summary-end-year');
  const headRow = document.getElementById('sales-summary-head');
  const tbody = document.getElementById('sales-summary-body');
  const emptyState = document.getElementById('sales-summary-empty');

  if (!startMonthSel || !startYearSel || !endMonthSel || !endYearSel || !tbody || !headRow) return;

  const startMonthVal = startMonthSel.value;
  const startYearVal = startYearSel.value;
  const endMonthVal = endMonthSel.value;
  const endYearVal = endYearSel.value;
  hideMonthDetails(true);
  expandedSalesMonth = null;

  if (!startMonthVal || !startYearVal || !endMonthVal || !endYearVal) {
    if (emptyState) {
      emptyState.style.display = 'block';
      emptyState.textContent = 'يرجى اختيار فترة زمنية';
    }
    headRow.innerHTML = '';
    tbody.innerHTML = '';
    return;
  }

  const toInt = (v) => parseInt(v, 10);
  const startParts = { year: toInt(startYearVal), month: toInt(startMonthVal) };
  const endParts = { year: toInt(endYearVal), month: toInt(endMonthVal) };
  if (!startParts.year || !startParts.month || !endParts.year || !endParts.month) {
    if (emptyState) {
      emptyState.style.display = 'block';
      emptyState.textContent = 'صيغة الشهر غير صحيحة';
    }
    headRow.innerHTML = '';
    tbody.innerHTML = '';
    return;
  }

  const formatDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const startDateObj = new Date(startParts.year, startParts.month - 1, 1);
  const endDateObj = new Date(endParts.year, endParts.month, 0); // last day of end month
  const startDateStr = formatDate(startDateObj);
  const endDateStr = formatDate(endDateObj);

  try {
    const [fuelProducts, oilProducts] = await Promise.all([
      ipcRenderer.invoke('get-fuel-prices'),
      ipcRenderer.invoke('get-oil-prices')
    ]);

    let salesReportRows = [];
    try {
      const salesReport = await ipcRenderer.invoke('get-sales-report', { startDate: startDateStr, endDate: endDateStr });
      salesReportRows = Array.isArray(salesReport) ? salesReport : [];
    } catch (error) {
      console.warn('Sales report unavailable, using shift sales:', error);
    }

    let shiftFuelRows = [];
    let shiftOilRows = [];
    try {
      const [shiftFuelSalesRaw, shiftOilSalesRaw] = await Promise.all([
        ipcRenderer.invoke('get-shift-fuel-sales'),
        ipcRenderer.invoke('get-shift-oil-sales')
      ]);

      shiftFuelRows = (Array.isArray(shiftFuelSalesRaw) ? shiftFuelSalesRaw : [])
        .filter((entry) => entry?.date && entry.date >= startDateStr && entry.date <= endDateStr)
        .map((entry) => ({
          date: entry.date,
          fuel_type: normalizeFuelTypeForHomeChart(entry.fuel_type),
          quantity: parseFloat(entry.quantity) || 0,
          total_amount: 0
        }));

      shiftOilRows = (Array.isArray(shiftOilSalesRaw) ? shiftOilSalesRaw : [])
        .filter((entry) => entry?.date && entry.date >= startDateStr && entry.date <= endDateStr)
        .map((entry) => ({
          date: entry.date,
          fuel_type: String(entry.product_name || '').trim(),
          quantity: parseFloat(entry.quantity) || 0,
          total_amount: 0
        }));
    } catch (error) {
      console.warn('Shift sales unavailable:', error);
    }

    const configuredFuelNames = new Set((fuelProducts || []).map((product) => (
      normalizeFuelTypeForHomeChart(product.fuel_type)
    )).filter(Boolean));
    const nonFuelReportRows = salesReportRows.filter((row) => {
      const productName = normalizeFuelTypeForHomeChart(row.fuel_type);
      return productName && !configuredFuelNames.has(productName);
    });
    const sales = shiftFuelRows.length > 0 || shiftOilRows.length > 0
      ? [...shiftFuelRows, ...shiftOilRows, ...nonFuelReportRows]
      : salesReportRows;

    // Build list of months in range (YYYY-MM)
    const months = [];
    const startMonth = new Date(startParts.year, startParts.month - 1, 1);
    const endMonth = new Date(endParts.year, endParts.month - 1, 1);
    startMonth.setDate(1);
    endMonth.setDate(1);
    const cursor = new Date(startMonth);
    const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    while (cursor <= endMonth) {
      months.push(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Collect all products (fuel first, then oil, then any extras from sales)
    const fuelNames = (fuelProducts || []).map(p => p.fuel_type).filter(Boolean);
    const oilNames = (oilProducts || []).map(p => p.oil_type).filter(Boolean);
    const extras = [];
    sales.forEach(sale => {
      if (sale.fuel_type && !fuelNames.includes(sale.fuel_type) && !oilNames.includes(sale.fuel_type) && !extras.includes(sale.fuel_type)) {
        extras.push(sale.fuel_type);
      }
    });
    const productsOrdered = [
      ...fuelNames.sort((a, b) => a.localeCompare(b)),
      ...oilNames.sort((a, b) => a.localeCompare(b)),
      ...extras.sort((a, b) => a.localeCompare(b))
    ];
    const productSet = new Set(productsOrdered);

    // Aggregate by product and month (YYYY-MM)
    const map = new Map();
    sales.forEach(sale => {
      const normalizedFuelType = normalizeFuelTypeForHomeChart(sale.fuel_type);
      const month = sale.date?.slice(0, 7) || '';
      const key = `${normalizedFuelType}__${month}`;
      if (!map.has(key)) {
        map.set(key, { product: normalizedFuelType, month, qty: 0, revenue: 0 });
      }
      const entry = map.get(key);
      entry.qty += parseFloat(sale.quantity) || 0;
      entry.revenue += parseFloat(sale.total_amount) || 0;
    });

    // Ensure every product appears for each month even if zero sales
    productSet.forEach(product => {
      months.forEach(month => {
        const key = `${product}__${month}`;
        if (!map.has(key)) {
          map.set(key, { product, month, qty: 0, revenue: 0 });
        }
      });
    });

    let products = productsOrdered.length > 0 ? productsOrdered : Array.from(productSet).sort((a, b) => a.localeCompare(b));
    products = applySavedSalesSummaryOrder(products);
    // Store for later drill-down use
    salesSummaryCache = { sales, months, products };

    if (products.length === 0 || months.length === 0) {
      headRow.innerHTML = '';
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    // Build table header (clickable months)
    headRow.innerHTML = [
      '<th>المنتج</th>',
      ...months.map(m => `<th class="month-click" data-month="${m}">${formatMonthLabel(m)}</th>`),
      '<th>الإجمالي</th>'
    ].join('');

    headRow.querySelectorAll('th[data-month]').forEach(th => {
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMonthDetails(th.dataset.month);
      });
    });

    // Build body rows
    const rowsHtml = products.map(product => {
      let totalQty = 0;
      const cells = months.map(month => {
        const entry = map.get(`${product}__${month}`) || { qty: 0, revenue: 0 };
        totalQty += entry.qty;
        return `<td class="cell-qty-only">${formatArabicNumber(entry.qty)}</td>`;
      }).join('');
      return `
        <tr draggable="true" class="draggable-oil-row draggable-sales-summary-row">
          <td class="oil-name-cell">
            <span class="drag-handle" title="اسحب لإعادة الترتيب">⋮⋮</span>
            <strong>${product}</strong>
          </td>
          ${cells}
          <td class="cell-total">${formatArabicNumber(totalQty)}</td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
    enableSalesSummaryRowDragDrop();
    if (emptyState) emptyState.style.display = 'none';
  } catch (error) {
    console.error('Error loading sales summary:', error);
    tbody.innerHTML = '';
    if (emptyState) {
      emptyState.style.display = 'block';
      emptyState.textContent = 'حدث خطأ أثناء تحميل الملخص';
    }
  }
}

// Load sales summary order from localStorage and apply it
function applySavedSalesSummaryOrder(products) {
  if (!Array.isArray(products) || products.length === 0) return products;

  const savedOrder = localStorage.getItem(SALES_SUMMARY_ORDER_KEY);
  if (!savedOrder) return products;

  try {
    const orderArray = JSON.parse(savedOrder);
    return [...products].sort((a, b) => {
      const indexA = orderArray.indexOf(a);
      const indexB = orderArray.indexOf(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  } catch (error) {
    console.error('Error parsing saved sales summary order:', error);
    return products;
  }
}

// Enable drag and drop for sales summary rows
function enableSalesSummaryRowDragDrop() {
  const tableBody = document.getElementById('sales-summary-body');
  if (!tableBody) return;

  let draggedRow = null;
  const rows = tableBody.querySelectorAll('.draggable-sales-summary-row');

  rows.forEach(row => {
    row.addEventListener('dragstart', function(e) {
      draggedRow = this;
      this.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', function() {
      this.style.opacity = '1';
      draggedRow = null;
      saveSalesSummaryOrder();
    });

    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (draggedRow && draggedRow !== this) {
        const rect = this.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (e.clientY < midpoint) {
          tableBody.insertBefore(draggedRow, this);
        } else {
          tableBody.insertBefore(draggedRow, this.nextSibling);
        }
      }
    });
  });
}

// Save sales summary order to localStorage
function saveSalesSummaryOrder() {
  const tableBody = document.getElementById('sales-summary-body');
  if (!tableBody) return;

  const rows = tableBody.querySelectorAll('.draggable-sales-summary-row');
  const order = Array.from(rows)
    .map(row => row.querySelector('td strong')?.textContent?.trim())
    .filter(Boolean);

  localStorage.setItem(SALES_SUMMARY_ORDER_KEY, JSON.stringify(order));
}

function toggleMonthDetails(month) {
  if (expandedSalesMonth === month) {
    hideMonthDetails();
  } else {
    expandedSalesMonth = month;
    renderMonthDetails(month);
  }
}

function hideMonthDetails(silent = false) {
  const container = document.getElementById('sales-month-details');
  if (container) container.style.display = 'none';
  if (!silent) expandedSalesMonth = null;
}

function renderMonthDetails(month) {
  const container = document.getElementById('sales-month-details');
  const body = document.getElementById('sales-month-details-body');
  const head = document.getElementById('sales-month-details-head');
  const title = document.getElementById('sales-month-details-title');
  if (!container || !body || !title || !head) return;

  const sales = (salesSummaryCache && salesSummaryCache.sales) || [];
  const filtered = sales.filter(sale => sale.date && sale.date.startsWith(month));

  const [year, monthNumStr] = month.split('-').map(Number);
  const daysInMonth = !isNaN(year) && !isNaN(monthNumStr) ? new Date(year, monthNumStr, 0).getDate() : 31;

  const productsList = (salesSummaryCache && salesSummaryCache.products && salesSummaryCache.products.length > 0)
    ? salesSummaryCache.products
    : Array.from(new Set(filtered.map(sale => sale.fuel_type || 'غير معروف'))).sort((a, b) => a.localeCompare(b));

  const grid = new Map();
  productsList.forEach(p => grid.set(p, Array(daysInMonth).fill(0)));

  filtered.forEach(sale => {
    const product = normalizeFuelTypeForHomeChart(sale.fuel_type) || 'غير معروف';
    const dayStr = sale.date.slice(8, 10);
    const dayIdx = parseInt(dayStr, 10) - 1;
    if (dayIdx >= 0 && dayIdx < daysInMonth) {
      if (!grid.has(product)) {
        grid.set(product, Array(daysInMonth).fill(0));
      }
      const row = grid.get(product);
      row[dayIdx] += parseFloat(sale.quantity) || 0;
    }
  });

  // Build head with days
  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => `<th class="day-head">${i + 1}</th>`).join('');
  head.innerHTML = `<th>المنتج</th>${dayHeaders}`;

  // Build body rows
  const rowsHtml = Array.from(grid.entries()).map(([product, values]) => {
    const cells = values.map(v => `<td class="cell-qty-only">${formatArabicNumber(v)}</td>`).join('');
    return `<tr><td>${product}</td>${cells}</tr>`;
  }).join('');

  body.innerHTML = rowsHtml || `<tr><td colspan="${daysInMonth + 1}" style="text-align:center; color:#777;">لا توجد بيانات لهذا الشهر</td></tr>`;

  title.textContent = formatMonthLabel(month);
  container.style.display = 'block';
}

function formatMonthLabel(monthStr) {
  if (!monthStr) return '-';
  const [y, m] = monthStr.split('-');
  return `${m}/${y}`;
}

function normalizeMonthKey(monthKey) {
  const normalized = String(monthKey || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : null;
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getDefaultProfitRange(availableMonths) {
  const normalizedMonths = Array.isArray(availableMonths)
    ? availableMonths
        .map((monthKey) => normalizeMonthKey(monthKey))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    : [];

  if (normalizedMonths.length === 0) {
    const currentMonth = getCurrentMonthKey();
    return { fromMonth: currentMonth, toMonth: currentMonth };
  }

  const toMonth = normalizedMonths[normalizedMonths.length - 1];
  const fromMonth = normalizedMonths[Math.max(0, normalizedMonths.length - 12)];
  return { fromMonth, toMonth };
}

function formatProfitMonthLabel(monthKey) {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return '-';
  const [yearText, monthText] = normalized.split('-');
  const monthIndex = Math.max(0, Math.min(11, parseInt(monthText, 10) - 1));
  return `${SAFE_BOOK_MONTH_NAMES[monthIndex]} ${convertToArabicNumerals(yearText)}`;
}

function normalizeProfitCustomRowType(value) {
  const type = String(value || '').trim();
  return type === 'deduction' ? 'deduction' : 'revenue';
}

function normalizeProfitCustomRow(row) {
  if (!row || typeof row !== 'object') return null;

  const rowKey = String(row.row_key || '').trim();
  if (!rowKey) return null;

  const rowType = normalizeProfitCustomRowType(row.row_type);
  const rowLabelRaw = String(row.row_label || '').trim();
  const defaultLabel = rowType === 'deduction' ? 'خصم إضافي' : 'إيراد إضافي';

  return {
    row_key: rowKey,
    row_type: rowType,
    row_label: rowLabelRaw || defaultLabel,
    display_order: parseInt(row.display_order, 10) || 0
  };
}

function getProfitCustomValue(rowKey, monthKey) {
  const normalizedMonth = normalizeMonthKey(monthKey);
  const key = `${rowKey}__${normalizedMonth}`;
  return parseAnnualInventoryValue(profitCustomValuesMap.get(key));
}

function setProfitCustomValue(rowKey, monthKey, amount) {
  const normalizedMonth = normalizeMonthKey(monthKey);
  if (!normalizedMonth) return;
  const key = `${rowKey}__${normalizedMonth}`;
  profitCustomValuesMap.set(key, parseAnnualInventoryValue(amount));
}

function getProfitCustomTotalsForMonth(monthKey) {
  const normalizedMonth = normalizeMonthKey(monthKey);
  if (!normalizedMonth) return { revenue: 0, deduction: 0 };

  let revenue = 0;
  let deduction = 0;
  profitCustomRowsCache.forEach((row) => {
    const value = getProfitCustomValue(row.row_key, normalizedMonth);
    if (row.row_type === 'deduction') {
      deduction += value;
    } else {
      revenue += value;
    }
  });

  return { revenue, deduction };
}

function recalculateProfitDerivedValues(row, customTotals = { revenue: 0, deduction: 0 }) {
  if (!row || typeof row !== 'object') return row;

  row.fuel_diesel = parseAnnualInventoryValue(row.fuel_diesel);
  row.fuel_80 = parseAnnualInventoryValue(row.fuel_80);
  row.fuel_92 = parseAnnualInventoryValue(row.fuel_92);
  row.fuel_95 = parseAnnualInventoryValue(row.fuel_95);
  row.oil_total = parseAnnualInventoryValue(row.oil_total);
  row.wash_lube_month = parseAnnualInventoryValue(row.wash_lube_month);
  row.bonuses = parseAnnualInventoryValue(row.bonuses);
  row.commission_diff = parseAnnualInventoryValue(row.commission_diff);
  row.cash_insurance_month = parseAnnualInventoryValue(row.cash_insurance_month);
  row.expenses_month = parseAnnualInventoryValue(row.expenses_month);
  row.deposit_tax = parseAnnualInventoryValue(row.deposit_tax);
  row.bonus_tax = parseAnnualInventoryValue(row.bonus_tax);
  row.custom_revenue_total = parseAnnualInventoryValue(customTotals.revenue);
  row.custom_deduction_total = parseAnnualInventoryValue(customTotals.deduction);

  row.fuel_total_month = row.fuel_diesel + row.fuel_80 + row.fuel_92 + row.fuel_95;
  row.total_positive = row.fuel_total_month + row.oil_total + row.wash_lube_month + row.bonuses + row.commission_diff + row.custom_revenue_total;
  row.total_deductions = row.cash_insurance_month + row.expenses_month + row.deposit_tax + row.bonus_tax + row.custom_deduction_total;
  row.net_profit = row.total_positive - row.total_deductions;
  return row;
}

function rebuildProfitRowsWithCustomTotals() {
  profitRowsCache = (Array.isArray(profitRowsCache) ? profitRowsCache : []).map((row) => {
    const monthKey = normalizeMonthKey(row.month_key);
    const customTotals = getProfitCustomTotalsForMonth(monthKey);
    return recalculateProfitDerivedValues(row, customTotals);
  });
}

function getSortedProfitCustomRowsByType(rowType) {
  return profitCustomRowsCache
    .filter((row) => row.row_type === rowType)
    .sort((a, b) => (a.display_order - b.display_order) || a.row_key.localeCompare(b.row_key));
}

function buildProfitDisplayRows() {
  const revenueRows = PROFIT_TABLE_ROWS.filter((row) => row.section === 'revenue');
  const deductionRows = PROFIT_TABLE_ROWS.filter((row) => row.section === 'deduction');

  const customRevenueRows = getSortedProfitCustomRowsByType('revenue').map((row) => ({
    key: row.row_key,
    label: row.row_label,
    type: 'custom',
    section: 'revenue',
    cellClass: 'positive-col',
    row_key: row.row_key
  }));

  const customDeductionRows = getSortedProfitCustomRowsByType('deduction').map((row) => ({
    key: row.row_key,
    label: row.row_label,
    type: 'custom',
    section: 'deduction',
    cellClass: 'deduction-col',
    row_key: row.row_key
  }));

  return [
    ...revenueRows,
    ...customRevenueRows,
    ...deductionRows,
    ...customDeductionRows,
    {
      key: 'total_positive',
      label: 'إجمالي الإيرادات',
      type: 'auto',
      section: 'revenue-total',
      cellClass: 'positive-col auto-col',
      rowClass: 'profit-summary-row',
      numberFormat: 'whole'
    },
    {
      key: 'total_deductions',
      label: 'إجمالي الخصومات',
      type: 'auto',
      section: 'deduction-total',
      cellClass: 'deduction-col auto-col',
      rowClass: 'profit-summary-row',
      numberFormat: 'whole'
    },
    {
      key: 'net_profit',
      label: 'صافي المكسب',
      type: 'auto-net',
      section: 'net',
      cellClass: 'net-col',
      rowClass: 'profit-net-row',
      numberFormat: 'whole'
    }
  ];
}

function setProfitSaveStatus(state, customMessage = '') {
  const statusEl = document.getElementById('profit-save-status');
  if (!statusEl) return;

  const stateMessages = {
    idle: 'جاهز',
    saving: 'جارٍ الحفظ...',
    saved: 'تم الحفظ',
    error: 'خطأ'
  };

  statusEl.classList.remove('idle', 'saving', 'saved', 'error');
  statusEl.classList.add(state || 'idle');
  statusEl.textContent = customMessage || stateMessages[state] || stateMessages.idle;
}

function bindProfitRowActionButtons() {
  const addRevenueButton = document.getElementById('profit-add-revenue-row');
  if (addRevenueButton && addRevenueButton.dataset.bound !== 'true') {
    addRevenueButton.addEventListener('click', () => {
      addProfitCustomRow('revenue');
    });
    addRevenueButton.dataset.bound = 'true';
  }

  const addDeductionButton = document.getElementById('profit-add-deduction-row');
  if (addDeductionButton && addDeductionButton.dataset.bound !== 'true') {
    addDeductionButton.addEventListener('click', () => {
      addProfitCustomRow('deduction');
    });
    addDeductionButton.dataset.bound = 'true';
  }
}

function populateProfitFilterOptions(availableMonths, defaultRange) {
  const startMonthSel = document.getElementById('profit-start-month');
  const startYearSel = document.getElementById('profit-start-year');
  const endMonthSel = document.getElementById('profit-end-month');
  const endYearSel = document.getElementById('profit-end-year');
  if (!startMonthSel || !startYearSel || !endMonthSel || !endYearSel) return;

  const validMonths = Array.isArray(availableMonths)
    ? availableMonths
        .map((monthKey) => normalizeMonthKey(monthKey))
        .filter(Boolean)
    : [];

  const nowYear = new Date().getFullYear();
  const yearValues = validMonths.map((monthKey) => parseInt(monthKey.slice(0, 4), 10)).filter(Number.isFinite);
  const minYear = yearValues.length > 0 ? Math.min(...yearValues) : nowYear;
  const maxYear = yearValues.length > 0 ? Math.max(nowYear, Math.max(...yearValues)) : nowYear;

  const years = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    years.push(year);
  }

  const monthOptions = SAFE_BOOK_MONTH_NAMES.map((label, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label
  }));
  const yearOptions = years.map((year) => ({
    value: String(year),
    label: convertToArabicNumerals(year)
  }));

  const fillSelect = (select, options, selectedValue) => {
    select.innerHTML = options.map((option) => (
      `<option value="${option.value}">${option.label}</option>`
    )).join('');
    if (selectedValue) {
      select.value = selectedValue;
    }
  };

  const safeDefault = defaultRange && normalizeMonthKey(defaultRange.fromMonth) && normalizeMonthKey(defaultRange.toMonth)
    ? defaultRange
    : getDefaultProfitRange(validMonths);

  fillSelect(startMonthSel, monthOptions, safeDefault.fromMonth.slice(5, 7));
  fillSelect(endMonthSel, monthOptions, safeDefault.toMonth.slice(5, 7));
  fillSelect(startYearSel, yearOptions, safeDefault.fromMonth.slice(0, 4));
  fillSelect(endYearSel, yearOptions, safeDefault.toMonth.slice(0, 4));

  [startMonthSel, startYearSel, endMonthSel, endYearSel].forEach((select) => {
    if (select.dataset.profitAutoBound === 'true') return;
    select.addEventListener('change', () => {
      loadProfitMonthlyData();
    });
    select.dataset.profitAutoBound = 'true';
  });

  const clearBtn = document.getElementById('profit-clear-filter-btn');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.addEventListener('click', () => {
      if (!profitDefaultRange) {
        profitDefaultRange = getDefaultProfitRange(validMonths);
      }
      if (profitDefaultRange) {
        startMonthSel.value = profitDefaultRange.fromMonth.slice(5, 7);
        startYearSel.value = profitDefaultRange.fromMonth.slice(0, 4);
        endMonthSel.value = profitDefaultRange.toMonth.slice(5, 7);
        endYearSel.value = profitDefaultRange.toMonth.slice(0, 4);
      }
      loadProfitMonthlyData(profitDefaultRange);
    });
    clearBtn.dataset.bound = 'true';
  }
}

function getProfitFiltersRange() {
  const startMonthSel = document.getElementById('profit-start-month');
  const startYearSel = document.getElementById('profit-start-year');
  const endMonthSel = document.getElementById('profit-end-month');
  const endYearSel = document.getElementById('profit-end-year');

  if (!startMonthSel || !startYearSel || !endMonthSel || !endYearSel) {
    const currentMonth = getCurrentMonthKey();
    return { valid: true, fromMonth: currentMonth, toMonth: currentMonth };
  }

  const startMonth = normalizeMonthKey(`${startYearSel.value}-${startMonthSel.value}`);
  const endMonth = normalizeMonthKey(`${endYearSel.value}-${endMonthSel.value}`);

  if (!startMonth || !endMonth) {
    return { valid: false, message: 'صيغة الشهر غير صحيحة' };
  }

  if (startMonth > endMonth) {
    return { valid: false, message: 'فترة زمنية غير صحيحة' };
  }

  return { valid: true, fromMonth: startMonth, toMonth: endMonth };
}

async function initializeProfitDashboard() {
  try {
    const availableMonths = await ipcRenderer.invoke('get-profit-available-months');
    profitDefaultRange = getDefaultProfitRange(availableMonths);
    populateProfitFilterOptions(availableMonths, profitDefaultRange);
    bindProfitRowActionButtons();
    setProfitSaveStatus('idle');
    await loadProfitMonthlyData(profitDefaultRange);
  } catch (error) {
    console.error('Error initializing profit dashboard:', error);
    setProfitSaveStatus('error');
    updateProfitKpis([]);
    renderProfitTableMessage('حدث خطأ أثناء تحميل بيانات المكسب', 'error');
  }
}

function updateProfitKpis(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totals = safeRows.reduce((acc, row) => {
    acc.net += parseAnnualInventoryValue(row.net_profit);
    acc.positive += parseAnnualInventoryValue(row.total_positive);
    acc.deductions += parseAnnualInventoryValue(row.total_deductions);
    return acc;
  }, { net: 0, positive: 0, deductions: 0 });

  const netEl = document.getElementById('profit-kpi-net');
  const positiveEl = document.getElementById('profit-kpi-positive');
  const deductionsEl = document.getElementById('profit-kpi-deductions');

  if (netEl) netEl.textContent = formatArabicCurrencyWhole(totals.net);
  if (positiveEl) positiveEl.textContent = formatArabicCurrency(totals.positive);
  if (deductionsEl) deductionsEl.textContent = formatArabicCurrency(totals.deductions);
}

function renderProfitTableMessage(message, tone = 'neutral') {
  const headRow = document.getElementById('profit-monthly-head');
  const tbody = document.getElementById('profit-monthly-body');
  if (headRow) {
    headRow.innerHTML = '<th>البند</th>';
  }
  if (!tbody) return;

  const color = tone === 'error' ? '#c4291d' : '#777';
  tbody.innerHTML = `
    <tr>
      <td colspan="2" style="text-align:center; color:${color};">${escapeHtml(message)}</td>
    </tr>
  `;
}

function getProfitTableScrollState() {
  const container = document.querySelector('.profit-table-scroll');
  if (!container) return null;
  return { top: container.scrollTop, left: container.scrollLeft };
}

function restoreProfitTableScrollState(state) {
  if (!state) return;
  const container = document.querySelector('.profit-table-scroll');
  if (!container) return;
  container.scrollTop = state.top || 0;
  container.scrollLeft = state.left || 0;
}

function renderProfitMonthlyRows(rows) {
  const headRow = document.getElementById('profit-monthly-head');
  const tbody = document.getElementById('profit-monthly-body');
  const emptyState = document.getElementById('profit-empty');
  if (!headRow || !tbody) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    renderProfitTableMessage('لا توجد بيانات في الفترة المحددة');
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const months = rows
    .map((row) => normalizeMonthKey(row.month_key))
    .filter(Boolean);

  headRow.innerHTML = `
    <th>البند</th>
    ${months.map((monthKey) => `<th>${formatProfitMonthLabel(monthKey)}</th>`).join('')}
  `;

  const renderManualInput = (monthKey, fieldName, value, cellClass = '') => `
    <td class="${cellClass || ''}">
      <input
        type="text"
        class="profit-manual-input"
        data-month-key="${escapeHtml(monthKey)}"
        data-field="${escapeHtml(fieldName)}"
        value="${escapeHtml(formatArabicNumberFixed(parseAnnualInventoryValue(value)))}"
        inputmode="decimal"
      >
    </td>
  `;

  const renderNumberCell = (value, cellClass = '', numberFormat = 'fixed') => {
    const normalized = parseAnnualInventoryValue(value);
    const className = cellClass ? ` class="${cellClass}"` : '';
    const formattedValue = numberFormat === 'whole'
      ? formatArabicNumberWhole(normalized)
      : formatArabicNumberFixed(normalized);
    return `<td${className}>${formattedValue}</td>`;
  };

  const renderCustomValueInput = (rowKey, monthKey, value, cellClass = '') => `
    <td class="${cellClass || ''}">
      <input
        type="text"
        class="profit-manual-input profit-custom-value-input"
        data-row-key="${escapeHtml(rowKey)}"
        data-month-key="${escapeHtml(monthKey)}"
        value="${escapeHtml(formatArabicNumberFixed(parseAnnualInventoryValue(value)))}"
        inputmode="decimal"
      >
    </td>
  `;

  const displayRows = buildProfitDisplayRows();
  tbody.innerHTML = displayRows.map((metric) => {
    const isCustomRow = metric.type === 'custom';
    const labelCell = isCustomRow
      ? `
        <td class="profit-label-cell ${metric.cellClass || ''}">
          <div class="profit-custom-label-wrap">
            <input
              type="text"
              class="profit-custom-label-input"
              data-row-key="${escapeHtml(metric.row_key)}"
              value="${escapeHtml(metric.label)}"
            >
            <button
              type="button"
              class="profit-custom-delete-btn"
              data-row-key="${escapeHtml(metric.row_key)}"
              title="حذف الصف"
            >✕</button>
          </div>
        </td>
      `
      : `<td class="profit-label-cell ${metric.cellClass || ''}"><strong>${escapeHtml(metric.label)}</strong></td>`;

    return `
      <tr data-profit-row-key="${escapeHtml(metric.key)}" class="${escapeHtml(metric.rowClass || '')}">
        ${labelCell}
        ${months.map((monthKey) => {
          const monthRow = rows.find((row) => normalizeMonthKey(row.month_key) === monthKey) || {};
          if (metric.type === 'manual-fixed') {
            return renderManualInput(monthKey, metric.key, monthRow[metric.key], metric.cellClass);
          }
          if (metric.type === 'custom') {
            const value = getProfitCustomValue(metric.row_key, monthKey);
            return renderCustomValueInput(metric.row_key, monthKey, value, metric.cellClass);
          }
          if (metric.type === 'auto-net') {
            const value = parseAnnualInventoryValue(monthRow[metric.key]);
            const netClass = value < 0 ? 'net-col negative' : 'net-col';
            return renderNumberCell(value, netClass, metric.numberFormat);
          }
          return renderNumberCell(monthRow[metric.key], metric.cellClass, metric.numberFormat);
        }).join('')}
      </tr>
    `;
  }).join('');

  bindProfitManualInputEvents();
}

function bindProfitManualInputEvents() {
  document.querySelectorAll('.profit-manual-input:not(.profit-custom-value-input)').forEach((input) => {
    if (input.dataset.bound === 'true') return;

    input.addEventListener('focus', () => {
      input.select();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      saveProfitManualField(input);
    });

    input.dataset.bound = 'true';
  });

  document.querySelectorAll('.profit-custom-value-input').forEach((input) => {
    if (input.dataset.customBound === 'true') return;

    input.addEventListener('focus', () => {
      input.select();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      saveProfitCustomValue(input);
    });

    input.dataset.customBound = 'true';
  });

  document.querySelectorAll('.profit-custom-label-input').forEach((input) => {
    if (input.dataset.labelBound === 'true') return;

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      saveProfitCustomLabel(input);
    });

    input.dataset.labelBound = 'true';
  });

  document.querySelectorAll('.profit-custom-delete-btn').forEach((button) => {
    if (button.dataset.deleteBound === 'true') return;

    button.addEventListener('click', () => {
      const rowKey = String(button.dataset.rowKey || '').trim();
      if (!rowKey) return;
      deleteProfitCustomRowByKey(rowKey);
    });

    button.dataset.deleteBound = 'true';
  });
}

async function saveProfitManualField(input) {
  if (!input) return;

  const monthKey = normalizeMonthKey(input.dataset.monthKey);
  const fieldName = String(input.dataset.field || '').trim();
  if (!monthKey || !PROFIT_MANUAL_FIELDS.includes(fieldName)) return;

  const newValue = parseAnnualInventoryValue(input.value);
  input.value = formatArabicNumberFixed(newValue);

  const row = profitRowsCache.find((item) => item.month_key === monthKey);
  if (row && Math.abs(parseAnnualInventoryValue(row[fieldName]) - newValue) < 0.0001) {
    return;
  }

  input.disabled = true;
  setProfitSaveStatus('saving');

  try {
    await ipcRenderer.invoke('upsert-monthly-profit-input', {
      month_key: monthKey,
      field: fieldName,
      value: newValue
    });

    if (row) {
      row[fieldName] = newValue;
      rebuildProfitRowsWithCustomTotals();
    } else {
      await loadProfitMonthlyData();
    }

    const scrollState = getProfitTableScrollState();
    renderProfitMonthlyRows(profitRowsCache);
    restoreProfitTableScrollState(scrollState);
    updateProfitKpis(profitRowsCache);

    setProfitSaveStatus('saved');
    setTimeout(() => {
      setProfitSaveStatus('idle');
    }, 1200);
  } catch (error) {
    console.error('Error saving monthly profit value:', error);
    setProfitSaveStatus('error', 'خطأ');
  } finally {
    input.disabled = false;
  }
}

async function saveProfitCustomValue(input) {
  if (!input) return;

  const rowKey = String(input.dataset.rowKey || '').trim();
  const monthKey = normalizeMonthKey(input.dataset.monthKey);
  if (!rowKey || !monthKey) return;

  const newValue = parseAnnualInventoryValue(input.value);
  input.value = formatArabicNumberFixed(newValue);

  if (Math.abs(getProfitCustomValue(rowKey, monthKey) - newValue) < 0.0001) {
    return;
  }

  input.disabled = true;
  setProfitSaveStatus('saving');

  try {
    await ipcRenderer.invoke('upsert-profit-custom-value', {
      row_key: rowKey,
      month_key: monthKey,
      amount: newValue
    });

    setProfitCustomValue(rowKey, monthKey, newValue);
    rebuildProfitRowsWithCustomTotals();

    const scrollState = getProfitTableScrollState();
    renderProfitMonthlyRows(profitRowsCache);
    restoreProfitTableScrollState(scrollState);
    updateProfitKpis(profitRowsCache);

    setProfitSaveStatus('saved');
    setTimeout(() => {
      setProfitSaveStatus('idle');
    }, 1200);
  } catch (error) {
    console.error('Error saving custom profit value:', error);
    setProfitSaveStatus('error', 'خطأ');
  } finally {
    input.disabled = false;
  }
}

async function saveProfitCustomLabel(input) {
  if (!input) return;

  const rowKey = String(input.dataset.rowKey || '').trim();
  if (!rowKey) return;

  const row = profitCustomRowsCache.find((item) => item.row_key === rowKey);
  if (!row) return;

  const fallbackLabel = row.row_type === 'deduction' ? 'خصم إضافي' : 'إيراد إضافي';
  const newLabel = String(input.value || '').trim() || fallbackLabel;

  if (newLabel === row.row_label) {
    input.value = row.row_label;
    return;
  }

  input.disabled = true;
  setProfitSaveStatus('saving');

  try {
    await ipcRenderer.invoke('update-profit-custom-row-label', {
      row_key: rowKey,
      row_label: newLabel
    });

    row.row_label = newLabel;
    const scrollState = getProfitTableScrollState();
    renderProfitMonthlyRows(profitRowsCache);
    restoreProfitTableScrollState(scrollState);
    updateProfitKpis(profitRowsCache);

    setProfitSaveStatus('saved');
    setTimeout(() => {
      setProfitSaveStatus('idle');
    }, 1200);
  } catch (error) {
    console.error('Error saving custom profit label:', error);
    setProfitSaveStatus('error', 'خطأ');
    input.value = row.row_label;
  } finally {
    input.disabled = false;
  }
}

async function addProfitCustomRow(rowType) {
  return addProfitCustomRowAt(rowType, null);
}

async function addProfitCustomRowAt(rowType, displayOrder = null) {
  const normalizedType = normalizeProfitCustomRowType(rowType);
  const normalizedOrder = Number.isFinite(parseInt(displayOrder, 10)) && parseInt(displayOrder, 10) > 0
    ? parseInt(displayOrder, 10)
    : null;
  setProfitSaveStatus('saving');

  try {
    const createdRow = await ipcRenderer.invoke('add-profit-custom-row', {
      row_type: normalizedType,
      display_order: normalizedOrder
    });
    const normalizedRow = normalizeProfitCustomRow(createdRow);
    if (normalizedRow) {
      if (normalizedOrder !== null) {
        profitCustomRowsCache.forEach((row) => {
          if (row.row_type === normalizedType && row.display_order >= normalizedOrder) {
            row.display_order += 1;
          }
        });
      }
      profitCustomRowsCache.push(normalizedRow);
      rebuildProfitRowsWithCustomTotals();
      const scrollState = getProfitTableScrollState();
      renderProfitMonthlyRows(profitRowsCache);
      restoreProfitTableScrollState(scrollState);
      updateProfitKpis(profitRowsCache);
    }

    setProfitSaveStatus('saved');
    setTimeout(() => {
      setProfitSaveStatus('idle');
    }, 1200);
  } catch (error) {
    console.error('Error adding custom profit row:', error);
    setProfitSaveStatus('error', 'خطأ');
  }
}

async function deleteProfitCustomRowByKey(rowKey) {
  const key = String(rowKey || '').trim();
  if (!key) return;

  const row = profitCustomRowsCache.find((item) => item.row_key === key);
  if (!row) return;

  const confirmed = confirm('سيتم حذف الصف نهائيًا. هل تريد المتابعة؟');
  if (!confirmed) return;

  setProfitSaveStatus('saving');

  try {
    await ipcRenderer.invoke('delete-profit-custom-row', { row_key: key });

    profitCustomRowsCache = profitCustomRowsCache.filter((item) => item.row_key !== key);
    profitCustomValuesMap.forEach((_value, compositeKey) => {
      if (compositeKey.startsWith(`${key}__`)) {
        profitCustomValuesMap.delete(compositeKey);
      }
    });

    rebuildProfitRowsWithCustomTotals();
    const scrollState = getProfitTableScrollState();
    renderProfitMonthlyRows(profitRowsCache);
    restoreProfitTableScrollState(scrollState);
    updateProfitKpis(profitRowsCache);

    setProfitSaveStatus('saved');
    setTimeout(() => {
      setProfitSaveStatus('idle');
    }, 1200);
  } catch (error) {
    console.error('Error deleting custom profit row:', error);
    setProfitSaveStatus('error', 'خطأ');
  }
}

async function loadProfitMonthlyData(explicitRange = null) {
  const explicitFromMonth = normalizeMonthKey(explicitRange?.fromMonth);
  const explicitToMonth = normalizeMonthKey(explicitRange?.toMonth);
  const range = explicitFromMonth && explicitToMonth
    ? {
        valid: explicitFromMonth <= explicitToMonth,
        fromMonth: explicitFromMonth,
        toMonth: explicitToMonth,
        message: explicitFromMonth <= explicitToMonth ? '' : 'فترة زمنية غير صحيحة'
      }
    : getProfitFiltersRange();
  const requestId = ++profitLoadRequestId;
  const tbody = document.getElementById('profit-monthly-body');
  const emptyState = document.getElementById('profit-empty');
  if (!tbody) return;

  if (!range.valid) {
    renderProfitTableMessage(range.message || 'فترة زمنية غير صحيحة');
    if (emptyState) emptyState.style.display = 'none';
    updateProfitKpis([]);
    return;
  }

  try {
    const [rows, customRows, customValues] = await Promise.all([
      ipcRenderer.invoke('get-profit-monthly-data', {
        fromMonth: range.fromMonth,
        toMonth: range.toMonth
      }),
      ipcRenderer.invoke('get-profit-custom-rows'),
      ipcRenderer.invoke('get-profit-custom-values', {
        fromMonth: range.fromMonth,
        toMonth: range.toMonth
      })
    ]);

    if (requestId !== profitLoadRequestId) {
      return;
    }

    profitCustomRowsCache = (Array.isArray(customRows) ? customRows : [])
      .map((row) => normalizeProfitCustomRow(row))
      .filter(Boolean);

    profitCustomValuesMap = new Map();
    (Array.isArray(customValues) ? customValues : []).forEach((entry) => {
      const rowKey = String(entry?.row_key || '').trim();
      const monthKey = normalizeMonthKey(entry?.month_key);
      if (!rowKey || !monthKey) return;
      setProfitCustomValue(rowKey, monthKey, parseAnnualInventoryValue(entry?.amount));
    });

    profitRowsCache = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
    rebuildProfitRowsWithCustomTotals();
    renderProfitMonthlyRows(profitRowsCache);
    updateProfitKpis(profitRowsCache);
    const statusEl = document.getElementById('profit-save-status');
    if (!statusEl || !statusEl.classList.contains('saving')) {
      setProfitSaveStatus('idle');
    }
  } catch (error) {
    if (requestId !== profitLoadRequestId) {
      return;
    }
    console.error('Error loading monthly profit data:', error);
    profitRowsCache = [];
    profitCustomRowsCache = [];
    profitCustomValuesMap = new Map();
    renderProfitTableMessage('حدث خطأ أثناء تحميل بيانات المكسب', 'error');
    if (emptyState) emptyState.style.display = 'none';
    setProfitSaveStatus('error');
    updateProfitKpis([]);
  }
}

function getDefaultExpenseRange() {
  const now = new Date();
  return {
    fromMonth: `${now.getFullYear()}-01`,
    toMonth: getCurrentMonthKey()
  };
}

function buildMonthRange(fromMonth, toMonth) {
  const from = normalizeMonthKey(fromMonth);
  const to = normalizeMonthKey(toMonth);
  if (!from || !to || from > to) {
    return [];
  }

  const [fromYear, fromMonthNumber] = from.split('-').map((value) => parseInt(value, 10));
  const [toYear, toMonthNumber] = to.split('-').map((value) => parseInt(value, 10));

  const cursor = new Date(fromYear, fromMonthNumber - 1, 1);
  const end = new Date(toYear, toMonthNumber - 1, 1);
  const months = [];

  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function formatExpenseMonthLabel(monthKey) {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return '-';
  const [yearText, monthText] = normalized.split('-');
  const monthIndex = Math.max(0, Math.min(11, parseInt(monthText, 10) - 1));
  return `${SAFE_BOOK_MONTH_NAMES[monthIndex]} ${convertToArabicNumerals(yearText)}`;
}

function parseExpenseAmountFilter(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const amount = parseFloat(text);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function scheduleExpenseFiltersReload(delay = 0) {
  if (expenseFilterDebounceTimer) {
    clearTimeout(expenseFilterDebounceTimer);
    expenseFilterDebounceTimer = null;
  }

  if (delay > 0) {
    expenseFilterDebounceTimer = setTimeout(() => {
      expenseFilterDebounceTimer = null;
      loadExpenseEntries();
    }, delay);
    return;
  }

  loadExpenseEntries();
}

function populateExpenseFilterOptions(availableMonths, defaultRange) {
  const startMonthSel = document.getElementById('expenses-start-month');
  const startYearSel = document.getElementById('expenses-start-year');
  const endMonthSel = document.getElementById('expenses-end-month');
  const endYearSel = document.getElementById('expenses-end-year');
  if (!startMonthSel || !startYearSel || !endMonthSel || !endYearSel) return;

  const validMonths = Array.isArray(availableMonths)
    ? availableMonths
        .map((monthKey) => normalizeMonthKey(monthKey))
        .filter(Boolean)
    : [];

  const nowYear = new Date().getFullYear();
  const yearValues = validMonths.map((monthKey) => parseInt(monthKey.slice(0, 4), 10)).filter(Number.isFinite);
  const minYear = yearValues.length > 0 ? Math.min(...yearValues) : nowYear;
  const maxYear = yearValues.length > 0 ? Math.max(nowYear, Math.max(...yearValues)) : nowYear;

  const years = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    years.push(year);
  }

  const monthOptions = SAFE_BOOK_MONTH_NAMES.map((label, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label
  }));
  const yearOptions = years.map((year) => ({
    value: String(year),
    label: convertToArabicNumerals(year)
  }));

  const fillSelect = (select, options, selectedValue) => {
    select.innerHTML = options.map((option) => (
      `<option value="${option.value}">${option.label}</option>`
    )).join('');
    if (selectedValue) {
      select.value = selectedValue;
    }
  };

  const safeDefault = defaultRange && normalizeMonthKey(defaultRange.fromMonth) && normalizeMonthKey(defaultRange.toMonth)
    ? defaultRange
    : getDefaultExpenseRange();

  fillSelect(startMonthSel, monthOptions, safeDefault.fromMonth.slice(5, 7));
  fillSelect(endMonthSel, monthOptions, safeDefault.toMonth.slice(5, 7));
  fillSelect(startYearSel, yearOptions, safeDefault.fromMonth.slice(0, 4));
  fillSelect(endYearSel, yearOptions, safeDefault.toMonth.slice(0, 4));

  [startMonthSel, startYearSel, endMonthSel, endYearSel].forEach((select) => {
    if (select.dataset.bound !== 'true') {
      select.addEventListener('change', () => scheduleExpenseFiltersReload());
      select.dataset.bound = 'true';
    }
  });

  const minAmountInput = document.getElementById('expenses-min-amount');
  const maxAmountInput = document.getElementById('expenses-max-amount');
  const searchInput = document.getElementById('expenses-search-term');

  [minAmountInput, maxAmountInput, searchInput].forEach((input) => {
    if (input && input.dataset.bound !== 'true') {
      input.addEventListener('input', () => scheduleExpenseFiltersReload(250));
      input.dataset.bound = 'true';
    }
  });

}

function getExpenseFiltersRange() {
  const startMonthSel = document.getElementById('expenses-start-month');
  const startYearSel = document.getElementById('expenses-start-year');
  const endMonthSel = document.getElementById('expenses-end-month');
  const endYearSel = document.getElementById('expenses-end-year');
  const minAmountInput = document.getElementById('expenses-min-amount');
  const maxAmountInput = document.getElementById('expenses-max-amount');
  const searchInput = document.getElementById('expenses-search-term');

  const currentMonth = getCurrentMonthKey();
  const startMonth = startMonthSel && startYearSel
    ? normalizeMonthKey(`${startYearSel.value}-${startMonthSel.value}`)
    : currentMonth;
  const endMonth = endMonthSel && endYearSel
    ? normalizeMonthKey(`${endYearSel.value}-${endMonthSel.value}`)
    : currentMonth;

  if (!startMonth || !endMonth) {
    return { valid: false, message: 'صيغة الشهر غير صحيحة' };
  }

  if (startMonth > endMonth) {
    return { valid: false, message: 'فترة زمنية غير صحيحة' };
  }

  const minAmount = parseExpenseAmountFilter(minAmountInput?.value);
  const maxAmount = parseExpenseAmountFilter(maxAmountInput?.value);

  if ((minAmount !== null && (!Number.isFinite(minAmount) || minAmount < 0))
    || (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < 0))) {
    return { valid: false, message: 'قيمة المبلغ غير صحيحة', fromMonth: startMonth, toMonth: endMonth };
  }

  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    return { valid: false, message: 'فترة المبلغ غير صحيحة', fromMonth: startMonth, toMonth: endMonth };
  }

  return {
    valid: true,
    fromMonth: startMonth,
    toMonth: endMonth,
    minAmount,
    maxAmount,
    searchTerm: String(searchInput?.value || '').trim()
  };
}

async function initializeExpensesDashboard() {
  try {
    const availableMonths = await ipcRenderer.invoke('get-expense-available-months');
    expenseDefaultRange = getDefaultExpenseRange();
    populateExpenseFilterOptions(availableMonths, expenseDefaultRange);
    await loadExpenseEntries();
  } catch (error) {
    console.error('Error initializing expenses dashboard:', error);
    expenseEntriesCache = [];
    renderExpenseTableMessage('حدث خطأ أثناء تحميل بيانات المصاريف', 'error');
    const emptyState = document.getElementById('expenses-empty');
    if (emptyState) emptyState.style.display = 'none';
  }
}

function renderExpenseTableMessage(message, tone = 'neutral', months = []) {
  const headRow = document.getElementById('expenses-summary-head');
  const tbody = document.getElementById('expenses-table-body');
  if (!tbody || !headRow) return;

  const safeMonths = Array.isArray(months) ? months : [];
  headRow.innerHTML = [
    '<th>المصروف</th>',
    ...safeMonths.map((month) => `<th>${formatExpenseMonthLabel(month)}</th>`),
    '<th>الإجمالي</th>'
  ].join('');

  const color = tone === 'error' ? '#c4291d' : '#777';
  tbody.innerHTML = `
    <tr>
      <td colspan="${safeMonths.length + 2}" style="text-align:center; color:${color};">${escapeHtml(message)}</td>
    </tr>
  `;
}

function normalizeExpenseDescriptionForOrder(description) {
  return normalizeExcelText(description).toLowerCase().replace(/\s+/g, ' ').trim();
}

function getSavedExpenseRowOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPENSE_ROW_ORDER_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function saveExpenseRowOrder(descriptions) {
  const normalized = [];
  const seen = new Set();
  (Array.isArray(descriptions) ? descriptions : []).forEach((description) => {
    const clean = String(description || '').trim();
    const key = normalizeExpenseDescriptionForOrder(clean);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    normalized.push(clean);
  });
  localStorage.setItem(EXPENSE_ROW_ORDER_KEY, JSON.stringify(normalized));
}

function getExpenseDefaultOrderRank(description) {
  const key = normalizeExpenseDescriptionForOrder(description);
  return DEFAULT_EXPENSE_ROW_ORDER
    .map(normalizeExpenseDescriptionForOrder)
    .indexOf(key);
}

function getExpenseManualOrderRank(description) {
  const key = normalizeExpenseDescriptionForOrder(description);
  return getSavedExpenseRowOrder()
    .map(normalizeExpenseDescriptionForOrder)
    .indexOf(key);
}

function sortExpenseDescriptions(descriptions, rowMap) {
  return [...descriptions].sort((a, b) => {
    const manualA = getExpenseManualOrderRank(a);
    const manualB = getExpenseManualOrderRank(b);
    if (manualA !== -1 || manualB !== -1) {
      if (manualA === -1) return 1;
      if (manualB === -1) return -1;
      return manualA - manualB;
    }

    const defaultA = getExpenseDefaultOrderRank(a);
    const defaultB = getExpenseDefaultOrderRank(b);
    if (defaultA !== -1 || defaultB !== -1) {
      if (defaultA === -1) return 1;
      if (defaultB === -1) return -1;
      return defaultA - defaultB;
    }

    const totalA = rowMap.get(a)?.total || 0;
    const totalB = rowMap.get(b)?.total || 0;
    if (Math.abs(totalB - totalA) > 0.0001) {
      return totalB - totalA;
    }
    return a.localeCompare(b, 'ar');
  });
}

function renderExpenseTableRows(entries, months = []) {
  const headRow = document.getElementById('expenses-summary-head');
  const tbody = document.getElementById('expenses-table-body');
  const emptyState = document.getElementById('expenses-empty');
  if (!tbody || !headRow) return;

  const safeMonths = Array.isArray(months) ? months : [];
  if (safeMonths.length === 0) {
    renderExpenseTableMessage('لا توجد أشهر ضمن الفترة المحددة');
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    renderExpenseTableMessage('لا توجد مصروفات في الفترة المحددة', 'neutral', safeMonths);
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) {
    emptyState.style.display = 'none';
  }

  const monthSet = new Set(safeMonths);
  const rowMap = new Map();

  entries.forEach((entry) => {
    const monthKey = normalizeMonthKey(String(entry?.date || '').slice(0, 7));
    if (!monthKey || !monthSet.has(monthKey)) {
      return;
    }

    const rawDescription = String(entry?.description || '').trim();
    const description = entry?.is_aggregated
      ? rawDescription || LEGACY_AGGREGATED_EXPENSE_LABEL
      : rawDescription || EMPTY_EXPENSE_DESCRIPTION_LABEL;
    const amount = parseFloat(entry?.amount) || 0;

    if (!rowMap.has(description)) {
      rowMap.set(description, { total: 0, byMonth: new Map() });
    }

    const row = rowMap.get(description);
    row.total += amount;
    row.byMonth.set(monthKey, (row.byMonth.get(monthKey) || 0) + amount);
  });

  const descriptions = sortExpenseDescriptions(Array.from(rowMap.keys()), rowMap);

  if (descriptions.length === 0) {
    renderExpenseTableMessage('لا توجد مصروفات في الفترة المحددة', 'neutral', safeMonths);
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  headRow.innerHTML = [
    '<th>المصروف</th>',
    ...safeMonths.map((month) => `<th>${formatExpenseMonthLabel(month)}</th>`),
    '<th>الإجمالي</th>'
  ].join('');

  tbody.innerHTML = descriptions.map((description) => {
    const row = rowMap.get(description);
    const monthCells = safeMonths.map((month) => {
      const value = row.byMonth.get(month) || 0;
      return `<td class="expenses-month-cell">${value > 0 ? formatArabicNumber(value) : ''}</td>`;
    }).join('');

    return `
      <tr draggable="true" class="draggable-oil-row draggable-expense-row" data-expense-description="${escapeHtml(description)}">
        <td class="oil-name-cell expenses-name-cell">
          <div class="expenses-row-cell">
            <span class="drag-handle" title="اسحب لإعادة الترتيب">⋮⋮</span>
            <strong>${escapeHtml(description)}</strong>
          </div>
        </td>
        ${monthCells}
        <td class="cell-total expenses-total-cell">${formatArabicNumber(row.total)}</td>
      </tr>
    `;
  }).join('');

  enableExpenseRowDragDrop();
}

function enableExpenseRowDragDrop() {
  const tableBody = document.getElementById('expenses-table-body');
  if (!tableBody) return;

  let draggedRow = null;
  const rows = tableBody.querySelectorAll('.draggable-expense-row');

  rows.forEach((row) => {
    row.addEventListener('dragstart', function(e) {
      draggedRow = this;
      this.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', function() {
      this.style.opacity = '1';
      draggedRow = null;
      saveExpenseRowOrderFromTable();
    });

    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (draggedRow && draggedRow !== this) {
        const rect = this.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (e.clientY < midpoint) {
          tableBody.insertBefore(draggedRow, this);
        } else {
          tableBody.insertBefore(draggedRow, this.nextSibling);
        }
      }
    });
  });
}

function saveExpenseRowOrderFromTable() {
  const tableBody = document.getElementById('expenses-table-body');
  if (!tableBody) return;

  const order = Array.from(tableBody.querySelectorAll('.draggable-expense-row'))
    .map((row) => row.dataset.expenseDescription)
    .filter(Boolean);

  saveExpenseRowOrder(order);
}

async function loadExpenseEntries() {
  const range = getExpenseFiltersRange();
  const emptyState = document.getElementById('expenses-empty');
  const months = buildMonthRange(range.fromMonth, range.toMonth);
  const tbody = document.getElementById('expenses-table-body');
  if (!tbody) return;

  if (!range.valid) {
    expenseEntriesCache = [];
    renderExpenseTableMessage(range.message || 'فلاتر غير صالحة', 'neutral', months);
    if (emptyState) emptyState.style.display = 'none';
    return;
  }

  try {
    const entries = await ipcRenderer.invoke('get-expense-entries', {
      fromMonth: range.fromMonth,
      toMonth: range.toMonth,
      minAmount: range.minAmount,
      maxAmount: range.maxAmount,
      searchTerm: range.searchTerm
    });

    expenseEntriesCache = Array.isArray(entries) ? entries : [];
    renderExpenseTableRows(expenseEntriesCache, months);
  } catch (error) {
    console.error('Error loading expense entries:', error);
    expenseEntriesCache = [];
    renderExpenseTableMessage('حدث خطأ أثناء تحميل بيانات المصاريف', 'error', months);
    if (emptyState) emptyState.style.display = 'none';
  }
}

let defaultCounters = {
  diesel: [0, 0, 0, 0],
  gas: [0, 0],
  '95': [0, 0],
  '92': [0, 0],
  '80': [0, 0]
};

// Fuel ID mapping for consistent IDs
const fuelIdMap = {
  'بنزين ٨٠': '80',
  'بنزين ٩٢': '92',
  'بنزين ٩٥': '95',
  'سولار': 'diesel',
  'غاز سيارات': 'gas'
};

let fuelProductCodesByName = new Map();

function getShiftFuelEntryName(entryKey, data = {}) {
  return String(data?.product_name || data?.fuel_type || entryKey || '').trim();
}

function findShiftFuelEntryByName(fuelData, fuelType) {
  const targetName = String(fuelType || '').trim();
  if (!fuelData || typeof fuelData !== 'object' || !targetName) return null;
  if (fuelData[targetName]) return fuelData[targetName];
  const found = Object.entries(fuelData).find(([entryKey, data]) => (
    getShiftFuelEntryName(entryKey, data) === targetName
  ));
  return found ? found[1] : null;
}

// Calculate fuel quantity sold (first shift - last shift counter) - 2 counters for gasoline
function calculateFuelQuantity(fuelType) {
  const fuelId = fuelIdMap[fuelType];
  if (fuelId === 'gas') {
    applyNightShiftGasAutoClose(false);
  }
  let totalQuantity = 0;

  // Calculate quantity for each counter individually (2 counters)
  for (let i = 1; i <= 2; i++) {
    const lastShiftInput = document.getElementById(`fuel-${fuelId}-last-${i}`);
    const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);
    const quantityInput = document.getElementById(`fuel-${fuelId}-quantity-${i}`);

    if (lastShiftInput && firstShiftInput && quantityInput) {
      const lastShift = parseFloat(lastShiftInput.value) || 0;
      const firstShift = parseFloat(firstShiftInput.value) || 0;

      // Remove any previous error state
      lastShiftInput.classList.remove('input-error');
      firstShiftInput.classList.remove('input-error');

      // Calculate quantity ONLY if lastShift is filled (not 0 and not empty)
      if (lastShiftInput.value && lastShiftInput.value.trim() !== '') {
        const counterQuantity = lastShift - firstShift;
        quantityInput.value = counterQuantity >= 0 ? Math.round(counterQuantity) : Math.round(counterQuantity);
        totalQuantity += counterQuantity;
      } else {
        // Clear quantity if lastShift is not filled
        quantityInput.value = '';
      }
    }
  }

  // Update إجمالي الكمية (total quantity)
  const totalQtyInput = document.getElementById(`fuel-${fuelId}-total-qty`);
  if (totalQtyInput) {
    totalQtyInput.value = totalQuantity >= 0 ? Math.round(totalQuantity) : '';
  }

  // Calculate cash (نقدى) automatically
  calculateCashForFuel(fuelId);
}

// Calculate diesel quantity (4 counters)
function calculateDieselQuantity() {
  let totalQuantity = 0;

  // Calculate quantity for each counter individually
  for (let i = 1; i <= 4; i++) {
    const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
    const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
    const quantityInput = document.getElementById(`fuel-diesel-quantity-${i}`);

    if (lastShiftInput && firstShiftInput && quantityInput) {
      const lastShift = parseFloat(lastShiftInput.value) || 0;
      const firstShift = parseFloat(firstShiftInput.value) || 0;

      // Remove any previous error state
      lastShiftInput.classList.remove('input-error');
      firstShiftInput.classList.remove('input-error');

      // Calculate quantity ONLY if lastShift is filled (not 0 and not empty)
      if (lastShiftInput.value && lastShiftInput.value.trim() !== '') {
        const counterQuantity = lastShift - firstShift;
        quantityInput.value = counterQuantity >= 0 ? Math.round(counterQuantity) : Math.round(counterQuantity);
        totalQuantity += counterQuantity;
      } else {
        // Clear quantity if lastShift is not filled
        quantityInput.value = '';
      }
    }
  }

  // Update إجمالي الكمية (total quantity)
  const totalQtyInput = document.getElementById('fuel-diesel-total-qty');
  if (totalQtyInput) {
    totalQtyInput.value = totalQuantity >= 0 ? Math.round(totalQuantity) : '';
  }

  // Calculate cash (نقدى) automatically
  calculateCashForFuel('diesel');
}

// Calculate cash (نقدى) for a specific fuel type
// Formula: نقدى = (إجمالي الكمية - (عملاء + عيارات)) * السعر
function calculateCashForFuel(fuelId) {
  const totalQtyInput = document.getElementById(`fuel-${fuelId}-total-qty`);
  const clientsInput = document.getElementById(`fuel-${fuelId}-clients`);
  const carsInput = document.getElementById(`fuel-${fuelId}-cars`);
  const priceInput = document.getElementById(`fuel-${fuelId}-price`);
  const cashInput = document.getElementById(`fuel-${fuelId}-cash`);

  if (totalQtyInput && clientsInput && carsInput && priceInput && cashInput) {
    const totalQty = parseFloat(totalQtyInput.value) || 0;
    const clients = parseFloat(clientsInput.value) || 0;
    const cars = parseFloat(carsInput.value) || 0;
    const price = parseFloat(priceInput.value) || 0;

    // Calculate: نقدى = (إجمالي الكمية - (عملاء + عيارات)) * السعر
    const cash = (totalQty - (clients + cars)) * price;
    cashInput.value = formatPrice(cash);
  }

  // Recalculate fuel total after updating cash
  calculateFuelTotal();
}

// Calculate total fuel revenue
function calculateFuelTotal() {
  let total = 0;

  Object.values(fuelIdMap).forEach(fuelId => {
    const cashInput = document.getElementById(`fuel-${fuelId}-cash`);
    if (cashInput) {
      const cash = parseFloat(cashInput.value) || 0;
      total += cash;
    }
  });

  // Update totals page if needed
  updateTotalsPage();

  return total;
}

function recalculateFuelDerivedRows() {
  calculateDieselQuantity();
  calculateFuelQuantity('بنزين ٩٥');
  calculateFuelQuantity('بنزين ٩٢');
  calculateFuelQuantity('بنزين ٨٠');
  calculateFuelQuantity('غاز سيارات');
  calculateFuelTotal();
}

function getSelectedShiftNumberValue() {
  const shiftNumberValue = document.getElementById('shift-number')?.value
    || currentShiftData.shiftNumber
    || '';
  const shiftNumber = parseInt(shiftNumberValue, 10);
  return Number.isFinite(shiftNumber) ? shiftNumber : null;
}

function shouldAutoCloseGasForNightShift() {
  return shiftViewMode === 'edit'
    && !currentShiftData.isSaved
    && getSelectedShiftNumberValue() === 2;
}

function applyNightShiftGasAutoClose(recalculate = true) {
  if (!shouldAutoCloseGasForNightShift()) return false;

  let changed = false;
  for (let i = 1; i <= 2; i += 1) {
    const firstShiftInput = document.getElementById(`fuel-gas-first-${i}`);
    const lastShiftInput = document.getElementById(`fuel-gas-last-${i}`);
    if (!firstShiftInput || !lastShiftInput) continue;

    const firstValue = getShiftInputDisplayValue(firstShiftInput.value);
    if (lastShiftInput.value !== firstValue) {
      lastShiftInput.value = firstValue;
      changed = true;
    }
  }

  if (changed && recalculate) {
    calculateFuelQuantity('غاز سيارات');
  }

  return changed;
}

function clearGasLastShiftCounters(recalculate = true) {
  let changed = false;

  for (let i = 1; i <= 2; i += 1) {
    const lastShiftInput = document.getElementById(`fuel-gas-last-${i}`);
    if (lastShiftInput && lastShiftInput.value !== '') {
      lastShiftInput.value = '';
      changed = true;
    }
  }

  if (changed && recalculate) {
    calculateFuelQuantity('غاز سيارات');
  }

  return changed;
}

function normalizeOilName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const oilPricesByDateCache = new Map();

function normalizeShiftDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayDate();
}

function getCachedOilPrice(oilName, date) {
  const dateKey = normalizeShiftDate(date);
  const pricesMap = oilPricesByDateCache.get(dateKey);
  if (!pricesMap) return null;
  const key = normalizeOilName(oilName);
  if (!pricesMap.has(key)) return null;
  return pricesMap.get(key);
}

function cacheOilPrice(oilName, date, price) {
  const dateKey = normalizeShiftDate(date);
  const key = normalizeOilName(oilName);
  if (!key) return;

  if (!oilPricesByDateCache.has(dateKey)) {
    oilPricesByDateCache.set(dateKey, new Map());
  }

  oilPricesByDateCache.get(dateKey).set(key, parseFloat(price) || 0);
}

function cacheOilPricesBatch(date, rows = []) {
  const dateKey = normalizeShiftDate(date);
  const map = new Map();

  rows.forEach((row) => {
    const key = normalizeOilName(row?.product_name || row?.oil_type || '');
    if (!key) return;
    map.set(key, parseFloat(row?.price) || 0);
  });

  oilPricesByDateCache.set(dateKey, map);
}

function parseOilQuantity(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  const numericValue = parseFloat(normalized);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundOilQuantity(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isOilInitialEditable(oilName) {
  return normalizeOilName(oilName) === EDITABLE_OIL_INITIAL_NAME;
}

function isShiftOilRemainingInput(input) {
  return input instanceof HTMLInputElement
    && !input.disabled
    && !input.readOnly
    && input.classList.contains('shift-oil-input')
    && input.dataset.field === 'remaining'
    && Boolean(input.closest('#shift-oil-table-body tr[data-oil-id]'));
}

function setOilRemainingEmptyMeansZero(input, enabled) {
  if (!isShiftOilRemainingInput(input)) return;

  if (enabled) {
    input.dataset.emptyMeansZero = 'true';
  } else {
    delete input.dataset.emptyMeansZero;
  }
}

function activateOilRemainingEmptyMeansZero(input) {
  if (!isShiftOilRemainingInput(input)) return;

  const wasEmpty = String(input.value ?? '').trim() === '';
  setOilRemainingEmptyMeansZero(input, true);
  const oilId = input.closest('tr[data-oil-id]')?.getAttribute('data-oil-id');
  if (oilId) {
    calculateOilRow(oilId);
  }
  if (wasEmpty) {
    markShiftDraftDirty();
  }
}

function parseShiftJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function renderSavedShiftOilRows(oilData = {}) {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) return;

  const entries = Object.entries(oilData || {});
  tableBody.innerHTML = '';

  if (entries.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="13" style="text-align: center; padding: 2rem; color: #999;">
          لا توجد بيانات زيوت محفوظة لهذه الوردية
        </td>
      </tr>
    `;
    return;
  }

  entries.forEach(([oilKey, data], index) => {
    const oilId = `saved-${index}`;
    const oilName = getShiftOilEntryName(oilKey, data);
    const oilCode = getShiftOilEntryCode(oilKey, data);
    const oilNameHtml = escapeHtml(oilName);
    const oilCodeAttr = escapeHtml(oilCode);
    const row = document.createElement('tr');
    row.setAttribute('data-oil-id', oilId);
    row.setAttribute('data-oil-code', oilCode);
    row.setAttribute('data-oil-name', oilName);
    row.innerHTML = `
      <td class="oil-name-cell">
        <div class="oil-cell-center oil-name-content">
          <strong>${oilNameHtml}</strong>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control shift-oil-input"
                 id="oil-${oilId}-initial" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="initial" readonly>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control shift-oil-input"
                 id="oil-${oilId}-added" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="added">
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control auto-calculated"
                 id="oil-${oilId}-total" readonly>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control auto-calculated"
                 id="oil-${oilId}-sold" readonly>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control shift-oil-input"
                 id="oil-${oilId}-remaining" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="remaining">
        </div>
      </td>
      <td class="spacer-cell"></td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control shift-oil-input"
                 id="oil-${oilId}-open" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="open">
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control shift-oil-input"
                 id="oil-${oilId}-customers" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="customers">
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control auto-calculated"
                 id="oil-${oilId}-price" readonly>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="number" step="0.01" class="form-control auto-calculated"
                 id="oil-${oilId}-revenue" readonly>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <select class="oil-customer-name-select" id="oil-${oilId}-customer-name"
                  data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="customer_name"
                  onchange="handleOilCustomerAssignmentInput('${oilId}')"></select>
        </div>
      </td>
      <td>
        <div class="oil-cell-center">
          <input type="checkbox" class="oil-voucher-checkbox" id="oil-${oilId}-voucher"
                 data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="voucher"
                 onchange="handleOilCustomerAssignmentInput('${oilId}')">
        </div>
      </td>
    `;
    tableBody.appendChild(row);
    populateCustomerNameSelect(row.querySelector('select[data-field="customer_name"]'), data.customer_id || data.customer_name || '', data.customer_name || '');
    const voucherInput = row.querySelector('input[data-field="voucher"]');
    if (voucherInput) voucherInput.checked = Boolean(data.voucher);
  });
}

function getLegacyLocalOilOrder() {
  try {
    const rawOrder = localStorage.getItem('oils-order');
    if (!rawOrder) return [];
    const parsedOrder = JSON.parse(rawOrder);
    if (!Array.isArray(parsedOrder)) return [];
    return parsedOrder
      .map((oilName) => String(oilName || '').trim())
      .filter(Boolean);
  } catch (error) {
    console.error('Error parsing legacy local oil order:', error);
    return [];
  }
}

function sortOilsByOrder(oils, order) {
  if (!Array.isArray(order) || order.length === 0) return oils;
  const orderMap = new Map(order.map((oilName, index) => [oilName, index]));
  return [...oils].sort((a, b) => {
    const indexA = orderMap.has(a.oil_type) ? orderMap.get(a.oil_type) : Number.POSITIVE_INFINITY;
    const indexB = orderMap.has(b.oil_type) ? orderMap.get(b.oil_type) : Number.POSITIVE_INFINITY;
    if (indexA !== indexB) return indexA - indexB;
    const orderA = Number.isFinite(Number(a.display_order)) ? Number(a.display_order) : Number.POSITIVE_INFINITY;
    const orderB = Number.isFinite(Number(b.display_order)) ? Number(b.display_order) : Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.oil_type || '').localeCompare(String(b.oil_type || ''));
  });
}

function getOilProductCode(oil) {
  return String(oil?.product_code || '').trim();
}

function getOilDomId(oil) {
  const code = getOilProductCode(oil);
  const fallback = oil?.id || oil?.oil_type || `oil-${Math.random().toString(36).slice(2, 8)}`;
  return String(code || fallback).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getShiftOilEntryName(entryKey, data = {}) {
  return String(data?.product_name || data?.oil_type || entryKey || '').trim();
}

function getShiftOilEntryCode(entryKey, data = {}) {
  return String(data?.product_code || entryKey || '').trim();
}

async function migrateLegacyLocalOilOrderIfNeeded() {
  const legacyOrder = getLegacyLocalOilOrder();
  if (legacyOrder.length === 0) return [];

  try {
    const result = await ipcRenderer.invoke('save-oils-order', legacyOrder);
    if (!result?.success) {
      throw new Error(result?.error || 'save_failed');
    }
    localStorage.removeItem('oils-order');
    return legacyOrder;
  } catch (error) {
    console.error('Error migrating legacy local oil order:', error);
    showToast?.('تعذر استعادة ترتيب الزيوت السابق', 'error');
    return legacyOrder;
  }
}

// Load active oils and populate oil table
async function loadActiveOils() {
  try {
    const oils = await ipcRenderer.invoke('get-oil-prices');
    const migratedOrder = await migrateLegacyLocalOilOrderIfNeeded();

    // Filter only active oils
    let activeOils = oils.filter(oil => oil.is_active === 1 || oil.is_active === true);
    activeOils = sortOilsByOrder(activeOils, migratedOrder);

    const tableBody = document.getElementById('shift-oil-table-body');
    if (!tableBody) return;

    if (activeOils.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="13" style="text-align: center; padding: 2rem; color: #999;">
            لا توجد زيوت نشطة
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = '';

    activeOils.forEach(oil => {
      const oilId = getOilDomId(oil);
      const oilCode = getOilProductCode(oil);
      const oilName = String(oil.oil_type || '').trim();
      const oilCodeAttr = escapeHtml(oilCode);
      const oilNameHtml = escapeHtml(oilName);
      const row = document.createElement('tr');
      row.setAttribute('data-oil-id', oilId);
      row.setAttribute('data-oil-code', oilCode);
      row.setAttribute('data-oil-name', oilName);
      row.setAttribute('draggable', 'true');
      row.classList.add('draggable-oil-row');
      row.innerHTML = `
        <td class="oil-name-cell">
          <div class="oil-cell-center oil-name-content">
            <span class="drag-handle" title="اسحب لإعادة الترتيب">⋮⋮</span>
            <strong>${oilNameHtml}</strong>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control shift-oil-input"
                   id="oil-${oilId}-initial" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="initial"
                   oninput="calculateOilRow('${oilId}')" readonly>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control shift-oil-input"
                   id="oil-${oilId}-added" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="added"
                   oninput="calculateOilRow('${oilId}')">
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control auto-calculated"
                   id="oil-${oilId}-total" readonly>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control auto-calculated"
                   id="oil-${oilId}-sold" readonly>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control shift-oil-input"
                   id="oil-${oilId}-remaining" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="remaining"
                   oninput="calculateOilRow('${oilId}')">
          </div>
        </td>
        <td class="spacer-cell"></td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control shift-oil-input"
                   id="oil-${oilId}-open" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="open"
                   oninput="calculateOilRow('${oilId}')">
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control shift-oil-input"
                   id="oil-${oilId}-customers" data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="customers"
                   oninput="calculateOilRow('${oilId}')">
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control auto-calculated"
                   id="oil-${oilId}-price" readonly>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="number" step="0.01" class="form-control auto-calculated"
                   id="oil-${oilId}-revenue" readonly>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <select class="oil-customer-name-select" id="oil-${oilId}-customer-name"
                    data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="customer_name"
                    onchange="handleOilCustomerAssignmentInput('${oilId}')"></select>
          </div>
        </td>
        <td>
          <div class="oil-cell-center">
            <input type="checkbox" class="oil-voucher-checkbox" id="oil-${oilId}-voucher"
                   data-oil="${oilNameHtml}" data-oil-code="${oilCodeAttr}" data-field="voucher"
                   onchange="handleOilCustomerAssignmentInput('${oilId}')">
          </div>
        </td>
      `;
      tableBody.appendChild(row);
      populateCustomerNameSelect(row.querySelector('select[data-field="customer_name"]'));
    });

    // Enable drag and drop
    enableOilRowDragDrop();

    // Initialize prices for all oils
    await loadAllOilPrices();
  } catch (error) {
    console.error('Error loading active oils:', error?.stack || error);
    const tableBody = document.getElementById('shift-oil-table-body');
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="13" style="text-align: center; padding: 2rem; color: #c4291d;">
            تعذر تحميل الزيوت النشطة
          </td>
        </tr>
      `;
    }
    showMessage('تعذر تحميل الزيوت النشطة', 'error');
    return false;
  }

  return true;
}

// Enable drag and drop for oil rows
function enableOilRowDragDrop() {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) return;

  let draggedRow = null;

  const rows = tableBody.querySelectorAll('.draggable-oil-row');
  rows.forEach(row => {
    row.addEventListener('dragstart', function(e) {
      draggedRow = this;
      this.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', function(e) {
      this.style.opacity = '1';
      draggedRow = null;
      saveOilsOrder();
    });

    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (draggedRow && draggedRow !== this) {
        const rect = this.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (e.clientY < midpoint) {
          tableBody.insertBefore(draggedRow, this);
        } else {
          tableBody.insertBefore(draggedRow, this.nextSibling);
        }
      }
    });
  });
}

// Save oils order to the shared database so every PC uses the same order.
async function saveOilsOrder() {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) return;

  const rows = tableBody.querySelectorAll('.draggable-oil-row');
  const order = Array.from(rows).map(row => row.getAttribute('data-oil-name'));

  try {
    const result = await ipcRenderer.invoke('save-oils-order', order);
    if (!result?.success) {
      throw new Error(result?.error || 'save_failed');
    }
  } catch (error) {
    console.error('Error saving shared oil order:', error);
    showToast?.('تعذر حفظ ترتيب الزيوت', 'error');
  }
}

// Calculate oil row totals and remaining
async function calculateOilRow(oilId) {
  const initialInput = document.getElementById(`oil-${oilId}-initial`);
  const addedInput = document.getElementById(`oil-${oilId}-added`);
  const totalInput = document.getElementById(`oil-${oilId}-total`);
  const soldInput = document.getElementById(`oil-${oilId}-sold`);
  const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
  const openInput = document.getElementById(`oil-${oilId}-open`);
  const customersInput = document.getElementById(`oil-${oilId}-customers`);
  const priceInput = document.getElementById(`oil-${oilId}-price`);
  const revenueInput = document.getElementById(`oil-${oilId}-revenue`);

  if (!initialInput || !addedInput || !totalInput || !soldInput || !remainingInput) {
    console.log('calculateOilRow: Missing inputs for oil', oilId);
    return;
  }

  const initial = parseOilQuantity(initialInput.value);
  const added = parseOilQuantity(addedInput.value);
  const remainingRaw = String(remainingInput.value ?? '').trim();
  const remainingParsed = parseFloat(String(remainingRaw).replace(',', '.'));
  const remaining = Number.isFinite(remainingParsed) ? remainingParsed : 0;
  const emptyRemainingMeansZero = remainingRaw === '' && remainingInput.dataset.emptyMeansZero === 'true';
  const open = parseOilQuantity(openInput?.value);
  const customers = parseOilQuantity(customersInput?.value);

  // Calculate total = initial + added
  const total = roundOilQuantity(initial + added);
  totalInput.value = total;

  if (remainingRaw === '' && !emptyRemainingMeansZero) {
    remainingInput.classList.remove('input-error');
    soldInput.value = '';
    if (revenueInput) {
      revenueInput.value = '';
    }
    calculateOilTotal();
    return;
  }

  // Validation: remaining must be <= total
  if (remaining > total && remaining > 0) {
    remainingInput.classList.add('input-error');
    soldInput.value = '';
    if (revenueInput) {
      revenueInput.value = '';
    }
    calculateOilTotal();
    return;
  } else {
    remainingInput.classList.remove('input-error');
  }

  // Calculate sold = total - remaining
  const sold = roundOilQuantity(total - remaining);
  soldInput.value = sold >= 0 ? sold : '';

  // Get oil price based on shift date
  if (priceInput) {
    const oilName = initialInput.getAttribute('data-oil');
    const dateInput = document.getElementById('shift-date');
    const shiftDate = dateInput ? dateInput.value : getTodayDate();

    try {
      const price = await getOilPriceByDate(oilName, shiftDate);
      priceInput.value = formatPrice(price);

      // Calculate revenue: (sold - customers - open) * price
      const revenueQuantity = roundOilQuantity(sold - customers - open);
      const revenue = revenueQuantity * price;
      if (revenueInput) {
        revenueInput.value = revenue >= 0 ? formatOilCashTotalDisplay(revenue) : '';
      }
    } catch (error) {
      console.error('Error getting oil price:', error);
      priceInput.value = '0';
      if (revenueInput) revenueInput.value = '';
    }
  }

  // Recalculate oil total
  calculateOilTotal();
}

function handleOilCustomerAssignmentInput(_oilId) {
  markShiftDraftDirty();
}

// Get oil price by date
async function getOilPriceByDate(oilName, date) {
  const cachedPrice = getCachedOilPrice(oilName, date);
  if (cachedPrice !== null) {
    return cachedPrice;
  }

  try {
    const price = await ipcRenderer.invoke('get-price-by-date', {
      product_name: oilName,
      date
    });
    const numericPrice = parseFloat(price) || 0;
    cacheOilPrice(oilName, date, numericPrice);
    return numericPrice;
  } catch (error) {
    console.error('Error fetching oil price:', error);
    return 0;
  }
}

// Format number: show decimals only if needed (e.g., 100 instead of 100.00, but 100.50 when needed)
function formatPrice(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return '0';
  // If the number is a whole number, don't show decimals
  return num % 1 === 0 ? num.toString() : num.toFixed(2);
}

function formatOilCashTotalDisplay(value) {
  const num = parseFloat(value);
  if (!Number.isFinite(num) || Math.abs(num) < 0.0001) {
    return '';
  }
  return formatPrice(num);
}

// Load oil prices for all oils in the table
async function loadAllOilPrices() {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) {
    return;
  }

  const dateInput = document.getElementById('shift-date');
  const shiftDate = normalizeShiftDate(dateInput ? dateInput.value : getTodayDate());

  try {
    const rows = tableBody.querySelectorAll('tr[data-oil-id]');

    try {
      const batchPrices = await ipcRenderer.invoke('get-oil-prices-by-date', { date: shiftDate });
      if (Array.isArray(batchPrices)) {
        cacheOilPricesBatch(shiftDate, batchPrices);
      }
    } catch (batchError) {
      console.warn('loadAllOilPrices: Batch loading failed, using per-row fallback:', batchError);
    }

    for (const row of rows) {
      const oilId = row.getAttribute('data-oil-id');
      const oilName = row.getAttribute('data-oil-name');
      const priceInput = document.getElementById(`oil-${oilId}-price`);
      const soldInput = document.getElementById(`oil-${oilId}-sold`);
      const openInput = document.getElementById(`oil-${oilId}-open`);
      const customersInput = document.getElementById(`oil-${oilId}-customers`);
      const revenueInput = document.getElementById(`oil-${oilId}-revenue`);

      if (priceInput && oilName) {
        const price = await getOilPriceByDate(oilName, shiftDate);
        priceInput.value = formatPrice(price);

        if (revenueInput) {
          const sold = parseOilQuantity(soldInput?.value);
          const open = parseOilQuantity(openInput?.value);
          const customers = parseOilQuantity(customersInput?.value);
          const revenueQuantity = roundOilQuantity(sold - customers - open);
          const revenue = revenueQuantity * price;
          revenueInput.value = revenue >= 0 ? formatOilCashTotalDisplay(revenue) : '';
        }
      }
    }

    calculateOilTotal();
  } catch (error) {
    console.error('loadAllOilPrices: Error fetching oils:', error);
  }
}

// Calculate total oil revenue
function calculateOilTotal() {
  let total = 0;

  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) return total;

  const rows = tableBody.querySelectorAll('tr[data-oil-id]');
  rows.forEach(row => {
    const oilId = row.getAttribute('data-oil-id');
    const revenueInput = document.getElementById(`oil-${oilId}-revenue`);
    if (revenueInput) {
      const revenue = parseFloat(revenueInput.value) || 0;
      total += revenue;
    }
  });

  // Update totals page if needed
  updateTotalsPage();

  return total;
}

// ============= CUSTOMERS TABLE FUNCTIONS =============

// Load customer names for the dropdown used in the shift customers table
async function loadCustomerNameOptions() {
  try {
    const customers = await ipcRenderer.invoke('get-customers');
    updateCustomerNameOptions(customers);
  } catch (error) {
    console.error('Error loading customer names:', error);
  }
}

// Update dropdown options for customer names
function updateCustomerNameOptions(customers = []) {
  const seen = new Set();
  customerNameOptionsCache = [];
  customerNameOptionsById = new Map();
  customerNameOptionsByName = new Map();
  customers.forEach(customer => {
    const id = parseInt(customer?.id, 10);
    const name = (customer?.name || '').trim();
    if (Number.isFinite(id) && id > 0 && name && !seen.has(id)) {
      seen.add(name);
      seen.add(id);
      const option = { id, name };
      customerNameOptionsCache.push(option);
      customerNameOptionsById.set(String(id), option);
      if (!customerNameOptionsByName.has(name)) {
        customerNameOptionsByName.set(name, option);
      }
    }
  });

  document.querySelectorAll('.customer-name-select, .oil-customer-name-select, .shift-customer-payment-name').forEach((select) => {
    populateCustomerNameSelect(select, select.value, select.selectedOptions?.[0]?.dataset?.customerName || '');
  });
}

function getCustomerOptionById(value) {
  return customerNameOptionsById.get(String(value || '').trim()) || null;
}

function getCustomerOptionByName(value) {
  return customerNameOptionsByName.get(String(value || '').trim()) || null;
}

function getCustomerOptionFromSelect(select) {
  if (!select) return null;
  const selectedValue = String(select.value || '').trim();
  const optionById = getCustomerOptionById(selectedValue);
  if (optionById) return optionById;

  const selectedName = String(select.selectedOptions?.[0]?.dataset?.customerName || select.selectedOptions?.[0]?.textContent || '').trim();
  return getCustomerOptionByName(selectedName) || (selectedName ? { id: null, name: selectedName } : null);
}

function populateCustomerNameSelect(select, selectedValue = '', selectedName = '') {
  if (!select) return;

  const rawValue = String(selectedValue || '').trim();
  const rawName = String(selectedName || '').trim();
  const selectedOption = getCustomerOptionById(rawValue) || getCustomerOptionByName(rawValue) || getCustomerOptionByName(rawName);
  const currentValue = selectedOption?.id ? String(selectedOption.id) : rawValue;
  const currentName = selectedOption?.name || rawName || rawValue;
  select.innerHTML = '';

  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = '';
  select.appendChild(emptyOption);

  const options = [...customerNameOptionsCache];
  if (currentValue && !getCustomerOptionById(currentValue)) {
    options.unshift({ id: currentValue, name: currentName });
  }

  options.forEach((customer) => {
    const option = document.createElement('option');
    option.value = String(customer.id);
    option.textContent = customer.name;
    option.dataset.customerName = customer.name;
    select.appendChild(option);
  });

  select.value = currentValue;
}

// Initialize customers table with 16 rows
function initializeCustomersTable() {
  const tableBody = document.getElementById('customers-table-body');
  if (!tableBody) return;

  // Clear existing rows
  tableBody.innerHTML = '';

  // Add 16 initial rows
  for (let i = 0; i < 16; i++) {
    addCustomerRow(i);
  }
}

// Add a single customer row
function addCustomerRow(index) {
  const tableBody = document.getElementById('customers-table-body');
  if (!tableBody) return;

  const row = document.createElement('tr');
  row.setAttribute('data-customer-row', index);
  row.innerHTML = `
    <td><input type="number" step="0.01" class="customer-fuel-input" data-row="${index}" data-field="diesel" oninput="handleCustomerInput(${index})"></td>
    <td><input type="number" step="0.01" class="customer-fuel-input" data-row="${index}" data-field="80" oninput="handleCustomerInput(${index})"></td>
    <td><input type="number" step="0.01" class="customer-fuel-input" data-row="${index}" data-field="92" oninput="handleCustomerInput(${index})"></td>
    <td><input type="number" step="0.01" class="customer-fuel-input" data-row="${index}" data-field="95" oninput="handleCustomerInput(${index})"></td>
    <td><select class="customer-name-select" data-row="${index}" data-field="name" onchange="handleCustomerInput(${index})"></select></td>
    <td><input type="checkbox" class="customer-voucher-checkbox" data-row="${index}" data-field="voucher" onchange="handleCustomerInput(${index})"></td>
  `;

  tableBody.appendChild(row);
  populateCustomerNameSelect(row.querySelector('select[data-field="name"]'));
}

function normalizeCustomerRowsData(items) {
  const toVoucherBoolean = (value) => {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }
    return false;
  };

  let normalizedItems = items;
  if (typeof normalizedItems === 'string') {
    try {
      normalizedItems = JSON.parse(normalizedItems);
    } catch (_error) {
      return [];
    }
  }

  if (!Array.isArray(normalizedItems)) return [];

  return normalizedItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const diesel = parseFloat(item.diesel) || 0;
      const fuel80 = parseFloat(item['80']) || 0;
      const fuel92 = parseFloat(item['92']) || 0;
      const fuel95 = parseFloat(item['95']) || 0;
      const customerId = parseInt(item.customer_id, 10);
      const name = String(item.name || item.customer_name || '').trim();
      const voucher = toVoucherBoolean(item.voucher);

      if (diesel === 0 && fuel80 === 0 && fuel92 === 0 && fuel95 === 0 && !name && !(Number.isFinite(customerId) && customerId > 0) && !voucher) {
        return null;
      }

      return {
        diesel,
        '80': fuel80,
        '92': fuel92,
        '95': fuel95,
        customer_id: Number.isFinite(customerId) && customerId > 0 ? customerId : null,
        name,
        voucher
      };
    })
    .filter(Boolean);
}

function collectCustomerRowsData() {
  const tableBody = document.getElementById('customers-table-body');
  if (!tableBody) return [];

  const rows = Array.from(tableBody.querySelectorAll('tr[data-customer-row]'));
  const rawRows = rows.map((row) => {
    const getInputValue = (selector) => row.querySelector(selector)?.value || '';
    const getCheckboxValue = (selector) => Boolean(row.querySelector(selector)?.checked);
    const customerSelect = row.querySelector('select[data-field="name"]');
    const customerOption = getCustomerOptionFromSelect(customerSelect);

    return {
      diesel: parseFloat(getInputValue('input[data-field="diesel"]')) || 0,
      '80': parseFloat(getInputValue('input[data-field="80"]')) || 0,
      '92': parseFloat(getInputValue('input[data-field="92"]')) || 0,
      '95': parseFloat(getInputValue('input[data-field="95"]')) || 0,
      customer_id: customerOption?.id || null,
      name: String(customerOption?.name || '').trim(),
      voucher: getCheckboxValue('input[data-field="voucher"]')
    };
  });

  return normalizeCustomerRowsData(rawRows);
}

function setCustomerRowsData(rowsData = []) {
  const tableBody = document.getElementById('customers-table-body');
  if (!tableBody) return;

  const normalizedRows = normalizeCustomerRowsData(rowsData);
  const rowsCount = Math.max(16, normalizedRows.length + 1);

  tableBody.innerHTML = '';
  for (let i = 0; i < rowsCount; i += 1) {
    addCustomerRow(i);
  }

  normalizedRows.forEach((item, index) => {
    const row = tableBody.querySelector(`tr[data-customer-row="${index}"]`);
    if (!row) return;

    const dieselInput = row.querySelector('input[data-field="diesel"]');
    const fuel80Input = row.querySelector('input[data-field="80"]');
    const fuel92Input = row.querySelector('input[data-field="92"]');
    const fuel95Input = row.querySelector('input[data-field="95"]');
    const nameInput = row.querySelector('select[data-field="name"]');
    const voucherInput = row.querySelector('input[data-field="voucher"]');

    if (dieselInput) dieselInput.value = item.diesel || '';
    if (fuel80Input) fuel80Input.value = item['80'] || '';
    if (fuel92Input) fuel92Input.value = item['92'] || '';
    if (fuel95Input) fuel95Input.value = item['95'] || '';
    if (nameInput) populateCustomerNameSelect(nameInput, item.customer_id || item.name || '', item.name || '');
    if (voucherInput) voucherInput.checked = Boolean(item.voucher);
  });

  updateCustomerColumnSums();
}

// Calculate sum of customer table columns and update fuel client fields
function updateCustomerColumnSums() {
  const tableBody = document.getElementById('customers-table-body');
  if (!tableBody) return;

  // Initialize sums for each fuel type
  const sums = {
    diesel: 0,
    '80': 0,
    '92': 0,
    '95': 0
  };

  // Get all customer fuel inputs
  const inputs = tableBody.querySelectorAll('.customer-fuel-input');

  inputs.forEach(input => {
    const field = input.getAttribute('data-field');
    const value = parseFloat(input.value) || 0;

    if (sums.hasOwnProperty(field)) {
      sums[field] += value;
    }
  });

  // Helper function to format number (show decimals only if necessary)
  const formatNumber = (num) => {
    return Number.isInteger(num) ? num.toString() : num.toFixed(2);
  };

  // Update the corresponding fuel client fields
  const dieselClientsInput = document.getElementById('fuel-diesel-clients');
  const fuel80ClientsInput = document.getElementById('fuel-80-clients');
  const fuel92ClientsInput = document.getElementById('fuel-92-clients');
  const fuel95ClientsInput = document.getElementById('fuel-95-clients');

  if (dieselClientsInput) {
    dieselClientsInput.value = formatNumber(sums.diesel);
    // Trigger calculation for diesel cash
    calculateCashForFuel('diesel');
  }

  if (fuel80ClientsInput) {
    fuel80ClientsInput.value = formatNumber(sums['80']);
    // Trigger calculation for 80 cash
    calculateCashForFuel('80');
  }

  if (fuel92ClientsInput) {
    fuel92ClientsInput.value = formatNumber(sums['92']);
    // Trigger calculation for 92 cash
    calculateCashForFuel('92');
  }

  if (fuel95ClientsInput) {
    fuel95ClientsInput.value = formatNumber(sums['95']);
    // Trigger calculation for 95 cash
    calculateCashForFuel('95');
  }
}

// Handle input in customer rows and add new row if needed
function handleCustomerInput(rowIndex) {
  const tableBody = document.getElementById('customers-table-body');
  if (!tableBody) return;

  const allRows = tableBody.querySelectorAll('tr[data-customer-row]');
  const lastRow = allRows[allRows.length - 1];
  const lastRowIndex = parseInt(lastRow.getAttribute('data-customer-row'));

  // Check if input is in the last row
  if (rowIndex === lastRowIndex) {
    // Check if any field in the last row has a value
    const inputs = lastRow.querySelectorAll('input[type="number"], select[data-field="name"]');
    const hasValue = Array.from(inputs).some(input => input.value.trim() !== '');

    if (hasValue) {
      // Add a new row
      addCustomerRow(lastRowIndex + 1);
    }
  }

  // Update customer column sums
  updateCustomerColumnSums();

  // Mark as unsaved
  if (typeof currentShiftData !== 'undefined') {
    currentShiftData.hasUnsavedChanges = true;
    setShiftDraftStatus('dirty');
    scheduleShiftDraftAutoSave();
  }
}

// ============= CUSTOMERS MANAGEMENT FUNCTIONS =============

// Load and display customers in settings
async function loadCustomersSettings() {
  try {
    const customers = await ipcRenderer.invoke('get-customers');
    updateCustomerNameOptions(customers);
    const tableBody = document.getElementById('manage-customers-table-body');

    if (!tableBody) return;

    tableBody.innerHTML = '';

    if (customers.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem; color: #999;">لا يوجد عملاء</td></tr>';
      return;
    }

    customers.forEach((customer, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="text-align: center;">${index + 1}</td>
        <td>${customer.name}</td>
        <td style="text-align: center;">
          <button class="btn-icon" title="تعديل العميل" onclick="editCustomer(${customer.id}, '${customer.name.replace(/'/g, "\\'")}')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
            </svg>
          </button>
          <button class="btn-icon btn-icon-danger" title="حذف العميل" style="margin-left: 0.5rem;" onclick="deleteCustomer(${customer.id}, '${customer.name.replace(/'/g, "\\'")}')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
          </button>
        </td>
      `;
      const actionButtons = row.querySelectorAll('.btn-icon');
      if (actionButtons[0]) {
        actionButtons[0].title = 'تعديل الاسم';
        actionButtons[0].innerHTML = getActionEditIconSvg();
      }
      if (actionButtons[1]) {
        actionButtons[1].innerHTML = getActionDeleteIconSvg();
      }
      tableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading customers:', error);
    showMessage('خطأ في تحميل العملاء', 'error');
  }
}

// Add new customer
function addNewCustomer() {
  const modal = document.getElementById('add-customer-modal');
  const input = document.getElementById('customer-name-input');

  if (modal && input) {
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 100);
  }
}

// Close add customer modal
function closeAddCustomerModal() {
  const modal = document.getElementById('add-customer-modal');
  if (modal) {
    modal.style.display = 'none';
    const input = document.getElementById('customer-name-input');
    if (input) {
      input.value = '';
    }
  }
}

// Save new customer
async function saveNewCustomer() {
  const input = document.getElementById('customer-name-input');
  const name = input ? input.value.trim() : '';

  if (!name) {
    showMessage('الرجاء إدخال اسم العميل', 'error');
    return;
  }

  try {
    // Save customer
    const result = await ipcRenderer.invoke('add-customer', { name });
    console.log('Customer added successfully, ID:', result);

    // Close modal
    closeAddCustomerModal();

    // Reload customers list
    await loadCustomersSettings();

    // Show success message
    showMessage('تم إضافة العميل بنجاح', 'success');
  } catch (error) {
    console.error('Error adding customer:', error);
    showMessage(error.message || 'خطأ في إضافة العميل', 'error');
  }
}

// Delete customer
async function deleteCustomer(id, name) {
  if (!confirm(`هل أنت متأكد من حذف العميل "${name}"؟`)) {
    return;
  }

  try {
    await ipcRenderer.invoke('delete-customer', { id });
    await loadCustomersSettings();
    showMessage('تم حذف العميل بنجاح', 'success');
  } catch (error) {
    console.error('Error deleting customer:', error);
    showMessage('خطأ في حذف العميل', 'error');
  }
}

// Edit customer
function editCustomer(id, currentName) {
  const newName = prompt('تعديل اسم العميل:', currentName);

  if (newName === null) {
    // User cancelled
    return;
  }

  if (!newName || !newName.trim()) {
    showMessage('الرجاء إدخال اسم صحيح', 'error');
    return;
  }

  updateCustomerName(id, newName.trim());
}

// Update customer name
async function updateCustomerName(id, newName) {
  try {
    await ipcRenderer.invoke('update-customer', { id, name: newName });
    await loadCustomersSettings();
    showMessage('تم تحديث اسم العميل بنجاح', 'success');
  } catch (error) {
    console.error('Error updating customer:', error);
    showMessage(error.message || 'خطأ في تحديث اسم العميل', 'error');
  }
}

// Calculate grand total
function calculateGrandTotal() {
  // Simply call calculateTotalRevenue which does the proper calculation
  calculateTotalRevenue();
  return parseFloat(document.getElementById('final-net-total')?.value) || 0;
}

// ============= TOTALS PAGE FUNCTIONS =============

function sanitizeSummaryNumericInput(input) {
  if (!(input instanceof HTMLInputElement)) return;
  if (!input.classList.contains('summary-numeric-input')) return;

  let value = String(input.value || '').replace(/,/g, '.');
  value = value.replace(/[^\d.]/g, '');

  const firstDotIndex = value.indexOf('.');
  if (firstDotIndex !== -1) {
    value = value.slice(0, firstDotIndex + 1) + value.slice(firstDotIndex + 1).replace(/\./g, '');
  }

  input.value = value;
}

function parseSummaryNumber(value) {
  const amount = parseFloat(String(value || '').replace(/,/g, '.'));
  return Number.isFinite(amount) ? amount : 0;
}

function getSummaryRowItems(containerId, descSelector, amountSelector) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  return Array.from(container.querySelectorAll('.summary-dynamic-row'))
    .map((row, fallbackIndex) => {
      const description = String(row.querySelector(descSelector)?.value || '').trim();
      const amount = parseSummaryNumber(row.querySelector(amountSelector)?.value);
      if (!Number.isFinite(amount) || amount <= 0) return null;

      const index = parseInt(row.getAttribute('data-index'), 10);
      return {
        index: Number.isFinite(index) && index > 0 ? index : fallbackIndex + 1,
        description,
        amount
      };
    })
    .filter(Boolean);
}

function normalizeRevenueItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, fallbackIndex) => {
      if (!item || typeof item !== 'object') return null;
      const amount = parseFloat(item.amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
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

function normalizeCustomerPayments(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, fallbackIndex) => {
      if (!item || typeof item !== 'object') return null;
      const amount = parseFloat(item.amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const customerId = parseInt(item.customer_id, 10);
      const customerName = String(item.customer_name || item.name || '').trim();
      if (!customerName && !(Number.isFinite(customerId) && customerId > 0)) return null;
      const index = parseInt(item.index, 10);
      return {
        index: Number.isFinite(index) && index > 0 ? index : fallbackIndex + 1,
        customer_id: Number.isFinite(customerId) && customerId > 0 ? customerId : null,
        customer_name: customerName,
        amount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function createSummaryDynamicRow(type, index, item = {}) {
  const isRevenue = type === 'revenue';
  const row = document.createElement('div');
  row.className = `total-row summary-dynamic-row ${isRevenue ? 'summary-revenue-row' : 'summary-expense-row'}`;
  row.setAttribute('data-index', index);

  const descId = isRevenue ? `revenue-desc-${index}` : `expense-desc-${index}`;
  const amountId = isRevenue ? `revenue-amount-${index}` : `expense-amount-${index}`;
  const descClass = isRevenue
    ? 'total-description-input shift-revenue-desc'
    : 'total-description-input shift-expense-input shift-expense-desc';
  const amountClass = isRevenue
    ? 'total-input shift-revenue-amount'
    : 'total-input shift-expense-input shift-expense-amount';
  const placeholder = isRevenue ? 'وصف الإيراد' : 'وصف المصروف';
  const handler = isRevenue ? 'handleSummaryRevenueInput' : 'handleSummaryExpenseInput';

  row.innerHTML = `
    <input type="text" class="${descClass}" id="${descId}" placeholder="${placeholder}" value="${escapeHtml(item.description || '')}" oninput="${handler}(this)">
    <input type="text" inputmode="decimal" autocomplete="off" class="${amountClass} summary-numeric-input" id="${amountId}" value="${Number.isFinite(parseFloat(item.amount)) ? formatPrice(item.amount) : ''}" oninput="${handler}(this)">
  `;

  return row;
}

function createCustomerPaymentRow(index, item = {}) {
  const row = document.createElement('div');
  row.className = 'total-row summary-dynamic-row customer-payment-row';
  row.setAttribute('data-index', index);

  row.innerHTML = `
    <select class="shift-customer-payment-name" id="customer-payment-name-${index}" onchange="handleCustomerPaymentInput(this)"></select>
    <input type="text" inputmode="decimal" autocomplete="off" class="total-input shift-customer-payment-amount summary-numeric-input" id="customer-payment-amount-${index}" value="${Number.isFinite(parseFloat(item.amount)) ? formatPrice(item.amount) : ''}" oninput="handleCustomerPaymentInput(this)">
  `;

  populateCustomerNameSelect(row.querySelector('.shift-customer-payment-name'), item.customer_id || item.customer_name || item.name || '', item.customer_name || item.name || '');
  return row;
}

function renderRevenueItems(items = []) {
  const container = document.getElementById('shift-revenue-extra-rows');
  if (!container) return;

  const normalized = normalizeRevenueItems(items);
  container.innerHTML = '';
  summaryRevenueRowCounter = 0;

  normalized.forEach((item) => {
    const index = item.index || (summaryRevenueRowCounter + 1);
    summaryRevenueRowCounter = Math.max(summaryRevenueRowCounter, index);
    container.appendChild(createSummaryDynamicRow('revenue', index, item));
  });

  summaryRevenueRowCounter += 1;
  container.appendChild(createSummaryDynamicRow('revenue', summaryRevenueRowCounter));
}

function renderCustomerPayments(items = []) {
  const container = document.getElementById('shift-customer-payment-rows');
  if (!container) return;

  const normalized = normalizeCustomerPayments(items);
  container.innerHTML = '';
  customerPaymentRowCounter = 0;

  normalized.forEach((item) => {
    const index = item.index || (customerPaymentRowCounter + 1);
    customerPaymentRowCounter = Math.max(customerPaymentRowCounter, index);
    container.appendChild(createCustomerPaymentRow(index, item));
  });

  customerPaymentRowCounter += 1;
  container.appendChild(createCustomerPaymentRow(customerPaymentRowCounter));
}

function renderExpenseItems(items = []) {
  const container = document.getElementById('shift-expense-rows');
  if (!container) return;

  const normalized = normalizeExpenseItems(items);
  container.innerHTML = '';
  summaryExpenseRowCounter = 0;

  normalized.forEach((item) => {
    const index = item.index || (summaryExpenseRowCounter + 1);
    summaryExpenseRowCounter = Math.max(summaryExpenseRowCounter, index);
    container.appendChild(createSummaryDynamicRow('expense', index, item));
  });

  summaryExpenseRowCounter += 1;
  container.appendChild(createSummaryDynamicRow('expense', summaryExpenseRowCounter));
}

function ensureBlankSummaryRow(type) {
  const isRevenue = type === 'revenue';
  const container = document.getElementById(isRevenue ? 'shift-revenue-extra-rows' : 'shift-expense-rows');
  if (!container) return;

  const rows = Array.from(container.querySelectorAll('.summary-dynamic-row'));
  const hasBlank = rows.some((row) => {
    const descSelector = isRevenue ? '.shift-revenue-desc' : '.shift-expense-desc';
    const amountSelector = isRevenue ? '.shift-revenue-amount' : '.shift-expense-amount';
    const description = String(row.querySelector(descSelector)?.value || '').trim();
    const amount = String(row.querySelector(amountSelector)?.value || '').trim();
    return !description && !amount;
  });

  if (hasBlank) return;

  if (isRevenue) {
    summaryRevenueRowCounter += 1;
    container.appendChild(createSummaryDynamicRow('revenue', summaryRevenueRowCounter));
  } else {
    summaryExpenseRowCounter += 1;
    container.appendChild(createSummaryDynamicRow('expense', summaryExpenseRowCounter));
  }
}

function ensureBlankCustomerPaymentRow() {
  const container = document.getElementById('shift-customer-payment-rows');
  if (!container) return;

  const rows = Array.from(container.querySelectorAll('.customer-payment-row'));
  const hasBlank = rows.some((row) => {
    const customerName = String(row.querySelector('.shift-customer-payment-name')?.value || '').trim();
    const amountText = String(row.querySelector('.shift-customer-payment-amount')?.value || '').trim();
    return !customerName && !amountText;
  });

  if (hasBlank) return;

  customerPaymentRowCounter += 1;
  container.appendChild(createCustomerPaymentRow(customerPaymentRowCounter));
}

function handleSummaryFixedRevenueInput(input) {
  sanitizeSummaryNumericInput(input);
  calculateGrandTotal();
  markShiftDraftDirty();
}

function handleSummaryRevenueInput(input) {
  sanitizeSummaryNumericInput(input);
  ensureBlankSummaryRow('revenue');
  calculateGrandTotal();
  markShiftDraftDirty();
}

function handleSummaryExpenseInput(input) {
  sanitizeSummaryNumericInput(input);
  ensureBlankSummaryRow('expense');
  calculateTotalExpenses();
  markShiftDraftDirty();
}

function handleCustomerPaymentInput(input) {
  sanitizeSummaryNumericInput(input);
  ensureBlankCustomerPaymentRow();
  calculateGrandTotal();
  markShiftDraftDirty();
}

function initializeShiftSummaryRows() {
  renderRevenueItems([]);
  renderCustomerPayments([]);
  renderExpenseItems([]);
}

// Populate totals page with cash values from fuel and oil tabs
function updateTotalsPage() {
  // Populate individual fuel cash values
  const dieselCash = parseFloat(document.getElementById('fuel-diesel-cash')?.value) || 0;
  const cash80 = parseFloat(document.getElementById('fuel-80-cash')?.value) || 0;
  const cash92 = parseFloat(document.getElementById('fuel-92-cash')?.value) || 0;
  const cash95 = parseFloat(document.getElementById('fuel-95-cash')?.value) || 0;

  document.getElementById('total-diesel-cash').value = formatPrice(dieselCash);
  document.getElementById('total-80-cash').value = formatPrice(cash80);
  document.getElementById('total-92-cash').value = formatPrice(cash92);
  document.getElementById('total-95-cash').value = formatPrice(cash95);

  // Calculate oil total from oil tab
  let oilTotal = 0;
  const oilTableBody = document.getElementById('shift-oil-table-body');
  if (oilTableBody) {
    const rows = oilTableBody.querySelectorAll('tr[data-oil-id]');
    rows.forEach(row => {
      const oilId = row.getAttribute('data-oil-id');
      const revenueInput = document.getElementById(`oil-${oilId}-revenue`);
      if (revenueInput) {
        const revenue = parseFloat(revenueInput.value) || 0;
        oilTotal += revenue;
      }
    });
  }
  document.getElementById('total-oil-revenue').value = formatPrice(oilTotal);

  // Calculate total revenue (fuel + oil + extra revenues)
  calculateTotalRevenue();

  // Recalculate net total
  return calculateNetTotal();
}

// Calculate total revenue (fuel + oil + extra fields)
function calculateTotalRevenue() {
  // Calculate total fuel cash from individual fuel values
  const dieselCash = parseSummaryNumber(document.getElementById('total-diesel-cash')?.value);
  const cash80 = parseSummaryNumber(document.getElementById('total-80-cash')?.value);
  const cash92 = parseSummaryNumber(document.getElementById('total-92-cash')?.value);
  const cash95 = parseSummaryNumber(document.getElementById('total-95-cash')?.value);
  const totalFuelCash = dieselCash + cash80 + cash92 + cash95;

  const totalOilRevenue = parseSummaryNumber(document.getElementById('total-oil-revenue')?.value);
  const washLubeRevenue = parseSummaryNumber(document.getElementById('total-wash-lube-revenue')?.value);

  // Add extra revenue fields
  let extraRevenue = 0;
  collectRevenueItems().forEach((item) => {
    extraRevenue += item.amount;
  });

  let customerPaymentsRevenue = 0;
  collectCustomerPayments().forEach((item) => {
    customerPaymentsRevenue += item.amount;
  });

  const totalRevenue = totalFuelCash + totalOilRevenue + washLubeRevenue + extraRevenue + customerPaymentsRevenue;
  document.getElementById('total-revenue').value = formatPrice(totalRevenue);

  calculateNetTotal();
  return totalRevenue;
}

// Calculate total expenses
function calculateTotalExpenses() {
  let totalExpenses = 0;

  collectExpenseItems().forEach((item) => {
    totalExpenses += item.amount;
  });

  document.getElementById('total-expenses').value = formatPrice(totalExpenses);

  calculateNetTotal();
  return totalExpenses;
}

// Calculate net total (revenue - expenses)
function calculateNetTotal() {
  const totalRevenue = parseSummaryNumber(document.getElementById('total-revenue')?.value);
  const totalExpenses = parseSummaryNumber(document.getElementById('total-expenses')?.value);

  const netTotal = totalRevenue - totalExpenses;
  document.getElementById('final-net-total').value = formatPrice(netTotal);
  return netTotal;
}

// Collect fuel data from form
function collectFuelData() {
  const fuelData = {};

  Object.entries(fuelIdMap).forEach(([fuelType, fuelId]) => {
    const productCode = fuelProductCodesByName.get(fuelType) || null;
    const fuelKey = productCode || fuelType;
    if (fuelType === 'سولار') {
      // Diesel has 4 counters
      fuelData[fuelKey] = {
        product_code: productCode,
        product_name: fuelType,
        lastShift1: parseFloat(document.getElementById('fuel-diesel-last-1')?.value) || 0,
        firstShift1: parseFloat(document.getElementById('fuel-diesel-first-1')?.value) || 0,
        lastShift2: parseFloat(document.getElementById('fuel-diesel-last-2')?.value) || 0,
        firstShift2: parseFloat(document.getElementById('fuel-diesel-first-2')?.value) || 0,
        lastShift3: parseFloat(document.getElementById('fuel-diesel-last-3')?.value) || 0,
        firstShift3: parseFloat(document.getElementById('fuel-diesel-first-3')?.value) || 0,
        lastShift4: parseFloat(document.getElementById('fuel-diesel-last-4')?.value) || 0,
        firstShift4: parseFloat(document.getElementById('fuel-diesel-first-4')?.value) || 0,
        quantity1: parseFloat(document.getElementById('fuel-diesel-quantity-1')?.value) || 0,
        quantity2: parseFloat(document.getElementById('fuel-diesel-quantity-2')?.value) || 0,
        quantity3: parseFloat(document.getElementById('fuel-diesel-quantity-3')?.value) || 0,
        quantity4: parseFloat(document.getElementById('fuel-diesel-quantity-4')?.value) || 0,
        totalQuantity: parseFloat(document.getElementById('fuel-diesel-total-qty')?.value) || 0,
        clients: parseFloat(document.getElementById('fuel-diesel-clients')?.value) || 0,
        cars: parseFloat(document.getElementById('fuel-diesel-cars')?.value) || 0,
        price: parseFloat(document.getElementById('fuel-diesel-price')?.value) || 0,
        cash: parseFloat(document.getElementById('fuel-diesel-cash')?.value) || 0
      };
    } else {
      // Other fuels have 2 counters
      fuelData[fuelKey] = {
        product_code: productCode,
        product_name: fuelType,
        lastShift1: parseFloat(document.getElementById(`fuel-${fuelId}-last-1`)?.value) || 0,
        firstShift1: parseFloat(document.getElementById(`fuel-${fuelId}-first-1`)?.value) || 0,
        lastShift2: parseFloat(document.getElementById(`fuel-${fuelId}-last-2`)?.value) || 0,
        firstShift2: parseFloat(document.getElementById(`fuel-${fuelId}-first-2`)?.value) || 0,
        quantity1: parseFloat(document.getElementById(`fuel-${fuelId}-quantity-1`)?.value) || 0,
        quantity2: parseFloat(document.getElementById(`fuel-${fuelId}-quantity-2`)?.value) || 0,
        totalQuantity: parseFloat(document.getElementById(`fuel-${fuelId}-total-qty`)?.value) || 0,
        clients: parseFloat(document.getElementById(`fuel-${fuelId}-clients`)?.value) || 0,
        cars: parseFloat(document.getElementById(`fuel-${fuelId}-cars`)?.value) || 0,
        price: parseFloat(document.getElementById(`fuel-${fuelId}-price`)?.value) || 0,
        cash: parseFloat(document.getElementById(`fuel-${fuelId}-cash`)?.value) || 0
      };
    }
  });

  return fuelData;
}

// Collect oil data from form
function collectOilData() {
  const oilData = {};
  const tableBody = document.getElementById('shift-oil-table-body');

  if (!tableBody) return oilData;

  const rows = tableBody.querySelectorAll('tr[data-oil-id]');
  rows.forEach(row => {
    const oilId = row.getAttribute('data-oil-id');
    const oilName = row.getAttribute('data-oil-name') || row.querySelector('td strong')?.textContent;
    const oilCode = row.getAttribute('data-oil-code') || '';
    const oilKey = oilCode || oilName;

    if (!oilName) return;

    const initialInput = document.getElementById(`oil-${oilId}-initial`);
    const addedInput = document.getElementById(`oil-${oilId}-added`);
    const totalInput = document.getElementById(`oil-${oilId}-total`);
    const soldInput = document.getElementById(`oil-${oilId}-sold`);
    const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
    const openInput = document.getElementById(`oil-${oilId}-open`);
    const customersInput = document.getElementById(`oil-${oilId}-customers`);
    const priceInput = document.getElementById(`oil-${oilId}-price`);
    const revenueInput = document.getElementById(`oil-${oilId}-revenue`);
    const customerNameSelect = document.getElementById(`oil-${oilId}-customer-name`);
    const customerOption = getCustomerOptionFromSelect(customerNameSelect);
    const voucherInput = document.getElementById(`oil-${oilId}-voucher`);

    oilData[oilKey] = {
      product_code: oilCode || null,
      product_name: oilName,
      initial: parseOilQuantity(initialInput?.value),
      added: parseOilQuantity(addedInput?.value),
      total: parseOilQuantity(totalInput?.value),
      sold: parseOilQuantity(soldInput?.value),
      remaining: parseOilQuantity(remainingInput?.value),
      open: parseOilQuantity(openInput?.value),
      customers: parseOilQuantity(customersInput?.value),
      price: parseFloat(priceInput?.value) || 0,
      revenue: parseFloat(revenueInput?.value) || 0,
      customer_id: customerOption?.id || null,
      customer_name: String(customerOption?.name || '').trim(),
      voucher: Boolean(voucherInput?.checked)
    };
  });

  return oilData;
}

function collectExpenseItems() {
  return getSummaryRowItems('shift-expense-rows', '.shift-expense-desc', '.shift-expense-amount');
}

function collectRevenueItems() {
  return getSummaryRowItems('shift-revenue-extra-rows', '.shift-revenue-desc', '.shift-revenue-amount');
}

function collectCustomerPayments() {
  const container = document.getElementById('shift-customer-payment-rows');
  if (!container) return [];

  return Array.from(container.querySelectorAll('.customer-payment-row'))
    .map((row, fallbackIndex) => {
      const customerSelect = row.querySelector('.shift-customer-payment-name');
      const customerOption = getCustomerOptionFromSelect(customerSelect);
      const amount = parseSummaryNumber(row.querySelector('.shift-customer-payment-amount')?.value);
      if (!customerOption?.id || !Number.isFinite(amount) || amount <= 0) return null;
      const index = parseInt(row.getAttribute('data-index'), 10);
      return {
        index: Number.isFinite(index) && index > 0 ? index : fallbackIndex + 1,
        customer_id: customerOption.id,
        customer_name: String(customerOption.name || '').trim(),
        amount
      };
    })
    .filter(Boolean);
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

      const index = parseInt(item.index, 10);
      const amount = parseFloat(item.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return null;
      }

      return {
        index: Number.isFinite(index) && index > 0 ? index : fallbackIndex + 1,
        description: String(item.description || '').trim(),
        amount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function clearShiftExpenseInputs() {
  renderExpenseItems([]);

  const totalExpensesInput = document.getElementById('total-expenses');
  if (totalExpensesInput) {
    totalExpensesInput.value = '';
  }
}

function clearShiftRevenueInputs() {
  renderRevenueItems([]);
  renderCustomerPayments([]);

  const washLubeInput = document.getElementById('total-wash-lube-revenue');
  if (washLubeInput) {
    washLubeInput.value = '';
  }
}

// Validate shift data before saving
function validateShiftData() {
  const errors = [];

  // Validate date and shift number
  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');

  if (!dateInput?.value) {
    errors.push('يجب تحديد تاريخ الوردية');
  }

  if (!shiftNumberSelect?.value) {
    errors.push('يجب تحديد رقم الوردية');
  }

  // Validate fuel counters
  Object.entries(fuelIdMap).forEach(([fuelType, fuelId]) => {
    if (fuelType === 'سولار') {
      // Validate all 4 diesel counters
      for (let i = 1; i <= 4; i++) {
        const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
        const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);

        const lastShift = parseFloat(lastShiftInput?.value) || 0;
        const firstShift = parseFloat(firstShiftInput?.value) || 0;

        if (firstShift > 0 && lastShift < firstShift) {
          errors.push(`${fuelType} (${i}): آخر الوردية يجب أن يكون أكبر من أو يساوي أول الوردية`);
        }
      }
    } else {
      // Validate other fuels (2 counters)
      for (let i = 1; i <= 2; i++) {
        const lastShiftInput = document.getElementById(`fuel-${fuelId}-last-${i}`);
        const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);

        const lastShift = parseFloat(lastShiftInput?.value) || 0;
        const firstShift = parseFloat(firstShiftInput?.value) || 0;

        if (firstShift > 0 && lastShift < firstShift) {
          errors.push(`${fuelType} (${i}): آخر الوردية يجب أن يكون أكبر من أو يساوي أول الوردية`);
        }
      }
    }
  });

  const customerRowsTable = document.getElementById('customers-table-body');
  if (customerRowsTable) {
    Array.from(customerRowsTable.querySelectorAll('tr[data-customer-row]')).forEach((row, index) => {
      const quantity = ['diesel', '80', '92', '95'].reduce((sum, field) => (
        sum + (parseFloat(row.querySelector(`input[data-field="${field}"]`)?.value) || 0)
      ), 0);
      if (quantity <= 0) return;

      const voucherInput = row.querySelector('input[data-field="voucher"]');
      const customerSelect = row.querySelector('select[data-field="name"]');
      const customerOption = getCustomerOptionFromSelect(customerSelect);
      if (!voucherInput?.checked && !customerOption?.id) {
        errors.push(`جدول العملاء (${index + 1}): اختر العميل أو حدد بونات`);
      }
    });
  }

  // Validate oil quantities
  const tableBody = document.getElementById('shift-oil-table-body');
  if (tableBody) {
    const rows = tableBody.querySelectorAll('tr[data-oil-id]');
    rows.forEach(row => {
      const oilId = row.getAttribute('data-oil-id');
      const oilName = row.querySelector('td strong')?.textContent;

      const totalInput = document.getElementById(`oil-${oilId}-total`);
      const soldInput = document.getElementById(`oil-${oilId}-sold`);
      const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
      const customersInput = document.getElementById(`oil-${oilId}-customers`);
      const customerNameSelect = document.getElementById(`oil-${oilId}-customer-name`);
      const voucherInput = document.getElementById(`oil-${oilId}-voucher`);

      const total = parseOilQuantity(totalInput?.value);
      const sold = parseOilQuantity(soldInput?.value);
      const customerQuantity = parseOilQuantity(customersInput?.value);
      const remainingRaw = String(remainingInput?.value ?? '').trim();
      const remainingParsed = parseFloat(remainingRaw.replace(',', '.'));
      const remaining = Number.isFinite(remainingParsed) ? remainingParsed : 0;

      if (remainingRaw !== '' && remaining > total && remaining > 0) {
        errors.push(`${oilName}: الكمية المتبقية يجب أن تكون أقل من أو تساوي الإجمالي المتاح`);
      }

      if (sold > total && sold > 0) {
        errors.push(`${oilName}: الكمية المباعة يجب أن تكون أقل من أو تساوي الإجمالي المتاح`);
      }

      if (customerQuantity > 0 && !voucherInput?.checked && !getCustomerOptionFromSelect(customerNameSelect)?.id) {
        errors.push(`${oilName}: اختر العميل أو حدد بونات لكمية العملاء`);
      }
    });
  }

  document.querySelectorAll('#shift-customer-payment-rows .customer-payment-row').forEach((row, index) => {
    const amount = parseSummaryNumber(row.querySelector('.shift-customer-payment-amount')?.value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const customerOption = getCustomerOptionFromSelect(row.querySelector('.shift-customer-payment-name'));
    if (!customerOption?.id) {
      errors.push(`مدفوعات العملاء (${index + 1}): اختر العميل`);
    }
  });

  return errors;
}

function buildCurrentShiftPayload(date, shiftNumber, isSaved = 1) {
  return {
    date,
    shift_number: shiftNumber,
    fuel_data: JSON.stringify(collectFuelData()),
    fuel_total: calculateFuelTotal(),
    oil_data: JSON.stringify(collectOilData()),
    oil_total: calculateOilTotal(),
    customer_rows: collectCustomerRowsData(),
    revenue_items: collectRevenueItems(),
    customer_payments: collectCustomerPayments(),
    expense_items: collectExpenseItems(),
    wash_lube_revenue: parseSummaryNumber(document.getElementById('total-wash-lube-revenue')?.value),
    total_expenses: parseSummaryNumber(document.getElementById('total-expenses')?.value),
    grand_total: calculateGrandTotal(),
    is_saved: isSaved
  };
}

// Save shift
async function saveShift() {
  try {
    if (shiftViewMode === 'correction') {
      await saveShiftCorrection();
      return;
    }

    applyNightShiftGasAutoClose();

    // Validate data
    const errors = validateShiftData();
    if (errors.length > 0) {
      alert(`أخطاء في البيانات:\n${errors.join('\n')}`);
      return;
    }

    const dateInput = document.getElementById('shift-date');
    const shiftNumberSelect = document.getElementById('shift-number');
    const date = dateInput.value;
    const shiftNumber = parseInt(shiftNumberSelect.value);

    // Check if shift already exists (duplicate validation)
    const existingShift = await ipcRenderer.invoke('get-saved-shift', {
      date: date,
      shift_number: shiftNumber
    });

    if (existingShift && !currentShiftData.isSaved) {
      // Shift exists and we're not updating it (it's a duplicate)
      const shiftNumberText = shiftNumber === 1 ? 'الأولى' : 'الثانية';
      const confirmed = confirm(
        `تحذير: يوجد بالفعل وردية ${shiftNumberText} بتاريخ ${date}.\n\nهل تريد الكتابة فوقها؟`
      );

      if (!confirmed) {
        return; // User cancelled, don't save
      }
    }

    const shiftData = buildCurrentShiftPayload(date, shiftNumber, 1);

    // Save to database
    const result = await ipcRenderer.invoke('save-shift', shiftData);

    if (result.success) {
      currentShiftData.isSaved = true;
      currentShiftData.hasUnsavedChanges = false;
      setShiftDraftStatus('idle');

      showToast('تم حفظ الوردية بنجاح', 'success');

      // Close shift menu if open
      const menu = document.getElementById('shift-menu');
      if (menu) menu.classList.remove('show');

      // Save "آخر الوردية" and oils "المتبقي" values before clearing
      const lastShiftValues = saveLastShiftValues();
      const oilRemainingValues = saveOilRemainingValues();

      // Move to next shift (changes shift number/date)
      moveToNextShift(date, shiftNumber);

      // Copy saved "آخر الوردية" to "أول الوردية" of new shift
      copyLastShiftToFirst(lastShiftValues);

      // Clear specific fields after save and carry oil remaining -> next initial balance
      clearFieldsAfterSave(oilRemainingValues);
      applyNightShiftGasAutoClose();

      // Recompute fuel rows for the new shift from fresh prices + cleared clients/customers.
      await refreshFuelRowsAfterShiftSave();
    } else {
      if (result.error === 'validation_failed' && Array.isArray(result.validationErrors) && result.validationErrors.length > 0) {
        alert(`أخطاء في البيانات:\n${result.validationErrors.join('\n')}`);
        return;
      }
      showToast('خطأ في حفظ الوردية: ' + (result.error || 'خطأ غير معروف'), 'error');
    }
  } catch (error) {
    console.error('Error saving shift:', error);
    showToast('خطأ في حفظ الوردية', 'error');
  }
}

// Save "آخر الوردية" values before clearing
function saveLastShiftValues() {
  const values = {};

  // Diesel - 4 counters
  for (let i = 1; i <= 4; i++) {
    const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
    if (lastShiftInput) {
      values[`diesel-${i}`] = lastShiftInput.value;
    }
  }

  // Gas - 2 counters
  for (let i = 1; i <= 2; i++) {
    const lastShiftInput = document.getElementById(`fuel-gas-last-${i}`);
    if (lastShiftInput) {
      values[`gas-${i}`] = lastShiftInput.value;
    }
  }

  // Benzine 95, 92, 80 - each has 2 counters
  ['95', '92', '80'].forEach(type => {
    for (let i = 1; i <= 2; i++) {
      const lastShiftInput = document.getElementById(`fuel-${type}-last-${i}`);
      if (lastShiftInput) {
        values[`${type}-${i}`] = lastShiftInput.value;
      }
    }
  });

  return values;
}

// Save oils "المتبقي" values before moving to next shift
function saveOilRemainingValues() {
  const values = {};
  const tableBody = document.getElementById('shift-oil-table-body');

  if (!tableBody) return values;

  const rows = tableBody.querySelectorAll('tr[data-oil-id]');
  rows.forEach((row) => {
    const oilId = row.getAttribute('data-oil-id');
    if (!oilId) return;

    const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
    values[oilId] = getShiftInputDisplayValue(remainingInput?.value);
  });

  return values;
}

// Copy "آخر الوردية" values to "أول الوردية" of new shift
function copyLastShiftToFirst(lastShiftValues) {
  // Diesel - 4 counters
  for (let i = 1; i <= 4; i++) {
    const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
    if (firstShiftInput && lastShiftValues[`diesel-${i}`]) {
      firstShiftInput.value = lastShiftValues[`diesel-${i}`];
    }
  }

  // Gas - 2 counters
  for (let i = 1; i <= 2; i++) {
    const firstShiftInput = document.getElementById(`fuel-gas-first-${i}`);
    if (firstShiftInput && lastShiftValues[`gas-${i}`]) {
      firstShiftInput.value = lastShiftValues[`gas-${i}`];
    }
  }

  // Benzine 95, 92, 80 - each has 2 counters
  ['95', '92', '80'].forEach(type => {
    for (let i = 1; i <= 2; i++) {
      const firstShiftInput = document.getElementById(`fuel-${type}-first-${i}`);
      if (firstShiftInput && lastShiftValues[`${type}-${i}`]) {
        firstShiftInput.value = lastShiftValues[`${type}-${i}`];
      }
    }
  });
}

// Move to next shift after saving
function moveToNextShift(currentDate, currentShiftNumber) {
  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');

  if (currentShiftNumber === 1) {
    // If it's shift 1, move to shift 2 of the same day
    shiftNumberSelect.value = '2';
  } else {
    // If it's shift 2, move to shift 1 of the next day
    const date = new Date(currentDate);
    date.setDate(date.getDate() + 1);
    const nextDate = date.toISOString().split('T')[0];
    dateInput.value = nextDate;
    shiftNumberSelect.value = '1';

    // Reload fuel prices for the new date
    loadFuelPricesForDate(nextDate);
    loadAllOilPrices();
  }

  // Reset shift saved state for new shift
  currentShiftData.isSaved = false;
  currentShiftData.hasUnsavedChanges = false;

  // Switch back to fuel tab
  switchShiftTab('fuel');
}

// Clear specific fields after saving shift
function clearFieldsAfterSave(oilRemainingValues = {}) {
  // Clear "آخر الوردية" fields for all fuels
  const fuelTypes = ['diesel', '95', '92', '80', 'gas'];

  fuelTypes.forEach(type => {
    if (type === 'diesel') {
      // Diesel has 4 counters
      for (let i = 1; i <= 4; i++) {
        const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
        if (lastShiftInput) lastShiftInput.value = '';
      }
    } else if (type === 'gas') {
      // Gas has 2 counters
      for (let i = 1; i <= 2; i++) {
        const lastShiftInput = document.getElementById(`fuel-gas-last-${i}`);
        if (lastShiftInput) lastShiftInput.value = '';
      }
    } else {
      // 95, 92, 80 have 2 counters each
      for (let i = 1; i <= 2; i++) {
        const lastShiftInput = document.getElementById(`fuel-${type}-last-${i}`);
        if (lastShiftInput) lastShiftInput.value = '';
      }
    }
  });

  // Clear "عيارات" (cars) fields
  const dieselCarsInput = document.getElementById('fuel-diesel-cars');
  if (dieselCarsInput) dieselCarsInput.value = '';

  const car95Input = document.getElementById('fuel-95-cars');
  if (car95Input) car95Input.value = '';

  const car92Input = document.getElementById('fuel-92-cars');
  if (car92Input) car92Input.value = '';

  const car80Input = document.getElementById('fuel-80-cars');
  if (car80Input) car80Input.value = '';

  // For oils, carry "المتبقي" of saved shift to next shift "رصيد",
  // and clear the rest of row inputs.
  const tableBody = document.getElementById('shift-oil-table-body');
  if (tableBody) {
    const rows = tableBody.querySelectorAll('tr[data-oil-id]');
    rows.forEach((row) => {
      const oilId = row.getAttribute('data-oil-id');
      if (!oilId) return;

      const carriedInitial = getShiftInputDisplayValue(oilRemainingValues[oilId]);
      const initialInput = document.getElementById(`oil-${oilId}-initial`);
      const addedInput = document.getElementById(`oil-${oilId}-added`);
      const totalInput = document.getElementById(`oil-${oilId}-total`);
      const soldInput = document.getElementById(`oil-${oilId}-sold`);
      const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
      const openInput = document.getElementById(`oil-${oilId}-open`);
      const customersInput = document.getElementById(`oil-${oilId}-customers`);
      const revenueInput = document.getElementById(`oil-${oilId}-revenue`);
      const customerNameSelect = document.getElementById(`oil-${oilId}-customer-name`);
      const voucherInput = document.getElementById(`oil-${oilId}-voucher`);

      if (initialInput) initialInput.value = carriedInitial;
      if (addedInput) addedInput.value = '';
      if (totalInput) totalInput.value = carriedInitial;
      if (soldInput) soldInput.value = '';
      if (remainingInput) {
        remainingInput.value = '';
        setOilRemainingEmptyMeansZero(remainingInput, false);
      }
      if (openInput) openInput.value = '';
      if (customersInput) customersInput.value = '';
      if (revenueInput) revenueInput.value = '';
      if (customerNameSelect) populateCustomerNameSelect(customerNameSelect, '');
      if (voucherInput) voucherInput.checked = false;
    });
  }

  clearShiftRevenueInputs();
  clearShiftExpenseInputs();
  calculateOilTotal();
  calculateNetTotal();

  // Clear all customer table data
  clearCustomerTable();
}

async function refreshFuelRowsAfterShiftSave() {
  const activeDate = document.getElementById('shift-date')?.value;

  // Ensure client totals are reset to current (empty) customer table content.
  updateCustomerColumnSums();

  if (activeDate) {
    await loadFuelPricesForDate(activeDate);
    return;
  }

  recalculateFuelDerivedRows();
}

// Clear all rows in customer table
function clearCustomerTable() {
  setCustomerRowsData([]);
}

function setShiftEntryInputsDisabled(disabled) {
  const shiftEntryScreen = document.getElementById('shift-entry-screen');
  if (!shiftEntryScreen) return;

  const fields = shiftEntryScreen.querySelectorAll('input, select, textarea');
  fields.forEach((field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
      return;
    }
    if (disabled && (field.id === 'shift-date' || field.id === 'shift-number')) {
      field.disabled = false;
      return;
    }
    field.disabled = disabled;
  });
}

// Enable read-only mode
function enableReadOnlyMode() {
  const shiftEntryScreen = document.getElementById('shift-entry-screen');
  if (shiftEntryScreen) {
    shiftEntryScreen.classList.add('shift-readonly');
  }

  // Disable every form field in shift-entry screen (view-only mode).
  setShiftEntryInputsDisabled(true);

  // Hide save button
  const saveBtn = document.getElementById('save-shift-btn');
  if (saveBtn) {
    saveBtn.style.display = 'none';
  }
}

// Disable read-only mode
function disableReadOnlyMode() {
  const shiftEntryScreen = document.getElementById('shift-entry-screen');
  if (shiftEntryScreen) {
    shiftEntryScreen.classList.remove('shift-readonly');
  }

  // Re-enable form fields when returning to edit mode.
  setShiftEntryInputsDisabled(false);

  // Show save button only in edit mode
  const saveBtn = document.getElementById('save-shift-btn');
  if (saveBtn) {
    saveBtn.style.display = shiftViewMode === 'edit' ? 'inline-flex' : 'none';
  }
}

function setShiftIdentifierFieldsLocked(locked) {
  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');
  if (dateInput) dateInput.disabled = Boolean(locked);
  if (shiftNumberSelect) shiftNumberSelect.disabled = Boolean(locked);
}

// Get last shift (by ID - most recent)
async function getLastShift() {
  try {
    const lastShift = await ipcRenderer.invoke('get-last-shift');
    return lastShift;
  } catch (error) {
    console.error('Error getting last shift:', error);
    return null;
  }
}

async function getLastDraftShift() {
  try {
    return await ipcRenderer.invoke('get-last-draft-shift');
  } catch (error) {
    console.error('Error getting last draft shift:', error);
    return null;
  }
}

async function getLastSavedShift() {
  try {
    return await ipcRenderer.invoke('get-last-saved-shift');
  } catch (error) {
    console.error('Error getting last saved shift:', error);
    return null;
  }
}

async function getPreviousSavedShiftFor(date, shiftNumber) {
  try {
    return await ipcRenderer.invoke('get-adjacent-saved-shift', {
      date,
      shift_number: shiftNumber,
      direction: 'previous'
    });
  } catch (error) {
    console.error('Error getting previous saved shift:', error);
    return null;
  }
}

async function getShiftBalanceOverrides(date, shiftNumber) {
  try {
    const rows = await ipcRenderer.invoke('get-shift-balance-change-overrides', {
      date,
      shift_number: shiftNumber
    });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('Error getting shift balance overrides:', error);
    return [];
  }
}

// Calculate next shift date and number based on last shift
function calculateNextShift(lastShift) {
  if (!lastShift) {
    // No previous shift, default to today shift 1
    return {
      date: getTodayDate(),
      shiftNumber: 1
    };
  }

  const lastDate = lastShift.date;
  const lastShiftNumber = lastShift.shift_number;

  if (lastShiftNumber === 1) {
    // Last was shift 1, next is shift 2 same day
    return {
      date: lastDate,
      shiftNumber: 2
    };
  } else {
    // Last was shift 2, next is shift 1 next day
    const dateObj = new Date(lastDate);
    dateObj.setDate(dateObj.getDate() + 1);
    return {
      date: dateObj.toISOString().split('T')[0],
      shiftNumber: 1
    };
  }
}

function buildShiftBalanceOverrideSets(changes = []) {
  const fuel = new Set();
  const oil = new Set();

  changes.forEach((change) => {
    const itemType = String(change?.item_type || '').trim();
    const itemName = String(change?.item_name || '').trim();
    const fieldName = String(change?.field_name || '').trim();
    if (!itemName || !fieldName) return;

    if (itemType === 'fuel') {
      fuel.add(`${itemName}|${fieldName}`);
    } else if (itemType === 'oil') {
      oil.add(`${itemName}|${fieldName}`);
    }
  });

  return { fuel, oil };
}

function hasFuelStartOverride(overrides, fuelName, counterIndex) {
  const itemName = `${fuelName} - عداد ${convertToArabicNumerals(counterIndex)}`;
  return overrides.fuel.has(`${itemName}|أول الوردية`);
}

function hasOilInitialOverride(overrides, oilName) {
  return overrides.oil.has(`${oilName}|رصيد`);
}

function applyPreviousShiftFuelStartValues(previousShift, overrides) {
  const legacyData = parseShiftJsonObject(previousShift?.data, {});
  const fuelData = parseShiftJsonObject(previousShift?.fuel_data || legacyData.fuel_data, {});

  Object.entries(fuelData).forEach(([fuelType, data]) => {
    const fuelName = getShiftFuelEntryName(fuelType, data);
    const fuelId = fuelIdMap[fuelName];
    if (!fuelId) return;

    const counterCount = fuelName === 'سولار' ? 4 : 2;
    for (let i = 1; i <= counterCount; i += 1) {
      if (hasFuelStartOverride(overrides, fuelName, i)) continue;

      const firstShiftInput = fuelName === 'سولار'
        ? document.getElementById(`fuel-diesel-first-${i}`)
        : document.getElementById(`fuel-${fuelId}-first-${i}`);
      const lastShiftValue = data?.[`lastShift${i}`];

      if (firstShiftInput && lastShiftValue !== undefined && lastShiftValue !== null) {
        firstShiftInput.value = getShiftInputDisplayValue(lastShiftValue);
      }
    }
  });
}

async function applyPreviousShiftOilInitialValues(previousShift, overrides) {
  const legacyData = parseShiftJsonObject(previousShift?.data, {});
  const oilData = parseShiftJsonObject(previousShift?.oil_data || legacyData.oil_data, {});
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody || Object.keys(oilData).length === 0) return;

  const oilDataByName = new Map(
    Object.entries(oilData).map(([oilName, data]) => [normalizeOilName(getShiftOilEntryName(oilName, data)), data])
  );
  const oilDataByCode = new Map(
    Object.entries(oilData)
      .map(([oilName, data]) => [getShiftOilEntryCode(oilName, data), data])
      .filter(([code]) => Boolean(code))
  );

  for (const row of Array.from(tableBody.querySelectorAll('tr[data-oil-id]'))) {
    const oilId = row.getAttribute('data-oil-id');
    const oilCode = row.getAttribute('data-oil-code') || '';
    const oilName = row.getAttribute('data-oil-name') || row.querySelector('td strong')?.textContent || '';
    if (!oilId || hasOilInitialOverride(overrides, oilName)) continue;

    const previousOilData = oilDataByCode.get(oilCode) || oilDataByName.get(normalizeOilName(oilName));
    if (!previousOilData) continue;

    const initialInput = document.getElementById(`oil-${oilId}-initial`);
    if (initialInput) {
      initialInput.value = getShiftInputDisplayValue(previousOilData.remaining);
      await calculateOilRow(oilId);
    }
  }
}

function recalculateShiftFromStartValues() {
  applyNightShiftGasAutoClose();
  calculateDieselQuantity();
  calculateFuelQuantity('بنزين ٩٥');
  calculateFuelQuantity('بنزين ٩٢');
  calculateFuelQuantity('بنزين ٨٠');
  calculateFuelQuantity('غاز سيارات');
  calculateFuelTotal();
  calculateOilTotal();
  calculateNetTotal();
}

async function applyAutomaticStartValuesForDraft(date, shiftNumber) {
  const previousShift = await getPreviousSavedShiftFor(date, shiftNumber);
  if (!previousShift) return;

  const overrides = buildShiftBalanceOverrideSets(await getShiftBalanceOverrides(date, shiftNumber));
  applyPreviousShiftFuelStartValues(previousShift, overrides);
  await applyPreviousShiftOilInitialValues(previousShift, overrides);
  recalculateShiftFromStartValues();
}

function loadPreviousShiftOilBalances(previousShift) {
  const legacyData = parseShiftJsonObject(previousShift?.data, {});
  const oilData = parseShiftJsonObject(previousShift?.oil_data || legacyData.oil_data, {});
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody || Object.keys(oilData).length === 0) return;

  const oilDataByName = new Map(
    Object.entries(oilData).map(([oilName, data]) => [normalizeOilName(getShiftOilEntryName(oilName, data)), data])
  );
  const oilDataByCode = new Map(
    Object.entries(oilData)
      .map(([oilName, data]) => [getShiftOilEntryCode(oilName, data), data])
      .filter(([code]) => Boolean(code))
  );

  tableBody.querySelectorAll('tr[data-oil-id]').forEach((row) => {
    const oilId = row.getAttribute('data-oil-id');
    const oilCode = row.getAttribute('data-oil-code') || '';
    const oilName = row.getAttribute('data-oil-name') || row.querySelector('td strong')?.textContent || '';
    const previousOilData = oilDataByCode.get(oilCode) || oilDataByName.get(normalizeOilName(oilName));
    if (!oilId || !previousOilData) return;

    const carriedInitial = getShiftInputDisplayValue(previousOilData.remaining);
    const initialInput = document.getElementById(`oil-${oilId}-initial`);
    const addedInput = document.getElementById(`oil-${oilId}-added`);
    const totalInput = document.getElementById(`oil-${oilId}-total`);
    const soldInput = document.getElementById(`oil-${oilId}-sold`);
    const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
    const openInput = document.getElementById(`oil-${oilId}-open`);
    const customersInput = document.getElementById(`oil-${oilId}-customers`);
    const revenueInput = document.getElementById(`oil-${oilId}-revenue`);

    if (initialInput) initialInput.value = carriedInitial;
    if (addedInput) addedInput.value = '';
    if (totalInput) totalInput.value = carriedInitial;
    if (soldInput) soldInput.value = '';
    if (remainingInput) {
      remainingInput.value = '';
      setOilRemainingEmptyMeansZero(remainingInput, false);
    }
    if (openInput) openInput.value = '';
    if (customersInput) customersInput.value = '';
    if (revenueInput) revenueInput.value = '';
  });

  calculateOilTotal();
  calculateNetTotal();
}

// Load next shift automatically with pre-populated initial values
async function loadNextShift() {
  try {
    if (shiftDraftAutoSavePromise) {
      await shiftDraftAutoSavePromise;
    }

    const lastDraftShift = await getLastDraftShift();

    // If there is a draft shift (not saved), resume it directly.
    if (lastDraftShift) {
      const dateInput = document.getElementById('shift-date');
      const shiftNumberSelect = document.getElementById('shift-number');
      if (dateInput) dateInput.value = lastDraftShift.date;
      if (shiftNumberSelect) shiftNumberSelect.value = lastDraftShift.shift_number;
      await loadShiftData(lastDraftShift.date, lastDraftShift.shift_number);
      disableReadOnlyMode();
      return;
    }

    // Get last saved shift for next-shift calculation.
    const lastShift = await getLastSavedShift();

    // Calculate next shift
    const nextShift = calculateNextShift(lastShift);

    // Set date and shift number
    const dateInput = document.getElementById('shift-date');
    const shiftNumberSelect = document.getElementById('shift-number');

    if (dateInput) dateInput.value = nextShift.date;
    if (shiftNumberSelect) shiftNumberSelect.value = nextShift.shiftNumber;
    currentShiftData.date = nextShift.date;
    currentShiftData.shiftNumber = nextShift.shiftNumber;
    currentShiftData.isSaved = false;
    currentShiftData.hasUnsavedChanges = false;

    // Check if this shift already exists in DB
    const existingShift = await ipcRenderer.invoke('get-shift', {
      date: nextShift.date,
      shift_number: nextShift.shiftNumber
    });

    if (existingShift) {
      // Shift exists, load it
      await loadShiftData(nextShift.date, nextShift.shiftNumber);
    } else {
      // New shift, pre-populate with last shift end values
      if (lastShift) {
        await loadPreviousShiftEndValues(lastShift);
      }
      disableReadOnlyMode();
    }
  } catch (error) {
    console.error('Error loading next shift:', error?.stack || error);
    showMessage('تعذر تحميل الوردية التالية', 'error');
    return false;
  }

  return true;
}

// Load previous shift end values into current shift first values
async function loadPreviousShiftEndValues(previousShift) {
  try {
    if (!previousShift) return;

    const fuelData = JSON.parse(previousShift.fuel_data);

    // Populate "first shift" fields with "last shift" values from previous shift
    Object.entries(fuelData).forEach(([fuelType, data]) => {
      const fuelName = getShiftFuelEntryName(fuelType, data);
      const fuelId = fuelIdMap[fuelName];
      if (fuelId) {
        if (fuelName === 'سولار') {
          // Diesel has 4 counters
          for (let i = 1; i <= 4; i++) {
            const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
            const lastShiftValue = data?.[`lastShift${i}`];
            if (firstShiftInput && lastShiftValue !== undefined && lastShiftValue !== null) {
              firstShiftInput.value = getShiftInputDisplayValue(lastShiftValue);
            }
          }
        } else {
          // Other fuels have 2 counters
          for (let i = 1; i <= 2; i++) {
            const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);
            const lastShiftValue = data?.[`lastShift${i}`];
            if (firstShiftInput && lastShiftValue !== undefined && lastShiftValue !== null) {
              firstShiftInput.value = getShiftInputDisplayValue(lastShiftValue);
            }
          }
        }
      }
    });

    applyNightShiftGasAutoClose();

    // Trigger quantity calculations for all fuels
    calculateDieselQuantity();
    calculateFuelQuantity('بنزين ٩٥');
    calculateFuelQuantity('بنزين ٩٢');
    calculateFuelQuantity('بنزين ٨٠');
    calculateFuelQuantity('غاز سيارات');
    loadPreviousShiftOilBalances(previousShift);
  } catch (error) {
    console.error('Error loading previous shift end values:', error);
  }
}

// Load shift data
async function loadShiftData(date, shiftNumber) {
  try {
    lockResetInlineFields();
    const shift = await ipcRenderer.invoke('get-shift', { date, shift_number: shiftNumber });
    const setInputValue = (input, value) => {
      if (!input) return;
      input.value = getShiftInputDisplayValue(value);
    };

    if (!shift) {
      // No existing shift, clear form
      clearShiftForm();
      setCustomerRowsData([]);

      currentShiftData.date = date;
      currentShiftData.shiftNumber = shiftNumber;
      currentShiftData.isSaved = false;
      currentShiftData.hasUnsavedChanges = false;
      currentShiftData.draftCleanupQueue = [];

      // Load last shift data (by ID) to populate "first shift" fields
      const lastShift = await getLastSavedShift();
      if (lastShift) {
        await loadPreviousShiftEndValues(lastShift);
      }

      setShiftDraftStatus('idle');
      disableReadOnlyMode();
      return;
    }

    const parseJsonObject = (value, fallback = {}) => {
      if (!value) return fallback;
      if (typeof value === 'object') return value;
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
      } catch (error) {
        return fallback;
      }
    };

    const legacyData = parseJsonObject(shift.data, {});
    const fuelData = parseJsonObject(shift.fuel_data || legacyData.fuel_data, {});
    const oilData = parseJsonObject(shift.oil_data || legacyData.oil_data, {});
    const customerRows = normalizeCustomerRowsData(legacyData.customer_rows);
    const revenueItems = normalizeRevenueItems(legacyData.revenue_items);
    const customerPayments = normalizeCustomerPayments(legacyData.customer_payments);
    const washLubeRevenue = parseFloat(
      shift.wash_lube_revenue ?? legacyData.wash_lube_revenue ?? 0
    ) || 0;
    const totalExpenses = parseFloat(
      shift.total_expenses ?? legacyData.total_expenses ?? 0
    ) || 0;
    const expenseItems = normalizeExpenseItems(legacyData.expense_items);

    renderRevenueItems(revenueItems);
    renderCustomerPayments(customerPayments);
    renderExpenseItems(expenseItems);

    // Populate fuel data
    Object.entries(fuelData).forEach(([fuelType, data]) => {
      const fuelName = getShiftFuelEntryName(fuelType, data);
      const fuelId = fuelIdMap[fuelName];
      if (fuelId) {
        if (fuelName === 'سولار') {
          // Diesel has 4 counters
          for (let i = 1; i <= 4; i++) {
            const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
            const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
            const quantityInput = document.getElementById(`fuel-diesel-quantity-${i}`);

            setInputValue(lastShiftInput, data[`lastShift${i}`]);
            setInputValue(firstShiftInput, data[`firstShift${i}`]);
            setInputValue(quantityInput, data[`quantity${i}`]);
          }

          const totalQuantityInput = document.getElementById('fuel-diesel-total-qty');
          const clientsInput = document.getElementById('fuel-diesel-clients');
          const carsInput = document.getElementById('fuel-diesel-cars');
          const priceInput = document.getElementById('fuel-diesel-price');
          const cashInput = document.getElementById('fuel-diesel-cash');

          setInputValue(totalQuantityInput, data.totalQuantity);
          setInputValue(clientsInput, data.clients);
          setInputValue(carsInput, data.cars);
          setInputValue(priceInput, data.price);
          setInputValue(cashInput, data.cash);
        } else {
          // Other fuels have 2 counters
          for (let i = 1; i <= 2; i++) {
            const lastShiftInput = document.getElementById(`fuel-${fuelId}-last-${i}`);
            const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);
            const quantityInput = document.getElementById(`fuel-${fuelId}-quantity-${i}`);

            setInputValue(lastShiftInput, data[`lastShift${i}`]);
            setInputValue(firstShiftInput, data[`firstShift${i}`]);
            setInputValue(quantityInput, data[`quantity${i}`]);
          }

          const totalQuantityInput = document.getElementById(`fuel-${fuelId}-total-qty`);
          const clientsInput = document.getElementById(`fuel-${fuelId}-clients`);
          const carsInput = document.getElementById(`fuel-${fuelId}-cars`);
          const priceInput = document.getElementById(`fuel-${fuelId}-price`);
          const cashInput = document.getElementById(`fuel-${fuelId}-cash`);

          setInputValue(totalQuantityInput, data.totalQuantity);
          setInputValue(clientsInput, data.clients);
          setInputValue(carsInput, data.cars);
          setInputValue(priceInput, data.price);
          setInputValue(cashInput, data.cash);
        }
      }
    });

    // Populate oil data
    const tableBody = document.getElementById('shift-oil-table-body');
    if (tableBody) {
      const oilDataByName = new Map(
        Object.entries(oilData).map(([oilName, data]) => [normalizeOilName(getShiftOilEntryName(oilName, data)), data])
      );
      const oilDataByCode = new Map(
        Object.entries(oilData)
          .map(([oilName, data]) => [getShiftOilEntryCode(oilName, data), data])
          .filter(([code]) => Boolean(code))
      );

      tableBody.querySelectorAll('tr[data-oil-id]').forEach(row => {
        const oilId = row.getAttribute('data-oil-id');
        const rowOilCode = row.getAttribute('data-oil-code') || '';
        const rowOilName = row.getAttribute('data-oil-name') || row.querySelector('td strong')?.textContent || '';
        const data = oilDataByCode.get(rowOilCode) || oilDataByName.get(normalizeOilName(rowOilName));
        if (!oilId || !data) return;

        const initialInput = document.getElementById(`oil-${oilId}-initial`);
        const addedInput = document.getElementById(`oil-${oilId}-added`);
        const totalInput = document.getElementById(`oil-${oilId}-total`);
        const soldInput = document.getElementById(`oil-${oilId}-sold`);
        const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
        const openInput = document.getElementById(`oil-${oilId}-open`);
        const customersInput = document.getElementById(`oil-${oilId}-customers`);
        const priceInput = document.getElementById(`oil-${oilId}-price`);
        const revenueInput = document.getElementById(`oil-${oilId}-revenue`);
        const customerNameSelect = document.getElementById(`oil-${oilId}-customer-name`);
        const voucherInput = document.getElementById(`oil-${oilId}-voucher`);

        setInputValue(initialInput, data.initial);
        setInputValue(addedInput, data.added);
        setInputValue(totalInput, data.total);
        setInputValue(soldInput, data.sold);
        setInputValue(remainingInput, data.remaining);
        setOilRemainingEmptyMeansZero(remainingInput, false);
        setInputValue(openInput, data.open);
        setInputValue(customersInput, data.customers);
        setInputValue(priceInput, data.price);
        setInputValue(revenueInput, data.revenue);
        if (customerNameSelect) populateCustomerNameSelect(customerNameSelect, data.customer_id || data.customer_name || '', data.customer_name || '');
        if (voucherInput) voucherInput.checked = Boolean(data.voucher);
      });
    }

    const washLubeInput = document.getElementById('total-wash-lube-revenue');
    if (washLubeInput) {
      washLubeInput.value = Math.abs(washLubeRevenue) > 0.0001 ? formatPrice(washLubeRevenue) : '';
    }

    setCustomerRowsData(customerRows);

    // Recalculate totals
    calculateFuelTotal();
    calculateOilTotal();
    calculateGrandTotal();
    const totalExpensesInput = document.getElementById('total-expenses');
    if (expenseItems.length > 0) {
      calculateTotalExpenses();
    } else if (totalExpensesInput && Math.abs(totalExpenses) > 0.0001) {
      totalExpensesInput.value = formatPrice(totalExpenses);
      calculateNetTotal();
    } else if (totalExpensesInput) {
      totalExpensesInput.value = '';
      calculateNetTotal();
    }

	    // Set current shift state
	    currentShiftData.date = date;
	    currentShiftData.shiftNumber = shiftNumber;
	    currentShiftData.isSaved = shift.is_saved === 1;
	    currentShiftData.hasUnsavedChanges = false;
	    currentShiftData.draftCleanupQueue = [];
	    if (shift.is_saved !== 1) {
	      await applyAutomaticStartValuesForDraft(date, shiftNumber);
	      currentShiftData.hasUnsavedChanges = false;
	    }
	    setShiftDraftStatus('idle');
    if (applyNightShiftGasAutoClose()) {
      calculateGrandTotal();
      currentShiftData.hasUnsavedChanges = false;
    }

    // If saved, enable read-only mode
    if (shift.is_saved === 1) {
      enableReadOnlyMode();
    } else {
      disableReadOnlyMode();
    }
  } catch (error) {
    console.error('Error loading shift data:', error);
    alert('خطأ في تحميل بيانات الوردية');
  }
}

// Clear shift form
function clearShiftForm() {
  // Clear fuel inputs
  Object.entries(fuelIdMap).forEach(([fuelType, fuelId]) => {
    if (fuelType === 'سولار') {
      // Clear diesel 4 counters
      for (let i = 1; i <= 4; i++) {
        const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
        const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
        const quantityInput = document.getElementById(`fuel-diesel-quantity-${i}`);

        if (lastShiftInput) lastShiftInput.value = '';
        if (firstShiftInput) firstShiftInput.value = '';
        if (quantityInput) quantityInput.value = '';
      }

      const totalQuantityInput = document.getElementById('fuel-diesel-total-qty');
      const clientsInput = document.getElementById('fuel-diesel-clients');
      const carsInput = document.getElementById('fuel-diesel-cars');
      const priceInput = document.getElementById('fuel-diesel-price');
      const cashInput = document.getElementById('fuel-diesel-cash');

      if (totalQuantityInput) totalQuantityInput.value = '';
      if (clientsInput) clientsInput.value = '';
      if (carsInput) carsInput.value = '';
      // DON'T clear price - it should be loaded from database
      // if (priceInput) priceInput.value = '';
      if (cashInput) cashInput.value = '';
    } else {
      // Clear other fuels (2 counters)
      for (let i = 1; i <= 2; i++) {
        const lastShiftInput = document.getElementById(`fuel-${fuelId}-last-${i}`);
        const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);
        const quantityInput = document.getElementById(`fuel-${fuelId}-quantity-${i}`);

        if (lastShiftInput) lastShiftInput.value = '';
        if (firstShiftInput) firstShiftInput.value = '';
        if (quantityInput) quantityInput.value = '';
      }

      const totalQuantityInput = document.getElementById(`fuel-${fuelId}-total-qty`);
      const clientsInput = document.getElementById(`fuel-${fuelId}-clients`);
      const carsInput = document.getElementById(`fuel-${fuelId}-cars`);
      const priceInput = document.getElementById(`fuel-${fuelId}-price`);
      const cashInput = document.getElementById(`fuel-${fuelId}-cash`);

      if (totalQuantityInput) totalQuantityInput.value = '';
      if (clientsInput) clientsInput.value = '';
      if (carsInput) carsInput.value = '';
      // DON'T clear price - it should be loaded from database
      // if (priceInput) priceInput.value = '';
      if (cashInput) cashInput.value = '';
    }
  });

  // Clear oil inputs
  const tableBody = document.getElementById('shift-oil-table-body');
  if (tableBody) {
    const rows = tableBody.querySelectorAll('tr[data-oil-id]');
    rows.forEach(row => {
      const oilId = row.getAttribute('data-oil-id');

      const initialInput = document.getElementById(`oil-${oilId}-initial`);
      const addedInput = document.getElementById(`oil-${oilId}-added`);
      const totalInput = document.getElementById(`oil-${oilId}-total`);
      const soldInput = document.getElementById(`oil-${oilId}-sold`);
      const remainingInput = document.getElementById(`oil-${oilId}-remaining`);
      const openInput = document.getElementById(`oil-${oilId}-open`);
      const customersInput = document.getElementById(`oil-${oilId}-customers`);
      const priceInput = document.getElementById(`oil-${oilId}-price`);
      const revenueInput = document.getElementById(`oil-${oilId}-revenue`);
      const customerNameSelect = document.getElementById(`oil-${oilId}-customer-name`);
      const voucherInput = document.getElementById(`oil-${oilId}-voucher`);

      if (initialInput) initialInput.value = '';
      if (addedInput) addedInput.value = '';
      if (totalInput) totalInput.value = '';
      if (soldInput) soldInput.value = '';
      if (remainingInput) {
        remainingInput.value = '';
        setOilRemainingEmptyMeansZero(remainingInput, false);
      }
      if (openInput) openInput.value = '';
      if (customersInput) customersInput.value = '';
      if (priceInput) priceInput.value = '';
      if (revenueInput) revenueInput.value = '';
      if (customerNameSelect) populateCustomerNameSelect(customerNameSelect, '');
      if (voucherInput) voucherInput.checked = false;
    });
  }

  clearShiftRevenueInputs();
  clearShiftExpenseInputs();

  // Reset totals
  calculateFuelTotal();
  calculateOilTotal();
  calculateGrandTotal();

  // Reset state
  currentShiftData.isSaved = false;
  currentShiftData.hasUnsavedChanges = false;
}

// Handle date/shift number change
async function handleShiftIdentifierChange() {
  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');

  if (!dateInput?.value || !shiftNumberSelect?.value) return;

  const date = dateInput.value;
  const shiftNumber = parseInt(shiftNumberSelect.value);
  const isDraftMode = shiftViewMode === 'edit' && !currentShiftData.isSaved;

  if (shiftViewMode === 'correction') {
    return;
  }

  if (shiftViewMode === 'history') {
    const previousDate = currentShiftData.date;
    const previousShift = currentShiftData.shiftNumber;
    const previousKey = getShiftIdentifierKey(previousDate, previousShift);
    const nextKey = getShiftIdentifierKey(date, shiftNumber);

    if (previousKey === nextKey) {
      return;
    }

    const loaded = await loadShiftHistory(date, shiftNumber, null);
    if (!loaded) {
      showMessage('لا توجد وردية محفوظة لهذه البيانات', 'info');
      if (previousDate) dateInput.value = previousDate;
      if (previousShift) shiftNumberSelect.value = previousShift.toString();
      if (previousDate && previousShift) {
        updateHistoryChip(previousDate, previousShift);
      }
    }
    return;
  }

  // In draft mode, changing date/shift should only re-associate the current form data,
  // not reload another shift and wipe current inputs.
  if (isDraftMode) {
    const previousDate = currentShiftData.date;
    const previousShift = currentShiftData.shiftNumber;

    if (previousDate && Number.isFinite(parseInt(previousShift, 10))) {
      const previousKey = getShiftIdentifierKey(previousDate, previousShift);
      const nextKey = getShiftIdentifierKey(date, shiftNumber);
      if (previousKey && nextKey && previousKey !== nextKey) {
        queueDraftIdentifierForCleanup(previousDate, previousShift);
      }
    }

    currentShiftData.date = date;
    currentShiftData.shiftNumber = shiftNumber;
    currentShiftData.hasUnsavedChanges = true;
    const previousShiftNumber = parseInt(previousShift, 10);
    if (previousShiftNumber === 2 && shiftNumber === 1) {
      clearGasLastShiftCounters();
    } else {
      applyNightShiftGasAutoClose();
    }
    setShiftDraftStatus('dirty');
    scheduleShiftDraftAutoSave();
    return;
  }

  // Check for unsaved changes
  if (currentShiftData.hasUnsavedChanges) {
    const confirmed = confirm('لديك تغييرات غير محفوظة. هل تريد المتابعة؟');
    if (!confirmed) {
      // Restore previous values
      dateInput.value = currentShiftData.date || '';
      shiftNumberSelect.value = currentShiftData.shiftNumber || '1';
      return;
    }
  }

  // Load shift data for selected date and shift number
  await loadShiftData(date, shiftNumber);
}

// Show shift history (placeholder for now)
async function showShiftHistory() {
  const modal = document.getElementById('shift-history-modal');
  const dateInput = document.getElementById('history-shift-date');
  const shiftSelect = document.getElementById('history-shift-number');
  const msg = document.getElementById('history-shift-message');

  // Prefill with last saved shift if available
  let last = null;
  try {
    last = await ipcRenderer.invoke('get-last-saved-shift');
  } catch (e) {
    console.warn('Unable to load last shift for history modal:', e);
  }

  if (dateInput) {
    dateInput.value = last?.date || getTodayDate();
  }
  if (shiftSelect) {
    shiftSelect.value = last?.shift_number ? last.shift_number.toString() : '1';
  }
  if (msg) {
    msg.textContent = '';
  }

  if (modal) {
    modal.classList.add('show');
  }
}

async function loadShiftFromHistory() {
  const dateInput = document.getElementById('history-shift-date');
  const shiftSelect = document.getElementById('history-shift-number');
  const msg = document.getElementById('history-shift-message');

  const date = dateInput?.value;
  const shiftNumber = parseInt(shiftSelect?.value || '0', 10);

  if (!date || !shiftNumber) {
    if (msg) msg.textContent = 'يرجى اختيار التاريخ والوردية';
    return;
  }

  // Warn if unsaved changes on shift-entry
  if (currentShiftData.hasUnsavedChanges && currentScreen === 'shift-entry' && shiftViewMode !== 'history') {
    const confirmed = confirm('لديك تغييرات غير محفوظة في الوردية الحالية. هل تريد المتابعة؟');
    if (!confirmed) return;
  }

  await loadShiftHistory(date, shiftNumber, msg);
}

async function loadShiftHistory(date, shiftNumber, messageEl) {
  try {
    const existingShift = await ipcRenderer.invoke('get-saved-shift', { date, shift_number: shiftNumber });

    if (!existingShift) {
      if (messageEl) messageEl.textContent = 'لا توجد وردية محفوظة لهذه البيانات';
      return false;
    }

    shiftViewMode = 'history';
    currentShiftData.hasUnsavedChanges = false;
    const dateField = document.getElementById('shift-date');
    const shiftField = document.getElementById('shift-number');
    if (dateField) dateField.value = date;
    if (shiftField) shiftField.value = shiftNumber.toString();

    bindShiftIdentifierListeners();
    showScreen('shift-entry', 'home');
    const legacyData = parseShiftJsonObject(existingShift.data, {});
    const oilData = parseShiftJsonObject(existingShift.oil_data || legacyData.oil_data, {});
    await loadCustomerNameOptions();
    renderSavedShiftOilRows(oilData);
    await loadShiftData(date, shiftNumber);
    initializeShiftHorizontalScrollControls();
    enableReadOnlyMode();
    setShiftIdentifierFieldsLocked(false);
    updateShiftTitle();
    toggleHistoryBar(true);
    updateHistoryChip(date, shiftNumber);

    if (messageEl) messageEl.textContent = '';
    closeShiftHistoryModal();
    return true;
  } catch (error) {
    console.error('Error loading shift from history:', error);
    if (messageEl) messageEl.textContent = 'حدث خطأ أثناء تحميل الوردية';
    return false;
  }
}

function startShiftCorrection() {
  if (shiftViewMode !== 'history' || !currentShiftData.isSaved) {
    showMessage('افتح وردية محفوظة أولاً قبل التصحيح', 'error');
    return;
  }

  shiftViewMode = 'correction';
  currentShiftData.hasUnsavedChanges = false;
  disableReadOnlyMode();
  setShiftIdentifierFieldsLocked(true);
  updateShiftTitle();
  toggleHistoryBar(true);
  setShiftDraftStatus('idle', 'وضع تصحيح الوردية');
}

async function cancelShiftCorrection() {
  if (shiftViewMode !== 'correction') return;

  if (currentShiftData.hasUnsavedChanges) {
    const confirmed = confirm('لديك تصحيح غير محفوظ. هل تريد إلغاء التصحيح؟');
    if (!confirmed) return;
  }

  const date = currentShiftData.date || document.getElementById('shift-date')?.value;
  const shiftNumber = parseInt(
    currentShiftData.shiftNumber || document.getElementById('shift-number')?.value || '0',
    10
  );

  if (date && Number.isFinite(shiftNumber)) {
    await loadShiftHistory(date, shiftNumber, null);
  } else {
    shiftViewMode = 'history';
    enableReadOnlyMode();
    setShiftIdentifierFieldsLocked(false);
    updateShiftTitle();
    toggleHistoryBar(true);
  }
}

async function saveShiftCorrection() {
  if (shiftViewMode !== 'correction') return;

  try {
    const errors = validateShiftData();
    if (errors.length > 0) {
      alert(`أخطاء في البيانات:\n${errors.join('\n')}`);
      return;
    }

    const date = currentShiftData.date || document.getElementById('shift-date')?.value;
    const shiftNumber = parseInt(
      currentShiftData.shiftNumber || document.getElementById('shift-number')?.value || '0',
      10
    );
    if (!date || !Number.isFinite(shiftNumber)) {
      showToast('لا يمكن حفظ التصحيح بدون تاريخ ورقم وردية', 'error');
      return;
    }

    const saveButton = document.getElementById('save-shift-correction-btn');
    if (saveButton) saveButton.disabled = true;

    const result = await ipcRenderer.invoke(
      'correct-saved-shift',
      buildCurrentShiftPayload(date, shiftNumber, 1)
    );

    if (!result?.success) {
      if (result?.error === 'validation_failed' && Array.isArray(result.validationErrors) && result.validationErrors.length > 0) {
        alert(`أخطاء في البيانات:\n${result.validationErrors.join('\n')}`);
        return;
      }
      showToast('خطأ في حفظ التصحيح: ' + (result?.error || 'خطأ غير معروف'), 'error');
      return;
    }

    currentShiftData.hasUnsavedChanges = false;
    showToast('تم حفظ التصحيح بنجاح', 'success');
    await Promise.allSettled([
      loadHomeChart(),
      loadTodayStats(),
      loadSafeBookMovements()
    ]);
    await loadShiftHistory(date, shiftNumber, null);
  } catch (error) {
    console.error('Error saving shift correction:', error);
    showToast('خطأ في حفظ التصحيح', 'error');
  } finally {
    const saveButton = document.getElementById('save-shift-correction-btn');
    if (saveButton) saveButton.disabled = false;
  }
}

function updateShiftTitle() {
  const title = document.getElementById('shift-entry-title');
  if (!title) return;
  if (shiftViewMode === 'correction') {
    title.textContent = 'تصحيح الوردية';
  } else if (shiftViewMode === 'history') {
    title.textContent = 'عرض الوردية';
  } else {
    title.textContent = 'إدخال وردية جديدة';
  }
}

function toggleHistoryBar(show) {
  const bar = document.getElementById('shift-history-bar');
  if (!bar) return;
  bar.style.display = show ? 'flex' : 'none';
  bar.classList.toggle('correction-mode', shiftViewMode === 'correction');

  const saveBtn = document.getElementById('save-shift-btn');
  const menuWrap = document.querySelector('.shift-menu-wrapper');
  const navButtons = bar.querySelectorAll('.shift-history-nav-btn');
  const startCorrectionBtn = document.getElementById('start-shift-correction-btn');
  const saveCorrectionBtn = document.getElementById('save-shift-correction-btn');
  const cancelCorrectionBtn = document.getElementById('cancel-shift-correction-btn');

  if (saveBtn) saveBtn.style.display = show ? 'none' : 'inline-flex';
  if (menuWrap) menuWrap.style.display = show ? 'none' : 'inline-block';

  navButtons.forEach((button) => {
    button.style.display = show && shiftViewMode !== 'correction' ? 'inline-flex' : 'none';
  });
  if (startCorrectionBtn) {
    startCorrectionBtn.style.display = show && shiftViewMode === 'history' ? 'inline-flex' : 'none';
  }
  if (saveCorrectionBtn) {
    saveCorrectionBtn.style.display = show && shiftViewMode === 'correction' ? 'inline-flex' : 'none';
  }
  if (cancelCorrectionBtn) {
    cancelCorrectionBtn.style.display = show && shiftViewMode === 'correction' ? 'inline-flex' : 'none';
  }
}

function updateHistoryChip(date, shiftNumber) {
  const chip = document.getElementById('history-chip');
  if (!chip) return;
  chip.textContent = `${convertToArabicNumerals(shiftNumber)} - ${formatDateDDMMYYYY(date)}`;
}

function closeShiftHistoryModal() {
  const modal = document.getElementById('shift-history-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function getAdjacentShift(dateStr, shiftNumber, direction) {
  const date = new Date(dateStr);
  if (direction === 'next') {
    if (shiftNumber === 1) {
      return { date: dateStr, shiftNumber: 2 };
    } else {
      date.setDate(date.getDate() + 1);
      return { date: date.toISOString().split('T')[0], shiftNumber: 1 };
    }
  } else {
    if (shiftNumber === 2) {
      return { date: dateStr, shiftNumber: 1 };
    } else {
      date.setDate(date.getDate() - 1);
      return { date: date.toISOString().split('T')[0], shiftNumber: 2 };
    }
  }
}

function isMissingIpcHandlerError(error) {
  return String(error?.message || error || '').includes('No handler registered');
}

async function findAdjacentSavedShiftFallback(date, shiftNumber, direction) {
  let cursor = getAdjacentShift(date, shiftNumber, direction);
  const maxAttempts = 1460;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const savedShift = await ipcRenderer.invoke('get-saved-shift', {
      date: cursor.date,
      shift_number: cursor.shiftNumber
    });

    if (savedShift) {
      return savedShift;
    }

    cursor = getAdjacentShift(cursor.date, cursor.shiftNumber, direction);
  }

  return null;
}

async function navigateShiftHistory(direction) {
  if (shiftViewMode !== 'history') return;
  const currentDate = currentShiftData.date || document.getElementById('shift-date')?.value;
  const currentShiftNumber = parseInt(
    currentShiftData.shiftNumber || document.getElementById('shift-number')?.value || '0',
    10
  );
  if (!currentDate || !currentShiftNumber) return;

  try {
    let adjacentShift = null;

    try {
      adjacentShift = await ipcRenderer.invoke('get-adjacent-saved-shift', {
        date: currentDate,
        shift_number: currentShiftNumber,
        direction
      });
    } catch (error) {
      if (!isMissingIpcHandlerError(error)) {
        throw error;
      }

      adjacentShift = await findAdjacentSavedShiftFallback(currentDate, currentShiftNumber, direction);
    }

    if (!adjacentShift) {
      showMessage(
        direction === 'next' ? 'لا توجد وردية محفوظة تالية' : 'لا توجد وردية محفوظة سابقة',
        'info'
      );
      return;
    }

    await loadShiftHistory(adjacentShift.date, parseInt(adjacentShift.shift_number, 10), null);
  } catch (error) {
    console.error('Error navigating shift history:', error);
    showMessage('حدث خطأ أثناء التنقل بين الورديات', 'error');
  }
}

// Shift quick menu and reset counters
function toggleShiftMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('shift-menu');
  if (!menu) return;
  const isShown = menu.classList.contains('show');
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
  if (!isShown && shiftViewMode === 'edit') {
    menu.classList.add('show');
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
});

const INLINE_RESET_ACTIVE_CLASS = 'inline-reset-active';
let fuelInlineResetMode = false;
let oilInlineResetMode = false;

function getFuelFirstShiftInputs() {
  const inputs = [];

  for (let i = 1; i <= 4; i += 1) {
    const input = document.getElementById(`fuel-diesel-first-${i}`);
    if (input) inputs.push(input);
  }

  ['gas', '95', '92', '80'].forEach((fuelKey) => {
    for (let i = 1; i <= 2; i += 1) {
      const input = document.getElementById(`fuel-${fuelKey}-first-${i}`);
      if (input) inputs.push(input);
    }
  });

  return inputs;
}

function getOilInitialInputs() {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) return [];

  return Array.from(tableBody.querySelectorAll('tr[data-oil-id]'))
    .map((row) => {
      const oilId = row.getAttribute('data-oil-id');
      return oilId ? document.getElementById(`oil-${oilId}-initial`) : null;
    })
    .filter(Boolean);
}

function lockFuelFirstShiftInputs() {
  getFuelFirstShiftInputs().forEach((input) => {
    input.readOnly = true;
    input.classList.remove(INLINE_RESET_ACTIVE_CLASS);
  });
}

function lockOilInitialInputs() {
  getOilInitialInputs().forEach((input) => {
    input.readOnly = true;
    input.classList.remove(INLINE_RESET_ACTIVE_CLASS);
  });
}

function lockResetInlineFields() {
  fuelInlineResetMode = false;
  oilInlineResetMode = false;
  lockFuelFirstShiftInputs();
  lockOilInitialInputs();
}

function getFuelTypeByFirstShiftInputId(inputId = '') {
  if (inputId.includes('fuel-diesel-first-')) return 'سولار';
  if (inputId.includes('fuel-gas-first-')) return 'غاز سيارات';
  if (inputId.includes('fuel-95-first-')) return 'بنزين ٩٥';
  if (inputId.includes('fuel-92-first-')) return 'بنزين ٩٢';
  if (inputId.includes('fuel-80-first-')) return 'بنزين ٨٠';
  return '';
}

function getFuelCounterIndexByFirstShiftInputId(inputId = '') {
  const match = inputId.match(/first-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function getOilNameByInitialInput(input) {
  if (!input) return '';
  const row = input.closest('tr[data-oil-name]');
  return row?.getAttribute('data-oil-name') || input.getAttribute('data-oil') || '';
}

function recalculateFuelAfterFirstShiftChange(inputId = '') {
  const fuelType = getFuelTypeByFirstShiftInputId(inputId);
  if (!fuelType) return;

  if (fuelType === 'سولار') {
    calculateDieselQuantity();
    return;
  }

  calculateFuelQuantity(fuelType);
}

async function handleFuelInlineResetFieldChange(input) {
  if (!input || !fuelInlineResetMode) return;

  const oldValue = input.dataset.balanceHistoryOldValue ?? '';
  const newValue = input.value;
  const fuelType = getFuelTypeByFirstShiftInputId(input.id);
  const counterIndex = getFuelCounterIndexByFirstShiftInputId(input.id);

  recalculateFuelAfterFirstShiftChange(input.id);
  input.readOnly = true;
  input.classList.remove(INLINE_RESET_ACTIVE_CLASS);
  currentShiftData.hasUnsavedChanges = true;
  setShiftDraftStatus('saving');

  const saveResult = await persistCurrentShiftDraftToDatabase();
  if (!saveResult.success) {
    setShiftDraftStatus('error');
    showToast('تعذر حفظ التغييرات في قاعدة البيانات', 'error');
    return;
  }

  currentShiftData.hasUnsavedChanges = false;
  setShiftDraftStatus('saved');
  await recordShiftBalanceChanges([{
    item_type: 'fuel',
    item_name: counterIndex ? `${fuelType} - عداد ${convertToArabicNumerals(counterIndex)}` : fuelType,
    field_name: 'أول الوردية',
    old_value: oldValue,
    new_value: newValue
  }]);
  input.dataset.balanceHistoryOldValue = input.value;
}

async function handleOilInlineResetFieldChange(input) {
  if (!input || !oilInlineResetMode) return;

  const oldValue = input.dataset.balanceHistoryOldValue ?? '';
  const newValue = input.value;
  const oilName = getOilNameByInitialInput(input);
  const match = input.id.match(/^oil-(.+)-initial$/);
  const oilId = match ? match[1] : null;
  if (!oilId) return;

  await calculateOilRow(oilId);
  input.readOnly = true;
  input.classList.remove(INLINE_RESET_ACTIVE_CLASS);
  currentShiftData.hasUnsavedChanges = true;
  setShiftDraftStatus('saving');

  const saveResult = await persistCurrentShiftDraftToDatabase();
  if (!saveResult.success) {
    setShiftDraftStatus('error');
    showToast('تعذر حفظ التغييرات في قاعدة البيانات', 'error');
    return;
  }

  currentShiftData.hasUnsavedChanges = false;
  setShiftDraftStatus('saved');
  await recordShiftBalanceChanges([{
    item_type: 'oil',
    item_name: oilName,
    field_name: 'رصيد',
    old_value: oldValue,
    new_value: newValue
  }]);
  input.dataset.balanceHistoryOldValue = input.value;
}

function openResetCountersModal() {
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
  if (shiftViewMode !== 'edit') return;

  lockResetInlineFields();
  switchShiftTab('fuel');
  fuelInlineResetMode = true;

  const inputs = getFuelFirstShiftInputs();
  inputs.forEach((input) => {
    input.dataset.balanceHistoryOldValue = input.value;
    input.readOnly = false;
    input.classList.add(INLINE_RESET_ACTIVE_CLASS);

    if (!input.dataset.inlineResetFuelBound) {
      input.addEventListener('change', () => handleFuelInlineResetFieldChange(input));
      input.addEventListener('blur', () => {
        if (!input.readOnly && fuelInlineResetMode) {
          input.readOnly = true;
          input.classList.remove(INLINE_RESET_ACTIVE_CLASS);
        }
      });
      input.dataset.inlineResetFuelBound = '1';
    }
  });

  if (inputs[0]) {
    inputs[0].focus();
  }
}

function closeResetCountersModal() {
  const modal = document.getElementById('reset-counters-modal');
  if (modal) modal.classList.remove('show');
}

function openResetOilBalancesModal() {
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
  if (shiftViewMode !== 'edit') return;

  lockResetInlineFields();
  switchShiftTab('oil');
  oilInlineResetMode = true;

  const inputs = getOilInitialInputs();
  inputs.forEach((input) => {
    input.dataset.balanceHistoryOldValue = input.value;
    input.readOnly = false;
    input.classList.add(INLINE_RESET_ACTIVE_CLASS);

    if (!input.dataset.inlineResetOilBound) {
      input.addEventListener('change', () => handleOilInlineResetFieldChange(input));
      input.addEventListener('blur', () => {
        if (!input.readOnly && oilInlineResetMode) {
          input.readOnly = true;
          input.classList.remove(INLINE_RESET_ACTIVE_CLASS);
        }
      });
      input.dataset.inlineResetOilBound = '1';
    }
  });

  if (inputs[0]) {
    inputs[0].focus();
  }
}

function closeResetOilBalancesModal() {
  const modal = document.getElementById('reset-oil-balances-modal');
  if (modal) modal.classList.remove('show');
}

function renderResetOilBalanceFields() {
  const container = document.getElementById('reset-oil-balance-fields');
  if (!container) return;

  const tableBody = document.getElementById('shift-oil-table-body');
  const rows = tableBody
    ? Array.from(tableBody.querySelectorAll('tr[data-oil-id]'))
    : [];

  if (rows.length === 0) {
    container.innerHTML = '<div style="color:#666;">لا يوجد زيت متاح لتعديل الرصيد</div>';
    return;
  }

  container.innerHTML = rows.map((row) => {
    const oilId = row.getAttribute('data-oil-id');
    const oilName = row.getAttribute('data-oil-name') || row.querySelector('td strong')?.textContent || '';
    const currentValue = document.getElementById(`oil-${oilId}-initial`)?.value || '';

    return `
      <div class="reset-counter-field reset-oil-balance-field">
        <label>${escapeHtml(oilName)}</label>
        <input type="number" class="form-control" id="reset-oil-balance-${oilId}" min="0" step="0.01" placeholder="${escapeHtml(currentValue)}">
      </div>
    `;
  }).join('');
}

async function applyResetOilBalances() {
  const msg = document.getElementById('reset-oil-balances-message');
  const tableBody = document.getElementById('shift-oil-table-body');
  const rows = tableBody ? Array.from(tableBody.querySelectorAll('tr[data-oil-id]')) : [];
  let hasChanges = false;
  const historyChanges = [];

  if (rows.length === 0) {
    if (msg) msg.textContent = 'لا توجد زيوت نشطة';
    return;
  }

  for (const row of rows) {
    const oilId = row.getAttribute('data-oil-id');
    const sourceInput = document.getElementById(`reset-oil-balance-${oilId}`);
    const targetInput = document.getElementById(`oil-${oilId}-initial`);
    const rawValue = String(sourceInput?.value ?? '').trim();
    const oilName = row.getAttribute('data-oil-name') || row.querySelector('td strong')?.textContent || '';

    if (!targetInput || rawValue === '') {
      continue;
    }

    const numericValue = parseOilQuantity(rawValue);

    if (Number.isFinite(numericValue) && numericValue >= 0) {
      const nextValue = String(numericValue);
      const oldValue = targetInput.value;
      if (targetInput.value !== nextValue) {
        hasChanges = true;
        historyChanges.push({
          item_type: 'oil',
          item_name: oilName,
          field_name: 'رصيد',
          old_value: oldValue,
          new_value: nextValue
        });
      }
      targetInput.value = nextValue;
      await calculateOilRow(oilId);
    }
  }

  if (hasChanges) {
    currentShiftData.hasUnsavedChanges = true;
    const saveResult = await persistCurrentShiftDraftToDatabase();
    if (!saveResult.success) {
      if (msg) msg.textContent = 'تعذر حفظ التغييرات في قاعدة البيانات';
      return;
    }
    await recordShiftBalanceChanges(historyChanges);
  }
  if (msg) msg.textContent = '';
  closeResetOilBalancesModal();
}

function onResetFuelChange() {
  const select = document.getElementById('reset-fuel-type');
  const fuel = select?.value || '';
  renderResetCounterFields(fuel);
}

function renderResetCounterFields(fuel) {
  const container = document.getElementById('reset-counter-fields');
  if (!container) return;

  const getCurrentCounterValue = (counterIndex) => {
    let inputId = '';

    if (fuel === 'diesel') {
      inputId = `fuel-diesel-first-${counterIndex}`;
    } else if (fuel === 'gas') {
      inputId = `fuel-gas-first-${counterIndex}`;
    } else if (fuel === '95' || fuel === '92' || fuel === '80') {
      inputId = `fuel-${fuel}-first-${counterIndex}`;
    }

    return inputId ? (document.getElementById(inputId)?.value || '') : '';
  };

  const buildInputs = (count) => {
    let html = '';
    for (let i = 1; i <= count; i++) {
      const currentValue = getCurrentCounterValue(i);
      html += `
        <div class="reset-counter-field">
          <label>${convertToArabicNumerals(i)}</label>
          <input type="number" id="reset-counter-${i}" min="0" step="0.01" placeholder="${escapeHtml(currentValue)}">
        </div>
      `;
    }
    return html;
  };

  let inputs = '';
  if (fuel === 'diesel') inputs = buildInputs(4);
  else if (fuel === 'gas') inputs = buildInputs(2);
  else if (fuel === '95' || fuel === '92' || fuel === '80') inputs = buildInputs(2);
  container.innerHTML = inputs || '<div style="color:#666;">اختر نوع الوقود لعرض العدادات</div>';
}

async function applyResetCounters() {
  const fuel = document.getElementById('reset-fuel-type')?.value;
  const msg = document.getElementById('reset-counters-message');
  const historyChanges = [];
  if (!fuel) {
    if (msg) msg.textContent = 'يرجى اختيار نوع الوقود';
    return;
  }

  const setValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  let hasChanges = false;
  const maxCounters = fuel === 'diesel' ? 4 : 2;
  for (let i = 1; i <= maxCounters; i++) {
    const rawValue = String(document.getElementById(`reset-counter-${i}`)?.value ?? '').trim();
    if (rawValue === '') continue;

    const val = parseFloat(rawValue);
    if (!Number.isFinite(val) || val < 0) {
      continue;
    }

    let targetId = '';
    if (fuel === 'diesel') {
      targetId = `fuel-diesel-first-${i}`;
    } else if (fuel === 'gas') {
      targetId = `fuel-gas-first-${i}`;
    } else if (fuel === '95' || fuel === '92' || fuel === '80') {
      targetId = `fuel-${fuel}-first-${i}`;
    }

    const targetEl = targetId ? document.getElementById(targetId) : null;
    const nextValue = String(val);
    const oldValue = targetEl?.value ?? '';
    if (targetEl?.value !== nextValue) {
      hasChanges = true;
      const fuelType = getFuelTypeByFirstShiftInputId(targetId);
      historyChanges.push({
        item_type: 'fuel',
        item_name: `${fuelType} - عداد ${convertToArabicNumerals(i)}`,
        field_name: 'أول الوردية',
        old_value: oldValue,
        new_value: nextValue
      });
    }
    setValue(targetId, nextValue);
  }

  if (hasChanges) {
    if (fuel === 'diesel') {
      calculateDieselQuantity();
    } else if (fuel === 'gas') {
      calculateFuelQuantity('غاز سيارات');
    } else if (fuel === '95') {
      calculateFuelQuantity('بنزين ٩٥');
    } else if (fuel === '92') {
      calculateFuelQuantity('بنزين ٩٢');
    } else if (fuel === '80') {
      calculateFuelQuantity('بنزين ٨٠');
    }

    currentShiftData.hasUnsavedChanges = true;
    const saveResult = await persistCurrentShiftDraftToDatabase();
    if (!saveResult.success) {
      if (msg) msg.textContent = 'تعذر حفظ التغييرات في قاعدة البيانات';
      return;
    }
    await recordShiftBalanceChanges(historyChanges);
  }
  if (msg) msg.textContent = '';
  closeResetCountersModal();
}

// Load fuel prices for a specific date and populate price fields
async function loadFuelPricesForDate(date) {
  if (!date) {
    return;
  }

  try {
    // Load prices for each fuel type
    for (const [fuelType, fuelId] of Object.entries(fuelIdMap)) {
      const price = await ipcRenderer.invoke('get-price-by-date', {
        product_name: fuelType,
        date: date
      });

      const priceInput = document.getElementById(`fuel-${fuelId}-price`);
      if (priceInput) {
        if (price !== null && price !== undefined) {
          // Temporarily remove readonly to set value
          const wasReadonly = priceInput.readOnly;
          priceInput.readOnly = false;
          priceInput.value = formatPrice(parseFloat(price));
          priceInput.readOnly = wasReadonly;
        }
      }
    }

    // Always recompute derived fuel rows from current counters and prices.
    recalculateFuelDerivedRows();
  } catch (error) {
    console.error('Error loading fuel prices for date:', error?.stack || error);
    showMessage('تعذر تحميل أسعار الوقود', 'error');
    return false;
  }

  return true;
}

// Track if shift listeners are already set up
let shiftListenersInitialized = false;
let shiftIdentifierListenersInitialized = false;
let shiftScrollControlsResizeObserver = null;
let shiftScrollControlsResizeListenerBound = false;

function getShiftScrollContainers() {
  return Array.from(document.querySelectorAll(
    '#shift-entry-screen .fuel-tables-wrapper, #shift-entry-screen .shift-oil-table-container'
  ));
}

function getShiftScrollState(scroller) {
  const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const rawScrollLeft = scroller.scrollLeft;
  const isRtl = getComputedStyle(scroller).direction === 'rtl';
  const tolerance = 2;

  if (maxScroll <= tolerance) {
    return { canScrollLeft: false, canScrollRight: false };
  }

  if (isRtl) {
    return {
      canScrollLeft: rawScrollLeft > -maxScroll + tolerance,
      canScrollRight: rawScrollLeft < -tolerance
    };
  }

  return {
    canScrollLeft: rawScrollLeft > tolerance,
    canScrollRight: rawScrollLeft < maxScroll - tolerance
  };
}

function updateShiftScrollButtons(scroller) {
  const shell = scroller.closest('.shift-scroll-control-shell');
  if (!shell) return;

  const leftButton = shell.querySelector('.shift-scroll-button.scroll-left');
  const rightButton = shell.querySelector('.shift-scroll-button.scroll-right');
  if (!leftButton || !rightButton) return;

  const isVisible = !!(scroller.offsetWidth || scroller.offsetHeight || scroller.getClientRects().length);
  const state = isVisible
    ? getShiftScrollState(scroller)
    : { canScrollLeft: false, canScrollRight: false };

  leftButton.classList.toggle('is-hidden', !state.canScrollLeft);
  leftButton.disabled = !state.canScrollLeft;
  leftButton.setAttribute('aria-hidden', state.canScrollLeft ? 'false' : 'true');

  rightButton.classList.toggle('is-hidden', !state.canScrollRight);
  rightButton.disabled = !state.canScrollRight;
  rightButton.setAttribute('aria-hidden', state.canScrollRight ? 'false' : 'true');
}

function updateShiftHorizontalScrollControls() {
  requestAnimationFrame(() => {
    getShiftScrollContainers().forEach(updateShiftScrollButtons);
  });
}

function scrollShiftContainer(scroller, direction) {
  const distance = Math.max(180, Math.floor(scroller.clientWidth * 0.72));
  const left = direction === 'left' ? -distance : distance;

  scroller.scrollBy({ left, behavior: 'smooth' });
  setTimeout(() => updateShiftScrollButtons(scroller), 260);
}

function createShiftScrollButton(scroller, direction) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `shift-scroll-button scroll-${direction} is-hidden`;
  button.dir = 'ltr';
  button.setAttribute('aria-label', direction === 'left' ? 'Scroll left' : 'Scroll right');
  button.addEventListener('click', () => scrollShiftContainer(scroller, direction));
  return button;
}

function setupShiftScrollContainer(scroller) {
  if (scroller.dataset.shiftScrollControls === '1') {
    updateShiftScrollButtons(scroller);
    return;
  }

  const parent = scroller.parentElement;
  if (!parent) return;

  const shell = document.createElement('div');
  shell.className = 'shift-scroll-control-shell';
  parent.insertBefore(shell, scroller);
  shell.appendChild(scroller);
  shell.appendChild(createShiftScrollButton(scroller, 'left'));
  shell.appendChild(createShiftScrollButton(scroller, 'right'));

  scroller.dataset.shiftScrollControls = '1';
  scroller.addEventListener('scroll', () => updateShiftScrollButtons(scroller), { passive: true });

  if (window.ResizeObserver) {
    if (!shiftScrollControlsResizeObserver) {
      shiftScrollControlsResizeObserver = new ResizeObserver(updateShiftHorizontalScrollControls);
    }
    shiftScrollControlsResizeObserver.observe(scroller);
  }

  updateShiftScrollButtons(scroller);
}

function initializeShiftHorizontalScrollControls() {
  getShiftScrollContainers().forEach(setupShiftScrollContainer);

  if (!shiftScrollControlsResizeListenerBound) {
    window.addEventListener('resize', updateShiftHorizontalScrollControls);
    shiftScrollControlsResizeListenerBound = true;
  }

  updateShiftHorizontalScrollControls();
}

function bindShiftIdentifierListeners() {
  if (shiftIdentifierListenersInitialized) return;

  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');

  if (dateInput) {
    dateInput.addEventListener('change', async () => {
      if (shiftViewMode === 'correction') {
        return;
      }
      if (shiftViewMode === 'history') {
        await handleShiftIdentifierChange();
        return;
      }
      await loadFuelPricesForDate(dateInput.value);
      await loadAllOilPrices();
      await handleShiftIdentifierChange();
    });
  }

  if (shiftNumberSelect) {
    shiftNumberSelect.addEventListener('change', handleShiftIdentifierChange);
  }

  shiftIdentifierListenersInitialized = true;
}

// Initialize shift entry when screen is shown
async function initializeShiftEntry() {
  await loadCustomerNameOptions();

  // Load active oils
  await loadActiveOils();
  lockResetInlineFields();
  setShiftDraftStatus('idle');

  // Set up event listeners for date and shift number
  const dateInput = document.getElementById('shift-date');

  // Only set up event listeners once
  if (!shiftListenersInitialized) {
    bindShiftIdentifierListeners();
    initializeShiftHorizontalScrollControls();

    document.querySelectorAll('.shift-expense-desc').forEach((input) => {
      input.addEventListener('input', () => {
        markShiftDraftDirty();
      });
    });

    document.querySelectorAll('.shift-expense-amount').forEach((input) => {
      input.addEventListener('input', () => {
        markShiftDraftDirty();
      });
    });

    const shiftEntryScreen = document.getElementById('shift-entry-screen');
    if (shiftEntryScreen) {
      shiftEntryScreen.addEventListener('beforeinput', (event) => {
        const target = event.target;
        if (!isShiftNumericInputTarget(target) || !event.data) {
          return;
        }

        if (shouldReplaceShiftNumericOnInsert(target, event.data)) {
          event.preventDefault();
          replaceShiftNumericText(target, event.data);
          return;
        }

        if (hasShiftArabicNumericText(event.data)) {
          event.preventDefault();
          insertShiftNormalizedNumericText(target, event.data);
        }
      });

      shiftEntryScreen.addEventListener('paste', (event) => {
        const target = event.target;
        const pastedText = event.clipboardData?.getData('text') || '';
        if (!isShiftNumericInputTarget(target)) {
          return;
        }

        if (shouldReplaceShiftNumericOnInsert(target, pastedText)) {
          event.preventDefault();
          replaceShiftNumericText(target, pastedText);
          return;
        }

        if (hasShiftArabicNumericText(pastedText)) {
          event.preventDefault();
          insertShiftNormalizedNumericText(target, pastedText);
        }
      });

      shiftEntryScreen.addEventListener('focusin', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }

        ensureShiftFieldVisible(target);
        clearShiftNumericFieldOnFocus(target);
        activateOilRemainingEmptyMeansZero(target);
      });

      shiftEntryScreen.addEventListener('focusout', (event) => {
        clearShiftNumericFieldPendingState(event.target);
      });

      shiftEntryScreen.addEventListener('keydown', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }

        if (
          isShiftNumericInputTarget(target) &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.key &&
          event.key.length === 1 &&
          hasShiftArabicNumericText(event.key)
        ) {
          event.preventDefault();
          if (shouldReplaceShiftNumericOnInsert(target, event.key)) {
            replaceShiftNumericText(target, event.key);
          } else {
            insertShiftNormalizedNumericText(target, event.key);
          }
          return;
        }

        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          return;
        }

        const isCustomerTableNavigation = Boolean(target.closest('.customers-table'));
        const isSummaryNavigation = Boolean(target.closest('.shift-summary-sidebar'));
        if (target.type !== 'number' && !isCustomerTableNavigation && !isSummaryNavigation) {
          return;
        }

        event.preventDefault();

        const tableNavigation = findAdjacentShiftTableField(target, event.key);
        const nextField = tableNavigation.handled
          ? tableNavigation.field
          : (() => {
              const navigationScope = getShiftNavigationScope(target, shiftEntryScreen);
              const fields = getShiftNavigableFields(navigationScope);
              return findAdjacentShiftField(target, fields, event.key);
            })();
        if (!nextField) return;

        nextField.focus();
        ensureShiftFieldVisible(nextField);
        if (nextField instanceof HTMLInputElement && (nextField.type === 'number' || nextField.type === 'text')) {
          nextField.select();
        }
      });

      shiftEntryScreen.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
          return;
        }

        if (isShiftNumericInputTarget(target)) {
          normalizeShiftNumericInputValue(target);
        }

        if (target.disabled || target.readOnly) {
          return;
        }

        if (target.id === 'shift-date' || target.id === 'shift-number') {
          return;
        }

        if (isShiftAutoFilledField(target)) {
          return;
        }

        markShiftDraftDirty();
      });

      shiftEntryScreen.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
          return;
        }

        if (target.id === 'shift-date' || target.id === 'shift-number') {
          return;
        }

        if (target.disabled || target.readOnly) {
          return;
        }

        if (isShiftAutoFilledField(target)) {
          return;
        }

        markShiftDraftDirty();
      });
    }

    // Set up unsaved data warning on page navigation
    window.addEventListener('beforeunload', (e) => {
      if (window.__skipBeforeUnloadWarning) {
        return;
      }

      if (currentShiftData.hasUnsavedChanges && currentScreen === 'shift-entry') {
        e.preventDefault();
        e.returnValue = '';
        return 'لديك تغييرات غير محفوظة. هل تريد المغادرة؟';
      }
    });

    shiftListenersInitialized = true;
  }

  initializeShiftHorizontalScrollControls();

  // Keep history view fully separated from "new shift" flow:
  // no auto-next-shift loading when opening a saved shift from history.
  if (shiftViewMode !== 'edit') {
    return;
  }

  // Load next shift automatically (calculates and pre-populates)
  await loadNextShift();

  // Load prices for the calculated date
  if (dateInput?.value) {
    await loadFuelPricesForDate(dateInput.value);
    await loadAllOilPrices();
  }
}

// ============================================
// CONNECTION AND SYNC MONITORING
// ============================================

function initializeConnectionMonitoring() {
  // Get UI elements
  const connectionIndicator = document.getElementById('connection-indicator');
  const connectionText = document.getElementById('connection-text');
  const syncStatus = document.getElementById('sync-status');
  const pendingCount = document.getElementById('pending-count');
  const lastSyncTime = document.getElementById('last-sync-time');
  const manualSyncBtn = document.getElementById('manual-sync-btn');

  // Initial status check
  updateConnectionStatus();

  // Manual sync button handler
  if (manualSyncBtn) {
    manualSyncBtn.addEventListener('click', async () => {
      manualSyncBtn.disabled = true;
      manualSyncBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="animation: rotate 1.5s linear infinite;">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
        جاري المزامنة...
      `;

      try {
        const result = await ipcRenderer.invoke('manual-sync');

        if (result.success) {
          if (result.synced > 0) {
            showMessage(`تمت مزامنة ${result.synced} عملية بنجاح`, 'success');
          } else {
            showMessage('لا توجد عمليات لمزامنتها', 'info');
          }

          if (result.failed > 0) {
            showMessage(`فشلت ${result.failed} عملية`, 'warning');
          }
        } else {
          showMessage('فشلت المزامنة: ' + result.error, 'error');
        }
      } catch (error) {
        showMessage('خطأ في المزامنة: ' + error.message, 'error');
      }

      manualSyncBtn.disabled = false;
      manualSyncBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
        مزامنة الآن
      `;
    });
  }

  // Update status every 5 seconds
  setInterval(updateConnectionStatus, 5000);
}

async function updateConnectionStatus() {
  try {
    const status = await ipcRenderer.invoke('get-connection-status');
    const syncStatus = await ipcRenderer.invoke('get-sync-status');

    // Update global flags for offline gating
    isOnline = status.online;
    offlineRestricted = status.restricted || offlineRestricted;
    applyOfflineLocks();

    const connectionIndicator = document.getElementById('connection-indicator');
    const connectionText = document.getElementById('connection-text');
    const syncStatusDiv = document.getElementById('sync-status');
    const pendingCountSpan = document.getElementById('pending-count');
    const lastSyncTimeSpan = document.getElementById('last-sync-time');
    const manualSyncBtn = document.getElementById('manual-sync-btn');

    // Update connection indicator
    if (connectionIndicator && connectionText) {
      connectionIndicator.className = 'connection-indicator';

      if (status.online) {
        connectionIndicator.classList.add('connection-online');
        connectionText.textContent = 'متصل';
      } else {
        connectionIndicator.classList.add('connection-offline');
        connectionText.textContent = 'غير متصل';
      }
    }

    // Update sync status
    if (syncStatusDiv && pendingCountSpan) {
      if (syncStatus.pending > 0) {
        syncStatusDiv.style.display = 'block';
        pendingCountSpan.textContent = syncStatus.pending;
      } else {
        syncStatusDiv.style.display = 'none';
      }
    }

    // Update last sync time
    if (lastSyncTimeSpan && status.lastSync) {
      const lastSyncDate = new Date(status.lastSync);
      const now = new Date();
      const diffMinutes = Math.floor((now - lastSyncDate) / 60000);

      if (diffMinutes < 1) {
        lastSyncTimeSpan.textContent = 'الآن';
      } else if (diffMinutes < 60) {
        lastSyncTimeSpan.textContent = `منذ ${diffMinutes} دقيقة`;
      } else {
        const diffHours = Math.floor(diffMinutes / 60);
        lastSyncTimeSpan.textContent = `منذ ${diffHours} ساعة`;
      }
    } else if (lastSyncTimeSpan) {
      lastSyncTimeSpan.textContent = '-';
    }

    // Show/hide manual sync button
    if (manualSyncBtn) {
      if (!status.online) {
        manualSyncBtn.style.display = 'none';
      } else if (syncStatus.pending > 0) {
        manualSyncBtn.style.display = 'inline-flex';
      } else {
        manualSyncBtn.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Failed to update connection status:', error);
  }
}

function applyOfflineLocks() {
  const blockedScreens = (offlineRestricted && offlineRestricted.screens) || [];
  const blockedSections = (offlineRestricted && offlineRestricted.settingsSections) || [];

  document.querySelectorAll('.nav-btn').forEach(btn => {
    const target = btn.dataset.screen;
    if (!isOnline && blockedScreens.includes(target)) {
      btn.classList.add('nav-disabled');
      btn.setAttribute('title', 'يتطلب اتصالاً بالإنترنت');
    } else {
      btn.classList.remove('nav-disabled');
      btn.removeAttribute('title');
    }
  });

  document.querySelectorAll('.settings-menu-item').forEach(item => {
    const section = item.dataset.settingsSection;
    if (!isOnline && blockedSections.includes(section)) {
      item.classList.add('nav-disabled');
      item.setAttribute('title', 'يتطلب اتصالاً بالإنترنت');
    } else {
      item.classList.remove('nav-disabled');
      item.removeAttribute('title');
    }
  });

  const salesToggleBtn = document.querySelector('.home-chart-toggle-btn[data-home-chart-mode="sales"]');
  if (salesToggleBtn) {
    if (!isOnline) {
      salesToggleBtn.disabled = true;
      salesToggleBtn.setAttribute('title', 'يتطلب اتصالاً بالإنترنت');

      if (currentHomeChartMode === HOME_CHART_MODE.SALES) {
        currentHomeChartMode = HOME_CHART_MODE.PURCHASES;
        updateHomeChartToggleUI();
        loadHomeChart();
      }
    } else {
      salesToggleBtn.disabled = false;
      salesToggleBtn.removeAttribute('title');
    }
  }
}

// IPC Event Listeners for sync events
ipcRenderer.on('offline-mode-warning', (event, data) => {
  showOfflineWarning(data.message);
});

ipcRenderer.on('connection-status', (event, status) => {
  const connectionIndicator = document.getElementById('connection-indicator');
  const connectionText = document.getElementById('connection-text');

  if (typeof status.online === 'boolean') {
    isOnline = status.online;
    applyOfflineLocks();
  }

  if (connectionIndicator && connectionText) {
    connectionIndicator.className = 'connection-indicator';

    if (status.syncing) {
      connectionIndicator.classList.add('connection-syncing');
      connectionText.textContent = 'جاري المزامنة...';
    } else if (status.online) {
      connectionIndicator.classList.add('connection-online');
      connectionText.textContent = 'متصل';
    } else {
      connectionIndicator.classList.add('connection-offline');
      connectionText.textContent = 'غير متصل';
    }
  }
});

ipcRenderer.on('sync-completed', (event, result) => {
  if (result.success) {
    if (result.synced > 0) {
      showMessage(`تمت المزامنة بنجاح: ${result.synced} عملية`, 'success');
    }
    if (result.failed > 0) {
      showMessage(`تعذر مزامنة ${result.failed} عملية. قد توجد تعارضات تحتاج مراجعة.`, 'warning');
    }
    updateConnectionStatus();
    if (currentScreen === 'profit') {
      loadProfitMonthlyData();
    }
  } else {
    showMessage('فشلت المزامنة', 'error');
  }
});

ipcRenderer.on('sync-status-update', (event, status) => {
  const syncStatusDiv = document.getElementById('sync-status');
  const pendingCountSpan = document.getElementById('pending-count');

  if (syncStatusDiv && pendingCountSpan && status.pending > 0) {
    syncStatusDiv.style.display = 'block';
    pendingCountSpan.textContent = status.pending;
  } else if (syncStatusDiv) {
    syncStatusDiv.style.display = 'none';
  }
});

function showOfflineWarning(message) {
  // Create a persistent warning banner
  const existingBanner = document.getElementById('offline-warning-banner');
  if (existingBanner) {
    return; // Don't show duplicate
  }

  const banner = document.createElement('div');
  banner.id = 'offline-warning-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #ff9800;
    color: white;
    padding: 1rem;
    text-align: center;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  `;
  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem;">
      <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
      </svg>
      <span>${message}</span>
      <button onclick="document.getElementById('offline-warning-banner').remove()"
              style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-weight: 600;">
        فهمت
      </button>
    </div>
  `;

  document.body.prepend(banner);

  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (banner.parentElement) {
      banner.remove();
    }
  }, 10000);
}
