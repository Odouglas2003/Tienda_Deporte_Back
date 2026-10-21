import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CommunicationsController } from './communications.controller'

@Module({ imports: [AuthModule], controllers: [CommunicationsController] })
export class CommunicationsModule {}
