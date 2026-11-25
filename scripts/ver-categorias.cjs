// Solo lectura: lista las categorías y cuántos productos usan cada una.
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
;(async () => {
  const cats = await prisma.category.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } })
  const products = await prisma.product.findMany({ where: { deletedAt: null }, select: { category: true, categories: true, subcategory: true, name: true } })
  const main = {}, any = {}, subs = {}, samples = {}
  for (const p of products) {
    main[p.category] = (main[p.category] || 0) + 1
    for (const c of new Set([p.category, ...p.categories])) { any[c] = (any[c] || 0) + 1; (samples[c] ||= []).length < 3 && samples[c].push(p.name) }
    subs[p.subcategory] = (subs[p.subcategory] || 0) + 1
  }
  console.log('PRODUCTOS', products.length)
  console.log('\nCATEGORIAS ABM:', cats.map(c => `${c.name}${c.active ? '' : ' (inactiva)'}`).join(' | '))
  console.log('\nUSO (principal / en cualquier lugar) + ejemplos:')
  for (const [c, n] of Object.entries(any).sort((a, b) => b[1] - a[1])) console.log(`${c} :: ${main[c] || 0} / ${n} :: ${samples[c].join(' ; ')}`)
  console.log('\nSUBCATEGORIAS:', Object.entries(subs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || '(vacía)'}=${v}`).join(' | '))
  await prisma.$disconnect()
})()
