require('dotenv').config();
require('./init-db')();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jwt-simple');
const cron = require('node-cron');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const pool = require('./db');
const fundRoutes = require('./fund');
const bankCardRoutes = require('./bankcard'); // Added bankcard route module[cite: 5]
// At the top of your server.js with other route imports:
const { adminRouter } = require('./adminAuth');
const setDeviceRoutes = require('./deviceController');
const withdrawalController = require('./withdrawalController')
const initDeviceYieldCron = require('./deviceCron');
const teamRoutes = require('./teamRoutes');
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS[cite: 5]
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, message: 'Access token missing' });

  try {
    const decoded = jwt.decode(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
};

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'))); // Serve uploaded screenshots publicly[cite: 5]

// Configure Multer Storage for Payment Proof Screenshots[cite: 5]
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public/uploads');
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, 'proof_' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Limit image size to 5MB[cite: 5]
});

// Mount Fund, Recharge & Bankcard Routes[cite: 5]
// Support both /api/fund and /api routes to prevent path mismatches[cite: 5]
app.use('/api/fund', fundRoutes); 
app.use('/api', fundRoutes);
app.use('/api/bankcard', bankCardRoutes);
app.use('/api', adminRouter);
app.use('/api/devices', setDeviceRoutes(pool, authenticateToken));
app.use('/api', withdrawalController(pool, authenticateToken, io));
const teamCommissionRoutes = require('./teamCommission');
app.use('/api/team-commission', teamCommissionRoutes);
app.use('/api', teamRoutes);

const JWT_SECRET = process.env.JWT_SECRET || 'pepsi_vip_secret_key_12345';

// Helper for UTC Date String (UTC+0)[cite: 5]
const getUTCTimestamp = () => new Date().toISOString();

// Helper for Safe Currency Rounding (2 decimal places)[cite: 5]
const roundCurrency = (amount) => Math.round(parseFloat(amount) * 100) / 100;

// Helper to generate combined transaction ID (YYYYMMDDHHmmss + id)[cite: 5]
const generateTransactionId = (createdAt, id) => {
  const d = new Date(createdAt);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}${String(id).padStart(3, '0')}`;
};

// Socket.IO Connection & Room Setup with JWT Authentication[cite: 5]
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Admin clients emit 'join_admin' upon loading admin.html with token[cite: 5]
  socket.on('join_admin', (data) => {
    try {
      const token = typeof data === 'string' ? data : data?.token;
      if (!token) return;

      const decoded = jwt.decode(token, JWT_SECRET);
      if (decoded) {
        socket.join('admin_room');
        console.log(`[Socket.IO] Authenticated client ${socket.id} joined admin_room`);
      }
    } catch (err) {
      console.log(`[Socket.IO] Unauthorized join_admin attempt from ${socket.id}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// ================= AUTO-MIGRATE DATABASE SCHEMA =================
