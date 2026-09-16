const Order = require('../models/Order')
const mongoose = require('mongoose')
const User = require('../models/User')
const Product = require('../models/Product')
const Settings = require('../models/Settings')
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
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new ApiError(400, 'El pedido debe tener al menos un producto')
  }

  const session = await mongoose.startSession()
  let order

  try {
    await session.withTransaction(async () => {
      const user = await User.findById(payload.user).session(session)
      if (!user) {
        throw new ApiError(404, 'Usuario no encontrado')
      }

      const productIds = payload.items.map((item) => item.product)
      const products = await Product.find({ _id: { $in: productIds }, deletedAt: null, active: true }).session(session)
      const productMap = new Map(products.map((product) => [product._id.toString(), product]))
      const useWholesalePrice = user.accountType === 'mayorista' && user.approved

      const items = payload.items.map((item) => {
        const product = productMap.get(String(item.product))
        const quantity = Number(item.quantity)
        const variantSku = String(item.variantSku || product?.sku || '')
        const variant = product?.variants?.find((candidate) => candidate.sku === variantSku)

        if (!product) {
          throw new ApiError(404, 'Uno de los productos ya no esta disponible')
        }
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new ApiError(400, `Cantidad invalida para ${product.name}`)
        }
        if (product.variants?.length > 0 && !variant) {
          throw new ApiError(400, `La variante ${variantSku} de ${product.name} ya no esta disponible`)
        }
        if ((variant ? variant.stock : product.stock) < quantity) {
          throw new ApiError(400, `Stock insuficiente para ${product.name}${variant ? ` (${variantSku})` : ''}`)
        }

        const basePrice = useWholesalePrice
          ? (variant?.priceWholesale ?? product.priceWholesale)
          : (variant?.priceRetail ?? product.priceRetail)
        const discount = useWholesalePrice ? 0 : Math.min(100, Math.max(0, Number(product.discount) || 0))
        const unitPrice = Math.round(basePrice * (1 - discount / 100) * 100) / 100

        return {
          product: product._id,
          productName: product.name,
          variantSku,
          selectedColor: item.selectedColor || variant?.color || '',
          selectedSize: item.selectedSize || variant?.size || '',
          selectedGender: item.selectedGender || variant?.gender || '',
          quantity,
          unitPrice,
          subtotal: unitPrice * quantity,
        }
      })

      // La actualización es condicional y usa el SKU: cada variante pierde solo su propia cantidad.
      for (const item of items) {
        const product = productMap.get(item.product.toString())
        const hasVariants = product.variants?.length > 0
        const filter = hasVariants
          ? { _id: item.product, stock: { $gte: item.quantity }, variants: { $elemMatch: { sku: item.variantSku, stock: { $gte: item.quantity } } } }
          : { _id: item.product, stock: { $gte: item.quantity } }
        const update = hasVariants
          ? { $inc: { stock: -item.quantity, 'variants.$.stock': -item.quantity } }
          : { $inc: { stock: -item.quantity } }
        const result = await Product.updateOne(filter, update, { session })
        if (result.modifiedCount !== 1) {
          throw new ApiError(400, `Stock insuficiente para ${item.productName}${hasVariants ? ` (${item.variantSku})` : ''}`)
        }
      }

      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
      const settings = await Settings.findOne().session(session)
      const generalRate = Number(settings?.taxPercentage) > 0 ? Number(settings.taxPercentage) : 21
      const taxAmount = items.reduce((sum, item) => {
        const rate = Number(productMap.get(item.product.toString())?.tax)
        return sum + Math.round(item.subtotal * (rate > 0 ? rate : generalRate)) / 100
      }, 0)
      ;[order] = await Order.create([{
        user: user._id,
        items,
        total: subtotal + taxAmount,
        shippingCost: 0,
        taxAmount,
        paymentMethod: payload.paymentMethod,
        shipping: payload.shipping || {},
        seller: user.assignedSeller || null,
      }], { session })

      await createLog({
        user: payload.user,
        action: 'Creacion de pedido',
        entity: 'order',
        metadata: { orderId: order._id.toString() },
      })
    })
  } finally {
    await session.endSession()
  }

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
