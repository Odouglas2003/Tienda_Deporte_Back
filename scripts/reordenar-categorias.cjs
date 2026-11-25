// Reordena las categorías en 8 TIPOS DE PRODUCTO (pedido del cliente) y pasa los deportes a "Deporte" (subcategoría).
//   node scripts/reordenar-categorias.cjs            → solo muestra qué haría y guarda un CSV para revisar (no cambia nada)
//   node scripts/reordenar-categorias.cjs --aplicar  → respalda y aplica
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const APPLY = process.argv.includes('--aplicar')

const NEW_CATEGORIES = ['Calzado', 'Indumentaria', 'Protecciones', 'Guantes', 'Gorras y accesorios de cabeza', 'Bolsos y mochilas', 'Accesorios', 'Equipamiento']

// Palabra → categoría. Se elige la palabra que aparece PRIMERO en el nombre (el sustantivo suele ir adelante:
// "MEDIAS DE FUTBOL" es Accesorios aunque después diga otra cosa). Las raíces matchean el inicio de una palabra.
const WORDS = {
  Calzado: ['zapatilla', 'botin', 'botines', 'ojota', 'chancla', 'shoe', 'calzado', 'sandalia', 'pantufla'],
  Indumentaria: ['remera', 'remeron', 'short', 'calza', 'campera', 'camiseta', 'uniforme', 'buzo', 'malla', 'top', 'pantalon', 'musculosa', 'rompeviento', 'bermuda', 'jogger', 'pollera', 'jersey', 'body', 'chaleco', 'vestido', 'conjunto', 'chomba', 'zunga', 'tee', 'pechera', 'equipo de lluvia', 'enterito', 'polera', 'babucha', 'falda', 'corpiño', 'boxer', 'jardinero', 'mangas', 'manga', 'indumentaria', 't shirt', 'shirt', 'pierna termica', 'termica', 'termico'],
  Protecciones: ['protector', 'canillera', 'espinillera', 'rodillera', 'tobillera', 'codera', 'muñequera', 'muñeq', 'casco', 'coquera', 'menisquera', 'muslera', 'pantorrillera', 'pantorrllllera', 'faja', 'cabezal', 'venda', 'bucal', 'tope', 'soporte', 'pantorrlllera'],
  Guantes: ['guante', 'guantin', 'manopla', 'callera', 'goalkeeper', 'glove'],
  'Gorras y accesorios de cabeza': ['gorra', 'gorro', 'piluso', 'visera', 'vincha', 'cap', 'pasamontaña', 'cuello', 'lente', 'antiparra', 'tapon', 'snorkel', 'bandana', 'clip nasal', 'clip nariz', 'multifuncion'],
  'Bolsos y mochilas': ['mochila', 'bolso', 'morral', 'riñonera', 'bag', 'botinero', 'portanotebook', 'carro', 'valija', 'bolsos'],
  Equipamiento: ['pelota', 'pelotita', 'paleta', 'raqueta', 'banda', 'tiraband', 'mancuerna', 'disco', 'colchoneta', 'colchon', 'red', 'aro', 'tubo', 'inflador', 'palo', 'barra', 'pesa', 'soga', 'ping', 'medicine', 'rolo', 'rueda', 'escalera', 'cono', 'arco', 'bosu', 'step', 'valla', 'tablero', 'pizarra', 'bocha', 'kettlebell', 'pera', 'bolsa', 'ejercitador', 'ladrillo', 'mat', 'push', 'pushup', 'pull', 'rodillo', 'plumas', 'pluma', 'corebag', 'core', 'jirafa', 'tabla', 'collarin', 'agarre', 'gravit', 'hidro', 'flotador', 'tortuguita', 'octagono', 'bulto', 'masajeador', 'relajador', 'pedalera', 'pedales', 'prensa', 'balon', 'ball', 'balls', 'yoga', 'power', 'straps', 'escalador', 'trampolin', 'chaleco lastrado', 'tobillera lastrada', 'candela', 'cerrojo', 'destorcedor', 'mosqueton', 'equipamiento', 'basket', 'basquet', 'futbol', 'fut', 'handball', 'volley', 'voley', 'rugby', 'golf', 'hockey', 'stick', 'box jump', 'muñe'],
  Accesorios: ['media', 'medias', 'medlas', 'soquete', 'socks', 'botella', 'caramañola', 'termo', 'thermos', 'thermoc', 'ther', 'vaso', 'linterna', 'pila', 'pilas', 'cinta', 'llavero', 'billetera', 'toalla', 'toallon', 'cinto', 'cinturon', 'cinturón', 'silbato', 'luz', 'candado', 'candad', 'overgrip', 'cubregrip', 'grip', 'antivibrador', 'funda', 'estuche', 'cronometro', 'cargador', 'cable', 'bateria', 'brazalete', 'broche', 'timbre', 'cerradura', 'llave', 'manguera', 'aerosol', 'medidor', 'carpa', 'reposera', 'manta', 'fosforo', 'camel', 'contigo', 'bubba', 'porta', 'cubre', 'repuesto', 'kit', 'set', 'tripack', 'combo', 'juego', 'cola', 'baston', 'pico', 'picos', 'accesorio', 'sock', 'crew', 'quarter', 'sneaker', 'footie', 'kneehigh', 'x1par', 'x2par', 'x3par', 'x6par', 'luces', 'puño', 'cielo tierra', 'guarda cabo', 'tarjeta', 'tarjetas'],
}
// Productos que empiezan con la marca y no dicen qué son.
const BRAND_FALLBACK = { skechers: 'Calzado', olympikus: 'Calzado', 'new balance': 'Calzado', fila: 'Calzado', diadora: 'Calzado', topper: 'Calzado', proton: 'Calzado', at10: 'Equipamiento', onyx: 'Equipamiento', varlion: 'Equipamiento', siux: 'Equipamiento', bolonia: 'Equipamiento', tau: 'Equipamiento', ionic: 'Equipamiento', 'x trust': 'Equipamiento', tormedo: 'Equipamiento' }
// Ítems que no son productos (descuentos, envíos, servicios): se informan aparte, no se tocan.
const NOT_PRODUCTS = ['descuento', 'flete', 'servicio', 'voucher', 'redondeo', 'reparacion', 'producto al', 'temp', 'nota de credito', 'producto generico', 'exhibidor', 'envio']