(async () => {
  try {
    // 1. Ensure transactions table has category column with full ENUM set[cite: 5]
    const [categoryCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'category'");
    if (categoryCols.length === 0) {
      await pool.query(`
        ALTER TABLE transactions 
        ADD COLUMN category ENUM('deposit', 'withdrawal', 'admin_credit', 'device_income', 'referral_rebate', 'referral_bonus', 'commission', 'vip_purchase', 'fund_investment') NOT NULL DEFAULT 'deposit'
      `);
      console.log('Successfully updated transactions table schema with "category" column.');
    } else {
      // Modify ENUM if missing new categories[cite: 5]
      await pool.query(`
        ALTER TABLE transactions 
        MODIFY COLUMN category ENUM('deposit', 'withdrawal', 'admin_credit', 'device_income', 'referral_rebate', 'referral_bonus', 'commission', 'vip_purchase', 'fund_investment') NOT NULL DEFAULT 'deposit'
      `);
    }

    // 1b. Ensure transactions table has type, channel, transaction_id, method, account_details columns[cite: 5]
    await pool.query('ALTER TABLE transactions MODIFY COLUMN type VARCHAR(50);');

    const [channelCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'channel'");
    if (channelCols.length === 0) {
      await pool.query("ALTER TABLE transactions ADD COLUMN channel VARCHAR(100) DEFAULT NULL");
      console.log('Successfully added "channel" column to transactions table.');
    }

    const [txIdCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'transaction_id'");
    if (txIdCols.length === 0) {
      await pool.query("ALTER TABLE transactions ADD COLUMN transaction_id VARCHAR(255) DEFAULT NULL");
      console.log('Successfully added "transaction_id" column (allows NULL).');
    } else {
      // Always ensure existing column allows NULL for withdrawals[cite: 5]
      await pool.query("ALTER TABLE transactions MODIFY COLUMN transaction_id VARCHAR(255) DEFAULT NULL");
      console.log('Successfully updated "transaction_id" column to allow NULL.');
    }

    const [methodCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'method'");
    if (methodCols.length === 0) {
      await pool.query("ALTER TABLE transactions ADD COLUMN method VARCHAR(100) DEFAULT NULL");
      console.log('Successfully added "method" column to transactions table.');
    }

    const [accountDetailCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'account_details'");
    if (accountDetailCols.length === 0) {
      await pool.query("ALTER TABLE transactions ADD COLUMN account_details TEXT DEFAULT NULL");
      console.log('Successfully added "account_details" column to transactions table.');
    }

    // 1c. Ensure transactions table has proof_image column for USDT screenshot uploads[cite: 5]
    const [proofCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'proof_image'");
    if (proofCols.length === 0) {
      await pool.query("ALTER TABLE transactions ADD COLUMN proof_image VARCHAR(255) DEFAULT NULL");
      console.log('Successfully added "proof_image" column to transactions table.');
    }

    // 2. Ensure users table has fund_password column[cite: 5]
    const [fundPwCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'fund_password'");
    if (fundPwCols.length === 0) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN fund_password VARCHAR(255) DEFAULT NULL
      `);
      console.log('Successfully updated users table schema with "fund_password" column.');
    }

    // 3. Ensure users table has referred_by column for referral hierarchy[cite: 5]
    const [referredByCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'referred_by'");
    if (referredByCols.length === 0) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN referred_by INT DEFAULT NULL,
        ADD CONSTRAINT fk_referred_by FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('Successfully updated users table schema with "referred_by" column.');
    }

    // 4. Ensure users table has status column for soft deletion[cite: 5]
    const [statusCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'status'");
    if (statusCols.length === 0) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
      `);
      console.log('Successfully updated users table schema with "status" column.');
    }

    // 5. Ensure users table has LV0 tracking columns[cite: 5]
    const [vipCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'vip_level'");
    if (vipCols.length === 0) {
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN vip_level INT DEFAULT 0,
        ADD COLUMN lv0_credits_count INT DEFAULT 0,
        ADD COLUMN lv0_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('Successfully added LV0 columns to users table schema.');
    }

    // 6. Ensure notices table exists and has all required columns[cite: 5]
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) DEFAULT 'System Announcement',
        message TEXT NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const [titleCols] = await pool.query("SHOW COLUMNS FROM notices LIKE 'title'");
    if (titleCols.length === 0) {
      await pool.query("ALTER TABLE notices ADD COLUMN title VARCHAR(255) DEFAULT 'System Announcement' AFTER id");
      console.log('Successfully updated notices table schema with "title" column.');
    } else {
      console.log('Successfully initialized notices table schema.');
    }

    // 7. Ensure bank_cards table exists with proper 3-field structure[cite: 5]
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        channel VARCHAR(100) NOT NULL,
        official_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Successfully initialized bank_cards table schema.');

    // 8. Ensure user_funds table exists for investment plans[cite: 5]
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_funds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        days INT NOT NULL,
        profit_percent DECIMAL(5,2) NOT NULL,
        expected_profit DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Successfully initialized user_funds table schema.');

  } catch (err) {
    console.error('Database Schema Migration Error:', err.message);
  }
})();

// ================= AUTOMATED CRON JOBS =================

// 1. Runs every hour ('0 * * * *') to add +0.25 to newly registered LV0 users for 24 hours only[cite: 5]
cron.schedule('0 * * * *', async () => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [eligibleUsers] = await connection.query(
      `SELECT id FROM users WHERE vip_level = 0 AND lv0_credits_count < 24 AND status = 'active' FOR UPDATE`
    );

    if (eligibleUsers.length > 0) {
      await connection.query(`
        UPDATE users 
        SET balance = ROUND(balance + 0.25, 2), 
            lv0_credits_count = lv0_credits_count + 1 
        WHERE vip_level = 0 AND lv0_credits_count < 24 AND status = 'active'
      `);

      for (const user of eligibleUsers) {
        await connection.query(
          `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'device_income', 0.25, 'approved')`,
          [user.id]
        );
      }

      console.log(`[CRON] Credited GHS 0.25 hourly bonus to ${eligibleUsers.length} LV0 users.`);
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    console.error('[CRON ERROR] Failed to process LV0 hourly income:', err.message);
  } finally {
    connection.release();
  }
});

// 2. Option A: Runs every hour at minute 0 to auto-credit purchased active device yields[cite: 5]
cron.schedule('0 * * * *', async () => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Select all active devices owned by active users[cite: 5]
    const [activeDevices] = await connection.query(`
      SELECT 
        ud.id AS user_device_id,
        ud.user_id,
        d.name AS device_name,
        d.hourly_yield
      FROM user_devices ud
      JOIN devices d ON ud.device_id = d.id
      JOIN users u ON ud.user_id = u.id
      WHERE ud.status = 'ACTIVE' AND u.status = 'active'
      FOR UPDATE
    `);

    if (activeDevices.length > 0) {
      for (const dev of activeDevices) {
        const yieldAmount = parseFloat(dev.hourly_yield);

        if (yieldAmount > 0) {
          // Add earnings to user account balance[cite: 5]
          await connection.query(
            `UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?`,
            [yieldAmount, dev.user_id]
          );

          // Log income into transaction history[cite: 5]
          await connection.query(
            `INSERT INTO transactions (user_id, type, category, amount, status) 
             VALUES (?, 'deposit', 'device_income', ?, 'approved')`,
            [dev.user_id, yieldAmount]
          );

          // Update last yield time tracking[cite: 5]
          await connection.query(
            `UPDATE user_devices SET last_yield_at = NOW() WHERE id = ?`,
            [dev.user_device_id]
          );
        }
      }

      console.log(`[CRON] Successfully credited hourly yield for ${activeDevices.length} active devices.`);
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    console.error('[CRON ERROR] Hourly device yield process failed:', err.message);
  } finally {
    connection.release();
  }
});

// ================= WEALTH FUND API ROUTES =================

// 1. Get Fund Summary (Active Invested & Today's Earnings)[cite: 5]
app.get('/api/fund/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await pool.query(
      "SELECT SUM(amount) as activeInvested FROM user_funds WHERE user_id = ? AND status = 'Active'",
      [userId]
    );

    res.json({
      success: true,
      summary: {
        activeInvested: rows[0].activeInvested || 0,
        todaysEarnings: 0 
      }
    });
  } catch (err) {
    console.error('Fund Summary Error:', err);
    res.status(500).json({ success: false, message: 'Server error loading fund summary.' });
  }
});

// 2. Submit New Investment Plan (Fixed to handle both camelCase and snake_case payload parameters)[cite: 5]
app.post('/api/fund/invest', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const depositAmount = req.body.depositAmount || req.body.amount;
    const days = req.body.days;
    const profitPercent = req.body.profitPercent || req.body.profit_percent;
    const expectedProfit = req.body.expectedProfit || req.body.expected_profit;

    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid deposit amount.' });
    }

    await pool.query(
      `INSERT INTO user_funds (user_id, amount, days, profit_percent, expected_profit, status) 
       VALUES (?, ?, ?, ?, ?, 'Active')`,
      [userId, depositAmount, days || 0, profitPercent || 0, expectedProfit || 0]
    );

    res.json({
      success: true,
      message: 'Investment plan purchased successfully!'
    });
  } catch (err) {
    console.error('Fund Investment Error Details:', err.message);
    res.status(500).json({ success: false, message: 'Server error processing investment: ' + err.message });
  }
});

// 3. Get Purchased Plan Records[cite: 5]
app.get('/api/fund/records', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [records] = await pool.query(
      "SELECT amount, days, profit_percent AS profitPercent, expected_profit AS expectedProfit, status, created_at FROM user_funds WHERE user_id = ? ORDER BY id DESC",
      [userId]
    );

    res.json({
      success: true,
      records: records.map(r => ({
        amount: r.amount,
        days: r.days,
        expectedProfit: r.expectedProfit,
        status: r.status
      }))
    });
  } catch (err) {
    console.error('Fund Records Error:', err);
    res.status(500).json({ success: false, message: 'Server error loading records.' });
  }
});

// ================= SYSTEM NOTICE ROUTES =================

const saveNoticeHandler = async (req, res) => {
  const message = req.body.message || req.body.notice;
  const title = req.body.title;

  try {
    if (!message || String(message).trim() === '') {
      await pool.query('UPDATE notices SET is_active = 0');
      return res.json({ success: true, message: 'Broadcast notice cleared successfully.' });
    }

    const noticeTitle = title && String(title).trim() ? String(title).trim() : 'System Announcement';

    await pool.query('UPDATE notices SET is_active = 0');
    await pool.query(
      'INSERT INTO notices (title, message, is_active) VALUES (?, ?, 1)',
      [noticeTitle, String(message).trim()]
    );

    res.json({ success: true, message: 'Notice broadcasted successfully to all users!' });
  } catch (err) {
    console.error('Error saving notice:', err);
    res.status(500).json({ success: false, message: 'Server error saving notice.' });
  }
};

