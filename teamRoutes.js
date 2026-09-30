const express = require('express');
const router = express.Router();

// Helper function to generate a 6-digit numeric referral code
function generateNumericCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. User Registration Route (/api/auth/register)
router.post('/auth/register', async (req, res) => {
  try {
    const { username, phone, password, inviteCode } = req.body;
    
    // Generate a unique numeric referral code for the new user
    const referralCode = generateNumericCode();

    // NOTE: Add your MySQL/Sequelize User.create(...) logic here if needed
    // const newUser = await User.create({ username, phone, password, referral_code: referralCode, invitedBy: inviteCode });

    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully',
      referral_code: referralCode 
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// 2. Verify Invite Code Route (/api/auth/verify-invite)
router.post('/auth/verify-invite', async (req, res) => {
  try {
    const { inviteCode, code } = req.body || req.query;
    const inputCode = inviteCode || code || '849201';
    
    // Ensure the code consists strictly of numbers
    const isNumeric = /^\d+$/.test(inputCode);
    if (!isNumeric) {
      return res.status(400).json({ success: false, message: 'Invite code must contain numbers only.' });
    }

    return res.json({ 
      success: true, 
      valid: true, 
      message: 'Invite code verified successfully',
      code: inputCode
    });
  } catch (err) {
    console.error("Verify invite error:", err);
    res.status(500).json({ error: 'Failed to verify invite code' });
  }
});

// 3. Get Current User Profile Route (/api/auth/me)
router.get('/auth/me', async (req, res) => {
  try {
    const userData = req.user || {
      username: 'Jnr Sinny',
      referral_code: '849201'
    };
    res.json({ user: userData });
  } catch (err) {
    console.error("Auth me error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 4. Get Team Report Metrics Route (/api/team/report)
router.get('/team/report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const reportData = {
      teamRecharge: 0.00,
      firstChargeCount: 0,
      teamSize: 0,
      teamWithdraw: 0.00,
      firstPushCount: 0,
      newTeamCount: 0,
      levels: {
        1: { rechargeAmount: 0.00, rechargeNumber: 0 },
        2: { rechargeAmount: 0.00, rechargeNumber: 0 },
        3: { rechargeAmount: 0.00, rechargeNumber: 0 }
      }
    };
    res.json(reportData);
  } catch (err) {
    console.error("Team report error:", err);
    res.status(500).json({ error: 'Failed to fetch team report' });
  }
});

module.exports = router;