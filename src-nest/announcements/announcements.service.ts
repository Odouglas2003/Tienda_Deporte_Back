import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

const THEMES = ['oscuro', 'claro', 'naranja', 'celeste']
const LAYOUTS = ['arriba', 'costado', 'fondo']
const MAX_IMAGE_CHARS = 3_000_000

type Payload = Record<string, unknown>

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Noticias de la tienda: el admin las arma y la activa se muestra en una ventana al entrar. */
@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(payload: Payload) {
    const title = text(payload.title, 120)
    if (!title) throw new BadRequestException('Poné un título para la noticia.')
    const imageData = typeof payload.imageData === 'string' ? payload.imageData : ''
    if (imageData && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(imageData) && !/^https:\/\/[^\s"'<>]+$/.test(imageData)) {
      throw new BadRequestException('La imagen no es válida. Subí un JPG, PNG o WEBP.')
    }
    if (imageData.length > MAX_IMAGE_CHARS) throw new BadRequestException('La imagen es muy pesada. Probá con una más chica.')
    const buttonUrl = text(payload.buttonUrl, 500)
    // Solo enlaces de la tienda (/catalogo…) o https, para que nadie pueda meter un link peligroso.
    if (buttonUrl && !/^\/(?!\/)[^\s]*$/.test(buttonUrl) && !/^https:\/\/[^\s"'<>]+$/.test(buttonUrl)) {
      throw new BadRequestException('El enlace del botón tiene que empezar con / (una página de la tienda) o con https://')
    }
    return {
      title,
      body: text(payload.body, 1500),
      imageData,
      buttonLabel: text(payload.buttonLabel, 40),
      buttonUrl,
      theme: THEMES.includes(String(payload.theme)) ? String(payload.theme) : 'oscuro',
      layout: LAYOUTS.includes(String(payload.layout)) ? String(payload.layout) : 'arriba',
      active: payload.active === true,
    }
  }

  current() {
    return this.prisma.announcement.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } })
  }

  list() {
    return this.prisma.announcement.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 })
  }

  async create(payload: Payload, actorId?: string) {
    const data = this.clean(payload)
    return this.prisma.$transaction(async (tx) => {
      if (data.active) await tx.announcement.updateMany({ where: { active: true }, data: { active: false } })
      const saved = await tx.announcement.create({ data })
      await tx.activityLog.create({ data: { userId: actorId ?? null, action: 'Alta de noticia', entity: 'announcement', metadata: { id: saved.id, title: saved.title, active: saved.active } } })
      return saved
    })
  }

  async update(id: string, payload: Payload, actorId?: string) {
    if (!(await this.prisma.announcement.findUnique({ where: { id } }))) throw new NotFoundException('Noticia no encontrada')
    const data = this.clean(payload)
    return this.prisma.$transaction(async (tx) => {
      if (data.active) await tx.announcement.updateMany({ where: { active: true, id: { not: id } }, data: { active: false } })
      const saved = await tx.announcement.update({ where: { id }, data })
      await tx.activityLog.create({ data: { userId: actorId ?? null, action: 'Edición de noticia', entity: 'announcement', metadata: { id, title: saved.title, active: saved.active } } })
      return saved
    })
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Noticia no encontrada')
    await this.prisma.announcement.delete({ where: { id } })
    await this.prisma.activityLog.create({ data: { userId: actorId ?? null, action: 'Baja de noticia', entity: 'announcement', metadata: { id, title: existing.title } } })
    return { ok: true }
  }
}
