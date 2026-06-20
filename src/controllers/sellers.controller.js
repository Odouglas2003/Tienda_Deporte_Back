const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { getSellerClients, getSellerOrders } = require('../services/sellers.service')

const getMyClients = asyncHandler(async (req, res) => {
  const clients = await getSellerClients(req.auth.sub)
  res.json(new ApiResponse({ data: clients }))
})

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await getSellerOrders(req.auth.sub)
  res.json(new ApiResponse({ data: orders }))
})

module.exports = {
  getMyClients,
  getMyOrders,
}
