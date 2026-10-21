import { BadRequestException, Body, Controller, Post } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

@Controller('communications')
export class CommunicationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('contact')
  async contact(@Body() body: any) {
    const name = text(body?.name, 120)
    const email = text(body?.email, 160).toLowerCase()
    const subject = text(body?.subject, 60)
    const message = text(body?.message, 5000)
    if (!name || !EMAIL.test(email) || !subject || !message) throw new BadRequestException('Completá nombre, un email válido, asunto y mensaje')
    await this.prisma.contactMessage.create({ data: { name, email, phone: text(body?.phone, 40), subject, message } })
    return { message: 'Mensaje recibido correctamente' }
  }

  @Post('newsletter')
  async newsletter(@Body('email') rawEmail: unknown) {
    const email = text(rawEmail, 160).toLowerCase()
    if (!EMAIL.test(email)) throw new BadRequestException('Ingresá un email válido')
    await this.prisma.newsletterSubscriber.upsert({ where: { email }, create: { email }, update: { active: true, subscribedAt: new Date() } })
    return { message: 'Suscripción registrada correctamente' }
  }
}
