import { Controller, Get, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'; import { Roles } from '../auth/auth.decorator'; import { RolesGuard } from '../auth/roles.guard'; import { ReportsService } from './reports.service'
@Controller('reports') @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin) export class ReportsController { constructor(private readonly reports: ReportsService) {} @Get('summary') summary() { return this.reports.summary() } }
