import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common'

/**
 * Cliente de SOLO LECTURA para la API de Xubio. Únicamente pide el token, los productos y el stock:
 * nunca llama a endpoints que creen, cambien o borren cosas en Xubio, y no consulta ventas ni clientes.
 */
const BASE_URL = (process.env.XUBIO_API_URL || 'https://xubio.com/API/1.1').replace(/\/+$/, '')
const PAGE_SIZE = 500
const MAX_PAGES = 200

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
  async fetchItems(): Promise<{ items: XubioItem[]; unmatchedStock: number }> {
    const [products, stock] = [await this.getList('/ProductoVentaBean', { activo: '1' }), await this.getStock()]

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

  private async getStock() {
    const rows: any[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get('/productoStock', { pagina: String(page), limitePagina: String(PAGE_SIZE) })
      const records = Array.isArray(body) ? body : Array.isArray(body?.registros) ? body.registros : []
      rows.push(...records)
      const total = Number(body?.paginado?.totalDeRegistros)
      if (Array.isArray(body) || !records.length || records.length < PAGE_SIZE || (Number.isFinite(total) && rows.length >= total)) break
    }
    return rows
  }

  private async getList(path: string, query: Record<string, string>) {
    const body = await this.get(path, query)
    return Array.isArray(body) ? body : Array.isArray(body?.registros) ? body.registros : []
  }

  private async get(path: string, query: Record<string, string>) {
    const url = `${BASE_URL}${path}?${new URLSearchParams(query)}`
    const what = path === '/productoStock' ? 'el stock' : 'la lista de productos'
    let response = await this.fetchWithTimeout(url, { headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: 'application/json' } })
    if (response.status === 401) {
      // Puede ser un acceso vencido: pedimos uno nuevo y probamos una vez más.
      this.token = undefined
      response = await this.fetchWithTimeout(url, { headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: 'application/json' } })
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

  private async fetchWithTimeout(url: string, init: RequestInit) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
    } catch {
      throw new ServiceUnavailableException('No se pudo conectar con Xubio. Probá de nuevo en un rato.')
    }
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
