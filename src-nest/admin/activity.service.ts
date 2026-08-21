import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

type TrackActivity =
  | { type: 'product_view'; productId: string; productName: string }
  | { type: 'search'; query: string; resultCount?: number }

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  list(search?: string) {
    return this.prisma.activityLog.findMany({
      where: search ? {
        OR: [
          { action: { contains: search, mode: 'insensitive' } },
          { entity: { contains: search, mode: 'insensitive' } },
          { user: { is: { name: { contains: search, mode: 'insensitive' } } } },
          { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
        ],
      } : undefined,
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
