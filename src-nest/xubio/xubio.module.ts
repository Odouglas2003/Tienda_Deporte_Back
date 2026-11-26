import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { XubioController } from './xubio.controller'
import { XubioService } from './xubio.service'

@Module({ imports: [AuthModule], controllers: [XubioController], providers: [XubioService] })
export class XubioModule {}
