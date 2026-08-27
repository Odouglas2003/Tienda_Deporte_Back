import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

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

      const retail = priceRetail as number
      const wholesale = priceWholesale as number

      try {
        const existing = await this.prisma.product.findUnique({ where: { sku } })
        const categories = Array.from(new Set([category, ...(Array.isArray(row?.categories) ? row.categories : [])].map(text).filter(Boolean)))
        const colors = [text(row?.color)].filter(Boolean)
        const sizes = [text(row?.size || row?.talle)].filter(Boolean)
        const data = {
          sku,
          name,
          description: text(row?.description),
          category,
          categories,
          subcategory: text(row?.subcategory || row?.['style[0]']).toLowerCase(),
          brand: text(row?.brand),
          priceRetail: retail,
          priceWholesale: wholesale,
          stock: Math.max(0, Math.round(number(row?.stock ?? row?.quantity_to_sell_on_facebook) ?? (/^(in stock|disponible|si|sí)$/i.test(text(row?.availability)) ? 1 : 0))),
          tax: number(row?.tax) ?? 0,
          images: text(row?.image_link || row?.image) ? [text(row?.image_link || row?.image)] : [],
          colors,
          sizes,
          tags: [text(row?.['product_tags[0]']), text(row?.['product_tags[1]'])].filter(Boolean),
          active: true,
        }

        await this.prisma.product.upsert({ where: { sku }, create: data, update: { ...data, deletedAt: null } })
        if (existing) updatedCount += 1
        else createdCount += 1
      } catch (error) {
        errors.push({ rowNumber, sku: sku || null, message: error instanceof Error ? error.message : 'No se pudo guardar la fila' })
      }
    }

    return { totalRows: rows.length, createdCount, updatedCount, skippedCount: errors.length, errorCount: errors.length, errors }
  }
}
