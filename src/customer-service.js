function normalizeCustomerName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getCustomerId(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isActiveCustomer(row) {
  if (!row) return false;
  return row.is_active !== false
    && row.is_active !== 0
    && String(row.is_active).trim().toLowerCase() !== 'false';
}

function createCustomerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class CustomerService {
  constructor({ query, update, insert }) {
    this.query = query;
    this.update = update;
    this.insert = insert;
  }

  async listActive() {
    return this.query(
      'SELECT * FROM customers WHERE COALESCE(is_active, 1) = 1 ORDER BY name'
    );
  }

  async add({ name } = {}) {
    const cleanName = normalizeCustomerName(name);
    if (!cleanName) {
      throw createCustomerError('اسم العميل مطلوب', 'CUSTOMER_NAME_REQUIRED');
    }

    const existingRows = await this.query(
      'SELECT id, is_active FROM customers WHERE name = $1 LIMIT 1',
      [cleanName]
    );
    const existingCustomer = existingRows[0];

    if (existingCustomer) {
      if (isActiveCustomer(existingCustomer)) {
        throw createCustomerError('يوجد عميل بنفس الاسم بالفعل', 'CUSTOMER_NAME_DUPLICATE');
      }

      const customerId = getCustomerId(existingCustomer.id);
      const updatedRows = await this.update(
        'UPDATE customers SET is_active = 1 WHERE id = $1',
        [customerId]
      );
      if (!customerId || updatedRows < 1) {
        throw createCustomerError('تعذر إعادة تفعيل العميل', 'CUSTOMER_REACTIVATION_FAILED');
      }
      return customerId;
    }

    return this.insert(
      'INSERT INTO customers (name, is_active) VALUES ($1, 1)',
      [cleanName],
      'customers'
    );
  }

  async archive({ id } = {}) {
    const customerId = getCustomerId(id);
    if (!customerId) {
      throw createCustomerError('معرف العميل غير صالح', 'INVALID_CUSTOMER_ID');
    }

    const existingRows = await this.query(
      'SELECT id, is_active FROM customers WHERE id = $1 LIMIT 1',
      [customerId]
    );
    if (!isActiveCustomer(existingRows[0])) {
      throw createCustomerError('العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    }

    const updatedRows = await this.update(
      'UPDATE customers SET is_active = 0 WHERE id = $1 AND COALESCE(is_active, 1) = 1',
      [customerId]
    );
    if (updatedRows < 1) {
      throw createCustomerError('لم يتم حذف أي عميل', 'CUSTOMER_ARCHIVE_FAILED');
    }

    return { success: true, archived: true, customerId };
  }

  async rename({ id, name } = {}) {
    const customerId = getCustomerId(id);
    const cleanName = normalizeCustomerName(name);
    if (!customerId) {
      throw createCustomerError('معرف العميل غير صالح', 'INVALID_CUSTOMER_ID');
    }
    if (!cleanName) {
      throw createCustomerError('اسم العميل مطلوب', 'CUSTOMER_NAME_REQUIRED');
    }

    const existingRows = await this.query(
      'SELECT id FROM customers WHERE id = $1 AND COALESCE(is_active, 1) = 1 LIMIT 1',
      [customerId]
    );
    if (existingRows.length === 0) {
      throw createCustomerError('العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    }

    const duplicateRows = await this.query(
      'SELECT id FROM customers WHERE name = $1 AND id <> $2 LIMIT 1',
      [cleanName, customerId]
    );
    if (duplicateRows.length > 0) {
      throw createCustomerError('يوجد عميل آخر بنفس الاسم', 'CUSTOMER_NAME_DUPLICATE');
    }

    const updatedRows = await this.update(
      'UPDATE customers SET name = $1 WHERE id = $2 AND COALESCE(is_active, 1) = 1',
      [cleanName, customerId]
    );
    if (updatedRows < 1) {
      throw createCustomerError('لم يتم تحديث أي عميل', 'CUSTOMER_UPDATE_FAILED');
    }

    return { success: true, updatedRows };
  }
}

module.exports = {
  CustomerService,
  getCustomerId,
  isActiveCustomer,
  normalizeCustomerName
};
