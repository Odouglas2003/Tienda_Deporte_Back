import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { CartsService } from './carts.service'

@Controller('cart')
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  /** El carrito del cliente con sesión (lo manda la tienda cuando cambia). Vacío = se borra. */
  @UseGuards(AuthGuard)
  @Put() save(@Req() req: any, @Body() body: any) { return this.carts.save(req.auth.sub, body?.items) }

  /** Para el panel: carritos con productos que no terminaron en compra. */
  @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  @Get('abandoned') abandoned(@Query('minutos') minutes?: string, @Query('tipo') type?: string) { return this.carts.abandoned(Number(minutes) || 30, type === 'mayorista') }
}
