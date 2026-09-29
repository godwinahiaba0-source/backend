const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// Auth middleware helper
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized access. Token missing.' });
  }

  const jwtSecret = process.env.JWT_SECRET || 'pepsi_vip_secret_key_12345';

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token session.' });
    }
    req.user = user;
    next();
  });
};

// GET: Retrieve user recharge/deposit records
router.get('/recharges', authenticateToken, async (req, res) => {
  const userId = req.user.id || req.user.userId;

  try {
    const [rows] = await db.query(
      `SELECT 
        id, 
        amount, 
        channel, 
        transaction_id AS transactionId, 
        status, 
        created_at AS timestamp 
       FROM transactions 
       WHERE user_id = ? AND category = 'deposit' 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      recharges: rows
    });
  } catch (error) {
    console.error('Fetch Recharges Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching recharge records' });
  }
});

// GET: Retrieve user active/completed fund investments
router.get('/investments', authenticateToken, async (req, res) => {
  const userId = req.user.id || req.user.userId;

  try {
    const [investments] = await db.query(
      `SELECT 
        id, 
        amount, 
        profit_rate AS profitPercent, 
        duration_days AS days, 
        daily_earnings AS dailyEarnings, 
        (total_return - amount) AS expectedProfit,
        total_return AS totalReturn, 
        status, 
        created_at AS timestamp, 
        expires_at 
       FROM user_investments 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ 
      success: true, 
      data: investments,
      records: investments 
    });
  } catch (error) {
    console.error('Fetch Investments Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching investments.' });
  }
});

// Dedicated alias route for frontend modal fetch (/api/fund/records)
router.get('/records', authenticateToken, async (req, res) => {
  const userId = req.user.id || req.user.userId;

  try {
    const [investments] = await db.query(
      `SELECT 
        id, 
        amount, 
        profit_rate AS profitPercent, 
        duration_days AS days, 
        daily_earnings AS dailyEarnings, 
        (total_return - amount) AS expectedProfit,
        total_return AS totalReturn, 
        status, 
        created_at AS timestamp, 
        expires_at 
       FROM user_investments 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ 
      success: true, 
      records: investments 
    });
  } catch (error) {
    console.error('Fetch Records Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching plan records.' });
  }
});

// GET: Wealth fund summary metrics for dashboard UI
router.get('/summary', authenticateToken, async (req, res) => {
  const userId = req.user.id || req.user.userId;

  try {
    const [rows] = await db.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN status = 'active' THEN amount ELSE 0 END), 0) AS activeInvested,
        COALESCE(SUM(CASE WHEN status = 'active' THEN daily_earnings ELSE 0 END), 0) AS todaysEarnings,
        COALESCE(SUM(total_return - amount), 0) AS totalExpectedProfit
       FROM user_investments 
       WHERE user_id = ?`,
      [userId]
    );

    res.json({ 
      success: true, 
      summary: rows[0] 
    });
  } catch (error) {
    console.error('Fetch Fund Summary Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching fund summary.' });
  }
});

// POST: Process Fund Investment with Minimum GHS 100 Limit
router.post('/invest', authenticateToken, async (req, res) => {
  const { depositAmount, days, profitPercent, expectedProfit } = req.body;
  const userId = req.user.id || req.user.userId;

  const numericDeposit = parseFloat(depositAmount);
  const numericDays = parseInt(days, 10);
  const numericProfitPercent = parseFloat(profitPercent);

  const MIN_INVESTMENT = 100.00;

  if (isNaN(numericDeposit) || numericDeposit < MIN_INVESTMENT) {
    return res.status(400).json({ 
      success: false, 
      message: `Minimum investment amount is GHS ${MIN_INVESTMENT.toFixed(2)}` 
    });
  }

  if (isNaN(numericDays) || isNaN(numericProfitPercent)) {
    return res.status(400).json({ success: false, message: 'Invalid investment plan selected' });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User account not found' });
    }

    const currentBalance = parseFloat(users[0].balance);

    if (currentBalance < numericDeposit) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient balance to join this fund' });
    }

    const newBalance = Math.round((currentBalance - numericDeposit) * 100) / 100;
    await connection.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

    const calculatedProfit = expectedProfit !== undefined 
      ? parseFloat(expectedProfit) 
      : numericDeposit * (numericProfitPercent / 100);

    const dailyEarnings = calculatedProfit / numericDays;
    const totalReturn = numericDeposit + calculatedProfit;

    await connection.query(
      `INSERT INTO user_investments 
       (user_id, amount, profit_rate, duration_days, daily_earnings, total_return, status, expires_at) 
       VALUES (?, ?, ?, ?, ?, ?, 'active', DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [userId, numericDeposit, numericProfitPercent, numericDays, dailyEarnings, totalReturn, numericDays]
    );

    await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'withdrawal', 'fund_investment', ?, 'approved')`,
      [userId, numericDeposit]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `Investment activated successfully! ${numericDeposit.toFixed(2)} GHS locked for ${numericDays} days.`,
      newBalance: newBalance.toFixed(2),
      expectedProfit: calculatedProfit.toFixed(2)
    });
  } catch (error) {
    await connection.rollback();
    console.error('Fund Investment Error:', error);
    res.status(500).json({ success: false, message: 'Server error processing investment' });
  } finally {
    connection.release();
  }
});

