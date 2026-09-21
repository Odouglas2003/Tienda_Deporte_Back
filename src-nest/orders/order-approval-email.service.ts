import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

@Injectable()
export class OrderApprovalEmailService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  private readonly logger = new Logger(OrderApprovalEmailService.name)
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!process.env.RESEND_API_KEY || !process.env.ORDER_EMAIL_FROM) {
      this.logger.warn('Correo de pedidos sin configurar: los avisos quedan pendientes hasta configurar RESEND_API_KEY y ORDER_EMAIL_FROM.')
    }
    this.timer = setInterval(() => { void this.drain() }, 30000)
    this.timer.unref()
    void this.drain()
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async drain() {
    if (this.busy || !process.env.RESEND_API_KEY || !process.env.ORDER_EMAIL_FROM) return
    this.busy = true
    try {
      const now = new Date()
      const pending = await this.prisma.orderApprovalEmail.findFirst({
        where: { status: { in: ['pending', 'sending'] }, nextAttemptAt: { lte: now } },
        orderBy: { createdAt: 'asc' },
      })
      if (!pending) return
      // Never retry outside Resend's 24h idempotency window after an ambiguous response.
      if (pending.attempts >= 8 || (pending.firstAttemptAt && now.getTime() - pending.firstAttemptAt.getTime() > 23 * 3600000)) {
        await this.prisma.orderApprovalEmail.update({ where: { id: pending.id }, data: { status: 'failed', lastError: 'Reintentos agotados; revisar entrega antes de reenviar.' } })
        return
      }
      const payload = pending.payload as Record<string, unknown>
      const body = { ...payload, from: payload.from || process.env.ORDER_EMAIL_FROM }
      // Conditional lease prevents parallel instances from claiming the same message.
      const lease = await this.prisma.orderApprovalEmail.updateMany({
        where: { id: pending.id, status: pending.status, attempts: pending.attempts, nextAttemptAt: { lte: now } },
        data: { status: 'sending', attempts: { increment: 1 }, firstAttemptAt: pending.firstAttemptAt ?? now, nextAttemptAt: new Date(now.getTime() + 60000), payload: body as Prisma.InputJsonValue },
      })
      if (!lease.count) return
      let permanent = false
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `order-${pending.kind}/${pending.orderId}` },
          body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          permanent = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)
          throw new Error(`Servicio de correo HTTP ${response.status}`)
        }
        const result = await response.json() as { id?: string }
        if (!result.id) throw new Error('Respuesta de correo sin identificador')
        await this.prisma.orderApprovalEmail.update({ where: { id: pending.id }, data: { status: 'sent', sentAt: new Date(), lastError: null } })
      } catch (error) {
        await this.prisma.orderApprovalEmail.update({ where: { id: pending.id }, data: {
          status: permanent || pending.attempts >= 7 ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** pending.attempts)),
          lastError: error instanceof Error && error.message.startsWith('Servicio de correo HTTP') ? error.message : 'Error de envío o confirmación; reintento con la misma clave.',
        } })
      }
    } catch {
      this.logger.error('No se pudo procesar la cola de correos de pedidos.')
    } finally { this.busy = false }
  }
}
