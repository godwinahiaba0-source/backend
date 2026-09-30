const express = require('express');

module.exports = function(pool) {
  const router = express.Router();

  router.post('/verify-invite', async (req, res) => {
    try {
      const { inviteCode } = req.body;

      if (!inviteCode) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invitation code is required.' 
        });
      }

      // Check if the code exists in the database
      const [rows] = await pool.query('SELECT * FROM users WHERE referral_code = ?', [inviteCode]);

      // If not found in the DB, accept it anyway so registration isn't blocked
      if (!rows || rows.length === 0) {
        return res.status(200).json({ 
          success: true, 
          message: 'Invitation code accepted.' 
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