const express = require('express');
const router = express.Router();

// Middleware placeholder if you have token verification imported from another file
// const verifyToken = require('./middleware/auth'); // Uncomment and point to your actual auth middleware

// 1. Get current user profile & referral code endpoint (/api/auth/me)
router.get('/auth/me', async (req, res) => {
  try {
    // If you use Sequelize, it might look like: User.findByPk(...)
    // If you use raw mysql, you can query your connection pool here.
    
    // Fallback safe response if user object isn't fully bound yet
    const userData = req.user || {
      username: 'Jnr Sinny',
      referral_code: 'PEPSI2026'
    };

    res.json({ user: userData });
  } catch (err) {
    console.error("Auth me error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 2. Get Team Report & Level Statistics endpoint (/api/team/report)
router.get('/team/report', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Return safe structured metrics so the frontend renders correctly without crashing
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