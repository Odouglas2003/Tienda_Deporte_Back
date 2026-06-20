const mongoose = require('mongoose')

const settingsSchema = new mongoose.Schema(
  {
    minWholesaleOrder: { type: Number, default: 0 },
    taxPercentage: { type: Number, default: 0 },
    paymentMethods: [{ type: String }],
    whatsappNumber: { type: String, default: '' },
    automaticMessages: {
      wholesaleApproved: { type: String, default: '' },
      orderCreated: { type: String, default: '' },
      sellerAssigned: { type: String, default: '' },
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Settings', settingsSchema)