app.post('/api/admin/notice', authenticateToken, saveNoticeHandler);
app.post('/api/notice', saveNoticeHandler);

app.get('/api/admin/notice', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, message, is_active, created_at FROM notices WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );

    if (rows.length === 0) {
      return res.json({ success: true, notice: null });
    }

    res.json({ success: true, notice: rows[0] });
  } catch (err) {
    console.error('Error fetching admin notice:', err);
    res.status(500).json({ success: false, message: 'Server error fetching notice.' });
  }
});

app.get('/api/notice', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, message, created_at FROM notices WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );

    if (rows.length === 0) {
      return res.json({ success: true, notice: null });
    }

    res.json({
      success: true,
      notice: {
        id: rows[0].id,
        title: rows[0].title || 'System Announcement',
        message: rows[0].message,
        createdAt: rows[0].created_at
      }
    });
  } catch (err) {
    console.error('Error fetching notice for users:', err);
    res.status(500).json({ success: false, message: 'Server error fetching notice.' });
  }
});

// ================= USER ROUTES =================

app.post('/api/auth/register', async (req, res) => {
  const { phone, password, referredBy } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Grab a username or generate one from the phone number
const username = req.body.username || `user_${phone.slice(-4)}`;

const [result] = await pool.query(
  'INSERT INTO users (username, phone, password, status) VALUES (?, ?, ?, ?)',
  [username, phone, hashedPassword, 'active']
);

    const token = jwt.encode({ id: result.insertId, phone }, JWT_SECRET);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: { id: result.insertId, phone, balance: 0.00 }
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required' });
  }

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid phone or password' });
    }

    const user = users[0];

    if (user.status === 'deleted') {
      return res.status(403).json({ success: false, message: 'User does not exist.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid phone or password' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: { id: user.id, phone: user.phone, balance: user.balance }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

app.post('/api/auth/set-fund-password', authenticateToken, async (req, res) => {
  const { accountPassword, fundPassword, confirmFundPassword } = req.body;

  if (!accountPassword || !fundPassword || !confirmFundPassword) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (fundPassword !== confirmFundPassword) {
    return res.status(400).json({ success: false, message: 'Fund passwords do not match.' });
  }

  const pinRegex = /^\d{4,6}$/;
  if (!pinRegex.test(fundPassword)) {
    return res.status(400).json({ success: false, message: 'Fund password must be 4 to 6 numeric digits.' });
  }

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(accountPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect account login password.' });
    }

    await pool.query('UPDATE users SET fund_password = ? WHERE id = ?', [fundPassword, req.user.id]);

    res.json({ success: true, message: 'Fund password updated successfully!' });
  } catch (err) {
    console.error('Fund Password Update Error:', err);
    res.status(500).json({ success: false, message: 'Server error updating fund password.' });
  }
});

// ================= CHANGE PASSWORD ROUTE =================
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { oldPassword, newPassword, confirmNewPassword } = req.body;
  const userId = req.user.id;

  if (!oldPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ success: false, message: 'New passwords do not match.' });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
  }

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect old password.' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);

    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error('Change Password Error:', err);
    res.status(500).json({ success: false, message: 'Server error updating password.' });
  }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, phone, balance, vip_level, avatar, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = users[0];

    res.json({
      success: true,
      phone: user.phone,
      balance: user.balance,
      vipLevel: user.vip_level || 0,
      avatar: user.avatar || 'meAvatar.jpg'
    });
  } catch (err) {
    console.error('Profile Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching profile' });
  }
});

// Avatar update endpoint[cite: 5]
app.post('/api/user/update-avatar', authenticateToken, async (req, res) => {
  const { avatar } = req.body;
  const userId = req.user.id;

  if (!avatar) {
    return res.status(400).json({ success: false, message: 'Avatar path/name is required.' });
  }

  try {
    await pool.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, userId]);
    res.json({ success: true, message: 'Avatar updated successfully!', avatar });
  } catch (err) {
    console.error('Update Avatar Error:', err);
    res.status(500).json({ success: false, message: 'Server error updating avatar.' });
  }
});

