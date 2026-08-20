import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'; import { Roles } from '../auth/auth.decorator'; import { RolesGuard } from '../auth/roles.guard'; import { ActivityService } from './activity.service'
@Controller('activity-logs') @UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.superAdmin) export class ActivityController { constructor(private readonly activity: ActivityService) {} @Get() list(@Query('search') search?: string) { return this.activity.list(search) } }
