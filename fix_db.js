const mysql = require('mysql2/promise');
require('dotenv').config();

async function runFix() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME
    });

    console.log('Connected to MySQL database. Executing updates...');

    // 1. Ensure users table has a vip_level column
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN vip_level INT DEFAULT 0`);
      console.log('✔ Added vip_level column to users table.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('ℹ vip_level column already exists in users table.');
      } else {
        console.warn('Note on users table modification:', e.message);
      }
    }

    // 1b. Ensure users table has withdrawal_enabled column
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN withdrawal_enabled TINYINT(1) DEFAULT 1`);
      console.log('✔ Added withdrawal_enabled column to users table.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('ℹ withdrawal_enabled column already exists in users table.');
      } else {
        console.warn('Note on withdrawal_enabled modification:', e.message);
      }
    }

    // 1c. Ensure users table has balance column
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN balance DECIMAL(10,2) DEFAULT 0.00`);
      console.log('✔ Added balance column to users table.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('ℹ balance column already exists in users table.');
      } else {
        console.warn('Note on balance column modification:', e.message);
      }
    }

    // 1d. Fix withdrawals table created_at to DATETIME so it stores exact times instead of 00:00:00
    try {
      await connection.query(`ALTER TABLE withdrawals MODIFY COLUMN created_at DATETIME`);
      console.log('✔ Successfully updated withdrawals.created_at to DATETIME.');
    } catch (e) {
      console.warn('Note on withdrawals table modification (table might not exist yet):', e.message);
    }

    // 2. Create devices table if missing
    await connection.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        hourly_yield DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        vip_level INT DEFAULT 1
      )
    `);

    // Ensure devices.vip_level has a default value if table was previously created without one
    try {
      await connection.query(`ALTER TABLE devices MODIFY COLUMN vip_level INT DEFAULT 1`);
    } catch (e) {
      // Ignore if table/column missing or not needed
    }

    // 3. Create user_devices table if missing
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        device_id INT NOT NULL,
        status VARCHAR(20) DEFAULT 'ACTIVE'
      )
    `);

    // 4. Safely add created_at column to user_devices
    try {
      await connection.query(`ALTER TABLE user_devices ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      console.log('✔ Added created_at column to user_devices.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('ℹ created_at column already exists in user_devices.');
      } else {
        throw e;
      }
    }

    // 5. Safely add last_yield_at column to user_devices
    try {
      await connection.query(`ALTER TABLE user_devices ADD COLUMN last_yield_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      console.log('✔ Added last_yield_at column to user_devices.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('ℹ last_yield_at column already exists in user_devices.');
      } else {
        throw e;
      }
    }

    // 5b. Safely add lv0_credits_count column to user_devices
    try {
      await connection.query(`ALTER TABLE user_devices ADD COLUMN lv0_credits_count DECIMAL(10,2) DEFAULT 0.00`);
      console.log('✔ Added lv0_credits_count column to user_devices.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('ℹ lv0_credits_count column already exists in user_devices.');
      } else {
        throw e;
      }
    }

    // 6. Seed VIP Devices into devices table
    await connection.query(`
      INSERT INTO devices (id, name, price, hourly_yield, vip_level) VALUES 
      (1, 'LV 1 VIP Device', 100.00, 0.26, 1),
      (2, 'LV 2 VIP Device', 200.00, 0.46, 2),
      (3, 'LV 3 VIP Device', 500.00, 1.04, 3),
      (4, 'LV 4 VIP Device', 1500.00, 2.84, 4),
      (5, 'LV 5 VIP Device', 3000.00, 5.20, 5),
      (6, 'LV 6 VIP Device', 10000.00, 17.36, 6),
      (7, 'LV 7 VIP Device', 20000.00, 37.87, 7),
      (8, 'LV 8 VIP Device', 60000.00, 125.00, 8),
      (9, 'LV 9 VIP Device', 150000.00, 347.22, 9),
      (10, 'LV 10 VIP Device', 300000.00, 781.25, 10),
      (11, 'LV 11 VIP Device', 450000.00, 1171.88, 11),
      (12, 'LV 12 VIP Device', 500000.00, 1302.08, 12)

      ON DUPLICATE KEY UPDATE 
        name=VALUES(name),
        price=VALUES(price), 
        hourly_yield=VALUES(hourly_yield),
        vip_level=VALUES(vip_level);
    `);
    console.log('✔ Devices table seeded successfully.');

    // 7. Update users table so vip_level equals MAX vip_level of their active purchased devices
    await connection.query(`
      UPDATE users u
      SET u.vip_level = IFNULL((
        SELECT MAX(d.vip_level)
        FROM user_devices ud
        JOIN devices d ON ud.device_id = d.id
        WHERE ud.user_id = u.id
      ), 0)
    `);
    console.log('✔ User VIP levels synced to their maximum purchased device level!');

    console.log('\n🚀 Database script finished successfully!');

  } catch (err) {
    console.error('❌ Error executing database script:', err);
  } finally {
    if (connection) await connection.end();
  }
}

runFix();