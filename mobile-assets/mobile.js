(() => {
  const state = {
    apiBase: '/api/mobile-data',
    currentModule: 'fuel',
    currentView: 'overview',
    landSeasonKey: String(new Date().getFullYear()),
    landSeasons: [],
    shiftDays: []
  };

  const content = document.getElementById('content');
  const appTitle = document.querySelector('.app-title');
  const lastSync = document.getElementById('lastSync');
  const shiftSummaryDialog = document.getElementById('shiftSummaryDialog');
  const shiftSummaryDialogBody = document.getElementById('shiftSummaryDialogBody');
  const closeShiftSummaryDialog = document.getElementById('closeShiftSummaryDialog');
  const moduleButtons = document.querySelectorAll('[data-module]');
  let homeChart = null;
  const numberFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
  const moneyFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const monthNames = [
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

  const profitRows = [
    ['fuel_diesel', 'سولار', 'revenue'],
    ['fuel_80', 'بنزين ٨٠', 'revenue'],
    ['fuel_92', 'بنزين ٩٢', 'revenue'],
    ['fuel_95', 'بنزين ٩٥', 'revenue'],
    ['oil_total', 'الزيوت', 'revenue'],
    ['wash_lube_month', 'غسيل و تشحيم', 'revenue'],
    ['bonuses', 'حوافز', 'revenue'],
    ['commission_diff', 'فرق العمولة', 'revenue'],
    ['total_positive', 'إجمالي الإيرادات', 'summary'],
    ['expenses_month', 'المصاريف', 'deduction'],
    ['cash_insurance_month', 'تأمين نقدى', 'deduction'],
    ['deposit_tax', 'ضريبة المنبع', 'deduction'],
    ['bonus_tax', 'ضرائب الحافز', 'deduction'],
    ['total_deductions', 'إجمالي الخصومات', 'summary'],
    ['net_profit', 'صافي المكسب', 'net']
  ];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value) {
    const numeric = Number(value);
    return numberFormatter.format(Number.isFinite(numeric) ? numeric : 0);
  }

  function formatMoney(value) {
    const numeric = Number(value);
    return moneyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
  }

  function formatWholeEgp(value) {
    if (value === undefined || value === null || value === '') return '-';
    const raw = String(value).trim();
    const amount = raw.replace(/[^\d,.-]/g, '');
    if (!amount) return raw;
    let normalized = amount;
    if (amount.includes(',') && amount.includes('.')) {
      normalized = amount.lastIndexOf(',') > amount.lastIndexOf('.')
        ? amount.replace(/\./g, '').replace(',', '.')
        : amount.replace(/,/g, '');
    } else if (amount.includes(',')) {
      normalized = amount.replace(',', '.');
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? `${Math.round(numeric)} جنيه مصري` : raw;
  }

  function formatCompactSurfaceLabel(value) {
    return String(value || '-')
      .replaceAll('فدان', 'ف')
      .replaceAll('قيراط', 'ق')
      .replaceAll('سهم', 'س');
  }

  function sumAmounts(rows) {
    return (rows || []).reduce((total, row) => total + (Number(row.amount) || 0), 0);
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleString('it-IT', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDay(value) {
    if (!value) return '-';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : escapeHtml(value);
  }

  function monthLabel(monthKey) {
    const monthIndex = parseInt(String(monthKey || '').slice(5, 7), 10) - 1;
    const year = String(monthKey || '').slice(0, 4);
    return `${monthNames[monthIndex] || monthKey} ${year}`;
  }

  function currentMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return {
      fromMonth: `${year}-01`,
      toMonth: `${year}-${month}`,
      startDate: `${year}-${month}-01`,
      endDate: new Date(year, now.getMonth() + 1, 0).toISOString().slice(0, 10),
      month: `${year}-${month}`
    };
  }

  function getMonthKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function getDaysInMonthKey(monthKey) {
    const [year, month] = String(monthKey || '').split('-').map((value) => parseInt(value, 10));
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

  function setLoading() {
    content.innerHTML = '<div class="loading">جار التحميل...</div>';
  }

  function setError(message) {
    content.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  }

  function setLastSync(value) {
    if (lastSync) lastSync.textContent = formatDate(value);
  }

  function buildUrl(base, params) {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  async function api(view, params = {}) {
    const query = { view, ...params };
    const primaryUrl = buildUrl(state.apiBase, query);
    let response = await fetch(primaryUrl, { method: 'GET', cache: 'no-store' });

    if (response.status === 404 && state.apiBase !== '/.netlify/functions/mobile-data') {
      state.apiBase = '/.netlify/functions/mobile-data';
      response = await fetch(buildUrl(state.apiBase, query), { method: 'GET', cache: 'no-store' });
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `http_${response.status}`);
    }
    return payload.data;
  }

  function table(headers, rows, emptyText = 'لا توجد بيانات', tableClass = '') {
    if (!rows.length) return `<div class="empty">${emptyText}</div>`;
    const wrapperClass = ['table-wrap', tableClass ? `${tableClass}-wrap` : ''].filter(Boolean).join(' ');
    return `
      <div class="${escapeHtml(wrapperClass)}">
        <table class="base-table ${escapeHtml(tableClass)}">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  }

  function landSeasonOptions() {
    const currentYear = new Date().getFullYear();
    const seasonYears = (state.landSeasons || [])
      .map((season) => parseInt(season.season_key, 10))
      .filter((year) => Number.isInteger(year));
    const selectedYear = parseInt(state.landSeasonKey, 10);
    const minYear = seasonYears.length ? Math.min(...seasonYears) : (Number.isInteger(selectedYear) ? selectedYear : currentYear);
    const maxYear = Math.max(
      currentYear,
      Number.isInteger(selectedYear) ? selectedYear : currentYear,
      seasonYears.length ? Math.max(...seasonYears) : currentYear
    ) + 1;
    const years = [];
    for (let year = minYear; year <= maxYear; year += 1) years.push(String(year));
    return years;
  }

  async function ensureLandSeasons() {
    if (state.landSeasons.length) return;
    try {
      const data = await api('land-seasons');
      state.landSeasons = Array.isArray(data.seasons) ? data.seasons : [];
    } catch (_error) {
      state.landSeasons = [];
    }
  }

  function landSeasonFilter(formId) {
    return `
      <form id="${formId}" class="filter-bar land-season-filter">
        <select name="season_key" aria-label="السنة">
          ${landSeasonOptions().map((year) => `<option value="${escapeHtml(year)}"${year === state.landSeasonKey ? ' selected' : ''}>${escapeHtml(year)}</option>`).join('')}
        </select>
      </form>
    `;
  }

  function wireLandSeasonFilter(formId, reload) {
    const form = document.getElementById(formId);
    if (!form) return;
    const select = form.querySelector('select[name="season_key"]');
    if (!select) return;
    select.addEventListener('change', () => {
      const selected = new FormData(form).get('season_key');
      state.landSeasonKey = String(selected || state.landSeasonKey || new Date().getFullYear());
      reload();
    });
  }

  function sectionCard(icon, title, body, titleActions = '') {
    const titleRowClass = ['card-title-row', titleActions ? 'has-title-actions' : ''].filter(Boolean).join(' ');
    return `
      <section class="card">
        <div class="${titleRowClass}">
          <h2 class="title-main"><span class="title-icon">${escapeHtml(icon)}</span>${escapeHtml(title)}</h2>
          ${titleActions}
        </div>
        ${body}
      </section>
    `;
  }

  function metric(label, value, icon = '📊') {
    const displayValue = value === undefined || value === null || value === '' ? '-' : value;
    return `
      <div class="metric">
        <div class="metric-icon">${escapeHtml(icon)}</div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(displayValue)}</strong>
      </div>
    `;
  }

  function monthFilter(formId, defaults, buttonText = 'تحديث', extra = '') {
    return `
      <form id="${formId}" class="filter-bar">
        <label>من شهر
          <input type="month" name="fromMonth" value="${escapeHtml(defaults.fromMonth)}">
        </label>
        <label>إلى شهر
          <input type="month" name="toMonth" value="${escapeHtml(defaults.toMonth)}">
        </label>
        ${extra}
        <button type="submit">${escapeHtml(buttonText)}</button>
      </form>
    `;
  }

  function renderBarChart(rows, valueKey = 'quantity') {
    const safeRows = Array.isArray(rows) ? rows.filter((row) => Number(row[valueKey]) > 0) : [];
    const max = Math.max(...safeRows.map((row) => Math.abs(Number(row[valueKey]) || 0)), 1);
    if (!safeRows.length) return '<div class="empty">لا توجد بيانات للرسم</div>';
    return `
      <div class="bar-chart">
        ${safeRows.map((row) => {
          const value = Number(row[valueKey]) || 0;
          const width = Math.max(2, Math.round((Math.abs(value) / max) * 100));
          return `
            <div class="bar-row">
              <span>${escapeHtml(row.name)}</span>
              <div class="bar-track"><span class="bar-fill" style="width: ${width}%"></span></div>
              <strong>${formatNumber(value)}</strong>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function landStatusLabel(status) {
    const labels = {
      unpaid: 'غير مدفوع',
      first_partial: 'القسط الأول جزئي',
      first_paid: 'تم دفع القسط الأول',
      second_partial: 'القسط الثاني جزئي',
      paid_full: 'مدفوع بالكامل',
      overpaid: 'دفعة زائدة',
      overdue: 'متأخر'
    };
    return labels[status] || status || '-';
  }

  function landItem(title, rows) {
    return `
      <div class="land-mobile-item">
        <strong>${escapeHtml(title)}</strong>
        ${rows.map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value ?? '-')}</span>`).join('')}
      </div>
    `;
  }

  function landDashboardMetricData(data = {}) {
    const plots = Array.isArray(data.plots) ? data.plots : [];
    const plotsCount = data.plots_count !== undefined && data.plots_count !== null
      ? Number(data.plots_count)
      : plots.length;
    const totalSahmLabel = data.total_sahm_label
      || (plots.length === 1 ? plots[0].total_sahm_label : '')
      || '0 فدان، 0 قيراط، 0 سهم';
    return {
      plotsCount: Number.isFinite(plotsCount) ? plotsCount : 0,
      totalSahmLabel
    };
  }

  function landDashboardContractGroups(assignments = []) {
    const groups = new Map();
    assignments.forEach((row) => {
      const plotName = row.plot_name || '-';
      if (!groups.has(plotName)) groups.set(plotName, []);
      groups.get(plotName).push(row);
    });
    return Array.from(groups.entries());
  }

  function renderLandDashboardContracts(assignments = []) {
    const groups = landDashboardContractGroups(assignments);
    if (!groups.length) return '<div class="empty">لا توجد عقود لهذا الموسم</div>';

    return `
      <div class="land-dashboard-contracts-grid" role="table" aria-label="العقود النشطة لهذا العام">
        <div class="land-dashboard-contracts-header" role="row">
          <span role="columnheader">المستأجر</span>
          <span role="columnheader">المساحة</span>
          <span role="columnheader">الإيجار</span>
          <span role="columnheader">المدفوع</span>
          <span role="columnheader">المتبقي</span>
          <span role="columnheader">الحالة</span>
        </div>
        ${groups.map(([plotName, rows]) => `
          <section class="land-dashboard-contract-group" role="rowgroup">
            <h3 class="land-dashboard-plot-title">${escapeHtml(plotName)}</h3>
            ${rows.map((row) => `
              <div class="land-dashboard-contract-row" role="row">
                <span class="tenant-name" role="cell">${escapeHtml(row.tenant_name || '-')}</span>
                <span role="cell">${escapeHtml(formatCompactSurfaceLabel(row.assigned_sahm_label))}</span>
                <span role="cell">${escapeHtml(formatWholeEgp(row.rent_egp))}</span>
                <span role="cell">${escapeHtml(formatWholeEgp(row.paid_egp))}</span>
                <span role="cell">${escapeHtml(formatWholeEgp(row.remaining_egp))}</span>
                <span role="cell">${escapeHtml(landStatusLabel(row.payment_status))}</span>
              </div>
            `).join('')}
          </section>
        `).join('')}
      </div>
    `;
  }

  async function loadLandDashboard() {
    setLoading();
    await ensureLandSeasons();
    const data = await api('land-dashboard', { season_key: state.landSeasonKey });
    const metricData = landDashboardMetricData(data);
    content.innerHTML = sectionCard('🌾', 'إدارة الأراضي', `
      <div class="grid two land-dashboard-metrics-grid">
        ${metric('عدد الأراضي', metricData.plotsCount, '📍')}
        ${metric('إجمالي المساحة', metricData.totalSahmLabel, '📐')}
        ${metric('الإيجار المتوقع', formatWholeEgp(data.expected_egp), '💰')}
        ${metric('المتبقي', formatWholeEgp(data.remaining_egp), '🧾')}
      </div>
      ${renderLandDashboardContracts(data.assignments || [])}
    `, landSeasonFilter('landDashboardSeasonForm'));
    wireLandSeasonFilter('landDashboardSeasonForm', loadLandDashboard);
  }

  async function loadLandPlots() {
    setLoading();
    try {
      await ensureLandSeasons();
      const data = await api('land-plots', { season_key: state.landSeasonKey });
      content.innerHTML = sectionCard('📍', 'قطع الأرض', `
        ${landSeasonFilter('landPlotsSeasonForm')}
        <div class="land-mobile-list">
          ${(data.plots || []).map((plot) => landItem(plot.name, [
            ['المساحة', plot.total_sahm_label],
            ['المؤجر', plot.rented_sahm_label],
            ['المتاح', plot.available_sahm_label],
            ['الإيجار المتوقع', plot.expected_rent_egp]
          ])).join('') || '<div class="empty">لا توجد أراض مسجلة</div>'}
        </div>
      `);
      wireLandSeasonFilter('landPlotsSeasonForm', loadLandPlots);
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function loadLandTenants() {
    setLoading();
    const data = await api('land-tenants');
    content.innerHTML = sectionCard('👥', 'المستأجرون', `
      <div class="land-mobile-list">
        ${(data.tenants || []).map((tenant) => landItem(tenant.full_name, [
          ['الهاتف', tenant.phone],
          ['العنوان', tenant.village_address],
          ['العقود', tenant.assignments_count],
          ['إجمالي الإيجار', tenant.total_rent_egp]
        ])).join('') || '<div class="empty">لا يوجد مستأجرون</div>'}
      </div>
    `);
  }

  async function loadLandReports() {
    setLoading();
    await ensureLandSeasons();
    const data = await api('land-reports', { kind: 'missing-payments', season_key: state.landSeasonKey });
    content.innerHTML = sectionCard('📋', 'المدفوعات الناقصة', `
      ${landSeasonFilter('landReportsSeasonForm')}
      <div class="land-mobile-list">
        ${(data.rows || []).map((row) => landItem(`${row.plot_name} - ${row.tenant_name}`, [
          ['المساحة', row.assigned_sahm_label],
          ['الإيجار', row.rent_egp],
          ['المدفوع', row.paid_egp],
          ['المتبقي', row.remaining_egp],
          ['الحالة', landStatusLabel(row.payment_status)]
        ])).join('') || '<div class="empty">لا توجد مدفوعات ناقصة</div>'}
      </div>
    `);
    wireLandSeasonFilter('landReportsSeasonForm', loadLandReports);
  }

  function renderHomeChartCanvas(chart) {
    if (!window.Chart || !chart?.months?.length) {
      return renderBarChart(chart?.rows || []);
    }

    window.requestAnimationFrame(() => {
      const canvas = document.getElementById('homeFuelSalesChart');
      if (!canvas) return;
      if (homeChart) homeChart.destroy();

      const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#2E7D32', '#C2185B'];
      const currentMonthKey = getMonthKey();
      const forecastMonthIndex = chart.months.indexOf(currentMonthKey);
      const registeredDays = Number(chart.salesDaysByMonth?.[currentMonthKey]) || 0;
      const hasForecast = forecastMonthIndex !== -1 && registeredDays > 0;
      const rows = (chart.rows || []).filter((row) => (
        chart.months.some((month) => Number(row.byMonth?.[month]) > 0)
      ));
      homeChart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: chart.months.map(monthLabel),
          datasets: rows.map((row, index) => {
            const data = chart.months.map((month) => Number(row.byMonth?.[month]) || 0);
            if (hasForecast) {
              data[forecastMonthIndex] = getCurrentMonthForecastValue(
                data[forecastMonthIndex],
                currentMonthKey,
                registeredDays
              );
            }
            return {
              label: row.name,
              data,
              borderColor: colors[index % colors.length],
              backgroundColor: colors[index % colors.length],
              borderWidth: 2,
              tension: 0.25,
              segment: hasForecast ? {
                borderDash: (context) => (
                  context.p1DataIndex === forecastMonthIndex ? [8, 5] : undefined
                )
              } : undefined
            };
          })
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: { family: 'Noto Naskh Arabic' } }
            },
            title: {
              display: true,
              text: 'كميات المبيعات الشهرية حسب نوع الوقود',
              font: { family: 'Noto Naskh Arabic', size: 16 }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'الكمية (لتر)', font: { family: 'Noto Naskh Arabic' } },
              ticks: { font: { family: 'Noto Naskh Arabic' } }
            },
            x: {
              ticks: { font: { family: 'Noto Naskh Arabic' } }
            }
          }
        }
      });
    });

    return '<div class="home-chart-box"><canvas id="homeFuelSalesChart"></canvas></div>';
  }

  async function loadOverview() {
    setLoading();
    const range = currentMonthRange();
    const data = await api('home-chart', { fromMonth: range.fromMonth, toMonth: range.toMonth });
    setLastSync(data.lastSync);
    const chart = data.chart || {};
    content.innerHTML = `
      ${sectionCard('📊', 'كميات المبيعات الشهرية حسب نوع الوقود', renderHomeChartCanvas(chart))}
    `;
  }

  async function loadSalesSummary() {
    const range = currentMonthRange();
    content.innerHTML = `
      ${monthFilter('salesSummaryFilter', range)}
      <div id="salesSummaryBody" class="loading">جار التحميل...</div>
    `;
    document.getElementById('salesSummaryFilter').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      renderSalesSummary(form.get('fromMonth'), form.get('toMonth'));
    });
    await renderSalesSummary(range.fromMonth, range.toMonth);
  }

  async function renderSalesSummary(fromMonth, toMonth) {
    const target = document.getElementById('salesSummaryBody');
    target.className = 'loading';
    target.textContent = 'جار التحميل...';
    const data = await api('sales-summary', { fromMonth, toMonth });
    setLastSync(data.lastSync);
    const summary = data.summary || {};
    const months = summary.months || [];
    let hasSeenOil = false;
    const rows = (summary.rows || []).map((row) => {
      const isFirstOil = row.type === 'oil' && !hasSeenOil;
      if (row.type === 'oil') hasSeenOil = true;
      return `
      <tr class="${isFirstOil ? 'sales-first-oil-row' : ''}">
        <td><strong>${escapeHtml(row.name)}</strong></td>
        ${months.map((month) => `<td>${formatNumber(row.byMonth?.[month] || 0)}</td>`).join('')}
        <td class="cell-total">${formatNumber(row.total)}</td>
      </tr>
    `;
    });
    target.className = 'section-stack';
    target.innerHTML = sectionCard(
      '📊',
      'ملخص المبيعات',
      table(['المنتج', ...months.map(monthLabel), 'الإجمالي'], rows, 'لا توجد بيانات', 'sales-summary-table financial-summary-table')
    );
  }

  async function loadProfit() {
    const range = currentMonthRange();
    content.innerHTML = `
      ${monthFilter('profitFilter', range)}
      <div id="profitBody" class="loading">جار التحميل...</div>
    `;
    document.getElementById('profitFilter').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      renderProfit(form.get('fromMonth'), form.get('toMonth'));
    });
    await renderProfit(range.fromMonth, range.toMonth);
  }

  async function renderProfit(fromMonth, toMonth) {
    const target = document.getElementById('profitBody');
    target.className = 'loading';
    target.textContent = 'جار التحميل...';
    const data = await api('profit', { fromMonth, toMonth });
    const rows = data.rows || [];
    const months = rows.map((row) => row.month_key).reverse();
    const byMonth = new Map(rows.map((row) => [row.month_key, row]));
    const tableRows = profitRows.map(([key, label, kind]) => `
      <tr class="profit-${kind}-row">
        <td><strong>${escapeHtml(label)}</strong></td>
        ${months.map((month) => `<td>${formatMoney(byMonth.get(month)?.[key] || 0)}</td>`).join('')}
      </tr>
    `);
    target.className = 'section-stack';
    target.innerHTML = sectionCard(
      '📈',
      'المكسب',
      table(['البند', ...months.map(monthLabel)], tableRows, 'لا توجد بيانات', 'profit-summary-table financial-summary-table')
    );
  }

  async function loadExpenses() {
    const range = currentMonthRange();
    const extra = `
      <label>بحث
        <input type="text" name="searchTerm" placeholder="اسم المصروف">
      </label>
    `;
    content.innerHTML = `
      ${monthFilter('expensesFilter', range, 'تحديث', extra)}
      <div id="expensesBody" class="loading">جار التحميل...</div>
    `;
    document.getElementById('expensesFilter').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      renderExpenses(form.get('fromMonth'), form.get('toMonth'), form.get('searchTerm'));
    });
    await renderExpenses(range.fromMonth, range.toMonth, '');
  }

  async function renderExpenses(fromMonth, toMonth, searchTerm) {
    const target = document.getElementById('expensesBody');
    target.className = 'loading';
    target.textContent = 'جار التحميل...';
    const data = await api('expenses', { fromMonth, toMonth, searchTerm });
    setLastSync(data.lastSync);
    const expenses = data.expenses || {};
    const months = expenses.months || [];
    const rows = (expenses.rows || []).map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.description)}</strong></td>
        ${months.map((month) => `<td>${row.byMonth?.[month] ? formatMoney(row.byMonth[month]) : ''}</td>`).join('')}
        <td class="cell-total">${formatMoney(row.total)}</td>
      </tr>
    `);
    target.className = 'section-stack';
    target.innerHTML = sectionCard(
      '📉',
      'المصاريف',
      table(['المصروف', ...months.map(monthLabel), 'الإجمالي'], rows, 'لا توجد بيانات', 'expenses-summary-table financial-summary-table')
    );
  }

  async function loadAnnualInventory() {
    setLoading();
    const data = await api('annual-inventory');
    setLastSync(data.lastSync);
    renderAnnualInventory(data.annual);
  }

  function annualFieldRows(record, fields) {
    return fields.map(([key, label]) => `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${formatMoney(record?.fields?.[key] || 0)}</td>
      </tr>
    `);
  }

  function annualCustomRows(items) {
    return (items || []).map((item) => `
      <tr>
        <td>${escapeHtml(item.label || 'بند إضافي')}</td>
        <td>${formatMoney(item.value)}</td>
      </tr>
    `);
  }

  function renderAnnualInventory(annual) {
    const record = annual?.record;
    if (!record) {
      content.innerHTML = sectionCard('📒', 'جرد سنوي', '<div class="empty">لا توجد بيانات جرد سنوي محفوظة</div>');
      return;
    }

    const expectedRows = [
      ...annualFieldRows(record, [
        ['prev_balance', 'رصيد العام السابق'],
        ['station_profit', 'مكسب المحطة']
      ]),
      ...annualCustomRows(record.expected_items),
      `<tr><td><strong>المفترض وجوده</strong></td><td><strong>${formatMoney(record.expected_total)}</strong></td></tr>`
    ];
    const actualRows = [
      ...annualFieldRows(record, [
        ['bank_balance', 'رصيد البنك'],
        ['safe_balance', 'رصيد الخزنة'],
        ['accounting_remainder', 'متبقى المحاسبة'],
        ['customers_balance', 'العملاء'],
        ['vouchers_balance', 'البونات'],
        ['visa_balance', 'رصيد الفيزا']
      ]),
      ...annualCustomRows(record.actual_items),
      `<tr><td><strong>إجمالي رأس المال</strong></td><td><strong>${formatMoney(record.actual_total)}</strong></td></tr>`
    ];
    const statusLabel = record.status === 'surplus' ? 'زيادة' : (record.status === 'shortage' ? 'عجز' : 'متوازن');
    content.innerHTML = `
      <section class="grid two">
        ${metric('السنة', record.year, '📅')}
        ${metric('الحالة', `${statusLabel}${record.finalized ? ' - مقفل' : ''}`, '📒')}
        ${metric('الفرق', formatMoney(Math.abs(record.difference)), '⚖️')}
        ${metric('آخر تحديث', formatDate(record.updated_at), '🔄')}
      </section>
      ${sectionCard('📒', 'الرصيد المفترض', table(['البند', 'القيمة'], expectedRows))}
      ${sectionCard('💰', 'الرصيد الفعلي', table(['البند', 'القيمة'], actualRows))}
    `;
  }

  async function loadShiftDaySummaries() {
    setLoading();
    const data = await api('shift-day-summaries', { limit: 45 });
    setLastSync(data.lastSync);
    const days = data.summaries?.days || [];
    state.shiftDays = days;
    if (!days.length) {
      content.innerHTML = '<div class="empty">لا توجد ورديات محفوظة</div>';
      return;
    }
    content.innerHTML = days.map(renderShiftDayCard).join('');
    wireShiftTotalButtons();
  }

  function renderShiftDayCard(day, index) {
    return `
      <section class="card shift-day-card">
        <div class="shift-day-heading">
          <span class="title-main"><span class="title-icon">📋</span>${formatDay(day.date)}</span>
        </div>
        <section class="shift-day-totals" aria-label="إجماليات اليوم">
          <button class="shift-total-box shift-total-button" type="button" data-shift-day-index="${index}" data-summary-kind="revenues">
            <span class="shift-total-icon">💵</span>
            <span>إجمالي الإيرادات</span>
            <strong>${formatMoney(day.totals.revenue)}</strong>
          </button>
          <button class="shift-total-box shift-total-button" type="button" data-shift-day-index="${index}" data-summary-kind="expenses">
            <span class="shift-total-icon">📉</span>
            <span>إجمالي المصاريف</span>
            <strong>${formatMoney(day.totals.expenses)}</strong>
          </button>
          <div class="shift-total-box">
            <span class="shift-total-icon">📈</span>
            <span>صافي اليوم</span>
            <strong>${formatMoney(day.totals.net)}</strong>
          </div>
        </section>
      </section>
    `;
  }

  function renderShiftRevenueSummary(shift) {
    const revenueRows = (shift.revenues || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${row.quantity === null || row.quantity === undefined ? '-' : formatNumber(row.quantity)}</td>
        <td>${formatMoney(row.amount)}</td>
      </tr>
    `);
    return `
      <div class="shift-summary-box">
        <h3><span>${escapeHtml(shift.label)}</span><strong>${formatMoney(sumAmounts(shift.revenues))}</strong></h3>
        ${table(['المنتج', 'الكمية', 'القيمة'], revenueRows)}
      </div>
    `;
  }

  function renderShiftExpenseSummary(shift) {
    const expenseRows = (shift.expenses || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${formatMoney(row.amount)}</td>
      </tr>
    `);
    return `
      <div class="shift-summary-box">
        <h3><span>${escapeHtml(shift.label)}</span><strong>${formatMoney(sumAmounts(shift.expenses))}</strong></h3>
        ${table(['المصاريف', 'القيمة'], expenseRows, 'لا توجد مصاريف')}
      </div>
    `;
  }

  function openShiftSummaryModal(dayIndex, kind) {
    const day = state.shiftDays[Number(dayIndex)];
    if (!day || !shiftSummaryDialogBody) return;

    const isRevenue = kind === 'revenues';
    const title = isRevenue ? 'الإيرادات' : 'المصاريف';
    const total = isRevenue ? day.totals.revenue : day.totals.expenses;
    const sections = (day.shifts || [])
      .map((shift) => isRevenue ? renderShiftRevenueSummary(shift) : renderShiftExpenseSummary(shift))
      .join('');

    shiftSummaryDialogBody.innerHTML = `
      <div class="modal-title-row">
        <h2>${title} - ${formatDay(day.date)}</h2>
        <strong>${formatMoney(total)}</strong>
      </div>
      <div class="modal-section-stack">
        ${sections || '<div class="empty">لا توجد بيانات</div>'}
      </div>
    `;

    if (shiftSummaryDialog?.showModal) {
      shiftSummaryDialog.showModal();
    } else {
      shiftSummaryDialog?.setAttribute('open', '');
    }
  }

  function closeSummaryModal() {
    if (shiftSummaryDialog?.open && shiftSummaryDialog.close) {
      shiftSummaryDialog.close();
    } else {
      shiftSummaryDialog?.removeAttribute('open');
    }
  }

  function wireShiftTotalButtons() {
    document.querySelectorAll('.shift-total-button').forEach((button) => {
      button.addEventListener('click', () => {
        openShiftSummaryModal(button.dataset.shiftDayIndex, button.dataset.summaryKind);
      });
    });
  }

  function errorMessage(error) {
    const code = error?.message || '';
    if (code === 'server_error') return 'حدث خطأ في قراءة قاعدة البيانات.';
    return 'تعذر تحميل البيانات.';
  }

  async function loadView(view) {
    state.currentView = view;
    document.querySelectorAll('.tabs button[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });

    try {
      if (view === 'overview') await loadOverview();
      if (view === 'sales-summary') await loadSalesSummary();
      if (view === 'profit') await loadProfit();
      if (view === 'expenses') await loadExpenses();
      if (view === 'annual-inventory') await loadAnnualInventory();
      if (view === 'shift-day-summaries') await loadShiftDaySummaries();
      if (view === 'land-dashboard') await loadLandDashboard();
      if (view === 'land-plots') await loadLandPlots();
      if (view === 'land-tenants') await loadLandTenants();
      if (view === 'land-reports') await loadLandReports();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  function switchModule(moduleName) {
    state.currentModule = moduleName === 'land' ? 'land' : 'fuel';
    document.body.classList.toggle('mobile-module-land', state.currentModule === 'land');
    if (appTitle) {
      appTitle.textContent = state.currentModule === 'land'
        ? 'إدارة الأراضي الزراعية'
        : 'محطة بنزين سمنود - الجمعية التعاونية للبترول';
    }
    moduleButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.module === state.currentModule);
    });
    loadView(state.currentModule === 'land' ? 'land-dashboard' : 'overview');
  }

  moduleButtons.forEach((button) => {
    button.addEventListener('click', () => switchModule(button.dataset.module));
  });

  document.querySelectorAll('.tabs button[data-view]').forEach((button) => {
    button.addEventListener('click', () => loadView(button.dataset.view));
  });

  closeShiftSummaryDialog?.addEventListener('click', closeSummaryModal);
  shiftSummaryDialog?.addEventListener('click', (event) => {
    if (event.target === shiftSummaryDialog) closeSummaryModal();
  });

  loadView('overview');
})();
