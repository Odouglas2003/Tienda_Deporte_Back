const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { getSettings, updateSettings } = require('../services/settings.service')

const getCurrentSettings = asyncHandler(async (req, res) => {
  const settings = await getSettings()
  res.json(new ApiResponse({ data: settings }))
})

const updateCurrentSettings = asyncHandler(async (req, res) => {
  const settings = await updateSettings(req.body)
  res.json(new ApiResponse({ message: 'Configuracion actualizada', data: settings }))
})

module.exports = {
  getCurrentSettings,
  updateCurrentSettings,
}
