/**
 * Sync Manager - Handles synchronization between SQLite and PostgreSQL
 */

class SyncManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.isSyncing = false;
    this.syncErrors = [];
  }

  /**
   * Sync all pending changes from SQLite to PostgreSQL
   * @returns {Object} Sync result with success status and details
   */
  async syncAll() {
    if (this.isSyncing) {
      return { success: false, error: 'Sync already in progress' };
    }

    if (!this.dbManager.isOnline || !this.dbManager.pgPool) {
      return { success: false, error: 'No internet connection' };
    }

    this.isSyncing = true;
    this.syncErrors = [];

    console.log('Starting synchronization...');

    try {
      // Get all pending sync operations
      const pendingOps = this.dbManager.sqlite.prepare(`
        SELECT * FROM sync_queue WHERE synced = 0 ORDER BY timestamp ASC
      `).all();

      if (pendingOps.length === 0) {
        console.log('No pending operations to sync');
        this.isSyncing = false;
        return { success: true, synced: 0 };
      }

      console.log(`Found ${pendingOps.length} pending operations to sync`);

      let syncedCount = 0;
      let failedCount = 0;

      // Process each operation
      for (const op of pendingOps) {
        try {
          await this.syncOperation(op);

          // Mark as synced
          this.dbManager.sqlite.prepare(`
            UPDATE sync_queue SET synced = 1, error = NULL WHERE id = ?
          `).run(op.id);

          syncedCount++;
        } catch (error) {
          console.error(`Failed to sync operation ${op.id}:`, error);
          failedCount++;

          // Update retry count and error
          if (error.code === 'FUEL_INVOICE_SYNC_CONFLICT') {
            this.dbManager.sqlite.prepare(`
              UPDATE sync_queue
              SET retry_count = 3, error = ?
              WHERE id = ?
            `).run(error.message, op.id);
          } else {
            this.dbManager.sqlite.prepare(`
              UPDATE sync_queue
              SET retry_count = retry_count + 1, error = ?
              WHERE id = ?
            `).run(error.message, op.id);
          }

          this.syncErrors.push({
            operation: op,
            error: error.message
          });

          // If retry count exceeds 3, mark as failed but don't block sync
          if (op.retry_count >= 2) {
            console.warn(`Operation ${op.id} failed after 3 retries, skipping`);
          }
        }
      }

      console.log(`Sync completed: ${syncedCount} succeeded, ${failedCount} failed`);

      // Clean up old synced operations (keep last 1000)
      this.cleanupSyncQueue();

      this.isSyncing = false;
      this.dbManager.lastSyncTime = Date.now();

      return {
        success: true,
        synced: syncedCount,
        failed: failedCount,
        errors: this.syncErrors
      };

    } catch (error) {
      console.error('Sync failed:', error);
      this.isSyncing = false;
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync a single operation
   * @param {Object} op - Sync queue operation
   */
  async syncOperation(op) {
    const data = JSON.parse(op.data);

    switch (op.operation) {
      case 'REPLACE_FUEL_INVOICE':
        await this.syncReplaceFuelInvoice(data);
        break;
      case 'RAW_INSERT':
        await this.syncRawInsert(data);
        break;
      case 'INSERT':
        await this.syncInsert(op.table_name, data);
        break;
      case 'UPDATE':
        await this.syncUpdate(data);
        break;
      case 'DELETE':
        await this.syncDelete(data);
        break;
      default:
        throw new Error(`Unknown operation: ${op.operation}`);
    }
  }

  normalizeIsoDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const normalized = String(value || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
  }

  toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  normalizeFuelInvoiceRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      date: this.normalizeIsoDate(row?.date),
      invoice_number: String(row?.invoice_number || '').trim(),
      product_code: String(row?.product_code || '').trim() || null,
      fuel_type: String(row?.fuel_type || '').trim(),
      quantity: this.toNumber(row?.quantity),
      net_quantity: this.toNumber(row?.net_quantity),
      purchase_price: this.toNumber(row?.purchase_price),
      total: this.toNumber(row?.total),
      invoice_total: this.toNumber(row?.invoice_total)
    })).sort((a, b) => (
      `${a.product_code || ''}|${a.fuel_type}|${a.quantity}|${a.net_quantity}|${a.purchase_price}|${a.total}`
        .localeCompare(`${b.product_code || ''}|${b.fuel_type}|${b.quantity}|${b.net_quantity}|${b.purchase_price}|${b.total}`)
    ));
  }

  fuelInvoiceSnapshotsEqual(currentRows = [], expectedRows = []) {
    return JSON.stringify(this.normalizeFuelInvoiceRows(currentRows))
      === JSON.stringify(this.normalizeFuelInvoiceRows(expectedRows));
  }

  async syncReplaceFuelInvoice(data) {
    const originalInvoiceNumber = String(data?.original_invoice_number || '').trim();
    const invoice = data?.invoice || {};
    const invoiceNumber = String(invoice?.invoice_number || '').trim();
    const date = this.normalizeIsoDate(invoice?.date);
    const safeInvoiceTotal = this.toNumber(invoice?.invoice_total);
    const fuelItems = Array.isArray(invoice?.fuel_items) ? invoice.fuel_items : [];
    const expectedRows = this.normalizeFuelInvoiceRows(data?.original_snapshot?.fuel_invoices || []);

    if (!originalInvoiceNumber || !invoiceNumber || !date || fuelItems.length === 0) {
      throw new Error('Invalid fuel invoice replacement sync payload');
    }

    const client = await this.dbManager.pgPool.connect();
    try {
      await client.query('BEGIN');

      const currentResult = await client.query(
        `SELECT date, invoice_number, product_code, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total
         FROM fuel_invoices
         WHERE invoice_number = $1
         ORDER BY id ASC`,
        [originalInvoiceNumber]
      );
      const currentRows = this.normalizeFuelInvoiceRows(currentResult.rows);

      if (!this.fuelInvoiceSnapshotsEqual(currentRows, expectedRows)) {
        const error = new Error('تعارض مزامنة: تم تعديل الفاتورة على جهاز آخر قبل المزامنة');
        error.code = 'FUEL_INVOICE_SYNC_CONFLICT';
        throw error;
      }

      if (currentRows.length === 0) {
        throw new Error('Fuel invoice no longer exists online');
      }

      await client.query('DELETE FROM fuel_invoices WHERE invoice_number = $1', [originalInvoiceNumber]);
      await client.query(
        'DELETE FROM fuel_movements WHERE type = $1 AND invoice_number = $2',
        ['in', originalInvoiceNumber]
      );

      let insertedCount = 0;
      for (const item of fuelItems) {
        const rawFuelType = String(item?.fuel_type || '').trim();
        const rawProductCode = String(item?.product_code || '').trim();
        if (!rawFuelType && !rawProductCode) continue;

        const productResult = await client.query(
          `SELECT id, product_code, product_name
           FROM products
           WHERE product_type = 'fuel'
             AND (($1::text IS NOT NULL AND product_code = $1) OR product_name = $2)
           ORDER BY CASE WHEN product_code = $1 THEN 0 ELSE 1 END, id ASC
           LIMIT 1`,
          [rawProductCode || null, rawFuelType]
        );
        const product = productResult.rows[0] || {};
        const productCode = product.product_code || rawProductCode || null;
        const productName = product.product_name || rawFuelType;
        const quantity = this.toNumber(item?.quantity);
        const netQuantity = this.toNumber(item?.net_quantity) || quantity;
        const purchasePrice = this.toNumber(item?.purchase_price);
        const total = this.toNumber(item?.total);

        if (!productName || quantity <= 0) continue;

        await client.query(
          `INSERT INTO fuel_invoices (
            date, invoice_number, product_code, fuel_type, quantity, net_quantity, purchase_price, total, invoice_total
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [date, invoiceNumber, productCode, productName, quantity, netQuantity, purchasePrice, total, safeInvoiceTotal]
        );

        await client.query(
          'INSERT INTO fuel_movements (product_code, fuel_type, date, type, quantity, invoice_number, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            productCode,
            productName,
            date,
            'in',
            quantity,
            invoiceNumber,
            `Acquisto - Prezzo: ${purchasePrice} جنيه/لتر - Totale: ${total} جنيه`
          ]
        );
        insertedCount++;
      }

      if (insertedCount === 0) {
        throw new Error('Fuel invoice replacement has no valid rows');
      }

      await client.query('COMMIT');
      console.log(`Synced fuel invoice replacement: ${originalInvoiceNumber} -> ${invoiceNumber}`);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.warn('Rollback after fuel invoice replacement sync failed:', rollbackError.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync an INSERT operation
   */
  async syncInsert(tableName, data) {
    const normalized = (tableName || '').trim().toLowerCase();

    // If table name is unknown, fallback to raw SQL replay
    if (!normalized || normalized === 'unknown') {
      await this.syncRawInsert(data);
      return;
    }

    // Get the record from SQLite
    const record = this.dbManager.sqlite.prepare(
      `SELECT * FROM ${tableName} WHERE id = ?`
    ).get(data.id);

    if (!record) {
      console.warn(`Record ${data.id} not found in ${tableName}, replaying raw insert`);
      await this.syncRawInsert(data);
      return;
    }

    // Build INSERT query
    const columns = Object.keys(record).filter(col => col !== 'id');
    const values = columns.map(col => {
      // Handle JSON fields
      if (col === 'data' && tableName === 'shifts') {
        return record[col]; // Already string in SQLite
      }

      // Convert epoch seconds to Date for timestamp columns
      if (/(_at)$/.test(col)) {
        const val = record[col];
        if (typeof val === 'number') {
          return new Date(val * 1000);
        }
        if (typeof val === 'string' && /^\d+$/.test(val)) {
          return new Date(parseInt(val, 10) * 1000);
        }
      }

      return record[col];
    });

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`;

    try {
      await this.dbManager.pgPool.query(sql, values);
      console.log(`Synced INSERT to ${tableName}, id: ${data.id}`);
    } catch (error) {
      // Check if it's a duplicate key error (already exists in remote)
      if (error.code === '23505') {
        console.warn(`Record already exists in ${tableName}, skipping`);
        return;
      }
      throw error;
    }
  }

  /**
   * Sync a raw INSERT captured offline without table name
   */
  async syncRawInsert(data) {
    if (!data || !data.sql) {
      throw new Error('Raw insert missing SQL');
    }

    try {
      await this.dbManager.pgPool.query(data.sql, data.params || []);
      console.log('Synced RAW INSERT operation');
    } catch (error) {
      console.error('Failed to sync RAW INSERT:', error);
      throw error;
    }
  }

  /**
   * Sync an UPDATE operation
   */
  async syncUpdate(data) {
    // Execute the original SQL with parameters
    try {
      await this.dbManager.pgPool.query(data.sql, data.params);
      console.log('Synced UPDATE operation');
    } catch (error) {
      console.error('Failed to sync UPDATE:', error);
      throw error;
    }
  }

  /**
   * Sync a DELETE operation
   */
  async syncDelete(data) {
    // Execute the original SQL with parameters
    try {
      await this.dbManager.pgPool.query(data.sql, data.params);
      console.log('Synced DELETE operation');
    } catch (error) {
      console.error('Failed to sync DELETE:', error);
      throw error;
    }
  }

  /**
   * Clean up old synced operations
   */
  cleanupSyncQueue() {
    try {
      // Keep only last 1000 synced operations
      this.dbManager.sqlite.prepare(`
        DELETE FROM sync_queue
        WHERE synced = 1
        AND id NOT IN (
          SELECT id FROM sync_queue WHERE synced = 1 ORDER BY timestamp DESC LIMIT 1000
        )
      `).run();

      console.log('Cleaned up old sync queue entries');
    } catch (error) {
      console.error('Failed to cleanup sync queue:', error);
    }
  }

  /**
   * Get sync queue status
   */
  getSyncStatus() {
    try {
      if (!this.dbManager?.sqlite) {
        return {
          pending: 0,
          failed: 0,
          isSyncing: this.isSyncing,
          lastSyncTime: this.dbManager?.lastSyncTime || null
        };
      }

      const pending = this.dbManager.sqlite.prepare(
        'SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0'
      ).get();

      const failed = this.dbManager.sqlite.prepare(
        'SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0 AND retry_count >= 3'
      ).get();

      return {
        pending: pending.count,
        failed: failed.count,
        isSyncing: this.isSyncing,
        lastSyncTime: this.dbManager.lastSyncTime
      };
    } catch (error) {
      console.error('Failed to get sync status:', error);
      return {
        pending: 0,
        failed: 0,
        isSyncing: false,
        lastSyncTime: null
      };
    }
  }

  /**
   * Retry failed sync operations
   */
  async retryFailed() {
    try {
      // Reset retry count for failed operations
      this.dbManager.sqlite.prepare(`
        UPDATE sync_queue
        SET retry_count = 0, error = NULL
        WHERE synced = 0 AND retry_count >= 3
      `).run();

      // Trigger sync
      return await this.syncAll();
    } catch (error) {
      console.error('Failed to retry sync:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SyncManager;
