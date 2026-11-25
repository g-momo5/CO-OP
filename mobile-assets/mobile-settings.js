(() => {
  const byId = (id) => document.getElementById(id);
  const root = byId('mobileSettings');
  const productsList = byId('settingsProductsList');
  const customersList = byId('settingsCustomersList');
  const notice = byId('settingsNotice');
  const edit = byId('settingsEditDialog');
  const editForm = byId('settingsEditForm');
  const formError = byId('settingsFormError');
  const saveButton = byId('settingsSave');
  const nameInput = byId('settingsName');
  const newProductType = byId('settingsNewProductType');
  const priceRows = byId('settingsPriceRows');
  const history = byId('settingsHistoryDialog');
  const historyType = byId('settingsHistoryType');
  const historyProduct = byId('settingsHistoryProduct');
  const historyList = byId('settingsHistoryList');
  const editPricesButton = byId('settingsEditPrices');
  const cancelButtons = edit.querySelectorAll('[data-cancel-edit]');

  const { formatDay } = window.CoopReadonlyUI;
  const number = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 12 });
  const formatPrice = (price) => price == null ? '—' : `${number.format(price)} ج.م`;
  const labels = { fuel: 'الوقود', oil: 'الزيوت' };
  const errors = {
    name_required: 'يرجى إدخال اسم صحيح.',
    duplicate_name: 'هذا الاسم موجود بالفعل.',
    invalid_price: 'يرجى إدخال سعر صحيح أكبر من صفر.',
    invalid_product_type: 'يرجى التحقق من نوع المنتج.',
    invalid_vat: 'يرجى إدخال نسبة ضريبة بين ٠ و١٠٠.',
    invalid_date: 'يرجى اختيار تاريخ سريان صحيح.',
    empty_prices: 'يرجى إدخال سعر جديد واحد على الأقل.',
    not_found: 'هذا السجل لم يعد متاحاً. حدّث القائمة.',
    data_changed: 'تغيّرت البيانات. حدّث القائمة ثم حاول مرة أخرى.',
    network_error: 'تعذر الاتصال. تحقق من القائمة قبل إعادة محاولة الحفظ.',
    settings_unavailable: 'تعذر الاتصال بقاعدة البيانات. حاول مرة أخرى.'
  };
  const state = {
    section: 'products',
    productType: 'fuel',
    products: [],
    customers: [],
    history: [],
    loadVersion: 0,
    historyVersion: 0,
    editing: null,
    saving: false
  };

  async function request(section, body) {
    const url = new URL('/api/mobile-settings', window.location.origin);
    if (section) url.searchParams.set('section', section);
    let response;
    try {
      response = await fetch(url, body ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body)
      } : { cache: 'no-store' });
    } catch {
      throw new Error('network_error');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'settings_unavailable');
    return payload.data;
  }

  function showNotice(element, text = '', tone = 'success') {
    element.textContent = text;
    element.dataset.tone = tone;
    element.hidden = !text;
  }

  function showListMessage(target, text, kind, retry) {
    const message = document.createElement('div');
    message.className = `${kind} settings-list-message`;
    message.textContent = text;
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-button secondary';
      button.textContent = 'إعادة المحاولة';
      button.addEventListener('click', retry);
      message.append(button);
    }
    target.replaceChildren(message);
  }

  function localDate() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function configureProductFields() {
    byId('settingsVatField').hidden = newProductType.value !== 'oil';
  }

  function openEditor(options) {
    state.editing = options;
    editForm.reset();
    showNotice(formError);
    byId('settingsEditTitle').textContent = options.title;
    byId('settingsNameField').hidden = !options.nameLabel;
    byId('settingsNameLabel').textContent = options.nameLabel || '';
    nameInput.value = options.name || '';
    byId('settingsNewProductFields').hidden = !options.product;
    newProductType.value = state.productType;
    configureProductFields();
    byId('settingsPriceFields').hidden = !options.prices;
    priceRows.replaceChildren();
    if (options.prices) {
      byId('settingsPriceDate').value = localDate();
      renderPriceFields();
    }
    const confirmation = byId('settingsConfirmation');
    confirmation.hidden = !options.confirmation;
    confirmation.textContent = options.confirmation || '';
    saveButton.textContent = options.submitLabel || 'حفظ';
    saveButton.classList.toggle('danger', Boolean(options.confirmation));
    edit.showModal();
    if (options.nameLabel) {
      nameInput.focus();
      if (options.name) nameInput.select();
    } else if (options.confirmation) {
      cancelButtons[1].focus();
    }
  }

  function renderPriceFields() {
    for (const [type, label] of Object.entries(labels)) {
      const products = state.products.filter((product) => product.type === type);
      if (!products.length) continue;
      const group = document.createElement('details');
      group.className = 'settings-price-group';
      group.open = type === state.productType;
      const heading = document.createElement('summary');
      heading.textContent = label;
      group.append(heading);
      for (const product of products) {
        const row = byId('settingsPriceRow').content.firstElementChild.cloneNode(true);
        row.dataset.priceProduct = product.id;
        row.querySelector('legend').textContent = product.name;
        row.querySelector('[data-sale-price]').placeholder = formatPrice(product.salePrice);
        row.querySelector('[data-purchase-field]').hidden = product.type !== 'fuel';
        row.querySelector('[data-purchase-price]').placeholder = formatPrice(product.purchasePrice);
        group.append(row);
      }
      priceRows.append(group);
    }
  }

  function readPriceFields() {
    const changes = [];
    for (const row of priceRows.querySelectorAll('[data-price-product]')) {
      const salePrice = row.querySelector('[data-sale-price]').value.trim();
      const purchasePrice = row.querySelector('[data-purchase-price]').value.trim();
      if (salePrice || purchasePrice) changes.push({ id: Number(row.dataset.priceProduct), salePrice, purchasePrice });
    }
    return { date: byId('settingsPriceDate').value, changes };
  }

  async function saveEditor(event) {
    event.preventDefault();
    const editing = state.editing;
    if (state.saving || !editing) return;
    state.saving = true;
    saveButton.disabled = true;
    cancelButtons.forEach((button) => { button.disabled = true; });
    showNotice(formError);
    let body;
    try {
      body = { action: editing.action, ...editing.read() };
      await request(null, body);
    } catch (error) {
      showNotice(formError, errors[error.message] || 'تعذر الحفظ. حاول مرة أخرى.', 'error');
      return;
    } finally {
      state.saving = false;
      saveButton.disabled = false;
      cancelButtons.forEach((button) => { button.disabled = false; });
    }
    if (!edit.open) return;
    edit.close();
    if (editing.product) setProductType(body.type);
    showNotice(notice, editing.success || 'تم الحفظ بنجاح.');
    await loadSection();
  }

  function setProductType(type) {
    state.productType = type;
    root.querySelectorAll('[data-settings-type]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.settingsType === type);
    });
  }

  function fillDetails(details, fields) {
    details.hidden = false;
    for (const [title, value] of fields) {
      const field = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = title;
      const data = document.createElement('dd');
      data.textContent = value;
      field.append(term, data);
      details.append(field);
    }
  }

  async function changeOilStatus(checkbox, product) {
    const active = checkbox.checked;
    checkbox.disabled = true;
    showNotice(notice);
    try {
      await request(null, { action: 'set-oil-active', id: product.id, active });
      showNotice(notice, 'تم تحديث حالة البيع.');
      if (state.section === 'products' && !root.hidden) await loadSection();
    } catch (error) {
      checkbox.checked = product.active;
      showNotice(notice, errors[error.message] || 'تعذر تحديث حالة البيع.', 'error');
    } finally {
      checkbox.disabled = false;
    }
  }

  function record(item, isProduct) {
    const card = byId('settingsRecord').content.firstElementChild.cloneNode(true);
    card.querySelector('h3').textContent = item.name;
    if (isProduct) {
      const metrics = [['سعر البيع', formatPrice(item.salePrice)]];
      if (item.saleDate) metrics.push(['سريان البيع', formatDay(item.saleDate)]);
      if (item.type === 'fuel') {
        metrics.push(['سعر الشراء', formatPrice(item.purchasePrice)]);
        if (item.purchaseDate) metrics.push(['سريان الشراء', formatDay(item.purchaseDate)]);
      } else {
        metrics.push(['الضريبة المضافة', `${number.format(item.vat)}٪`]);
        const checkbox = card.querySelector('input');
        checkbox.closest('label').hidden = false;
        checkbox.checked = item.active;
        checkbox.addEventListener('change', () => changeOilStatus(checkbox, item));
      }
      fillDetails(card.querySelector('dl'), metrics);
    }
    const editName = card.querySelector('[data-record-edit]');
    editName.addEventListener('click', () => openEditor({
      title: isProduct ? 'تعديل اسم المنتج' : 'تعديل اسم العميل',
      nameLabel: isProduct ? 'اسم المنتج' : 'اسم العميل',
      name: item.name,
      action: isProduct ? 'rename-product' : 'rename-customer',
      read: () => ({ id: item.id, name: nameInput.value })
    }));
    const remove = card.querySelector('[data-record-remove]');
    remove.textContent = isProduct ? 'حذف' : 'أرشفة';
    remove.addEventListener('click', () => openEditor({
      title: isProduct ? 'حذف المنتج' : 'أرشفة العميل',
      confirmation: isProduct
        ? `هل تريد حذف «${item.name}»؟ لا يمكن التراجع عن الحذف.`
        : `هل تريد أرشفة «${item.name}»؟ سيتم الاحتفاظ بالورديات والحسابات السابقة.`,
      submitLabel: remove.textContent,
      action: isProduct ? 'delete-product' : 'archive-customer',
      read: () => ({ id: item.id }),
      success: isProduct ? 'تم حذف المنتج.' : 'تمت أرشفة العميل.'
    }));
    return card;
  }

  function renderSection(section) {
    const isProduct = section === 'products';
    const target = isProduct ? productsList : customersList;
    const rows = isProduct
      ? state.products.filter((product) => product.type === state.productType)
      : state.customers;
    if (rows.length === 0) {
      showListMessage(target, isProduct ? 'لا توجد منتجات.' : 'لا يوجد عملاء.', 'empty');
      return;
    }
    target.replaceChildren(...rows.map((item) => record(item, isProduct)));
  }

  async function loadSection() {
    const section = state.section;
    const version = ++state.loadVersion;
    const isProduct = section === 'products';
    const target = isProduct ? productsList : customersList;
    if (isProduct) editPricesButton.disabled = true;
    showListMessage(target, 'جار التحميل...', 'loading');
    try {
      const rows = await request(section);
      if (version !== state.loadVersion) return;
      state[section] = rows;
      if (isProduct) editPricesButton.disabled = rows.length === 0;
      renderSection(section);
    } catch {
      if (version !== state.loadVersion) return;
      state[section] = [];
      showListMessage(target, 'تعذر تحميل القائمة.', 'error', loadSection);
    }
  }

  function selectSection(section) {
    if (section === state.section) return;
    state.section = section;
    showNotice(notice);
    root.querySelectorAll('[data-settings-section]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.settingsSection === section);
    });
    byId('settingsProducts').hidden = section !== 'products';
    byId('settingsCustomers').hidden = section !== 'customers';
    return loadSection();
  }

  function renderHistory(updateProducts) {
    const byType = state.history.filter((entry) => !historyType.value || entry.type === historyType.value);
    if (updateProducts) {
      const options = new Map(byType.map(({ key, name }) => [String(key), name]));
      const sorted = [...options].sort((left, right) => left[1].localeCompare(right[1], 'ar'));
      historyProduct.replaceChildren(new Option('كل المنتجات', ''), ...sorted.map(([key, name]) => new Option(name, key)));
    }
    const rows = byType.filter((entry) => !historyProduct.value || String(entry.key) === historyProduct.value);
    if (!rows.length) {
      showListMessage(historyList, 'لا يوجد سجل للأسعار.', 'empty');
      return;
    }
    const elements = rows.map((entry) => {
      const row = document.createElement('article');
      row.className = 'settings-history-row';
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const value = document.createElement('strong');
      value.textContent = formatPrice(entry.price);
      const kind = document.createElement('span');
      kind.textContent = entry.kind === 'sale' ? 'سعر البيع' : 'سعر الشراء';
      const date = document.createElement('time');
      date.dateTime = entry.date;
      date.textContent = formatDay(entry.date);
      row.append(name, value, kind, date);
      return row;
    });
    historyList.replaceChildren(...elements);
  }

  async function loadHistory() {
    const version = ++state.historyVersion;
    historyType.disabled = true;
    historyProduct.disabled = true;
    showListMessage(historyList, 'جار التحميل...', 'loading');
    try {
      const entries = await request('price-history');
      if (version !== state.historyVersion || !history.open) return;
      state.history = entries;
      renderHistory(true);
      historyType.disabled = false;
      historyProduct.disabled = false;
    } catch {
      if (version !== state.historyVersion || !history.open) return;
      showListMessage(historyList, 'تعذر تحميل سجل الأسعار.', 'error', loadHistory);
    }
  }

  root.querySelectorAll('[data-settings-section]').forEach((button) => {
    button.addEventListener('click', () => selectSection(button.dataset.settingsSection));
  });
  root.querySelectorAll('[data-settings-type]').forEach((button) => {
    button.addEventListener('click', () => {
      setProductType(button.dataset.settingsType);
      void loadSection();
    });
  });
  byId('settingsAddProduct').addEventListener('click', () => openEditor({
    title: 'إضافة منتج جديد',
    nameLabel: 'اسم المنتج',
    product: true,
    action: 'add-product',
    read: () => ({
      name: nameInput.value,
      type: newProductType.value,
      price: byId('settingsNewProductPrice').value.trim(),
      vat: byId('settingsVat').value.trim()
    })
  }));
  byId('settingsAddCustomer').addEventListener('click', () => openEditor({
    title: 'إضافة عميل جديد',
    nameLabel: 'اسم العميل',
    action: 'add-customer',
    read: () => ({ name: nameInput.value })
  }));
  editPricesButton.addEventListener('click', () => openEditor({
    title: 'تعديل الأسعار',
    prices: true,
    action: 'save-prices',
    read: readPriceFields
  }));
  newProductType.addEventListener('change', configureProductFields);
  editForm.addEventListener('submit', saveEditor);
  cancelButtons.forEach((button) => button.addEventListener('click', () => edit.close()));
  edit.addEventListener('cancel', (event) => {
    if (state.saving) event.preventDefault();
  });
  edit.addEventListener('close', () => { state.editing = null; });

  byId('settingsOpenHistory').addEventListener('click', () => {
    historyType.value = '';
    history.showModal();
    void loadHistory();
  });
  byId('settingsCloseHistory').addEventListener('click', () => history.close());
  historyType.addEventListener('change', () => renderHistory(true));
  historyProduct.addEventListener('change', () => renderHistory(false));

  window.CoopMobileSettings = {
    open() {
      root.hidden = false;
      showNotice(notice);
      return loadSection();
    },
    close() {
      if (root.hidden) return;
      root.hidden = true;
      state.loadVersion++;
      if (edit.open) edit.close();
      if (history.open) history.close();
    }
  };
})();
