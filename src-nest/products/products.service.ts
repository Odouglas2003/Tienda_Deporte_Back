import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { catalogNumber, catalogChanges, ImportOptions, ImportPlan } from './catalog-import'
import { classifyProduct, foldText, isNotAProduct, PRODUCT_TYPES } from './product-types'

const COLOR_PATTERN_SOURCE = '\\b(azul\\s+marino|multicolor|multi|negro|negra|neg|blanco|blanca|bco|azul|verde|ver|rojo|roja|roj|gris|amarillo|amarilla|amar|naranja|nar|rosa|violeta|morado|morada|celeste|lila|beige|fucsia|bordo|dorado|dorada|dor|plateado|plateada|turquesa)\\b'
const SIZE_PATTERN = /\b(XXXL|XXL|XL|XS|XXS|S|M|L)\b/i
const LABELED_SIZE_PATTERN = /\btalle\s*(\d{1,3}|XXXL|XXL|XL|XS|XXS|S|M|L)\b/i
const GENDER_PATTERN = /\b(masculino|femenino|unisex|hombre|mujer)\b/i

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
}

function normalizeColor(value: string) {
  const normalized = value.toLowerCase()
  if (['negro', 'negra', 'neg'].includes(normalized)) return 'Negro'
  if (['blanco', 'blanca', 'bco'].includes(normalized)) return 'Blanco'
  if (['verde', 'ver'].includes(normalized)) return 'Verde'
  if (['rojo', 'roja', 'roj'].includes(normalized)) return 'Rojo'
  if (['dorado', 'dorada', 'dor'].includes(normalized)) return 'Dorado'
  if (['plateado', 'plateada'].includes(normalized)) return 'Plateado'
  if (['amarillo', 'amarilla'].includes(normalized)) return 'Amarillo'
  if (normalized === 'amar') return 'Amarillo'
  if (['naranja', 'nar'].includes(normalized)) return 'Naranja'
  if (['multicolor', 'multi'].includes(normalized)) return 'Multicolor'
  if (['morado', 'morada'].includes(normalized)) return 'Morado'
  return titleCase(value)
}

function extractVariantValue(row: any, field: 'color' | 'size' | 'gender') {
  const explicit = cleanText(field === 'color' ? row?.color : field === 'size' ? row?.size || row?.talle : row?.gender || row?.genero)
  const title = cleanText(row?.title || row?.name)
  if (field === 'color') {
    const source = explicit || title
    const colors = Array.from(source.matchAll(new RegExp(COLOR_PATTERN_SOURCE, 'gi')), (match) => normalizeColor(match[1]))
    return colors.length ? Array.from(new Set(colors)).join(' / ') : explicit ? titleCase(explicit) : ''
  }
  if (field === 'gender') {
    const match = (explicit || title).match(GENDER_PATTERN)
    if (!match) return explicit ? titleCase(explicit) : ''
    if (/^hombre$/i.test(match[1])) return 'Masculino'
    if (/^mujer$/i.test(match[1])) return 'Femenino'
    return titleCase(match[1])
  }
  if (explicit) return /^[a-z]+$/i.test(explicit) ? explicit.toUpperCase() : explicit
  const match = title.match(LABELED_SIZE_PATTERN) ?? title.match(SIZE_PATTERN)
  return match ? (/^[a-z]+$/i.test(match[1]) ? match[1].toUpperCase() : match[1]) : ''
}

