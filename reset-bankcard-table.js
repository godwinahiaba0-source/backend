const db = require('./config/db');

async function resetTable() {
  try {
    console.log('Dropping old bank_cards table...');
    await db.query(`DROP TABLE IF EXISTS bank_cards`);

    console.log('Creating clean bank_cards table...');
    await db.query(`
      CREATE TABLE bank_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        channel VARCHAR(100) NOT NULL,
        official_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Success! bank_cards table recreated successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting table:', error);
    process.exit(1);
  }
}

resetTable();