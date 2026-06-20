const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['cliente', 'vendedor', 'admin', 'superAdmin'],
      default: 'cliente',
    },
    accountType: {
      type: String,
      enum: ['minorista', 'mayorista'],
      default: 'minorista',
    },
    approved: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'approved',
    },
    assignedSeller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    mustChangePassword: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    phone: { type: String, default: '' },
    cuit: { type: String, default: '' },
    businessName: { type: String, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)
