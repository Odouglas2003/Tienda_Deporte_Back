import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { VatRatesService } from '../tax/vat-rates.service'

const defaultBrands = [
  { name: 'ADIDAS COMBATE', categories: ['Boxeo', 'Artes Marciales', 'MMA'] },
  { name: 'GILBERT', categories: ['Rugby'] },
  { name: 'PENALTY', categories: ['Futbol'] },
  { name: 'UMBRO', categories: ['Futbol', 'Indumentaria'] },
  { name: 'BULLPADEL', categories: ['Padel'] },
  { name: 'PUMA', categories: ['Futbol', 'Indumentaria'] },
  { name: 'MOLTEN', categories: ['Volley', 'Basquet'] },
  { name: 'SPALDING', categories: ['Basquet'] },
  { name: 'FILA', categories: ['Indumentaria', 'Calzado'] },
  { name: 'OLYMPICUS', categories: ['Running', 'Calzado'] },
  { name: 'ASICS', categories: ['Running', 'Calzado'] },
]

function normalizeBrands(value: unknown) {
  const existing = new Map(
    (Array.isArray(value) ? value : [])
      .filter((item): item is { name: string; categories: string[] } =>
        item && typeof item.name === 'string' && Array.isArray(item.categories) && item.categories.every((category: unknown) => typeof category === 'string'))
      .map((item) => [item.name.trim().toUpperCase(), item.categories] as const),
  )
  return defaultBrands.map((brand) => ({ ...brand, categories: existing.get(brand.name) ?? brand.categories }))
}

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
        navigationBrands: normalizeBrands(settings.navigationBrands),
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
    if (Array.isArray(body.navigationBrands)) data.navigationBrands = normalizeBrands(body.navigationBrands)
    if (Array.isArray(body.navigationDisciplines)) data.navigationDisciplines = body.navigationDisciplines as Prisma.InputJsonValue

    const current = await this.prisma.settings.findFirst()
    if (current) {
      await this.prisma.settings.update({ where: { id: current.id }, data })
      return this.get()
    }

    await this.prisma.settings.create({
      data: {
        paymentMethods: Array.isArray(body.paymentMethods) ? body.paymentMethods.filter((item): item is string => typeof item === 'string') : [],
        navigationBrands: normalizeBrands(body.navigationBrands),
        navigationDisciplines: (body.navigationDisciplines as Prisma.InputJsonValue | undefined) ?? defaultDisciplines,
      },
    })
    return this.get()
  }
}
