import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** Carritos guardados de clientes con sesión, para que el admin vea quién dejó productos sin comprar. */
@Injectable()
export class CartsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, rawItems: unknown) {
    if (!Array.isArray(rawItems)) throw new BadRequestException('Carrito inválido')
    const items = rawItems.slice(0, 100).map((item: any) => ({
      productId: text(item?.productId, 60),
      name: text(item?.name, 160),
      variantSku: text(item?.variantSku, 80),
      color: text(item?.color, 60),
      size: text(item?.size, 30),
      quantity: Math.min(999, Math.max(1, Math.floor(Number(item?.quantity) || 1))),
      price: Math.max(0, Number(item?.price) || 0),
    })).filter((item) => item.productId && item.name)
    if (!items.length) {
      await this.prisma.savedCart.deleteMany({ where: { userId } })
      return { saved: false }
    }
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
    const total = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100
    await this.prisma.savedCart.upsert({
      where: { userId },
      update: { items: items as Prisma.InputJsonValue, itemCount, total },
      create: { userId, items: items as Prisma.InputJsonValue, itemCount, total },
    })
    return { saved: true }
  }

  /** Carritos con productos que no se tocan hace al menos `minutes` minutos (por defecto 30). */
  async abandoned(minutes = 30, onlyWholesale = false) {
    const since = new Date(Date.now() - Math.max(5, Math.min(minutes, 60 * 24 * 30)) * 60000)
    const carts = await this.prisma.savedCart.findMany({
      where: { updatedAt: { lt: since }, itemCount: { gt: 0 }, user: { deletedAt: null, active: true, ...(onlyWholesale ? { accountType: 'mayorista' } : {}) } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, name: true, email: true, phone: true, accountType: true, approved: true, businessName: true } } },
    })
    return carts.map((cart) => ({ userId: cart.userId, user: cart.user, items: cart.items, itemCount: cart.itemCount, total: cart.total, updatedAt: cart.updatedAt }))
  }
}
