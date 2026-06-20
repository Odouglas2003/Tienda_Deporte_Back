const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { listOrders, createOrder, updateOrderStatus } = require('../services/orders.service')

const getOrders = asyncHandler(async (req, res) => {
  const filters = { ...req.query }

  if (req.auth.role === 'cliente') {
    filters.user = req.auth.sub
  }

  if (req.auth.role === 'vendedor') {
    filters.seller = req.auth.sub
  }

  const orders = await listOrders(filters)
  res.json(new ApiResponse({ data: orders }))
})

const createOneOrder = asyncHandler(async (req, res) => {
  const order = await createOrder({
    user: req.auth.sub,
    items: req.body.items,
    paymentMethod: req.body.paymentMethod,
  })

  res.status(201).json(new ApiResponse({ message: 'Pedido creado correctamente', data: order }))
})

const updateOneOrderStatus = asyncHandler(async (req, res) => {
  const order = await updateOrderStatus(req.params.orderId, req.body.status, req.auth.sub)
  res.json(new ApiResponse({ message: 'Estado de pedido actualizado', data: order }))
})

module.exports = {
  getOrders,
  createOneOrder,
  updateOneOrderStatus,
}
