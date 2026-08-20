import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { UserRole } from '@prisma/client'
import { ProductsService } from './products.service'

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Get() list(@Query() query: any) { return this.products.list(query) }
  @Get(':id') get(@Param('id') id: string) { return this.products.get(id) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post() create(@Body() body: any) { return this.products.create(body) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.products.update(id, body) }
}
