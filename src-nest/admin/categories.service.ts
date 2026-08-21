import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const slug = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function transformNavigation(value: Prisma.JsonValue | null, field: 'categories' | 'items', oldName: string, newName: string | null) {
  if (!Array.isArray(value)) return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const record = entry as Record<string, Prisma.JsonValue>
    const items = record[field]
    if (!Array.isArray(items)) return entry

    const transformed = items.flatMap((item) => {
      if (typeof item !== 'string' || normalize(item) !== normalize(oldName)) return [item]
      return newName ? [newName] : []
    })

    return { ...record, [field]: transformed }
  }) as Prisma.InputJsonValue
}

function navigationUses(value: Prisma.JsonValue | null, field: 'categories' | 'items', name: string) {
  if (!Array.isArray(value)) return false
  return value.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const items = (entry as Record<string, Prisma.JsonValue>)[field]
    return Array.isArray(items) && items.some((item) => typeof item === 'string' && normalize(item) === normalize(name))
  })
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const categories = await this.prisma.category.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } })
    return Promise.all(categories.map(async (category) => ({
      ...category,
      productCount: await this.prisma.product.count({
        where: { deletedAt: null, OR: [{ category: category.name }, { categories: { has: category.name } }] },
      }),
    })))
  }

  async create(body: any) {
    const name = String(body.name || '').trim()
    const normalizedName = normalize(name)
    if (!name) throw new NotFoundException('El nombre de la categoria es obligatorio')
    if (await this.prisma.category.findUnique({ where: { normalizedName } })) throw new ConflictException('La categoria ya existe')
    return this.prisma.category.create({ data: { name, normalizedName, slug: slug(name), description: body.description || '', active: body.active !== false } })
  }

  async update(id: string, body: any) {
    const current = await this.prisma.category.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Categoria no encontrada')

    const name = String(body.name || current.name).trim()
    const normalizedName = normalize(name)
    const duplicate = await this.prisma.category.findUnique({ where: { normalizedName } })
    if (duplicate && duplicate.id !== current.id) throw new ConflictException('La categoria ya existe')

    return this.prisma.$transaction(async (transaction) => {
      const products = await transaction.product.findMany({
        where: { deletedAt: null, OR: [{ category: current.name }, { categories: { has: current.name } }] },
        select: { id: true, category: true, categories: true },
      })

      for (const product of products) {
        await transaction.product.update({
          where: { id: product.id },
          data: {
            category: normalize(product.category) === normalize(current.name) ? name : product.category,
            categories: product.categories.map((item) => normalize(item) === normalize(current.name) ? name : item),
          },
        })
      }

      const settings = await transaction.settings.findFirst()
      if (settings) {
        const replacement = body.active === false ? null : name
        await transaction.settings.update({
          where: { id: settings.id },
          data: {
            navigationBrands: transformNavigation(settings.navigationBrands, 'categories', current.name, replacement),
            navigationDisciplines: transformNavigation(settings.navigationDisciplines, 'items', current.name, replacement),
          },
        })
      }

      return transaction.category.update({
        where: { id },
        data: {
          name,
          normalizedName,
          slug: slug(name),
          description: body.description ?? current.description,
          active: body.active ?? current.active,
        },
      })
    })
  }

  async remove(id: string) {
    const current = await this.prisma.category.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Categoria no encontrada')

    const count = await this.prisma.product.count({ where: { deletedAt: null, OR: [{ category: current.name }, { categories: { has: current.name } }] } })
    if (count) throw new ConflictException('No podes eliminar una categoria asignada a productos')

    const settings = await this.prisma.settings.findFirst()
    if (settings && (navigationUses(settings.navigationBrands, 'categories', current.name) || navigationUses(settings.navigationDisciplines, 'items', current.name))) {
      throw new ConflictException('No podes eliminar una categoria usada en el menu de la tienda')
    }

    return this.prisma.category.update({ where: { id }, data: { deletedAt: new Date(), active: false } })
  }
}
