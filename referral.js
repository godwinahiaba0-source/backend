const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

module.exports = function(db) {

  router.post('/register', async (req, res) => {
    try {
      const { username, password, ref } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // 1. Check how many users currently exist in the database
      const userCountResult = await db.query('SELECT COUNT(*) FROM users');
      const totalUsers = parseInt(userCountResult.rows[0].count, 10);

      let invitedById = null;

      // 2. Handle Referral Logic based on whether it's the first user or not
      if (totalUsers === 0) {
        // First user ever on the platform: Skip referral code entirely!
        invitedById = null;
      } else {
        // For all subsequent users: A referral code is mandatory and must be verified
        if (!ref) {
          return res.status(400).json({ error: 'A valid referral code is required to register.' });
        }

        // Verify if the referral code exists in the database
        const uplineUser = await db.query('SELECT id FROM users WHERE referral_code = $1', [ref]);
        if (uplineUser.rows.length === 0) {
          return res.status(400).json({ error: 'Invalid referral code. Please check the code and try again.' });
        }
        
        // Assign the upline user's ID so they fall under their team
        invitedById = uplineUser.rows[0].id;
      }

      // 3. Hash the user's password
      const hashedPassword = await bcrypt.hash(password, 10);

      // 4. Generate a unique 6-digit numeric referral code for this new user
      let referralCode;
      let isUnique = false;
      while (!isUnique) {
        referralCode = Math.floor(100000 + Math.random() * 900000);
        // Double-check that this 6-digit code isn't already taken by someone else
        const codeCheck = await db.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
        if (codeCheck.rows.length === 0) {
          isUnique = true;
        }
      }

      // 5. Save the new user into the database
      const newUser = await db.query(
        'INSERT INTO users (username, password, referral_code, invited_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [username, hashedPassword, referralCode, invitedById]
      );

      res.status(201).json({ 
        message: 'User registered successfully', 
        user: newUser.rows[0] 
      });

    } catch (err) {
      console.error("Registration error:", err);
      res.status(500).json({ error: "Server error during registration" });
    }
  });

  return router;
};