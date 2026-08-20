import { Injectable, NotFoundException } from '@nestjs/common'
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
}
