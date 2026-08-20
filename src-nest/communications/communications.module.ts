import { Module } from '@nestjs/common'; import { CommunicationsController } from './communications.controller'
@Module({ controllers: [CommunicationsController] }) export class CommunicationsModule {}
