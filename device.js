const express = require('express');
const router = express.Router();
const pool = require('./db');
// Ensure your auth middleware path matches where you defined it
const { authenticateUserToken } = require('../middleware/auth'); 

/**
 * GET /api/devices/list
 * Returns all available devices from the database
 */
router.get('/list', authenticateUserToken, async (req, res) => {
  try {
    const [devices] = await pool.query(
      `SELECT id, name, price, hourly_yield FROM devices ORDER BY id ASC`
    );
    return res.json({ success: true, data: devices });
  } catch (error) {
    console.error('Error fetching device list:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch devices.' });
  }
});

/**
 * GET /api/devices/my-devices
 * Returns active devices owned by the authenticated user
 */
router.get('/my-devices', authenticateUserToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const [ownedDevices] = await pool.query(
      `SELECT ud.id AS user_device_id, ud.device_id, ud.created_at, d.name, d.price, d.hourly_yield 
       FROM user_devices ud
       JOIN devices d ON ud.device_id = d.id
       WHERE ud.user_id = ? AND ud.status = 'ACTIVE'`,
      [userId]
    );

    return res.json({ success: true, data: ownedDevices });
  } catch (error) {
    console.error('Error fetching user devices:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve active devices.' });
  }
});

/**
 * POST /api/devices/buy
 * Handles device purchases
 */
router.post('/buy', authenticateUserToken, async (req, res) => {
  const userId = req.user.id;
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ success: false, message: 'Device ID is required.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[user]] = await connection.query(
      `SELECT id, balance FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );

    if (!user) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const [[device]] = await connection.query(
      `SELECT id, name, price, hourly_yield FROM devices WHERE id = ?`,
      [device_id]
    );

    if (!device) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    const [[existingDevice]] = await connection.query(
      `SELECT id FROM user_devices WHERE user_id = ? AND device_id = ? AND status = 'ACTIVE'`,
      [userId, device_id]
    );

    if (existingDevice) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'You have already purchased this device. You can buy other available devices.' 
      });
    }

    const devicePrice = parseFloat(device.price);
    const userBalance = parseFloat(user.balance);

    if (userBalance < devicePrice) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient balance to purchase this device.' });
    }

    await connection.query(
      `UPDATE users SET balance = ROUND(balance - ?, 2) WHERE id = ?`,
      [devicePrice, userId]
    );

    await connection.query(
      `INSERT INTO user_devices (user_id, device_id, status, created_at, last_yield_at) 
       VALUES (?, ?, 'ACTIVE', NOW(), NOW())`,
      [userId, device_id]
    );

    await connection.query(
      `INSERT INTO transactions (user_id, type, category, amount, status) 
       VALUES (?, 'withdraw', 'device_purchase', ?, 'approved')`,
      [userId, devicePrice]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Successfully purchased ${device.name}!`,
      data: {
        purchasedDeviceId: device.id,
        newBalance: (userBalance - devicePrice).toFixed(2)
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error purchasing device:', error);
    return res.status(500).json({ success: false, message: 'Server error processing device purchase.' });
  } finally {
    connection.release();
  }
});

module.exports = router;