const User = require('../models/User')
const Order = require('../models/Order')

async function getSellerClients(sellerId) {
  return User.find({
    deletedAt: null,
    assignedSeller: sellerId,
  })
}

async function getSellerOrders(sellerId) {
  return Order.find({
    deletedAt: null,
    seller: sellerId,
  }).populate('user', 'name email')
}

module.exports = {
  getSellerClients,
  getSellerOrders,
}