// GET USER ACCOUNT METRICS SUMMARY FOR DASHBOARD[cite: 5]
app.get('/api/user/account-summary', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const [users] = await pool.query('SELECT balance FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const balance = parseFloat(users[0].balance || 0);

    const [summaryRows] = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN category = 'device_income' AND status = 'approved' AND DATE(created_at) = CURRENT_DATE() THEN amount ELSE 0 END), 0) AS todayEarnings,
        COALESCE(SUM(CASE WHEN category = 'device_income' AND status = 'approved' AND DATE(created_at) = CURRENT_DATE() - INTERVAL 1 DAY THEN amount ELSE 0 END), 0) AS yesterdayEarnings,
        COALESCE(SUM(CASE WHEN category = 'device_income' AND status = 'approved' AND YEARWEEK(created_at, 1) = YEARWEEK(CURRENT_DATE(), 1) THEN amount ELSE 0 END), 0) AS thisWeekEarnings,
        COALESCE(SUM(CASE WHEN category = 'device_income' AND status = 'approved' AND YEAR(created_at) = YEAR(CURRENT_DATE()) AND MONTH(created_at) = MONTH(CURRENT_DATE()) THEN amount ELSE 0 END), 0) AS thisMonthEarnings,
        COALESCE(SUM(CASE WHEN category = 'device_income' AND status = 'approved' THEN amount ELSE 0 END), 0) AS investmentBenefits,
        COALESCE(SUM(CASE WHEN category IN ('referral_rebate', 'referral_bonus', 'commission') AND status = 'approved' THEN amount ELSE 0 END), 0) AS teamBenefits,
        COALESCE(SUM(CASE WHEN category = 'referral_rebate' AND status = 'approved' THEN amount ELSE 0 END), 0) AS referralRebate
       FROM transactions 
       WHERE user_id = ?`,
      [userId]
    );

    const s = summaryRows[0] || {};

    res.json({
      success: true,
      data: {
        balance: balance,
        yesterdayEarnings: parseFloat(s.yesterdayEarnings || 0),
        investmentBenefits: parseFloat(s.investmentBenefits || 0),
        todayEarnings: parseFloat(s.todayEarnings || 0),
        teamBenefits: parseFloat(s.teamBenefits || 0),
        thisWeekEarnings: parseFloat(s.thisWeekEarnings || 0),
        referralRebate: parseFloat(s.referralRebate || 0),
        thisMonthEarnings: parseFloat(s.thisMonthEarnings || 0)
      }
    });
  } catch (err) {
    console.error('Account Summary Fetch Error:', err);
    res.status(500).json({ success: false, message: 'Server error computing account summary.' });
  }
});

app.get('/api/wallet/details', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [users] = await pool.query('SELECT balance, fund_password FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const user = users[0];

    const [recharges] = await pool.query(
      `SELECT 
        id, 
        amount, 
        channel, 
        transaction_id AS transactionId, 
        proof_image AS proofImage,
        status, 
        created_at AS timestamp 
       FROM transactions 
       WHERE user_id = ? AND category = 'deposit' 
       ORDER BY created_at DESC`,
      [userId]
    );

    const [withdrawals] = await pool.query(
      `SELECT 
        id, 
        amount, 
        method, 
        account_details AS accountDetails, 
        status, 
        created_at AS timestamp 
       FROM transactions 
       WHERE user_id = ? AND category = 'withdrawal' 
       ORDER BY created_at DESC`,
      [userId]
    );

    // Format records with combined transaction ID (YYYYMMDDHHmmss + id) and time format[cite: 5]
    const formattedRecharges = recharges.map(tx => {
      const dt = new Date(tx.timestamp);
      const dateStr = dt.toISOString().split('T')[0];
      const timeStr = dt.toTimeString().split(' ')[0];
      return {
        ...tx,
        transactionId: generateTransactionId(tx.timestamp, tx.id),
        date: dateStr,
        time: timeStr
      };
    });

    const formattedWithdrawals = withdrawals.map(tx => {
      const dt = new Date(tx.timestamp);
      const dateStr = dt.toISOString().split('T')[0];
      const timeStr = dt.toTimeString().split(' ')[0];
      return {
        ...tx,
        transactionId: generateTransactionId(tx.timestamp, tx.id),
        date: dateStr,
        time: timeStr
      };
    });

    res.json({ 
      success: true, 
      balance: user.balance,
      hasFundPassword: !!user.fund_password,
      recharges: formattedRecharges,
      withdrawals: formattedWithdrawals
    });
  } catch (err) {
    console.error('Wallet Details Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching balance' });
  }
});

const getWithdrawalHistoryHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [withdrawals] = await pool.query(
      `SELECT 
        id, 
        amount, 
        method, 
        account_details AS accountDetails, 
        status, 
        created_at AS timestamp 
       FROM transactions 
       WHERE user_id = ? AND category = 'withdrawal' 
       ORDER BY created_at DESC`,
      [userId]
    );

    const formattedWithdrawals = withdrawals.map(tx => {
      const dt = new Date(tx.timestamp);
      const dateStr = dt.toISOString().split('T')[0];
      const timeStr = dt.toTimeString().split(' ')[0];
      return {
        ...tx,
        transactionId: generateTransactionId(tx.timestamp, tx.id),
        date: dateStr,
        time: timeStr
      };
    });

    res.json({ 
      success: true, 
      withdrawals: formattedWithdrawals,
      records: formattedWithdrawals,
      data: formattedWithdrawals
    });
  } catch (err) {
    console.error('Withdrawal History Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching withdrawal history' });
  }
};

app.get('/api/withdraw/history', authenticateToken, getWithdrawalHistoryHandler);
app.get('/api/wallet/withdrawals', authenticateToken, getWithdrawalHistoryHandler);

// ================= ACCOUNTING RECORDS ROUTE =================

app.get('/api/accounting', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
      `SELECT 
        id,
        type,
        category,
        amount,
        status,
        created_at
       FROM transactions 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );

    const records = rows.map(tx => {
      const isDebit = tx.type === 'withdrawal' || tx.category === 'vip_purchase' || tx.category === 'fund_investment';
      const formattedAmount = `${isDebit ? '-' : '+'}${parseFloat(tx.amount).toFixed(2)}`;

      let title = 'Transaction';
      switch (tx.category) {
        case 'deposit':
          title = 'Account Recharge';
          break;
        case 'withdrawal':
          title = 'Withdrawal Request';
          break;
        case 'vip_purchase':
          title = 'Device Purchase';
          break;
        case 'fund_investment':
          title = 'Wealth Fund Investment';
          break;
        case 'admin_credit':
          title = 'Rewards';
          break;
        case 'device_income':
          title = 'Device hourly Income';
          break;
        case 'referral_rebate':
          title = 'Referral Rebate';
          break;
        case 'referral_bonus':
          title = 'Referral Bonus';
          break;
        case 'commission':
          title = 'Team Commission';
          break;
      }

      const dt = new Date(tx.created_at);
      const dateStr = dt.toISOString().split('T')[0];
      const timeStr = dt.toTimeString().split(' ')[0];
      const combinedTxId = generateTransactionId(tx.created_at, tx.id);

      return {
        id: combinedTxId,
        transactionId: combinedTxId,
        title: title,
        amount: formattedAmount,
        isDebit: isDebit,
        date: dateStr,
        time: timeStr,
        status: tx.status.charAt(0).toUpperCase() + tx.status.slice(1)
      };
    });

    res.json({ success: true, records });
  } catch (err) {
    console.error('Accounting Fetch Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching accounting records' });
  }
});

// ================= VIP DEVICE & WEALTH FUND ROUTES =================

app.get('/api/devices/list', authenticateToken, async (req, res) => {
  try {
    const [devices] = await pool.query(
      `SELECT id, name, price, hourly_yield FROM devices ORDER BY id ASC`
    );
    return res.json({ success: true, data: devices });
  } catch (error) {
    console.error('Error fetching device list:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch devices.' });
  }
});

app.get('/api/devices/my-devices', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const [ownedDevices] = await pool.query(
      `SELECT ud.id AS user_device_id, ud.device_id, ud.created_at, d.name, d.price, d.hourly_yield 
       FROM user_devices ud
       JOIN devices d ON ud.device_id = d.id
       WHERE ud.user_id = ? AND ud.status = 'ACTIVE'`,
      [userId]
    );

    return res.json({ success: true, data: ownedDevices });
  } catch (error) {
    console.error('Error fetching user devices:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve active devices.' });
  }
});

