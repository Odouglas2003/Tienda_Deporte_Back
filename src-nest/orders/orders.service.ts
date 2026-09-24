import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { OrderStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { AuthService } from '../auth/auth.service'
import * as bcrypt from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import { buildOrderStatusEmail } from './order-approval.template'
import { VatRatesService, productVatRate } from '../tax/vat-rates.service'

const orderDetails = {
  user: { select: { id: true, name: true, email: true, accountType: true } },
  seller: { select: { id: true, name: true } },
  items: { include: { product: { select: { images: true, variants: true } } } },
  emailNotifications: { select: { kind: true, status: true, sentAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly vatRates: VatRatesService) {}

  list(auth: any) {
    const where: any = { deletedAt: null }
    if (auth.role === 'cliente') where.userId = auth.sub
    if (auth.role === 'vendedor') where.sellerId = auth.sub
    return this.prisma.order.findMany({ where, include: orderDetails, orderBy: { createdAt: 'desc' } })
  }

  async create(auth: any | null, payload: any) {
    const key = payload?.requestKey
    if (key === undefined) return this.createOnce(auth, payload)
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(key)) throw new BadRequestException('Identificador de compra inválido')
    if (auth) {
      const user = await this.prisma.user.findUnique({ where: { id: auth.sub } })
      if (!user || !user.active || user.deletedAt) throw new ForbiddenException('La cuenta no está habilitada para comprar')
    }
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    const customer = payload.customer ?? {}
    const request = {
      keyHash: hash(key),
      ownerHash: hash(auth ? 'user:' + auth.sub : 'guest:' + String(customer.email ?? '').trim().toLowerCase()),
      fingerprint: hash(JSON.stringify({ items: payload.items, paymentMethod: payload.paymentMethod, shipping: payload.shipping, expectedTotal: payload.expectedTotal,
        customer: auth ? undefined : { firstName: customer.firstName, lastName: customer.lastName, email: String(customer.email ?? '').trim().toLowerCase(), createAccount: customer.createAccount === true } })),
    }
    const replay = async () => {
      const saved = await this.prisma.checkoutRequest.findUnique({ where: { keyHash: request.keyHash }, include: { order: { include: orderDetails } } })
      if (!saved) return null
      if (saved.ownerHash !== request.ownerHash) throw new ConflictException('Esta compra pertenece a otra sesión. Revisá el pedido anterior antes de continuar.')
      if (!saved.order) throw new ConflictException('La compra todavía se está procesando. Volvé a intentar.')
      let session
      if (!auth && customer.createAccount === true && saved.order.userId && typeof customer.password === 'string') {
        const account = await this.prisma.user.findUnique({ where: { id: saved.order.userId } })
        if (account?.active && !account.deletedAt && await bcrypt.compare(customer.password, account.password)) session = this.auth.createSession(account)
      }
      return { order: saved.order, session, replayed: true, requestMatches: saved.fingerprint === request.fingerprint }
    }
    const existing = await replay()
    if (existing) return existing
    if (payload.recoverOnly === true) return { order: null }
    try { return await this.createOnce(auth, payload, request) }
    catch (error) {
      // A concurrent insert waits on the unique key; after rollback the committed winner is safe to return.
      const completed = await replay()
      if (completed) return completed
      throw error
    }
  }

  private async createOnce(auth: any | null, payload: any, request?: { keyHash: string; ownerHash: string; fingerprint: string }) {
    const user = auth ? await this.prisma.user.findUnique({ where: { id: auth.sub } }) : null
    if (auth && (!user || !user.active || user.deletedAt)) throw new ForbiddenException('La cuenta no está habilitada para comprar')
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
    if (!['transfer', 'transferencia', 'cash', 'check'].includes(payload.paymentMethod)) throw new BadRequestException('Seleccioná un medio de pago válido')
    if (payload.paymentMethod === 'check' && !(user?.accountType === 'mayorista' && user.approved)) throw new BadRequestException('El cheque electrónico está disponible solo para mayoristas aprobados')

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
      return { productId: product.id, productName: product.name, image: variant?.image || product.images[0] || '', variantSku: variant?.sku ?? variantSku, selectedColor: selectedColor || variant?.color || '', selectedSize: selectedSize || variant?.size || '', selectedGender: selectedGender || variant?.gender || '', quantity, unitPrice, subtotal: unitPrice * quantity }
    })
    const subtotal = items.reduce((sum: number, item: { subtotal: number }) => sum + item.subtotal, 0)
    const settings = await this.prisma.settings.findFirst()
    if (user?.accountType === 'mayorista' && user.approved && settings?.minWholesaleOrder && subtotal < settings.minWholesaleOrder) {
      throw new BadRequestException(`El pedido mayorista mínimo es de $${settings.minWholesaleOrder.toLocaleString('es-AR')}`)
    }
    const generalTaxRate = (await this.vatRates.getGeneralRate(Number(settings?.taxPercentage))).rate
    const taxAmount = items.reduce((sum: number, item: { productId: string; subtotal: number }) => {
      const productRate = Number(map.get(item.productId)?.tax)
      const rate = productVatRate(productRate, generalTaxRate)
      return sum + Math.round(item.subtotal * rate) / 100
    }, 0)
    if (payload.expectedTotal !== undefined && (typeof payload.expectedTotal !== 'number' || !Number.isFinite(payload.expectedTotal) || Math.abs(payload.expectedTotal - (subtotal + taxAmount)) >= 0.01)) {
      throw new ConflictException('El importe cambió. Actualizá el carrito y revisá el total antes de confirmar.')
    }
    const now = new Date()
    const datePart = now.toISOString().slice(0, 10).replaceAll('-', '')
    const code = `PED-${datePart}-${randomUUID().slice(0, 8).toUpperCase()}`
    const result = await this.prisma.$transaction(async (tx) => {
      if (request) await tx.checkoutRequest.create({ data: request })
      const account = createAccount ? await tx.user.create({ data: {
        name: `${firstName} ${lastName}`, email, phone: String(shipping.phone).trim(),
        password: await bcrypt.hash(password, 10), role: 'cliente', accountType: 'minorista', approved: true, approvalStatus: 'approved',
      } }) : null
      for (const [productId, quantity] of [...requestedStock].sort(([a], [b]) => a.localeCompare(b))) {
        const snapshot = map.get(productId)!
        const changed = await tx.product.updateMany({
          where: { id: productId, active: true, deletedAt: null, updatedAt: snapshot.updatedAt, stock: snapshot.stock, variants: { equals: snapshot.variants as Prisma.InputJsonValue } },
          data: { stock: { decrement: quantity }, variants: variantsByProduct.get(productId) as Prisma.InputJsonValue },
        })
        if (!changed.count) throw new ConflictException('El stock o el precio cambió durante la compra. Actualizá el carrito y volvé a intentar.')
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
      if (request) await tx.checkoutRequest.update({ where: { keyHash: request.keyHash }, data: { orderId: order.id } })
      return { order, account }
    })
    return result.account ? { order: result.order, session: this.auth.createSession(result.account) } : { order: result.order }
  }

  async updateStatus(id: string, status: string, actorId: string) {
    const mapped = typeof status === 'string' ? status.trim().replaceAll(' ', '_') : ''
    if (!Object.values(OrderStatus).includes(mapped as OrderStatus)) throw new BadRequestException('Estado de pedido inválido')
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } })
    if (!actor || !actor.active || actor.deletedAt || !['admin', 'superAdmin', 'vendedor'].includes(actor.role)) throw new ForbiddenException('No tenés permiso para actualizar pedidos')
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.order.findUnique({ where: { id }, include: { items: true } })
      if (!exists || exists.deletedAt) throw new NotFoundException('Pedido no encontrado')
      if (actor.role === 'vendedor' && exists.sellerId !== actorId) throw new ForbiddenException('Solo podés actualizar pedidos de tus clientes')
      if (exists.status === mapped) return tx.order.findUnique({ where: { id }, include: orderDetails })
      if (['cancelado', 'rechazado', 'entregado'].includes(exists.status)) throw new BadRequestException('El pedido está cerrado y no se puede reabrir')
      if (exists.status === OrderStatus.enviado && mapped !== OrderStatus.entregado) throw new BadRequestException('Un pedido despachado solo puede pasar a entregado; las devoluciones requieren revisar la mercadería')
      const changed = await tx.order.updateMany({ where: { id, status: exists.status }, data: { status: mapped as OrderStatus } })
      if (!changed.count) throw new ConflictException('El pedido cambió. Recargá antes de actualizarlo.')
      if (mapped === OrderStatus.cancelado || mapped === OrderStatus.rechazado) {
        const productIds = [...new Set(exists.items.map(item => item.productId))].sort()
        for (const productId of productIds) {
          const product = await tx.product.findUnique({ where: { id: productId } })
          if (!product) throw new ConflictException('No se puede reponer el stock: falta un producto del pedido')
          const variants = Array.isArray(product.variants) ? (product.variants as Array<any>).map(variant => ({ ...variant })) : []
          const lines = exists.items.filter(item => item.productId === productId)
          for (const item of lines) {
            if (variants.length) {
              const variant = variants.find(variant => variant.sku === item.variantSku)
              if (!variant) throw new ConflictException('No se puede reponer el stock: cambió una variante del pedido. Revisá el producto antes de cancelar.')
              variant.stock = Number(variant.stock) + item.quantity
            }
          }
          const restored = await tx.product.updateMany({
            where: { id: productId, stock: product.stock, updatedAt: product.updatedAt, variants: { equals: product.variants as Prisma.InputJsonValue } },
            data: { stock: { increment: lines.reduce((sum, item) => sum + item.quantity, 0) }, variants: variants as Prisma.InputJsonValue },
          })
          if (!restored.count) throw new ConflictException('El stock cambió. Volvé a intentar la cancelación.')
        }
      }
      const order = await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetails })
      // One durable notification per order and milestone, committed with the new status.
      const kind = mapped === OrderStatus.en_preparacion ? 'approval' : mapped === OrderStatus.enviado ? 'shipped' : mapped === OrderStatus.entregado ? 'delivered' : null
      if (kind) {
        await tx.orderApprovalEmail.upsert({
          where: { orderId_kind: { orderId: id, kind } }, update: {},
          create: { orderId: id, kind, payload: buildOrderStatusEmail(order, kind) as unknown as Prisma.InputJsonValue },
        })
      }
      if (mapped === OrderStatus.cancelado || mapped === OrderStatus.rechazado) {
        await tx.orderApprovalEmail.updateMany({ where: { orderId: id, status: 'pending' }, data: { status: 'cancelled' } })
      }
      await tx.activityLog.create({ data: { userId: actorId, action: 'Cambio de estado de pedido', entity: 'order', metadata: { orderId: id, previousStatus: exists.status, status: mapped } } })
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderDetails })
    })
  }
}
