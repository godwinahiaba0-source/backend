const express = require('express');

module.exports = function(pool) {
  const router = express.Router();

  router.post('/verify-invite', async (req, res) => {
    try {
      const { inviteCode } = req.body;

      // 1. Check if there are ANY users in the database yet
      const [allUsers] = await pool.query('SELECT COUNT(*) as count FROM users');
      const userCount = allUsers[0].count;

      // If you are the very first user on the platform, bypass the invite check!
      if (userCount === 0) {
        return res.status(200).json({ 
          success: true, 
          message: 'First user bypass: Invite code accepted.' 
        });
      }

      // 2. Standard check for later users: Code is required
      if (!inviteCode) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invitation code is required.' 
        });
      }

      // 3. Check if the code belongs to an active user
      const [rows] = await pool.query('SELECT * FROM users WHERE referral_code = ?', [invite_code]);

      if (!rows || rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Invalid invitation code. This code does not belong to any active user.' 
        });
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Invitation code is valid.' 
      });

    } catch (error) {
      console.error("Verify Invite Error:", error);
      return res.status(500).json({ 
        success: false, 
        message: 'Server error while verifying invite code.' 
      });
    }
  });

  return router;
};