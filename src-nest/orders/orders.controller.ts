import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { UserRole } from '@prisma/client'
import { OrdersService } from './orders.service'

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post('checkout') checkout(@Body() body: any) { return this.orders.create(null, body) }
  @UseGuards(AuthGuard)
  @Get() list(@Req() req: any) { return this.orders.list(req.auth) }
  @UseGuards(AuthGuard)
  @Post() create(@Req() req: any, @Body() body: any) { return this.orders.create(req.auth, body) }
  @Patch(':id/status')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.vendedor, UserRole.admin, UserRole.superAdmin)
  updateStatus(@Req() req: any, @Param('id') id: string, @Body('status') status: string) { return this.orders.updateStatus(id, status, req.auth.sub) }
}
