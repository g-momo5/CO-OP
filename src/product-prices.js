function generateProductCode(type) {
  const cleanType = String(type || 'product').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
  return `${cleanType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function createProduct({ insert }, type, name, price, options = {}) {
  const code = generateProductCode(type);
  const columns = ['product_type', 'product_name', 'product_code', 'current_price'];
  const values = [type, name, code, price];

  for (const column of ['vat', 'effective_date', 'display_order']) {
    if (Object.hasOwn(options, column)) {
      columns.push(column);
      values.push(options[column]);
    }
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const id = await insert(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
    'products'
  );
  return { id, product_code: code };
}

async function createOilProduct(db, name, price, vat) {
  const [row] = await db.query(`
    SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM products WHERE product_type = 'oil'
  `);
  return createProduct(db, 'oil', name, price, { vat, display_order: row.next_order });
}

async function currentPurchasePrice({ query }, product, date) {
  const rows = await query(
    `SELECT price, CAST(start_date AS TEXT) AS start_date
     FROM purchase_price_history
     WHERE (
         product_id = $1
         OR product_code = NULLIF($2, '')
         OR (product_id IS NULL AND (product_code IS NULL OR TRIM(product_code) = '') AND fuel_type = $3)
       )
       AND start_date <= $4
     ORDER BY created_at DESC, start_date DESC, id DESC
     LIMIT 1`,
    [product.id, product.product_code || '', product.product_name, date]
  );
  return rows[0] || null;
}

async function listPurchasePrices(db, date = todayDate()) {
  const rows = await db.query(`
    SELECT
      pp.id,
      p.id AS product_id,
      p.product_code,
      p.product_name AS fuel_type,
      pp.price AS fallback_price,
      CAST(pp.effective_date AS TEXT) AS fallback_effective_date,
      pp.updated_at
    FROM products p
    LEFT JOIN purchase_prices pp ON pp.id = COALESCE(
      (SELECT linked.id
       FROM purchase_prices linked
       WHERE linked.product_id = p.id OR linked.product_code = NULLIF(p.product_code, '')
       ORDER BY linked.updated_at DESC NULLS LAST, linked.id DESC
       LIMIT 1),
      (SELECT legacy.id
       FROM purchase_prices legacy
       WHERE legacy.product_id IS NULL AND (legacy.product_code IS NULL OR TRIM(legacy.product_code) = '')
         AND legacy.fuel_type = p.product_name)
    )
    WHERE p.product_type = 'fuel'
    ORDER BY p.product_name
  `);

  const purchasePrices = [];
  for (const row of rows) {
    const current = await currentPurchasePrice(db, {
      id: row.product_id,
      product_code: row.product_code,
      product_name: row.fuel_type
    }, date);
    const canUseFallback = !row.fallback_effective_date || row.fallback_effective_date <= date;
    purchasePrices.push({
      id: row.id,
      product_id: row.product_id,
      product_code: row.product_code,
      fuel_type: row.fuel_type,
      price: current ? current.price : (canUseFallback ? row.fallback_price : null),
      effective_date: current ? current.start_date : (canUseFallback ? row.fallback_effective_date : null),
      updated_at: row.updated_at
    });
  }
  return purchasePrices;
}

async function saveSalePrice({ insert, update }, product, price, date) {
  await insert(
    `INSERT INTO price_history (product_type, product_name, product_code, price, start_date, product_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, STATEMENT_TIMESTAMP())`,
    [product.product_type, product.product_name, product.product_code || null, price, date, product.id],
    'price_history'
  );
  const updated = await update(
    `UPDATE products
     SET current_price = $1, effective_date = $2
     WHERE id = $3
       AND (effective_date IS NULL OR TRIM(CAST(effective_date AS TEXT)) = '' OR SUBSTR(CAST(effective_date AS TEXT), 1, 10) <= $4)`,
    [price, date, product.id, date]
  );
  return updated > 0;
}

async function savePurchasePrice(db, product, price, date, currentDate = todayDate()) {
  const { id, product_name: name, product_code: code } = product;
  await db.insert(
    `INSERT INTO purchase_price_history (fuel_type, product_code, price, start_date, product_id, created_at)
     VALUES ($1, $2, $3, $4, $5, STATEMENT_TIMESTAMP())`,
    [name, code || null, price, date, id],
    'purchase_price_history'
  );

  const current = await currentPurchasePrice(db, product, currentDate);
  if (!current) return null;

  await db.update(
    `INSERT INTO purchase_prices (fuel_type, product_code, price, effective_date, product_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, STATEMENT_TIMESTAMP())
     ON CONFLICT (fuel_type) DO UPDATE
     SET product_code = EXCLUDED.product_code,
         price = EXCLUDED.price,
         effective_date = EXCLUDED.effective_date,
         product_id = EXCLUDED.product_id,
         updated_at = STATEMENT_TIMESTAMP()`,
    [name, code || null, current.price, current.start_date, id]
  );
  return current;
}

module.exports = { createOilProduct, createProduct, generateProductCode, listPurchasePrices, savePurchasePrice, saveSalePrice, todayDate };
