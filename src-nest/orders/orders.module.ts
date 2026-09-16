import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { VatRatesModule } from '../tax/vat-rates.module'

@Module({ imports: [AuthModule, VatRatesModule], controllers: [OrdersController], providers: [OrdersService] })
export class OrdersModule {}
