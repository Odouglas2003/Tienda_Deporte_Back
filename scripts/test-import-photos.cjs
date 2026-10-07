const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ProductsService } = require('../dist-nest/products/products.service')

const existing = { id: 'p1', sku: 'A', active: true, deletedAt: null, updatedAt: new Date(), images: ['https://photos.test/edited-front.webp', 'https://photos.test/edited-back.webp'], variants: [{ sku: 'A', image: 'https://photos.test/edited-black.webp' }, { sku: 'B', image: 'https://photos.test/edited-white.webp' }] }
const row = (sku, color, image) => ({ id: sku, title: `Remera ${color} S`, category: 'indumentaria', price_retail: 200, price_wholesale: 150, stock: 12, image_link: image })
function fixture(product, conflict = false) {
  let saved
  let removed
  const tx = { product: {
    create: async ({ data }) => { saved = { ...data, id: 'new' }; return saved },
    updateMany: async ({ data, where }) => {
      assert.equal(where.id, product.id)
      assert.deepEqual(where.updatedAt, product.updatedAt)
      if (conflict) return { count: 0 }
      assert.equal(Object.hasOwn(data, 'images'), false)
      saved = { ...product, ...data }; return { count: 1 }
    },
  } }
  const service = new ProductsService({
    product: { findMany: async () => product ? [structuredClone(product)] : [], updateMany: async ({ where }) => { removed = where; return { count: 0 } } },
    $transaction: async callback => callback(tx),
  })
  return { service, saved: () => saved, removed: () => removed }
}
test('reimport preserves the full gallery and variant photos while updating prices and stock', async () => {
  const f = fixture(existing)
  const result = await f.service.importCatalog([row('A', 'Negro', 'https://excel.test/old.webp'), row('B', 'Blanco', '')])
  assert.equal(result.updatedCount, 1)
  assert.deepEqual(f.saved().images, existing.images)
  assert.deepEqual(f.saved().variants.map(v => v.image), existing.variants.map(v => v.image))
  assert.equal(f.saved().priceRetail, 200)
  assert.equal(f.saved().stock, 24)
})
test('reordered variants keep the existing parent SKU and photos', async () => {
  const f = fixture(existing)
  const result = await f.service.importCatalog([row('B', 'Blanco', 'https://excel.test/old.webp'), row('A', 'Negro', 'https://excel.test/old.webp')])
  assert.equal(result.createdCount, 0)
  assert.equal(result.updatedCount, 1)
  assert.equal(f.saved().sku, 'A')
  assert.equal(f.saved().variants.find(v => v.sku === 'B').image, existing.variants[1].image)
  assert.deepEqual(f.saved().images, existing.images)
})
test('a new product uses Excel photos', async () => {
  const f = fixture(null)
  const result = await f.service.importCatalog([row('NEW', 'Negro', 'https://excel.test/new.webp')])
  assert.equal(result.createdCount, 1)
  assert.deepEqual(f.saved().images, ['https://excel.test/new.webp'])
})
test('an existing product with no photo does not receive old Excel photos', async () => {
  const f = fixture({ ...existing, images: [], variants: [{ sku: 'A', image: '' }] })
  await f.service.importCatalog([row('A', 'Negro', 'https://excel.test/old.webp')])
  assert.deepEqual(f.saved().images, [])
  assert.equal(f.saved().variants[0].image, '')
})
test('new variant of an existing product uses its current gallery, not Excel photos', async () => {
  const f = fixture(existing)
  await f.service.importCatalog([row('A', 'Negro', 'https://excel.test/old.webp'), row('C', 'Rojo', 'https://excel.test/old.webp')])
  assert.equal(f.saved().variants.find(v => v.sku === 'C').image, existing.images[0])
})
test('concurrent product edit skips the import instead of overwriting variant photos', async () => {
  const f = fixture(existing, true)
  const result = await f.service.importCatalog([row('A', 'Negro', 'https://excel.test/old.webp')])
  assert.equal(result.errorCount, 1)
  assert.equal(result.updatedCount, 0)
  assert.equal(f.saved(), undefined)
})