// Categorías viejas que son DEPORTES: pasan a la subcategoría (Deporte) para que sigan en Disciplinas.
const SPORT_CATEGORY = { running: 'Running', crossfit: 'CrossFit', 'fitness y yoga': 'Fitness y Yoga', gimnasio: 'Gimnasio', 'fitness gym aerobic': 'Gimnasio', 'lentes de natacion': 'Natación', 'gorra de natacion': 'Natación', 'guantes de arquero': 'Fútbol', canillera: 'Fútbol', rodilleras: 'Volley' }
// Categorías viejas que ya son un tipo de producto.
const OLD_TYPE = { calzado: 'Calzado', zapatillas: 'Calzado', indumentaria: 'Indumentaria', 'bolsos y mochilas': 'Bolsos y mochilas', 'gorras deportivas': 'Gorras y accesorios de cabeza', 'gorra de natacion': 'Gorras y accesorios de cabeza', 'lentes de natacion': 'Gorras y accesorios de cabeza', 'guantes de arquero': 'Guantes', canillera: 'Protecciones', rodilleras: 'Protecciones', billeteras: 'Accesorios', 'fitness gym aerobic': 'Equipamiento' }

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const slugify = (value) => fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const RULES = Object.entries(WORDS).flatMap(([category, words]) => words.map((word) => ({ category, word: fold(word) })))
function firstMatch(name, rules) {
  const text = ` ${fold(name).replace(/[^a-z0-9ñ ]+/g, ' ')} `
  let best = null
  for (const rule of rules) {
    // raíz al inicio de palabra; plural/sufijo permitido (zapatilla → zapatillas)
    const re = new RegExp(`\\s${rule.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?=\\s)`)
    const match = re.exec(text)
    if (match && (!best || match.index < best.index || (match.index === best.index && rule.word.length > best.word.length))) best = { ...rule, index: match.index }
  }
  return best
}

function classify(product) {
  const name = product.name
  if (firstMatch(name, NOT_PRODUCTS.map((word) => ({ category: 'NO ES PRODUCTO', word: fold(word) })))?.index === 0) return { category: null, reason: 'no-producto' }
  const hit = firstMatch(name, RULES)
  if (hit) return { category: hit.category, reason: `palabra "${hit.word}"` }
  for (const old of [product.category, ...product.categories]) if (OLD_TYPE[fold(old)]) return { category: OLD_TYPE[fold(old)], reason: `categoría vieja "${old}"` }
  const brand = Object.keys(BRAND_FALLBACK).find((key) => fold(name).startsWith(key))
  if (brand) return { category: BRAND_FALLBACK[brand], reason: `marca ${brand}` }
  return { category: 'Accesorios', reason: 'sin pista (va a Accesorios)' }
}

