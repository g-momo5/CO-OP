const { ipcRenderer } = require('electron');

// Global variables
let charts = {};
let currentScreen = 'home';
let oilItemCounter = 0;
let navigationHistory = [];

// Screen and section titles mapping
const screenTitles = {
  'home': 'الرئيسية',
  'invoice': 'فاتورة جديدة',
  'charts': 'الرسوم البيانية',
  'report': 'التقارير',
  'settings': 'الإعدادات',
  'depot': 'المخزن'
};

const settingsSectionTitles = {
  'manage-products': 'إدارة المنتجات',
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

function initializeApp() {
  // Set today's date as default
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('fuel-invoice-date');
  if (dateInput) dateInput.value = today;
  
  // Set today's date for oil invoice as well
  const oilDateInput = document.getElementById('oil-invoice-date');
  if (oilDateInput) oilDateInput.value = today;

  // Set default date range for reports
  const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const startDateInput = document.getElementById('start-date');
  const endDateInput = document.getElementById('end-date');
  if (startDateInput) startDateInput.value = firstDayOfMonth;
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
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      showInvoiceType(type);
    });
  });

  // Settings sidebar navigation
  document.querySelectorAll('.settings-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.settingsSection;

      // Add to navigation history
      pushNavigation({ screen: 'settings', section: section });

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
function updateBreadcrumb(path) {
  const breadcrumbNav = document.getElementById('breadcrumb-nav');
  const breadcrumbTrail = document.getElementById('breadcrumb-trail');
  const mainContent = document.querySelector('.main-content');

  if (!path || path.length === 0 || (path.length === 1 && path[0].screen === 'home')) {
    // Hide breadcrumb for home screen
    breadcrumbNav.style.display = 'none';
    mainContent.classList.remove('with-breadcrumb');
    return;
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
    if (item.screen) {
      title = screenTitles[item.screen] || item.screen;
    }
    if (item.section) {
      title = settingsSectionTitles[item.section] || item.section;
    }

    if (isLast) {
      breadcrumbItem.textContent = title;
    } else {
      const link = document.createElement('a');
      link.textContent = title;
      link.onclick = () => navigateToHistoryItem(index);
      breadcrumbItem.appendChild(link);
    }

    breadcrumbTrail.appendChild(breadcrumbItem);

    // Add separator if not last item
    if (!isLast) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '‹';
      breadcrumbTrail.appendChild(separator);
    }
  });
}

function pushNavigation(item) {
  navigationHistory.push(item);
  updateBreadcrumb(navigationHistory);
}

function navigateBack() {
  if (navigationHistory.length <= 1) return;

  // Remove current page
  navigationHistory.pop();

  // Get previous page
  const previousItem = navigationHistory[navigationHistory.length - 1];

  // Navigate without adding to history
  if (previousItem.screen && !previousItem.section) {
    showScreenWithoutHistory(previousItem.screen);
  } else if (previousItem.screen === 'settings' && previousItem.section) {
    showSettingsSectionWithoutHistory(previousItem.section);
  }

  updateBreadcrumb(navigationHistory);
}

function navigateToHistoryItem(index) {
  // Remove items after the clicked index
  navigationHistory = navigationHistory.slice(0, index + 1);

  const targetItem = navigationHistory[index];

  // Navigate without adding to history
  if (targetItem.screen && !targetItem.section) {
    showScreenWithoutHistory(targetItem.screen);
  } else if (targetItem.screen === 'settings' && targetItem.section) {
    showSettingsSectionWithoutHistory(targetItem.section);
  }

  updateBreadcrumb(navigationHistory);
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
  document.querySelector(`[data-screen="${screenName}"]`).classList.add('active');

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
    case 'depot':
      // Reset depot screen when opening
      document.querySelectorAll('.oil-item').forEach(item => {
        item.classList.remove('selected');
      });
      document.getElementById('results-section').style.display = 'none';
      document.getElementById('current-stock-amount').textContent = convertToArabicNumerals(0);
      document.getElementById('selected-oil-name').textContent = '-- اختر نوع الزيت --';
      document.getElementById('movements-table').innerHTML = '<div class="empty-movements">اختر نوع الزيت لعرض الحركات</div>';
      break;
  }
}

function showScreen(screenName) {
  // Add to navigation history
  pushNavigation({ screen: screenName });

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
  // Update active button
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-type="${type}"]`).classList.add('active');

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
  showScreen('depot');
}

function selectOilType(oilType) {
  // Remove selected class from all items
  document.querySelectorAll('.oil-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // Add selected class to clicked item
  document.querySelector(`.oil-item[data-oil="${oilType}"]`).classList.add('selected');
  
  // Update selected oil name display
  const selectedOilName = document.getElementById('selected-oil-name');
  if (oilType) {
    selectedOilName.textContent = oilType;
  } else {
    selectedOilName.textContent = '-- اختر نوع الزيت --';
  }
  
  // Show results section and scroll to it
  const resultsSection = document.getElementById('results-section');
  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  // Load movements for selected oil
  loadOilMovements(oilType);
}

async function loadOilMovements(oilType) {
  if (!oilType) {
    document.getElementById('current-stock-amount').textContent = convertToArabicNumerals(0);
    document.getElementById('movements-table').innerHTML = '<div class="empty-movements">اختر نوع الزيت لعرض الحركات</div>';
    return;
  }

  try {
    const movements = await ipcRenderer.invoke('get-oil-movements', oilType);
    const currentStock = await ipcRenderer.invoke('get-current-oil-stock', oilType);
    
    // Update current stock display
    document.getElementById('current-stock-amount').textContent = convertToArabicNumerals(currentStock || 0);
    
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
    <div class="table-container">
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
    </div>
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
        const row = document.createElement('tr');

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
    await ipcRenderer.invoke('delete-fuel-product', fuelType);
    showMessage('تم حذف المنتج بنجاح', 'success');

    // Reload tables
    loadManageProducts();
    loadFuelPrices();
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
      <div id="download-progress-container" style="display: none; margin-top: 1rem;">
        <div class="progress-bar">
          <div class="progress-fill" id="update-progress-fill"></div>
        </div>
        <p id="update-progress-text" style="text-align: center; margin-top: 0.5rem;">0%</p>
      </div>
    </div>
  `;

  // Remove existing notification if any
  const existing = document.querySelector('.update-notification');
  if (existing) existing.remove();

  document.body.appendChild(notification);
}

function downloadUpdate() {
  ipcRenderer.send('download-update');
  document.getElementById('download-progress-container').style.display = 'block';
  showMessage('جاري تنزيل التحديث...', 'info');
}

function installUpdate() {
  ipcRenderer.send('install-update');
}

function closeUpdateNotification() {
  const notification = document.querySelector('.update-notification');
  if (notification) notification.remove();
}

function updateDownloadProgress(percent) {
  const fill = document.getElementById('update-progress-fill');
  const text = document.getElementById('update-progress-text');
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${percent}%`;
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
