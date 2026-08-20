import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { AccountType, ApprovalStatus, UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { UsersService } from './users.service'

class SellerDto { @IsString() @MinLength(6) name!: string; @IsEmail() email!: string; @IsOptional() @IsString() phone?: string }
class ApproveDto { @IsString() @MinLength(6) temporaryPassword!: string; @IsOptional() @IsString() sellerId?: string }

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superAdmin)
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() list(@Query('role') role?: UserRole, @Query('accountType') accountType?: AccountType, @Query('approvalStatus') approvalStatus?: ApprovalStatus, @Query('search') search?: string) { return this.users.list({ role, accountType, approvalStatus, search }) }
  @Get('pending-wholesalers') pending() { return this.users.list({ accountType: AccountType.mayorista, approvalStatus: ApprovalStatus.pending }) }
  @Post('sellers') create(@Req() req: any, @Body() dto: SellerDto) { return this.users.createSeller(dto, req.auth.sub) }
  @Patch(':userId/approve') approve(@Req() req: any, @Param('userId') id: string, @Body() dto: ApproveDto) { return this.users.approve(id, dto.temporaryPassword, dto.sellerId, req.auth.sub) }
  @Patch(':userId/reject') reject(@Req() req: any, @Param('userId') id: string) { return this.users.reject(id, req.auth.sub) }
}
