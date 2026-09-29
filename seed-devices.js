require('dotenv').config();
const mysql = require('mysql2/promise');

async function seedDevices() {
  // Use environment variables or fallback to your local credentials
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Genius44$',
    database: process.env.DB_NAME || 'pepsi_vip'
  });

  console.log('Connected to pepsi_vip database...');

  // Corrected device list with VIP 9 duplicate removed
  const devices = [
    { name: 'VIP 1 Equipment', vip_level: 1, price: 100.00, hourly_yield: 0.26 },
    { name: 'VIP 2 Equipment', vip_level: 2, price: 200.00, hourly_yield: 0.46 },
    { name: 'VIP 3 Equipment', vip_level: 3, price: 500.00, hourly_yield: 1.04 },
    { name: 'VIP 4 Equipment', vip_level: 4, price: 1500.00, hourly_yield: 2.84 },
    { name: 'VIP 5 Equipment', vip_level: 5, price: 3000.00, hourly_yield: 5.20 },
    { name: 'VIP 6 Equipment', vip_level: 6, price: 10000.00, hourly_yield: 17.36 },
    { name: 'VIP 7 Equipment', vip_level: 7, price: 20000.00, hourly_yield: 37.87 },
    { name: 'VIP 8 Equipment', vip_level: 8, price: 60000.00, hourly_yield: 125.00 },
    { name: 'VIP 9 Equipment', vip_level: 9, price: 150000.00, hourly_yield: 347.22 },
    { name: 'VIP 10 Equipment', vip_level: 10, price: 300000.00, hourly_yield: 781.25 },
    { name: 'VIP 11 Equipment', vip_level: 11, price: 450000.00, hourly_yield: 1171.88 },
    { name: 'VIP 12 Equipment', vip_level: 12, price: 500000.00, hourly_yield: 1302.08 }
  ];

  // Ensure devices table exists before seeding
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      vip_level INT UNIQUE NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      hourly_yield DECIMAL(10, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const device of devices) {
    // Inserts the device if missing, or updates parameters if it already exists
    await connection.execute(
      `INSERT INTO devices (name, vip_level, price, hourly_yield) 
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         name = VALUES(name),
         price = VALUES(price),
         hourly_yield = VALUES(hourly_yield);`,
      [device.name, device.vip_level, device.price, device.hourly_yield]
    );
  }

  console.log('✔ Devices catalog seeded successfully!');
  await connection.end();
}

seedDevices().catch(console.error);