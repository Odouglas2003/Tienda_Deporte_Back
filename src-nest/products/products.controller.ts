import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma.service'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { UserRole } from '@prisma/client'
import { ProductsService } from './products.service'

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService, private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  /** Los precios mayoristas solo se exponen a mayoristas aprobados, vendedores y administradores. */
  private async canSeeWholesale(req: any) {
    const header = String(req?.headers?.authorization ?? '')
    if (!header.startsWith('Bearer ')) return false
    try {
      const auth: any = await this.jwt.verifyAsync(header.slice(7))
      if (['admin', 'superAdmin', 'vendedor'].includes(auth?.role)) return true
      const user = await this.prisma.user.findUnique({ where: { id: String(auth?.sub ?? '') }, select: { accountType: true, approved: true, active: true, deletedAt: true } })
      return Boolean(user && user.accountType === 'mayorista' && user.approved && user.active && !user.deletedAt)
    } catch {
      return false
    }
  }

  private publicView(product: any) {
    const { priceWholesale: _priceWholesale, ...rest } = product
    const variants = Array.isArray(product.variants) ? product.variants.map(({ priceWholesale: _variantWholesale, ...variant }: any) => variant) : product.variants
    return { ...rest, variants }
  }

  @Get() async list(@Req() req: any, @Query() query: any) {
    const products = await this.products.list(query)
    // El público no ve productos desactivados ni precios mayoristas.
    return (await this.canSeeWholesale(req)) ? products : products.filter((product) => product.active).map((product) => this.publicView(product))
  }
  @Get(':id') async get(@Req() req: any, @Param('id') id: string) {
    const product = await this.products.get(id)
    return (await this.canSeeWholesale(req)) ? product : this.publicView(product)
  }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post() create(@Body() body: any) { return this.products.create(body) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('import') importCatalog(@Body() body: any) { return this.products.importCatalog(body?.rows, { mode: body?.mode, dryRun: body?.dryRun, expectedVersions: body?.expectedVersions }) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('import/preview') previewCatalog(@Body() body: any) { return this.products.importCatalog(body?.rows, { mode: body?.mode, dryRun: true }) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('bulk') bulk(@Body() body: any) { return this.products.bulk(body?.rows) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.products.update(id, body) }
}
