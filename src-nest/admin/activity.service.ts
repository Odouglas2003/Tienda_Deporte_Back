import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
@Injectable() export class ActivityService { constructor(private readonly prisma: PrismaService) {} list(search?: string) { return this.prisma.activityLog.findMany({ where: search ? { OR: [{ action: { contains: search, mode: 'insensitive' } }, { entity: { contains: search, mode: 'insensitive' } }] } : undefined, include: { user: { select: { name: true, email: true, role: true } } }, orderBy: { createdAt: 'desc' }, take: 250 }) } }
