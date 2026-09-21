import { OrderApprovalEmailService } from './order-approval-email.service'
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { VatRatesModule } from '../tax/vat-rates.module'

@Module({ imports: [AuthModule, VatRatesModule], controllers: [OrdersController], providers: [OrdersService, OrderApprovalEmailService] })
export class OrdersModule {}
