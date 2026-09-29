require('dotenv').config();
const mysql = require('mysql2/promise');

async function clearAllTransactions() {
  // Use the exact environment variables your server uses
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', // This will now pick up your password from .env!
    database: process.env.DB_NAME || 'pepsi'   // Make sure this matches your DB name
  });

  try {
    console.log('Clearing all transaction and history tables...');
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');

    const tables = [
      'withdrawals',
      'user_funds',
      'transactions',
      'deposits',
      'team_commissions'
    ];

    for (const table of tables) {
      try {
        await pool.query(`TRUNCATE TABLE ${table}`);
        console.log(`- Cleared table: ${table}`);
      } catch (err) {
        console.log(`- Skipping table ${table} (not found or already empty)`);
      }
    }

    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('All transaction tables successfully wiped clean!');
  } catch (error) {
    console.error('Error clearing transactions:', error.message);
  } finally {
    await pool.end();
  }
}

clearAllTransactions();