app.post('/api/devices/buy', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ success: false, message: 'Device ID is required.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[user]] = await connection.query(
      `SELECT id, balance, vip_level FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );

    if (!user) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const [[device]] = await connection.query(
      `SELECT id, name, price, hourly_yield FROM devices WHERE id = ?`,
      [device_id]
    );

    if (!device) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    const [[existingDevice]] = await connection.query(
      `SELECT id FROM user_devices WHERE user_id = ? AND device_id = ? AND status = 'ACTIVE'`,
      [userId, device_id]
    );

    if (existingDevice) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'You have already purchased this device. You can buy other available devices.' 
      });
    }

    const devicePrice = parseFloat(device.price);
    const userBalance = parseFloat(user.balance);

    if (userBalance < devicePrice) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient balance to purchase this device.' });
    }

    await connection.query(
      `UPDATE users 
       SET balance = ROUND(balance - ?, 2), 
           vip_level = GREATEST(vip_level, ?) 
       WHERE id = ?`,
      [devicePrice, device_id, userId]
    );

    await connection.query(
      `INSERT INTO user_devices (user_id, device_id, status, created_at, last_yield_at) 
       VALUES (?, ?, 'ACTIVE', NOW(), NOW())`,
      [userId, device_id]
    );

    await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, status) 
       VALUES (?, 'withdrawal', 'vip_purchase', ?, 'approved')`,
      [userId, devicePrice]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Successfully purchased ${device.name}!`,
      data: {
        purchasedDeviceId: device.id,
        newBalance: (userBalance - devicePrice).toFixed(2),
        newVipLevel: Math.max(user.vip_level || 0, device_id)
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error purchasing device:', error);
    return res.status(500).json({ success: false, message: 'Server error processing device purchase.' });
  } finally {
    connection.release();
  }
});

app.post('/api/vip/join', authenticateToken, async (req, res) => {
  const { vipLevel, amount } = req.body;
  const userId = req.user.id;

  const numericAmount = parseFloat(amount);
  const parsedVipLevel = parseInt(vipLevel, 10) || 1;

  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid purchase amount' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const currentBalance = parseFloat(users[0].balance);

    if (currentBalance < numericAmount) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        insufficientBalance: true,
        message: 'Insufficient balance to purchase device.'
      });
    }

    const newBalance = roundCurrency(currentBalance - numericAmount);

    await connection.query('UPDATE users SET balance = ?, vip_level = ? WHERE id = ?', [newBalance, parsedVipLevel, userId]);

    await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'withdrawal', 'vip_purchase', ?, 'approved')`,
      [userId, numericAmount]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `Successfully subscribed to VIP Level ${parsedVipLevel}!`,
      newBalance: newBalance.toFixed(2)
    });
  } catch (err) {
    await connection.rollback();
    console.error('VIP Join Error:', err);
    res.status(500).json({ success: false, message: 'Server error processing VIP purchase' });
  } finally {
    connection.release();
  }
});

// ================= RECHARGE & WITHDRAWAL SUBMISSIONS =================

app.post('/api/recharge/submit', authenticateToken, async (req, res) => {
  const { amount, channel, transactionId, reference } = req.body;
  const userId = req.user.id;

  const numericAmount = parseFloat(amount);
  const MIN_DEPOSIT = 100.00; // Minimum deposit limit GHS 100[cite: 5]

  if (isNaN(numericAmount) || numericAmount < MIN_DEPOSIT) {
    return res.status(400).json({ success: false, message: `Minimum deposit amount is GHS ${MIN_DEPOSIT.toFixed(2)}` });
  }

  if (!channel) {
    return res.status(400).json({ success: false, message: 'Recharge channel is required.' });
  }

  const finalTxId = transactionId || reference || 'N/A';

  try {
    const [result] = await pool.query(
      `INSERT INTO transactions (user_id, type, category, amount, channel, transaction_id, status) 
       VALUES (?, 'deposit', 'deposit', ?, ?, ?, 'pending')`,
      [userId, numericAmount, channel, finalTxId]
    );

    const [insertedRows] = await pool.query(
      `SELECT t.id, t.user_id, u.phone, t.amount, t.channel, t.transaction_id, t.status, t.created_at 
       FROM transactions t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.id = ?`,
      [result.insertId]
    );

    const liveData = insertedRows[0];

    io.to('admin_room').emit('new_recharge_received', {
      ...liveData,
      utcTime: getUTCTimestamp()
    });

    res.json({
      success: true,
      message: 'Recharge request submitted successfully!',
      transaction: liveData
    });
  } catch (err) {
    console.error('Recharge Submit Error:', err);
    res.status(500).json({ success: false, message: 'Server error submitting recharge.' });
  }
});

app.post('/api/recharge/submit-with-proof', authenticateToken, upload.single('proofImage'), async (req, res) => {
  try {
    const { amount, channel, transactionId } = req.body;
    const userId = req.user.id;
    const proofUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const numericAmount = parseFloat(amount);
    const MIN_DEPOSIT = 100.00; // Minimum deposit limit GHS 100[cite: 5]

    if (isNaN(numericAmount) || numericAmount < MIN_DEPOSIT) {
      return res.status(400).json({ success: false, message: `Minimum deposit amount is GHS ${MIN_DEPOSIT.toFixed(2)}` });
    }

    const finalTxId = transactionId || 'USDT_' + Date.now();
    const finalChannel = channel || 'USDT Pay';

    const [result] = await pool.query(
      `INSERT INTO transactions (user_id, type, category, amount, channel, transaction_id, proof_image, status) 
       VALUES (?, 'deposit', 'deposit', ?, ?, ?, ?, 'pending')`,
      [userId, numericAmount, finalChannel, finalTxId, proofUrl]
    );

    const [insertedRows] = await pool.query(
      `SELECT t.id, t.user_id, u.phone, t.amount, t.channel, t.transaction_id, t.proof_image, t.status, t.created_at 
       FROM transactions t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.id = ?`,
      [result.insertId]
    );

    const liveData = insertedRows[0];

    io.to('admin_room').emit('new_recharge_received', {
      ...liveData,
      utcTime: getUTCTimestamp()
    });

    return res.status(200).json({
      success: true,
      message: 'Deposit request submitted successfully with payment proof.',
      transaction: liveData
    });

  } catch (err) {
    console.error('Error processing deposit with proof:', err);
    return res.status(500).json({ success: false, message: 'Internal server error occurred.' });
  }
});

