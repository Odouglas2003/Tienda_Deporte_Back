import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type RateSource = 'api' | 'stale' | 'fallback'
export type GeneralVatRate = { rate: number; source: RateSource; checkedAt?: string }

const REFRESH_MS = 12 * 60 * 60 * 1000
const RETRY_MS = 12 * 60 * 60 * 1000
const API_URL = 'https://api.vatsense.com/1.0/rates?country_code=AR'

function numericRate(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.replace('%', '').replace(',', '.').trim() : value
  const rate = Number(raw)
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(rate) && rate >= 0 && rate <= 50 ? rate : null
}

export function readGeneralVatRate(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  if (root.success !== true || !root.data || typeof root.data !== 'object') return null
  const data = root.data as Record<string, unknown>
  if (data.country_code !== 'AR' || !data.standard || typeof data.standard !== 'object') return null
  return numericRate((data.standard as Record<string, unknown>).rate)
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
    const key = this.config.get<string>('VATSENSE_API_KEY')?.trim()
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
    const authorization = `Basic ${Buffer.from(`user:${key}`).toString('base64')}`
    const response = await fetch(API_URL, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw new Error(`API respondió ${response.status}`)
    const rate = readGeneralVatRate(await response.json())
    if (rate === null) throw new Error('Respuesta de alícuotas no reconocida')
    return rate
  }
}
