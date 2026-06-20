const Order = require('../models/Order')
const User = require('../models/User')
const ApiError = require('../utils/ApiError')
const { createLog } = require('./activityLogs.service')

async function listOrders(filters = {}) {
  const query = { deletedAt: null }

  if (filters.user) {
    query.user = filters.user
  }

  if (filters.seller) {
    query.seller = filters.seller
  }

  if (filters.status) {
    query.status = filters.status
  }

  return Order.find(query)
    .populate('user', 'name email accountType')
    .populate('seller', 'name email')
    .sort({ createdAt: -1 })
}

async function createOrder(payload) {
  const user = await User.findById(payload.user)
  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado')
  }

  const total = payload.items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)

  const order = await Order.create({
    ...payload,
    total,
    seller: user.assignedSeller || null,
  })

  await createLog({
    user: payload.user,
    action: 'Creacion de pedido',
    entity: 'order',
    metadata: { orderId: order._id.toString() },
  })

  return order
}

async function updateOrderStatus(orderId, status, actorId) {
  const order = await Order.findById(orderId)
  if (!order) {
    throw new ApiError(404, 'Pedido no encontrado')
  }

  order.status = status
  await order.save()

  await createLog({
    user: actorId || null,
    action: 'Cambio de estado de pedido',
    entity: 'order',
    metadata: { orderId, status },
  })

  return order
}

module.exports = {
  listOrders,
  createOrder,
  updateOrderStatus,
}
