const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { listLogs } = require('../services/activityLogs.service')

const getActivityLogs = asyncHandler(async (req, res) => {
  const logs = await listLogs(req.query)
  const serializedLogs = logs.map((log) => ({
    id: log._id.toString(),
    userName: log.user?.name || 'Sistema',
    userEmail: log.user?.email || '',
    userRole: log.user?.role || '',
    action: log.action,
    entity: log.entity,
    metadata: log.metadata || {},
    createdAt: log.createdAt,
  }))
  res.json(new ApiResponse({ data: serializedLogs }))
})

module.exports = {
  getActivityLogs,
}
