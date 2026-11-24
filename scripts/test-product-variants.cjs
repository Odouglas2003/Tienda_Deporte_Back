// Talles y colores cargados desde el panel, y que un talle con precio 0 se cobre al precio general.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { ProductsService } = require('../src-nest/products/products.service')
const { OrdersService } = require('../src-nest/orders/orders.service')

;(async () => {
  let saved
  const products = Object.create(ProductsService.prototype)
  products.prisma = { product: { findUnique: async () => null, create: async ({ data }) => (saved = data) } }
  const base = { name: 'Remera Club', sku: 'REM-CLUB', brand: 'NEZHA', category: 'remeras', priceRetail: 15000, priceWholesale: 11000, stock: 99 }
  await products.create({ ...base, variants: [{ sku: 'REM-CLUB-NEGRO-M', color: 'Negro', size: 'M', stock: 3 }, { sku: 'REM-CLUB-NEGRO-L', color: 'Negro', size: 'L', stock: 2, priceRetail: 16000 }], colors: ['Negro'], sizes: ['M', 'L'] })
  assert.equal(saved.stock, 5, 'el stock total es la suma de los talles')
  assert.equal(saved.variants.length, 2)
  assert.equal(saved.variants[0].priceRetail, undefined, 'sin precio propio usa el general')
  assert.equal(saved.variants[1].priceRetail, 16000)
  await assert.rejects(() => products.create({ ...base, variants: [{ sku: 'A', stock: 1.5 }] }), /entero/)
  await assert.rejects(() => products.create({ ...base, variants: [{ sku: 'A', stock: 1 }, { sku: 'A', stock: 1 }] }), /repetido/)

  // Pedido: el talle quedó con precio 0 (borrador importado) → se cobra el precio general del producto.
  const product = { id: 'p1', name: 'Remera Club', sku: 'REM-CLUB', active: true, deletedAt: null, stock: 3, priceRetail: 12100, priceWholesale: 9000, discount: 0, tax: 0, images: [], updatedAt: new Date(1), variants: [{ sku: 'REM-CLUB-M', size: 'M', stock: 3, priceRetail: 0, priceWholesale: 0 }] }
  const orders = []
  const prisma = {
    user: { findUnique: async () => null },
    product: { findMany: async () => [structuredClone(product)], updateMany: async () => ({ count: 1 }) },
    settings: { findFirst: async () => ({ taxPercentage: 21, minWholesaleOrder: 0, whatsappNumber: '' }) },
    coupon: { findUnique: async () => null },
    checkoutRequest: { findUnique: async () => null },
    order: { create: async ({ data }) => { const order = { ...data, id: 'o1', items: data.items.create }; orders.push(order); return order } },
    orderApprovalEmail: { create: async () => ({}) },
    activityLog: { create: async () => ({}) },
  }
  prisma.$transaction = async (fn) => fn(prisma)
  const service = new OrdersService(prisma, null, { getGeneralRate: async () => ({ rate: 21 }) })
  const { order } = await service.create(null, { customer: { firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' }, items: [{ product: 'p1', quantity: 1, variantSku: 'REM-CLUB-M', selectedSize: 'M' }], paymentMethod: 'cash', shipping: { method: 'pickup', phone: '3511234567' } })
  assert.equal(order.total, 12100, 'nunca se vende a $0')
  // Un producto sin precio (se muestra en la tienda con "$0") no se puede comprar aunque tenga stock.
  product.priceRetail = 0
  await assert.rejects(() => service.create(null, { customer: { firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' }, items: [{ product: 'p1', quantity: 1, variantSku: 'REM-CLUB-M', selectedSize: 'M' }], paymentMethod: 'cash', shipping: { method: 'pickup', phone: '3511234567' } }), /no tiene precio/)
  console.log('talles y colores ok')
})().catch((error) => { console.error(error); process.exitCode = 1 })
