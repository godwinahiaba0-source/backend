const express = require('express');
const router = express.Router();
// Make sure to require your User model according to your project's exact path
const User = require('./models/User'); // Update path if your models folder is elsewhere

// Verification Route
router.post('/verify-invite', async (req, res) => {
  try {
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invitation code is required.' 
      });
    }

    // Check if an active user owns this invite code on the platform
    const referrer = await User.findOne({ inviteCode: inviteCode }); 

    if (!referrer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid invitation code. This code does not belong to any active user.' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Invitation code is valid.' 
    });

  } catch (error) {
    console.error("Verify Invite Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error while verifying invite code.' 
    });
  }
});

module.exports = router;