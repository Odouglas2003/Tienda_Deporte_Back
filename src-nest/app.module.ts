import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthController } from './health.controller'
import { PrismaModule } from './prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ProductsModule } from './products/products.module'
import { OrdersModule } from './orders/orders.module'
import { AdminModule } from './admin/admin.module'
import { CommunicationsModule } from './communications/communications.module'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, UsersModule, ProductsModule, OrdersModule, AdminModule, CommunicationsModule],
  controllers: [HealthController],
})
export class AppModule {}
