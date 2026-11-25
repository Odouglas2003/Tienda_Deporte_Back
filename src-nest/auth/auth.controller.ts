import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { AccountType } from '@prisma/client'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'

class LoginDto { @IsEmail() @MaxLength(160) email!: string; @IsString() @MaxLength(128) password!: string }
class RegisterDto { @IsString() @MinLength(2) @MaxLength(120) name!: string; @IsEmail() @MaxLength(160) email!: string; @IsOptional() @IsString() @MaxLength(128) password?: string; @IsString() @MaxLength(40) phone!: string; @IsEnum(AccountType) accountType!: AccountType; @IsOptional() @IsString() @MaxLength(160) businessName?: string; @IsOptional() @IsString() @MaxLength(20) cuit?: string }
class ChangePasswordDto { @IsString() @MinLength(8) password!: string }
class ForgotPasswordDto { @IsString() email!: string }
class ResetPasswordDto { @IsString() token!: string; @IsString() password!: string }
class UpdateProfileDto { @IsOptional() @IsString() name?: string; @IsOptional() @IsString() phone?: string; @IsOptional() @IsString() currentPassword?: string; @IsOptional() @IsString() newPassword?: string }

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto.email, dto.password) }
  @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto) }
  @UseGuards(AuthGuard)
  @Post('change-initial-password') change(@Req() req: any, @Body() dto: ChangePasswordDto) { return this.auth.changeInitialPassword(req.auth.sub, dto.password) }
  @Post('forgot-password') forgot(@Body() dto: ForgotPasswordDto) { return this.auth.requestPasswordReset(dto.email) }
  @Post('reset-password') reset(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.password) }
  @UseGuards(AuthGuard)
  @Get('me') me(@Req() req: any) { return this.auth.me(req.auth.sub) }
  @UseGuards(AuthGuard)
  @Patch('me') updateMe(@Req() req: any, @Body() dto: UpdateProfileDto) { return this.auth.updateProfile(req.auth.sub, dto) }
}
