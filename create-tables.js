const mysql = require('mysql2/promise');

async function fixTableStructure() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Genius44$', // <--- Your MySQL password
    database: 'pepsi_vip'
  });

  console.log('Connected to pepsi_vip database...');

  // Helper to safely add missing columns
  const addColumnIfNotExists = async (table, column, definition) => {
    try {
      await connection.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      console.log(`✔ Added column '${column}' to '${table}'`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log(`ℹ Column '${column}' already exists in '${table}'`);
      } else {
        throw err;
      }
    }
  };

  // 1. Ensure bank_cards table exists with only active fields
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS bank_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      account_number VARCHAR(100) NOT NULL
    );
  `);

  // Add active columns to bank_cards
  await addColumnIfNotExists('bank_cards', 'channel', 'VARCHAR(50) NULL');
  await addColumnIfNotExists('bank_cards', 'official_name', 'VARCHAR(255)');
  await addColumnIfNotExists('bank_cards', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

  // 2. Ensure withdrawals table exists
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Add active withdrawal fields
  await addColumnIfNotExists('withdrawals', 'gross_amount', 'DECIMAL(10, 2) NOT NULL DEFAULT 0.00');
  await addColumnIfNotExists('withdrawals', 'fee_amount', 'DECIMAL(10, 2) NOT NULL DEFAULT 0.00');
  await addColumnIfNotExists('withdrawals', 'net_amount', 'DECIMAL(10, 2) NOT NULL DEFAULT 0.00');
  await addColumnIfNotExists('withdrawals', 'channel', "VARCHAR(100) NULL");
  await addColumnIfNotExists('withdrawals', 'official_name', 'VARCHAR(255)');
  await addColumnIfNotExists('withdrawals', 'account_number', 'VARCHAR(100)');

  // 3. Ensure user_investments table exists for lock-in fund management
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS user_investments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      profit_rate DECIMAL(5, 2) NOT NULL,
      duration_days INT NOT NULL,
      daily_earnings DECIMAL(10, 2) NOT NULL,
      total_return DECIMAL(10, 2) NOT NULL,
      status ENUM('active', 'completed') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log(`✔ Checked/Created 'user_investments' table`);

  await connection.end();
  console.log('Done fixing schema!');
}

fixTableStructure().catch(console.error);