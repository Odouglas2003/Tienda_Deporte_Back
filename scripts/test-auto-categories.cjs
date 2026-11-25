// Clasificador de los 8 tipos de producto + "Ordenar categorías" y "Mover productos" del panel.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { classifyProduct, isNotAProduct } = require('../src-nest/products/product-types')
const { ProductsService } = require('../src-nest/products/products.service')

const cases = {
  'ZAPATILLAS SKECHERS GLIDE STEP': 'Calzado',
  'SKECHERS GO RUN ELEVATE (MARINO; 39)': 'Calzado',
  'MEDIAS DE FUTBOL ADULTO': 'Accesorios',
  'GUANTE BOX FORZA 12 OZ': 'Guantes',
  'Canilleras FAF TOP': 'Protecciones',
  'Lente Argentino Sr 1530': 'Gorras y accesorios de cabeza',
  'MOCHILA URBANA REEBOK': 'Bolsos y mochilas',
  'Basket Nº7 MOLTEN B7G3200': 'Equipamiento',
  'VARLION LW CARBON 2025': 'Equipamiento',
  'REMERA DRY FIT DAMA': 'Indumentaria',
  'Muñequera Enebe': 'Protecciones',
}
for (const [name, expected] of Object.entries(cases)) assert.equal(classifyProduct(name).category, expected, name)
assert.equal(classifyProduct('PRODUCTO RARO XYZ', ['zapatillas']).category, 'Calzado')
assert.ok(isNotAProduct('Flete'))
assert.ok(isNotAProduct('Descuento 30%'))
assert.ok(!isNotAProduct('Tarjeta de Arbitro'))

const products = [
  { id: 'a', name: 'ZAPATILLAS FILA', category: 'sin-categoria', categories: ['sin-categoria'], active: true },
  { id: 'b', name: 'REMERA BASICA', category: 'Indumentaria', categories: ['Indumentaria'], active: true },
  { id: 'c', name: 'Flete', category: 'sin-categoria', categories: [], active: true },
  { id: 'd', name: 'PELOTA FUTBOL N5', category: 'Running', categories: ['Running'], active: true },
]
const calls = []
const prisma = {
  product: {
    findMany: async () => products,
    updateMany: async (args) => { calls.push(['product', args]); return { count: args.where.id.in.length } },
  },
  category: {
    findMany: async () => [{ name: 'Indumentaria' }, { name: 'Calzado' }],
    findFirst: async ({ where }) => (where.normalizedName === 'calzado' ? { name: 'Calzado' } : null),
    upsert: async (args) => { calls.push(['category', args]); return {} },
  },
  activityLog: { create: async () => ({}) },
}
prisma.$transaction = async (fn) => fn(prisma)
const service = new ProductsService(prisma)

;(async () => {
  // Vista previa: solo los que no tienen categoría válida (a, c, d). c no es producto.
  const preview = await service.autoCategorize({})
  assert.equal(preview.reviewed, 3)
  assert.equal(preview.changes, 2)
  assert.equal(preview.counts.Calzado, 1)
  assert.equal(preview.counts.Equipamiento, 1)
  assert.deepEqual(preview.notProducts.map((item) => item.id), ['c'])
  assert.equal(calls.length, 0, 'la vista previa no cambia nada')

  // Aplicar y ocultar el flete.
  const applied = await service.autoCategorize({ apply: true, hideNotProducts: true })
  assert.equal(applied.applied, true)
  assert.ok(calls.some(([kind, args]) => kind === 'category' && args.create.name === 'Equipamiento'), 'crea la categoría que falta')
  assert.ok(calls.some(([kind, args]) => kind === 'product' && args.data.category === 'Calzado' && args.where.id.in.includes('a')))
  assert.ok(calls.some(([kind, args]) => kind === 'product' && args.data.active === false && args.where.id.in.includes('c')))

  // Revisar todos: la remera ya está bien, no se toca.
  const all = await service.autoCategorize({ scope: 'todos' })
  assert.equal(all.reviewed, 4)
  assert.ok(!Object.values(all.examples).flat().includes('REMERA BASICA'))

  // Mover productos a mano.
  calls.length = 0
  const moved = await service.setCategory({ ids: ['a', 'b'], category: 'calzado' })
  assert.equal(moved.category, 'Calzado')
  assert.deepEqual(calls[0][1].data, { category: 'Calzado', categories: ['Calzado'] })
  await assert.rejects(() => service.setCategory({ ids: ['a'], category: 'Inventada' }), /no existe/)
  await assert.rejects(() => service.setCategory({ ids: [], category: 'Calzado' }), /Elegí/)
  console.log('categorías automáticas ok')
})().catch((error) => { console.error(error); process.exitCode = 1 })
