import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { OrderStatus, Prisma } from '@prisma/client'
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
    if (!String(payload.paymentMethod ?? '').trim()) throw new BadRequestException('Seleccioná un medio de pago')

    const shipping = payload.shipping && typeof payload.shipping === 'object' ? payload.shipping : {}
    const missingShippingFields = [
      !String(shipping.address ?? '').trim() && 'dirección',
      !String(shipping.city ?? '').trim() && 'ciudad',
      !String(shipping.postalCode ?? '').trim() && 'código postal',
      !String(shipping.phone ?? '').trim() && 'teléfono',
    ].filter(Boolean)
    if (missingShippingFields.length) throw new BadRequestException(`Faltan datos de envío: ${missingShippingFields.join(', ')}`)
    const ids = payload.items.map((item: any) => item.product)
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, active: true, deletedAt: null } })
    const map = new Map(products.map((product) => [product.id, product]))
    const variantsByProduct = new Map(products.map((product) => [product.id, Array.isArray(product.variants) ? (product.variants as Array<any>).map((variant) => ({ ...variant })) : []]))
    const requestedStock = new Map<string, number>()
    const items = payload.items.map((item: any) => {
      const product = map.get(item.product)
      const quantity = Number(item.quantity)
      if (!product) throw new NotFoundException('Uno de los productos no existe')
      const totalRequested = (requestedStock.get(product.id) ?? 0) + quantity
      if (!Number.isInteger(quantity) || quantity < 1 || product.stock < totalRequested) throw new BadRequestException(`Stock insuficiente para ${product.name}`)
      requestedStock.set(product.id, totalRequested)

      const variants = variantsByProduct.get(product.id) ?? []
      const selectedColor = String(item.selectedColor ?? '')
      const selectedSize = String(item.selectedSize ?? '')
      const selectedGender = String(item.selectedGender ?? '')
      const variantSku = String(item.variantSku ?? '')
      const variantIndex = variants.findIndex((variant) =>
        (variantSku ? variant.sku === variantSku : true) &&
        (selectedColor ? String(variant.color ?? '').split('/').map((color) => color.trim()).includes(selectedColor) : true) &&
        (selectedSize ? variant.size === selectedSize : true)
        && (selectedGender ? variant.gender === selectedGender : true)
      )
      const variant = variantIndex >= 0 ? variants[variantIndex] : null
      if (variants.length > 0 && !variant) throw new BadRequestException(`Seleccioná una variante válida para ${product.name}`)
      if (variant && Number(variant.stock) < quantity) throw new BadRequestException(`Stock insuficiente para ${product.name} (${selectedColor || selectedSize})`)
      if (variant) variants[variantIndex] = { ...variant, stock: Number(variant.stock) - quantity }

      const retailPrice = variant?.priceRetail ?? product.priceRetail
      const wholesalePrice = variant?.priceWholesale ?? product.priceWholesale
      const unitPrice = user.accountType === 'mayorista' && user.approved ? wholesalePrice : retailPrice
      return { productId: product.id, productName: product.name, variantSku: variant?.sku ?? variantSku, selectedColor, selectedSize, selectedGender, quantity, unitPrice, subtotal: unitPrice * quantity }
    })
    const subtotal = items.reduce((sum: number, item: { subtotal: number }) => sum + item.subtotal, 0)
    const settings = await this.prisma.settings.findFirst()
    if (user.accountType === 'mayorista' && user.approved && settings?.minWholesaleOrder && subtotal < settings.minWholesaleOrder) {
      throw new BadRequestException(`El pedido mayorista mínimo es de $${settings.minWholesaleOrder.toLocaleString('es-AR')}`)
    }
    const shippingCost = subtotal > 100000 ? 0 : 5000
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replaceAll('-', '')
    const code = `PED-${datePart}-${now.getTime().toString().slice(-6)}`
    return this.prisma.$transaction(async (tx) => {
      for (const [productId, quantity] of requestedStock) {
        await tx.product.update({ where: { id: productId }, data: { stock: { decrement: quantity }, variants: variantsByProduct.get(productId) as Prisma.InputJsonValue } })
      }
      const order = await tx.order.create({
        data: { code, userId: user.id, sellerId: user.assignedSellerId, items: { create: items }, total: subtotal + shippingCost, shippingCost, paymentMethod: payload.paymentMethod, shipping },
        include: {
          user: { select: { id: true, name: true, email: true, accountType: true } },
          seller: { select: { id: true, name: true } },
          items: true,
        },
      })
      await tx.activityLog.create({ data: { userId: user.id, action: 'Creacion de pedido', entity: 'order', metadata: { orderId: order.id, code } } })
      return order
    })
  }

  async updateStatus(id: string, status: string, actorId: string) {
    const exists = await this.prisma.order.findUnique({ where: { id } })
    if (!exists) throw new NotFoundException('Pedido no encontrado')
    const mapped = status.replace(' ', '_') as OrderStatus
    const order = await this.prisma.order.update({
      where: { id },
      data: { status: mapped },
      include: {
        user: { select: { id: true, name: true, email: true, accountType: true } },
        seller: { select: { id: true, name: true } },
        items: true,
      },
    })
    await this.prisma.activityLog.create({ data: { userId: actorId, action: 'Cambio de estado de pedido', entity: 'order', metadata: { orderId: id, status } } })
    return order
  }
}