const handleWithdrawalSubmit = async (req, res) => {
  const { amount, fundPassword, method, accountDetails } = req.body;
  const userId = req.user.id;

  const numericAmount = parseFloat(amount);
  const MIN_WITHDRAWAL = 20.00; // Minimum withdrawal limit GHS 20[cite: 5]

  if (isNaN(numericAmount) || numericAmount < MIN_WITHDRAWAL) {
    return res.status(400).json({ success: false, message: `Minimum withdrawal amount is GHS ${MIN_WITHDRAWAL.toFixed(2)}` });
  }

  if (!fundPassword) {
    return res.status(400).json({ success: false, message: 'Fund password is required.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 🛑 STRICT BLOCK: Check if user already has a pending withdrawal
const [pendingCheck] = await connection.query(
  "SELECT id FROM transactions WHERE user_id = ? AND category = 'withdrawal' AND status = 'Bank processing' FOR UPDATE",
  [userId]
);

if (pendingCheck.length > 0) {
  await connection.rollback();
  return res.status(400).json({
    success: false,
    message: `You already have a pending withdrawal request (#${pendingCheck[0].id}). Please wait for it to be processed before submitting a new one.`
  });
}
    const [users] = await connection.query(
      'SELECT balance, fund_password FROM users WHERE id = ? FOR UPDATE', 
      [userId]
    );

    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = users[0];

    if (!user.fund_password) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Please set up a fund password first in your account settings.' });
    }

    if (String(user.fund_password).trim() !== String(fundPassword).trim()) {
      await connection.rollback();
      return res.status(401).json({ success: false, message: 'Incorrect fund password.' });
    }

    const currentBalance = parseFloat(user.balance);
    if (currentBalance < numericAmount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient account balance.' });
    }

    // Calculate 5% fee and net payout amount upfront[cite: 5]
    const feeAmount = Math.round((numericAmount * 0.05) * 100) / 100;
    const netAmount = Math.round((numericAmount - feeAmount) * 100) / 100;

    const finalAccountDetails = typeof accountDetails === 'object' ? JSON.stringify(accountDetails) : (accountDetails || 'Mobile/Bank Wallet');
    const finalMethod = method || 'Mobile Money';

    // Deduct the full requested amount from user balance[cite: 5]
    const newBalance = roundCurrency(currentBalance - numericAmount);
    await connection.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

    // Insert transaction using the net amount so records reflect the actual payout[cite: 5]
    const [result] = await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, method, account_details, status) 
       VALUES (?, 'withdrawal', 'withdrawal', ?, ?, ?, 'pending')`,
      [userId, netAmount, finalMethod, finalAccountDetails]
    );

    await connection.commit();

    const [insertedRows] = await pool.query(
      `SELECT t.id, t.user_id, u.phone, t.amount, t.method, t.account_details, t.status, t.created_at 
       FROM transactions t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.id = ?`,
      [result.insertId]
    );

    const liveData = insertedRows[0] || {};

    let parsedDetails = liveData.account_details;
    try {
      if (typeof liveData.account_details === 'string' && liveData.account_details.startsWith('{')) {
        parsedDetails = JSON.parse(liveData.account_details);
      }
    } catch (e) {
      parsedDetails = liveData.account_details;
    }

    io.to('admin_room').emit('new_withdrawal_received', {
      ...liveData,
      requestedAmount: numericAmount.toFixed(2),
      feeAmount: feeAmount.toFixed(2),
      netAmount: netAmount.toFixed(2),
      bound_details: parsedDetails,
      utcTime: getUTCTimestamp()
    });

    return res.json({
      success: true,
      message: `Withdrawal request submitted successfully! Net payout: GHS ${netAmount.toFixed(2)} (5% fee applied).`,
      newBalance: newBalance.toFixed(2),
      transaction: {
        ...liveData,
        requestedAmount: numericAmount.toFixed(2),
        feeAmount: feeAmount.toFixed(2),
        netAmount: netAmount.toFixed(2),
        bound_details: parsedDetails
      }
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Withdrawal Submit Error:', err);
    return res.status(500).json({ success: false, message: 'Server error processing withdrawal request: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
};

app.post('/api/withdraw/submit', authenticateToken, handleWithdrawalSubmit);
app.post('/api/wallet/withdraw', authenticateToken, handleWithdrawalSubmit);

// ================= ADMIN ROUTES =================

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    const [userRows] = await pool.query("SELECT COUNT(*) AS totalUsers FROM users");
    
    const [rechargeRows] = await pool.query(
      "SELECT SUM(amount) AS totalRecharges FROM transactions WHERE category = 'deposit' AND status = 'approved'"
    );

    const [withdrawalRows] = await pool.query(
      "SELECT SUM(amount) AS totalWithdrawals FROM transactions WHERE category = 'withdrawal' AND status = 'approved'"
    );

    res.json({
      success: true,
      stats: {
        totalUsers: userRows[0].totalUsers || 0,
        totalRecharges: rechargeRows[0].totalRecharges || 0,
        totalWithdrawals: withdrawalRows[0].totalWithdrawals || 0
      }
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
  }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
  const searchQuery = req.query.search ? `%${req.query.search.trim()}%` : null;

  try {
    let sql = `
      SELECT 
        u.id, 
        u.phone, 
        u.balance, 
        u.status, 
        u.vip_level,
        u.created_at,
        COALESCE(dep.total_deposited, 0) AS total_deposited,
        COALESCE(dep.deposit_count, 0) AS deposit_count,
        COALESCE(wd.total_withdrawn, 0) AS total_withdrawn,
        COALESCE(wd.withdrawal_count, 0) AS withdrawal_count,
        COALESCE(ref.total_referrals, 0) AS total_referrals,
        COALESCE(ref.deposited_referrals, 0) AS deposited_referrals,
        COALESCE(ref.non_deposited_referrals, 0) AS non_deposited_referrals
      FROM users u
      LEFT JOIN (
        SELECT user_id, SUM(CAST(amount AS DECIMAL(10,2))) AS total_deposited, COUNT(id) AS deposit_count
        FROM transactions
        WHERE category = 'deposit' AND LOWER(status) IN ('processed', 'approved', 'success', 'completed', 'paid', '1')
        GROUP BY user_id
      ) dep ON dep.user_id = u.id
      LEFT JOIN (
        SELECT user_id, SUM(CAST(amount AS DECIMAL(10,2))) AS total_withdrawn, COUNT(id) AS withdrawal_count
        FROM transactions
        WHERE category = 'withdrawal' AND LOWER(status) IN ('paid', 'approved', 'success', 'completed', 'processed')
        GROUP BY user_id
      ) wd ON wd.user_id = u.id
      LEFT JOIN (
        SELECT 
          u_ref.referred_by,
          COUNT(u_ref.id) AS total_referrals,
          COUNT(CASE WHEN EXISTS (
            SELECT 1 FROM transactions t 
            WHERE t.user_id = u_ref.id AND t.category = 'deposit' AND LOWER(t.status) IN ('processed', 'approved', 'success', 'completed', 'paid', '1')
          ) THEN 1 END) AS deposited_referrals,
          COUNT(CASE WHEN NOT EXISTS (
            SELECT 1 FROM transactions t 
            WHERE t.user_id = u_ref.id AND t.category = 'deposit' AND LOWER(t.status) IN ('processed', 'approved', 'success', 'completed', 'paid', '1')
          ) THEN 1 END) AS non_deposited_referrals
        FROM users u_ref
        WHERE u_ref.referred_by IS NOT NULL
        GROUP BY u_ref.referred_by
      ) ref ON ref.referred_by = u.id
    `;

    const queryParams = [];

    if (searchQuery) {
      sql += ` WHERE u.phone LIKE ? OR CAST(u.id AS CHAR) LIKE ?`;
      queryParams.push(searchQuery, searchQuery);
    }

    sql += ` ORDER BY u.id DESC`;

    const [users] = await pool.query(sql, queryParams);

    res.json({ success: true, users });
  } catch (err) {
    console.error('Error fetching users with statistics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve users statistics.' });
  }
});

app.post('/api/admin/users/action', authenticateToken, async (req, res) => {
  const { userId, action } = req.body;

  if (!userId || !['delete', 'restore'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid payload parameters' });
  }

  const newStatus = action === 'delete' ? 'deleted' : 'active';

  try {
    const [result] = await pool.query("UPDATE users SET status = ? WHERE id = ?", [newStatus, userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: `User #${userId} successfully ${action === 'delete' ? 'deleted' : 'restored'}.`
    });
  } catch (err) {
    console.error('Error modifying user status:', err);
    res.status(500).json({ success: false, message: 'Database query failed' });
  }
});

