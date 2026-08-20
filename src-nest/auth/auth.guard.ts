import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest()
    const header = request.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null

    if (!token) throw new UnauthorizedException('No autorizado')

    try {
      request.auth = await this.jwt.verifyAsync(token)
      return true
    } catch {
      throw new UnauthorizedException('Token invalido o vencido')
    }
  }
}
