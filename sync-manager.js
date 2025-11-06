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
          this.dbManager.sqlite.prepare(`
            UPDATE sync_queue
            SET retry_count = retry_count + 1, error = ?
            WHERE id = ?
          `).run(error.message, op.id);

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

  /**
   * Sync an INSERT operation
   */
  async syncInsert(tableName, data) {
    // Get the record from SQLite
    const record = this.dbManager.sqlite.prepare(
      `SELECT * FROM ${tableName} WHERE id = ?`
    ).get(data.id);

    if (!record) {
      console.warn(`Record ${data.id} not found in ${tableName}, skipping`);
      return;
    }

    // Build INSERT query
    const columns = Object.keys(record).filter(col => col !== 'id');
    const values = columns.map(col => {
      // Handle JSON fields
      if (col === 'data' && tableName === 'shifts') {
        return record[col]; // Already string in SQLite
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
