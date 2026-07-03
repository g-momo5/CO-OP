(() => {
  const state = {
    token: getTokenFromUrl(),
    apiBase: '/api/mobile-data',
    currentView: 'overview'
  };

  const content = document.getElementById('content');
  const lastSync = document.getElementById('lastSync');
  const dialog = document.getElementById('shiftDialog');
  const shiftDetail = document.getElementById('shiftDetail');
  const closeDialog = document.getElementById('closeShiftDialog');

  const numberFormatter = new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: 2
  });

  const moneyFormatter = new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });

  function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get('token');
    if (queryToken) return queryToken.trim();

    const parts = window.location.pathname.split('/').filter(Boolean);
    const index = parts.indexOf('m');
    if (index !== -1 && parts[index + 1]) {
      return decodeURIComponent(parts[index + 1]).trim();
    }
    return '';
  }

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

  function todayMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const endDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(endDay).padStart(2, '0')}`,
      month: `${year}-${month}`
    };
  }

  function setLoading() {
    content.innerHTML = '<div class="loading">جار التحميل...</div>';
  }

  function setError(message) {
    content.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  }

  function buildUrl(base, params) {
    const url = new URL(base, window.location.origin);
    Object.entries({ token: state.token, ...params }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  async function api(view, params = {}) {
    if (!state.token) {
      throw new Error('token_missing');
    }

    const query = { view, ...params };
    const primaryUrl = buildUrl(state.apiBase, query);
    let response = await fetch(primaryUrl, { method: 'GET', cache: 'no-store' });

    if (response.status === 404 && state.apiBase !== '/.netlify/functions/mobile-data') {
      state.apiBase = '/.netlify/functions/mobile-data';
      response = await fetch(buildUrl(state.apiBase, query), { method: 'GET', cache: 'no-store' });
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const error = payload.error || `http_${response.status}`;
      throw new Error(error);
    }
    return payload.data;
  }

  function table(headers, rows, emptyText = 'لا توجد بيانات') {
    if (!rows.length) {
      return `<div class="empty">${emptyText}</div>`;
    }
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  }

  function metric(label, value) {
    return `
      <div class="card metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function shiftLabel(shiftNumber) {
    return Number(shiftNumber) === 2 ? 'وردية ليل' : 'وردية صباح';
  }

  function renderShiftRows(shifts) {
    if (!shifts.length) return '<div class="empty">لا توجد ورديات محفوظة</div>';
    return `
      <div class="grid">
        ${shifts.map((shift) => `
          <button class="row-button" data-shift-date="${escapeHtml(shift.date)}" data-shift-number="${escapeHtml(shift.shift_number)}">
            <strong>${formatDay(shift.date)} - ${shiftLabel(shift.shift_number)}</strong>
            <span>الإجمالي: ${formatMoney(shift.grand_total)} | الوقود: ${formatMoney(shift.fuel_total)} | الزيوت: ${formatMoney(shift.oil_total)}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderStockTables(data) {
    const fuelRows = (data.fuelStock || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${formatNumber(row.incoming)}</td>
        <td>${formatNumber(row.outgoing)}</td>
        <td>${formatNumber(row.balance)}</td>
      </tr>
    `);
    const oilRows = (data.oilStock || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${formatNumber(row.incoming)}</td>
        <td>${formatNumber(row.outgoing)}</td>
        <td>${formatNumber(row.balance)}</td>
      </tr>
    `);
    return `
      <section class="card">
        <h2>رصيد الوقود</h2>
        ${table(['الصنف', 'وارد', 'منصرف', 'الرصيد'], fuelRows)}
      </section>
      <section class="card">
        <h2>رصيد الزيوت</h2>
        ${table(['الصنف', 'وارد', 'منصرف', 'الرصيد'], oilRows)}
      </section>
    `;
  }

  function renderBarChart(rows, valueKey = 'value') {
    const values = rows.map((row) => Math.abs(Number(row[valueKey]) || 0));
    const max = Math.max(...values, 1);
    if (!rows.length) return '<div class="empty">لا توجد بيانات للرسم</div>';
    return `
      <div class="bar-chart">
        ${rows.map((row) => {
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

  function renderOverview(data) {
    lastSync.textContent = formatDate(data.lastSync);
    const report = data.monthReport || { totals: {}, shift_count: 0 };
    content.innerHTML = `
      <section class="grid two">
        ${metric('صافي الشهر', formatMoney(report.totals?.net))}
        ${metric('رصيد الخزنة', formatMoney(data.safeBalance))}
        ${metric('عدد الورديات هذا الشهر', formatNumber(report.shift_count))}
        ${metric('آخر تحديث', formatDate(data.lastSync))}
      </section>
      <section class="card">
        <h2>آخر الورديات</h2>
        ${renderShiftRows(data.latestShifts || [])}
      </section>
      ${renderStockTables({ fuelStock: data.fuelStock || [], oilStock: data.oilStock || [] })}
      <section class="card">
        <h2>آخر حركات الخزنة</h2>
        ${renderSafeMovements(data.recentSafeMovements || [])}
      </section>
    `;
    wireShiftButtons();
  }

  function renderSafeMovements(movements) {
    const rows = movements.map((row) => `
      <tr>
        <td>${formatDay(row.date)}</td>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.direction === 'out' ? 'منصرف' : 'وارد'}</td>
        <td>${formatMoney(row.amount)}</td>
      </tr>
    `);
    return table(['التاريخ', 'البيان', 'النوع', 'المبلغ'], rows);
  }

  async function loadOverview() {
    setLoading();
    const data = await api('overview');
    renderOverview(data);
  }

  async function loadShifts() {
    setLoading();
    const data = await api('shifts', { limit: 80 });
    content.innerHTML = `
      <section class="card">
        <h2>سجل الورديات</h2>
        ${renderShiftRows(data.shifts || [])}
      </section>
    `;
    wireShiftButtons();
  }

  function wireShiftButtons() {
    content.querySelectorAll('[data-shift-date]').forEach((button) => {
      button.addEventListener('click', () => {
        openShift(button.dataset.shiftDate, button.dataset.shiftNumber);
      });
    });
  }

  async function openShift(date, shiftNumber) {
    shiftDetail.innerHTML = '<div class="loading">جار التحميل...</div>';
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }

    try {
      const data = await api('shift-detail', { date, shiftNumber });
      if (!data.shift) {
        shiftDetail.innerHTML = '<div class="empty">لم يتم العثور على الوردية</div>';
        return;
      }
      shiftDetail.innerHTML = renderShiftDetail(data.shift);
    } catch (error) {
      shiftDetail.innerHTML = `<div class="error">${errorMessage(error)}</div>`;
    }
  }

  function renderShiftDetail(shift) {
    const fuelRows = Object.entries(shift.fuel_data || {}).map(([name, data]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${formatNumber(data?.totalQuantity)}</td>
        <td>${formatNumber(data?.cars)}</td>
        <td>${formatMoney(data?.total)}</td>
      </tr>
    `);
    const oilRows = Object.entries(shift.oil_data || {}).map(([name, data]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${formatNumber(data?.incoming)}</td>
        <td>${formatNumber(data?.sold)}</td>
        <td>${formatMoney(data?.total)}</td>
      </tr>
    `);
    const expenseRows = (shift.expense_items || []).map((item) => `
      <tr>
        <td>${escapeHtml(item.description || `مصروف ${item.index}`)}</td>
        <td>${formatMoney(item.amount)}</td>
      </tr>
    `);
    const revenueRows = (shift.revenue_items || []).map((item) => `
      <tr>
        <td>${escapeHtml(item.description || `إيراد ${item.index}`)}</td>
        <td>${formatMoney(item.amount)}</td>
      </tr>
    `);

    return `
      <div class="section-stack">
        <section>
          <h2>${formatDay(shift.date)} - ${shiftLabel(shift.shift_number)}</h2>
          <p class="meta">الإجمالي: ${formatMoney(shift.grand_total)} | الوقود: ${formatMoney(shift.fuel_total)} | الزيوت: ${formatMoney(shift.oil_total)} | غسيل وتشحيم: ${formatMoney(shift.wash_lube_revenue)} | مصروفات: ${formatMoney(shift.total_expenses)}</p>
        </section>
        <section>
          <h3>الوقود</h3>
          ${table(['الصنف', 'الكمية', 'عملاء', 'الإجمالي'], fuelRows)}
        </section>
        <section>
          <h3>الزيوت</h3>
          ${table(['الصنف', 'وارد', 'مباع', 'الإجمالي'], oilRows)}
        </section>
        <section>
          <h3>إيرادات أخرى</h3>
          ${table(['البيان', 'المبلغ'], revenueRows)}
        </section>
        <section>
          <h3>مصروفات</h3>
          ${table(['البيان', 'المبلغ'], expenseRows)}
        </section>
      </div>
    `;
  }

  async function loadReport() {
    const range = todayMonthRange();
    content.innerHTML = `
      <form id="reportFilter" class="filter-bar">
        <label>من
          <input type="date" name="startDate" value="${range.startDate}">
        </label>
        <label>إلى
          <input type="date" name="endDate" value="${range.endDate}">
        </label>
        <button type="submit">تحديث</button>
      </form>
      <div id="reportBody" class="loading">جار التحميل...</div>
    `;
    document.getElementById('reportFilter').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      renderReport(form.get('startDate'), form.get('endDate'));
    });
    await renderReport(range.startDate, range.endDate);
  }

  async function renderReport(startDate, endDate) {
    const target = document.getElementById('reportBody');
    target.className = 'loading';
    target.textContent = 'جار التحميل...';
    const data = await api('report', { startDate, endDate });
    const report = data.report || {};
    const totals = report.totals || {};
    const fuelRows = (report.fuelTotals || []).map((row) => `
      <tr><td>${escapeHtml(row.name)}</td><td>${formatNumber(row.quantity)}</td></tr>
    `);
    const oilRows = (report.oilTotals || []).map((row) => `
      <tr><td>${escapeHtml(row.name)}</td><td>${formatNumber(row.quantity)}</td></tr>
    `);
    target.className = 'section-stack';
    target.innerHTML = `
      <section class="grid two">
        ${metric('عدد الورديات', formatNumber(report.shift_count))}
        ${metric('إجمالي الوقود', formatMoney(totals.fuelRevenue))}
        ${metric('إجمالي الزيوت', formatMoney(totals.oilRevenue))}
        ${metric('غسيل وتشحيم', formatMoney(totals.washRevenue))}
        ${metric('المصروفات', formatMoney(totals.expenses))}
        ${metric('الصافي', formatMoney(totals.net))}
      </section>
      <section class="card">
        <h2>كميات الوقود</h2>
        ${table(['الصنف', 'الكمية'], fuelRows)}
      </section>
      <section class="card">
        <h2>كميات الزيوت</h2>
        ${table(['الصنف', 'الكمية'], oilRows)}
      </section>
    `;
  }

  async function loadStock() {
    setLoading();
    const data = await api('stock');
    content.innerHTML = renderStockTables(data);
  }

  async function loadCharts() {
    setLoading();
    const range = todayMonthRange();
    const data = await api('report', { startDate: range.startDate, endDate: range.endDate });
    const report = data.report || {};
    const totals = report.totals || {};
    const revenueRows = [
      { name: 'وقود', value: totals.fuelRevenue },
      { name: 'زيوت', value: totals.oilRevenue },
      { name: 'غسيل وتشحيم', value: totals.washRevenue },
      { name: 'مصروفات', value: totals.expenses },
      { name: 'الصافي', value: totals.net }
    ];
    content.innerHTML = `
      <section class="card">
        <h2>ملخص الشهر الحالي</h2>
        ${renderBarChart(revenueRows)}
      </section>
      <section class="card">
        <h2>كميات الوقود</h2>
        ${renderBarChart(report.fuelTotals || [], 'quantity')}
      </section>
      <section class="card">
        <h2>كميات الزيوت</h2>
        ${renderBarChart(report.oilTotals || [], 'quantity')}
      </section>
    `;
  }

  async function loadSafeBook() {
    setLoading();
    const data = await api('safe-book', { limit: 160 });
    content.innerHTML = `
      <section class="grid two">
        ${metric('رصيد الخزنة', formatMoney(data.balance))}
        ${metric('عدد الحركات المعروضة', formatNumber((data.movements || []).length))}
      </section>
      <section class="card">
        <h2>حركات الخزنة</h2>
        ${renderSafeMovements(data.movements || [])}
      </section>
    `;
  }

  async function loadProfit() {
    const range = todayMonthRange();
    content.innerHTML = `
      <form id="profitFilter" class="filter-bar">
        <label>من شهر
          <input type="month" name="fromMonth" value="${range.month.slice(0, 4)}-01">
        </label>
        <label>إلى شهر
          <input type="month" name="toMonth" value="${range.month}">
        </label>
        <button type="submit">تحديث</button>
      </form>
      <div id="profitBody" class="loading">جار التحميل...</div>
    `;
    document.getElementById('profitFilter').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      renderProfit(form.get('fromMonth'), form.get('toMonth'));
    });
    await renderProfit(`${range.month.slice(0, 4)}-01`, range.month);
  }

  async function renderProfit(fromMonth, toMonth) {
    const target = document.getElementById('profitBody');
    target.className = 'loading';
    target.textContent = 'جار التحميل...';
    const data = await api('profit', { fromMonth, toMonth });
    const rows = (data.rows || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.month_key)}</td>
        <td>${formatMoney(row.fuel_total)}</td>
        <td>${formatMoney(row.oil_total)}</td>
        <td>${formatMoney(row.wash_lube_revenue)}</td>
        <td>${formatMoney(row.total_deductions ?? row.total_expenses)}</td>
        <td>${formatMoney(row.net_profit)}</td>
      </tr>
    `);
    target.className = 'card';
    target.innerHTML = `
      <h2>ملخص الأرباح</h2>
      ${table(['الشهر', 'وقود', 'زيوت', 'غسيل', 'خصومات', 'الصافي'], rows)}
    `;
  }

  async function loadPrices() {
    setLoading();
    const data = await api('prices');
    const fuelRows = (data.fuels || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${formatMoney(row.price)}</td>
        <td>${row.is_active ? 'نعم' : 'لا'}</td>
      </tr>
    `);
    const oilRows = (data.oils || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${formatMoney(row.price)}</td>
        <td>${formatNumber(row.vat)}</td>
        <td>${row.is_active ? 'نعم' : 'لا'}</td>
      </tr>
    `);
    content.innerHTML = `
      <section class="card">
        <h2>أسعار الوقود</h2>
        ${table(['الصنف', 'السعر', 'نشط'], fuelRows)}
      </section>
      <section class="card">
        <h2>أسعار الزيوت</h2>
        ${table(['الصنف', 'السعر', 'ضريبة', 'نشط'], oilRows)}
      </section>
    `;
  }

  function errorMessage(error) {
    const code = error?.message || '';
    if (code === 'token_missing') return 'افتح الرابط السري بالشكل /m/TOKEN';
    if (code === 'unauthorized') return 'الرابط السري غير صحيح.';
    if (code === 'mobile_secret_not_configured') return 'MOBILE_SECRET_TOKEN غير مضبوط على الاستضافة.';
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
      if (view === 'shifts') await loadShifts();
      if (view === 'report') await loadReport();
      if (view === 'charts') await loadCharts();
      if (view === 'stock') await loadStock();
      if (view === 'safe-book') await loadSafeBook();
      if (view === 'profit') await loadProfit();
      if (view === 'prices') await loadPrices();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => loadView(button.dataset.view));
  });

  closeDialog.addEventListener('click', () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });

  if (!state.token) {
    setError('افتح الرابط السري بالشكل /m/TOKEN');
    return;
  }

  loadView('overview');
})();
