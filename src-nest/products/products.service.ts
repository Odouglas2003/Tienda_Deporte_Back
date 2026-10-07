import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { catalogNumber, catalogChanges, ImportOptions, ImportPlan } from './catalog-import'

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
  return name.replace(/\s*[-|/]\s*/g, ' ').replace(/\s+/g, ' ').trim()
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

  create(payload: any) {
    return this.prisma.product.create({ data: { ...payload, categories: payload.categories ?? [payload.category], images: payload.images ?? [], tags: payload.tags ?? [] } })
  }

  async update(id: string, payload: any) {
    if (payload.sizeGuide !== undefined && (typeof payload.sizeGuide !== 'string' || payload.sizeGuide.length > 5000)) throw new BadRequestException('La guía de talles admite hasta 5000 caracteres.')
    const product = await this.get(id)
    const { expectedUpdatedAt, ...data } = payload
    if (expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== product.updatedAt.getTime()) throw new ConflictException('El producto cambió mientras editabas. Cerrá y recargá la lista antes de guardar.')
    const changed = await this.prisma.product.updateMany({ where: { id, deletedAt: null, updatedAt: product.updatedAt }, data })
    if (!changed.count) throw new ConflictException('El stock o precio cambió. Recargá el producto antes de guardar.')
    return this.get(id)
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

    const validRows: Array<{
      row: any
      rowNumber: number
      sku: string
      name: string
      category: string
      priceRetail: number
      priceWholesale: number
    }> = []

    for (const [index, row] of rows.entries()) {
      const rowNumber = Number(row?.rowNumber) || index + 2
      const sku = text(row?.id || row?.sku)
      const name = text(row?.title || row?.name)
      const category = text(row?.category || row?.google_product_category || row?.fb_product_category).toLowerCase()
      const priceRetail = number(row?.price_retail ?? row?.price)
      const priceWholesale = number(row?.price_wholesale ?? row?.wholesale_price)
      const missing = [
        !sku && 'código/SKU',
        !name && 'nombre',
        !category && 'categoría',
        (priceRetail === null || !Number.isFinite(priceRetail) || priceRetail < 0) && 'precio minorista válido',
        (priceWholesale === null || !Number.isFinite(priceWholesale) || priceWholesale < 0) && 'precio mayorista válido',
      ].filter(Boolean)

      if (missing.length > 0) {
        errors.push({ rowNumber, sku: sku || null, message: `Faltan: ${missing.join(', ')}` })
        continue
      }

      validRows.push({ row, rowNumber, sku, name, category, priceRetail: priceRetail as number, priceWholesale: priceWholesale as number })
    }

    const groups = new Map<string, typeof validRows>()
    for (const item of validRows) {
      const key = variantGroupKey(item.row)
      groups.set(key, [...(groups.get(key) ?? []), item])
    }

    for (const group of groups.values()) {
      const first = group[0]
      const variantSkus = Array.from(new Set(group.map((item) => item.sku)))
      try {
        // Match a grouped product even when the Excel lists another variant first.
        const matches = await this.prisma.product.findMany({ where: { OR: [
          { sku: { in: variantSkus } },
          ...variantSkus.map(sku => ({ variants: { array_contains: [{ sku }] } })),
        ] } })
        const matchedVariants = (product: typeof matches[number]) => Array.isArray(product.variants)
          ? (product.variants as any[]).filter(variant => variantSkus.includes(variant.sku)).length : 0
        const existing = matches.sort((a, b) =>
          Number(b.active && !b.deletedAt) - Number(a.active && !a.deletedAt)
          || matchedVariants(b) - matchedVariants(a)
          || Number(b.sku === first.sku) - Number(a.sku === first.sku)
          || a.id.localeCompare(b.id)
        )[0]
        const savedVariants = Array.isArray(existing?.variants) ? existing.variants as any[] : []
        versions[first.sku] = existing?.updatedAt.toISOString() ?? null
        if (options.expectedVersions && (!Object.prototype.hasOwnProperty.call(options.expectedVersions, first.sku) || options.expectedVersions[first.sku] !== versions[first.sku])) throw new ConflictException('Cambió el catálogo desde la revisión. Revisá los cambios otra vez antes de confirmar.')
        const categories = Array.from(new Set([first.category, ...(Array.isArray(first.row?.categories) && first.row.categories.length
          ? first.row.categories : existing?.category === first.category ? existing.categories : [])].map(text).filter(Boolean)))
        const incomingVariants = group.map((item) => {
          const saved = savedVariants.find(variant => variant.sku === item.sku)
          const stockValue = number(item.row?.stock ?? item.row?.quantity_to_sell_on_facebook)
          if (stockValue !== null && (!Number.isSafeInteger(stockValue) || stockValue < 0)) throw new BadRequestException(`Stock inválido para ${item.sku}. Usá cantidades enteras desde cero.`)
          return ({
          sku: item.sku,
          color: extractVariantValue(item.row, 'color') || saved?.color || '',
          size: extractVariantValue(item.row, 'size') || saved?.size || '',
          gender: extractVariantValue(item.row, 'gender') || saved?.gender || '',
          image: existing
            ? text(savedVariants.some(variant => variant.sku === item.sku)
              ? savedVariants.find(variant => variant.sku === item.sku)?.image
              : existing.images[0])
            : text(item.row?.image_link || item.row?.image),
          stock: stockValue ?? saved?.stock ?? (existing && group.length === 1 && !savedVariants.length ? existing.stock : 0),
          priceRetail: item.priceRetail,
          priceWholesale: item.priceWholesale,
          })
        })
        const variants = [...savedVariants.filter(variant => !variantSkus.includes(variant.sku)), ...incomingVariants]
        const colors = Array.from(new Set(variants.flatMap((variant) => String(variant.color ?? '').split('/').map((color: string) => color.trim()).filter(Boolean))))
        const sizes = Array.from(new Set(variants.map((variant) => variant.size).filter(Boolean)))
        const images = Array.from(new Set(variants.map((variant) => variant.image).filter(Boolean)))
        const data = {
          sku: existing?.sku ?? first.sku,
          name: baseProductName(first.row) || first.name,
          description: text(first.row?.description) || existing?.description || '',
          category: first.category,
          categories,
          subcategory: text(first.row?.subcategory || first.row?.['style[0]']).toLowerCase() || existing?.subcategory || '',
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
          active: existing?.active ?? true,
        }
        if (!Number.isFinite(data.tax) || data.tax < 0 || data.tax > 100) throw new BadRequestException('IVA inválido')
        const changes = catalogChanges(existing, data)
        const kind = !existing ? 'create' : changes.length ? 'update' : 'unchanged'
        plans.push({ sku: first.sku, name: data.name, kind, changes })
        if (kind === 'unchanged') { unchangedCount++; continue }
        if (options.dryRun) { if (existing) updatedCount++; else createdCount++; continue }

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

    return { totalRows: rows.length, createdCount, updatedCount, unchangedCount, skippedCount: errors.length, errorCount: errors.length, errors, plans, versions, dryRun: options.dryRun === true }
  }

  private async importUpdates(rows: any[], options: ImportOptions) {
    const errors: Array<{ rowNumber: number; sku: string | null; message: string }> = []
    const plans: ImportPlan[] = []
    const versions: Record<string, string | null> = {}
    const skus = rows.map(row => cleanText(row?.id || row?.sku))
    const products = await this.prisma.product.findMany({ where: { deletedAt: null, OR: [
      { sku: { in: skus } }, ...skus.map(sku => ({ variants: { array_contains: [{ sku }] } })),
    ] } })
    const groups = new Map<string, { product: typeof products[number]; rows: any[] }>()
    for (const row of rows) {
      const sku = cleanText(row?.id || row?.sku)
      const product = products.find(product => Array.isArray(product.variants) && (product.variants as any[]).some(v => v.sku === sku))
        ?? products.find(product => product.sku === sku)
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
          const variant = variants.find(v => v.sku === sku)
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
