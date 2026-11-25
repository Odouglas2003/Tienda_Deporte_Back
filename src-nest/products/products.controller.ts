import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
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

  private readonly restrictedBrandPattern = /\b(?:dribbling|simbra|hydro|hidro|sixzero|sensei|dunlop|reebok|double\s+fish)\b/i

  private isPubliclyAllowed(product: any) {
    return !this.restrictedBrandPattern.test(`${product?.brand ?? ''} ${product?.name ?? ''} ${product?.description ?? ''}`)
  }

  /**
   * Quién mira el catálogo. El rol se lee SIEMPRE de la base (no del token), con las mismas reglas que el
   * resto del panel: una cuenta desactivada, eliminada o con la clave cambiada pierde el acceso al instante.
   */
  private async viewer(req: any): Promise<{ team: boolean; wholesale: boolean }> {
    const none = { team: false, wholesale: false }
    const header = String(req?.headers?.authorization ?? '')
    if (!header.startsWith('Bearer ')) return none
    let payload: any
    try { payload = await this.jwt.verifyAsync(header.slice(7)) } catch { return none }
    const user = await this.prisma.user.findUnique({ where: { id: String(payload?.sub ?? '') }, select: { role: true, accountType: true, approved: true, active: true, deletedAt: true, sessionsValidFrom: true } })
    if (!user || !user.active || user.deletedAt) return none
    if (user.sessionsValidFrom && Number(payload?.iat ?? 0) * 1000 < user.sessionsValidFrom.getTime() - 1000) return none
    const team = ['admin', 'superAdmin', 'vendedor'].includes(user.role)
    return { team, wholesale: team || (user.accountType === 'mayorista' && user.approved) }
  }

  private publicView(product: any) {
    const { priceWholesale: _priceWholesale, ...rest } = product
    const variants = Array.isArray(product.variants) ? product.variants.map(({ priceWholesale: _variantWholesale, ...variant }: any) => variant) : product.variants
    return { ...rest, variants }
  }

  @Get() async list(@Req() req: any, @Query() query: any) {
    const viewer = await this.viewer(req)
    const products = await this.products.list(query)
    // Ocultos (borradores, "Flete", etc.) y marcas restringidas: solo el equipo. Precio mayorista: equipo y mayoristas aprobados.
    const visibleProducts = viewer.team ? products : products.filter((product) => product.active && this.isPubliclyAllowed(product))
    return viewer.wholesale ? visibleProducts : visibleProducts.map((product) => this.publicView(product))
  }
  @Get(':id') async get(@Req() req: any, @Param('id') id: string) {
    const viewer = await this.viewer(req)
    const product = await this.products.get(id)
    // Los productos ocultos (borradores o desactivados) solo los ven el admin y los vendedores, ni con el link directo.
    if (!viewer.team && (!this.isPubliclyAllowed(product) || !product.active || product.deletedAt)) throw new NotFoundException('Producto no encontrado')
    return viewer.wholesale ? product : this.publicView(product)
  }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post() create(@Body() body: any) { return this.products.create(body) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('import') importCatalog(@Body() body: any) { return this.products.importCatalog(body?.rows, { mode: body?.mode, dryRun: body?.dryRun, draft: body?.draft === true, expectedVersions: body?.expectedVersions }) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('import/preview') previewCatalog(@Body() body: any) { return this.products.importCatalog(body?.rows, { mode: body?.mode, dryRun: true, draft: body?.draft === true }) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('bulk') bulk(@Body() body: any) { return this.products.bulk(body?.rows) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('auto-categorize') autoCategorize(@Req() req: any, @Body() body: any) { return this.products.autoCategorize(body, req.auth?.sub) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('set-category') setCategory(@Req() req: any, @Body() body: any) { return this.products.setCategory(body, req.auth?.sub) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Post('discount-all') discountAll(@Req() req: any, @Body() body: any) { return this.products.discountAll(body?.percent, req.auth?.sub) }
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.products.update(id, body) }
}
