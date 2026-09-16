import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { OrderStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { AuthService } from '../auth/auth.service'
import * as bcrypt from 'bcryptjs'

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  list(auth: any) {
    const where: any = { deletedAt: null }
    if (auth.role === 'cliente') where.userId = auth.sub
    if (auth.role === 'vendedor') where.sellerId = auth.sub
    return this.prisma.order.findMany({ where, include: { user: { select: { id: true, name: true, email: true, accountType: true } }, seller: { select: { id: true, name: true } }, items: true }, orderBy: { createdAt: 'desc' } })
  }

  async create(auth: any | null, payload: any) {
    const user = auth ? await this.prisma.user.findUnique({ where: { id: auth.sub } }) : null
    if (auth && !user) throw new NotFoundException('Usuario no encontrado')
    const customer = payload.customer && typeof payload.customer === 'object' ? payload.customer : {}
    const firstName = String(customer.firstName ?? '').trim()
    const lastName = String(customer.lastName ?? '').trim()
    const email = String(customer.email ?? '').trim().toLowerCase()
    if (!auth && (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new BadRequestException('Completá nombre, apellido y un email válido')
    }
    const createAccount = !auth && customer.createAccount === true
    const password = String(customer.password ?? '')
    if (createAccount && password.length < 6) throw new BadRequestException('La contraseña debe tener al menos 6 caracteres')
    if (createAccount && await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('El email ya se encuentra registrado. Iniciá sesión para comprar con tu cuenta.')
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
      const discount = Number(product.discount)
      const retailDiscount = Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 0
      const unitPrice = user?.accountType === 'mayorista' && user.approved
        ? wholesalePrice
        : Math.round(retailPrice * (1 - retailDiscount / 100) * 100) / 100
      return { productId: product.id, productName: product.name, variantSku: variant?.sku ?? variantSku, selectedColor, selectedSize, selectedGender, quantity, unitPrice, subtotal: unitPrice * quantity }
    })
    const subtotal = items.reduce((sum: number, item: { subtotal: number }) => sum + item.subtotal, 0)
    const settings = await this.prisma.settings.findFirst()
    if (user?.accountType === 'mayorista' && user.approved && settings?.minWholesaleOrder && subtotal < settings.minWholesaleOrder) {
      throw new BadRequestException(`El pedido mayorista mínimo es de $${settings.minWholesaleOrder.toLocaleString('es-AR')}`)
    }
    const generalTaxRate = Number(settings?.taxPercentage) > 0 ? Number(settings?.taxPercentage) : 21
    const taxAmount = items.reduce((sum: number, item: { productId: string; subtotal: number }) => {
      const productRate = Number(map.get(item.productId)?.tax)
      const rate = Number.isFinite(productRate) && productRate > 0 ? productRate : generalTaxRate
      return sum + Math.round(item.subtotal * rate) / 100
    }, 0)
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replaceAll('-', '')
    const code = `PED-${datePart}-${now.getTime().toString().slice(-6)}`
    const result = await this.prisma.$transaction(async (tx) => {
      const account = createAccount ? await tx.user.create({ data: {
        name: `${firstName} ${lastName}`, email, phone: String(shipping.phone).trim(),
        password: await bcrypt.hash(password, 10), role: 'cliente', accountType: 'minorista', approved: true, approvalStatus: 'approved',
      } }) : null
      for (const [productId, quantity] of requestedStock) {
        await tx.product.update({ where: { id: productId }, data: { stock: { decrement: quantity }, variants: variantsByProduct.get(productId) as Prisma.InputJsonValue } })
      }
      const order = await tx.order.create({
        data: { code, userId: user?.id ?? account?.id, customerName: user?.name ?? `${firstName} ${lastName}`, customerEmail: user?.email ?? email, sellerId: user?.assignedSellerId, items: { create: items }, total: subtotal + taxAmount, shippingCost: 0, taxAmount, paymentMethod: payload.paymentMethod, shipping },
        include: {
          user: { select: { id: true, name: true, email: true, accountType: true } },
          seller: { select: { id: true, name: true } },
          items: true,
        },
      })
      await tx.activityLog.create({ data: { userId: user?.id ?? account?.id, action: 'Creacion de pedido', entity: 'order', metadata: { orderId: order.id, code } } })
      return { order, account }
    })
    return result.account ? { order: result.order, session: this.auth.createSession(result.account) } : { order: result.order }
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
