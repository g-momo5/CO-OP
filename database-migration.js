const fs = require('fs');
const path = require('path');

class SchemaMigrator {
  constructor(pgPool, sqliteDb, userDataPath) {
    this.pgPool = pgPool;
    this.sqliteDb = sqliteDb;
    this.userDataPath = userDataPath;
  }

  /**
   * Esegue la migrazione automatica dello schema SQLite basandosi su PostgreSQL
   */
  async migrateSchema() {
    console.log('🔄 Inizio migrazione schema SQLite da PostgreSQL...');

    try {
      // Ottieni lista delle tabelle da PostgreSQL
      const pgTables = await this.getPostgreSQLTables();
      console.log(`📊 Trovate ${pgTables.length} tabelle in PostgreSQL`);

      let totalChanges = 0;

      // Per ogni tabella, confronta e migra
      for (const tableName of pgTables) {
        console.log(`\n🔍 Analisi tabella: ${tableName}`);

        const pgSchema = await this.getPostgreSQLSchema(tableName);
        const sqliteSchema = await this.getSQLiteSchema(tableName);

        const changes = this.compareSchemas(tableName, pgSchema, sqliteSchema);

        if (changes.length > 0) {
          console.log(`⚠️  Trovate ${changes.length} differenze nella tabella ${tableName}`);
          await this.applyChanges(tableName, changes, pgSchema, sqliteSchema);
          totalChanges += changes.length;
        } else {
          console.log(`✅ Tabella ${tableName} già allineata`);
        }
      }

      console.log(`\n✨ Migrazione completata! Applicate ${totalChanges} modifiche totali`);
      return { success: true, changes: totalChanges };

    } catch (error) {
      console.error('❌ Errore durante la migrazione schema:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ottiene la lista delle tabelle da PostgreSQL
   */
  async getPostgreSQLTables() {
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    const result = await this.pgPool.query(query);
    return result.rows.map(row => row.table_name);
  }

  /**
   * Ottiene lo schema di una tabella da PostgreSQL
   */
  async getPostgreSQLSchema(tableName) {
    const query = `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        ordinal_position,
        udt_name,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `;

    const result = await this.pgPool.query(query, [tableName]);
    return result.rows.map(row => ({
      name: row.column_name,
      type: this.mapPostgreSQLTypeToSQLite(row.data_type, row.udt_name),
      pgType: row.data_type,
      pgUdtName: row.udt_name,
      nullable: row.is_nullable === 'YES',
      defaultValue: row.column_default,
      position: row.ordinal_position
    }));
  }

  /**
   * Ottiene lo schema di una tabella da SQLite
   */
  getSQLiteSchema(tableName) {
    try {
      // better-sqlite3 uses synchronous API
      const rows = this.sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();

      return rows.map(row => ({
        name: row.name,
        type: row.type,
        nullable: row.notnull === 0,
        defaultValue: row.dflt_value,
        isPrimaryKey: row.pk === 1,
        position: row.cid
      }));
    } catch (err) {
      // Se la tabella non esiste in SQLite, ritorna array vuoto
      if (err.message && err.message.includes('no such table')) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Mappa i tipi PostgreSQL ai tipi SQLite
   */
  mapPostgreSQLTypeToSQLite(pgType, udtName) {
    const typeMap = {
      // Interi
      'integer': 'INTEGER',
      'bigint': 'INTEGER',
      'smallint': 'INTEGER',
      'serial': 'INTEGER',
      'bigserial': 'INTEGER',

      // Decimali
      'numeric': 'REAL',
      'decimal': 'REAL',
      'real': 'REAL',
      'double precision': 'REAL',

      // Testo
      'character varying': 'TEXT',
      'varchar': 'TEXT',
      'character': 'TEXT',
      'char': 'TEXT',
      'text': 'TEXT',

      // Data/Ora (SQLite usa INTEGER per timestamp Unix)
      'timestamp without time zone': 'INTEGER',
      'timestamp with time zone': 'INTEGER',
      'timestamp': 'INTEGER',
      'date': 'TEXT',
      'time': 'TEXT',

      // Boolean (SQLite usa INTEGER 0/1)
      'boolean': 'INTEGER',

      // JSON (SQLite usa TEXT)
      'json': 'TEXT',
      'jsonb': 'TEXT',

      // Altri
      'uuid': 'TEXT'
    };

    const normalizedType = pgType.toLowerCase();
    return typeMap[normalizedType] || 'TEXT';
  }

  /**
   * Confronta due schemi e identifica le differenze
   */
  compareSchemas(tableName, pgSchema, sqliteSchema) {
    const changes = [];

    // Se la tabella non esiste in SQLite, va creata
    if (sqliteSchema.length === 0) {
      changes.push({
        type: 'CREATE_TABLE',
        columns: pgSchema
      });
      return changes;
    }

    // Crea una mappa delle colonne SQLite per lookup veloce
    const sqliteColumns = new Map(sqliteSchema.map(col => [col.name, col]));
    const pgColumns = new Map(pgSchema.map(col => [col.name, col]));

    // Trova colonne da aggiungere (presenti in PG ma non in SQLite)
    for (const pgCol of pgSchema) {
      if (!sqliteColumns.has(pgCol.name)) {
        changes.push({
          type: 'ADD_COLUMN',
          column: pgCol
        });
      } else {
        // Verifica se il tipo è cambiato
        const sqliteCol = sqliteColumns.get(pgCol.name);
        if (sqliteCol.type !== pgCol.type) {
          changes.push({
            type: 'MODIFY_COLUMN_TYPE',
            column: pgCol,
            oldType: sqliteCol.type,
            newType: pgCol.type
          });
        }
      }
    }

    // Trova colonne da rimuovere (presenti in SQLite ma non in PG)
    for (const sqliteCol of sqliteSchema) {
      if (!pgColumns.has(sqliteCol.name)) {
        changes.push({
          type: 'DROP_COLUMN',
          columnName: sqliteCol.name
        });
      }
    }

    return changes;
  }

  /**
   * Applica le modifiche allo schema SQLite
   */
  async applyChanges(tableName, changes, pgSchema, sqliteSchema) {
    // Backup del database prima di modifiche strutturali
    const needsBackup = changes.some(c =>
      c.type === 'DROP_COLUMN' ||
      c.type === 'MODIFY_COLUMN_TYPE' ||
      c.type === 'CREATE_TABLE'
    );

    if (needsBackup) {
      this.backupDatabase();
    }

    try {
      for (const change of changes) {
        console.log(`  🔧 Applicando: ${change.type} ${change.column?.name || change.columnName || ''}`);

        switch (change.type) {
          case 'CREATE_TABLE':
            this.createTable(tableName, change.columns);
            break;

          case 'ADD_COLUMN':
            this.addColumn(tableName, change.column);
            break;

          case 'DROP_COLUMN':
          case 'MODIFY_COLUMN_TYPE':
            // SQLite non supporta DROP COLUMN o ALTER COLUMN TYPE
            // Dobbiamo ricreare la tabella
            this.recreateTable(tableName, pgSchema, sqliteSchema);
            break;
        }
      }

      console.log(`  ✅ Modifiche applicate con successo a ${tableName}`);

    } catch (error) {
      console.error(`  ❌ Errore applicando modifiche a ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Crea una nuova tabella in SQLite
   */
  createTable(tableName, columns) {
    const columnDefs = columns.map(col => {
      let def = `${col.name} ${col.type}`;

      // Gestisci PRIMARY KEY per id
      if (col.name === 'id') {
        def += ' PRIMARY KEY AUTOINCREMENT';
      }

      // Gestisci NOT NULL
      if (!col.nullable && col.name !== 'id') {
        def += ' NOT NULL';
      }

      // Gestisci DEFAULT (escludi quelli di PostgreSQL come nextval)
      if (col.defaultValue && !col.defaultValue.includes('nextval')) {
        // Converti CURRENT_TIMESTAMP per SQLite
        if (col.defaultValue.includes('CURRENT_TIMESTAMP')) {
          def += ` DEFAULT (strftime('%s', 'now'))`;
        } else {
          def += ` DEFAULT ${col.defaultValue}`;
        }
      }

      return def;
    }).join(', ');

    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`;
    this.sqliteDb.prepare(sql).run();
  }

  /**
   * Aggiunge una colonna a una tabella esistente
   */
  addColumn(tableName, column) {
    let sql = `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type}`;

    // Aggiungi constraint NOT NULL solo se ha un DEFAULT
    // (SQLite non permette NOT NULL senza DEFAULT su colonne esistenti)
    if (!column.nullable && column.defaultValue) {
      sql += ' NOT NULL';
    }

    // Gestisci DEFAULT
    if (column.defaultValue && !column.defaultValue.includes('nextval')) {
      if (column.defaultValue.includes('CURRENT_TIMESTAMP')) {
        sql += ` DEFAULT (strftime('%s', 'now'))`;
      } else {
        sql += ` DEFAULT ${column.defaultValue}`;
      }
    } else if (!column.nullable) {
      // Se NOT NULL ma nessun default da PG, aggiungi un default ragionevole
      if (column.type === 'INTEGER') {
        sql += ' DEFAULT 0';
      } else if (column.type === 'TEXT') {
        sql += " DEFAULT ''";
      } else if (column.type === 'REAL') {
        sql += ' DEFAULT 0.0';
      }
    }

    this.sqliteDb.prepare(sql).run();
  }

  /**
   * Ricrea una tabella con il nuovo schema
   * (Necessario per DROP COLUMN o MODIFY COLUMN TYPE)
   */
  recreateTable(tableName, pgSchema, sqliteSchema) {
    // 1. Crea tabella temporanea con nuovo schema
    const columnDefs = pgSchema.map(col => {
      let def = `${col.name} ${col.type}`;

      if (col.name === 'id') {
        def += ' PRIMARY KEY AUTOINCREMENT';
      }

      if (!col.nullable && col.name !== 'id') {
        def += ' NOT NULL';
      }

      if (col.defaultValue && !col.defaultValue.includes('nextval')) {
        if (col.defaultValue.includes('CURRENT_TIMESTAMP')) {
          def += ` DEFAULT (strftime('%s', 'now'))`;
        } else {
          def += ` DEFAULT ${col.defaultValue}`;
        }
      }

      return def;
    }).join(', ');

    const createTempSql = `CREATE TABLE ${tableName}_new (${columnDefs})`;
    this.sqliteDb.prepare(createTempSql).run();

    // 2. Copia i dati dalla vecchia tabella (solo colonne compatibili)
    const commonColumns = pgSchema
      .filter(pgCol => sqliteSchema.some(sqliteCol => sqliteCol.name === pgCol.name))
      .map(col => col.name)
      .join(', ');

    if (commonColumns) {
      const copySql = `INSERT INTO ${tableName}_new (${commonColumns}) SELECT ${commonColumns} FROM ${tableName}`;
      this.sqliteDb.prepare(copySql).run();
    }

    // 3. Elimina vecchia tabella
    this.sqliteDb.prepare(`DROP TABLE ${tableName}`).run();

    // 4. Rinomina nuova tabella
    this.sqliteDb.prepare(`ALTER TABLE ${tableName}_new RENAME TO ${tableName}`).run();
  }

  /**
   * Crea un backup del database SQLite
   */
  backupDatabase() {
    const dbPath = path.join(this.userDataPath, 'coop_local.db');
    const backupPath = path.join(this.userDataPath, `coop_local.db.backup.${Date.now()}`);

    try {
      fs.copyFileSync(dbPath, backupPath);
      console.log(`💾 Backup creato: ${backupPath}`);

      // Mantieni solo gli ultimi 5 backup
      this.cleanupOldBackups();
    } catch (error) {
      console.error('⚠️  Impossibile creare backup:', error);
    }
  }

  /**
   * Pulisce i vecchi backup mantenendo solo gli ultimi 5
   */
  cleanupOldBackups() {
    try {
      const files = fs.readdirSync(this.userDataPath);
      const backups = files
        .filter(f => f.startsWith('coop_local.db.backup.'))
        .map(f => ({
          name: f,
          path: path.join(this.userDataPath, f),
          time: fs.statSync(path.join(this.userDataPath, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // Elimina tutti tranne i primi 5
      backups.slice(5).forEach(backup => {
        fs.unlinkSync(backup.path);
        console.log(`🗑️  Backup vecchio eliminato: ${backup.name}`);
      });
    } catch (error) {
      console.error('⚠️  Errore durante pulizia backup:', error);
    }
  }
}

module.exports = SchemaMigrator;
