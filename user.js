// routes/user.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db'); // Your MySQL pool connection

// Helper function to process the hourly +0.25 bonus for Level 0 users
async function processLevelZeroHourlyBonus(userId) {
  try {
    // 1. Fetch user creation time, last credited time, and vip level
    const [rows] = await db.query(
      'SELECT vip_level, balance, created_at, last_credited_at FROM users WHERE id = ?',
      [userId]
    );
    if (rows.length === 0) return;
    const user = rows.rows ? rows.rows[0] : rows[0];

    // Only apply if the user's active/base vip level is 0
    if (Number(user.vip_level) !== 0) return;

    const now = new Date();
    const createdAt = new Date(user.created_at);
    const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);

    // Stop automatically after 24 hours
    if (hoursSinceCreation > 24) return;

    // Determine the last credit time (fallback to created_at if null)
    const lastCredited = user.last_credited_at ? new Date(user.last_credited_at) : createdAt;
    const hoursSinceLastCredit = (now - lastCredited) / (1000 * 60 * 60);

    // If at least 1 hour has elapsed since the last reward
    if (hoursSinceLastCredit >= 1) {
      const bonusAmount = 0.25;

      // Update balance and set the last_credited_at timestamp to now
      await db.query(
        'UPDATE users SET balance = balance + ?, last_credited_at = ? WHERE id = ?',
        [bonusAmount, now, userId]
      );
    }
  } catch (err) {
    console.error('Hourly Bonus Processing Error:', err);
  }
}

router.get('/account-summary', async (req, res) => {
  try {
    const userId = req.user.id; // Extracted from JWT middleware

    // Run the hourly bonus check first so the updated balance reflects immediately
    await processLevelZeroHourlyBonus(userId);

    // Single query retrieving user profile data & highest active VIP level
    const [userRows] = await db.query(`
      SELECT 
        u.id, 
        u.phone, 
        u.balance, 
        u.avatar,
        u.vip_level,
        COALESCE(MAX(d.vip_level), u.vip_level) AS active_vip_level
      FROM users u
      LEFT JOIN user_devices ud ON u.id = ud.user_id AND ud.status = 'ACTIVE'
      LEFT JOIN devices d ON ud.device_id = d.id
      WHERE u.id = ?
      GROUP BY u.id, u.phone, u.balance, u.avatar, u.vip_level
    `, [userId]);

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userData = userRows[0];

    // Optional: Sync user's table column if it differs
    if (userData.active_vip_level !== userData.vip_level) {
      await db.query('UPDATE users SET vip_level = ? WHERE id = ?', [userData.active_vip_level, userId]);
    }

    res.json({
      success: true,
      data: {
        phone: userData.phone,
        avatar: userData.avatar || 'meAvatar.jpg',
        vip_level: userData.active_vip_level || 0,
        balance: parseFloat(userData.balance || 0),
        todayEarnings: 0.00,
        yesterdayEarnings: 0.00,
        investmentBenefits: 0.00,
        teamBenefits: 0.00,
        thisWeekEarnings: 0.00,
        referralRebate: 0.00,
        thisMonthEarnings: 0.00
      }
    });

  } catch (error) {
    console.error('Account Summary Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching account summary' });
  }
});

// POST: Change user account password
router.post('/change-password', async (req, res) => {
  try {
    const userId = req.user.id; // Extracted from JWT middleware
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide both old and new passwords.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    // 1. Fetch user from database to get current password hash
    const [users] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = users[0];

    // 2. Verify old password matches
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect old password.' });
    }

    // 3. Hash the new password and save it
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);

    return res.status(200).json({ success: true, message: 'Password updated successfully!' });

  } catch (error) {
    console.error('Password Change Error:', error);
    return res.status(500).json({ success: false, message: 'Server error processing password change.' });
  }
});

module.exports = router;