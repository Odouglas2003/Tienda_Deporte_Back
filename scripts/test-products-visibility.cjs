// Un producto oculto no se puede ver con el link directo; el admin sí lo ve.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { ProductsController } = require('../src-nest/products/products.controller')

const hidden = { id: 'p1', name: 'Remera borrador', brand: 'Sin marca', active: false, deletedAt: null, priceRetail: 0, priceWholesale: 0, variants: [] }
const visible = { ...hidden, id: 'p2', name: 'Remera publicada', active: true, priceRetail: 1000 }
const products = { get: async (id) => (id === 'p1' ? hidden : visible) }
const jwt = { verifyAsync: async (token) => ({ admin: { role: 'admin' }, cliente: { role: 'cliente' } }[token] ?? Promise.reject(new Error('token'))) }
const controller = new ProductsController(products, jwt)
const as = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} })

;(async () => {
  await assert.rejects(() => controller.get(as(), 'p1'), /no encontrado/i)
  await assert.rejects(() => controller.get(as('cliente'), 'p1'), /no encontrado/i)
  assert.equal((await controller.get(as('admin'), 'p1')).id, 'p1')
  assert.equal((await controller.get(as(), 'p2')).id, 'p2')
  console.log('visibilidad de productos ok')
})().catch((error) => { console.error(error); process.exitCode = 1 })
