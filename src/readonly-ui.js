(function attachReadonlyUi(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  }
  root.CoopReadonlyUI = factory();
})(typeof window !== 'undefined' ? window : globalThis, function createReadonlyUi() {
  const numberFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
  const moneyFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const wholeMoneyFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

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

  const profitBaseRows = [
    ['fuel_diesel', 'سولار', 'revenue'],
    ['fuel_80', 'بنزين ٨٠', 'revenue'],
    ['fuel_92', 'بنزين ٩٢', 'revenue'],
    ['fuel_95', 'بنزين ٩٥', 'revenue'],
    ['oil_total', 'الزيوت', 'revenue'],
    ['wash_lube_month', 'غسيل و تشحيم', 'revenue'],
    ['expenses_month', 'المصاريف', 'deduction']
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

  function formatMoneyWhole(value) {
    const numeric = Number(value);
    return wholeMoneyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
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

  function formatWholeEgpShort(value) {
    return formatWholeEgp(value).replace('جنيه مصري', 'ج.م');
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

  function currentMonthRange(now = new Date()) {
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
    return daysInMonth ? (actualQuantity / elapsedDays) * daysInMonth : actualQuantity;
  }

  function table(headers, rows, emptyText = 'لا توجد بيانات', tableClass = '') {
    if (!rows.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
    const tableClasses = String(tableClass || '').split(/\s+/).filter(Boolean);
    const wrapperClass = ['table-wrap', ...tableClasses.map((className) => `${className}-wrap`)].join(' ');
    return `
      <div class="${escapeHtml(wrapperClass)}">
        <table class="base-table ${escapeHtml(tableClass)}">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
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
      <form id="${escapeHtml(formId)}" class="filter-bar">
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
              <div class="bar-track"><span class="bar-fill" style="--bar-width: ${width}%"></span></div>
              <strong>${formatNumber(value)}</strong>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderHomeChartShell(chart) {
    if (!chart?.months?.length) return renderBarChart(chart?.rows || []);
    return '<div class="home-chart-box"><canvas id="homeFuelSalesChart"></canvas></div>';
  }

  function mountHomeChart(chart, chartRef = {}) {
    if (!root.Chart || !chart?.months?.length) return chartRef.current || null;
    const canvas = root.document?.getElementById('homeFuelSalesChart');
    if (!canvas) return chartRef.current || null;
    if (chartRef.current) chartRef.current.destroy();

    const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#2E7D32', '#C2185B'];
    const currentMonthKey = getMonthKey();
    const forecastMonthIndex = chart.months.indexOf(currentMonthKey);
    const registeredDays = Number(chart.salesDaysByMonth?.[currentMonthKey]) || 0;
    const hasForecast = forecastMonthIndex !== -1 && registeredDays > 0;
    const rows = (chart.rows || []).filter((row) => (
      chart.months.some((month) => Number(row.byMonth?.[month]) > 0)
    ));

    chartRef.current = new root.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: chart.months.map(monthLabel),
        datasets: rows.map((row, index) => {
          const data = chart.months.map((month) => Number(row.byMonth?.[month]) || 0);
          if (hasForecast) {
            data[forecastMonthIndex] = getCurrentMonthForecastValue(data[forecastMonthIndex], currentMonthKey, registeredDays);
          }
          return {
            label: row.name,
            data,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length],
            borderWidth: 2,
            tension: 0.25,
            segment: hasForecast ? {
              borderDash: (context) => (context.p1DataIndex === forecastMonthIndex ? [8, 5] : undefined)
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
    return chartRef.current;
  }

  function renderOverview(data = {}) {
    const chart = data.chart || {};
    return sectionCard('📊', 'كميات المبيعات الشهرية حسب نوع الوقود', renderHomeChartShell(chart));
  }

  function renderSalesSummary(data = {}) {
    const summary = data.summary || {};
    const months = summary.months || [];
    let hasSeenOil = false;
    const rows = (summary.rows || []).map((row) => {
      const isFirstOil = row.type === 'oil' && !hasSeenOil;
      if (row.type === 'oil') hasSeenOil = true;
      return `
        <tr class="${isFirstOil ? 'sales-first-oil-row' : ''}">
          <td data-label="المنتج"><strong>${escapeHtml(row.name)}</strong></td>
          ${months.map((month) => `<td data-label="${escapeHtml(monthLabel(month))}">${formatNumber(row.byMonth?.[month] || 0)}</td>`).join('')}
          <td class="cell-total" data-label="الإجمالي">${formatNumber(row.total)}</td>
        </tr>
      `;
    });
    return sectionCard(
      '📊',
      'ملخص المبيعات',
      table(['المنتج', ...months.map(monthLabel), 'الإجمالي'], rows, 'لا توجد بيانات', 'sales-summary-table financial-summary-table')
    );
  }

  function normalizeProfitCustomRow(row) {
    return {
      key: String(row?.row_key || '').trim(),
      label: String(row?.row_label || '').trim() || (row?.row_type === 'deduction' ? 'خصم إضافي' : 'إيراد إضافي'),
      kind: row?.row_type === 'deduction' ? 'deduction' : 'revenue',
      displayOrder: Number(row?.display_order) || 0,
      source: String(row?.source || '').trim() === 'monthly_accounting' ? 'monthly_accounting' : 'monthly_profit',
      custom: true
    };
  }

  function getProfitCustomRows(customRows, kind) {
    return (Array.isArray(customRows) ? customRows : [])
      .map(normalizeProfitCustomRow)
      .filter((row) => row.key && row.kind === kind)
      .sort((a, b) => {
        if (kind === 'deduction') {
          const aCashInsurance = a.label === 'تأمين نقدى';
          const bCashInsurance = b.label === 'تأمين نقدى';
          if (aCashInsurance !== bCashInsurance) return aCashInsurance ? -1 : 1;
        }
        const aAccounting = a.source === 'monthly_accounting';
        const bAccounting = b.source === 'monthly_accounting';
        if (aAccounting !== bAccounting) return aAccounting ? 1 : -1;
        return (a.displayOrder - b.displayOrder) || a.key.localeCompare(b.key);
      });
  }

  function renderProfit(data = {}) {
    const rows = data.rows || [];
    const customRows = data.customRows || [];
    const months = rows.map((row) => row.month_key).reverse();
    const byMonth = new Map(rows.map((row) => [row.month_key, row]));
    const displayRows = [
      ...profitBaseRows.filter(([, , kind]) => kind === 'revenue').map(([key, label, kind]) => ({ key, label, kind })),
      ...getProfitCustomRows(customRows, 'revenue'),
      ...profitBaseRows.filter(([, , kind]) => kind === 'deduction').map(([key, label, kind]) => ({ key, label, kind })),
      ...getProfitCustomRows(customRows, 'deduction'),
      { key: 'total_positive', label: 'إجمالي الإيرادات', kind: 'summary' },
      { key: 'total_deductions', label: 'إجمالي الخصومات', kind: 'summary' },
      { key: 'net_profit', label: 'صافي المكسب', kind: 'net' }
    ];
    const getValue = (monthRow, item) => {
      if (!item.custom) return monthRow?.[item.key] || 0;
      const sourceValues = item.source === 'monthly_accounting'
        ? monthRow?.accounting_values
        : monthRow?.custom_values;
      return sourceValues?.[item.key] || 0;
    };
    const profitValueClass = (item, value) => {
      if (item.kind !== 'net') return '';
      const numericValue = Number(value) || 0;
      if (numericValue > 0) return ' class="profit-net-positive"';
      if (numericValue < 0) return ' class="profit-net-negative"';
      return ' class="profit-net-zero"';
    };
    const tableRows = displayRows.map((item) => `
      <tr class="profit-${item.kind}-row">
        <td data-label="البند"><strong>${escapeHtml(item.label)}</strong></td>
        ${months.map((month) => {
          const value = getValue(byMonth.get(month), item);
          return `<td${profitValueClass(item, value)} data-label="${escapeHtml(monthLabel(month))}">${formatMoneyWhole(value)}</td>`;
        }).join('')}
      </tr>
    `);
    return sectionCard(
      '📈',
      'المكسب',
      table(['البند', ...months.map(monthLabel)], tableRows, 'لا توجد بيانات', 'profit-summary-table financial-summary-table')
    );
  }

  function renderExpenses(data = {}) {
    const expenses = data.expenses || {};
    const months = expenses.months || [];
    const rows = (expenses.rows || []).map((row) => `
      <tr>
        <td data-label="المصروف"><strong>${escapeHtml(row.description)}</strong></td>
        ${months.map((month) => `<td data-label="${escapeHtml(monthLabel(month))}">${row.byMonth?.[month] ? formatMoney(row.byMonth[month]) : ''}</td>`).join('')}
        <td class="cell-total" data-label="الإجمالي">${formatMoney(row.total)}</td>
      </tr>
    `);
    return sectionCard(
      '📉',
      'المصاريف',
      table(['المصروف', ...months.map(monthLabel), 'الإجمالي'], rows, 'لا توجد بيانات', 'expenses-summary-table financial-summary-table')
    );
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

  function renderAnnualInventory(data = {}) {
    const record = data.annual?.record || data.record;
    if (!record) {
      return sectionCard('📒', 'جرد سنوي', '<div class="empty">لا توجد بيانات جرد سنوي محفوظة</div>');
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
    return `
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

  function renderShiftDaySummaries(data = {}) {
    const days = data.summaries?.days || data.days || [];
    if (!days.length) return '<div class="empty">لا توجد ورديات محفوظة</div>';
    return days.map(renderShiftDayCard).join('');
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

  function renderShiftSummaryModal(day, kind) {
    if (!day) return '';
    const isRevenue = kind === 'revenues';
    const title = isRevenue ? 'الإيرادات' : 'المصاريف';
    const total = isRevenue ? day.totals.revenue : day.totals.expenses;
    const sections = (day.shifts || [])
      .map((shift) => isRevenue ? renderShiftRevenueSummary(shift) : renderShiftExpenseSummary(shift))
      .join('');
    return `
      <div class="modal-title-row">
        <h2>${title} - ${formatDay(day.date)}</h2>
        <strong>${formatMoney(total)}</strong>
      </div>
      <div class="modal-section-stack">
        ${sections || '<div class="empty">لا توجد بيانات</div>'}
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
      <div class="land-dashboard-contracts-list">
        ${groups.map(([plotName, rows], index) => `
          <section class="land-dashboard-contract-group">
            <h3 class="land-dashboard-plot-title">${escapeHtml(plotName)}</h3>
            ${table(
              ['المستأجر', 'المساحة', 'الإيجار', 'المدفوع', 'المتبقي', 'الحالة'],
              rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.tenant_name || '-')}</td>
                  <td>${escapeHtml(formatCompactSurfaceLabel(row.assigned_sahm_label))}</td>
                  <td>${escapeHtml(formatWholeEgpShort(row.rent_egp))}</td>
                  <td>${escapeHtml(formatWholeEgpShort(row.paid_egp))}</td>
                  <td>${escapeHtml(formatWholeEgpShort(row.remaining_egp))}</td>
                  <td>${escapeHtml(landStatusLabel(row.payment_status))}</td>
                </tr>
              `),
              'لا توجد عقود لهذا الموسم',
              `land-dashboard-contracts-table land-dashboard-contracts-table-${index}`
            )}
          </section>
        `).join('')}
      </div>
    `;
  }

  function landSeasonOptions(landSeasons = [], selectedSeasonKey = String(new Date().getFullYear())) {
    const currentYear = new Date().getFullYear();
    const seasonYears = landSeasons
      .map((season) => parseInt(season.season_key, 10))
      .filter((year) => Number.isInteger(year));
    const selectedYear = parseInt(selectedSeasonKey, 10);
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

  function landSeasonFilter(formId, landSeasons = [], selectedSeasonKey = String(new Date().getFullYear())) {
    return `
      <form id="${escapeHtml(formId)}" class="filter-bar land-season-filter">
        <select name="season_key" aria-label="السنة">
          ${landSeasonOptions(landSeasons, selectedSeasonKey).map((year) => (
            `<option value="${escapeHtml(year)}"${year === selectedSeasonKey ? ' selected' : ''}>${escapeHtml(year)}</option>`
          )).join('')}
        </select>
      </form>
    `;
  }

  function renderLandDashboard(data = {}, options = {}) {
    const metricData = landDashboardMetricData(data);
    return sectionCard('🌾', 'إدارة الأراضي', `
      <div class="grid two land-dashboard-metrics-grid">
        ${metric('عدد الأراضي', metricData.plotsCount, '📍')}
        ${metric('إجمالي المساحة', metricData.totalSahmLabel, '📐')}
        ${metric('الإيجار المتوقع', formatWholeEgp(data.expected_egp), '💰')}
        ${metric('المتبقي', formatWholeEgp(data.remaining_egp), '🧾')}
      </div>
      ${renderLandDashboardContracts(data.assignments || [])}
    `, landSeasonFilter(options.formId || 'landDashboardSeasonForm', options.landSeasons, options.seasonKey));
  }

  function renderLandPlots(data = {}, options = {}) {
    return sectionCard('📍', 'قطع الأرض', `
      ${landSeasonFilter(options.formId || 'landPlotsSeasonForm', options.landSeasons, options.seasonKey)}
      <div class="land-mobile-list">
        ${(data.plots || []).map((plot) => landItem(plot.name, [
          ['المساحة', plot.total_sahm_label],
          ['المؤجر', plot.rented_sahm_label],
          ['المتاح', plot.available_sahm_label],
          ['الإيجار المتوقع', plot.expected_rent_egp]
        ])).join('') || '<div class="empty">لا توجد أراض مسجلة</div>'}
      </div>
    `);
  }

  function renderLandTenants(data = {}) {
    return sectionCard('👥', 'المستأجرون', `
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

  function renderLandReports(data = {}, options = {}) {
    return sectionCard('📋', 'المدفوعات الناقصة', `
      ${landSeasonFilter(options.formId || 'landReportsSeasonForm', options.landSeasons, options.seasonKey)}
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
  }

  return {
    currentMonthRange,
    escapeHtml,
    formatDate,
    formatDay,
    formatMoney,
    formatNumber,
    monthFilter,
    monthLabel,
    mountHomeChart,
    renderAnnualInventory,
    renderExpenses,
    renderLandDashboard,
    renderLandPlots,
    renderLandReports,
    renderLandTenants,
    renderOverview,
    renderProfit,
    renderSalesSummary,
    renderShiftDaySummaries,
    renderShiftSummaryModal
  };
});
