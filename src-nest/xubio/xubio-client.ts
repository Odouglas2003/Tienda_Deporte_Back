import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common'

/**
 * Cliente de SOLO LECTURA para la API de Xubio. Únicamente pide el token, los productos y el stock:
 * nunca llama a endpoints que creen, cambien o borren cosas en Xubio, y no consulta ventas ni clientes.
 */
const BASE_URL = (process.env.XUBIO_API_URL || 'https://xubio.com/API/1.1').replace(/\/+$/, '')
// Xubio acepta como máximo 100 registros por página.
const PAGE_SIZE = 100
const MAX_PAGES = 500
// Xubio es lento para armar el stock (unos 15 segundos por página) y se cuelga si se le piden muchas juntas.
const REQUEST_TIMEOUT_MS = 120_000
// Páginas que se piden juntas. Si Xubio se traba, se pasa solo a 1.
const PARALLEL = 3

export type XubioProgress = (step: { done: number; total: number | null }) => void

export interface XubioItem {
  /** Código propio del producto en Xubio (la columna UsrCode del Excel). */
  code: string
  barcode: string
  name: string
  stock: number
}

type Token = { value: string; expiresAt: number }

export class XubioClient {
  private token?: Token
  private readonly logger = new Logger('XubioClient')

  constructor(private readonly clientId: string, private readonly secret: string) {}

