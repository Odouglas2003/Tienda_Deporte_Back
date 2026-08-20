import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const slug = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}
  async list() {
    const categories = await this.prisma.category.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } })
    return Promise.all(categories.map(async (category) => ({ ...category, productCount: await this.prisma.product.count({ where: { deletedAt: null, OR: [{ category: category.name }, { categories: { has: category.name } }] } }) })))
  }
  async create(body: any) {
    const name = String(body.name || '').trim(); const normalizedName = normalize(name)
    if (!name) throw new NotFoundException('El nombre de la categoria es obligatorio')
    if (await this.prisma.category.findUnique({ where: { normalizedName } })) throw new ConflictException('La categoria ya existe')
    return this.prisma.category.create({ data: { name, normalizedName, slug: slug(name), description: body.description || '', active: body.active !== false } })
  }
  async update(id: string, body: any) { const current = await this.prisma.category.findUnique({ where: { id } }); if (!current) throw new NotFoundException('Categoria no encontrada'); const name = String(body.name || current.name).trim(); return this.prisma.category.update({ where: { id }, data: { name, normalizedName: normalize(name), slug: slug(name), description: body.description ?? current.description, active: body.active ?? current.active } }) }
  async remove(id: string) { const current = await this.prisma.category.findUnique({ where: { id } }); if (!current) throw new NotFoundException('Categoria no encontrada'); const count = await this.prisma.product.count({ where: { deletedAt: null, OR: [{ category: current.name }, { categories: { has: current.name } }] } }); if (count) throw new ConflictException('No podes eliminar una categoria asignada a productos'); return this.prisma.category.update({ where: { id }, data: { deletedAt: new Date(), active: false } }) }
}
