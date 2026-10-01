const express = require('express');
const bcrypt = require('bcryptjs'); // Make sure bcryptjs is installed
const jwt = require('jsonwebtoken');

module.exports = function(pool) {
  const router = express.Router();

  // Helper function to generate a unique 6-digit invite code
  async function generateUniqueInviteCode(dbPool) {
    let isUnique = false;
    let code = '';
    while (!isUnique) {
      code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
      const [existing] = await dbPool.query('SELECT id FROM users WHERE inviteCode = ?', [code]);
      if (existing.length === 0) {
        isUnique = true;
      }
    }
    return code;
  }

  router.post('/register', async (req, res) => {
    try {
      const { phone, password, inviteCode } = req.body;

      if (!phone || !password) {
        return res.status(400).json({ success: false, message: 'Phone number and password are required.' });
      }

      // 1. Check if user already exists
      const [existingUsers] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (existingUsers.length > 0) {
        return res.status(400).json({ success: false, message: 'Phone number is already registered.' });
      }

      // 2. Check total users to handle first-user bypass
      const [allUsersCount] = await pool.query('SELECT COUNT(*) as count FROM users');
      const userCount = allUsersCount[0].count;

      let referrerId = null;

      if (userCount > 0) {
        if (!inviteCode) {
          return res.status(400).json({ success: false, message: 'Invitation code is required.' });
        }

        // Find the referrer user using their invite code
        const [referrerRows] = await pool.query('SELECT id FROM users WHERE inviteCode = ?', [inviteCode]);
        if (!referrerRows || referrerRows.length === 0) {
          return res.status(400).json({ success: false, message: 'Invalid invitation code.' });
        }
        referrerId = referrerRows[0].id;
      }

      // 3. Generate a unique invite code for this new user
      const newUserInviteCode = await generateUniqueInviteCode(pool);

      // 4. Hash password securely
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // 5. Insert new user into database
      // (Assuming your users table has columns: phone, password, inviteCode, referredBy)
      const [result] = await pool.query(
        'INSERT INTO users (phone, password, inviteCode, referredBy, createdAt) VALUES (?, ?, ?, ?, NOW())',
        [phone, hashedPassword, newUserInviteCode, referrerId]
      );

      const newUserId = result.insertId;

      // Optional: If you maintain a separate referrals log table for detailed analytics
      if (referrerId) {
        await pool.query(
          'INSERT INTO referrals (referrerId, referredUserId, createdAt) VALUES (?, ?, NOW())',
          [referrerId, newUserId]
        ).catch(err => console.log('Referrals log table note:', err.message));
      }

      // 6. Generate JWT token so user is automatically logged in
      const tokenPayload = { userId: newUserId, phone: phone };
      const secretKey = process.env.JWT_SECRET || 'your_super_secret_key_here';
      const token = jwt.sign(tokenPayload, secretKey, { expiresIn: '7d' });

      return res.status(200).json({
        success: true,
        message: 'Registration successful!',
        token: token,
        user: {
          id: newUserId,
          phone: phone,
          inviteCode: newUserInviteCode
        }
      });

    } catch (error) {
      console.error("Registration Error:", error);
      return res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
  });

  return router;
};