// POST: Process User Withdrawal Request (Strict Anti-Spam Check)
router.post('/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const { amount, channel, officialName, accountNumber } = req.body;

  const requestedAmount = parseFloat(amount);
  const MIN_WITHDRAWAL = 20.00;

  if (isNaN(requestedAmount) || requestedAmount < MIN_WITHDRAWAL) {
    return res.status(400).json({ 
      success: false, 
      message: `Minimum withdrawal amount is GHS ${MIN_WITHDRAWAL.toFixed(2)}` 
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [allUserWithdrawals] = await connection.query(
      `SELECT id, status FROM withdrawals WHERE user_id = ?`,
      [userId]
    );
    console.log(`[WITHDRAW CHECK] User ${userId} all withdrawals in DB:`, allUserWithdrawals);

    const [activeWithdrawals] = await connection.query(
      `SELECT id, status FROM withdrawals WHERE user_id = ? AND LOWER(status) IN ('pending', 'processing', 'requested', 'under_review')`,
      [userId]
    );

    const [activeTransactions] = await connection.query(
      `SELECT id, status FROM transactions WHERE user_id = ? AND category = 'user_withdrawal' AND LOWER(status) IN ('pending', 'processing', 'requested')`,
      [userId]
    );

    if (activeWithdrawals.length > 0 || activeTransactions.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'You already have an active withdrawal request being processed.'
      });
    }

    const [users] = await connection.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);

    if (!users || users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const currentBalance = parseFloat(users[0].balance);

    if (currentBalance < requestedAmount) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient balance to complete withdrawal.' 
      });
    }

    let payChannel = channel;
    let payName = officialName;
    let payAccount = accountNumber;

    if (!payAccount || !payName) {
      const [cards] = await connection.query('SELECT * FROM bank_cards WHERE user_id = ? LIMIT 1', [userId]);
      if (cards.length > 0) {
        payChannel = payChannel || cards[0].bank_name || cards[0].channel || 'NULL';
        payName = payName || cards[0].official_name || cards[0].account_name;
        payAccount = payAccount || cards[0].account_number;
      }
    }

    const feeAmount = Math.round((requestedAmount * 0.05) * 100) / 100;
    const netAmount = Math.round((requestedAmount - feeAmount) * 100) / 100;
    const newBalance = Math.round((currentBalance - requestedAmount) * 100) / 100;

    await connection.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

    await connection.query(
      `INSERT INTO withdrawals 
       (user_id, gross_amount, fee_amount, net_amount, channel, official_name, account_number, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [userId, requestedAmount, feeAmount, netAmount, payChannel || 'NULL', payName || 'N/A', payAccount || 'N/A']
    );

    await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'withdrawal', 'user_withdrawal', ?, 'pending')`,
      [userId, netAmount]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Withdrawal submitted! 5% fee (GHS ${feeAmount.toFixed(2)}) applied. Net payout: GHS ${netAmount.toFixed(2)}.`,
      data: {
        requestedAmount: requestedAmount.toFixed(2),
        feeAmount: feeAmount.toFixed(2),
        netAmount: netAmount.toFixed(2),
        newBalance: newBalance.toFixed(2),
        status: 'pending'
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Withdrawal Processing Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error processing withdrawal.' 
    });
  } finally {
    connection.release();
  }
});

module.exports = router;