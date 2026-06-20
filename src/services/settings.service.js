const Settings = require('../models/Settings')

async function getSettings() {
  let settings = await Settings.findOne()

  if (!settings) {
    settings = await Settings.create({
      minWholesaleOrder: 0,
      taxPercentage: 21,
      paymentMethods: ['transferencia'],
      whatsappNumber: '',
      automaticMessages: {
        wholesaleApproved: '',
        orderCreated: '',
        sellerAssigned: '',
      },
    })
  }

  return settings
}

async function updateSettings(payload) {
  const currentSettings = await getSettings()
  Object.assign(currentSettings, payload)
  await currentSettings.save()
  return currentSettings
}

module.exports = {
  getSettings,
  updateSettings,
}
