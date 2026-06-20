const mongoose = require('mongoose')

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ActivityLog', activityLogSchema)
