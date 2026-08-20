const ActivityLog = require('../models/ActivityLog')

async function createLog(payload) {
  return ActivityLog.create(payload)
}

async function listLogs(filters = {}) {
  const query = {}

  if (filters.entity) query.entity = filters.entity
  if (filters.action) query.action = { $regex: filters.action, $options: 'i' }
  if (filters.search) query.action = { $regex: filters.search, $options: 'i' }

  return ActivityLog.find(query).sort({ createdAt: -1 }).limit(250).populate('user', 'name email role')
}

module.exports = {
  createLog,
  listLogs,
}
