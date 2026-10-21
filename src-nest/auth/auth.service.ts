import { ConflictException, Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma.service'
import { AccountType, User, UserRole } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'

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

  createSession(user: User) {
    return { user: this.serialize(user), token: this.token(user) }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { assignedSeller: { select: { name: true } } } })
    if (!user || !(await bcrypt.compare(password, user.password))) throw new UnauthorizedException('Email o contraseña incorrectos')
    if (!user.active) throw new ForbiddenException('La cuenta está inactiva. Escribinos para reactivarla.')
    if (user.accountType === AccountType.mayorista && !user.approved) throw new ForbiddenException('Tu cuenta mayorista todavía no fue aprobada. Te avisamos cuando esté habilitada.')
    await this.prisma.activityLog.create({ data: { userId: user.id, action: 'Login', entity: 'auth' } })
    return { user: this.serialize(user), token: this.token(user) }
  }

  async register(payload: { name: string; email: string; password?: string; phone: string; accountType: AccountType; businessName?: string; cuit?: string }) {
    const email = payload.email.toLowerCase().trim()
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('El email ya se encuentra registrado')
    const wholesale = payload.accountType === AccountType.mayorista
    const rawPassword = wholesale ? randomBytes(16).toString('hex') : payload.password
    if (!rawPassword || rawPassword.length < 6) throw new BadRequestException('La contraseña debe tener al menos 6 caracteres')
    const user = await this.prisma.user.create({ data: { ...payload, email, password: await bcrypt.hash(rawPassword, 10), role: UserRole.cliente, approved: !wholesale, approvalStatus: wholesale ? 'pending' : 'approved' } })
    await this.prisma.activityLog.create({ data: { userId: user.id, action: 'Registro de usuario', entity: 'user', metadata: { accountType: payload.accountType } } })
    return wholesale ? { user: this.serialize(user), token: null } : { user: this.serialize(user), token: this.token(user) }
  }

  async changeInitialPassword(userId: string, password: string) {
    if (password.length < 6) throw new BadRequestException('La contraseña debe tener al menos 6 caracteres')
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.mustChangePassword) throw new BadRequestException('La cuenta no requiere cambio inicial de contraseña')
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(password, 10), mustChangePassword: false } })
    await this.prisma.activityLog.create({ data: { userId, action: 'Cambio inicial de contrasena', entity: 'auth' } })
    return { user: this.serialize(updated), token: this.token(updated) }
  }

  private emailConfigured() {
    return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM)
  }

  private storeUrl() {
    const configured = process.env.STORE_URL || (process.env.CLIENT_URL || '').split(',').map((origin) => origin.trim()).find((origin) => origin.startsWith('https://'))
    return (configured || 'https://www.nezhasport.com.ar').replace(/\/$/, '')
  }

  /** Siempre responde lo mismo para no revelar qué emails están registrados. */
  async requestPasswordReset(rawEmail: string) {
    const email = String(rawEmail ?? '').trim().toLowerCase()
    const response = { message: 'Si el email está registrado, te enviamos un enlace para crear una contraseña nueva. Revisá también la carpeta de spam.', emailEnabled: this.emailConfigured() }
    if (!this.emailConfigured() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.active || user.deletedAt || (user.accountType === AccountType.mayorista && !user.approved)) return response
    const recent = await this.prisma.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 2 * 60000) } } })
    if (recent) return response
    const token = randomBytes(32).toString('hex')
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60 * 60000) } })
    const link = `${this.storeUrl()}/recuperar-password?token=${token}`
    const firstName = user.name.split(' ')[0]
    try {
      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          from: process.env.ORDER_EMAIL_FROM, to: [user.email], subject: 'Creá tu nueva contraseña de NEZHA',
          text: `Hola ${firstName}.\n\nRecibimos un pedido para cambiar la contraseña de tu cuenta en NEZHA.\nCreá una nueva desde este enlace (vence en 1 hora):\n${link}\n\nSi no fuiste vos, ignorá este correo: tu contraseña actual sigue funcionando.`,
          html: `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033"><main style="max-width:560px;margin:auto;background:#fff;padding:28px"><p style="color:#0891b2;font-weight:bold">NEZHA SPORTS</p><h1 style="font-size:24px">Creá tu nueva contraseña</h1><p>Hola ${firstName.replace(/[<>&"]/g, '')}. Recibimos un pedido para cambiar la contraseña de tu cuenta.</p><p style="margin:28px 0"><a href="${link}" style="background:#0369a1;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Crear contraseña nueva</a></p><p style="font-size:13px;color:#64748b">El enlace vence en 1 hora. Si no fuiste vos, ignorá este correo: tu contraseña actual sigue funcionando.</p></main></body></html>`,
        }),
      })
      if (!sent.ok) throw new Error(`HTTP ${sent.status}`)
    } catch {
      // El usuario recibe la misma respuesta; el front ofrece WhatsApp como alternativa.
    }
    return response
  }

  async resetPassword(token: string, password: string) {
    if (typeof password !== 'string' || password.length < 6) throw new BadRequestException('La contraseña debe tener al menos 6 caracteres')
    const tokenHash = createHash('sha256').update(String(token ?? '')).digest('hex')
    const saved = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } })
    if (!saved || saved.usedAt || saved.expiresAt < new Date()) throw new BadRequestException('El enlace venció o ya fue usado. Pedí uno nuevo.')
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: saved.userId }, data: { password: await bcrypt.hash(password, 10), mustChangePassword: false } }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: saved.userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.activityLog.create({ data: { userId: saved.userId, action: 'Recuperación de contraseña', entity: 'auth' } }),
    ])
    return { message: 'Listo, ya podés iniciar sesión con tu contraseña nueva.' }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { assignedSeller: { select: { name: true } } } })
    if (!user || !user.active || user.deletedAt) throw new UnauthorizedException('Tu sesión venció. Volvé a iniciar sesión.')
    return this.serialize(user)
  }

  async updateProfile(userId: string, payload: { name?: string; phone?: string; currentPassword?: string; newPassword?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.active || user.deletedAt) throw new UnauthorizedException('Tu sesión venció. Volvé a iniciar sesión.')
    const data: { name?: string; phone?: string; password?: string } = {}
    if (payload.name !== undefined) {
      const name = String(payload.name).trim()
      if (name.length < 2 || name.length > 120) throw new BadRequestException('Ingresá tu nombre completo')
      data.name = name
    }
    if (payload.phone !== undefined) {
      const phone = String(payload.phone).trim()
      if (phone && phone.replace(/\D/g, '').length < 8) throw new BadRequestException('Ingresá un teléfono válido')
      data.phone = phone.slice(0, 40)
    }
    if (payload.newPassword !== undefined && payload.newPassword !== '') {
      if (String(payload.newPassword).length < 6) throw new BadRequestException('La contraseña nueva debe tener al menos 6 caracteres')
      if (!(await bcrypt.compare(String(payload.currentPassword ?? ''), user.password))) throw new BadRequestException('La contraseña actual no es correcta')
      data.password = await bcrypt.hash(String(payload.newPassword), 10)
    }
    const updated = await this.prisma.user.update({ where: { id: userId }, data, include: { assignedSeller: { select: { name: true } } } })
    await this.prisma.activityLog.create({ data: { userId, action: data.password ? 'Cambio de contraseña' : 'Actualización de perfil', entity: 'auth' } })
    return this.serialize(updated)
  }
}