function baseProductName(row: any) {
  let name = cleanText(row?.title || row?.name)
  const size = extractVariantValue(row, 'size')
  name = name.replace(new RegExp(COLOR_PATTERN_SOURCE, 'gi'), ' ')
  name = name.replace(GENDER_PATTERN, ' ')
  if (size) name = name.replace(new RegExp(`\\b(?:talle\\s*)?${size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ')
  return name
    .replace(/\s*[-|/]\s*/g, ' ')
    // Al sacar color y talle de "(MARINO, M)" pueden quedar restos como "( , )" o "(MARINO, )".
    .replace(/\(\s*,\s*/g, '(').replace(/\s*,\s*\)/g, ')').replace(/\(\s*(?:,\s*)*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Todos los códigos con los que se reconoce una variante: su SKU y los alternativos (código del sistema, código de barras). */
function variantCodes(variant: any): string[] {
  return [variant?.sku, ...(Array.isArray(variant?.codes) ? variant.codes : [])].map((code) => cleanText(code)).filter(Boolean)
}

/** Códigos de una fila del Excel: el código principal y, si viene, el código de barras. */
function rowCodes(row: any): string[] {
  return Array.from(new Set([row?.id || row?.sku, row?.barcode].map((code) => cleanText(code)).filter(Boolean)))
}

/** Nombre comparable para reconocer el mismo modelo con otro código: sin tildes, sin paréntesis y sin la marca. */
function sameModelKey(name: string, brandWords: Set<string>) {
  return cleanText(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word && !brandWords.has(word)).join(' ')
}

/**
 * Busca la variante de una fila: primero por su código principal (único por talle/color) y recién después
 * por el código de barras, que en algunos sistemas es el mismo para todos los talles del modelo.
 */
function findVariantForRow(variants: any[], row: any, color = '', size = '') {
  const primary = cleanText(row?.id || row?.sku)
  const barcode = cleanText(row?.barcode)
  return variants.find((variant) => variantCodes(variant).includes(primary))
    ?? (barcode ? variants.filter((variant) => variantCodes(variant).includes(barcode)).find((variant, _index, list) => list.length === 1 || sameCombo(variant, color, size)) : undefined)
}

function sameCombo(variant: any, color: string, size: string) {
  const norm = (value: unknown) => cleanText(value).toLowerCase()
  return norm(variant?.color) === norm(color) && norm(variant?.size) === norm(size) && Boolean(norm(color) || norm(size))
}

/**
 * Talles y colores que llegan del formulario del panel: solo campos conocidos, stock entero,
 * códigos sin repetir y precios propios opcionales (vacío = usa el precio general del producto).
 */
function sanitizeVariants(raw: unknown) {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new BadRequestException('Los talles y colores no son válidos.')
  if (raw.length > 300) throw new BadRequestException('Un producto admite hasta 300 talles/colores.')
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const seen = new Set<string>()
  return raw.map((item: any, index) => {
    const sku = text(item?.sku, 80)
    if (!sku) throw new BadRequestException(`Falta el código del talle/color ${index + 1}.`)
    if (seen.has(sku)) throw new BadRequestException(`El código ${sku} está repetido en los talles/colores.`)
    seen.add(sku)
    const stock = Number(item?.stock ?? 0)
    if (!Number.isSafeInteger(stock) || stock < 0) throw new BadRequestException(`El stock de ${sku} tiene que ser un número entero desde 0.`)
    const price = (value: unknown) => (value === undefined || value === null || value === '' ? undefined : Number(value))
    const priceRetail = price(item?.priceRetail)
    const priceWholesale = price(item?.priceWholesale)
    for (const value of [priceRetail, priceWholesale]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new BadRequestException(`El precio de ${sku} no es válido.`)
    const codes = Array.isArray(item?.codes) ? Array.from(new Set(item.codes.map((code: unknown) => text(code, 80)).filter((code: string) => code && code !== sku))) : []
    return {
      sku,
      ...(codes.length ? { codes } : {}),
      color: text(item?.color, 60),
      size: text(item?.size, 30),
      gender: text(item?.gender, 30),
      image: text(item?.image, 2_000_000),
      stock,
      ...(priceRetail !== undefined ? { priceRetail } : {}),
      ...(priceWholesale !== undefined ? { priceWholesale } : {}),
    }
  })
}

function variantGroupKey(row: any) {
  const category = cleanText(row?.category || row?.google_product_category || row?.fb_product_category).toLowerCase()
  const brand = cleanText(row?.brand).toLowerCase()
  return `${category}|${brand}|${baseProductName(row).toLowerCase()}`
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  list(filters: any = {}) {
    const where: Prisma.ProductWhereInput = { deletedAt: null }
    if (filters.active !== undefined) where.active = filters.active === true || filters.active === 'true'
    if (filters.category) where.OR = [{ category: String(filters.category) }, { categories: { has: String(filters.category) } }]
    if (filters.brand) where.brand = String(filters.brand)
    if (filters.onlyFeatured === true || filters.onlyFeatured === 'true') where.featured = true
    if (filters.onSale === true || filters.onSale === 'true' || filters.ofertas === 'true') where.discount = { gt: 0 }
    if (filters.search) where.AND = [{ OR: [{ name: { contains: String(filters.search), mode: 'insensitive' } }, { brand: { contains: String(filters.search), mode: 'insensitive' } }, { description: { contains: String(filters.search), mode: 'insensitive' } }] }]
    return this.prisma.product.findMany({ where, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: Number(filters.limit) > 0 ? Number(filters.limit) : undefined })
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return product
  }

  /** Alta de un producto suelto desde el panel. Solo toma los campos conocidos. */
  async create(payload: any) {
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
    const amount = (value: unknown, label: string, integer = false) => {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed))) throw new BadRequestException(`${label} debe ser un número positivo${integer ? ' entero' : ''}.`)
      return parsed
    }
    const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
    const name = text(payload?.name), sku = text(payload?.sku), brand = text(payload?.brand), category = text(payload?.category)
    if (!name || !sku || !brand || !category) throw new BadRequestException('Completá nombre, SKU, marca y al menos una categoría.')
    if (text(payload?.sizeGuide).length > 5000) throw new BadRequestException('La guía de talles admite hasta 5000 caracteres.')
    if (await this.prisma.product.findUnique({ where: { sku } })) throw new ConflictException(`Ya existe un producto con el SKU ${sku}.`)
    const categories = Array.from(new Set([category, ...list(payload?.categories)]))
    const variants = sanitizeVariants(payload?.variants) ?? []
    return this.prisma.product.create({
      data: {
        name, sku, brand, category, categories,
        subcategory: text(payload?.subcategory),
        description: text(payload?.description),
        sizeGuide: text(payload?.sizeGuide),
        priceRetail: amount(payload?.priceRetail, 'El precio minorista'),
        priceWholesale: amount(payload?.priceWholesale, 'El precio mayorista'),
        stock: variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : amount(payload?.stock, 'El stock', true),
        variants: variants as Prisma.InputJsonValue,
        tax: payload?.tax === undefined ? 0 : amount(payload.tax, 'El IVA'),
        images: list(payload?.images),
        tags: list(payload?.tags),
        colors: list(payload?.colors),
        sizes: list(payload?.sizes),
        featured: Boolean(payload?.featured),
        active: payload?.active !== false,
      },
    })
  }

  async update(id: string, payload: any) {
    if (payload.sizeGuide !== undefined && (typeof payload.sizeGuide !== 'string' || payload.sizeGuide.length > 5000)) throw new BadRequestException('La guía de talles admite hasta 5000 caracteres.')
    const product = await this.get(id)
    const { expectedUpdatedAt, ...data } = payload
    const variants = sanitizeVariants(data.variants)
    if (variants) {
      data.variants = variants
      if (variants.length) data.stock = variants.reduce((sum, variant) => sum + variant.stock, 0)
    }
    // Un producto sin precio no se publica (en la tienda saldría a $0).
    const willBeActive = data.active ?? product.active
    const retail = data.priceRetail ?? product.priceRetail
    const stockAfter = data.stock ?? product.stock
    // Sin precio se puede mostrar (sale "$0" y "Sin stock"), pero no con stock: se vendería a $0.
    if (willBeActive && !(Number(retail) > 0) && Number(stockAfter) > 0) throw new BadRequestException('Un producto sin precio no puede tener stock publicado: cargale el precio minorista o dejá el stock en 0.')
    if (expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== product.updatedAt.getTime()) throw new ConflictException('El producto cambió mientras editabas. Cerrá y recargá la lista antes de guardar.')
    const changed = await this.prisma.product.updateMany({ where: { id, deletedAt: null, updatedAt: product.updatedAt }, data })
    if (!changed.count) throw new ConflictException('El stock o precio cambió. Recargá el producto antes de guardar.')
    return this.get(id)
  }

  /** Oferta general: pone el mismo % de descuento a todos los productos (0 quita todas las ofertas). */
  async discountAll(rawPercent: unknown, actorId?: string) {
    const percent = Number(rawPercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 90) throw new BadRequestException('El descuento tiene que ser un número entre 0 y 90.')
    const rounded = Math.round(percent * 100) / 100
    const result = await this.prisma.product.updateMany({ where: { deletedAt: null }, data: { discount: rounded } })
    await this.prisma.activityLog.create({ data: { userId: actorId ?? null, action: rounded ? `Oferta general del ${rounded}%` : 'Quitar ofertas a todos los productos', entity: 'product', metadata: { percent: rounded, count: result.count } } })
    return { updatedCount: result.count, percent: rounded }
  }

  /**
   * "Ordenar categorías" del panel: clasifica por el nombre en los 8 tipos de producto.
   * alcance "sin-categoria": solo los que no tienen una categoría válida; "todos": revisa todo el catálogo.
   * Sin aplicar, devuelve la vista previa.
   */
  async autoCategorize(body: any, actorId?: string) {
    const scope = body?.scope === 'todos' ? 'todos' : 'sin-categoria'
    const apply = body?.apply === true
    const hideNotProducts = body?.hideNotProducts === true
    const [products, abm] = await Promise.all([
      this.prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true, category: true, categories: true, active: true } }),
      this.prisma.category.findMany({ where: { deletedAt: null, active: true }, select: { name: true } }),
    ])
    const valid = new Set(abm.map((category) => foldText(category.name)))
    const targets = scope === 'todos' ? products : products.filter((product) => !valid.has(foldText(product.category)))
    const counts: Record<string, number> = Object.fromEntries(PRODUCT_TYPES.map((type) => [type, 0]))
    const examples: Record<string, string[]> = Object.fromEntries(PRODUCT_TYPES.map((type) => [type, []]))
    const moves = new Map<string, string[]>()
    const notProducts: Array<{ id: string; name: string; active: boolean }> = []
    for (const product of targets) {
      if (isNotAProduct(product.name)) { notProducts.push({ id: product.id, name: product.name, active: product.active }); continue }
      const { category } = classifyProduct(product.name, [product.category, ...product.categories])
      if (foldText(category) === foldText(product.category) && product.categories.length <= 1) continue
      counts[category] += 1
      if (examples[category].length < 6) examples[category].push(product.name)
      moves.set(category, [...(moves.get(category) ?? []), product.id])
    }
    const changes = [...moves.values()].reduce((total, ids) => total + ids.length, 0)
    const preview = { scope, reviewed: targets.length, changes, counts, examples, notProducts }
    if (!apply) return preview

    await this.prisma.$transaction(async (tx) => {
      for (const name of moves.keys()) {
        await tx.category.upsert({
          where: { normalizedName: foldText(name) },
          update: { active: true, deletedAt: null },
          create: { name, normalizedName: foldText(name), slug: foldText(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') },
        })
      }
      for (const [category, ids] of moves) {
        for (let index = 0; index < ids.length; index += 500) {
          await tx.product.updateMany({ where: { id: { in: ids.slice(index, index + 500) }, deletedAt: null }, data: { category, categories: [category] } })
        }
      }
      if (hideNotProducts && notProducts.length) await tx.product.updateMany({ where: { id: { in: notProducts.map((item) => item.id) } }, data: { active: false } })
      await tx.activityLog.create({ data: { userId: actorId ?? null, action: `Ordenar categorías automáticamente (${changes} productos)`, entity: 'product', metadata: { scope, counts, hidden: hideNotProducts ? notProducts.length : 0 } } })
    }, { maxWait: 10000, timeout: 60000 })
    return { ...preview, applied: true, hidden: hideNotProducts ? notProducts.length : 0 }
  }

  /** Mover varios productos a una categoría (del ABM). */
  async setCategory(body: any, actorId?: string) {
    const ids: string[] = Array.isArray(body?.ids) ? Array.from(new Set<string>(body.ids.map(String))) : []
    if (!ids.length || ids.length > 2000) throw new BadRequestException('Elegí entre 1 y 2000 productos.')
    const category = await this.prisma.category.findFirst({ where: { deletedAt: null, active: true, normalizedName: foldText(typeof body?.category === 'string' ? body.category : '') } })
    if (!category) throw new BadRequestException('Esa categoría no existe. Creala primero en Configuración → Categorías.')
    const result = await this.prisma.product.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { category: category.name, categories: [category.name] } })
    await this.prisma.activityLog.create({ data: { userId: actorId ?? null, action: `Mover ${result.count} productos a ${category.name}`, entity: 'product', metadata: { category: category.name, productIds: ids } } })
    return { updatedCount: result.count, category: category.name }
  }

  async bulk(rows: any) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 100 || new Set(rows.map(row => row?.id)).size !== rows.length) throw new BadRequestException('Seleccioná entre 1 y 100 productos diferentes.')
    return this.prisma.$transaction(async tx => {
      for (const row of [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
        const product = await tx.product.findFirst({ where: { id: row.id, deletedAt: null } })
        if (!product || !row.updatedAt || new Date(row.updatedAt).getTime() !== product.updatedAt.getTime()) throw new ConflictException('Un producto cambió. Recargá la lista antes de editar el lote.')
        const data: Prisma.ProductUpdateManyMutationInput = {}
        for (const field of ['priceRetail', 'priceWholesale', 'stock'] as const) {
          if (row[field] === undefined) continue
          if (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] < 0 || (field === 'stock' && !Number.isSafeInteger(row[field]))) throw new BadRequestException('Los precios deben ser positivos y el stock un número entero.')
          data[field] = row[field]
        }
        const variants = Array.isArray(product.variants) ? product.variants as any[] : []
        if (variants.length) {
          if (row.stock !== undefined) throw new BadRequestException('El stock de este producto debe editarse por variante.')
          if (row.variants !== undefined && (!Array.isArray(row.variants) || new Set(row.variants.map((v: any) => v.sku)).size !== row.variants.length)) throw new BadRequestException('Variantes inválidas')
          for (const change of row.variants ?? []) {
            const variant = variants.find(v => v.sku === change.sku)
            if (!variant || !Number.isSafeInteger(change.stock) || change.stock < 0) throw new BadRequestException('Revisá SKU y stock de cada variante.')
            variant.stock = change.stock
          }
          for (const variant of variants) {
            if (row.priceRetail !== undefined) variant.priceRetail = row.priceRetail
            if (row.priceWholesale !== undefined) variant.priceWholesale = row.priceWholesale
          }
          data.variants = variants as Prisma.InputJsonValue
          data.stock = variants.reduce((sum, v) => sum + Number(v.stock), 0)
        } else if (row.variants?.length) throw new BadRequestException('El producto no tiene variantes.')
        const changed = await tx.product.updateMany({ where: { id: product.id, updatedAt: product.updatedAt, deletedAt: null }, data })
        if (!changed.count) throw new ConflictException('Cambió el stock o precio mientras editabas. Recargá la lista.')
      }
      await tx.activityLog.create({ data: { action: 'Edición de precios y stock por lote', entity: 'product', metadata: { productIds: rows.map(row => row.id) } } })
      return { updatedCount: rows.length }
    }, { timeout: 15000 })
  }

  async importCatalog(rows: any[] = [], options: ImportOptions = {}) {
    const mode = options.mode ?? 'full'
    if (!['full', 'prices', 'stock'].includes(mode)) throw new BadRequestException('Modo de importación inválido')
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('No se recibieron filas para importar')
    }
    if (rows.length > 5000) throw new BadRequestException('Importá hasta 5000 filas por archivo.')
    const skus = rows.map(row => cleanText(row?.id || row?.sku)).filter(Boolean)
    if (new Set(skus).size !== skus.length) throw new BadRequestException('Hay códigos/SKU repetidos en el Excel. Corregilos antes de importar.')
    if (mode !== 'full') return this.importUpdates(rows, options)

    const errors: Array<{ rowNumber: number; sku: string | null; message: string }> = []
    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0
    const plans: ImportPlan[] = []
    const versions: Record<string, string | null> = {}

    const text = (value: unknown) => String(value ?? '').trim()
    const number = catalogNumber

    const draft = options.draft === true
    const validRows: Array<{
      row: any
      rowNumber: number
      sku: string
      name: string
      category: string
      priceRetail: number | null
      priceWholesale: number | null
    }> = []

    for (const [index, row] of rows.entries()) {
      const rowNumber = Number(row?.rowNumber) || index + 2
      const sku = text(row?.id || row?.sku)
      const name = text(row?.title || row?.name)
      const rawCategory = text(row?.category || row?.google_product_category || row?.fb_product_category).toLowerCase()
      // Sin categoría en el Excel: se elige uno de los 8 tipos de producto según el nombre.
      const category = rawCategory && rawCategory !== 'sin-categoria' ? rawCategory : (name ? classifyProduct(name).category : '')
      const priceRetail = number(row?.price_retail ?? row?.price)
      const priceWholesale = number(row?.price_wholesale ?? row?.wholesale_price)
      // En borrador el precio puede faltar (se completa después), pero si viene tiene que ser válido.
      const badPrice = (price: number | null) => (price === null ? !draft : !Number.isFinite(price) || price < 0)
      const missing = [
        !sku && 'código/SKU',
        !name && 'nombre',
        !category && 'categoría',
        badPrice(priceRetail) && 'precio minorista válido',
        badPrice(priceWholesale) && 'precio mayorista válido',
      ].filter(Boolean)

      if (missing.length > 0) {
        errors.push({ rowNumber, sku: sku || null, message: `Faltan: ${missing.join(', ')}` })
        continue
      }

      validRows.push({ row, rowNumber, sku, name, category, priceRetail, priceWholesale })
    }

    const groups = new Map<string, typeof validRows>()
    for (const item of validRows) {
      const key = variantGroupKey(item.row)
      groups.set(key, [...(groups.get(key) ?? []), item])
    }

    // Se lee el catálogo una sola vez y se indexa por código: con miles de filas, una consulta por
    // producto tardaba demasiado (la base está en San Pablo y el servidor en Render).
    const catalog = await this.prisma.product.findMany()
    const bySku = new Map<string, typeof catalog>()
    const addToIndex = (sku: unknown, product: typeof catalog[number]) => {
      const key = text(sku)
      if (!key) return
      const list = bySku.get(key) ?? []
      if (!list.includes(product)) list.push(product)
      bySku.set(key, list)
    }
    for (const product of catalog) {
      addToIndex(product.sku, product)
      for (const variant of Array.isArray(product.variants) ? product.variants as any[] : []) variantCodes(variant).forEach((code) => addToIndex(code, product))
    }
    // En borradores también se reconoce el mismo modelo por nombre (los productos viejos pueden tener otro código).
    const brandWords = new Set(['victory', 'head', 'reebok', 'fila', 'umbro', 'asics', 'puma', 'penalty', 'gilbert', 'molten', 'faf', 'everlast', 'spalding', 'bullpadel', 'fds', 'adidas', 'nike',
      ...catalog.flatMap((product) => cleanText(product.brand).toLowerCase().split(/\s+/)).filter((word) => word.length > 2 && word !== 'sin' && word !== 'marca')])
    const byModel = new Map<string, typeof catalog>()
    if (draft) {
      for (const product of catalog) {
        if (product.deletedAt) continue
        const key = sameModelKey(product.name, brandWords)
        if (key) byModel.set(key, [...(byModel.get(key) ?? []), product])
      }
    }
    const pendingCreates: Array<{ data: Prisma.ProductCreateInput; variantSkus: string[]; rowNumber: number; sku: string }> = []

    for (const group of groups.values()) {
      const first = group[0]
      const variantSkus = Array.from(new Set(group.map((item) => item.sku)))
      try {
        // Match a grouped product even when the Excel lists another variant first.
        const groupCodes = Array.from(new Set(group.flatMap((item) => rowCodes(item.row))))
        let matches = Array.from(new Set(groupCodes.flatMap((code) => bySku.get(code) ?? [])))
        if (!matches.length && draft) {
          const sameModel = byModel.get(sameModelKey(baseProductName(first.row) || first.name, brandWords)) ?? []
          if (sameModel.length === 1) matches = sameModel
        }
        const matchedVariants = (product: typeof matches[number]) => Array.isArray(product.variants)
          ? (product.variants as any[]).filter(variant => variantCodes(variant).some((code) => groupCodes.includes(code))).length : 0
        const existing = matches.sort((a, b) =>
          Number(b.active && !b.deletedAt) - Number(a.active && !a.deletedAt)
          || matchedVariants(b) - matchedVariants(a)
          || Number(b.sku === first.sku) - Number(a.sku === first.sku)
          || a.id.localeCompare(b.id)
        )[0]
        const savedVariants = Array.isArray(existing?.variants) ? existing.variants as any[] : []
        versions[first.sku] = existing?.updatedAt.toISOString() ?? null
        if (options.expectedVersions && (!Object.prototype.hasOwnProperty.call(options.expectedVersions, first.sku) || options.expectedVersions[first.sku] !== versions[first.sku])) throw new ConflictException('Cambió el catálogo desde la revisión. Revisá los cambios otra vez antes de confirmar.')
        if (draft && existing) {
          // Producto que ya estaba: no se tocan nombre, precios, stock ni fotos. Solo se guardan los códigos
          // del Excel en sus variantes y se agregan los talles/colores que la tienda no tenía (sin stock).
          const merged = savedVariants.map((variant) => ({ ...variant, codes: Array.isArray(variant.codes) ? [...variant.codes] : [] }))
          const added: string[] = []
          let linked = 0
          for (const item of group) {
            const codes = rowCodes(item.row)
            const color = extractVariantValue(item.row, 'color')
            const size = extractVariantValue(item.row, 'size')
            const target = findVariantForRow(merged, item.row, color, size) ?? merged.find((variant) => sameCombo(variant, color, size))
            if (target) {
              const missing = codes.filter((code) => !variantCodes(target).includes(code))
              if (missing.length) { target.codes.push(...missing); linked += 1 }
            } else if (merged.length) {
              merged.push({ sku: item.sku, codes: codes.filter((code) => code !== item.sku), color, size, gender: extractVariantValue(item.row, 'gender'), image: '', stock: 0, priceRetail: existing.priceRetail, priceWholesale: existing.priceWholesale })
              added.push([color, size].filter(Boolean).join(' ') || item.sku)
            }
          }
          if (!added.length && !linked) { plans.push({ sku: first.sku, name: existing.name, kind: 'unchanged', changes: [] }); unchangedCount++; continue }
          const changes = [
            ...(added.length ? [{ field: 'Talles/colores nuevos (sin stock)', before: null, after: added.join(', ') }] : []),
            ...(linked ? [{ field: 'Códigos del Excel vinculados', before: null, after: linked }] : []),
          ]
          plans.push({ sku: existing.sku, name: existing.name, kind: 'update', changes })
          const mergedColors = Array.from(new Set(merged.flatMap((variant) => String(variant.color ?? '').split('/').map((color: string) => color.trim()).filter(Boolean))))
          const mergedSizes = Array.from(new Set(merged.map((variant) => variant.size).filter(Boolean)))
          if (!options.dryRun) {
            const updated = await this.prisma.product.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt }, data: { variants: merged as Prisma.InputJsonValue, colors: mergedColors, sizes: mergedSizes } })
            if (!updated.count) throw new ConflictException('El producto cambió durante la importación. Volvé a importar.')
            const fresh = await this.prisma.product.findUnique({ where: { id: existing.id } })
            if (fresh) Object.assign(existing, fresh)
          } else {
            Object.assign(existing, { variants: merged, colors: mergedColors, sizes: mergedSizes })
          }
          // Otro grupo del mismo Excel puede caer en este producto: que lo encuentre ya actualizado.
          merged.forEach((variant) => variantCodes(variant).forEach((code) => addToIndex(code, existing)))
          updatedCount++
          continue
        }
        const categories = Array.from(new Set([first.category, ...(Array.isArray(first.row?.categories) && first.row.categories.length
          ? first.row.categories : existing?.category === first.category ? existing.categories : [])].map(text).filter(Boolean)))
        const incomingVariants = group.map((item) => {
          const codes = rowCodes(item.row)
          const saved = findVariantForRow(savedVariants, item.row, extractVariantValue(item.row, 'color'), extractVariantValue(item.row, 'size'))
          const stockValue = number(item.row?.stock ?? item.row?.quantity_to_sell_on_facebook)
          if (stockValue !== null && (!Number.isSafeInteger(stockValue) || stockValue < 0)) throw new BadRequestException(`Stock inválido para ${item.sku}. Usá cantidades enteras desde cero.`)
          return ({
          // Si la variante ya existía con otro código (por ejemplo el de barras), conserva su SKU y suma el nuevo.
          sku: saved?.sku ?? item.sku,
          codes: Array.from(new Set([...(Array.isArray(saved?.codes) ? saved.codes : []), ...codes].filter((code) => code !== (saved?.sku ?? item.sku)))),
          color: extractVariantValue(item.row, 'color') || saved?.color || '',
          size: extractVariantValue(item.row, 'size') || saved?.size || '',
          gender: extractVariantValue(item.row, 'gender') || saved?.gender || '',
          image: existing
            ? text(saved ? saved.image : existing.images[0])
            : text(item.row?.image_link || item.row?.image),
          stock: stockValue ?? saved?.stock ?? (existing && group.length === 1 && !savedVariants.length ? existing.stock : 0),
          priceRetail: item.priceRetail ?? saved?.priceRetail ?? existing?.priceRetail ?? 0,
          priceWholesale: item.priceWholesale ?? saved?.priceWholesale ?? existing?.priceWholesale ?? 0,
          })
        })
        const matchedSkus = new Set(incomingVariants.map((variant) => variant.sku))
        const variants = [...savedVariants.filter(variant => !matchedSkus.has(variant.sku)), ...incomingVariants]
        const colors = Array.from(new Set(variants.flatMap((variant) => String(variant.color ?? '').split('/').map((color: string) => color.trim()).filter(Boolean))))
        const sizes = Array.from(new Set(variants.map((variant) => variant.size).filter(Boolean)))
        const images = Array.from(new Set(variants.map((variant) => variant.image).filter(Boolean)))
        const data = {
          sku: existing?.sku ?? first.sku,
          name: baseProductName(first.row) || first.name,
          description: text(first.row?.description) || existing?.description || '',
          // Los productos que ya existen conservan la categoría y el deporte (subcategoría) que se
          // cargaron en la tienda: el Excel del proveedor solo los define para productos nuevos.
          category: existing?.category || first.category,
          categories: existing?.category ? existing.categories : categories,
          subcategory: existing?.subcategory || text(first.row?.subcategory || first.row?.['style[0]']).toLowerCase() || '',
          brand: text(first.row?.brand) || existing?.brand || text(first.row?.inferred_brand) || '',
          priceRetail: Math.min(...variants.map((variant) => variant.priceRetail ?? existing?.priceRetail ?? 0)),
          priceWholesale: Math.min(...variants.map((variant) => variant.priceWholesale ?? existing?.priceWholesale ?? 0)),
          stock: variants.reduce((total, variant) => total + variant.stock, 0),
          tax: number(first.row?.tax) ?? existing?.tax ?? 0,
          images,
          colors,
          sizes,
          variants: variants as Prisma.InputJsonValue,
          tags: [text(first.row?.['product_tags[0]']) || existing?.tags?.[0] || '', text(first.row?.['product_tags[1]']) || existing?.tags?.[1] || '', ...(existing?.tags?.slice(2) ?? [])].filter(Boolean),
          // Los nuevos se muestran aunque no tengan precio, foto ni stock (salen "$0" y "Sin stock").
          // Solo nacen ocultos si traen stock sin precio, para que nadie compre a $0.
          active: existing?.active ?? (!isNotAProduct(first.name) && (!draft || Math.min(...variants.map((variant) => Number(variant.priceRetail) || 0)) > 0 || variants.reduce((total, variant) => total + variant.stock, 0) === 0)),
        }
        if (!Number.isFinite(data.tax) || data.tax < 0 || data.tax > 100) throw new BadRequestException('IVA inválido')
        const changes = catalogChanges(existing, data)
        // En borrador los productos que ya están en la tienda no se tocan.
        const kind = !existing ? 'create' : changes.length && !draft ? 'update' : 'unchanged'
        plans.push({ sku: first.sku, name: data.name, kind, changes })
        if (kind === 'unchanged') { unchangedCount++; continue }
        if (options.dryRun) { if (existing) updatedCount++; else createdCount++; continue }
        // Los nuevos se guardan juntos al final (mucho más rápido con miles de productos).
        if (!existing) { pendingCreates.push({ data, variantSkus, rowNumber: first.rowNumber, sku: first.sku }); continue }

        const product = await this.prisma.$transaction(async tx => {
          if (!existing) return tx.product.create({ data })
          // Never write gallery images during reimports. A concurrent photo edit
          // also invalidates the snapshot used to retain variant images.
          const { images: _importedImages, ...updateData } = data
          const updated = await tx.product.updateMany({
            where: { id: existing.id, updatedAt: existing.updatedAt },
            data: { ...updateData, deletedAt: existing.deletedAt },
          })
          if (!updated.count) throw new ConflictException('El producto cambió durante la importación. Volvé a importar para conservar los cambios más recientes.')
          return { id: existing.id }
        })
        if (variantSkus.length > 1) {
          await this.prisma.product.updateMany({
            where: { sku: { in: variantSkus.filter((sku) => sku !== data.sku) }, id: { not: product.id } },
            data: { active: false, deletedAt: new Date() },
          })
        }
        if (existing) updatedCount += 1
        else createdCount += 1
      } catch (error) {
        errors.push({ rowNumber: first.rowNumber, sku: first.sku || null, message: error instanceof Error ? error.message : 'No se pudo guardar el producto y sus variantes' })
      }
    }

    for (let start = 0; start < pendingCreates.length; start += 200) {
      const chunk = pendingCreates.slice(start, start + 200)
      try {
        const result = await this.prisma.product.createMany({ data: chunk.map((item) => item.data as Prisma.ProductCreateManyInput) })
        createdCount += result.count
      } catch {
        // Si falla la tanda, se guardan de a uno para saber exactamente cuál tiene el problema.
        for (const item of chunk) {
          try {
            await this.prisma.product.create({ data: item.data })
            createdCount += 1
          } catch (error) {
            errors.push({ rowNumber: item.rowNumber, sku: item.sku || null, message: error instanceof Error && /Unique/i.test(error.message) ? 'Ese código ya existe en otro producto' : 'No se pudo guardar el producto' })
          }
        }
      }
    }
    const createdSkus = pendingCreates.map((item) => String(item.data.sku))
    const replacedSkus = pendingCreates.flatMap((item) => item.variantSkus.filter((sku) => sku !== item.data.sku))
    if (replacedSkus.length) {
      await this.prisma.product.updateMany({ where: { sku: { in: replacedSkus, notIn: createdSkus }, deletedAt: null }, data: { active: false, deletedAt: new Date() } })
    }

    return { totalRows: rows.length, createdCount, updatedCount, unchangedCount, skippedCount: errors.length, errorCount: errors.length, errors, plans, versions, dryRun: options.dryRun === true }
  }

  private async importUpdates(rows: any[], options: ImportOptions) {
    const errors: Array<{ rowNumber: number; sku: string | null; message: string }> = []
    const plans: ImportPlan[] = []
    const versions: Record<string, string | null> = {}
    const products = await this.prisma.product.findMany({ where: { deletedAt: null } })
    const byCode = new Map<string, typeof products[number]>()
    for (const product of products) {
      for (const variant of Array.isArray(product.variants) ? product.variants as any[] : []) variantCodes(variant).forEach((code) => { if (!byCode.has(code)) byCode.set(code, product) })
    }
    for (const product of products) if (!byCode.has(product.sku)) byCode.set(product.sku, product)
    const groups = new Map<string, { product: typeof products[number]; rows: any[] }>()
    for (const row of rows) {
      const sku = cleanText(row?.id || row?.sku)
      const product = rowCodes(row).map((code) => byCode.get(code)).find(Boolean)
      if (!sku || !product) { errors.push({ rowNumber: row.rowNumber, sku: sku || null, message: 'El SKU no existe. Usá Importación completa para crear productos nuevos.' }); continue }
      const group = groups.get(product.id) ?? { product, rows: [] }
      group.rows.push(row); groups.set(product.id, group)
    }
    let updatedCount = 0
    let unchangedCount = 0
    for (const { product, rows: group } of groups.values()) {
      try {
        const data: any = {}
        const variants = Array.isArray(product.variants) ? (product.variants as any[]).map(v => ({ ...v })) : []
        for (const row of group) {
          const sku = cleanText(row.id || row.sku)
          versions[sku] = product.updatedAt.toISOString()
          if (options.expectedVersions && options.expectedVersions[sku] !== versions[sku]) throw new ConflictException('Cambió el catálogo desde la revisión. Revisá otra vez antes de confirmar.')
          const variant = findVariantForRow(variants, row)
          if (variants.length && !variant) throw new BadRequestException('Para este producto indicá el SKU de cada variante.')
          const values = options.mode === 'stock'
            ? { stock: catalogNumber(row.stock ?? row.quantity_to_sell_on_facebook) }
            : { priceRetail: catalogNumber(row.price_retail ?? row.price), priceWholesale: catalogNumber(row.price_wholesale ?? row.wholesale_price) }
          for (const [field, value] of Object.entries(values)) {
            if (value === null) continue
            if (!Number.isFinite(value) || value < 0 || (field === 'stock' && !Number.isSafeInteger(value))) throw new BadRequestException(`Valor inválido en ${field === 'stock' ? 'stock (cantidad entera)' : 'precio'} del SKU ${sku}.`)
            if (variant) variant[field] = value
            else data[field] = value
          }
        }
        if (variants.length) {
          data.variants = variants
          if (options.mode === 'stock') data.stock = variants.reduce((sum, v) => sum + Number(v.stock), 0)
          else {
            data.priceRetail = Math.min(...variants.map(v => v.priceRetail ?? product.priceRetail))
            data.priceWholesale = Math.min(...variants.map(v => v.priceWholesale ?? product.priceWholesale))
          }
        }
        const changes = catalogChanges(product, data)
        plans.push({ sku: product.sku, name: product.name, kind: changes.length ? 'update' : 'unchanged', changes })
        if (!changes.length) { unchangedCount++; continue }
        if (!options.dryRun) {
          const updated = await this.prisma.product.updateMany({ where: { id: product.id, deletedAt: null, updatedAt: product.updatedAt }, data })
          if (!updated.count) throw new ConflictException('El producto cambió mientras importabas. Revisá otra vez antes de confirmar.')
        }
        updatedCount++
      } catch (error) { errors.push({ rowNumber: group[0].rowNumber, sku: product.sku, message: error instanceof Error ? error.message : 'No se pudo actualizar' }) }
    }
    return { totalRows: rows.length, createdCount: 0, updatedCount, unchangedCount, skippedCount: errors.length, errorCount: errors.length, errors, plans, versions, dryRun: options.dryRun === true }
  }
}
