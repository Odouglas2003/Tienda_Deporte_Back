const ActivityLog = require('../models/ActivityLog')

async function createLog(payload) {
  return ActivityLog.create(payload)
}

async function listLogs() {
  return ActivityLog.find().sort({ createdAt: -1 }).populate('user', 'name email role')
}

module.exports = {
  createLog,
  listLogs,
}
