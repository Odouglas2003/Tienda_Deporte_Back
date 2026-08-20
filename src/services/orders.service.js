const Order = require('../models/Order')
const User = require('../models/User')
const Product = require('../models/Product')
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

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new ApiError(400, 'El pedido debe tener al menos un producto')
  }

  const productIds = payload.items.map((item) => item.product)
  const products = await Product.find({ _id: { $in: productIds }, deletedAt: null, active: true })
  const productMap = new Map(products.map((product) => [product._id.toString(), product]))
  const useWholesalePrice = user.accountType === 'mayorista' && user.approved

  const items = payload.items.map((item) => {
    const product = productMap.get(String(item.product))
    const quantity = Number(item.quantity)

    if (!product) {
      throw new ApiError(404, 'Uno de los productos ya no esta disponible')
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ApiError(400, `Cantidad invalida para ${product.name}`)
    }

    if (product.stock < quantity) {
      throw new ApiError(400, `Stock insuficiente para ${product.name}`)
    }

    const unitPrice = useWholesalePrice ? product.priceWholesale : product.priceRetail

    return {
      product: product._id,
      productName: product.name,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
    }
  })

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
  const shippingCost = subtotal > 100000 ? 0 : 5000

  const order = await Order.create({
    user: user._id,
    items,
    total: subtotal + shippingCost,
    shippingCost,
    paymentMethod: payload.paymentMethod,
    shipping: payload.shipping || {},
    seller: user.assignedSeller || null,
  })

  await Promise.all(
    items.map((item) =>
      Product.updateOne({ _id: item.product }, { $inc: { stock: -item.quantity } })
    )
  )

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
