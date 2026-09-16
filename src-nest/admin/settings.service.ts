import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { VatRatesService } from '../tax/vat-rates.service'

const defaultBrands = [
  { name: 'DRIBBLING', categories: ['Futbol', 'Indumentaria', 'Fitness y yoga', 'Volley', 'Basquet', 'Handball'] },
  { name: 'Simbra', categories: ['Hockey'] },
  { name: 'Hydro', categories: ['Natacion'] },
  { name: 'SENSEI', categories: ['Tenis de Mesa'] },
  { name: 'SIXZERO', categories: ['Tenis', 'Padel', 'Badminton', 'Squash'] },
  { name: 'DUNLOP', categories: ['Tenis', 'Padel', 'Squash', 'Indumentaria'] },
  { name: 'Reebok', categories: ['Futbol', 'Volley', 'Basquet'] },
  { name: 'Double Fish', categories: ['Tenis de mesa profesional'] },
]

const defaultDisciplines = [
  { name: 'Deportes de Equipo', items: ['Futbol', 'Basquet', 'Handball', 'Volley', 'Rugby', 'Hockey'] },
  { name: 'Deportes Indoor', items: ['Gimnasio', 'Fitness y Yoga', 'Gimnasia Ritmica', 'CrossFit'] },
  { name: 'Deportes de Contacto', items: ['Boxeo', 'Artes Marciales', 'MMA', 'Kickboxing'] },
  { name: 'Deportes de Raqueta', items: ['Tenis', 'Padel', 'Squash', 'Badminton', 'Tenis de Mesa'] },
  { name: 'Deportes Acuaticos', items: ['Natacion', 'Waterpolo'] },
  { name: 'Running y Ciclismo', items: ['Running', 'Ciclismo'] },
]

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly vatRates: VatRatesService) {}

  async get() {
    const settings = await this.prisma.settings.findFirst()
    if (settings) {
      const vat = await this.vatRates.getGeneralRate(settings.taxPercentage)
      return {
        ...settings,
        taxPercentage: vat.rate,
        taxRateSource: vat.source,
        taxRateCheckedAt: vat.checkedAt,
        navigationBrands: settings.navigationBrands ?? defaultBrands,
        navigationDisciplines: settings.navigationDisciplines ?? defaultDisciplines,
      }
    }

    const created = await this.prisma.settings.create({
      data: {
        paymentMethods: ['transferencia'],
        automaticMessages: {},
        navigationBrands: defaultBrands,
        navigationDisciplines: defaultDisciplines,
      },
    })
    const vat = await this.vatRates.getGeneralRate(created.taxPercentage)
    return { ...created, taxPercentage: vat.rate, taxRateSource: vat.source, taxRateCheckedAt: vat.checkedAt }
  }

  async update(body: Record<string, unknown>) {
    const data: Prisma.SettingsUncheckedUpdateInput = {}

    if (typeof body.minWholesaleOrder === 'number') data.minWholesaleOrder = body.minWholesaleOrder
    if (typeof body.taxPercentage === 'number') data.taxPercentage = body.taxPercentage
    if (typeof body.whatsappNumber === 'string') data.whatsappNumber = body.whatsappNumber
    if (Array.isArray(body.paymentMethods)) data.paymentMethods = body.paymentMethods.filter((item): item is string => typeof item === 'string')
    if (body.automaticMessages && typeof body.automaticMessages === 'object') data.automaticMessages = body.automaticMessages as Prisma.InputJsonValue
    if (Array.isArray(body.navigationBrands)) data.navigationBrands = body.navigationBrands as Prisma.InputJsonValue
    if (Array.isArray(body.navigationDisciplines)) data.navigationDisciplines = body.navigationDisciplines as Prisma.InputJsonValue

    const current = await this.prisma.settings.findFirst()
    if (current) {
      await this.prisma.settings.update({ where: { id: current.id }, data })
      return this.get()
    }

    await this.prisma.settings.create({
      data: {
        paymentMethods: Array.isArray(body.paymentMethods) ? body.paymentMethods.filter((item): item is string => typeof item === 'string') : [],
        navigationBrands: (body.navigationBrands as Prisma.InputJsonValue | undefined) ?? defaultBrands,
        navigationDisciplines: (body.navigationDisciplines as Prisma.InputJsonValue | undefined) ?? defaultDisciplines,
      },
    })
    return this.get()
  }
}
