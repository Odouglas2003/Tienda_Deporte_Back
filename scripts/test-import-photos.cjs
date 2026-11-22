const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ProductsService } = require('../dist-nest/products/products.service')

const existing = { id: 'p1', sku: 'A', active: true, deletedAt: null, updatedAt: new Date(), images: ['https://photos.test/edited-front.webp', 'https://photos.test/edited-back.webp'], variants: [{ sku: 'A', stock: 0, image: 'https://photos.test/edited-black.webp' }, { sku: 'B', stock: 0, image: 'https://photos.test/edited-white.webp' }] }
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
    product: { createMany: async ({ data }) => { saved = { ...data[0], id: 'new' }; return { count: data.length } }, create: async ({ data }) => { saved = { ...data, id: 'new' }; return saved }, findMany: async () => product ? [structuredClone(product)] : [], updateMany: async (args) => { if (args.data.active === false) { removed = args.where; return { count: 0 } } return tx.product.updateMany(args) } },
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

const complete = { ...existing, name: 'Remera', description: 'Descripción editada', category: 'indumentaria', categories: ['indumentaria'], subcategory: 'running', brand: 'NEZHA', priceRetail: 100, priceWholesale: 80, tax: 21, stock: 10, tags: ['destacado'], colors: ['Negro', 'Blanco'], sizes: ['S'], variants: existing.variants.map(v => ({ ...v, stock: 5, priceRetail: 100, priceWholesale: 80, size: 'S' })) }
test('preview displays changes but never writes', async () => {
  const f = fixture(complete)
  const result = await f.service.importCatalog([row('A', 'Negro', '')], { dryRun: true })
  assert.equal(f.saved(), undefined)
  assert.equal(result.updatedCount, 1)
  assert.ok(result.plans[0].changes.some(change => change.before === 100 && change.after === 200))
  assert.equal(result.versions.A, complete.updatedAt.toISOString())
})
test('full import keeps blank optional fields and omitted variants', async () => {
  const f = fixture(complete)
  const incoming = row('A', 'Negro', ''); delete incoming.stock
  await f.service.importCatalog([incoming])
  assert.equal(f.saved().description, complete.description)
  assert.equal(f.saved().brand, complete.brand)
  assert.equal(f.saved().subcategory, complete.subcategory)
  assert.deepEqual(f.saved().tags, complete.tags)
  assert.equal(f.saved().tax, 21)
  assert.equal(f.saved().stock, 10)
  assert.equal(f.saved().variants.length, 2)
  assert.equal(f.saved().variants.find(v => v.sku === 'B').stock, 5)
})
test('prices-only import ignores stock and metadata, retaining other variants', async () => {
  const f = fixture(complete)
  const result = await f.service.importCatalog([{ id: 'A', rowNumber: 2, price: '120.50 ARS', price_wholesale: '', stock: 999, title: 'Wrong name', brand: 'Wrong brand' }], { mode: 'prices' })
  assert.equal(result.updatedCount, 1)
  assert.equal(f.saved().stock, 10)
  assert.equal(f.saved().name, 'Remera')
  assert.equal(f.saved().brand, 'NEZHA')
  assert.equal(f.saved().variants.find(v => v.sku === 'A').priceRetail, 120.5)
  assert.equal(f.saved().variants.find(v => v.sku === 'A').priceWholesale, 80)
  assert.equal(f.saved().variants.find(v => v.sku === 'B').priceRetail, 100)
})
test('stock-only import accepts zero and ignores prices and metadata', async () => {
  const f = fixture(complete)
  const result = await f.service.importCatalog([{ id: 'A', rowNumber: 2, stock: 0, price: 1, title: 'Wrong name' }], { mode: 'stock' })
  assert.equal(result.updatedCount, 1)
  assert.equal(f.saved().stock, 5)
  assert.equal(f.saved().variants.find(v => v.sku === 'A').stock, 0)
  assert.equal(f.saved().priceRetail, 100)
  assert.equal(f.saved().name, 'Remera')
})
test('blank selective cells do not change data', async () => {
  const f = fixture(complete)
  const result = await f.service.importCatalog([{ id: 'A', rowNumber: 2, stock: '' }], { mode: 'stock' })
  assert.equal(result.unchangedCount, 1)
  assert.equal(f.saved(), undefined)
})
test('selective import rejects unknown SKUs and does not create products', async () => {
  const f = fixture(null)
  const result = await f.service.importCatalog([{ id: 'NEW', rowNumber: 2, stock: 1 }], { mode: 'stock' })
  assert.equal(result.createdCount, 0)
  assert.equal(result.errorCount, 1)
  assert.equal(f.saved(), undefined)
})
test('duplicate SKUs, fractional stock and changed review versions cannot be saved', async () => {
  const f = fixture(complete)
  await assert.rejects(f.service.importCatalog([row('A', 'Negro', ''), row('A', 'Negro', '')]), /repetidos/)
  const fractional = await f.service.importCatalog([{ id: 'A', stock: 1.5 }], { mode: 'stock' })
  assert.equal(fractional.errorCount, 1)
  const stale = await f.service.importCatalog([{ id: 'A', stock: 1 }], { mode: 'stock', expectedVersions: { A: 'stale' } })
  assert.equal(stale.errorCount, 1)
  assert.equal(f.saved(), undefined)
})
test('full import keeps the category and sport of existing products, but uses the Excel for new ones', async () => {
  const cap = { ...structuredClone(existing), category: 'gorras deportivas', categories: ['gorras deportivas'], subcategory: 'Running, Urbano' }
  const excelRow = (sku) => ({ ...row(sku, 'Negro', ''), category: 'bolsos y mochilas', 'style[0]': 'bolsos y mochilas' })
  const updated = fixture(cap)
  await updated.service.importCatalog([excelRow('A'), excelRow('B')])
  assert.equal(updated.saved().category, 'gorras deportivas')
  assert.deepEqual(updated.saved().categories, ['gorras deportivas'])
  assert.equal(updated.saved().subcategory, 'Running, Urbano')
  assert.equal(updated.saved().priceRetail, 200)
  const created = fixture(null)
  await created.service.importCatalog([{ ...excelRow('NUEVO'), title: 'Mochila Nueva' }])
  assert.equal(created.saved().category, 'bolsos y mochilas')
  assert.equal(created.saved().subcategory, 'bolsos y mochilas')
})
test('draft import links the billing code by barcode and adds only the missing colors, without duplicating the product', async () => {
  const product = { id: 'p9', sku: '7790001', name: 'Remera Basica', brand: 'NEZHA', category: 'remeras', categories: ['remeras'], subcategory: '', active: true, deletedAt: null, updatedAt: new Date(), images: [], priceRetail: 900, priceWholesale: 700, stock: 3, variants: [{ sku: '7790001', color: 'Negro', size: 'S', stock: 3, priceRetail: 900, priceWholesale: 700 }] }
  const f = fixture(product)
  const rows = [
    { rowNumber: 2, id: 'SYS 1/S/1', barcode: '7790001', title: 'Remera Basica', color: 'Negro', size: 'S' },
    { rowNumber: 3, id: 'SYS 1/S/2', barcode: '', title: 'Remera Basica', color: 'Blanco', size: 'S' },
    { rowNumber: 4, id: 'OTRO 5', barcode: '', title: 'Pelota Nueva' },
  ]
  const result = await f.service.importCatalog(rows, { mode: 'full', draft: true, dryRun: true })
  assert.equal(result.errorCount, 0)
  assert.equal(result.createdCount, 1, 'solo la pelota es nueva')
  assert.equal(result.updatedCount, 1)
  const update = result.plans.find((plan) => plan.kind === 'update')
  assert.equal(update.sku, '7790001')
  assert.match(String(update.changes.find((change) => /nuevos/.test(change.field)).after), /Blanco S/)
  assert.equal(update.changes.find((change) => /vinculados/.test(change.field)).after, 1)
})
