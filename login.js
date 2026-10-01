const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = function(pool) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const { phone, password } = req.body;

      if (!phone || !password) {
        return res.status(400).json({ success: false, message: 'Phone number and password are required.' });
      }

      // 1. Find user by phone number
      const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
      if (!users || users.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid credentials.' });
      }

      const user = users[0];

      // 2. Compare submitted password with hashed password in database
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Invalid credentials.' });
      }

      // 3. Generate JWT token
      const tokenPayload = { userId: user.id, phone: user.phone };
      const secretKey = process.env.JWT_SECRET || 'your_super_secret_key_here';
      const token = jwt.sign(tokenPayload, secretKey, { expiresIn: '7d' });

      return res.status(200).json({
        success: true,
        message: 'Login successful!',
        token: token,
        user: {
          id: user.id,
          phone: user.phone,
          inviteCode: user.inviteCode
        }
      });

    } catch (error) {
      console.error("Login Error:", error);
      return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
  });

  return router;
};