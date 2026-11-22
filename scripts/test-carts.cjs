// Carritos guardados: se limpian los datos, un carrito vacío se borra y el panel ve solo los viejos.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { CartsService } = require('../src-nest/carts/carts.service')

;(async () => {
  const calls = []
  const service = new CartsService({ savedCart: {
    upsert: async (args) => { calls.push(['upsert', args]); return {} },
    deleteMany: async (args) => { calls.push(['delete', args]); return { count: 1 } },
    findMany: async (args) => { calls.push(['find', args]); return [] },
  } })
  await service.save('u1', [{ productId: 'p1', name: 'Remera', variantSku: 'R-M', size: 'M', quantity: 2.7, price: 1000, hack: 'x' }, { productId: '', name: 'sin id' }])
  const [, upsert] = calls.pop()
  assert.equal(upsert.create.itemCount, 2)
  assert.equal(upsert.create.total, 2000)
  assert.deepEqual(Object.keys(upsert.create.items[0]).sort(), ['color', 'name', 'price', 'productId', 'quantity', 'size', 'variantSku'])
  await service.save('u1', [])
  assert.equal(calls.pop()[0], 'delete', 'un carrito vacío se borra')
  await assert.rejects(() => service.save('u1', 'nada'), /inválido/)
  await service.abandoned(30, true)
  const [, find] = calls.pop()
  assert.equal(find.where.user.accountType, 'mayorista')
  assert.ok(find.where.updatedAt.lt < new Date(Date.now() - 29 * 60000), 'solo carritos de hace más de 30 minutos')
  console.log('carritos ok')
})().catch((error) => { console.error(error); process.exitCode = 1 })
