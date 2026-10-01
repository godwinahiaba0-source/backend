const express = require('express');

module.exports = function(pool) {
  const router = express.Router();

  router.get('/home/config', async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        announcement: "Welcome to the platform!",
        maintenanceMode: false
      });
    } catch (error) {
      console.error("Home Config Error:", error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  return router;
};