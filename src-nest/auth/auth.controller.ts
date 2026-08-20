import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { AccountType } from '@prisma/client'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'

class LoginDto { @IsEmail() email!: string; @IsString() password!: string }
class RegisterDto { @IsString() @MinLength(2) name!: string; @IsEmail() email!: string; @IsOptional() @IsString() password?: string; @IsString() phone!: string; @IsEnum(AccountType) accountType!: AccountType; @IsOptional() @IsString() businessName?: string; @IsOptional() @IsString() cuit?: string }
class ChangePasswordDto { @IsString() @MinLength(6) password!: string }

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto.email, dto.password) }
  @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto) }
  @UseGuards(AuthGuard)
  @Post('change-initial-password') change(@Req() req: any, @Body() dto: ChangePasswordDto) { return this.auth.changeInitialPassword(req.auth.sub, dto.password) }
}