app.post('/api/admin/users/reset-password', authenticateToken, async (req, res) => {
  const { userId, newPassword } = req.body;

  if (!userId || !newPassword) {
    return res.status(400).json({ success: false, message: 'User ID/Phone and new password are required.' });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const [result] = await pool.query(
      "UPDATE users SET password = ? WHERE id = ?",
      [hashedPassword, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      message: `Password successfully reset for user #${userId}.`
    });
  } catch (err) {
    console.error('Admin Password Reset Error:', err);
    res.status(500).json({ success: false, message: 'Server error resetting user password.' });
  }
});

// ================= ADMIN ROUTE: RESET BOUND WITHDRAWAL CARD =================
const handleBankCardReset = async (req, res) => {
  try {
    const userId = req.params.userId || req.body.userId;
    const { phone } = req.body;

    let targetUserId = userId;
    if (!targetUserId && phone) {
      const [users] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (users.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found with that phone number.' });
      }
      targetUserId = users[0].id;
    }

    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Provide a valid userId or phone number.' });
    }

    await pool.query(`DELETE FROM bank_cards WHERE user_id = ?`, [targetUserId]);

    res.json({ 
      success: true, 
      message: `Bound payment account for user #${targetUserId} has been reset successfully. The user can now bind new details.` 
    });
  } catch (err) {
    console.error('Admin Card Reset Error:', err);
    res.status(500).json({ success: false, message: 'Server error resetting withdrawal card: ' + err.message });
  }
};

app.post('/api/admin/bankcard/reset', authenticateToken, handleBankCardReset);
app.post('/api/admin/reset-card/:userId', authenticateToken, handleBankCardReset);

app.post('/api/admin/users/balance', authenticateToken, async (req, res) => {
  const { phone, type, amount } = req.body;
  const numericAmount = parseFloat(amount);

  if (!phone || !type || isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid form input' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [users] = await connection.query("SELECT id, balance FROM users WHERE phone = ? FOR UPDATE", [phone]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User with this phone number was not found' });
    }

    const userId = users[0].id;
    const category = type === 'add' ? 'admin_credit' : 'withdrawal';
    const txType = type === 'add' ? 'deposit' : 'withdrawal';

    const sqlQuery = type === 'add'
      ? "UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?"
      : "UPDATE users SET balance = GREATEST(0, ROUND(balance - ?, 2)) WHERE id = ?";

    await connection.query(sqlQuery, [numericAmount, userId]);

    await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, ?, ?, ?, 'approved')`,
      [userId, txType, category, numericAmount]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `Successfully ${type === 'add' ? 'credited' : 'deducted'} ${numericAmount.toFixed(2)} GHS for ${phone}.`
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error updating balance:', err);
    res.status(500).json({ success: false, message: 'Failed to update user balance' });
  } finally {
    connection.release();
  }
});

app.get('/api/admin/recharges', authenticateToken, async (req, res) => {
  try {
    const [recharges] = await pool.query(
      `SELECT 
        t.id, 
        t.user_id, 
        u.phone, 
        t.amount, 
        t.channel,
        t.transaction_id,
        t.proof_image,
        t.status, 
        t.created_at 
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       WHERE t.category = 'deposit'
       ORDER BY t.created_at DESC`
    );

    res.json({ success: true, recharges });
  } catch (err) {
    console.error('Admin Recharges Fetch Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching recharge requests' });
  }
});

app.post('/api/admin/recharges/action', authenticateToken, async (req, res) => {
  const { transactionId, action } = req.body;

  if (!transactionId || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid transaction ID or action' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [txs] = await connection.query('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [transactionId]);
    if (txs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const tx = txs[0];
    if (tx.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Transaction has already been processed' });
    }

    if (action === 'approve') {
      await connection.query('UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?', [tx.amount, tx.user_id]);
      await connection.query('UPDATE transactions SET status = "approved" WHERE id = ?', [transactionId]);
    } else if (action === 'reject') {
      await connection.query('UPDATE transactions SET status = "rejected" WHERE id = ?', [transactionId]);
    }

    await connection.commit();

    res.json({
      success: true,
      message: `Recharge request successfully ${action}d`
    });
  } catch (err) {
    await connection.rollback();
    console.error('Admin Recharge Action Error:', err);
    res.status(500).json({ success: false, message: 'Server error processing recharge action' });
  } finally {
    connection.release();
  }
});

app.get('/api/admin/withdrawals', authenticateToken, async (req, res) => {
  try {
    const [withdrawals] = await pool.query(
      `SELECT 
        t.id, 
        t.user_id, 
        u.phone, 
        t.amount, 
        t.method,
        t.account_details,
        t.status, 
        t.created_at,
        b.channel,
        b.official_name,
        b.account_number
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN bank_cards b ON t.user_id = b.user_id
       WHERE t.category = 'withdrawal'
       ORDER BY t.created_at DESC`
    );

    const formattedWithdrawals = withdrawals.map(w => {
      let parsedDetails = {};
      try {
        if (typeof w.account_details === 'string' && w.account_details.startsWith('{')) {
          parsedDetails = JSON.parse(w.account_details);
        } else if (typeof w.account_details === 'object' && w.account_details !== null) {
          parsedDetails = w.account_details;
        }
      } catch (e) {
        parsedDetails = {};
      }

      return {
        ...w,
        bound_details: {
          channel: w.channel || parsedDetails.channel || parsedDetails.bankName || w.method || 'Other',
          official_name: w.official_name || parsedDetails.official_name || parsedDetails.accountName || 'N/A',
          account_number: w.account_number || parsedDetails.account_number || parsedDetails.accountNumber || 'N/A'
        }
      };
    });

    res.json({ success: true, withdrawals: formattedWithdrawals });
  } catch (err) {
    console.error('Admin Withdrawals Fetch Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching withdrawal requests' });
  }
});

app.post('/api/admin/withdrawals/action', authenticateToken, async (req, res) => {
  const { transactionId, action } = req.body;

  if (!transactionId || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid transaction ID or action' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [txs] = await connection.query('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [transactionId]);
    if (txs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const tx = txs[0];
    if (tx.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Transaction has already been processed' });
    }

    if (action === 'approve') {
      await connection.query('UPDATE transactions SET status = "approved" WHERE id = ?', [transactionId]);
    } else if (action === 'reject') {
      await connection.query('UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?', [tx.amount, tx.user_id]);
      await connection.query('UPDATE transactions SET status = "rejected" WHERE id = ?', [transactionId]);
    }

    await connection.commit();

    res.json({
      success: true,
      message: `Withdrawal request successfully ${action}d`
    });
  } catch (err) {
    await connection.rollback();
    console.error('Admin Withdrawal Action Error:', err);
    res.status(500).json({ success: false, message: 'Server error processing withdrawal action' });
  } finally {
    connection.release();
  }
});

app.get('/api/admin/users/referrals', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id,
        u.phone,
        u.balance,
        COUNT(r.id) AS total_referrals,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM transactions t 
          WHERE t.user_id = r.id AND t.category = 'deposit' AND t.status = 'approved'
        ) THEN 1 END) AS deposited_referrals,
        COUNT(CASE WHEN NOT EXISTS (
          SELECT 1 FROM transactions t 
          WHERE t.user_id = r.id AND t.category = 'deposit' AND t.status = 'approved'
        ) AND r.id IS NOT NULL THEN 1 END) AS non_deposited_referrals
      FROM users u
      LEFT JOIN users r ON r.referred_by = u.id
      GROUP BY u.id, u.phone, u.balance
      ORDER BY total_referrals DESC;
    `;

    const [rows] = await pool.query(query);

    res.json({ success: true, users: rows });
  } catch (err) {
    console.error('Error fetching referral stats:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve referral statistics.' });
  }
});

