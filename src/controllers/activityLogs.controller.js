const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { listLogs } = require('../services/activityLogs.service')

const getActivityLogs = asyncHandler(async (req, res) => {
  const logs = await listLogs()
  res.json(new ApiResponse({ data: logs }))
})

module.exports = {
  getActivityLogs,
}
