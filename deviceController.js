// ================= DEVICE PURCHASE & INSTANT REBATE CONTROLLER =================
const express = require('express');
const router = express.Router();

function setDeviceRoutes(pool, authenticateToken) {
  router.post('/buy', authenticateToken, async (req, res) => {
    // Safely support different token payload structures (e.g., req.user.id or req.userId)
    const userId = req.user?.id || req.user?.userId || req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User ID missing from token.' });
    }

    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ success: false, message: 'Device ID is required.' });

    const targetVipLevel = parseInt(device_id, 10); // Assuming device_id corresponds to VIP level

    // Block VIP 11 and 12 (Please stay tuned)
    if (targetVipLevel === 11 || targetVipLevel === 12) {
      return res.status(400).json({ 
        success: false, 
        message: `VIP ${targetVipLevel} devices are currently locked. Please stay tuned!` 
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch buyer details, device details, and upline chain (referred_by)
      const [[user]] = await connection.query(
        `SELECT u.id, u.balance, u.vip_level, u.referred_by AS l1_id FROM users u WHERE u.id = ? FOR UPDATE`, 
        [userId]
      );
      const [[device]] = await connection.query(`SELECT id, name, price, hourly_yield FROM devices WHERE id = ?`, [device_id]);

      if (!user || !device) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'User or Device not found.' });
      }

      // 2. CHECK IF USER ALREADY OWNS THIS ACTIVE DEVICE (Prevent duplicates)
      const [existingDevice] = await connection.query(
        `SELECT id FROM user_devices WHERE user_id = ? AND device_id = ? AND status = 'ACTIVE'`,
        [userId, device_id]
      );

      if (existingDevice.length > 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'You already own an active instance of this device!' });
      }

      const devicePrice = parseFloat(device.price);
      const buyerVipLevel = parseInt(user.vip_level || 0, 10);

      // 3. CHECK DOWNLINE REQUIREMENTS FOR VIP LEVELS 4 THROUGH 10
      if (targetVipLevel >= 4 && targetVipLevel <= 10) {
        const [[{ active_l1_count }]] = await connection.query(`
          SELECT COUNT(DISTINCT u.id) AS active_l1_count 
          FROM users u 
          WHERE u.referred_by = ? 
            AND u.status = 'active'
            AND EXISTS (SELECT 1 FROM user_devices ud WHERE ud.user_id = u.id AND ud.status = 'ACTIVE')
        `, [userId]);

        let requiredCount = 0;
        if (targetVipLevel === 4) requiredCount = 20;
        else if (targetVipLevel === 5) requiredCount = 30;
        else if (targetVipLevel === 6) requiredCount = 50;
        else if (targetVipLevel === 7) requiredCount = 80;
        else if (targetVipLevel === 8) requiredCount = 100;
        else if (targetVipLevel === 9) requiredCount = 150;
        else if (targetVipLevel === 10) requiredCount = 200;

        if (active_l1_count < requiredCount) {
          await connection.rollback();
          return res.status(400).json({ 
            success: false, 
            message: `Unlock requirement not met! You need at least ${requiredCount} active Level 1 downlines to purchase VIP ${targetVipLevel}. You currently have ${active_l1_count}.` 
          });
        }
      }

      const userBalance = parseFloat(user.balance || 0);
      if (userBalance < devicePrice) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Insufficient balance to purchase this device.' });
      }

      // 4. Deduct balance safely using COALESCE and update VIP level if needed
      const newVipLevel = Math.max(buyerVipLevel, targetVipLevel);
      await connection.query(`UPDATE users SET balance = ROUND(COALESCE(balance, 0) - ?, 2), vip_level = ? WHERE id = ?`, [devicePrice, newVipLevel, userId]);
      
      // 5. Record device purchase
      await connection.query(`INSERT INTO user_devices (user_id, device_id, status, created_at, last_yield_at) VALUES (?, ?, 'ACTIVE', NOW(), NOW())`, [userId, device_id]);
      await connection.query(`INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'withdrawal', 'vip_purchase', ?, 'approved')`, [userId, devicePrice]);

      // 6. DISTRIBUTE INSTANT REFERRAL REBATES (Level 1: 10%, Level 2: 5%, Level 3: 3%)
      if (user.l1_id) {
        // --- LEVEL 1 (10%) ---
        const [l1Users] = await connection.query(`SELECT id, vip_level, status, referred_by AS l2_id FROM users WHERE id = ? FOR UPDATE`, [user.l1_id]);
        if (l1Users.length > 0 && l1Users[0].status === 'active') {
          const l1 = l1Users[0];
          if (l1.vip_level >= buyerVipLevel) {
            const l1Bonus = Math.round((devicePrice * 0.10) * 100) / 100;
            if (l1Bonus > 0) {
              await connection.query(`UPDATE users SET balance = ROUND(COALESCE(balance, 0) + ?, 2) WHERE id = ?`, [l1Bonus, l1.id]);
              await connection.query(`INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'referral_rebate', ?, 'approved')`, [l1.id, l1Bonus]);
            }
          }

          // --- LEVEL 2 (5%) ---
          if (l1.l2_id) {
            const [l2Users] = await connection.query(`SELECT id, vip_level, status, referred_by AS l3_id FROM users WHERE id = ? FOR UPDATE`, [l1.l2_id]);
            if (l2Users.length > 0 && l2Users[0].status === 'active') {
              const l2 = l2Users[0];
              if (l2.vip_level >= buyerVipLevel) {
                const l2Bonus = Math.round((devicePrice * 0.05) * 100) / 100;
                if (l2Bonus > 0) {
                  await connection.query(`UPDATE users SET balance = ROUND(COALESCE(balance, 0) + ?, 2) WHERE id = ?`, [l2Bonus, l2.id]);
                  await connection.query(`INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'referral_rebate', ?, 'approved')`, [l2.id, l2Bonus]);
                }
              }

              // --- LEVEL 3 (3%) ---
              if (l2.l3_id) {
                const [l3Users] = await connection.query(`SELECT id, vip_level, status FROM users WHERE id = ? FOR UPDATE`, [l2.l3_id]);
                if (l3Users.length > 0 && l3Users[0].status === 'active') {
                  const l3 = l3Users[0];
                  if (l3.vip_level >= buyerVipLevel) {
                    const l3Bonus = Math.round((devicePrice * 0.03) * 100) / 100;
                    if (l3Bonus > 0) {
                      await connection.query(`UPDATE users SET balance = ROUND(COALESCE(balance, 0) + ?, 2) WHERE id = ?`, [l3Bonus, l3.id]);
                      await connection.query(`INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'referral_rebate', ?, 'approved')`, [l3.id, l3Bonus]);
                    }
                  }
                }
              }
            }
          }
        }
      }

      await connection.commit();
      return res.json({ success: true, message: `Successfully purchased ${device.name}!` });
    } catch (error) {
      await connection.rollback();
      console.error('Error purchasing device:', error);
      return res.status(500).json({ success: false, message: 'Server error processing device purchase.' });
    } finally {
      connection.release();
    }
  });

  return router;
}

module.exports = setDeviceRoutes;