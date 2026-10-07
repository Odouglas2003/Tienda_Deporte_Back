import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

export function couponCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

export function assertCoupon(coupon: { active: boolean; expiresAt: Date; usedCount: number; maxUses: number; minSubtotal: number } | null, subtotal: number, now = new Date()) {
  if (!coupon || !coupon.active || coupon.expiresAt <= now || coupon.usedCount >= coupon.maxUses) throw new BadRequestException('El cupón no está disponible o venció.')
  if (!Number.isFinite(subtotal) || subtotal < coupon.minSubtotal) throw new BadRequestException(`El cupón requiere una compra mínima de $${coupon.minSubtotal.toLocaleString('es-AR')} sin IVA.`)
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }) }
  async quote(code: unknown, subtotal: number) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: couponCode(code) } })
    assertCoupon(coupon, subtotal)
    return { code: coupon!.code, percent: coupon!.percent, minSubtotal: coupon!.minSubtotal, expiresAt: coupon!.expiresAt }
  }
  create(body: any) {
    const code = couponCode(body?.code)
    const { percent, minSubtotal, maxUses } = body ?? {}
    const expiresAt = new Date(body?.expiresAt)
    if (!/^[A-Z0-9_-]{3,30}$/.test(code) || typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100 || typeof minSubtotal !== 'number' || !Number.isFinite(minSubtotal) || minSubtotal < 0 || !Number.isSafeInteger(maxUses) || maxUses < 1 || !Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new BadRequestException('Revisá código, porcentaje, mínimo, límite y vencimiento del cupón.')
    return this.prisma.coupon.create({ data: { code, percent, minSubtotal, maxUses, expiresAt } })
  }
  toggle(id: string, active: unknown) {
    if (typeof active !== 'boolean') throw new BadRequestException('Estado inválido')
    return this.prisma.coupon.update({ where: { id }, data: { active } })
  }
}
