import { Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { XubioService } from './xubio.service'

/** Solo admins. Nunca devuelve las claves guardadas. */
@Controller('xubio')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superAdmin)
export class XubioController {
  constructor(private readonly xubio: XubioService) {}
  @Get() status() { return this.xubio.status() }
  @Post('connect') connect(@Body() body: any) { return this.xubio.connect(body) }
  @Delete() disconnect() { return this.xubio.disconnect() }
  @Put('auto') setAutoSync(@Body() body: any) { return this.xubio.setAutoSync(body) }
  @Post('preview') preview() { return this.xubio.preview() }
  @Post('sync') sync() { return this.xubio.sync() }
}
