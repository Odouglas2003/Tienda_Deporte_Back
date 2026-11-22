// Reservas: se crean sin descontar stock, descuentan al pasar a "En preparación" y no reponen al cancelar.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { OrdersService } = require('../src-nest/orders/orders.service')

const clone = (value) => JSON.parse(JSON.stringify(value))

function fixture(initialStock) {
  let seq = 1
  const product = { id: 'p1', name: 'Pelota', sku: 'PEL', stock: initialStock, priceRetail: 12100, priceWholesale: 8000, discount: 0, tax: 0, images: ['/p.jpg'], deletedAt: null, updatedAt: new Date(seq), variants: [{ sku: 'PEL-5', size: '5', stock: initialStock, priceRetail: 12100, priceWholesale: 8000 }] }
  const orders = []
  const emails = []
  const admin = { id: 'admin', role: 'admin', active: true, deletedAt: null }
  const prisma = {
    product: {
      findFirst: async ({ where }) => (where.id === product.id ? clone(product) : null),
      findUnique: async ({ where }) => (where.id === product.id ? { ...clone(product), updatedAt: product.updatedAt } : null),
      updateMany: async ({ where, data }) => {
        if (where.stock !== product.stock || where.updatedAt.getTime() !== product.updatedAt.getTime()) return { count: 0 }
        if (data.stock?.decrement) product.stock -= data.stock.decrement
        if (data.stock?.increment) product.stock += data.stock.increment
        product.variants = clone(data.variants)
        product.updatedAt = new Date(++seq)
        return { count: 1 }
      },
    },
    user: {
      findUnique: async ({ where }) => (where.id === 'admin' ? admin : null),
      findMany: async () => [{ id: 'w1', name: 'Juan Club', businessName: 'Club Norte', email: 'club@example.com', cuit: '20-12345678-9', phone: '3519998888', accountType: 'mayorista', approved: true, active: true, deletedAt: null, assignedSellerId: 's1' }],
    },
    settings: { findFirst: async () => ({ taxPercentage: 21 }) },
    order: {
      create: async ({ data }) => { const order = { ...data, id: 'o' + orders.length, items: data.items.create.map((item, index) => ({ ...item, id: 'i' + index })), deletedAt: null }; orders.push(order); return order },
      findUnique: async ({ where }) => orders.find((order) => order.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }) => orders.find((order) => order.id === where.id),
      updateMany: async ({ where, data }) => { const order = orders.find((item) => item.id === where.id && item.status === where.status); if (!order) return { count: 0 }; order.status = data.status; return { count: 1 } },
    },
    orderApprovalEmail: {
      create: async ({ data }) => { emails.push(data.kind); return data },
      upsert: async ({ create }) => { emails.push(create.kind); return create },
      updateMany: async () => ({ count: 0 }),
    },
    activityLog: { create: async () => ({}) },
  }
  prisma.$transaction = async (fn) => {
    const before = clone(product)
    const beforeUpdated = product.updatedAt
    const beforeOrders = clone(orders)
    try { return await fn(prisma) } catch (error) {
      Object.assign(product, before, { updatedAt: beforeUpdated })
      orders.splice(0, orders.length, ...beforeOrders)
      throw error
    }
  }
  const service = new OrdersService(prisma, null, { getGeneralRate: async () => ({ rate: 21 }) })
  return { service, product, orders, emails }
}

async function main() {
  // 1. Se reserva sin stock: no se toca el stock y se manda el mail de reserva.
  let f = fixture(0)
  const order = await f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 2, customerName: 'Ana Gómez', customerEmail: 'ana@example.com', customerPhone: '3511234567' }, 'admin')
  assert.equal(order.status, 'reservado')
  assert.equal(order.total, 24200)
  assert.equal(f.product.stock, 0)
  assert.deepEqual(f.emails, ['reserved'])

  // 2. Si se pasa a "En preparación" sin haber cargado el stock, avisa y no cambia nada.
  await assert.rejects(() => f.service.updateStatus(order.id, 'en preparacion', 'admin'), /Todavía no hay stock/)
  assert.equal(f.orders[0].status, 'reservado')

  // 3. Llega la mercadería (se cargan 5): al pasar a "En preparación" descuenta 2 y avisa que llegó.
  f.product.stock = 5
  f.product.variants[0].stock = 5
  await f.service.updateStatus(order.id, 'en preparacion', 'admin')
  assert.equal(f.orders[0].status, 'en_preparacion')
  assert.equal(f.product.stock, 3)
  assert.equal(f.product.variants[0].stock, 3)
  assert.deepEqual(f.emails, ['reserved', 'arrived'])

  // 4. Cancelar una reserva no repone stock (nunca lo había descontado).
  f = fixture(4)
  const second = await f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 1, customerName: 'Juan Pérez', customerEmail: 'juan@example.com' }, 'admin')
  await f.service.updateStatus(second.id, 'cancelado', 'admin')
  assert.equal(f.product.stock, 4)

  // 5. Una reserva no puede saltar a otros estados ni crearse cambiando el estado de un pedido.
  f = fixture(0)
  const third = await f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 1, customerName: 'Luz Díaz', customerEmail: 'luz@example.com' }, 'admin')
  await assert.rejects(() => f.service.updateStatus(third.id, 'enviado', 'admin'), /Una reserva pasa/)
  await assert.rejects(() => f.service.createReservation({ productId: 'p1', quantity: 1, customerName: 'X Y', customerEmail: 'x@example.com' }, 'admin'), /Elegí el talle/)
  await assert.rejects(() => f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 1, customerName: 'X Y', customerEmail: 'no-es-mail' }, 'admin'), /email válido/)

  // 6. Mayorista por CUIT: queda en su cuenta, con su email y precio mayorista (8000 + IVA 21%).
  f = fixture(0)
  const wholesale = await f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 1, buyerType: 'mayorista', cuit: '20123456789' }, 'admin')
  assert.equal(wholesale.userId, 'w1')
  assert.equal(wholesale.customerEmail, 'club@example.com')
  assert.equal(wholesale.customerName, 'Club Norte')
  assert.equal(wholesale.sellerId, 's1')
  assert.equal(wholesale.total, 9680)
  await assert.rejects(() => f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 1, buyerType: 'mayorista', cuit: '20999999999' }, 'admin'), /Ningún mayorista|ningún mayorista/i)
  await assert.rejects(() => f.service.createReservation({ productId: 'p1', variantSku: 'PEL-5', quantity: 1, buyerType: 'mayorista', cuit: '123' }, 'admin'), /11 números/)

  console.log('reservas ok')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
