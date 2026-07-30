(() => {
  const ui = window.CoopReadonlyUI;
  if (!ui) {
    throw new Error('CoopReadonlyUI is not loaded');
  }

  const state = {
    apiBase: '/api/mobile-data',
    currentModule: 'fuel',
    currentView: 'overview',
    landSeasonKey: String(new Date().getFullYear()),
    landSeasons: [],
    shiftDays: [],
    shiftSelectedDate: '',
    shiftCalendarMonth: '',
    shiftVisibleCount: 10,
    shiftPageSize: 10,
    shiftLoadScrollHandler: null
  };

  const content = document.getElementById('content');
  const appTitle = document.querySelector('.app-title');
  const lastSync = document.getElementById('lastSync');
  const shiftSummaryDialog = document.getElementById('shiftSummaryDialog');
  const shiftSummaryDialogBody = document.getElementById('shiftSummaryDialogBody');
  const closeShiftSummaryDialog = document.getElementById('closeShiftSummaryDialog');
  const moduleButtons = document.querySelectorAll('[data-module]');
  const homeChartRef = { current: null };

  function disconnectShiftLoadHandler() {
    if (!state.shiftLoadScrollHandler) return;
    window.removeEventListener('scroll', state.shiftLoadScrollHandler);
    state.shiftLoadScrollHandler = null;
  }

  function setLoading() {
    disconnectShiftLoadHandler();
    content.innerHTML = '<div class="loading">جار التحميل...</div>';
  }

  function setError(message) {
    content.innerHTML = `<div class="error">${ui.escapeHtml(message)}</div>`;
  }

  function setLastSync(value) {
    if (lastSync) lastSync.textContent = ui.formatDate(value);
  }

  function setAppTitleLines(lines) {
    if (!appTitle) return;
    appTitle.innerHTML = lines
      .map((line) => `<span>${ui.escapeHtml(line)}</span>`)
      .join('');
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

  async function ensureLandSeasons() {
    if (state.landSeasons.length) return;
    try {
      const data = await api('land-seasons');
      state.landSeasons = Array.isArray(data.seasons) ? data.seasons : [];
    } catch (_error) {
      state.landSeasons = [];
    }
  }

  function wireMonthFilter(formId, render) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      render(form.get('fromMonth'), form.get('toMonth'));
    });
  }

  function wireLandSeasonFilter(formId, reload) {
    const form = document.getElementById(formId);
    const select = form?.querySelector('select[name="season_key"]');
    if (!select) return;
    select.addEventListener('change', () => {
      const selected = new FormData(form).get('season_key');
      state.landSeasonKey = String(selected || state.landSeasonKey || new Date().getFullYear());
      reload();
    });
  }

  function keepActiveNavigationVisible() {
    requestAnimationFrame(() => {
      const activeButton = document.querySelector('.bottom-navigation button[data-view].active');
      const navigation = activeButton?.closest('.bottom-navigation');
      if (!activeButton || !navigation) return;
      const navRect = navigation.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      const padding = 12;
      if (buttonRect.left < navRect.left + padding) {
        navigation.scrollBy({ left: buttonRect.left - navRect.left - padding, behavior: 'smooth' });
      } else if (buttonRect.right > navRect.right - padding) {
        navigation.scrollBy({ left: buttonRect.right - navRect.right + padding, behavior: 'smooth' });
      }
    });
  }

  function scrollLandTablesToStart() {
    requestAnimationFrame(() => {
      content.querySelectorAll('.land-dashboard-contracts-table-wrap').forEach((tableWrap) => {
        tableWrap.scrollLeft = tableWrap.scrollWidth;
      });
    });
  }

  function closeChartZoomDialog() {
    const dialog = document.getElementById('chartZoomDialog');
    if (!dialog) return;
    if (dialog.open && dialog.close) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function getChartZoomDialog() {
    let dialog = document.getElementById('chartZoomDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'chartZoomDialog';
    dialog.className = 'mobile-modal chart-zoom-modal';
    dialog.innerHTML = `
      <div class="mobile-modal-panel chart-zoom-panel">
        <button class="modal-close chart-zoom-close" type="button" aria-label="Close">×</button>
        <div class="chart-zoom-scroll"></div>
      </div>
    `;
    dialog.querySelector('.chart-zoom-close')?.addEventListener('click', closeChartZoomDialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeChartZoomDialog();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function openChartZoomDialog() {
    const sourceChart = content.querySelector('.readonly-line-chart');
    if (!sourceChart) return;
    const dialog = getChartZoomDialog();
    const target = dialog.querySelector('.chart-zoom-scroll');
    if (!target) return;
    target.innerHTML = sourceChart.outerHTML;
    target.querySelector('[data-chart-expand]')?.remove();
    if (dialog.showModal) {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    requestAnimationFrame(() => {
      target.scrollLeft = 0;
    });
  }

  async function loadOverview() {
    setLoading();
    const range = ui.currentMonthRange();
    const data = await api('home-chart', { fromMonth: range.fromMonth, toMonth: range.toMonth });
    setLastSync(data.lastSync);
    content.innerHTML = ui.renderOverview(data);
    requestAnimationFrame(() => ui.mountHomeChart(data.chart || {}, homeChartRef));
  }

  async function loadSalesSummary() {
    const range = ui.currentMonthRange();
    content.innerHTML = `
      ${ui.monthFilter('salesSummaryFilter', range)}
      <div id="salesSummaryBody" class="loading">جار التحميل...</div>
    `;
    wireMonthFilter('salesSummaryFilter', renderSalesSummary);
    await renderSalesSummary(range.fromMonth, range.toMonth);
  }

  async function renderSalesSummary(fromMonth, toMonth) {
    const target = document.getElementById('salesSummaryBody');
    target.className = 'section-stack';
    target.textContent = 'جار التحميل...';
    const data = await api('sales-summary', { fromMonth, toMonth });
    setLastSync(data.lastSync);
    target.innerHTML = ui.renderSalesSummary(data);
  }

  async function loadProfit() {
    const range = ui.currentMonthRange();
    content.innerHTML = `
      ${ui.monthFilter('profitFilter', range)}
      <div id="profitBody" class="loading">جار التحميل...</div>
    `;
    wireMonthFilter('profitFilter', renderProfit);
    await renderProfit(range.fromMonth, range.toMonth);
  }

  async function renderProfit(fromMonth, toMonth) {
    const target = document.getElementById('profitBody');
    target.className = 'section-stack';
    target.textContent = 'جار التحميل...';
    const data = await api('profit', { fromMonth, toMonth });
    setLastSync(data.lastSync);
    target.innerHTML = ui.renderProfit(data);
  }

  async function loadExpenses() {
    const range = ui.currentMonthRange();
    const extra = `
      <label>بحث
        <input type="text" name="searchTerm" placeholder="اسم المصروف">
      </label>
    `;
    content.innerHTML = `
      ${ui.monthFilter('expensesFilter', range, 'تحديث', extra)}
      <div id="expensesBody" class="loading">جار التحميل...</div>
    `;
    const expensesFilter = document.getElementById('expensesFilter');
    expensesFilter?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      renderExpenses(form.get('fromMonth'), form.get('toMonth'), form.get('searchTerm'));
    });
    await renderExpenses(range.fromMonth, range.toMonth, '');
  }

  async function renderExpenses(fromMonth, toMonth, searchTerm) {
    const target = document.getElementById('expensesBody');
    target.className = 'section-stack';
    target.textContent = 'جار التحميل...';
    const data = await api('expenses', { fromMonth, toMonth, searchTerm });
    setLastSync(data.lastSync);
    target.innerHTML = ui.renderExpenses(data);
  }

  async function loadAnnualInventory() {
    setLoading();
    const data = await api('annual-inventory');
    setLastSync(data.lastSync);
    content.innerHTML = ui.renderAnnualInventory(data);
  }

  async function loadShiftDaySummaries() {
    setLoading();
    const data = await api('shift-day-summaries', { limit: 120 });
    setLastSync(data.lastSync);
    state.shiftDays = data.summaries?.days || [];
    state.shiftSelectedDate = '';
    state.shiftCalendarMonth = getDefaultShiftCalendarMonth();
    state.shiftVisibleCount = state.shiftPageSize;
    renderShiftDaySummariesView();
  }

  function getIndexedShiftDays() {
    return state.shiftDays.map((day, index) => ({ ...day, originalIndex: index }));
  }

  function renderShiftDaySummariesView() {
    const allDays = getIndexedShiftDays();
    const visibleDays = state.shiftSelectedDate
      ? allDays.filter((day) => day.date === state.shiftSelectedDate)
      : allDays.slice(0, state.shiftVisibleCount);
    content.innerHTML = ui.renderShiftDaySummaries({ days: visibleDays }, {
      allDays,
      days: visibleDays,
      selectedDate: state.shiftSelectedDate,
      hasMore: !state.shiftSelectedDate && state.shiftVisibleCount < allDays.length
    });
    wireShiftDaySelect();
    wireShiftTotalButtons();
    wireShiftLoadMore();
  }

  function getDefaultShiftCalendarMonth() {
    const firstDate = state.shiftDays[0]?.date || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return firstDate.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function shiftCalendarMonthLabel(monthKey) {
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const [year, month] = String(monthKey || '').split('-').map((value) => parseInt(value, 10));
    if (!Number.isInteger(year) || !Number.isInteger(month)) return '';
    return `${monthNames[month - 1] || ''} ${year}`;
  }

  function shiftCalendarMonthOffset(monthKey, offset) {
    const [year, month] = String(monthKey || getDefaultShiftCalendarMonth()).split('-').map((value) => parseInt(value, 10));
    const date = new Date(year, (month - 1) + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function buildShiftCalendarHtml(days, monthKey) {
    const availableDates = new Set(days.map((day) => day.date));
    const availableMonths = days.map((day) => String(day.date || '').slice(0, 7)).filter(Boolean);
    const minMonth = availableMonths[availableMonths.length - 1] || monthKey;
    const maxMonth = availableMonths[0] || monthKey;
    const [year, month] = String(monthKey || getDefaultShiftCalendarMonth()).split('-').map((value) => parseInt(value, 10));
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOffset = (new Date(year, month - 1, 1).getDay() + 1) % 7;
    const cells = [];
    for (let index = 0; index < firstDayOffset; index += 1) {
      cells.push('<span class="shift-calendar-empty"></span>');
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isAvailable = availableDates.has(dateKey);
      const isSelected = state.shiftSelectedDate === dateKey;
      cells.push(`
        <button
          class="shift-calendar-day${isSelected ? ' active' : ''}"
          type="button"
          ${isAvailable ? `data-shift-calendar-date="${dateKey}"` : 'disabled'}
        >${day}</button>
      `);
    }

    return `
      <div class="shift-calendar-head">
        <button type="button" data-shift-calendar-month="-1"${monthKey <= minMonth ? ' disabled' : ''}>‹</button>
        <strong>${ui.escapeHtml(shiftCalendarMonthLabel(monthKey))}</strong>
        <button type="button" data-shift-calendar-month="1"${monthKey >= maxMonth ? ' disabled' : ''}>›</button>
      </div>
      <div class="shift-calendar-weekdays">
        <span>س</span><span>ح</span><span>ن</span><span>ث</span><span>ر</span><span>خ</span><span>ج</span>
      </div>
      <div class="shift-calendar-grid">${cells.join('')}</div>
    `;
  }

  function renderShiftCalendarPanel(isOpen = false) {
    const panel = document.querySelector('[data-shift-calendar]');
    const toggle = document.querySelector('[data-shift-calendar-toggle]');
    if (!panel || !toggle) return;
    const days = getIndexedShiftDays();
    state.shiftCalendarMonth = state.shiftCalendarMonth || getDefaultShiftCalendarMonth();
    panel.innerHTML = buildShiftCalendarHtml(days, state.shiftCalendarMonth);
    panel.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function wireShiftDaySelect() {
    const toggle = document.querySelector('[data-shift-calendar-toggle]');
    const clearButton = document.querySelector('[data-shift-day-clear]');
    renderShiftCalendarPanel(false);
    toggle?.addEventListener('click', () => {
      const panel = document.querySelector('[data-shift-calendar]');
      renderShiftCalendarPanel(panel?.hidden ?? true);
    });
    clearButton?.addEventListener('click', () => {
      if (!state.shiftSelectedDate) return;
      state.shiftSelectedDate = '';
      state.shiftVisibleCount = state.shiftPageSize;
      renderShiftDaySummariesView();
    });
    document.querySelector('[data-shift-calendar]')?.addEventListener('click', (event) => {
      const monthButton = event.target.closest('[data-shift-calendar-month]');
      if (monthButton) {
        state.shiftCalendarMonth = shiftCalendarMonthOffset(state.shiftCalendarMonth, Number(monthButton.dataset.shiftCalendarMonth) || 0);
        renderShiftCalendarPanel(true);
        return;
      }
      const dayButton = event.target.closest('[data-shift-calendar-date]');
      if (!dayButton) return;
      state.shiftSelectedDate = dayButton.dataset.shiftCalendarDate || '';
      renderShiftDaySummariesView();
    });
  }

  function wireShiftLoadMore() {
    disconnectShiftLoadHandler();
    const sentinel = content.querySelector('[data-shift-load-more]');
    if (!sentinel || state.shiftSelectedDate) return;

    state.shiftLoadScrollHandler = () => {
      if (state.currentView !== 'shift-day-summaries') return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const documentHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      if (scrollTop + viewportHeight < documentHeight - 180) return;
      const nextCount = Math.min(state.shiftVisibleCount + state.shiftPageSize, state.shiftDays.length);
      if (nextCount === state.shiftVisibleCount) return;
      state.shiftVisibleCount = nextCount;
      renderShiftDaySummariesView();
    };
    window.addEventListener('scroll', state.shiftLoadScrollHandler, { passive: true });
  }

  async function loadLandDashboard() {
    setLoading();
    await ensureLandSeasons();
    const data = await api('land-dashboard', { season_key: state.landSeasonKey });
    content.innerHTML = ui.renderLandDashboard(data, {
      formId: 'landDashboardSeasonForm',
      landSeasons: state.landSeasons,
      seasonKey: state.landSeasonKey
    });
    wireLandSeasonFilter('landDashboardSeasonForm', loadLandDashboard);
    scrollLandTablesToStart();
  }

  async function loadLandPlots() {
    setLoading();
    await ensureLandSeasons();
    const data = await api('land-plots', { season_key: state.landSeasonKey });
    content.innerHTML = ui.renderLandPlots(data, {
      formId: 'landPlotsSeasonForm',
      landSeasons: state.landSeasons,
      seasonKey: state.landSeasonKey
    });
    wireLandSeasonFilter('landPlotsSeasonForm', loadLandPlots);
  }

  async function loadLandTenants() {
    setLoading();
    const data = await api('land-tenants');
    content.innerHTML = ui.renderLandTenants(data);
  }

  async function loadLandReports() {
    setLoading();
    await ensureLandSeasons();
    const data = await api('land-reports', { kind: 'missing-payments', season_key: state.landSeasonKey });
    content.innerHTML = ui.renderLandReports(data, {
      formId: 'landReportsSeasonForm',
      landSeasons: state.landSeasons,
      seasonKey: state.landSeasonKey
    });
    wireLandSeasonFilter('landReportsSeasonForm', loadLandReports);
  }

  function openShiftSummaryModal(dayIndex, kind) {
    const day = state.shiftDays[Number(dayIndex)];
    if (!day || !shiftSummaryDialogBody) return;
    shiftSummaryDialogBody.innerHTML = ui.renderShiftSummaryModal(day, kind);
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
    if (code === 'CoopReadonlyUI is not loaded') return 'تعذر تحميل واجهة العرض.';
    return 'تعذر تحميل البيانات.';
  }

  async function loadView(view) {
    state.currentView = view;
    document.querySelectorAll('.bottom-navigation button[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    keepActiveNavigationVisible();

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
    setAppTitleLines(state.currentModule === 'land'
      ? ['إدارة الأراضي الزراعية']
      : ['محطة بنزين سمنود', 'الجمعية التعاونية للبترول']);
    moduleButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.module === state.currentModule);
    });
    loadView(state.currentModule === 'land' ? 'land-dashboard' : 'overview');
  }

  moduleButtons.forEach((button) => {
    button.addEventListener('click', () => switchModule(button.dataset.module));
  });

  document.querySelectorAll('.bottom-navigation button[data-view]').forEach((button) => {
    button.addEventListener('click', () => loadView(button.dataset.view));
  });

  closeShiftSummaryDialog?.addEventListener('click', closeSummaryModal);
  shiftSummaryDialog?.addEventListener('click', (event) => {
    if (event.target === shiftSummaryDialog) closeSummaryModal();
  });
  content.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-chart-expand]')) {
      openChartZoomDialog();
    }
  });

  loadView('overview');
})();
