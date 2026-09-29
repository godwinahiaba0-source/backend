const express = require('express');

module.exports = function(pool) {
  const router = express.Router();

  // Verification Route
  router.post('/verify-invite', async (req, res) => {
    try {
      const { inviteCode } = req.body;

      if (!inviteCode) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invitation code is required.' 
        });
      }

      // Query your MySQL database directly using the pool
      // (Make sure 'inviteCode' matches the exact column name in your users table)
      const [rows] = await pool.query('SELECT * FROM users WHERE inviteCode = ?', [inviteCode]);

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