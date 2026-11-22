import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CartsController } from './carts.controller'
import { CartsService } from './carts.service'

@Module({ imports: [AuthModule], controllers: [CartsController], providers: [CartsService] })
export class CartsModule {}
