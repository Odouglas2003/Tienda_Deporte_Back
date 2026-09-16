import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type RateSource = 'api' | 'stale' | 'fallback'
export type GeneralVatRate = { rate: number; source: RateSource; checkedAt?: string }

const REFRESH_MS = 6 * 60 * 60 * 1000
const RETRY_MS = 15 * 60 * 1000
const API_URL = 'https://api.servidos.ar/api/v1/tax/iva/rates'

function numericRate(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.replace('%', '').replace(',', '.').trim() : value
  const rate = Number(raw)
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(rate) && rate >= 0 && rate <= 50 ? rate : null
}

export function readGeneralVatRate(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, any>
  const data = root.data && typeof root.data === 'object' ? root.data : root
  const direct = [data.standard_rate, data.standardRate, data.general_rate, data.generalRate, data.standard, data.general]
  for (const candidate of direct) {
    const rate = numericRate(candidate && typeof candidate === 'object' ? candidate.rate ?? candidate.value ?? candidate.percentage ?? candidate.porcentaje : candidate)
    if (rate !== null) return rate
  }
  const rates = Array.isArray(data) ? data : data.rates ?? data.alicuotas ?? data.aliquots
  if (rates && !Array.isArray(rates) && typeof rates === 'object') {
    for (const key of ['standard', 'general', 'standard_rate', 'general_rate']) {
      const candidate = rates[key]
      const rate = numericRate(candidate && typeof candidate === 'object' ? candidate.rate ?? candidate.value ?? candidate.percentage ?? candidate.porcentaje : candidate)
      if (rate !== null) return rate
    }
  }
  if (!Array.isArray(rates)) return null
  const standard = rates.find((item) => {
    if (!item || typeof item !== 'object') return false
    const label = [item.type, item.name, item.label, item.slug, item.category, item.description].join(' ').toLowerCase()
    return /\b(general|standard|estandar|estándar)\b/.test(label)
  })
  return standard ? numericRate(standard.rate ?? standard.value ?? standard.percentage ?? standard.porcentaje) : null
}

export function productVatRate(storedRate: number, generalRate: number) {
  return Number.isFinite(storedRate) && storedRate > 0 && storedRate !== 21 ? storedRate : generalRate
}

@Injectable()
export class VatRatesService {
  private readonly logger = new Logger(VatRatesService.name)
  private cached: { rate: number; checkedAt: number } | null = null
  private pending: Promise<number> | null = null
  private lastAttemptAt = 0

  constructor(private readonly config: ConfigService) {}

  async getGeneralRate(configuredRate: number): Promise<GeneralVatRate> {
    const fallback = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : 21
    const key = this.config.get<string>('SERVIDOS_API_KEY')?.trim()
    if (!key) return { rate: fallback, source: 'fallback' }

    const now = Date.now()
    if (this.cached && now - this.cached.checkedAt < REFRESH_MS) {
      return { rate: this.cached.rate, source: 'api', checkedAt: new Date(this.cached.checkedAt).toISOString() }
    }

    if (now - this.lastAttemptAt >= RETRY_MS || this.pending) {
      if (!this.pending) {
        this.lastAttemptAt = now
        this.pending = this.fetchRate(key).finally(() => { this.pending = null })
      }
      try {
        const rate = await this.pending
        this.cached = { rate, checkedAt: Date.now() }
        return { rate, source: 'api', checkedAt: new Date(this.cached.checkedAt).toISOString() }
      } catch (error) {
        this.logger.warn(`No se pudo actualizar el IVA: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (this.cached) return { rate: this.cached.rate, source: 'stale', checkedAt: new Date(this.cached.checkedAt).toISOString() }
    return { rate: fallback, source: 'fallback' }
  }

  private async fetchRate(key: string) {
    const response = await fetch(API_URL, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw new Error(`API respondió ${response.status}`)
    const rate = readGeneralVatRate(await response.json())
    if (rate === null) throw new Error('Respuesta de alícuotas no reconocida')
    return rate
  }
}
