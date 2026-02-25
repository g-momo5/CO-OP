const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Supabase connection string
const connectionString = 'postgresql://postgres.ihajlcodsypvjwfnkcjc:Ghaly1997.@aws-1-eu-west-2.pooler.supabase.com:6543/postgres';

// Create PostgreSQL client
const client = new Client({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Function to import data
async function importData() {
  try {
    console.log('Connecting to Supabase...');
    await client.connect();
    console.log('Connected successfully!\n');

    // Read exported data
    const jsonPath = path.join(__dirname, 'exported-data.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log('Starting data import...\n');

    // Import products
    if (data.products && data.products.length > 0) {
      console.log(`Importing ${data.products.length} products...`);
      for (const row of data.products) {
        await client.query(
          `INSERT INTO products (product_type, product_name, current_price, vat, effective_date, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (product_type, product_name) DO UPDATE
           SET current_price = $3, vat = $4, effective_date = $5`,
          [row.product_type, row.product_name, row.current_price, row.vat, row.effective_date, row.created_at]
        );
      }
      console.log('✓ Products imported');
    }

    // Import fuel_prices
    if (data.fuel_prices && data.fuel_prices.length > 0) {
      console.log(`Importing ${data.fuel_prices.length} fuel prices...`);
      for (const row of data.fuel_prices) {
        await client.query(
          `INSERT INTO fuel_prices (fuel_type, price, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (fuel_type) DO UPDATE
           SET price = $2, updated_at = $3`,
          [row.fuel_type, row.price, row.updated_at]
        );
      }
      console.log('✓ Fuel prices imported');
    }

    // Import purchase_prices
    if (data.purchase_prices && data.purchase_prices.length > 0) {
      console.log(`Importing ${data.purchase_prices.length} purchase prices...`);
      for (const row of data.purchase_prices) {
        await client.query(
          `INSERT INTO purchase_prices (fuel_type, price, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (fuel_type) DO UPDATE
           SET price = $2, updated_at = $3`,
          [row.fuel_type, row.price, row.updated_at]
        );
      }
      console.log('✓ Purchase prices imported');
    }

    // Import sales
    if (data.sales && data.sales.length > 0) {
      console.log(`Importing ${data.sales.length} sales...`);
      for (const row of data.sales) {
        await client.query(
          `INSERT INTO sales (date, fuel_type, quantity, price_per_liter, total_amount, payment_method, customer_name, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [row.date, row.fuel_type, row.quantity, row.price_per_liter, row.total_amount, row.payment_method, row.customer_name, row.notes]
        );
      }
      console.log('✓ Sales imported');
    }

    // Import oil_movements
    if (data.oil_movements && data.oil_movements.length > 0) {
      console.log(`Importing ${data.oil_movements.length} oil movements...`);
      for (const row of data.oil_movements) {
        await client.query(
          `INSERT INTO oil_movements (oil_type, date, type, quantity, invoice_number, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.oil_type, row.date, row.type, row.quantity, row.invoice_number, row.created_at]
        );
      }
      console.log('✓ Oil movements imported');
    }

    // Import fuel_movements
    if (data.fuel_movements && data.fuel_movements.length > 0) {
      console.log(`Importing ${data.fuel_movements.length} fuel movements...`);
      for (const row of data.fuel_movements) {
        await client.query(
          `INSERT INTO fuel_movements (fuel_type, date, type, quantity, invoice_number, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.fuel_type, row.date, row.type, row.quantity, row.invoice_number, row.created_at]
        );
      }
      console.log('✓ Fuel movements imported');
    }

    // Import price_history
    if (data.price_history && data.price_history.length > 0) {
      console.log(`Importing ${data.price_history.length} price history records...`);
      for (const row of data.price_history) {
        await client.query(
          `INSERT INTO price_history (product_type, product_name, price, start_date, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.product_type, row.product_name, row.price, row.start_date, row.created_at]
        );
      }
      console.log('✓ Price history imported');
    }

    // Skip invoices import for now - schema differences need to be resolved
    console.log(`Skipping ${data.fuel_invoices?.length || 0} fuel invoices (schema mismatch)`);
    console.log(`Skipping ${data.oil_invoices?.length || 0} oil invoices (schema mismatch)`);

    console.log('\n=== IMPORT SUMMARY ===');
    console.log(`Products: ${data.products?.length || 0} rows`);
    console.log(`Fuel prices: ${data.fuel_prices?.length || 0} rows`);
    console.log(`Purchase prices: ${data.purchase_prices?.length || 0} rows`);
    console.log(`Sales: ${data.sales?.length || 0} rows`);
    console.log(`Oil movements: ${data.oil_movements?.length || 0} rows`);
    console.log(`Fuel movements: ${data.fuel_movements?.length || 0} rows`);
    console.log(`Price history: ${data.price_history?.length || 0} rows`);
    console.log(`Fuel invoices: ${data.fuel_invoices?.length || 0} rows`);
    console.log(`Oil invoices: ${data.oil_invoices?.length || 0} rows`);
    console.log('\n✓ Import completed successfully!');

  } catch (error) {
    console.error('Error during import:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\nConnection closed.');
  }
}

// Run import
importData().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
