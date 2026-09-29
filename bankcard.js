require('dotenv').config();
const express = require('express');
const router = express.Router();
const jwt = require('jwt-simple');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'pepsi_vip_secret_key_12345';

// Self-contained authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token missing' });
  }

  try {
    const decoded = jwt.decode(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token' });
  }
};

// GET /api/bankcard (Fetches bound card for the current user)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM bank_cards WHERE user_id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.json({ success: true, card: null });
    }
    res.json({ success: true, card: rows[0] });
  } catch (err) {
    console.error('Error fetching bank card:', err);
    res.status(500).json({ success: false, message: 'Server error fetching bank card.' });
  }
});

// POST /api/bankcard (Binds a new withdrawal account)
router.post('/', authenticateToken, async (req, res) => {
  const { channel, official_name, account_number } = req.body;
  const userId = req.user.id;

  if (!channel || !official_name || !account_number) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  try {
    await pool.query(
      `INSERT INTO bank_cards (user_id, channel, official_name, account_number)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         channel = VALUES(channel), 
         official_name = VALUES(official_name), 
         account_number = VALUES(account_number)`,
      [userId, channel, official_name, account_number]
    );

    res.json({ success: true, message: 'Account bound successfully!' });
  } catch (err) {
    console.error('Error binding bank card:', err);
    res.status(500).json({ success: false, message: 'Server error binding bank card.' });
  }
});

// POST /api/admin/bankcard/reset (Resets/unbinds a user's bank card from admin panel)
router.post('/admin/bankcard/reset', authenticateToken, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required.' });
  }

  try {
    await pool.query('DELETE FROM bank_cards WHERE user_id = ?', [userId]);

    res.json({
      success: true,
      message: `Bank card successfully reset for user #${userId}.`
    });
  } catch (err) {
    console.error('Error resetting bank card:', err);
    res.status(500).json({ success: false, message: 'Server error resetting bank card.' });
  }
});

module.exports = router;