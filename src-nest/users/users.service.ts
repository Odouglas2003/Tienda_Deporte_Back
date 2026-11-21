import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AccountType, ApprovalStatus, Prisma, User, UserRole } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { sendEmail, simpleEmailHtml, storeUrl } from '../mail'
import { PrismaService } from '../prisma.service'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private safe(user: User & { assignedSeller?: { id: string; name: string } | null }) {
    const { password: _password, ...result } = user
    return { ...result, assignedSellerId: user.assignedSeller?.id ?? user.assignedSellerId, assignedSellerName: user.assignedSeller?.name }
  }

  async list(filters: { role?: UserRole; accountType?: AccountType; approvalStatus?: ApprovalStatus; search?: string }) {
    const where: Prisma.UserWhereInput = { deletedAt: null }
    if (filters.role) where.role = filters.role
    if (filters.accountType) where.accountType = filters.accountType
    if (filters.approvalStatus) where.approvalStatus = filters.approvalStatus
    if (filters.search) where.OR = [{ name: { contains: filters.search, mode: 'insensitive' } }, { email: { contains: filters.search, mode: 'insensitive' } }]
    const users = await this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, include: { assignedSeller: { select: { id: true, name: true } } } })
    return users.map((user) => this.safe(user))
  }

  async listAssignedClients(sellerId: string) {
    const users = await this.prisma.user.findMany({ where: { assignedSellerId: sellerId, deletedAt: null }, orderBy: { createdAt: 'desc' }, include: { assignedSeller: { select: { id: true, name: true } } } })
    return users.map((user) => this.safe(user))
  }

  async createSeller(payload: { name: string; email: string; phone?: string }, actorId: string) {
    const email = payload.email.toLowerCase().trim()
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('El email ya se encuentra registrado')
    const name = payload.name.trim()
    if (name.length < 6) throw new BadRequestException('El nombre completo debe tener al menos 6 caracteres')
    // Clave temporal aleatoria (sin caracteres ambiguos); el vendedor la cambia en su primer ingreso.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const temporaryPassword = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('')
    const user = await this.prisma.user.create({ data: { name, email, phone: payload.phone?.trim() ?? '', password: await bcrypt.hash(temporaryPassword, 10), role: 'vendedor', accountType: 'minorista', approved: true, approvalStatus: 'approved', mustChangePassword: true } })
    await this.prisma.activityLog.create({ data: { userId: actorId, action: 'Alta de vendedor', entity: 'user', metadata: { userId: user.id, email } } })
    return { user: this.safe(user), temporaryPassword }
  }

  /**
   * Aprueba la cuenta mayorista y le manda un correo con un enlace para que elija su contraseña.
   * Si el correo no sale, devuelve el enlace para que el admin se lo pase por WhatsApp.
   */
  async approve(id: string, sellerId: string | undefined, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user || user.deletedAt) throw new NotFoundException('Usuario no encontrado')
    if (user.accountType !== 'mayorista') throw new BadRequestException('Solo se pueden aprobar cuentas mayoristas')
    if (sellerId) {
      const seller = await this.prisma.user.findUnique({ where: { id: sellerId } })
      if (!seller || seller.role !== 'vendedor' || !seller.active || seller.deletedAt) throw new BadRequestException('El vendedor elegido no existe o está inactivo')
    }
    const token = randomBytes(32).toString('hex')
    const link = `${storeUrl()}/recuperar-password?token=${token}&bienvenida=1`
    const lockedPassword = await bcrypt.hash(randomBytes(24).toString('hex'), 10)
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id },
        // La clave anterior deja de servir: el mayorista crea la suya desde el enlace.
        data: { approved: true, approvalStatus: 'approved', assignedSellerId: sellerId || null, password: lockedPassword, mustChangePassword: false, sessionsValidFrom: new Date() },
        include: { assignedSeller: { select: { id: true, name: true } } },
      })
      await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } })
      await tx.passwordResetToken.create({ data: { userId: id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60000) } })
      await tx.activityLog.create({ data: { userId: actorId, action: 'Aprobación de mayorista', entity: 'user', metadata: { userId: id, sellerId: sellerId || '' } } })
      return saved
    })
    const firstName = user.name.split(' ')[0]
    const emailSent = await sendEmail({
      to: user.email,
      subject: '¡Tu cuenta mayorista de NEZHA fue aprobada!',
      text: `Hola ${firstName}.\n\nTu cuenta mayorista fue aprobada. Creá tu contraseña desde este enlace (vence en 7 días) y ya vas a ver los precios mayoristas:\n${link}\n\nCualquier duda, respondé este correo o escribinos por WhatsApp.`,
      html: simpleEmailHtml('¡Tu cuenta mayorista fue aprobada!', [`Hola ${firstName}.`, 'Ya podés comprar con precios mayoristas en NEZHA. Tocá el botón, elegí tu contraseña y listo: entrás directo a la tienda.'], { label: 'Crear mi contraseña', url: link }, 'El enlace vence en 7 días. Si vence, usá "Olvidé mi contraseña" en el ingreso.'),
      idempotencyKey: `wholesale-approved/${id}/${token.slice(0, 12)}`,
    })
    return { user: this.safe(updated), emailSent, setupLink: emailSent ? undefined : link }
  }

  /** Ficha completa de un usuario: datos de la cuenta, teléfonos y direcciones usadas, y sus pedidos. */
  async details(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { assignedSeller: { select: { id: true, name: true } } } })
    if (!user || user.deletedAt) throw new NotFoundException('Usuario no encontrado')
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ userId: id }, { customerEmail: user.email }], deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, status: true, total: true, createdAt: true, shipping: true, paymentMethod: true },
    })
    const closed = ['cancelado', 'rechazado']
    const addresses = Array.from(new Set(orders.map((order) => {
      const shipping = (order.shipping ?? {}) as { method?: string; address?: string; city?: string; postalCode?: string }
      return shipping.method === 'pickup' ? '' : [shipping.address, shipping.city, shipping.postalCode].filter(Boolean).join(', ')
    }).filter(Boolean)))
    const phones = Array.from(new Set([user.phone, ...orders.map((order) => String((order.shipping as { phone?: string } | null)?.phone ?? ''))].map((phone) => phone.trim()).filter(Boolean)))
    return {
      user: this.safe(user),
      phones,
      addresses,
      stats: {
        orders: orders.length,
        spent: Math.round(orders.filter((order) => !closed.includes(order.status)).reduce((sum, order) => sum + order.total, 0) * 100) / 100,
        lastOrderAt: orders[0]?.createdAt ?? null,
      },
      orders: orders.slice(0, 20).map(({ shipping: _shipping, ...order }) => order),
    }
  }

  /**
   * Elimina la cuenta: deja de poder entrar y desaparece de las listas. Los pedidos quedan guardados
   * para la contabilidad. El email se libera para que la persona pueda volver a registrarse.
   */
  async remove(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('No podés eliminar tu propia cuenta')
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user || user.deletedAt) throw new NotFoundException('Usuario no encontrado')
    if (user.role === 'admin' || user.role === 'superAdmin') throw new BadRequestException('Las cuentas de administrador no se eliminan desde el panel')
    const lockedPassword = await bcrypt.hash(randomBytes(24).toString('hex'), 10)
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { assignedSellerId: id }, data: { assignedSellerId: null } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), active: false, email: `eliminado-${id}@nezha.invalid`, password: lockedPassword, assignedSellerId: null, sessionsValidFrom: new Date() },
      }),
      this.prisma.activityLog.create({ data: { userId: actorId, action: 'Eliminación de cuenta', entity: 'user', metadata: { userId: id, email: user.email, name: user.name, role: user.role } } }),
    ])
    return { ok: true }
  }

  async reject(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    const updated = await this.prisma.user.update({ where: { id }, data: { approved: false, approvalStatus: 'rejected' }, include: { assignedSeller: { select: { id: true, name: true } } } })
    await this.prisma.activityLog.create({ data: { userId: actorId, action: 'Rechazo de mayorista', entity: 'user', metadata: { userId: id } } })
    return this.safe(updated)
  }
}
