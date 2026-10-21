import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ContactStatus, UserRole } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/auth.decorator'
import { RolesGuard } from '../auth/roles.guard'
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

  @Get('contact')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  listContact() {
    return this.prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })
  }

  @Patch('contact/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  async updateContact(@Param('id') id: string, @Body('status') status: unknown) {
    if (!Object.values(ContactStatus).includes(status as ContactStatus)) throw new BadRequestException('Estado inválido')
    const exists = await this.prisma.contactMessage.findUnique({ where: { id } })
    if (!exists) throw new NotFoundException('Mensaje no encontrado')
    return this.prisma.contactMessage.update({ where: { id }, data: { status: status as ContactStatus } })
  }

  @Get('newsletter')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.superAdmin)
  listNewsletter() {
    return this.prisma.newsletterSubscriber.findMany({ where: { active: true }, orderBy: { subscribedAt: 'desc' } })
  }
}
