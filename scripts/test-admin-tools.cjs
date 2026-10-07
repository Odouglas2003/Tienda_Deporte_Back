const { test } = require('node:test')
const assert = require('node:assert/strict')
const { OrdersService } = require('../dist-nest/orders/orders.service')
const { ProductsService } = require('../dist-nest/products/products.service')
const { assertCoupon, CouponsService } = require('../dist-nest/coupons/coupons.service')

const date = new Date('2026-10-07T12:00:00Z')
const product = { id: 'p1', name: 'Remera', sku: 'R1', priceRetail: 100, priceWholesale: 80, tax: 21, discount: 0, stock: 10, variants: [], images: [], active: true, deletedAt: null, updatedAt: date }
const coupon = { id: 'c1', code: 'NEZHA10', percent: 10, minSubtotal: 50, maxUses: 1, usedCount: 0, active: true, expiresAt: new Date(Date.now() + 86400000), updatedAt: date }
const payload = { customer: { firstName: 'Prueba', lastName: 'Local', email: 'test@example.com' }, items: [{ product: 'p1', quantity: 2 }], paymentMethod: 'transfer', shipping: { address: 'Prueba', city: 'Prueba', postalCode: '1000', phone: '000000' }, couponCode: 'nezha10', expectedTotal: 217.8 }

function fixture(options = {}) {
  const state = { product: structuredClone({ ...product, ...options.product }), coupon: structuredClone({ ...coupon, ...options.coupon }), orders: [] }
  const prisma = {
    user: { findUnique: async () => options.user || null },
    product: { findMany: async () => [structuredClone(state.product)] },
    settings: { findFirst: async () => ({ minWholesaleOrder: options.minWholesaleOrder || 0, taxPercentage: 21 }) },
    coupon: { findUnique: async ({ where }) => where.code === state.coupon.code ? structuredClone(state.coupon) : null },
    checkoutRequest: { findUnique: async () => null },
    $transaction: async (callback) => {
      const working = structuredClone(state)
      const tx = {
        coupon: { updateMany: async ({ where }) => {
          if (options.failCouponClaim || working.coupon.usedCount >= where.usedCount.lt || !working.coupon.active || working.coupon.expiresAt <= new Date()) return { count: 0 }
          working.coupon.usedCount++; return { count: 1 }
        } },
        product: {
          findFirst: async () => structuredClone(working.product),
          updateMany: async ({ where, data }) => {
            if (options.failStock || where.updatedAt.getTime() !== working.product.updatedAt.getTime()) return { count: 0 }
            working.product = { ...working.product, ...data, stock: typeof data.stock === 'object' ? working.product.stock - data.stock.decrement : data.stock ?? working.product.stock }
            return { count: 1 }
          },
        },
        order: { create: async ({ data }) => { const order = { ...data, id: 'o1', items: data.items.create }; working.orders.push(order); return order } },
        activityLog: { create: async () => ({}) },
      }
      const result = await callback(tx)
      Object.assign(state, working)
      return result
    },
  }
  return { state, prisma, orders: new OrdersService(prisma, {}, { getGeneralRate: async () => ({ rate: 21 }) }), products: new ProductsService(prisma) }
}

