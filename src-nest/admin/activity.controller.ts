import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { AuthGuard } from '../auth/auth.guard'; import { Roles } from '../auth/auth.decorator'; import { RolesGuard } from '../auth/roles.guard'; import { ActivityService } from './activity.service'

class TrackActivityDto {
  @IsIn(['product_view', 'search']) type!: 'product_view' | 'search'
  @IsOptional() @IsString() @MaxLength(120) productId?: string
  @IsOptional() @IsString() @MaxLength(180) productName?: string
  @IsOptional() @IsString() @MaxLength(120) query?: string
  @IsOptional() @IsInt() @Min(0) resultCount?: number
}

@Controller('activity-logs')
@UseGuards(AuthGuard, RolesGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @Roles(UserRole.admin, UserRole.superAdmin)
  list(@Query('search') search?: string) {
    return this.activity.list(search)
  }

  @Post('track')
  track(@Req() req: any, @Body() dto: TrackActivityDto) {
    if (dto.type === 'product_view') {
      return this.activity.track(req.auth.sub, {
        type: 'product_view',
        productId: dto.productId ?? '',
        productName: dto.productName ?? 'Producto sin nombre',
      })
    }

    return this.activity.track(req.auth.sub, {
      type: 'search',
      query: dto.query ?? '',
      resultCount: dto.resultCount,
    })
  }
}