// ================= REFERRAL TREE ENDPOINT =================

app.get('/api/admin/referrals/tree', authenticateToken, async (req, res) => {
  const rootUserId = req.query.userId;

  if (!rootUserId) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  try {
    const [level1] = await pool.query(
      `SELECT id, phone, balance, created_at FROM users WHERE referred_by = ?`,
      [rootUserId]
    );

    const level1Ids = level1.map(u => u.id);
    let level2 = [];
    let level3 = [];

    if (level1Ids.length > 0) {
      const [l2Rows] = await pool.query(
        `SELECT id, phone, balance, referred_by, created_at FROM users WHERE referred_by IN (?)`,
        [level1Ids]
      );
      level2 = l2Rows;
    }

    const level2Ids = level2.map(u => u.id);

    if (level2Ids.length > 0) {
      const [l3Rows] = await pool.query(
        `SELECT id, phone, balance, referred_by, created_at FROM users WHERE referred_by IN (?)`,
        [level2Ids]
      );
      level3 = l3Rows;
    }

    res.json({
      success: true,
      tree: {
        level1,
        level2,
        level3,
        totalTeamCount: level1.length + level2.length + level3.length
      }
    });
  } catch (err) {
    console.error('Error fetching referral tree:', err);
    res.status(500).json({ success: false, message: 'Failed to build referral tree.' });
  }
});

// ================= USER TEAM REPORT ROUTE (UPDATED) =================

app.get('/api/user/team-report', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const [level1] = await pool.query(
      `SELECT id, phone, balance, created_at FROM users WHERE referred_by = ?`,
      [userId]
    );

    const level1Ids = level1.map(u => u.id);
    let level2 = [];
    let level3 = [];

    if (level1Ids.length > 0) {
      const [l2Rows] = await pool.query(
        `SELECT id, phone, balance, referred_by, created_at FROM users WHERE referred_by IN (?)`,
        [level1Ids]
      );
      level2 = l2Rows;
    }

    const level2Ids = level2.map(u => u.id);

    if (level2Ids.length > 0) {
      const [l3Rows] = await pool.query(
        `SELECT id, phone, balance, referred_by, created_at FROM users WHERE referred_by IN (?)`,
        [level2Ids]
      );
      level3 = l3Rows;
    }

    // Include the main user's own ID along with Level 1, Level 2, and Level 3 downlines
    const allTeamIds = [userId, ...level1Ids, ...level2Ids, ...level3.map(u => u.id)];

    let totalTeamDeposit = 0;
    let totalTeamWithdrawal = 0;
    let totalTeamCommission = 0;

    if (allTeamIds.length > 0) {
      const [depositRows] = await pool.query(
        `SELECT SUM(amount) AS total FROM transactions WHERE user_id IN (?) AND category = 'deposit' AND status = 'approved'`,
        [allTeamIds]
      );
      totalTeamDeposit = parseFloat(depositRows[0]?.total || 0);

      const [withdrawalRows] = await pool.query(
        `SELECT SUM(amount) AS total FROM transactions WHERE user_id IN (?) AND category = 'withdrawal' AND status = 'approved'`,
        [allTeamIds]
      );
      totalTeamWithdrawal = parseFloat(withdrawalRows[0]?.total || 0);
    }

    const [commissionRows] = await pool.query(
      `SELECT SUM(amount) AS total FROM transactions WHERE user_id = ? AND category IN ('referral_rebate', 'referral_bonus', 'commission') AND status = 'approved'`,
      [userId]
    );
    totalTeamCommission = parseFloat(commissionRows[0]?.total || 0);

    // Team size automatically includes +1 for the main user account inside the total count
    const totalTeamCount = level1.length + level2.length + level3.length + 1;

    res.json({
      success: true,
      teamRecharge: roundCurrency(totalTeamDeposit),
      teamWithdraw: roundCurrency(totalTeamWithdrawal),
      teamSize: totalTeamCount,
      data: {
        teamRecharge: roundCurrency(totalTeamDeposit),
        teamWithdraw: roundCurrency(totalTeamWithdrawal),
        teamSize: totalTeamCount,
        teamSizeDetails: {
          level1Count: level1.length,
          level2Count: level2.length,
          level3Count: level3.length,
          totalCount: totalTeamCount
        },
        financials: {
          totalTeamDeposit: roundCurrency(totalTeamDeposit),
          totalTeamWithdrawal: roundCurrency(totalTeamWithdrawal),
          totalTeamCommission: roundCurrency(totalTeamCommission)
        },
        members: {
          level1,
          level2,
          level3
        }
      }
    });
  } catch (err) {
    console.error('Error fetching user team report:', err);
    res.status(500).json({ success: false, message: 'Server error generating team report.' });
  }
});

// 404 Fallback Handler[cite: 5]
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found on server.` });
});

// Global Error Handler[cite: 5]
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal server error occurred.' });
});

// START SERVER WITH SOCKET.IO SUPPORT[cite: 5]
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server and Socket.IO running on port ${PORT}`);
});
