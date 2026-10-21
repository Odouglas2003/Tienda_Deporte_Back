import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AccountType, ApprovalStatus, Prisma, User, UserRole } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
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

  async approve(id: string, password: string, sellerId: string | undefined, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    if (user.accountType !== 'mayorista') throw new BadRequestException('Solo se pueden aprobar cuentas mayoristas')
    const updated = await this.prisma.user.update({ where: { id }, data: { approved: true, approvalStatus: 'approved', assignedSellerId: sellerId || null, password: await bcrypt.hash(password, 10), mustChangePassword: true }, include: { assignedSeller: { select: { id: true, name: true } } } })
    await this.prisma.activityLog.create({ data: { userId: actorId, action: 'Aprobación de mayorista', entity: 'user', metadata: { userId: id, sellerId: sellerId || '' } } })
    return this.safe(updated)
  }

  async reject(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    const updated = await this.prisma.user.update({ where: { id }, data: { approved: false, approvalStatus: 'rejected' }, include: { assignedSeller: { select: { id: true, name: true } } } })
    await this.prisma.activityLog.create({ data: { userId: actorId, action: 'Rechazo de mayorista', entity: 'user', metadata: { userId: id } } })
    return this.safe(updated)
  }
}
