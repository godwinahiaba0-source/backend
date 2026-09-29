const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
  user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'pepsi_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;