  async getToken() {
    // Xubio da tokens de 1 hora y los corta cuando faltan 2 minutos: renovamos con margen.
    if (this.token && this.token.expiresAt - Date.now() > 5 * 60_000) return this.token.value
    const response = await this.fetchWithTimeout(`${BASE_URL}/TokenEndpoint`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    })
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new BadRequestException('Xubio no aceptó las claves. Revisá que el Client ID y el Secret ID estén bien copiados.')
    }
    if (!response.ok) throw new ServiceUnavailableException(`Xubio no respondió bien (error ${response.status}). Probá de nuevo en un rato.`)
    const body: any = await response.json().catch(() => null)
    const value = body?.access_token
    if (typeof value !== 'string' || !value) throw new ServiceUnavailableException('Xubio no devolvió un acceso válido.')
    const seconds = Number(body?.expires_in) > 0 ? Number(body.expires_in) : 3600
    this.token = { value, expiresAt: Date.now() + seconds * 1000 }
    return value
  }

  /** Productos de Xubio con su código y su stock actual (un solo depósito). */
  async fetchItems(onProgress?: XubioProgress): Promise<{ items: XubioItem[]; unmatchedStock: number }> {
    const products = await this.getList('/ProductoVentaBean', { activo: '1' })
    const stock = await this.getStock(onProgress)

    const byId = new Map<string, any>()
    const byName = new Map<string, any[]>()
    for (const product of products) {
      const id = pick(product, ['productoid', 'productoId', 'ID', 'id'])
      if (id) byId.set(id, product)
      const name = fold(pick(product, ['nombre']))
      if (name) byName.set(name, [...(byName.get(name) ?? []), product])
    }

    const items: XubioItem[] = []
    let unmatchedStock = 0
    for (const row of stock) {
      // El stock puede traer el código directo; si no, lo buscamos por id de producto o, último recurso, por nombre único.
      let code = pick(row, ['usrcode', 'usrCode', 'codigo'])
      let product: any = null
      if (!code) {
        const id = pick(row, ['productoid', 'productoId', 'producto.ID', 'producto.id', 'ID', 'id'])
        product = id ? byId.get(id) : null
        if (!product) {
          const sameName = byName.get(fold(pick(row, ['nombre', 'producto.nombre']))) ?? []
          product = sameName.length === 1 ? sameName[0] : null
        }
        code = product ? pick(product, ['usrcode', 'usrCode', 'codigo']) : ''
      }
      if (!code) { unmatchedStock++; continue }
      items.push({
        code,
        barcode: pick(row, ['codigoBarra']) || (product ? pick(product, ['codigoBarra']) : ''),
        name: pick(row, ['nombre', 'producto.nombre']) || (product ? pick(product, ['nombre']) : ''),
        stock: Math.max(0, Math.floor(Number(pick(row, ['stock', 'cantidad'])) || 0)),
      })
    }
    return { items, unmatchedStock }
  }

  private async getStock(onProgress?: XubioProgress) {
    const records = (body: any): any[] => (Array.isArray(body) ? body : Array.isArray(body?.registros) ? body.registros : [])
    const fetchPage = async (number: number, pages: number | null) => {
      const started = Date.now()
      const body = await this.get('/productoStock', { pagina: String(number), limitePagina: String(PAGE_SIZE) }, `el stock (página ${number}${pages ? ` de ${pages}` : ''})`)
      this.logger.log(`Xubio stock página ${number}${pages ? `/${pages}` : ''}: ${records(body).length} registros en ${Date.now() - started} ms`)
      return body
    }

    // La primera página dice cuántas hay en total.
    const first = await fetchPage(1, null)
    const total = Number(first?.paginado?.totalDeRegistros)
    const pages = Number.isFinite(total) && total > 0 ? Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES) : null
    onProgress?.({ done: 1, total: pages })
    if (Array.isArray(first) || records(first).length < PAGE_SIZE || pages === 1) return records(first)

    if (pages === null) {
      // Sin total: de a una hasta que se acaben.
      const rows = records(first)
      for (let number = 2; number <= MAX_PAGES; number++) {
        const found = records(await fetchPage(number, null))
        rows.push(...found)
        onProgress?.({ done: number, total: null })
        if (found.length < PAGE_SIZE) break
      }
      return rows
    }

    // De a PARALLEL páginas juntas. Si Xubio se traba con alguna, sigue de a una (plan B).
    const byPage = new Map<number, any[]>([[1, records(first)]])
    const pending = Array.from({ length: pages - 1 }, (_, index) => index + 2)
    let parallel = PARALLEL
    while (pending.length) {
      const batch = pending.splice(0, parallel)
      const results = await Promise.allSettled(batch.map((number) => fetchPage(number, pages)))
      const failed: number[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') byPage.set(batch[index], records(result.value))
        else failed.push(batch[index])
      })
      if (failed.length) {
        if (parallel === 1) throw (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason
        this.logger.warn(`Xubio se trabó con ${parallel} páginas juntas: sigo de a una.`)
        parallel = 1
        pending.unshift(...failed)
      }
      onProgress?.({ done: byPage.size, total: pages })
    }
    return [...byPage.keys()].sort((a, b) => a - b).flatMap((number) => byPage.get(number) ?? [])
  }

  private async getList(path: string, query: Record<string, string>) {
    const body = await this.get(path, query, 'la lista de productos')
    return Array.isArray(body) ? body : Array.isArray(body?.registros) ? body.registros : []
  }

  private async get(path: string, query: Record<string, string>, what: string) {
    const url = `${BASE_URL}${path}?${new URLSearchParams(query)}`
    let response = await this.fetchWithTimeout(url, { headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: 'application/json' } }, what)
    if (response.status === 401) {
      // Puede ser un acceso vencido: pedimos uno nuevo y probamos una vez más.
      this.token = undefined
      response = await this.fetchWithTimeout(url, { headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: 'application/json' } }, what)
    }
    if (!response.ok) {
      // Mostramos qué parte falló y lo que dice Xubio, para saber si es el plan, un permiso o un error de ellos.
      const detail = (await response.text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      this.logger.warn(`Xubio ${path} respondió ${response.status}: ${detail}`)
      const reason = `Xubio no dejó leer ${what} (error ${response.status}${detail ? `: ${detail}` : ''}).`
      if (response.status === 401 || response.status === 403) throw new BadRequestException(`${reason} Puede que el plan o el usuario de Xubio no tenga permiso para esto.`)
      throw new ServiceUnavailableException(`${reason} Probá de nuevo en un rato.`)
    }
    return response.json()
  }

  private async fetchWithTimeout(url: string, init: RequestInit, what = 'el acceso') {
    // Si Xubio tarda o se corta, probamos una vez más antes de avisar.
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      } catch (error) {
        lastError = error
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
    const slow = lastError instanceof Error && (lastError.name === 'TimeoutError' || lastError.name === 'AbortError')
    this.logger.warn(`Xubio ${what}: ${lastError instanceof Error ? `${lastError.name} ${lastError.message}` : lastError}`)
    throw new ServiceUnavailableException(slow
      ? `Xubio tardó demasiado en mandar ${what}. Probá de nuevo en un rato.`
      : `No se pudo conectar con Xubio al pedir ${what}. Probá de nuevo en un rato.`)
  }
}

function pick(source: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), source)
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
