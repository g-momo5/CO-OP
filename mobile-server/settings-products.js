const { createOilProduct, createProduct, listPurchasePrices, savePurchasePrice, saveSalePrice, todayDate } = require('../src/product-prices');

async function listProducts(db) {
  const [products, purchasePrices] = await Promise.all([
    db.query(`
      SELECT id, product_code AS code, product_type AS type, product_name AS name,
             current_price AS "salePrice", CAST(effective_date AS TEXT) AS "saleDate",
             COALESCE(vat, 0) AS vat, COALESCE(is_active, 1) = 1 AS active
      FROM products
      WHERE product_type IN ('fuel', 'oil')
      ORDER BY product_type,
        CASE WHEN product_type = 'oil' AND COALESCE(display_order, 0) <> 0 THEN display_order END NULLS LAST,
        product_name
    `),
    listPurchasePrices(db)
  ]);
  const purchaseById = new Map(purchasePrices.map((price) => [price.product_id, price]));

  return products.map((product) => ({
    ...product,
    purchasePrice: purchaseById.get(product.id)?.price ?? null,
    purchaseDate: purchaseById.get(product.id)?.effective_date ?? null
  }));
}

async function listPriceHistory(db) {
  const [products, rows] = await Promise.all([
    listProducts(db),
    db.query(`
      SELECT id, product_id, product_code, product_type AS type, product_name AS name,
             price, CAST(start_date AS TEXT) AS date, created_at, 'sale' AS kind
      FROM price_history
      WHERE product_type IN ('fuel', 'oil')
      UNION ALL
      SELECT id, product_id, product_code, 'fuel' AS type, fuel_type AS name,
             price, CAST(start_date AS TEXT) AS date, created_at, 'purchase' AS kind
      FROM purchase_price_history
      ORDER BY date DESC, created_at DESC NULLS LAST, id DESC
    `)
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));
  const byCode = new Map(products.filter(({ code }) => code).map((product) => [product.code, product]));
  const byName = new Map(products.map((product) => [`${product.type}:${product.name}`, product]));
  const dates = new Set();
  const history = [];

  function addEntry(key, name, type, kind, date, price) {
    if (!date || price == null) return;
    const dateKey = JSON.stringify([key, kind, date]);
    if (dates.has(dateKey)) return;
    dates.add(dateKey);
    history.push({ key, name, type, kind, date, price });
  }

  for (const row of rows) {
    const legacyKey = `${row.type}:${row.name}`;
    const product = byId.get(row.product_id) || byCode.get(row.product_code)
      || (!row.product_id && !row.product_code ? byName.get(legacyKey) : null);
    const key = product?.id ?? row.product_id ?? row.product_code ?? legacyKey;
    addEntry(key, product?.name ?? row.name, row.type, row.kind, row.date, row.price);
  }
  for (const product of products) {
    addEntry(product.id, product.name, product.type, 'sale', product.saleDate, product.salePrice);
    addEntry(product.id, product.name, product.type, 'purchase', product.purchaseDate, product.purchasePrice);
  }
  return history.sort((left, right) => right.date.localeCompare(left.date));
}

function addProduct(db, { type, name, price, vat }) {
  if (type === 'oil') return createOilProduct(db, name, price, vat);
  return createProduct(db, type, name, price);
}

async function lockProducts(db, ids) {
  return db.query(
    `SELECT id, product_type, product_name, product_code
     FROM products WHERE id = ANY($1::integer[]) AND product_type IN ('fuel', 'oil')
     ORDER BY id FOR UPDATE`,
    [ids]
  );
}

async function renameProduct(db, product, name) {
  const { id, product_code: code, product_type: type, product_name: oldName } = product;
  if (name === oldName) return;

  await db.update('UPDATE products SET product_name = $1 WHERE id = $2', [name, id]);
  await db.update(
    `UPDATE price_history SET product_id = $1, product_code = COALESCE(NULLIF(product_code, ''), $2)
     WHERE product_id IS NULL AND product_type = $3
       AND (product_code = NULLIF($2, '') OR (COALESCE(product_code, '') = '' AND product_name = $4))`,
    [id, code, type, oldName]
  );
  if (type === 'fuel') {
    await db.update(
      `UPDATE purchase_price_history SET product_id = $1, product_code = COALESCE(NULLIF(product_code, ''), $2)
       WHERE product_id IS NULL
         AND (product_code = NULLIF($2, '') OR (COALESCE(product_code, '') = '' AND fuel_type = $3))`,
      [id, code, oldName]
    );
    await db.update(
      `UPDATE purchase_prices AS current_price
       SET product_id = $1,
           product_code = COALESCE(NULLIF(current_price.product_code, ''), $2),
           fuel_type = CASE
             WHEN current_price.fuel_type = $3 AND NOT EXISTS (
               SELECT 1 FROM purchase_prices WHERE fuel_type = $4
             ) THEN $4
             ELSE current_price.fuel_type
           END
       WHERE current_price.product_id = $1 OR current_price.product_code = NULLIF($2, '')
         OR (current_price.product_id IS NULL AND COALESCE(current_price.product_code, '') = '' AND current_price.fuel_type = $3)`,
      [id, code, oldName, name]
    );
  }
}

async function applyPrices(db, products, changes, date) {
  const today = todayDate();
  let saved = 0;
  for (const product of products) {
    const { salePrice, purchasePrice } = changes.get(product.id);
    if (salePrice !== undefined) {
      await saveSalePrice(db, product, salePrice, date);
      saved++;
    }
    if (purchasePrice !== undefined) {
      await savePurchasePrice(db, product, purchasePrice, date, today);
      saved++;
    }
  }
  return saved;
}

module.exports = { addProduct, applyPrices, listPriceHistory, listProducts, lockProducts, renameProduct };
