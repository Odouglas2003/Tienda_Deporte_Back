import { Injectable } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { PrismaService } from '../prisma.service'

type TrackActivity =
  | { type: 'product_view'; productId: string; productName: string }
  | { type: 'search'; query: string; resultCount?: number }

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  list(search?: string) {
    return this.prisma.activityLog.findMany({
      where: {
        AND: [
          { user: { is: { role: { notIn: [UserRole.admin, UserRole.superAdmin] } } } },
          ...(search ? [{
            OR: [
              { action: { contains: search, mode: 'insensitive' as const } },
              { entity: { contains: search, mode: 'insensitive' as const } },
              { user: { is: { name: { contains: search, mode: 'insensitive' as const } } } },
              { user: { is: { email: { contains: search, mode: 'insensitive' as const } } } },
            ],
          }] : []),
        ],
      },
      include: { user: { select: { name: true, email: true, role: true, accountType: true, businessName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 250,
    })
  }

  track(userId: string, event: TrackActivity) {
    if (event.type === 'product_view') {
      return this.prisma.activityLog.create({
        data: {
          userId,
          action: 'Visitó un producto',
          entity: 'product',
          metadata: { productId: event.productId, productName: event.productName },
        },
      })
    }

    return this.prisma.activityLog.create({
      data: {
        userId,
        action: 'Buscó en la tienda',
        entity: 'search',
        metadata: { query: event.query, resultCount: event.resultCount ?? 0 },
      },
    })
  }
}
