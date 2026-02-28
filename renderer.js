const { ipcRenderer } = require('electron');

// Global variables
let charts = {};
let currentScreen = 'home';
window.__currentScreen = currentScreen;
let currentParentScreen = null;
let oilItemCounter = 0;
let navigationHistory = [];
let isOnline = true;
let offlineRestricted = {
  screens: ['report', 'charts'],
  settingsSections: ['invoices-list', 'backup']
};
const rootScreens = ['home', 'charts', 'report', 'settings'];
const HOME_CHART_MODE = {
  PURCHASES: 'purchases',
  SALES: 'sales'
};
let currentHomeChartMode = HOME_CHART_MODE.PURCHASES;
window.__skipBeforeUnloadWarning = false;
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
  'annual-inventory': 'جرد سنوي',
  'sales-summary': 'ملخص المبيعات',
  'profit': 'المكسب'
};

const settingsSectionTitles = {
  'manage-products': 'إدارة المنتجات',
  'manage-customers': 'إدارة العملاء',
  'sale-prices': 'تعديل سعر البيع',
  'add-product': 'إضافة منتج جديد',
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
      if (autoCheck === null || autoCheck === 'true') {
        ipcRenderer.send('check-for-updates-manual');
      }
    }, 3000);
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  bootstrapApp();
});

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

  // Modal click outside to close
  document.addEventListener('click', (e) => {
    const movementModal = document.getElementById('movement-modal');
    if (e.target === movementModal) {
      closeMovementModal();
    }

    const editPricesModal = document.getElementById('edit-prices-modal');
    if (e.target === editPricesModal) {
      closeEditPricesModal();
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
    case 'safe-book':
      initSafeBookFilters();
      loadSafeBookMovements();
      break;
    case 'profit':
      initializeProfitDashboard();
      break;
    case 'shift-entry':
      // Initialize customers table IMMEDIATELY to avoid visible delay
      initializeCustomersTable();
      loadCustomerNameOptions();

      // Initialize shift entry functionality async (don't wait)
      initializeShiftEntry();
      break;
    case 'depot':
      resetDepotView();
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
  // Update global parent screen tracker
  currentParentScreen = parentScreen;

  // Update breadcrumb with current screen and parent
  updateBreadcrumb(screenName, null, parentScreen);

  // Call the version without history
  showScreenWithoutHistory(screenName);

  // Reset shift view mode when leaving shift-entry
  if (screenName !== 'shift-entry' && shiftViewMode === 'history') {
    shiftViewMode = 'edit';
    disableReadOnlyMode();
    updateShiftTitle();
    toggleHistoryBar(false);
  }
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
}

async function loadTodayStats() {
  if (!isOnline) {
    const todaySalesEl = document.getElementById('today-sales');
    const todayRevenueEl = document.getElementById('today-revenue');
    const todayTransactionsEl = document.getElementById('today-transactions');
    if (todaySalesEl) todaySalesEl.textContent = '-';
    if (todayRevenueEl) todayRevenueEl.textContent = '-';
    if (todayTransactionsEl) todayTransactionsEl.textContent = '-';
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

const SAFE_BOOK_MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];
const SAFE_BOOK_DEFAULT_VISIBLE_ROWS = 15;

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
      const sales = await ipcRenderer.invoke('get-sales');
      if (!sales || !Array.isArray(sales)) {
        console.error('Invalid sales data');
        return;
      }
      chartData = sales;
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

async function loadFuelPrices() {
  try {
    const prices = await ipcRenderer.invoke('get-fuel-prices');

    // Map fuel types to their IDs
    const fuelMapping = {
      'بنزين ٨٠': '80',
      'بنزين ٩٢': '92',
      'بنزين ٩٥': '95',
      'سولار': 'diesel'
    };

    prices.forEach(price => {
      const fuelId = fuelMapping[price.fuel_type];
      if (fuelId) {
        // Update current price display
        const currentPriceElement = document.getElementById(`current-price-${fuelId}`);
        if (currentPriceElement) {
          currentPriceElement.textContent = price.price.toFixed(2);
        }
      }
    });
  } catch (error) {
    console.error('Error loading fuel prices:', error);
  }
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



async function saveFuelInvoice() {
  const actualInvoiceTotalInput = document.getElementById('actual-invoice-total');
  const parsedInvoiceTotal = parseAnnualInventoryValue(actualInvoiceTotalInput?.value || '');

  const invoiceData = {
    date: document.getElementById('fuel-invoice-date').value,
    invoice_number: document.getElementById('fuel-invoice-number').value,
    invoice_total: parsedInvoiceTotal,
    fuel_items: []
  };

  // Collect fuel items data
  document.querySelectorAll('.fuel-item').forEach(item => {
    const fuelType = item.dataset.fuel;
    const quantity = parseFloat(item.querySelector('.fuel-quantity').value.replace(',', '.')) || 0;
    const purchasePrice = parseFloat(item.querySelector('.fuel-purchase-price').value.replace(',', '.')) || 0;
    const totalValue = item.querySelector('.fuel-total').value;
    const total = parseFloat(convertFromArabicNumerals(totalValue).replace(',', '.')) || 0;

    if (quantity > 0) {
      // Calculate net quantity for gasoline
      let netQuantity = quantity;
      if (fuelType.includes('بنزين')) {
        netQuantity = quantity * 0.995;
      }

      invoiceData.fuel_items.push({
        fuel_type: fuelType,
        quantity: quantity,
        net_quantity: netQuantity,
        purchase_price: purchasePrice,
        total: total
      });
    }
  });

  if (invoiceData.fuel_items.length === 0) {
    showMessage('يرجى إدخال بيانات على الأقل لنوع واحد من الوقود', 'error');
    return;
  }

  if (invoiceData.invoice_total <= 0) {
    invoiceData.invoice_total = invoiceData.fuel_items.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
  }

  try {
    // Save the fuel invoice
    await ipcRenderer.invoke('add-fuel-invoice', invoiceData);

    // Save each fuel item as a tank movement (IN)
    for (const item of invoiceData.fuel_items) {
      await ipcRenderer.invoke('add-fuel-movement', {
        fuel_type: item.fuel_type,
        date: invoiceData.date,
        type: 'in',  // Movimento IN (ingresso nei serbatoi)
        quantity: item.quantity,
        invoice_number: invoiceData.invoice_number,
        notes: `Acquisto - Prezzo: ${item.purchase_price} جنيه/لتر - Totale: ${item.total} جنيه`
      });
    }

    showMessage('تم حفظ فاتورة الوقود بنجاح', 'success');
    resetFuelInvoiceForm();
    loadTodayStats();

    // Update home chart if currently on home screen
    if (currentScreen === 'home') {
      loadHomeChart();
    }
  } catch (error) {
    showMessage('حدث خطأ أثناء حفظ فاتورة الوقود', 'error');
    console.error('Error saving fuel invoice:', error);
  }
}

function resetFuelInvoiceForm() {
  // Reset all fuel items
  document.querySelectorAll('.fuel-item').forEach(item => {
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

async function updateFuelPrice(fuelType) {
  const inputId = `price-${fuelType.replace(/\s+/g, '-').toLowerCase()}`;
  const price = parseFloat(document.getElementById(inputId).value.replace(',', '.'));

  if (isNaN(price) || price <= 0) {
    showMessage('يرجى إدخال سعر صحيح', 'error');
    return;
  }

  try {
    await ipcRenderer.invoke('update-fuel-price', { fuel_type: fuelType, price });
    showMessage('تم تحديث السعر بنجاح', 'success');
  } catch (error) {
    showMessage('حدث خطأ أثناء تحديث السعر', 'error');
    console.error('Error updating fuel price:', error);
  }
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

  if (charts.fuelSales) {
    charts.fuelSales.destroy();
  }

  charts.fuelSales = new Chart(ctx, {
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

  charts.monthlyRevenue = new Chart(ctx, {
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

  if (charts.paymentMethods) {
    charts.paymentMethods.destroy();
  }

  // Count payment methods
  const paymentCounts = {};
  sales.forEach(sale => {
    paymentCounts[sale.payment_method] = (paymentCounts[sale.payment_method] || 0) + 1;
  });

  charts.paymentMethods = new Chart(ctx, {
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

  if (charts.monthlyFuelSales) {
    charts.monthlyFuelSales.destroy();
  }

  const chartTitle = mode === HOME_CHART_MODE.SALES
    ? 'كميات المبيعات الشهرية حسب نوع الوقود'
    : 'كميات المشتريات الشهرية حسب نوع الوقود';

  // Group entries by month and fuel type
  const monthlyData = {};
  const fuelTypes = ['بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'سولار'];
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'];

  // Initialize data structure
  entries.forEach(entry => {
    if (!entry || !entry.date || !entry.fuel_type) return;

    const month = entry.date.substring(0, 7); // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = {};
      fuelTypes.forEach(type => {
        monthlyData[month][type] = 0;
      });
    }

    if (Object.prototype.hasOwnProperty.call(monthlyData[month], entry.fuel_type)) {
      monthlyData[month][entry.fuel_type] += parseFloat(entry.quantity) || 0;
    }
  });

  // Sort months
  const months = Object.keys(monthlyData).sort();
  
  // Create datasets for each fuel type
  const datasets = fuelTypes.map((fuelType, index) => ({
    label: fuelType,
    data: months.map(month => monthlyData[month][fuelType]),
    backgroundColor: colors[index],
    borderColor: colors[index],
    borderWidth: 2,
    fill: false
  }));

  charts.monthlyFuelSales = new Chart(ctx, {
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

function showInvoiceType(type) {
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
  } else if (type === 'oil') {
    document.getElementById('oil-invoice-form').classList.add('active');
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
function showDepotScreen() {
  showScreen('depot', 'home');
}

function selectOilType(oilType) {
  // Remove selected class from all items (sidebar e modal)
  document.querySelectorAll('.oil-item, .oil-item-modal').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to all items with this oil type (sidebar e modal)
  document.querySelectorAll(`[data-oil="${oilType}"]`).forEach(item => {
    item.classList.add('selected');
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
  resultsSection.style.display = 'block';

  // Scroll to results section su mobile
  if (window.innerWidth <= 768) {
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
    const movements = await ipcRenderer.invoke('get-oil-movements', oilType);
    const currentStock = await ipcRenderer.invoke('get-current-oil-stock', oilType);

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

  const tableHTML = `
    <table class="movements-table-modern">
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>نوع الحركة</th>
          <th>الكمية</th>
          <th>رقم الفاتورة</th>
        </tr>
      </thead>
      <tbody>
        ${movements.map(movement => `
          <tr class="table-row ${movement.type === 'in' ? 'row-in' : 'row-out'}">
            <td class="date-cell">${formatDateDDMMYYYY(movement.date)}</td>
            <td class="type-cell">
              <span class="type-badge ${movement.type === 'in' ? 'badge-in' : 'badge-out'}">
                ${movement.type === 'in' ? 'دخول' : 'خروج'}
              </span>
            </td>
            <td class="quantity-cell">
              <span class="quantity-value ${movement.type === 'in' ? 'positive' : 'negative'}">
                ${convertToArabicNumerals(movement.quantity)}
              </span>
            </td>
            <td class="invoice-cell">${movement.invoice_number || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = tableHTML;
}

function showAddMovementModal() {
  const selectedOilItem = document.querySelector('.oil-item.selected');
  const oilType = selectedOilItem ? selectedOilItem.dataset.oil : '';
  
  if (!oilType) {
    showMessage('يرجى اختيار نوع الزيت أولاً', 'error');
    return;
  }
  
  // Set today's date as default
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

async function saveMovement() {
  const selectedOilItem = document.querySelector('.oil-item.selected');
  const oilType = selectedOilItem ? selectedOilItem.dataset.oil : '';
  const date = document.getElementById('movement-date').value;
  const type = document.getElementById('movement-type').value;
  const quantity = parseInt(document.getElementById('movement-quantity').value);
  const invoiceNumber = document.getElementById('movement-invoice').value;
  
  // Basic validation
  if (!oilType || !date || !type || !quantity) {
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
    loadOilMovements(oilType); // Reload the movements for the current oil type
  } catch (error) {
    console.error('Error saving movement:', error);
    showMessage('حدث خطأ أثناء حفظ الحركة', 'error');
  }
}

// Edit Prices Modal Functions
async function openEditPricesModal() {
  const modal = document.getElementById('edit-prices-modal');
  const dateInput = document.getElementById('modal-price-start-date');

  // Set today's date as default
  dateInput.value = new Date().toISOString().split('T')[0];

  // Load current prices
  await loadModalCurrentPrices();
  await loadModalOilPrices();

  // Show fuel prices by default
  switchModalPriceType('fuel');

  modal.classList.add('show');
}

function closeEditPricesModal() {
  const modal = document.getElementById('edit-prices-modal');
  modal.classList.remove('show');

  // Clear all input fields
  document.getElementById('modal-price-80').value = '';
  document.getElementById('modal-price-92').value = '';
  document.getElementById('modal-price-95').value = '';
  document.getElementById('modal-price-diesel').value = '';

  const oilTableBody = document.getElementById('modal-oil-prices-table-body');
  const oilInputs = oilTableBody.querySelectorAll('input[type="number"]');
  oilInputs.forEach(input => input.value = '');
}

async function loadModalCurrentPrices() {
  try {
    const fuels = await ipcRenderer.invoke('get-fuel-prices');

    fuels.forEach(fuel => {
      let elementId = '';
      if (fuel.fuel_type === 'بنزين ٨٠') elementId = 'modal-current-price-80';
      else if (fuel.fuel_type === 'بنزين ٩٢') elementId = 'modal-current-price-92';
      else if (fuel.fuel_type === 'بنزين ٩٥') elementId = 'modal-current-price-95';
      else if (fuel.fuel_type === 'سولار') elementId = 'modal-current-price-diesel';

      if (elementId) {
        const element = document.getElementById(elementId);
        if (element) {
          element.textContent = formatPrice(parseFloat(fuel.price) || 0);
        }
      }
    });
  } catch (error) {
    console.error('Error loading current fuel prices:', error);
  }
}

async function loadModalOilPrices() {
  try {
    const oils = await ipcRenderer.invoke('get-oil-prices');
    const tableBody = document.getElementById('modal-oil-prices-table-body');
    tableBody.innerHTML = '';

    oils.forEach((oil, index) => {
      const row = document.createElement('tr');
      row.setAttribute('data-product', oil.oil_type);
      row.innerHTML = `
        <td>${index + 1}</td>
        <td class="product-name">${oil.oil_type}</td>
        <td style="text-align: center;"><span class="current-price">${formatPrice(parseFloat(oil.price) || 0)}</span></td>
        <td style="text-align: center;">
          <input type="number"
                 id="modal-price-oil-${oil.id}"
                 data-oil-id="${oil.id}"
                 data-oil-name="${oil.oil_type}"
                 step="0.01"
                 class="table-price-input"
                 placeholder="0.00">
        </td>
      `;
      tableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading oil prices:', error);
  }
}

function switchModalPriceType(type) {
  // Update tabs
  const tabs = document.querySelectorAll('#edit-prices-modal .price-type-tab');
  tabs.forEach(tab => {
    if (tab.getAttribute('data-price-type') === type) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update sections
  const fuelSection = document.getElementById('modal-fuel-prices-section');
  const oilSection = document.getElementById('modal-oil-prices-section');

  if (type === 'fuel') {
    fuelSection.classList.add('active');
    oilSection.classList.remove('active');
  } else {
    fuelSection.classList.remove('active');
    oilSection.classList.add('active');
  }
}

async function saveModalPrices() {
  const startDate = document.getElementById('modal-price-start-date').value;

  if (!startDate) {
    showToast('يرجى تحديد تاريخ بدء الأسعار', 'error');
    return;
  }

  const updates = [];

  // Collect fuel prices
  const fuelMapping = {
    'modal-price-80': 'بنزين ٨٠',
    'modal-price-92': 'بنزين ٩٢',
    'modal-price-95': 'بنزين ٩٥',
    'modal-price-diesel': 'سولار'
  };

  for (const [inputId, productName] of Object.entries(fuelMapping)) {
    const input = document.getElementById(inputId);
    if (input && input.value) {
      const price = parseFloat(input.value);
      if (price > 0) {
        updates.push({
          product_name: productName,
          price: price,
          start_date: startDate,
          type: 'fuel'
        });
      }
    }
  }

  // Collect oil prices
  const oilInputs = document.querySelectorAll('#modal-oil-prices-table-body input[type="number"]');
  oilInputs.forEach(input => {
    if (input.value) {
      const price = parseFloat(input.value);
      const oilName = input.getAttribute('data-oil-name');
      if (price > 0 && oilName) {
        updates.push({
          product_name: oilName,
          price: price,
          start_date: startDate,
          type: 'oil'
        });
      }
    }
  });

  if (updates.length === 0) {
    showToast('يرجى إدخال سعر واحد على الأقل', 'error');
    return;
  }

  try {
    for (const update of updates) {
      if (update.type === 'fuel') {
        await ipcRenderer.invoke('update-fuel-price', {
          product_name: update.product_name,
          price: update.price,
          start_date: update.start_date
        });
      } else {
        await ipcRenderer.invoke('update-oil-price', {
          oil_type: update.product_name,
          price: update.price
        });
      }
    }

    showToast('تم تحديث الأسعار بنجاح', 'success');
    closeEditPricesModal();

    // Reload prices if on relevant screens
    await loadModalCurrentPrices();
    await loadModalOilPrices();
  } catch (error) {
    console.error('Error saving prices:', error);
    showToast('حدث خطأ أثناء حفظ الأسعار', 'error');
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
    const quantity = parseFloat(item.querySelector('.oil-quantity').value) || 0;
    const purchasePrice = parseFloat(item.querySelector('.oil-purchase-price').value) || 0;
    const iva = parseFloat(item.querySelector('.oil-iva').value) || 0;
    const totalPurchaseInput = item.querySelector('.oil-total-purchase');
    const totalPurchase = parseFloat(totalPurchaseInput.dataset.numericValue) || 0;

    if (oilType && quantity > 0) {
      invoiceData.oil_items.push({
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

// Funzioni per gestire le righe dinamiche degli oli
function addOilItem() {
  const oilItemsList = document.getElementById('oil-items-list');
  const itemId = `oil-item-${oilItemCounter}`;

  const oilItemHTML = `
    <div class="oil-item" id="${itemId}" data-oil="">
      <div class="oil-row">
        <div class="oil-input-group oil-type-group">
          <select class="oil-type-select" onchange="updateOilType('${itemId}', this.value)">
            <option value="">اختر نوع الزيت</option>
            ${oilTypes.map(type => `<option value="${type}">${type}</option>`).join('')}
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
          <button type="button" class="btn-delete" onclick="removeOilItem('${itemId}')" title="حذف">
            ✕
          </button>
        </div>
      </div>
    </div>
  `;

  oilItemsList.insertAdjacentHTML('beforeend', oilItemHTML);
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
    item.dataset.oil = oilType;
  }
}

// Oil Prices Functions
async function loadOilPrices() {
  try {
    const prices = await ipcRenderer.invoke('get-oil-prices');
    const tbody = document.getElementById('oil-prices-table-body');

    if (!tbody) return;

    tbody.innerHTML = '';

    // Create a table row for each oil type
    let rowNumber = 1;
    for (const oilType of oilTypes) {
      const priceData = prices.find(p => p.oil_type === oilType);
      const currentPrice = priceData ? priceData.price.toFixed(2) : '—';
      const oilId = oilType.replace(/\s+/g, '-').replace(/\//g, '-');

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${rowNumber}</td>
        <td class="product-name">${oilType}</td>
        <td><span class="current-price" id="current-oil-${oilId}">${currentPrice}</span></td>
        <td>
          <input type="number" id="oil-price-${oilId}"
                 step="0.01" class="table-price-input" placeholder="0.00">
        </td>
      `;
      tbody.appendChild(row);
      rowNumber++;
    }

    // Initialize price date
    initializePriceDate();
  } catch (error) {
    console.error('Error loading oil prices:', error);
  }
}

// Switch between fuel and oil price tabs
function switchPriceType(type) {
  // Update tab buttons
  document.querySelectorAll('.price-type-tab').forEach(tab => {
    if (tab.dataset.priceType === type) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update sections
  document.querySelectorAll('.price-type-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeSection = document.getElementById(`${type}-prices-section`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Load data when switching to oil prices
  if (type === 'oil') {
    loadOilPrices();
  }
}

// Set default date to today
function initializePriceDate() {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('price-start-date');
  if (dateInput && !dateInput.value) dateInput.value = today;
}

// Reset all price inputs
function resetPriceInputs() {
  // Reset fuel price inputs
  const fuelPriceIds = ['price-80', 'price-92', 'price-95', 'price-diesel'];
  fuelPriceIds.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  // Reset oil price inputs
  document.querySelectorAll('.table-price-input').forEach(input => {
    input.value = '';
  });
}

// Save all prices at once
async function saveAllPrices() {
  const startDate = document.getElementById('price-start-date').value;

  if (!startDate) {
    showMessage('يرجى تحديد تاريخ بدء سريان الأسعار', 'error');
    return;
  }

  try {
    const prices = [];

    // Collect fuel prices with correct ID mapping
    const fuelPrices = [
      { type: 'بنزين ٨٠', id: 'price-80' },
      { type: 'بنزين ٩٢', id: 'price-92' },
      { type: 'بنزين ٩٥', id: 'price-95' },
      { type: 'سولار', id: 'price-diesel' }
    ];

    for (const fuel of fuelPrices) {
      const input = document.getElementById(fuel.id);
      if (input) {
        const inputValue = input.value;

        // Skip empty or whitespace-only values
        if (inputValue && inputValue.trim() !== '') {
          const price = parseFloat(inputValue);
          if (!isNaN(price) && price > 0) {
            prices.push({ product_type: 'fuel', product_name: fuel.type, price, start_date: startDate });
          }
        }
      }
    }

    // Collect oil prices
    for (const oilType of oilTypes) {
      const inputId = `oil-price-${oilType.replace(/\s+/g, '-').replace(/\//g, '-')}`;
      const input = document.getElementById(inputId);
      if (input) {
        const inputValue = input.value;

        // Skip empty or whitespace-only values
        if (inputValue && inputValue.trim() !== '') {
          const price = parseFloat(inputValue);
          if (!isNaN(price) && price > 0) {
            prices.push({ product_type: 'oil', product_name: oilType, price, start_date: startDate });
          }
        }
      }
    }

    if (prices.length === 0) {
      showMessage('لم يتم إدخال أي أسعار', 'error');
      return;
    }

    await ipcRenderer.invoke('save-all-prices', prices);
    showMessage('تم حفظ الأسعار بنجاح', 'success');

    // Reset all price inputs
    resetPriceInputs();

    // Reload prices to show current values
    loadFuelPrices();
    loadOilPrices();
    loadManageProducts();

    // Navigate back to manage products page
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
      vatField.style.display = 'block';
    } else {
      vatField.style.display = 'none';
      const vatInput = document.getElementById('new-product-vat');
      if (vatInput) {
        vatInput.value = '';
      }
    }
  }
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
    } else if (type === 'oil') {
      await ipcRenderer.invoke('add-oil-price', { oil_type: name, price, vat });
    }

    showMessage('تم إضافة المنتج بنجاح', 'success');

    // Clear form
    nameInput.value = '';
    typeInput.value = '';
    priceInput.value = '';
    if (vatInput) {
      vatInput.value = '';
    }
    toggleVatField(); // Hide VAT field

    // Reload price tables
    loadFuelPrices();
    loadOilPrices();
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
  const totalSection = document.getElementById('shift-total-section');

  // Remove active from all
  if (fuelSection) fuelSection.classList.remove('active');
  if (oilSection) oilSection.classList.remove('active');
  if (totalSection) totalSection.classList.remove('active');

  // Add active to selected
  if (tab === 'fuel' && fuelSection) {
    fuelSection.classList.add('active');
  } else if (tab === 'oil' && oilSection) {
    oilSection.classList.add('active');
  } else if (tab === 'total' && totalSection) {
    totalSection.classList.add('active');
    // Update totals when switching to totals tab
    updateTotalsPage();
  }
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
    if (sectionName === 'sale-prices') {
      loadFuelPrices();
      loadOilPrices();
    } else if (sectionName === 'manage-products') {
      loadManageProducts();
    } else if (sectionName === 'manage-customers') {
      loadCustomersSettings();
    } else if (sectionName === 'general') {
      loadGeneralSettings();
      loadUpdateSettings();
      updateUpdatesPageUI(); // Show install button if update is ready
    } else if (sectionName === 'invoices-list') {
      loadInvoicesList();
    }
  }
}

// Navigate to Edit Prices section - Open modal instead
function navigateToEditPrices() {
  openEditPricesModal();
}

// Navigate to Add Product section
function navigateToAddProduct() {
  // Add to navigation history
  pushNavigation({ screen: 'settings', section: 'add-product' });

  // Show the section
  showSettingsSectionWithoutHistory('add-product');
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
    const fuelPrices = await ipcRenderer.invoke('get-fuel-prices');
    console.log('Loaded fuel prices:', fuelPrices);
    const fuelTableBody = document.getElementById('manage-fuel-table-body');

    if (fuelTableBody) {
      fuelTableBody.innerHTML = '';

      // Remove duplicates - keep only the latest version of each product
      const uniqueFuels = {};
      fuelPrices.forEach(product => {
        if (!uniqueFuels[product.fuel_type] ||
            new Date(product.effective_date) > new Date(uniqueFuels[product.fuel_type].effective_date)) {
          uniqueFuels[product.fuel_type] = product;
        }
      });

      Object.values(uniqueFuels).forEach((product, index) => {
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

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-icon';
        editBtn.title = 'تعديل الاسم';
        editBtn.onclick = () => editProductName('fuel', product.fuel_type, product.id);
        editBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
          </svg>
        `;

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon btn-icon-danger';
        deleteBtn.title = 'حذف المنتج';
        deleteBtn.style.marginLeft = '0.5rem';
        deleteBtn.onclick = () => deleteFuelProduct(product.fuel_type);
        deleteBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
          </svg>
        `;

        td4.appendChild(editBtn);
        td4.appendChild(deleteBtn);

        row.appendChild(td1);
        row.appendChild(td2);
        row.appendChild(td3);
        row.appendChild(td4);
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
        editBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
          </svg>
        `;

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon btn-icon-danger';
        deleteBtn.title = 'حذف المنتج';
        deleteBtn.style.marginLeft = '0.5rem';
        deleteBtn.onclick = () => deleteOilProduct(product.oil_type);
        deleteBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
          </svg>
        `;

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

    showMessage('تم تحديث اسم المنتج بنجاح', 'success');
    closeEditProductModal();

    // Reload tables
    loadManageProducts();
    loadFuelPrices();
    loadOilPrices();
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
function showPriceHistory() {
  const modal = document.getElementById('price-history-modal');
  if (modal) {
    // Populate oil filter
    const oilFilterGroup = document.getElementById('oil-filter-group');
    if (oilFilterGroup && oilFilterGroup.children.length === 0) {
      for (const oilType of oilTypes) {
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
    const history = await ipcRenderer.invoke('get-price-history', filter);
    const container = document.getElementById('price-history-content');

    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">لا يوجد سجل للأسعار</p>';
      return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse;">';
    html += '<thead><tr>';
    html += '<th style="padding: 0.75rem; text-align: right; border-bottom: 2px solid #c4291d; background: #fff5f4;">المنتج</th>';
    html += '<th style="padding: 0.75rem; text-align: right; border-bottom: 2px solid #c4291d; background: #fff5f4;">النوع</th>';
    html += '<th style="padding: 0.75rem; text-align: right; border-bottom: 2px solid #c4291d; background: #fff5f4;">السعر</th>';
    html += '<th style="padding: 0.75rem; text-align: right; border-bottom: 2px solid #c4291d; background: #fff5f4;">تاريخ البدء</th>';
    html += '<th style="padding: 0.75rem; text-align: right; border-bottom: 2px solid #c4291d; background: #fff5f4;">تاريخ التسجيل</th>';
    html += '</tr></thead><tbody>';

    for (const item of history) {
      html += '<tr style="border-bottom: 1px solid #e9ecef;">';
      html += `<td style="padding: 0.75rem;">${item.product_name}</td>`;
      html += `<td style="padding: 0.75rem;">${item.product_type === 'fuel' ? 'وقود' : 'زيت'}</td>`;
      html += `<td style="padding: 0.75rem; font-weight: 600;">${item.price.toFixed(2)} جنيه</td>`;
      html += `<td style="padding: 0.75rem;">${item.start_date}</td>`;
      html += `<td style="padding: 0.75rem; color: #666; font-size: 0.9rem;">${new Date(item.created_at).toLocaleString('ar-EG')}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (error) {
    console.error('Error loading price history:', error);
    showMessage('حدث خطأ أثناء تحميل السجل', 'error');
  }
}

async function updateOilPrice(oilType) {
  const inputId = `oil-price-${oilType.replace(/\s+/g, '-').replace(/\//g, '-')}`;
  const price = parseFloat(document.getElementById(inputId).value.replace(',', '.'));

  if (isNaN(price) || price < 0) {
    showMessage('يرجى إدخال سعر صحيح', 'error');
    return;
  }

  try {
    await ipcRenderer.invoke('update-oil-price', { oil_type: oilType, price });
    showMessage('تم تحديث السعر بنجاح', 'success');
  } catch (error) {
    showMessage('حدث خطأ أثناء تحديث السعر', 'error');
    console.error('Error updating oil price:', error);
  }
}

// General Settings Functions
async function saveGeneralSettings() {
  const stationName = document.getElementById('station-name').value;
  const stationAddress = document.getElementById('station-address').value;
  const stationPhone = document.getElementById('station-phone').value;

  try {
    await ipcRenderer.invoke('save-general-settings', {
      stationName,
      stationAddress,
      stationPhone
    });
    showMessage('تم حفظ الإعدادات بنجاح', 'success');
  } catch (error) {
    showMessage('حدث خطأ أثناء حفظ الإعدادات', 'error');
    console.error('Error saving general settings:', error);
  }
}

async function loadGeneralSettings() {
  try {
    const settings = await ipcRenderer.invoke('get-general-settings');
    if (settings) {
      document.getElementById('station-name').value = settings.stationName || 'محطة بنزين سمنود - الجمعية التعاونية للبترول';
      document.getElementById('station-address').value = settings.stationAddress || '';
      document.getElementById('station-phone').value = settings.stationPhone || '';
    }
  } catch (error) {
    console.error('Error loading general settings:', error);
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
  if (!isOnline) {
    showMessage('عرض قائمة الفواتير يتطلب اتصالاً بالإنترنت', 'warning');
    return;
  }
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
          items: []
        };
      }
      fuelInvoicesMap[inv.invoice_number].items.push(inv);
    });

    // Calculate totals for fuel invoices (sum of all items)
    Object.values(fuelInvoicesMap).forEach(invoice => {
      invoice.total = invoice.items.reduce((sum, item) => sum + (item.total || 0), 0);
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
      <td>${inv.date}</td>
      <td>${inv.invoice_number}</td>
      <td>${inv.type === 'fuel' ? 'وقود' : 'زيوت'}</td>
      <td>${formatArabicNumber(inv.total)} جنيه</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="showInvoiceDetails('${inv.type}', '${inv.invoice_number}')">
          تفاصيل
        </button>
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
        <td>${formatArabicNumber(item.purchase_price)} جنيه</td>
        <td>${formatArabicNumber(item.total)} جنيه</td>
      `;
    } else {
      html += `
        <td>${item.oil_type}</td>
        <td>${formatArabicNumber(item.quantity)}</td>
        <td>${formatArabicNumber(item.purchase_price)} جنيه</td>
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
    const itemsSubtotal = invoice.items.reduce((sum, item) => sum + (item.total || 0), 0);
    const invoiceTotal = invoice.total || 0;
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
  hasUnsavedChanges: false
};
let shiftViewMode = 'edit'; // 'edit' | 'history'
let salesSummaryCache = { sales: [], months: [], products: [] };
let expandedSalesMonth = null;
const SALES_SUMMARY_ORDER_KEY = 'sales-summary-order';
const PROFIT_MANUAL_FIELDS = [
  'oil_total',
  'bonuses',
  'commission_diff',
  'deposit_tax',
  'bonus_tax'
];
let profitRowsCache = [];
let profitDefaultRange = null;
let profitCustomRowsCache = [];
let profitCustomValuesMap = new Map();
const PROFIT_TABLE_ROWS = [
  { key: 'fuel_diesel', label: 'سولار', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'fuel_80', label: 'بنزين ٨٠', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'fuel_92', label: 'بنزين ٩٢', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'fuel_95', label: 'بنزين ٩٥', type: 'auto', section: 'revenue', cellClass: 'positive-col auto-col' },
  { key: 'oil_total', label: 'الزيوت', type: 'manual-fixed', section: 'revenue', cellClass: 'positive-col' },
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
    const [sales, fuelProducts, oilProducts] = await Promise.all([
      ipcRenderer.invoke('get-sales-report', { startDate: startDateStr, endDate: endDateStr }),
      ipcRenderer.invoke('get-fuel-prices'),
      ipcRenderer.invoke('get-oil-prices')
    ]);

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
      const month = sale.date?.slice(0, 7) || '';
      const key = `${sale.fuel_type}__${month}`;
      if (!map.has(key)) {
        map.set(key, { product: sale.fuel_type, month, qty: 0, revenue: 0 });
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
    const product = sale.fuel_type || 'غير معروف';
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

  const filterBtn = document.getElementById('profit-filter-btn');
  if (filterBtn && !filterBtn.dataset.bound) {
    filterBtn.addEventListener('click', () => {
      loadProfitMonthlyData();
    });
    filterBtn.dataset.bound = 'true';
  }

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
      loadProfitMonthlyData();
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
    await loadProfitMonthlyData();
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

async function loadProfitMonthlyData() {
  const range = getProfitFiltersRange();
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

// Calculate fuel quantity sold (first shift - last shift counter) - 2 counters for gasoline
function calculateFuelQuantity(fuelType) {
  const fuelId = fuelIdMap[fuelType];
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

  // Mark as unsaved
  currentShiftData.hasUnsavedChanges = true;

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

  // Mark as unsaved
  currentShiftData.hasUnsavedChanges = true;

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

// Load active oils and populate oil table
async function loadActiveOils() {
  try {
    const oils = await ipcRenderer.invoke('get-oil-prices');

    // Filter only active oils
    let activeOils = oils.filter(oil => oil.is_active === 1 || oil.is_active === true);

    // Load saved order from localStorage
    const savedOrder = localStorage.getItem('oils-order');
    if (savedOrder) {
      try {
        const orderArray = JSON.parse(savedOrder);
        // Sort activeOils according to saved order
        activeOils = activeOils.sort((a, b) => {
          const indexA = orderArray.indexOf(a.oil_type);
          const indexB = orderArray.indexOf(b.oil_type);
          // If not in saved order, put at end
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;
          return indexA - indexB;
        });
      } catch (e) {
        console.error('Error parsing saved oil order:', e);
      }
    }

    const tableBody = document.getElementById('shift-oil-table-body');
    if (!tableBody) return;

    if (activeOils.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: #999;">
            لا توجد زيوت نشطة
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = '';

    activeOils.forEach(oil => {
      const oilId = oil.id || oil.oil_type.replace(/\s+/g, '-').toLowerCase();
      const row = document.createElement('tr');
      row.setAttribute('data-oil-id', oilId);
      row.setAttribute('data-oil-name', oil.oil_type);
      row.setAttribute('draggable', 'true');
      row.classList.add('draggable-oil-row');
      row.innerHTML = `
        <td class="oil-name-cell">
          <span class="drag-handle" title="اسحب لإعادة الترتيب">⋮⋮</span>
          <strong>${oil.oil_type}</strong>
        </td>
        <td>
          <input type="number" step="1" class="form-control shift-oil-input"
                 id="oil-${oilId}-initial" data-oil="${oil.oil_type}" data-field="initial"
                 oninput="calculateOilRow('${oilId}')">
        </td>
        <td>
          <input type="number" step="1" class="form-control shift-oil-input"
                 id="oil-${oilId}-added" data-oil="${oil.oil_type}" data-field="added"
                 oninput="calculateOilRow('${oilId}')">
        </td>
        <td>
          <input type="number" step="1" class="form-control auto-calculated"
                 id="oil-${oilId}-total" readonly>
        </td>
        <td>
          <input type="number" step="1" class="form-control auto-calculated"
                 id="oil-${oilId}-sold" readonly>
        </td>
        <td>
          <input type="number" step="1" class="form-control shift-oil-input"
                 id="oil-${oilId}-remaining" data-oil="${oil.oil_type}" data-field="remaining"
                 oninput="calculateOilRow('${oilId}')">
        </td>
        <td class="spacer-cell"></td>
        <td>
          <input type="number" step="1" class="form-control shift-oil-input"
                 id="oil-${oilId}-open" data-oil="${oil.oil_type}" data-field="open"
                 oninput="calculateOilRow('${oilId}')">
        </td>
        <td>
          <input type="number" step="1" class="form-control shift-oil-input"
                 id="oil-${oilId}-customers" data-oil="${oil.oil_type}" data-field="customers"
                 oninput="calculateOilRow('${oilId}')">
        </td>
        <td>
          <input type="number" step="0.01" class="form-control auto-calculated"
                 id="oil-${oilId}-price" readonly>
        </td>
        <td>
          <input type="number" step="0.01" class="form-control auto-calculated"
                 id="oil-${oilId}-revenue" readonly>
        </td>
      `;
      tableBody.appendChild(row);
    });

    // Enable drag and drop
    enableOilRowDragDrop();

    // Initialize prices for all oils
    await loadAllOilPrices();
  } catch (error) {
    console.error('Error loading active oils:', error);
    alert('خطأ في تحميل الزيوت النشطة');
  }
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
      // Save new order
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

// Save oils order to localStorage
function saveOilsOrder() {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) return;

  const rows = tableBody.querySelectorAll('.draggable-oil-row');
  const order = Array.from(rows).map(row => row.getAttribute('data-oil-name'));

  localStorage.setItem('oils-order', JSON.stringify(order));
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

  const initial = parseInt(initialInput.value) || 0;
  const added = parseInt(addedInput.value) || 0;
  const remaining = parseInt(remainingInput.value) || 0;
  const open = parseInt(openInput?.value) || 0;
  const customers = parseInt(customersInput?.value) || 0;

  // Calculate total = initial + added
  const total = initial + added;
  totalInput.value = total;

  // Validation: remaining must be <= total
  if (remaining > total && remaining > 0) {
    remainingInput.classList.add('input-error');
    alert('خطأ: الكمية المتبقية يجب أن تكون أقل من أو تساوي الإجمالي المتاح');
    soldInput.value = '';
    return;
  } else {
    remainingInput.classList.remove('input-error');
  }

  // Calculate sold = total - remaining
  const sold = total - remaining;
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
      const revenueQuantity = sold - customers - open;
      const revenue = revenueQuantity * price;
      if (revenueInput) {
        revenueInput.value = revenue >= 0 ? formatPrice(revenue) : '0';
      }
    } catch (error) {
      console.error('Error getting oil price:', error);
      priceInput.value = '0';
      if (revenueInput) revenueInput.value = '0';
    }
  }

  // Mark as unsaved
  currentShiftData.hasUnsavedChanges = true;

  // Recalculate oil total
  calculateOilTotal();
}

// Get oil price by date
async function getOilPriceByDate(oilName, date) {
  try {
    console.log('getOilPriceByDate: Looking for oil:', oilName, 'on date:', date);
    const oils = await ipcRenderer.invoke('get-oil-prices');
    console.log('getOilPriceByDate: Received oils from DB:', oils);
    console.log('getOilPriceByDate: Number of oils:', oils.length);

    const oil = oils.find(o => o.oil_type === oilName);
    console.log('getOilPriceByDate: Found oil:', oil);

    if (oil) {
      console.log('getOilPriceByDate: Oil price:', oil.price, 'type:', typeof oil.price);
      const price = parseFloat(oil.price) || 0;
      console.log('getOilPriceByDate: Parsed price:', price);
      return price;
    } else {
      console.log('getOilPriceByDate: Oil not found for name:', oilName);
      return 0;
    }
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

// Load oil prices for all oils in the table
async function loadAllOilPrices() {
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) {
    return;
  }

  const dateInput = document.getElementById('shift-date');
  const shiftDate = dateInput ? dateInput.value : getTodayDate();

  // Fetch all oils from database ONCE
  try {
    const oils = await ipcRenderer.invoke('get-oil-prices');
    const rows = tableBody.querySelectorAll('tr[data-oil-id]');

    // Now loop through rows and find prices from the already-fetched oils
    for (const row of rows) {
      const oilId = row.getAttribute('data-oil-id');
      const oilName = row.getAttribute('data-oil-name');
      const priceInput = document.getElementById(`oil-${oilId}-price`);

      if (priceInput && oilName) {
        const oil = oils.find(o => o.oil_type === oilName);
        const price = oil ? parseFloat(oil.price) || 0 : 0;
        priceInput.value = formatPrice(price);
      }
    }
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

// Update datalist options for customer names
function updateCustomerNameOptions(customers = []) {
  const dataList = document.getElementById('customer-names-list');
  if (!dataList) return;

  dataList.innerHTML = '';

  const seen = new Set();
  customers.forEach(customer => {
    const name = (customer?.name || '').trim();
    if (name && !seen.has(name)) {
      const option = document.createElement('option');
      option.value = name;
      dataList.appendChild(option);
      seen.add(name);
    }
  });
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
    <td><input type="text" class="customer-name-input" list="customer-names-list" data-row="${index}" data-field="name" oninput="handleCustomerInput(${index})"></td>
    <td><input type="checkbox" class="customer-voucher-checkbox" data-row="${index}" data-field="voucher" onchange="handleCustomerInput(${index})"></td>
  `;

  tableBody.appendChild(row);
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
    const inputs = lastRow.querySelectorAll('input[type="number"], input[type="text"]');
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
  const dieselCash = parseFloat(document.getElementById('total-diesel-cash')?.value) || 0;
  const cash80 = parseFloat(document.getElementById('total-80-cash')?.value) || 0;
  const cash92 = parseFloat(document.getElementById('total-92-cash')?.value) || 0;
  const cash95 = parseFloat(document.getElementById('total-95-cash')?.value) || 0;
  const totalFuelCash = dieselCash + cash80 + cash92 + cash95;

  const totalOilRevenue = parseFloat(document.getElementById('total-oil-revenue')?.value) || 0;
  const washLubeRevenue = parseFloat(document.getElementById('total-wash-lube-revenue')?.value) || 0;

  // Add extra revenue fields
  let extraRevenue = 0;
  for (let i = 1; i <= 5; i++) {
    const amount = parseFloat(document.getElementById(`revenue-amount-${i}`)?.value) || 0;
    extraRevenue += amount;
  }

  const totalRevenue = totalFuelCash + totalOilRevenue + washLubeRevenue + extraRevenue;
  document.getElementById('total-revenue').value = formatPrice(totalRevenue);

  calculateNetTotal();
  return totalRevenue;
}

// Calculate total expenses
function calculateTotalExpenses() {
  let totalExpenses = 0;

  for (let i = 1; i <= 10; i++) {
    const amount = parseFloat(document.getElementById(`expense-amount-${i}`)?.value) || 0;
    totalExpenses += amount;
  }

  document.getElementById('total-expenses').value = formatPrice(totalExpenses);

  calculateNetTotal();
  return totalExpenses;
}

// Calculate net total (revenue - expenses)
function calculateNetTotal() {
  const totalRevenue = parseFloat(document.getElementById('total-revenue')?.value) || 0;
  const totalExpenses = parseFloat(document.getElementById('total-expenses')?.value) || 0;

  const netTotal = totalRevenue - totalExpenses;
  document.getElementById('final-net-total').value = formatPrice(netTotal);
  return netTotal;
}

// Collect fuel data from form
function collectFuelData() {
  const fuelData = {};

  Object.entries(fuelIdMap).forEach(([fuelType, fuelId]) => {
    if (fuelType === 'سولار') {
      // Diesel has 4 counters
      fuelData[fuelType] = {
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
      fuelData[fuelType] = {
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
    const oilName = row.querySelector('td strong')?.textContent;

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

    oilData[oilName] = {
      initial: parseInt(initialInput?.value) || 0,
      added: parseInt(addedInput?.value) || 0,
      total: parseInt(totalInput?.value) || 0,
      sold: parseInt(soldInput?.value) || 0,
      remaining: parseInt(remainingInput?.value) || 0,
      open: parseInt(openInput?.value) || 0,
      customers: parseInt(customersInput?.value) || 0,
      price: parseFloat(priceInput?.value) || 0,
      revenue: parseFloat(revenueInput?.value) || 0
    };
  });

  return oilData;
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
        const lastShiftInput = document.getElementById(`fuel-diesel-last-shift-${i}`);
        const firstShiftInput = document.getElementById(`fuel-diesel-first-shift-${i}`);

        const lastShift = parseFloat(lastShiftInput?.value) || 0;
        const firstShift = parseFloat(firstShiftInput?.value) || 0;

        if (firstShift > 0 && firstShift < lastShift) {
          errors.push(`${fuelType} (${i}): أول الوردية يجب أن يكون أكبر من أو يساوي آخر الوردية`);
        }
      }
    } else {
      // Validate other fuels (2 counters)
      for (let i = 1; i <= 2; i++) {
        const lastShiftInput = document.getElementById(`fuel-${fuelId}-last-${i}`);
        const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);

        const lastShift = parseFloat(lastShiftInput?.value) || 0;
        const firstShift = parseFloat(firstShiftInput?.value) || 0;

        if (firstShift > 0 && firstShift < lastShift) {
          errors.push(`${fuelType} (${i}): أول الوردية يجب أن يكون أكبر من أو يساوي آخر الوردية`);
        }
      }
    }
  });

  // Validate oil quantities
  const tableBody = document.getElementById('shift-oil-table-body');
  if (tableBody) {
    const rows = tableBody.querySelectorAll('tr[data-oil-id]');
    rows.forEach(row => {
      const oilId = row.getAttribute('data-oil-id');
      const oilName = row.querySelector('td strong')?.textContent;

      const totalInput = document.getElementById(`oil-${oilId}-total`);
      const soldInput = document.getElementById(`oil-${oilId}-sold`);

      const total = parseInt(totalInput?.value) || 0;
      const sold = parseInt(soldInput?.value) || 0;

      if (sold > total && sold > 0) {
        errors.push(`${oilName}: الكمية المباعة يجب أن تكون أقل من أو تساوي الإجمالي المتاح`);
      }
    });
  }

  return errors;
}

// Save shift
async function saveShift() {
  try {
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
    const existingShift = await ipcRenderer.invoke('get-shift', {
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

    const shiftData = {
      date: date,
      shift_number: shiftNumber,
      fuel_data: JSON.stringify(collectFuelData()),
      fuel_total: calculateFuelTotal(),
      oil_data: JSON.stringify(collectOilData()),
      oil_total: calculateOilTotal(),
      wash_lube_revenue: parseFloat(document.getElementById('total-wash-lube-revenue')?.value) || 0,
      total_expenses: parseFloat(document.getElementById('total-expenses')?.value) || 0,
      grand_total: calculateGrandTotal(),
      is_saved: 1
    };

    // Save to database
    const result = await ipcRenderer.invoke('save-shift', shiftData);

    if (result.success) {
      currentShiftData.isSaved = true;
      currentShiftData.hasUnsavedChanges = false;

      showToast('تم حفظ الوردية بنجاح', 'success');

      // Close shift menu if open
      const menu = document.getElementById('shift-menu');
      if (menu) menu.classList.remove('show');

      // Save "آخر الوردية" values before clearing
      const lastShiftValues = saveLastShiftValues();

      // Move to next shift (changes shift number/date)
      moveToNextShift(date, shiftNumber);

      // Copy saved "آخر الوردية" to "أول الوردية" of new shift
      copyLastShiftToFirst(lastShiftValues);

      // Clear specific fields after save (آخر الوردية, عيارات, customers)
      clearFieldsAfterSave();
    } else {
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
function clearFieldsAfterSave() {
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

  // Clear all customer table data
  clearCustomerTable();
}

// Clear all rows in customer table
function clearCustomerTable() {
  const customerTableBody = document.getElementById('customer-table-body');
  if (customerTableBody) {
    customerTableBody.innerHTML = '';
  }
}

// Enable read-only mode
function enableReadOnlyMode() {
  const shiftEntryScreen = document.getElementById('shift-entry-screen');
  if (shiftEntryScreen) {
    shiftEntryScreen.classList.add('shift-readonly');
  }

  // Disable all input fields
  document.querySelectorAll('.shift-fuel-input, .shift-oil-input').forEach(input => {
    input.disabled = true;
  });

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

  // Enable all input fields
  document.querySelectorAll('.shift-fuel-input, .shift-oil-input').forEach(input => {
    input.disabled = false;
  });

  // Show save button only in edit mode
  const saveBtn = document.getElementById('save-shift-btn');
  if (saveBtn) {
    saveBtn.style.display = 'inline-flex';
    if (shiftViewMode === 'history') {
      saveBtn.style.display = 'none';
    }
  }
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

// Load next shift automatically with pre-populated initial values
async function loadNextShift() {
  try {
    // Get last shift
    const lastShift = await getLastShift();

    // Calculate next shift
    const nextShift = calculateNextShift(lastShift);

    // Set date and shift number
    const dateInput = document.getElementById('shift-date');
    const shiftNumberSelect = document.getElementById('shift-number');

    if (dateInput) dateInput.value = nextShift.date;
    if (shiftNumberSelect) shiftNumberSelect.value = nextShift.shiftNumber;

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
    console.error('Error loading next shift:', error);
    alert('خطأ في تحميل الوردية التالية');
  }
}

// Load previous shift end values into current shift first values
async function loadPreviousShiftEndValues(previousShift) {
  try {
    if (!previousShift) return;

    const fuelData = JSON.parse(previousShift.fuel_data);

    // Populate "first shift" fields with "last shift" values from previous shift
    Object.entries(fuelData).forEach(([fuelType, data]) => {
      const fuelId = fuelIdMap[fuelType];
      if (fuelId) {
        if (fuelType === 'سولار') {
          // Diesel has 4 counters
          for (let i = 1; i <= 4; i++) {
            const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
            if (firstShiftInput && data[`lastShift${i}`]) {
              firstShiftInput.value = data[`lastShift${i}`];
            }
          }
        } else {
          // Other fuels have 2 counters
          for (let i = 1; i <= 2; i++) {
            const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);
            if (firstShiftInput && data[`lastShift${i}`]) {
              firstShiftInput.value = data[`lastShift${i}`];
            }
          }
        }
      }
    });

    // Trigger quantity calculations for all fuels
    calculateDieselQuantity();
    calculateFuelQuantity('بنزين ٩٥');
    calculateFuelQuantity('بنزين ٩٢');
    calculateFuelQuantity('بنزين ٨٠');
    calculateFuelQuantity('غاز سيارات');
  } catch (error) {
    console.error('Error loading previous shift end values:', error);
  }
}

// Load shift data
async function loadShiftData(date, shiftNumber) {
  try {
    const shift = await ipcRenderer.invoke('get-shift', { date, shift_number: shiftNumber });

    if (!shift) {
      // No existing shift, clear form
      clearShiftForm();

      // Load last shift data (by ID) to populate "first shift" fields
      const lastShift = await getLastShift();
      if (lastShift) {
        await loadPreviousShiftEndValues(lastShift);
      }

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
    const washLubeRevenue = parseFloat(
      shift.wash_lube_revenue ?? legacyData.wash_lube_revenue ?? 0
    ) || 0;
    const totalExpenses = parseFloat(
      shift.total_expenses ?? legacyData.total_expenses ?? 0
    ) || 0;

    // Populate fuel data
    Object.entries(fuelData).forEach(([fuelType, data]) => {
      const fuelId = fuelIdMap[fuelType];
      if (fuelId) {
        if (fuelType === 'سولار') {
          // Diesel has 4 counters
          for (let i = 1; i <= 4; i++) {
            const lastShiftInput = document.getElementById(`fuel-diesel-last-${i}`);
            const firstShiftInput = document.getElementById(`fuel-diesel-first-${i}`);
            const quantityInput = document.getElementById(`fuel-diesel-quantity-${i}`);

            if (lastShiftInput) lastShiftInput.value = data[`lastShift${i}`] || '';
            if (firstShiftInput) firstShiftInput.value = data[`firstShift${i}`] || '';
            if (quantityInput) quantityInput.value = data[`quantity${i}`] || '';
          }

          const totalQuantityInput = document.getElementById('fuel-diesel-total-qty');
          const clientsInput = document.getElementById('fuel-diesel-clients');
          const carsInput = document.getElementById('fuel-diesel-cars');
          const priceInput = document.getElementById('fuel-diesel-price');
          const cashInput = document.getElementById('fuel-diesel-cash');

          if (totalQuantityInput) totalQuantityInput.value = data.totalQuantity || '';
          if (clientsInput) clientsInput.value = data.clients || '';
          if (carsInput) carsInput.value = data.cars || '';
          if (priceInput) priceInput.value = data.price || '';
          if (cashInput) cashInput.value = data.cash || '';
        } else {
          // Other fuels have 2 counters
          for (let i = 1; i <= 2; i++) {
            const lastShiftInput = document.getElementById(`fuel-${fuelId}-last-${i}`);
            const firstShiftInput = document.getElementById(`fuel-${fuelId}-first-${i}`);
            const quantityInput = document.getElementById(`fuel-${fuelId}-quantity-${i}`);

            if (lastShiftInput) lastShiftInput.value = data[`lastShift${i}`] || '';
            if (firstShiftInput) firstShiftInput.value = data[`firstShift${i}`] || '';
            if (quantityInput) quantityInput.value = data[`quantity${i}`] || '';
          }

          const totalQuantityInput = document.getElementById(`fuel-${fuelId}-total-qty`);
          const clientsInput = document.getElementById(`fuel-${fuelId}-clients`);
          const carsInput = document.getElementById(`fuel-${fuelId}-cars`);
          const priceInput = document.getElementById(`fuel-${fuelId}-price`);
          const cashInput = document.getElementById(`fuel-${fuelId}-cash`);

          if (totalQuantityInput) totalQuantityInput.value = data.totalQuantity || '';
          if (clientsInput) clientsInput.value = data.clients || '';
          if (carsInput) carsInput.value = data.cars || '';
          if (priceInput) priceInput.value = data.price || '';
          if (cashInput) cashInput.value = data.cash || '';
        }
      }
    });

    // Populate oil data
    Object.entries(oilData).forEach(([oilName, data]) => {
      // Find the oil row by name
      const tableBody = document.getElementById('shift-oil-table-body');
      if (tableBody) {
        const rows = tableBody.querySelectorAll('tr[data-oil-id]');
        rows.forEach(row => {
          const rowOilName = row.querySelector('td strong')?.textContent;
          if (rowOilName === oilName) {
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

            if (initialInput) initialInput.value = data.initial || '';
            if (addedInput) addedInput.value = data.added || '';
            if (totalInput) totalInput.value = data.total || '';
            if (soldInput) soldInput.value = data.sold || '';
            if (remainingInput) remainingInput.value = data.remaining || '';
            if (openInput) openInput.value = data.open || '';
            if (customersInput) customersInput.value = data.customers || '';
            if (priceInput) priceInput.value = data.price || '';
            if (revenueInput) revenueInput.value = data.revenue || '';
          }
        });
      }
    });

    const washLubeInput = document.getElementById('total-wash-lube-revenue');
    if (washLubeInput) {
      washLubeInput.value = Math.abs(washLubeRevenue) > 0.0001 ? formatPrice(washLubeRevenue) : '';
    }

    // Recalculate totals
    calculateFuelTotal();
    calculateOilTotal();
    calculateGrandTotal();
    const totalExpensesInput = document.getElementById('total-expenses');
    if (totalExpensesInput && Math.abs(totalExpenses) > 0.0001) {
      totalExpensesInput.value = formatPrice(totalExpenses);
      calculateNetTotal();
    }

    // Set current shift state
    currentShiftData.date = date;
    currentShiftData.shiftNumber = shiftNumber;
    currentShiftData.isSaved = shift.is_saved === 1;
    currentShiftData.hasUnsavedChanges = false;

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
        const lastShiftInput = document.getElementById(`fuel-diesel-last-shift-${i}`);
        const firstShiftInput = document.getElementById(`fuel-diesel-first-shift-${i}`);

        if (lastShiftInput) lastShiftInput.value = '';
        if (firstShiftInput) firstShiftInput.value = '';
      }

      const quantityInput = document.getElementById('fuel-diesel-quantity');
      const totalQuantityInput = document.getElementById('fuel-diesel-total-quantity');
      const clientsInput = document.getElementById('fuel-diesel-clients');
      const carsInput = document.getElementById('fuel-diesel-cars');
      const priceInput = document.getElementById('fuel-diesel-price');
      const cashInput = document.getElementById('fuel-diesel-cash');

      if (quantityInput) quantityInput.value = '';
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

        if (lastShiftInput) lastShiftInput.value = '';
        if (firstShiftInput) firstShiftInput.value = '';
      }

      const quantityInput = document.getElementById(`fuel-${fuelId}-quantity`);
      const totalQuantityInput = document.getElementById(`fuel-${fuelId}-total-qty`);
      const clientsInput = document.getElementById(`fuel-${fuelId}-clients`);
      const carsInput = document.getElementById(`fuel-${fuelId}-cars`);
      const priceInput = document.getElementById(`fuel-${fuelId}-price`);
      const cashInput = document.getElementById(`fuel-${fuelId}-cash`);

      if (quantityInput) quantityInput.value = '';
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

      if (initialInput) initialInput.value = '';
      if (addedInput) addedInput.value = '';
      if (totalInput) totalInput.value = '';
      if (soldInput) soldInput.value = '';
      if (remainingInput) remainingInput.value = '';
      if (openInput) openInput.value = '';
      if (customersInput) customersInput.value = '';
      if (priceInput) priceInput.value = '';
      if (revenueInput) revenueInput.value = '';
    });
  }

  const washLubeInput = document.getElementById('total-wash-lube-revenue');
  if (washLubeInput) {
    washLubeInput.value = '';
  }

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
    last = await ipcRenderer.invoke('get-last-shift');
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
    const existingShift = await ipcRenderer.invoke('get-shift', { date, shift_number: shiftNumber });

    if (!existingShift) {
      if (messageEl) messageEl.textContent = 'لا توجد بيانات لهذه الوردية';
      return;
    }

    shiftViewMode = 'history';
    const dateField = document.getElementById('shift-date');
  const shiftField = document.getElementById('shift-number');
  if (dateField) dateField.value = date;
  if (shiftField) shiftField.value = shiftNumber.toString();

    showScreen('shift-entry', 'home');
    await loadShiftData(date, shiftNumber);
    enableReadOnlyMode();
    updateShiftTitle();
    toggleHistoryBar(true);
    updateHistoryChip(date, shiftNumber);

    if (messageEl) messageEl.textContent = '';
    closeShiftHistoryModal();
  } catch (error) {
    console.error('Error loading shift from history:', error);
    if (messageEl) messageEl.textContent = 'حدث خطأ أثناء تحميل الوردية';
  }
}

function updateShiftTitle() {
  const title = document.getElementById('shift-entry-title');
  if (!title) return;
  title.textContent = shiftViewMode === 'history' ? 'عرض الوردية' : 'إدخال وردية جديدة';
}

function toggleHistoryBar(show) {
  const bar = document.getElementById('shift-history-bar');
  if (!bar) return;
  bar.style.display = show ? 'flex' : 'none';

  const saveBtn = document.getElementById('save-shift-btn');
  const menuWrap = document.querySelector('.shift-menu-wrapper');
  if (saveBtn) saveBtn.style.display = show ? 'none' : 'inline-flex';
  if (menuWrap) menuWrap.style.display = show ? 'none' : 'inline-block';
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

async function navigateShiftHistory(direction) {
  if (shiftViewMode !== 'history') return;
  const currentDate = currentShiftData.date;
  const currentShiftNumber = currentShiftData.shiftNumber;
  if (!currentDate || !currentShiftNumber) return;

  const { date, shiftNumber } = getAdjacentShift(currentDate, currentShiftNumber, direction);
  await loadShiftHistory(date, shiftNumber, null);
}

// Shift quick menu and reset counters
function toggleShiftMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('shift-menu');
  if (!menu) return;
  const isShown = menu.classList.contains('show');
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
  if (!isShown && shiftViewMode !== 'history') {
    menu.classList.add('show');
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
});

function openResetCountersModal() {
  document.querySelectorAll('.shift-menu').forEach(m => m.classList.remove('show'));
  const modal = document.getElementById('reset-counters-modal');
  const select = document.getElementById('reset-fuel-type');
  const msg = document.getElementById('reset-counters-message');
  if (select) select.value = '';
  if (msg) msg.textContent = '';
  renderResetCounterFields('');
  if (modal) modal.classList.add('show');
}

function closeResetCountersModal() {
  const modal = document.getElementById('reset-counters-modal');
  if (modal) modal.classList.remove('show');
}

function onResetFuelChange() {
  const select = document.getElementById('reset-fuel-type');
  const fuel = select?.value || '';
  renderResetCounterFields(fuel);
}

function renderResetCounterFields(fuel) {
  const container = document.getElementById('reset-counter-fields');
  if (!container) return;
  const buildInputs = (count) => {
    let html = '';
    for (let i = 1; i <= count; i++) {
      html += `
        <div class="reset-counter-field">
          <label>${convertToArabicNumerals(i)}</label>
          <input type="number" id="reset-counter-${i}" min="0" step="0.01">
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

function applyResetCounters() {
  const fuel = document.getElementById('reset-fuel-type')?.value;
  const msg = document.getElementById('reset-counters-message');
  if (!fuel) {
    if (msg) msg.textContent = 'يرجى اختيار نوع الوقود';
    return;
  }

  const setValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  const values = [];
  const maxCounters = fuel === 'diesel' ? 4 : 2;
  for (let i = 1; i <= maxCounters; i++) {
    const val = parseFloat(document.getElementById(`reset-counter-${i}`)?.value) || 0;
    values.push(val);
  }

  if (fuel === 'diesel') {
    values.forEach((v, idx) => setValue(`fuel-diesel-first-${idx + 1}`, v));
  } else if (fuel === 'gas') {
    values.forEach((v, idx) => setValue(`fuel-gas-first-${idx + 1}`, v));
  } else if (fuel === '95' || fuel === '92' || fuel === '80') {
    values.forEach((v, idx) => setValue(`fuel-${fuel}-first-${idx + 1}`, v));
  }

  currentShiftData.hasUnsavedChanges = true;
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
  } catch (error) {
    console.error('Error loading fuel prices for date:', error);
    alert('خطأ في تحميل أسعار الوقود');
  }
}

// Track if shift listeners are already set up
let shiftListenersInitialized = false;

// Initialize shift entry when screen is shown
async function initializeShiftEntry() {
  // Load active oils
  await loadActiveOils();

  // Set up event listeners for date and shift number
  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');

  // Only set up event listeners once
  if (!shiftListenersInitialized) {
    if (dateInput) {
      // Load prices when date changes
      dateInput.addEventListener('change', async () => {
        await loadFuelPricesForDate(dateInput.value);
        await handleShiftIdentifierChange();
      });
    }

    if (shiftNumberSelect) {
      shiftNumberSelect.addEventListener('change', handleShiftIdentifierChange);
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

  // Load next shift automatically (calculates and pre-populates)
  await loadNextShift();

  // Load prices for the calculated date
  if (dateInput?.value) {
    await loadFuelPricesForDate(dateInput.value);
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
    updateConnectionStatus();
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
