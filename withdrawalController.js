const express = require('express');

module.exports = function(pool, authenticateToken, io) {
  const router = express.Router();

  // 1. Withdrawal Submission Route with Status Check
  router.post('/withdraw/submit', authenticateToken, async (req, res) => {
    const { amount, fundPassword, method, accountDetails } = req.body;
    const userId = req.user.id;
    const numericAmount = parseFloat(amount);
    const MIN_WITHDRAWAL = 20.00;

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Check if user is allowed to withdraw
      const [users] = await connection.query(
        'SELECT balance, fund_password, withdrawal_enabled FROM users WHERE id = ? FOR UPDATE', 
        [userId]
      );
      
      if (users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const user = users[0];

      // Block if withdrawal feature is disabled by admin
      if (user.withdrawal_enabled === 0) {
        await connection.rollback();
        return res.status(403).json({ 
          success: false, 
          message: 'Withdrawal function not enabled' 
        });
      }

      // Validate minimum withdrawal amount
      if (isNaN(numericAmount) || numericAmount < MIN_WITHDRAWAL) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `Minimum withdrawal amount is GHS ${MIN_WITHDRAWAL.toFixed(2)}` });
      }

      if (!fundPassword) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Fund password is required.' });
      }

      if (String(user.fund_password).trim() !== String(fundPassword).trim()) {
        await connection.rollback();
        return res.status(401).json({ success: false, message: 'Incorrect fund password.' });
      }

      const currentBalance = parseFloat(user.balance);
      if (currentBalance < numericAmount) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Insufficient account balance.' });
      }

      const feeAmount = Math.round((numericAmount * 0.05) * 100) / 100;
      const netAmount = Math.round((numericAmount - feeAmount) * 100) / 100;
      const finalAccountDetails = typeof accountDetails === 'object' ? JSON.stringify(accountDetails) : (accountDetails || 'Mobile/Bank Wallet');
      const finalMethod = method || 'Mobile Money';

      const newBalance = Math.round((currentBalance - numericAmount) * 100) / 100;
      await connection.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

      const [result] = await connection.query(
        `INSERT INTO transactions (user_id, type, category, amount, method, account_details, status) VALUES (?, 'withdrawal', 'withdrawal', ?, ?, ?, 'pending')`,
        [userId, netAmount, finalMethod, finalAccountDetails]
      );

      await connection.commit();

      const [insertedRows] = await pool.query(
        `SELECT t.id, t.user_id, u.phone, t.amount, t.method, t.account_details, t.status, t.created_at FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = ?`,
        [result.insertId]
      );

      const liveData = insertedRows[0] || {};
      if (io) {
        io.to('admin_room').emit('new_withdrawal_received', {
          ...liveData,
          requestedAmount: numericAmount.toFixed(2),
          feeAmount: feeAmount.toFixed(2),
          netAmount: netAmount.toFixed(2),
          utcTime: new Date().toISOString()
        });
      }

      return res.json({
        success: true,
        message: `Withdrawal request submitted successfully! Net payout: GHS ${netAmount.toFixed(2)} (5% fee applied).`,
        newBalance: newBalance.toFixed(2),
        transaction: { ...liveData, requestedAmount: numericAmount.toFixed(2), feeAmount: feeAmount.toFixed(2), netAmount: netAmount.toFixed(2) }
      });

    } catch (err) {
      if (connection) await connection.rollback();
      console.error('Withdrawal Submit Error:', err);
      return res.status(500).json({ success: false, message: 'Server error processing withdrawal.' });
    } finally {
      if (connection) connection.release();
    }
  });

  // 2. Admin Route to Toggle User Withdrawal Access
  router.post('/admin/users/toggle-withdrawal', authenticateToken, async (req, res) => {
    const { userId, enabled } = req.body; // enabled: 1 (true) or 0 (false)

    if (userId === undefined || enabled === undefined) {
      return res.status(400).json({ success: false, message: 'Invalid payload parameters.' });
    }

    try {
      await pool.query("UPDATE users SET withdrawal_enabled = ? WHERE id = ?", [enabled ? 1 : 0, userId]);
      res.json({ 
        success: true, 
        message: `Withdrawal function for user #${userId} has been ${enabled ? 'enabled' : 'disabled'}.` 
      });
    } catch (err) {
      console.error('Error toggling withdrawal status:', err);
      res.status(500).json({ success: false, message: 'Database query failed.' });
    }
  });

  return router;
};