test('coupon discounts the base and then calculates VAT; stored totals reconcile', async () => {
  const f = fixture()
  const result = await f.orders.create(null, payload)
  assert.equal(result.order.discountAmount, 20)
  assert.equal(result.order.taxAmount, 37.8)
  assert.equal(result.order.total, 217.8)
  assert.equal(result.order.couponCode, 'NEZHA10')
  assert.equal(f.state.product.stock, 8)
  assert.equal(f.state.coupon.usedCount, 1)
})
test('last coupon usage rejects the next purchase and preserves stock', async () => {
  const f = fixture()
  await f.orders.create(null, payload)
  await assert.rejects(f.orders.create(null, payload), /cupón/)
  assert.equal(f.state.product.stock, 8)
  assert.equal(f.state.orders.length, 1)
})
test('a coupon exhausted between quote and claim creates no order', async () => {
  const f = fixture({ failCouponClaim: true })
  await assert.rejects(f.orders.create(null, payload), /cupón/)
  assert.equal(f.state.orders.length, 0)
  assert.equal(f.state.product.stock, 10)
})
test('stock conflict rolls back coupon redemption and the order', async () => {
  const f = fixture({ failStock: true })
  await assert.rejects(f.orders.create(null, payload), /stock/)
  assert.equal(f.state.coupon.usedCount, 0)
  assert.equal(f.state.orders.length, 0)
})
test('invalid, paused, expired, exhausted, and below-minimum coupons fail', () => {
  for (const c of [null, { ...coupon, active: false }, { ...coupon, expiresAt: new Date(0) }, { ...coupon, usedCount: 1 }]) assert.throws(() => assertCoupon(c, 200), /cupón/)
  assert.throws(() => assertCoupon(coupon, 49.99), /mínima/)
  assert.throws(() => assertCoupon(coupon, NaN), /mínima/)
})
test('altered expected amount is rejected before redeeming coupon', async () => {
  const f = fixture()
  await assert.rejects(f.orders.create(null, { ...payload, expectedTotal: 1 }), /importe/)
  assert.equal(f.state.coupon.usedCount, 0)
})
test('wholesaler minimum still applies before coupon and uses wholesale prices', async () => {
  const user = { id: 'u1', active: true, name: 'Mayorista', email: 'test@example.com', accountType: 'mayorista', approved: true }
  const f = fixture({ user, minWholesaleOrder: 200 })
  await assert.rejects(f.orders.create({ sub: 'u1' }, payload), /mayorista mínimo/)
  const valid = fixture({ user })
  const result = await valid.orders.create({ sub: 'u1' }, { ...payload, expectedTotal: 174.24 })
  assert.equal(result.order.total, 174.24)
})
test('coupon creation rejects bad percentages, limits, dates and codes', () => {
  const service = new CouponsService({})
  const valid = { code: 'NEZHA10', percent: 10, minSubtotal: 0, maxUses: 100, expiresAt: new Date(Date.now() + 86400000).toISOString() }
  for (const change of [{ percent: 101 }, { percent: NaN }, { maxUses: 0 }, { maxUses: 2.5 }, { minSubtotal: -1 }, { code: '<script>' }, { expiresAt: 'bad' }, { expiresAt: new Date(0).toISOString() }]) assert.throws(() => service.create({ ...valid, ...change }), /Revisá/)
})
test('bulk variant stock recomputes total and price updates every variant', async () => {
  const f = fixture({ product: { variants: [{ sku: 'S', stock: 5, priceRetail: 100 }, { sku: 'M', stock: 5, priceRetail: 120 }] } })
  await f.products.bulk([{ id: 'p1', updatedAt: date.toISOString(), priceRetail: 150, variants: [{ sku: 'S', stock: 2 }] }])
  assert.equal(f.state.product.stock, 7)
  assert.deepEqual(f.state.product.variants.map(v => v.priceRetail), [150, 150])
})
test('bulk rejects decimals, invalid variants, duplicate products and stale edits', async () => {
  for (const row of [{ stock: -1 }, { stock: 1.5 }, { priceRetail: NaN }, { updatedAt: new Date(0).toISOString() }, { variants: [{ sku: 'missing', stock: 1 }] }]) {
    const f = fixture()
    await assert.rejects(f.products.bulk([{ id: 'p1', updatedAt: date.toISOString(), ...row }]))
    assert.equal(f.state.product.stock, 10)
  }
  const f = fixture()
  await assert.rejects(f.products.bulk([{ id: 'p1' }, { id: 'p1' }]), /diferentes/)
})

test('checkout and backend agree on cents for a coupon and a small line', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const ts = require('typescript')
  function loadTs(relative, imports = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../../tienda_front', relative), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', js)(name => imports[name] || require(name), module, module.exports)
    return module.exports
  }
  const pricing = loadTs('utils/productPricing.ts')
  const { calculateCartTax } = loadTs('utils/tax.ts', { '@/utils/productPricing': pricing })
  const f = fixture({ product: { priceRetail: 0.03 }, coupon: { percent: 33.33, minSubtotal: 0 } })
  const result = await f.orders.create(null, { ...payload, items: [{ product: 'p1', quantity: 1 }], expectedTotal: 0.02 })
  const frontendTax = calculateCartTax([{ product: f.state.product, quantity: 1 }], false, 21, 33.33)
  assert.equal(frontendTax, result.order.taxAmount)
  assert.equal(result.order.discountAmount, 0.01)
  assert.equal(result.order.total, 0.02)
})
