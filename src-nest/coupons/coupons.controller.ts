import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { CouponsService } from './coupons.service'

@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}
  @Post('quote') quote(@Body() body: any) { return this.coupons.quote(body?.code, body?.subtotal) }
  @Get() @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  list() { return this.coupons.list() }
  @Post() @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  create(@Body() body: any) { return this.coupons.create(body) }
  @Patch(':id') @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  toggle(@Param('id') id: string, @Body() body: any) { return this.coupons.toggle(id, body?.active) }
}
