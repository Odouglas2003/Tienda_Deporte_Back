import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma.service'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest()
    const header = request.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null

    if (!token) throw new UnauthorizedException('No autorizado')

    let payload: any
    try {
      payload = await this.jwt.verifyAsync(token)
    } catch {
      throw new UnauthorizedException('Tu sesión venció. Volvé a iniciar sesión.')
    }

    // El token solo identifica a la persona: el rol y el estado se leen siempre de la base,
    // para que una cuenta desactivada, eliminada o con otro rol pierda el acceso al instante.
    const user = await this.prisma.user.findUnique({ where: { id: String(payload?.sub ?? '') }, select: { id: true, role: true, email: true, active: true, deletedAt: true } })
    if (!user || !user.active || user.deletedAt) throw new UnauthorizedException('Tu sesión venció. Volvé a iniciar sesión.')

    request.auth = { ...payload, sub: user.id, role: user.role, email: user.email }
    return true
  }
}
