import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const COLOR_PATTERN_SOURCE = '\\b(azul\\s+marino|negro|negra|neg|blanco|blanca|bco|azul|verde|ver|rojo|roja|roj|gris|amarillo|amarilla|naranja|rosa|violeta|morado|morada|celeste|lila|beige|fucsia|bordo|dorado|dorada|dor|plateado|plateada|turquesa)\\b'
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
    await this.get(id)
    return this.prisma.product.update({ where: { id }, data: payload })
  }

  async importCatalog(rows: any[] = []) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('No se recibieron filas para importar')
    }

    const errors: Array<{ rowNumber: number; sku: string | null; message: string }> = []
    let createdCount = 0
    let updatedCount = 0

    const text = (value: unknown) => String(value ?? '').trim()
    const number = (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      const raw = text(value).replace(/[^\d,.-]/g, '')
      if (!raw) return null
      const normalized = raw.includes(',') && raw.includes('.')
        ? (raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''))
        : raw.replace(',', '.')
      const parsed = Number(normalized)
      return Number.isFinite(parsed) ? parsed : null
    }

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
        priceRetail === null && 'precio minorista',
        priceWholesale === null && 'precio mayorista',
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
        const existing = await this.prisma.product.findUnique({ where: { sku: first.sku } })
        const categories = Array.from(new Set([first.category, ...(Array.isArray(first.row?.categories) ? first.row.categories : [])].map(text).filter(Boolean)))
        const variants = group.map((item) => ({
          sku: item.sku,
          color: extractVariantValue(item.row, 'color'),
          size: extractVariantValue(item.row, 'size'),
          gender: extractVariantValue(item.row, 'gender'),
          image: text(item.row?.image_link || item.row?.image),
          stock: Math.max(0, Math.round(number(item.row?.stock ?? item.row?.quantity_to_sell_on_facebook) ?? (/^(in stock|disponible|si|sí)$/i.test(text(item.row?.availability)) ? 1 : 0))),
          priceRetail: item.priceRetail,
          priceWholesale: item.priceWholesale,
        }))
        const colors = Array.from(new Set(variants.map((variant) => variant.color).filter(Boolean)))
        const sizes = Array.from(new Set(variants.map((variant) => variant.size).filter(Boolean)))
        const images = Array.from(new Set(variants.map((variant) => variant.image).filter(Boolean)))
        const data = {
          sku: first.sku,
          name: baseProductName(first.row) || first.name,
          description: text(first.row?.description),
          category: first.category,
          categories,
          subcategory: text(first.row?.subcategory || first.row?.['style[0]']).toLowerCase(),
          brand: text(first.row?.brand),
          priceRetail: Math.min(...variants.map((variant) => variant.priceRetail)),
          priceWholesale: Math.min(...variants.map((variant) => variant.priceWholesale)),
          stock: variants.reduce((total, variant) => total + variant.stock, 0),
          tax: number(first.row?.tax) ?? 0,
          images,
          colors,
          sizes,
          variants: variants as Prisma.InputJsonValue,
          tags: [text(first.row?.['product_tags[0]']), text(first.row?.['product_tags[1]'])].filter(Boolean),
          active: true,
        }

        const product = await this.prisma.product.upsert({ where: { sku: first.sku }, create: data, update: { ...data, deletedAt: null } })
        if (variantSkus.length > 1) {
          await this.prisma.product.updateMany({
            where: { sku: { in: variantSkus.filter((sku) => sku !== first.sku) }, id: { not: product.id } },
            data: { active: false, deletedAt: new Date() },
          })
        }
        if (existing) updatedCount += 1
        else createdCount += 1
      } catch (error) {
        errors.push({ rowNumber: first.rowNumber, sku: first.sku || null, message: error instanceof Error ? error.message : 'No se pudo guardar el producto y sus variantes' })
      }
    }

    return { totalRows: rows.length, createdCount, updatedCount, skippedCount: errors.length, errorCount: errors.length, errors }
  }
}
