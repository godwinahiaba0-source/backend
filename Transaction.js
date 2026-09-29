const mongoose = require('mongoose');

// Schema for Deposits / Recharges
const RechargeSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, default: 'User' },
  amount: { type: Number, required: true },
  channel: { type: String, required: true }, // e.g., 'Sol Pay', 'MoMo', 'Bank Transfer'
  transactionId: { type: String, default: '' }, // Provided by user for Sol Pay / Manual channels
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

// Schema for Withdrawals
const WithdrawalSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, default: 'User' },
  amount: { type: Number, required: true },
  method: { type: String, required: true }, // e.g., 'Sol Pay Wallet', 'MoMo Account'
  accountDetails: { type: String, required: true }, // Wallet address / Account number
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = {
  Recharge: mongoose.model('Recharge', RechargeSchema),
  Withdrawal: mongoose.model('Withdrawal', WithdrawalSchema)
};