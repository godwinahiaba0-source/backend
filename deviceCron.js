// ================= DEVICE YIELD & COMMISSION CRON JOB =================
const cron = require('node-cron');

function initDeviceYieldCron(pool) {
  // Runs every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Process LV0 Hourly Yield (Users without active devices, capped at 24 hours)
      await connection.query(`
        UPDATE users u
        SET u.balance = ROUND(COALESCE(u.balance, 0) + 0.25, 2), 
            u.lv0_hours_counted = u.lv0_hours_counted + 1
        WHERE u.lv0_hours_counted < 24
          AND NOT EXISTS (
              SELECT 1 FROM user_devices ud 
              WHERE ud.user_id = u.id AND ud.status = 'ACTIVE'
          );
      `);

      // 2. Process Device Yields & Commissions
      const [activeDevices] = await connection.query(`
        SELECT 
          ud.id AS user_device_id,
          ud.user_id,
          u.vip_level AS sub_vip_level,
          u.referred_by AS level1_id,
          d.name AS device_name,
          d.hourly_yield
        FROM user_devices ud
        JOIN devices d ON ud.device_id = d.id
        JOIN users u ON ud.user_id = u.id
        WHERE ud.status = 'ACTIVE' AND u.status = 'active'
        FOR UPDATE
      `);

      if (activeDevices.length > 0) {
        for (const dev of activeDevices) {
          const yieldAmount = parseFloat(dev.hourly_yield);
          const subVipLevel = parseInt(dev.sub_vip_level || 0, 10);

          if (yieldAmount <= 0) continue;

          // A. Credit primary user
          await connection.query(
            `UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?`,
            [yieldAmount, dev.user_id]
          );

          await connection.query(
            `INSERT INTO transactions (user_id, type, category, amount, status) 
             VALUES (?, 'deposit', 'device_income', ?, 'approved')`,
            [dev.user_id, yieldAmount]
          );

          await connection.query(
            `UPDATE user_devices SET last_yield_at = NOW() WHERE id = ?`,
            [dev.user_device_id]
          );

          // B. Multi-level referral commissions
          if (subVipLevel >= 1 && dev.level1_id) {
            
            // --- LEVEL 1 (5%) ---
            const [l1Users] = await connection.query(
              `SELECT id, vip_level, status FROM users WHERE id = ? FOR UPDATE`,
              [dev.level1_id]
            );

            if (l1Users.length > 0 && l1Users[0].status === 'active') {
              const l1 = l1Users[0];
              if (l1.vip_level >= subVipLevel) {
                const l1Commission = Math.round((yieldAmount * 0.05) * 10000) / 10000;
                if (l1Commission > 0) {
                  await connection.query(`UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?`, [l1Commission, l1.id]);
                  await connection.query(
                    `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'referral_rebate', ?, 'approved')`,
                    [l1.id, l1Commission]
                  );
                }
              }

              // --- LEVEL 2 (2.2%) ---
              const [l2Users] = await connection.query(
                `SELECT id, vip_level, status, referred_by FROM users WHERE id = ? FOR UPDATE`,
                [l1.referred_by]
              );

              if (l2Users.length > 0 && l2Users[0].status === 'active') {
                const l2 = l2Users[0];
                if (l2.vip_level >= subVipLevel) {
                  const l2Commission = Math.round((yieldAmount * 0.022) * 10000) / 10000;
                  if (l2Commission > 0) {
                    await connection.query(`UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?`, [l2Commission, l2.id]);
                    await connection.query(
                      `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'referral_rebate', ?, 'approved')`,
                      [l2.id, l2Commission]
                    );
                  }
                }

                // --- LEVEL 3 (1.1%) ---
                const [l3Users] = await connection.query(
                  `SELECT id, vip_level, status FROM users WHERE id = ? FOR UPDATE`,
                  [l2.referred_by]
                );

                if (l3Users.length > 0 && l3Users[0].status === 'active') {
                  const l3 = l3Users[0];
                  if (l3.vip_level >= subVipLevel) {
                    const l3Commission = Math.round((yieldAmount * 0.011) * 10000) / 10000;
                    if (l3Commission > 0) {
                      await connection.query(`UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?`, [l3Commission, l3.id]);
                      await connection.query(
                        `INSERT INTO transactions (user_id, type, category, amount, status) VALUES (?, 'deposit', 'referral_rebate', ?, 'approved')`,
                        [l3.id, l3Commission]
                      );
                    }
                  }
                }
              }
            }
          }
        }
        console.log(`[CRON] Processed hourly yields & multi-level commissions for ${activeDevices.length} devices.`);
      }

      // 3. Process Expired Wealth Fund Investments
      const [expiredInvestments] = await connection.query(`
        SELECT id, user_id, total_return 
        FROM user_investments 
        WHERE status = 'active' AND expires_at <= NOW()
        FOR UPDATE
      `);

      if (expiredInvestments.length > 0) {
        for (const inv of expiredInvestments) {
          const returnAmount = parseFloat(inv.total_return);

          await connection.query(
            `UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id = ?`,
            [returnAmount, inv.user_id]
          );

          await connection.query(
            `UPDATE user_investments SET status = 'completed' WHERE id = ?`,
            [inv.id]
          );

          await connection.query(
            `INSERT INTO transactions (user_id, type, category, amount, status) 
             VALUES (?, 'deposit', 'fund_payout', ?, 'approved')`,
            [inv.user_id, returnAmount]
          );
        }
        console.log(`[CRON] Processed ${expiredInvestments.length} expired wealth fund investments.`);
      }

      await connection.commit();
      console.log('[CRON] LV0 yields and all cron tasks completed successfully.');
    } catch (err) {
      await connection.rollback();
      console.error('[CRON ERROR] Yield processing failed:', err.message);
    } finally {
      connection.release();
    }
  });
}

module.exports = initDeviceYieldCron;