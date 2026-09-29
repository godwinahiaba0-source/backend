const express = require('express');
const router = express.Router();
const jwt = require('jwt-simple');

const JWT_SECRET = process.env.JWT_SECRET || 'pepsi_vip_secret_key_12345';

// Strong Admin Credentials (best loaded via environment variables in your .env file)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'super_secure_admin_user';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'your_very_strong_password_here';

// Admin Token Verification Middleware
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, message: 'No token provided.' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.decode(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid token.' });
  }
};

// Admin Login Route
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }

    const token = jwt.encode({ role: 'admin', username: ADMIN_USERNAME }, JWT_SECRET);
    return res.status(200).json({ success: true, token });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error during admin login.' });
  }
});

// Protected Admin Test Route
router.get('/admin/dashboard-data', verifyAdminToken, (req, res) => {
  res.json({ success: true, message: 'Welcome to your secure admin panel!' });
});

module.exports = {
  adminRouter: router,
  verifyAdminToken
};