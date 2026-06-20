const Product = require('../models/Product')
const Order = require('../models/Order')
const User = require('../models/User')

function formatCompactMonth(date) {
  return new Intl.DateTimeFormat('es-AR', {
    month: 'short',
  })
    .format(date)
    .replace('.', '')
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function formatLabel(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function getPrimarySport(product) {
  return formatLabel(product?.subcategory || product?.categories?.[0] || product?.tags?.[0] || product?.category || 'General')
}

async function getSummary() {
  const [products, orders, users] = await Promise.all([
    Product.find({ deletedAt: null }).lean(),
    Order.find({ deletedAt: null }).populate('user', 'name').populate('seller', 'name').lean(),
    User.find({ deletedAt: null }).lean(),
  ])

  const validOrders = orders.filter((order) => !['rechazado', 'cancelado'].includes(order.status))
  const productMap = new Map(products.map((product) => [product._id.toString(), product]))
  const pendingWholesalers = users
    .filter((user) => user.accountType === 'mayorista' && user.approvalStatus === 'pending')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  const approvedWholesalers = users.filter(
    (user) => user.accountType === 'mayorista' && user.approvalStatus === 'approved' && user.active !== false
  )

  const lowStockProducts = products
    .filter((product) => product.stock <= 10)
    .sort((left, right) => left.stock - right.stock)

  const retailClientCount = users.filter((user) => user.role === 'cliente' && user.accountType === 'minorista').length
  const sellerCount = users.filter((user) => user.role === 'vendedor' && user.active !== false).length
  const ordersToFinalizeCount = orders.filter((order) =>
    ['pendiente', 'en revision', 'aprobado', 'en preparacion'].includes(order.status)
  ).length
  const deliveredOrdersCount = orders.filter((order) => order.status === 'entregado').length
  const totalRevenue = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0)

  const cards = [
    {
      label: 'Mayoristas activos',
      value: String(approvedWholesalers.length),
      helper: `${pendingWholesalers.length} pendientes y ${retailClientCount} clientes minoristas`,
    },
    {
      label: 'Vendedores activos',
      value: String(sellerCount),
      helper: 'Equipo comercial con acceso al panel',
    },
    {
      label: 'Compras por finalizar',
      value: String(ordersToFinalizeCount),
      helper: `${deliveredOrdersCount} ya entregadas sobre ${orders.length} pedidos`,
    },
    {
      label: 'Stock en alerta',
      value: String(lowStockProducts.length),
      helper: `${products.length} productos activos y $ ${totalRevenue.toLocaleString('es-AR')} facturados`,
    },
  ]

  const monthlyRevenue = Array.from({ length: 6 }, (_, index) => {
    const date = new Date()
    date.setMonth(date.getMonth() - (5 - index))
    const monthStart = startOfMonth(date)
    const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)

    const value = validOrders
      .filter((order) => {
        const createdAt = new Date(order.createdAt)
        return createdAt >= monthStart && createdAt < nextMonthStart
      })
      .reduce((sum, order) => sum + Number(order.total || 0), 0)

    return {
      label: formatCompactMonth(monthStart),
      value,
    }
  })

  const topProductsMap = new Map()

  validOrders.forEach((order) => {
    order.items.forEach((item) => {
      const current = topProductsMap.get(item.productName) || 0
      topProductsMap.set(item.productName, current + Number(item.quantity || 0))
    })
  })

  const topProducts = Array.from(topProductsMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)

  const topSportsMap = new Map()

  validOrders.forEach((order) => {
    order.items.forEach((item) => {
      const product = productMap.get(item.product?.toString?.() || String(item.product))
      const sportLabel = getPrimarySport(product)
      const current = topSportsMap.get(sportLabel) || 0
      topSportsMap.set(sportLabel, current + Number(item.quantity || 0))
    })
  })

  const topSports = Array.from(topSportsMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)

  const salesBySellerMap = new Map()

  validOrders.forEach((order) => {
    const label = order.seller?.name || 'Canal directo'
    const current = salesBySellerMap.get(label) || 0
    salesBySellerMap.set(label, current + Number(order.total || 0))
  })

  const salesBySeller = Array.from(salesBySellerMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)

  const activeClientsMap = new Map()

  validOrders.forEach((order) => {
    const label = order.user?.name || 'Cliente'
    const current = activeClientsMap.get(label) || 0
    activeClientsMap.set(label, current + 1)
  })

  const activeClients = Array.from(activeClientsMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)

  const recentOrders = orders
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 6)
    .map((order) => ({
      id: order.code,
      customer: order.user?.name || 'Cliente',
      total: Number(order.total || 0),
      status: order.status,
      createdAt: order.createdAt,
    }))

  return {
    cards,
    overview: {
      wholesaleClientsCount: approvedWholesalers.length,
      pendingWholesalersCount: pendingWholesalers.length,
      sellersCount: sellerCount,
      ordersToFinalizeCount,
      deliveredOrdersCount,
      lowStockCount: lowStockProducts.length,
      activeProductsCount: products.length,
      totalOrdersCount: orders.length,
    },
    monthlyRevenue,
    topProducts,
    topSports,
    lowStockProducts: lowStockProducts.slice(0, 5).map((product) => ({
      label: product.name,
      value: Number(product.stock || 0),
    })),
    salesBySeller,
    activeClients,
    recentOrders,
    pendingWholesalers: pendingWholesalers.slice(0, 5).map((user) => ({
      id: user._id.toString(),
      name: user.name,
      businessName: user.businessName || '',
      cuit: user.cuit || '',
      createdAt: user.createdAt,
    })),
  }
}

module.exports = {
  getSummary,
}
