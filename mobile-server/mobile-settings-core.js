const database = require('./database');
const { CustomerService } = require('../src/customer-service');
const { parseLocalizedNumber } = require('../src/localized-number');
const { addProduct, applyPrices, listPriceHistory, listProducts, lockProducts, renameProduct } = require('./settings-products');

const customerErrorCodes = {
  CUSTOMER_NAME_REQUIRED: ['name_required', 400],
  INVALID_CUSTOMER_ID: ['invalid_id', 400],
  CUSTOMER_NAME_DUPLICATE: ['duplicate_name', 409],
  CUSTOMER_NOT_FOUND: ['not_found', 404],
  CUSTOMER_REACTIVATION_FAILED: ['data_changed', 409],
  CUSTOMER_UPDATE_FAILED: ['data_changed', 409],
  CUSTOMER_ARCHIVE_FAILED: ['data_changed', 409]
};

class SettingsError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

function jsonBody(body, headers) {
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new SettingsError('unsupported_content_type', 415);
  }
  let value = body;
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body);
    } catch {
      throw new SettingsError('invalid_request');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SettingsError('invalid_request');
  }
  return value;
}

function requireId(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new SettingsError('invalid_id');
  }
  return value;
}

function requireName(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new SettingsError('name_required');
  }
  return value.trim();
}

function numericValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return Number.NaN;
  return parseLocalizedNumber(value);
}

function requirePrice(value) {
  const price = numericValue(value);
  const storedPrice = Math.fround(price);
  if (!Number.isFinite(storedPrice) || storedPrice <= 0) {
    throw new SettingsError('invalid_price');
  }
  return price;
}

function requireDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new SettingsError('invalid_date');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new SettingsError('invalid_date');
  }
  return value;
}

function priceChanges(input) {
  const date = requireDate(input.date);
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    throw new SettingsError('empty_prices');
  }
  const changes = new Map();
  for (const change of input.changes) {
    const id = requireId(change?.id);
    if (changes.has(id)) throw new SettingsError('invalid_request');
    const prices = {};
    for (const kind of ['salePrice', 'purchasePrice']) {
      if (change[kind] !== undefined && change[kind] !== '') prices[kind] = requirePrice(change[kind]);
    }
    if (Object.keys(prices).length) changes.set(id, prices);
  }
  if (!changes.size) throw new SettingsError('empty_prices');

  return async (db) => {
    const products = await lockProducts(db, [...changes.keys()]);
    if (products.length !== changes.size) throw new SettingsError('not_found', 404);
    if (products.some((product) => product.product_type !== 'fuel' && changes.get(product.id).purchasePrice !== undefined)) {
      throw new SettingsError('invalid_product_type');
    }
    return { saved: await applyPrices(db, products, changes, date) };
  };
}

async function changeProduct(db, id, work) {
  const [product] = await lockProducts(db, [id]);
  if (!product) throw new SettingsError('not_found', 404);
  await work(product);
  return { id };
}

function writeAction(input) {
  switch (input.action) {
    case 'add-product': {
      const { type } = input;
      if (type !== 'fuel' && type !== 'oil') throw new SettingsError('invalid_product_type');
      const name = requireName(input.name);
      const price = requirePrice(input.price);
      const vat = type === 'oil' && input.vat !== undefined && input.vat !== '' ? numericValue(input.vat) : 0;
      if (!Number.isFinite(vat) || vat < 0 || vat > 100) throw new SettingsError('invalid_vat');
      return (db) => addProduct(db, { type, name, price, vat });
    }
    case 'rename-product': {
      const id = requireId(input.id);
      const name = requireName(input.name);
      return (db) => changeProduct(db, id, (product) => renameProduct(db, product, name));
    }
    case 'delete-product': {
      const id = requireId(input.id);
      return (db) => changeProduct(db, id, () => db.update('DELETE FROM products WHERE id = $1', [id]));
    }
    case 'set-oil-active': {
      const id = requireId(input.id);
      if (typeof input.active !== 'boolean') throw new SettingsError('invalid_request');
      return (db) => changeProduct(db, id, (product) => {
        if (product.product_type !== 'oil') throw new SettingsError('invalid_product_type');
        return db.update('UPDATE products SET is_active = $1 WHERE id = $2', [Number(input.active), id]);
      });
    }
    case 'save-prices':
      return priceChanges(input);
    case 'add-customer': {
      const name = requireName(input.name);
      return async (db) => ({ id: await new CustomerService(db).add({ name }) });
    }
    case 'rename-customer': {
      const id = requireId(input.id);
      const name = requireName(input.name);
      return (db) => new CustomerService(db).rename({ id, name });
    }
    case 'archive-customer': {
      const id = requireId(input.id);
      return (db) => new CustomerService(db).archive({ id });
    }
    default:
      throw new SettingsError('unknown_action');
  }
}

async function readSection(section) {
  switch (section) {
    case 'products':
      return listProducts(database);
    case 'price-history':
      return listPriceHistory(database);
    case 'customers': {
      const customers = await new CustomerService(database).listActive();
      return customers.map(({ id, name }) => ({ id, name }));
    }
    default:
      throw new SettingsError('unknown_section', 404);
  }
}

async function handleMobileSettingsRequest({ method = 'GET', query = {}, headers = {}, body } = {}) {
  try {
    if (method === 'GET') {
      return json(200, { ok: true, data: await readSection(query.section) });
    }
    if (method === 'POST') {
      const work = writeAction(jsonBody(body, headers));
      return json(200, { ok: true, data: await database.transaction(work) });
    }

    const response = json(405, { ok: false, error: 'method_not_allowed' });
    response.headers.Allow = 'GET, POST';
    return response;
  } catch (error) {
    if (error instanceof SettingsError) return json(error.status, { ok: false, error: error.code });
    if (Object.hasOwn(customerErrorCodes, error.code)) {
      const [code, status] = customerErrorCodes[error.code];
      return json(status, { ok: false, error: code });
    }
    if (error.code === '23505') return json(409, { ok: false, error: 'duplicate_name' });
    if (error.code === '23503' || error.code === '40P01' || error.code === '40001') {
      return json(409, { ok: false, error: 'data_changed' });
    }
    console.error('Mobile settings API:', error.code || error.name);
    return json(503, { ok: false, error: 'settings_unavailable' });
  }
}

module.exports = { handleMobileSettingsRequest };
