const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'coop_database.db');
const db = new sqlite3.Database(dbPath);

// Tables to export
const tables = [
  'products',
  'fuel_prices',
  'purchase_prices',
  'sales',
  'oil_movements',
  'fuel_movements',
  'price_history',
  'fuel_invoices',
  'oil_invoices'
];

// Function to escape SQL strings
function escapeSQLString(str) {
  if (str === null || str === undefined) return 'NULL';
  if (typeof str === 'number') return str;
  return "'" + String(str).replace(/'/g, "''") + "'";
}

// Function to convert SQLite row to PostgreSQL INSERT
function generatePostgreSQLInsert(tableName, row, columns) {
  const values = columns.map(col => {
    const value = row[col];
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return escapeSQLString(value);
    return escapeSQLString(String(value));
  });

  return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
}

// Export data from all tables
async function exportAllTables() {
  const allData = {};
  const sqlStatements = [];

  console.log('Starting data export from SQLite...\n');

  for (const table of tables) {
    await new Promise((resolve, reject) => {
      // First get table structure
      db.all(`PRAGMA table_info(${table})`, (err, columns) => {
        if (err) {
          console.error(`Error getting structure of ${table}:`, err);
          reject(err);
          return;
        }

        const columnNames = columns.map(col => col.name).filter(name => name !== 'id');

        // Then get all data
        db.all(`SELECT * FROM ${table}`, (err, rows) => {
          if (err) {
            console.error(`Error exporting ${table}:`, err);
            reject(err);
            return;
          }

          console.log(`${table}: ${rows.length} rows`);

          allData[table] = rows;

          // Generate SQL INSERT statements
          if (rows.length > 0) {
            sqlStatements.push(`\n-- ${table.toUpperCase()} TABLE (${rows.length} rows)`);
            rows.forEach(row => {
              const insert = generatePostgreSQLInsert(table, row, columnNames);
              sqlStatements.push(insert);
            });
          }

          resolve();
        });
      });
    });
  }

  // Save JSON file
  const jsonPath = path.join(__dirname, 'exported-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allData, null, 2));
  console.log(`\nJSON data saved to: ${jsonPath}`);

  // Save SQL file
  const sqlPath = path.join(__dirname, 'exported-data.sql');
  const sqlContent = `-- SQLite to PostgreSQL Data Export
-- Generated: ${new Date().toISOString()}
-- Database: coop_database.db

${sqlStatements.join('\n')}
`;
  fs.writeFileSync(sqlPath, sqlContent);
  console.log(`SQL statements saved to: ${sqlPath}`);

  console.log('\nExport completed successfully!');

  // Print summary
  console.log('\n=== EXPORT SUMMARY ===');
  Object.entries(allData).forEach(([table, rows]) => {
    console.log(`${table}: ${rows.length} rows`);
  });

  db.close();
}

// Run export
exportAllTables().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
