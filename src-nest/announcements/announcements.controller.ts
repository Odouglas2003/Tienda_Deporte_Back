import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { AnnouncementsService } from './announcements.service'

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** Público: la noticia activa que se muestra al entrar a la tienda (o null). */
  @Get('current') async current() { return (await this.announcements.current()) ?? null }

  @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  @Get() list() { return this.announcements.list() }

  @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  @Post() create(@Req() req: any, @Body() body: any) { return this.announcements.create(body ?? {}, req.auth?.sub) }

  @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  @Put(':id') update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.announcements.update(id, body ?? {}, req.auth?.sub) }

  @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin)
  @Delete(':id') remove(@Req() req: any, @Param('id') id: string) { return this.announcements.remove(id, req.auth?.sub) }
}
