const { ipcRenderer } = require('electron');

// Global variables
let charts = {};
let currentScreen = 'home';
let currentParentScreen = null;
let oilItemCounter = 0;
let navigationHistory = [];

// Screen and section titles mapping
const screenTitles = {
  'home': 'الرئيسية',
  'invoice': 'فاتورة جديدة',
  'shift-entry': 'إدخال وردية جديدة',
  'charts': 'الرسوم البيانية',
  'report': 'التقارير',
  'settings': 'الإعدادات',
  'depot': 'المخزن'
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

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
  // RTL configuration is now handled by rtl-config.js
  // The configuration is automatically applied when the DOM loads
  
  initializeApp();
  setupEventListeners();
  loadTodayStats();
  loadFuelPrices();
  loadPurchasePrices();

  // Check for updates on startup if enabled
  setTimeout(() => {
    const autoCheck = localStorage.getItem('auto-check-updates');
    if (autoCheck === null || autoCheck === 'true') {
      ipcRenderer.send('check-for-updates-manual');
    }
  }, 3000);
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

  // Load home chart on initialization
  loadHomeChart();
  
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
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
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

  // Modal click outside to close
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('movement-modal');
    if (e.target === modal) {
      closeMovementModal();
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

  if (!currentScreen) {
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
  // Go back to parent in hierarchy
  const activeSettingsSection = document.querySelector('.settings-section.active');

  if (activeSettingsSection) {
    // If in a settings section, go back to settings main
    showScreen('settings');
  } else if (currentParentScreen) {
    // If current screen has a parent (e.g., depot -> home), go to parent
    showScreen(currentParentScreen);
  } else if (currentScreen !== 'home') {
    // Otherwise go to home
    showScreen('home');
  }
}

function showScreenWithoutHistory(screenName) {
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
    case 'shift-entry':
      // Set today's date as default for shift
      const shiftDateInput = document.getElementById('shift-date');
      if (shiftDateInput && !shiftDateInput.value) {
        shiftDateInput.value = getTodayDate();
      }
      // Initialize shift entry functionality (with delay to ensure DOM is ready)
      setTimeout(() => {
        console.log('Calling initializeShiftEntry after timeout...');
        initializeShiftEntry();
      }, 500);
      break;
    case 'depot':
      // Reset depot screen when opening
      document.querySelectorAll('.oil-item').forEach(item => {
        item.classList.remove('selected');
      });
      document.getElementById('results-section').style.display = 'none';
      document.getElementById('current-stock-amount').textContent = convertToArabicNumerals(0);
      document.getElementById('breadcrumb-product').textContent = '';
      document.getElementById('breadcrumb-separator').style.display = 'none';
      document.getElementById('movements-table').innerHTML = '<div class="empty-movements">اختر نوع الزيت لعرض الحركات</div>';
      break;
  }
}

function showScreen(screenName, parentScreen = null) {
  // Update global parent screen tracker
  currentParentScreen = parentScreen;

  // Update breadcrumb with current screen and parent
  updateBreadcrumb(screenName, null, parentScreen);

  // Call the version without history
  showScreenWithoutHistory(screenName);
}

async function loadTodayStats() {
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

async function loadHomeChart() {
  try {
    // Get fuel movements (purchases) instead of sales
    const movements = await ipcRenderer.invoke('get-fuel-movements');

    if (!movements || !Array.isArray(movements)) {
      console.error('Invalid movements data');
      return;
    }

    // Filter only 'in' movements (purchases)
    const purchases = movements.filter(m => m.type === 'in');
    createMonthlyFuelSalesChart(purchases);
  } catch (error) {
    console.error('Error loading home chart:', error);
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
  const actualTotalInput = document.getElementById('actual-invoice-total');
  const invoiceTotal = parseFloat(actualTotalInput?.value) || 0;

  const invoiceData = {
    date: document.getElementById('fuel-invoice-date').value,
    invoice_number: document.getElementById('fuel-invoice-number').value,
    invoice_total: invoiceTotal,
    fuel_items: []
  };

  // Collect fuel items data
  document.querySelectorAll('.fuel-item').forEach(item => {
    const fuelType = item.dataset.fuel;
    const quantity = parseFloat(item.querySelector('.fuel-quantity').value) || 0;
    const purchasePrice = parseFloat(item.querySelector('.fuel-purchase-price').value) || 0;
    const salePrice = parseFloat(item.querySelector('.fuel-sale-price')?.value) || 0;
    const total = parseFloat(item.querySelector('.fuel-total').value.replace(/[^\d.-]/g, '')) || 0;

    if (quantity > 0) {
      // Calculate net quantity for gasoline
      let netQuantity = quantity;
      if (fuelType.includes('بنزين')) {
        netQuantity = quantity * 0.995;
      }

      const profit = (salePrice - purchasePrice) * netQuantity;

      invoiceData.fuel_items.push({
        fuel_type: fuelType,
        quantity: quantity,
        net_quantity: netQuantity,
        purchase_price: purchasePrice,
        sale_price: salePrice,
        total: total,
        profit: profit
      });
    }
  });

  if (invoiceData.fuel_items.length === 0) {
    showMessage('يرجى إدخال بيانات على الأقل لنوع واحد من الوقود', 'error');
    return;
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
  const price = parseFloat(document.getElementById(inputId).value);

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
  const price = parseFloat(document.getElementById(inputId).value);

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

function createMonthlyFuelSalesChart(sales) {
  const ctx = document.getElementById('monthly-fuel-sales-chart').getContext('2d');

  if (charts.monthlyFuelSales) {
    charts.monthlyFuelSales.destroy();
  }

  // Group sales by month and fuel type
  const monthlyData = {};
  const fuelTypes = ['بنزين ٨٠', 'بنزين ٩٢', 'بنزين ٩٥', 'سولار'];
  const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'];

  // Initialize data structure
  sales.forEach(sale => {
    const month = sale.date.substring(0, 7); // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = {};
      fuelTypes.forEach(type => {
        monthlyData[month][type] = 0;
      });
    }
    monthlyData[month][sale.fuel_type] += sale.quantity;
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
          text: 'كميات المشتريات الشهرية حسب نوع الوقود',
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

  const quantity = parseFloat(quantityInput.value) || 0;
  const purchasePrice = parseFloat(purchasePriceInput.value) || 0;

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

  const actualTotal = parseFloat(actualTotalInput.value) || 0;
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
  
  const quantity = parseFloat(quantityInput.value) || 0;
  const purchasePrice = parseFloat(purchasePriceInput.value) || 0;
  const iva = parseFloat(ivaInput.value) || 0;
  
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

  const discount = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
  const tax = taxInput ? (parseFloat(taxInput.value) || 0) : 0;

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
  const breadcrumbSeparator = document.getElementById('breadcrumb-separator');
  if (oilType) {
    breadcrumbProduct.textContent = oilType;
    breadcrumbSeparator.style.display = 'inline';
  } else {
    breadcrumbProduct.textContent = '';
    breadcrumbSeparator.style.display = 'none';
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
    closeMovementModal();
    loadOilMovements(oilType); // Reload the movements for the current oil type
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
  document.querySelectorAll('.oil-item').forEach(item => {
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
    
    // Also save each oil item as a separate oil movement record for stock tracking
    for (const item of invoiceData.oil_items) {
      await ipcRenderer.invoke('add-oil-movement', {
        oil_type: item.oil_type,
        date: invoiceData.date,
        type: 'in',
        quantity: item.quantity,
        invoice_number: invoiceData.invoice_number
      });
    }

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
  const price = parseFloat(priceInput.value);
  const vat = type === 'oil' ? (parseFloat(vatInput.value) || 0) : 0;

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
  }
}

// Show settings section without adding to history
function showSettingsSectionWithoutHistory(sectionName) {
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
    } else if (sectionName === 'invoices-list') {
      loadInvoicesList();
    }
  }
}

// Navigate to Edit Prices section
function navigateToEditPrices() {
  // Add to navigation history
  pushNavigation({ screen: 'settings', section: 'sale-prices' });

  // Show the section
  showSettingsSectionWithoutHistory('sale-prices');
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
        const updatedDate = formatUpdateDate(product.effective_date);
        const row = document.createElement('tr');

        const td1 = document.createElement('td');
        td1.textContent = index + 1;

        const td2 = document.createElement('td');
        td2.className = 'product-name';
        td2.textContent = product.fuel_type;

        const td3 = document.createElement('td');
        td3.style.textAlign = 'center';
        td3.textContent = formatArabicCurrency(product.price) + updatedDate;

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
        const updatedDate = formatUpdateDate(product.effective_date);
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
        td3.textContent = formatArabicCurrency(product.price) + updatedDate;

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
  const price = parseFloat(document.getElementById(inputId).value);

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
          total: inv.invoice_total || 0,
          items: []
        };
      }
      fuelInvoicesMap[inv.invoice_number].items.push(inv);
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
            <th>سعر البيع</th>
            <th>الإجمالي</th>
            <th>الربح</th>
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
        <td>${formatArabicNumber(item.sale_price)} جنيه</td>
        <td>${formatArabicNumber(item.total)} جنيه</td>
        <td>${formatArabicNumber(item.profit || 0)} جنيه</td>
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
    html += `
      <div class="invoice-summary-details">
        <p style="font-size: 1.2rem; font-weight: bold; margin-top: 1rem; border-top: 2px solid #c4291d; padding-top: 0.5rem;">
          <strong>الإجمالي:</strong> ${formatArabicNumber(invoice.total)} جنيه
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
  showUpdateNotification('التحديث جاهز', 'تم تنزيل التحديث. سيتم تثبيته عند إعادة تشغيل التطبيق.', false);
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

function showUpdateNotification(title, message, showDownloadButton) {
  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <div class="update-notification-content">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="update-actions">
        ${showDownloadButton ? '<button class="btn btn-primary" onclick="downloadUpdate()">تنزيل الآن</button>' : '<button class="btn btn-primary" onclick="installUpdate()">إعادة التشغيل والتثبيت</button>'}
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
  ipcRenderer.send('install-update');
}

function closeUpdateNotification() {
  const notification = document.querySelector('.update-notification');
  if (notification) notification.remove();
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

      // Calculate quantity (always, even if negative - could be counter reset)
      const counterQuantity = lastShift - firstShift;
      quantityInput.value = counterQuantity >= 0 ? Math.round(counterQuantity) : Math.round(counterQuantity);
      totalQuantity += counterQuantity;
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

      // Calculate quantity (always, even if negative - could be counter reset)
      const counterQuantity = lastShift - firstShift;
      quantityInput.value = counterQuantity >= 0 ? Math.round(counterQuantity) : Math.round(counterQuantity);
      totalQuantity += counterQuantity;
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
    cashInput.value = cash.toFixed(2);

    console.log(`Calculated cash for ${fuelId}: (${totalQty} - (${clients} + ${cars})) * ${price} = ${cash.toFixed(2)}`);
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

  // Update fuel total display
  const fuelTotalDisplay = document.getElementById('fuel-total-display');
  if (fuelTotalDisplay) {
    fuelTotalDisplay.textContent = `${total.toFixed(2)} جنيه`;
  }

  // Update summary in total tab
  const summaryFuelTotal = document.getElementById('summary-fuel-total');
  if (summaryFuelTotal) {
    summaryFuelTotal.textContent = `${total.toFixed(2)} جنيه`;
  }

  // Recalculate grand total
  calculateGrandTotal();

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
    showToast('خطأ في تحميل الزيوت النشطة', 'error');
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
    showToast('خطأ: الكمية المتبقية يجب أن تكون أقل من أو تساوي الإجمالي المتاح', 'error');
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
  console.log('loadAllOilPrices: Starting...');
  const tableBody = document.getElementById('shift-oil-table-body');
  if (!tableBody) {
    console.log('loadAllOilPrices: Table body not found');
    return;
  }

  const dateInput = document.getElementById('shift-date');
  const shiftDate = dateInput ? dateInput.value : getTodayDate();
  console.log('loadAllOilPrices: Using date', shiftDate);

  // Fetch all oils from database ONCE
  try {
    const oils = await ipcRenderer.invoke('get-oil-prices');
    console.log('loadAllOilPrices: Fetched', oils.length, 'oils from database');

    const rows = tableBody.querySelectorAll('tr[data-oil-id]');
    console.log('loadAllOilPrices: Found', rows.length, 'rows');

    // Now loop through rows and find prices from the already-fetched oils
    for (const row of rows) {
      const oilId = row.getAttribute('data-oil-id');
      const oilName = row.getAttribute('data-oil-name');
      const priceInput = document.getElementById(`oil-${oilId}-price`);

      if (priceInput && oilName) {
        const oil = oils.find(o => o.oil_type === oilName);
        const price = oil ? parseFloat(oil.price) || 0 : 0;
        priceInput.value = formatPrice(price);
        console.log('loadAllOilPrices: Set price for', oilName, ':', price);
      }
    }

    console.log('loadAllOilPrices: Completed');
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

  // Update oil total display
  const oilTotalDisplay = document.getElementById('oil-total-display');
  if (oilTotalDisplay) {
    oilTotalDisplay.textContent = `${total.toFixed(2)} جنيه`;
  }

  // Update summary in total tab
  const summaryOilTotal = document.getElementById('summary-oil-total');
  if (summaryOilTotal) {
    summaryOilTotal.textContent = `${total.toFixed(2)} جنيه`;
  }

  // Recalculate grand total
  calculateGrandTotal();

  return total;
}

// ============= CUSTOMERS TABLE FUNCTIONS =============

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
    <td><input type="text" class="customer-name-input" data-row="${index}" data-field="name" oninput="handleCustomerInput(${index})"></td>
    <td><input type="checkbox" class="customer-voucher-checkbox" data-row="${index}" data-field="voucher" onchange="handleCustomerInput(${index})"></td>
  `;

  tableBody.appendChild(row);
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
  const fuelTotalDisplay = document.getElementById('fuel-total-display');
  const oilTotalDisplay = document.getElementById('oil-total-display');
  const grandTotalDisplay = document.getElementById('summary-grand-total');

  if (!fuelTotalDisplay || !oilTotalDisplay || !grandTotalDisplay) return;

  const fuelTotal = parseFloat(fuelTotalDisplay.textContent.replace(' جنيه', '')) || 0;
  const oilTotal = parseFloat(oilTotalDisplay.textContent.replace(' جنيه', '')) || 0;
  const grandTotal = fuelTotal + oilTotal;

  grandTotalDisplay.textContent = `${grandTotal.toFixed(2)} جنيه`;

  return grandTotal;
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
      showToast(`أخطاء في البيانات:\n${errors.join('\n')}`, 'error');
      return;
    }

    const dateInput = document.getElementById('shift-date');
    const shiftNumberSelect = document.getElementById('shift-number');

    const shiftData = {
      date: dateInput.value,
      shift_number: parseInt(shiftNumberSelect.value),
      fuel_data: JSON.stringify(collectFuelData()),
      fuel_total: calculateFuelTotal(),
      oil_data: JSON.stringify(collectOilData()),
      oil_total: calculateOilTotal(),
      grand_total: calculateGrandTotal(),
      is_saved: 1
    };

    // Save to database
    const result = await ipcRenderer.invoke('save-shift', shiftData);

    if (result.success) {
      currentShiftData.isSaved = true;
      currentShiftData.hasUnsavedChanges = false;

      showToast('تم حفظ الوردية بنجاح', 'success');

      // Enable read-only mode
      enableReadOnlyMode();
    } else {
      showToast('خطأ في حفظ الوردية: ' + (result.error || 'خطأ غير معروف'), 'error');
    }
  } catch (error) {
    console.error('Error saving shift:', error);
    showToast('خطأ في حفظ الوردية', 'error');
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

  // Show save button
  const saveBtn = document.getElementById('save-shift-btn');
  if (saveBtn) {
    saveBtn.style.display = '';
  }
}

// Load shift data
async function loadShiftData(date, shiftNumber) {
  try {
    const shift = await ipcRenderer.invoke('get-shift', { date, shift_number: shiftNumber });

    if (!shift) {
      // No existing shift, clear form
      clearShiftForm();
      disableReadOnlyMode();
      return;
    }

    // Parse JSON data
    const fuelData = JSON.parse(shift.fuel_data);
    const oilData = JSON.parse(shift.oil_data);

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

    // Recalculate totals
    calculateFuelTotal();
    calculateOilTotal();
    calculateGrandTotal();

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
    showToast('خطأ في تحميل بيانات الوردية', 'error');
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
function showShiftHistory() {
  showToast('سجل الورديات - قريباً', 'info');
  // TODO: Implement shift history screen
}

// Load fuel prices for a specific date and populate price fields
async function loadFuelPricesForDate(date) {
  if (!date) {
    console.log('loadFuelPricesForDate: no date provided');
    return;
  }

  console.log('Loading fuel prices for date:', date);

  try {
    // Load prices for each fuel type
    for (const [fuelType, fuelId] of Object.entries(fuelIdMap)) {
      console.log(`Loading price for ${fuelType} (ID: ${fuelId})`);

      const price = await ipcRenderer.invoke('get-price-by-date', {
        product_name: fuelType,
        date: date
      });

      console.log(`Price for ${fuelType}:`, price);

      const priceInput = document.getElementById(`fuel-${fuelId}-price`);
      if (priceInput) {
        if (price !== null && price !== undefined) {
          // Temporarily remove readonly to set value
          const wasReadonly = priceInput.readOnly;
          priceInput.readOnly = false;
          priceInput.value = parseFloat(price).toFixed(2);
          priceInput.readOnly = wasReadonly;
          console.log(`Set price for fuel-${fuelId}-price:`, priceInput.value);
        } else {
          console.warn(`No price found for ${fuelType}`);
        }
      } else {
        console.warn(`Price input not found: fuel-${fuelId}-price`);
      }
    }
  } catch (error) {
    console.error('Error loading fuel prices for date:', error);
    showToast('خطأ في تحميل أسعار الوقود', 'error');
  }
}

// Track if shift listeners are already set up
let shiftListenersInitialized = false;

// Initialize shift entry when screen is shown
async function initializeShiftEntry() {
  // Load active oils
  await loadActiveOils();

  // Initialize customers table
  initializeCustomersTable();

  // Set up event listeners for date and shift number
  const dateInput = document.getElementById('shift-date');
  const shiftNumberSelect = document.getElementById('shift-number');

  // Set today's date if not set
  if (dateInput && !dateInput.value) {
    dateInput.value = getTodayDate();
  }

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
      if (currentShiftData.hasUnsavedChanges && currentScreen === 'shift-entry') {
        e.preventDefault();
        e.returnValue = '';
        return 'لديك تغييرات غير محفوظة. هل تريد المغادرة؟';
      }
    });

    shiftListenersInitialized = true;
  }

  // Always load prices when opening the screen
  if (dateInput?.value) {
    await loadFuelPricesForDate(dateInput.value);
  }

  // Load shift data if date and shift number are set
  if (dateInput?.value && shiftNumberSelect?.value) {
    await loadShiftData(dateInput.value, parseInt(shiftNumberSelect.value));
  }
}

// Initialize depot event listeners quando DOM è pronto
document.addEventListener('DOMContentLoaded', () => {
  setupDepotEventListeners();
});
