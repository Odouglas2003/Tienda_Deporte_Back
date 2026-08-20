import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { OrderStatus } from '@prisma/client'
import { PrismaService } from '../prisma.service'

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: any) {
    const where: any = { deletedAt: null }
    if (auth.role === 'cliente') where.userId = auth.sub
    if (auth.role === 'vendedor') where.sellerId = auth.sub
    return this.prisma.order.findMany({ where, include: { user: { select: { id: true, name: true, email: true, accountType: true } }, seller: { select: { id: true, name: true } }, items: true }, orderBy: { createdAt: 'desc' } })
  }

  async create(auth: any, payload: any) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.sub } })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    if (!Array.isArray(payload.items) || !payload.items.length) throw new BadRequestException('El pedido debe tener productos')
    const ids = payload.items.map((item: any) => item.product)
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, active: true, deletedAt: null } })
    const map = new Map(products.map((product) => [product.id, product]))
    const items = payload.items.map((item: any) => {
      const product = map.get(item.product)
      const quantity = Number(item.quantity)
      if (!product) throw new NotFoundException('Uno de los productos no existe')
      if (!Number.isInteger(quantity) || quantity < 1 || product.stock < quantity) throw new BadRequestException(`Stock insuficiente para ${product.name}`)
      const unitPrice = user.accountType === 'mayorista' && user.approved ? product.priceWholesale : product.priceRetail
      return { productId: product.id, productName: product.name, quantity, unitPrice, subtotal: unitPrice * quantity }
    })
    const subtotal = items.reduce((sum: number, item: { subtotal: number }) => sum + item.subtotal, 0)
    const shippingCost = subtotal > 100000 ? 0 : 5000
    const code = `PED-${Date.now().toString().slice(-8)}`
    return this.prisma.$transaction(async (tx) => {
      for (const item of items) await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } })
      const order = await tx.order.create({ data: { code, userId: user.id, sellerId: user.assignedSellerId, items: { create: items }, total: subtotal + shippingCost, shippingCost, paymentMethod: payload.paymentMethod, shipping: payload.shipping ?? undefined }, include: { items: true } })
      await tx.activityLog.create({ data: { userId: user.id, action: 'Creacion de pedido', entity: 'order', metadata: { orderId: order.id, code } } })
      return order
    })
  }

  async updateStatus(id: string, status: string, actorId: string) {
    const exists = await this.prisma.order.findUnique({ where: { id } })
    if (!exists) throw new NotFoundException('Pedido no encontrado')
    const mapped = status.replace(' ', '_') as OrderStatus
    const order = await this.prisma.order.update({ where: { id }, data: { status: mapped } })
    await this.prisma.activityLog.create({ data: { userId: actorId, action: 'Cambio de estado de pedido', entity: 'order', metadata: { orderId: id, status } } })
    return order
  }
}
