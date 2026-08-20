import { ConflictException, Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma.service'
import { AccountType, User, UserRole } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

type PublicUser = Omit<User, 'password'> & { assignedSellerName?: string }

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  private serialize(user: User & { assignedSeller?: { name: string } | null }): PublicUser {
    const { password: _password, ...safe } = user
    return { ...safe, assignedSellerName: user.assignedSeller?.name }
  }

  private token(user: User) {
    return this.jwt.sign({ sub: user.id, role: user.role, email: user.email })
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { assignedSeller: { select: { name: true } } } })
    if (!user || !(await bcrypt.compare(password, user.password))) throw new UnauthorizedException('Credenciales invalidas')
    if (!user.active) throw new ForbiddenException('La cuenta se encuentra inactiva')
    if (user.accountType === AccountType.mayorista && !user.approved) throw new ForbiddenException('La cuenta mayorista aun no fue aprobada')
    await this.prisma.activityLog.create({ data: { userId: user.id, action: 'Login', entity: 'auth' } })
    return { user: this.serialize(user), token: this.token(user) }
  }

  async register(payload: { name: string; email: string; password?: string; phone: string; accountType: AccountType; businessName?: string; cuit?: string }) {
    const email = payload.email.toLowerCase().trim()
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('El email ya se encuentra registrado')
    const wholesale = payload.accountType === AccountType.mayorista
    const rawPassword = wholesale ? randomBytes(16).toString('hex') : payload.password
    if (!rawPassword || rawPassword.length < 6) throw new BadRequestException('La contrasena debe tener al menos 6 caracteres')
    const user = await this.prisma.user.create({ data: { ...payload, email, password: await bcrypt.hash(rawPassword, 10), role: UserRole.cliente, approved: !wholesale, approvalStatus: wholesale ? 'pending' : 'approved' } })
    await this.prisma.activityLog.create({ data: { userId: user.id, action: 'Registro de usuario', entity: 'user', metadata: { accountType: payload.accountType } } })
    return wholesale ? { user: this.serialize(user), token: null } : { user: this.serialize(user), token: this.token(user) }
  }

  async changeInitialPassword(userId: string, password: string) {
    if (password.length < 6) throw new BadRequestException('La contrasena debe tener al menos 6 caracteres')
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.mustChangePassword) throw new BadRequestException('La cuenta no requiere cambio inicial de contrasena')
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(password, 10), mustChangePassword: false } })
    await this.prisma.activityLog.create({ data: { userId, action: 'Cambio inicial de contrasena', entity: 'auth' } })
    return { user: this.serialize(updated), token: this.token(updated) }
  }
}
