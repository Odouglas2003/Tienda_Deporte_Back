import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'
import { RolesGuard } from './roles.guard'

@Module({
  imports: [ConfigModule, JwtModule.registerAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET', 'change-this-secret'), signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as any } }) })],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard, Reflector],
  exports: [AuthService, AuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
