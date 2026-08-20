import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'; import { Roles } from '../auth/auth.decorator'; import { RolesGuard } from '../auth/roles.guard'; import { SettingsService } from './settings.service'
@Controller('settings') export class SettingsController { constructor(private readonly settings: SettingsService) {} @Get() get() { return this.settings.get() } @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin) @Put() update(@Body() body: any) { return this.settings.update(body) } }
