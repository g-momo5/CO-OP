(() => {
  const state = {
    apiBase: '/api/mobile-data',
    currentView: 'overview',
    shiftDays: []
  };

  const content = document.getElementById('content');
  const lastSync = document.getElementById('lastSync');
  const shiftSummaryDialog = document.getElementById('shiftSummaryDialog');
  const shiftSummaryDialogBody = document.getElementById('shiftSummaryDialogBody');
  const closeShiftSummaryDialog = document.getElementById('closeShiftSummaryDialog');
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
    return `
      <div class="table-wrap">
        <table class="base-table ${escapeHtml(tableClass)}">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  }

  function sectionCard(icon, title, body) {
    return `
      <section class="card">
        <div class="card-title-row">
          <h2 class="title-main"><span class="title-icon">${escapeHtml(icon)}</span>${escapeHtml(title)}</h2>
        </div>
        ${body}
      </section>
    `;
  }

  function metric(label, value, icon = '📊') {
    return `
      <div class="metric">
        <div class="metric-icon">${escapeHtml(icon)}</div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
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

  function renderHomeChartCanvas(chart) {
    if (!window.Chart || !chart?.months?.length) {
      return renderBarChart(chart?.rows || []);
    }

    window.requestAnimationFrame(() => {
      const canvas = document.getElementById('homeFuelSalesChart');
      if (!canvas) return;
      if (homeChart) homeChart.destroy();

      const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#2E7D32', '#C2185B'];
      const rows = (chart.rows || []).filter((row) => Number(row.quantity) > 0);
      homeChart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: chart.months.map(monthLabel),
          datasets: rows.map((row, index) => ({
            label: row.name,
            data: chart.months.map((month) => Number(row.byMonth?.[month]) || 0),
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length],
            borderWidth: 2,
            tension: 0.25
          }))
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
    document.querySelectorAll('.tabs button').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });

    try {
      if (view === 'overview') await loadOverview();
      if (view === 'sales-summary') await loadSalesSummary();
      if (view === 'profit') await loadProfit();
      if (view === 'expenses') await loadExpenses();
      if (view === 'annual-inventory') await loadAnnualInventory();
      if (view === 'shift-day-summaries') await loadShiftDaySummaries();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => loadView(button.dataset.view));
  });

  closeShiftSummaryDialog?.addEventListener('click', closeSummaryModal);
  shiftSummaryDialog?.addEventListener('click', (event) => {
    if (event.target === shiftSummaryDialog) closeSummaryModal();
  });

  loadView('overview');
})();
