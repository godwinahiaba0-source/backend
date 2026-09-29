const express = require('express');
const router = express.Router();
// Adjust the path to your database pool connection depending on your project setup
const pool = require('./db'); 

// Middleware to authenticate user token
const authenticateToken = require('../middleware/auth');

// 1. GET: Fetch fund summary (Active Invested Amount & Today's Earnings)
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Calculate total active invested capital
    const [investments] = await pool.query(
      `SELECT SUM(capital_amount) AS activeInvested FROM user_investments WHERE user_id = ? AND status = 'active'`,
      [userId]
    );

    // Calculate total daily profits from active investments as today's earnings
    const [earnings] = await pool.query(
      `SELECT SUM(daily_profit) AS todaysEarnings FROM user_investments WHERE user_id = ? AND status = 'active'`,
      [userId]
    );

    res.json({
      success: true,
      summary: {
        activeInvested: investments[0].activeInvested || 0,
        todaysEarnings: earnings[0].todaysEarnings || 0
      }
    });
  } catch (err) {
    console.error('Error fetching fund summary:', err);
    res.status(500).json({ success: false, message: 'Server error loading fund summary.' });
  }
});

// 2. GET: Fetch purchased plan records for the modal
router.get('/records', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [records] = await pool.query(
      `SELECT id, duration_days AS days, capital_amount AS amount, (capital_amount + (capital_amount * (profit_percent / 100))) AS expectedProfit, status, created_at AS timestamp 
       FROM user_investments WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ success: true, records });
  } catch (err) {
    console.error('Error fetching records:', err);
    res.status(500).json({ success: false, message: 'Server error loading records.' });
  }
});

// 3. POST: Purchase an investment plan (Locks funds by deducting from user balance)
router.post('/invest', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { depositAmount, days, profitPercent } = req.body;

  const amount = parseFloat(depositAmount);
  if (!amount || amount < 100) {
    return res.status(400).json({ success: false, message: 'Invalid investment amount. Minimum is GHS 100.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check user balance and lock the row to prevent race conditions
    const [users] = await connection.query(`SELECT balance FROM users WHERE id = ? FOR UPDATE`, [userId]);
    if (users.length === 0 || users[0].balance < amount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }

    // Deduct amount from user balance (Locks the funds)
    await connection.query(`UPDATE users SET balance = balance - ? WHERE id = ?`, [amount, userId]);

    // Calculate daily profit yield spread across days
    const totalReturn = amount * (Number(profitPercent) / 100);
    const dailyProfit = totalReturn / Number(days);

    // Insert into user_investments table
    await connection.query(
      `INSERT INTO user_investments (user_id, plan_name, capital_amount, profit_percent, daily_profit, duration_days, days_collected, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, 0, 'active', NOW())`,
      [userId, `${days} Days Plan`, amount, profitPercent, dailyProfit, days]
    );

    await connection.commit();
    res.json({ success: true, message: 'Investment plan purchased successfully!' });
  } catch (err) {
    await connection.rollback();
    console.error('Investment error:', err);
    res.status(500).json({ success: false, message: 'Server error processing investment.' });
  } finally {
    connection.release();
  }
});

module.exports = router;