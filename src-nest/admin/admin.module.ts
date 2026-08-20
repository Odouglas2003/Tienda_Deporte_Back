import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CategoriesController } from './categories.controller'
import { CategoriesService } from './categories.service'
import { ActivityController } from './activity.controller'
import { ActivityService } from './activity.service'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'
import { ReportsController } from './reports.controller'
import { ReportsService } from './reports.service'

@Module({ imports: [AuthModule], controllers: [CategoriesController, ActivityController, SettingsController, ReportsController], providers: [CategoriesService, ActivityService, SettingsService, ReportsService] })
export class AdminModule {}