function newSubcategory(product) {
  const parts = String(product.subcategory || '').split(',').map((part) => part.trim()).filter(Boolean)
  for (const old of [product.category, ...product.categories]) {
    const sport = SPORT_CATEGORY[fold(old)]
    if (sport && !parts.some((part) => fold(part) === fold(sport))) parts.push(sport)
  }
  return parts.join(', ')
}

;(async () => {
  const products = await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true, sku: true, category: true, categories: true, subcategory: true, tags: true, active: true } })
  const plan = []
  const notProducts = []
  for (const product of products) {
    const result = classify(product)
    if (!result.category) { notProducts.push(product); continue }
    plan.push({ product, category: result.category, reason: result.reason, subcategory: newSubcategory(product) })
  }

  const count = {}
  for (const item of plan) count[item.category] = (count[item.category] || 0) + 1
  console.log('Productos:', products.length)
  for (const category of NEW_CATEGORIES) console.log(`  ${category}: ${count[category] || 0}`)
  const noHint = plan.filter((item) => item.reason.startsWith('sin pista'))
  console.log(`\nSin pista (quedan en Accesorios): ${noHint.length}`)
  console.log(noHint.map((item) => '  - ' + item.product.name).join('\n'))
  console.log(`\nNo son productos (no se tocan): ${notProducts.length}`)
  console.log(notProducts.map((product) => `  - ${product.name} [${product.active ? 'visible' : 'oculto'}]`).join('\n'))
  const subChanged = plan.filter((item) => item.subcategory !== (item.product.subcategory || ''))
  console.log(`\nDeporte (subcategoría) agregado desde la categoría vieja: ${subChanged.length}`)

  const csv = ['nombre;sku;categoria_vieja;categoria_nueva;motivo;deporte'].concat(plan.map((item) => [item.product.name, item.product.sku, [item.product.category, ...item.product.categories].join(' + '), item.category, item.reason, item.subcategory].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';')))
  const csvPath = path.join(__dirname, '..', 'backups', `categorias-propuestas-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
  fs.mkdirSync(path.dirname(csvPath), { recursive: true })
  fs.writeFileSync(csvPath, '﻿' + csv.join('\n'))
  console.log('\nCSV para revisar:', csvPath)

  if (!APPLY) { console.log('\n(Prueba: no se cambió nada. Para aplicar: --aplicar)'); return prisma.$disconnect() }

  // Respaldo completo de lo que se toca.
  const backupPath = path.join(__dirname, '..', 'backups', `categorias-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const oldCategories = await prisma.category.findMany()
  fs.writeFileSync(backupPath, JSON.stringify({ products: products.map(({ id, category, categories, subcategory, tags, active }) => ({ id, category, categories, subcategory, tags, active })), categories: oldCategories }, null, 2))
  console.log('Respaldo:', backupPath)

  // 1) Las 8 categorías nuevas en el ABM.
  for (const name of NEW_CATEGORIES) {
    await prisma.category.upsert({
      where: { normalizedName: fold(name) },
      update: { name, slug: slugify(name), active: true, deletedAt: null },
      create: { name, normalizedName: fold(name), slug: slugify(name) },
    })
  }
  // 2) Las demás (deportes y viejas) se dan de baja del ABM; quedan en el respaldo.
  const keep = new Set(NEW_CATEGORIES.map(fold))
  const removed = await prisma.category.updateMany({ where: { deletedAt: null, NOT: { normalizedName: { in: [...keep] } } }, data: { active: false, deletedAt: new Date() } })
  console.log('Categorías viejas dadas de baja:', removed.count)

  // 3) Productos: una sola categoría (el tipo), y el deporte en la subcategoría. Agrupados para pocas consultas.
  const groups = new Map()
  for (const item of plan) {
    const key = `${item.category}\u0000${item.subcategory}`
    if (!groups.has(key)) groups.set(key, { category: item.category, subcategory: item.subcategory, ids: [] })
    groups.get(key).ids.push(item.product.id)
  }
  let done = 0
  for (const group of groups.values()) {
    const result = await prisma.product.updateMany({ where: { id: { in: group.ids } }, data: { category: group.category, categories: [group.category], subcategory: group.subcategory } })
    done += result.count
  }
  console.log('Productos actualizados:', done)

  // 4) Ítems que no son productos (descuentos, fletes, servicios): se ocultan de la tienda.
  if (process.argv.includes('--ocultar-no-productos') && notProducts.length) {
    const hidden = await prisma.product.updateMany({ where: { id: { in: notProducts.map((product) => product.id) } }, data: { active: false } })
    console.log('No-productos ocultados:', hidden.count)
  }
  await prisma.$disconnect()
})().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1) })
