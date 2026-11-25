// Visibilidad del catálogo: ocultos y precio mayorista. El rol se lee de la base, no del token.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { ProductsController } = require('../src-nest/products/products.controller')

const hidden = { id: 'p1', name: 'Remera borrador', brand: 'Sin marca', active: false, deletedAt: null, priceRetail: 0, priceWholesale: 0, variants: [] }
const visible = { ...hidden, id: 'p2', name: 'Remera publicada', active: true, priceRetail: 1000, priceWholesale: 600, variants: [{ sku: 'v', priceWholesale: 500 }] }
const products = { get: async (id) => (id === 'p1' ? hidden : visible), list: async () => [hidden, visible] }

const now = Math.floor(Date.now() / 1000)
const users = {
  admin: { role: 'admin', accountType: 'minorista', approved: true, active: true, deletedAt: null, sessionsValidFrom: null },
  cliente: { role: 'cliente', accountType: 'minorista', approved: true, active: true, deletedAt: null, sessionsValidFrom: null },
  mayorista: { role: 'cliente', accountType: 'mayorista', approved: true, active: true, deletedAt: null, sessionsValidFrom: null },
  // Vendedor dado de baja: su token sigue firmado como "vendedor", pero la base dice que no está activo.
  exvendedor: { role: 'vendedor', accountType: 'minorista', approved: true, active: false, deletedAt: null, sessionsValidFrom: null },
  // Admin que cambió la clave después de abrir esta sesión (ej. celular perdido).
  adminviejo: { role: 'admin', accountType: 'minorista', approved: true, active: true, deletedAt: null, sessionsValidFrom: new Date((now + 3600) * 1000) },
}
const tokenRole = { admin: 'admin', cliente: 'cliente', mayorista: 'cliente', exvendedor: 'vendedor', adminviejo: 'admin' }
const jwt = { verifyAsync: async (token) => (users[token] ? { sub: token, role: tokenRole[token], iat: now } : Promise.reject(new Error('token'))) }
const prisma = { user: { findUnique: async ({ where }) => users[where.id] ?? null } }
const controller = new ProductsController(products, jwt, prisma)
const as = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} })
const ids = (list) => list.map((product) => product.id)

;(async () => {
  // Link directo a un oculto
  await assert.rejects(() => controller.get(as(), 'p1'), /no encontrado/i)
  await assert.rejects(() => controller.get(as('cliente'), 'p1'), /no encontrado/i)
  await assert.rejects(() => controller.get(as('mayorista'), 'p1'), /no encontrado/i)
  await assert.rejects(() => controller.get(as('exvendedor'), 'p1'), /no encontrado/i)
  await assert.rejects(() => controller.get(as('adminviejo'), 'p1'), /no encontrado/i)
  assert.equal((await controller.get(as('admin'), 'p1')).id, 'p1')

  // Lista: los ocultos solo para el equipo (antes los mayoristas también los recibían)
  assert.deepEqual(ids(await controller.list(as(), {})), ['p2'])
  assert.deepEqual(ids(await controller.list(as('mayorista'), {})), ['p2'])
  assert.deepEqual(ids(await controller.list(as('exvendedor'), {})), ['p2'])
  assert.deepEqual(ids(await controller.list(as('admin'), {})), ['p1', 'p2'])

  // Precio mayorista: mayorista aprobado y equipo activo, nadie más
  assert.equal((await controller.get(as(), 'p2')).priceWholesale, undefined)
  assert.equal((await controller.get(as('cliente'), 'p2')).priceWholesale, undefined)
  assert.equal((await controller.get(as('exvendedor'), 'p2')).priceWholesale, undefined)
  assert.equal((await controller.get(as('adminviejo'), 'p2')).variants[0].priceWholesale, undefined)
  assert.equal((await controller.get(as('mayorista'), 'p2')).priceWholesale, 600)
  assert.equal((await controller.get(as('admin'), 'p2')).priceWholesale, 600)
  console.log('visibilidad de productos ok')
})().catch((error) => { console.error(error); process.exitCode = 1 })
