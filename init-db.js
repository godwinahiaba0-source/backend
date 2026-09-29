const mysql = require('mysql2/promise');

async function ensureTablesExist() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || process.env.MYSQLHOST,
      user: process.env.DB_USER || process.env.MYSQLUSER,
      password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD,
      database: process.env.DB_NAME || process.env.MYSQLDATABASE,
      port: process.env.DB_PORT || process.env.MYSQLPORT
    });

    // Create Users table with phone column included
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(50) NOT NULL UNIQUE,
        username VARCHAR(255),
        password VARCHAR(255) NOT NULL,
        vip_level INT DEFAULT 0,
        withdrawal_enabled TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safe fallback to ensure the phone column exists if the table was already there
    try {
      await connection.execute(`ALTER TABLE users ADD COLUMN phone VARCHAR(50) UNIQUE;`);
      console.log('Successfully added "phone" column to users table.');
    } catch (e) {
      // Column already exists, safe to ignore
    }

    // Create Transactions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'completed',
        reference VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✔ All database tables verified successfully!');
    await connection.end();
  } catch (err) {
    console.error('Database init error:', err.message);
  }
}

module.exports = ensureTablesExist;