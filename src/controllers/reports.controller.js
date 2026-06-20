const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { getSummary } = require('../services/reports.service')

const getReportSummary = asyncHandler(async (req, res) => {
  const summary = await getSummary()
  res.json(new ApiResponse({ data: summary }))
})

module.exports = {
  getReportSummary,
}
