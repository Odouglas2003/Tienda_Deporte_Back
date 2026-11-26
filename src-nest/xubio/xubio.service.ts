import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto'
import { PrismaService } from '../prisma.service'
import { XubioClient, type XubioItem, type XubioProgress } from './xubio-client'

// Leer todo Xubio tarda unos 11 minutos: una vez por hora alcanza y no lo sobrecarga.
const AUTO_SYNC_MS = 60 * 60_000
// Tope de filas que se mandan al panel por lista (sobra para este catálogo).
const LIST_LIMIT = 5000
// Lo leído en la vista previa se reusa al tocar "Actualizar ahora" si pasaron menos de 10 minutos.
const CACHE_MS = 10 * 60_000

type Job = {
  id: string
  kind: 'preview' | 'sync'
  state: 'running' | 'done' | 'error'
  progress: { done: number; total: number | null }
  startedAt: string
  finishedAt?: string
  result?: unknown
  error?: string
}

type Change = { productId: string; product: string; variant: string; code: string; before: number; after: number }
type Plan = {
  summary: {
    xubioProducts: number
    matched: number
    changes: number
    unchanged: number
    notInXubio: number
    xubioNotOnWeb: number
    blockedNoPrice: number
    unreadable: number
  }
  changes: Change[]
  xubioNotOnWebSample: string[]
  blockedSample: string[]
  /** Listas completas para ver en el panel. */
  lists: {
    notInXubio: Array<{ product: string; variant: string; sku: string }>
    xubioNotOnWeb: Array<{ code: string; name: string; stock: number }>
    blocked: Array<{ product: string; sku: string; xubioStock: number }>
  }
  /** Por producto: variantes con el stock nuevo, para aplicar. */
  updates: Map<string, { updatedAt: Date; variants: any[] | null; stock: number }>
}

/**
 * Trae el stock de Xubio y lo copia a la página. Xubio manda: la página solo lee de Xubio y nunca le escribe.
 * Se compara por código: el "Código" de Xubio (UsrCode del Excel) contra el SKU y los códigos de cada talle/color.
 */
@Injectable()
export class XubioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XubioService.name)
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private job: Job | null = null
  private cache?: { at: number; key: string; data: { items: XubioItem[]; unmatchedStock: number } }
  private client?: { key: string; instance: XubioClient }

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.autoSync() }, AUTO_SYNC_MS)
    this.timer.unref()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }

  async status() {
    const connection = await this.prisma.xubioConnection.findUnique({ where: { id: 'main' } })
    if (!connection) return { connected: false }
    return {
      connected: true,
      clientHint: connection.clientHint,
      autoSync: connection.autoSync,
      lastSyncAt: connection.lastSyncAt,
      lastResult: connection.lastResult,
      lastError: connection.lastError,
      connectedAt: connection.createdAt,
    }
  }

  async connect(body: any) {
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const secret = typeof body?.secretId === 'string' ? body.secretId.trim() : ''
    if (!clientId || !secret) throw new BadRequestException('Pegá el Client ID y el Secret ID.')
    if (clientId.length > 300 || secret.length > 300 || /\s/.test(clientId + secret)) throw new BadRequestException('Las claves tienen un formato raro. Copialas de nuevo desde Xubio.')

    // Probamos las claves antes de guardarlas.
    const client = new XubioClient(clientId, secret)
    await client.getToken()

    const data = { clientIdEnc: encrypt(clientId), secretEnc: encrypt(secret), clientHint: `…${clientId.slice(-4)}`, autoSync: false, lastSyncAt: null, lastResult: Prisma.DbNull, lastError: null }
    await this.prisma.xubioConnection.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data })
    this.client = undefined
    this.cache = undefined
    await this.log('Conexión con Xubio activada', {})
    return this.status()
  }

  async disconnect() {
    await this.prisma.xubioConnection.deleteMany({ where: { id: 'main' } })
    this.client = undefined
    this.cache = undefined
    await this.log('Conexión con Xubio desactivada', {})
    return { connected: false }
  }

  async setAutoSync(body: any) {
    if (typeof body?.autoSync !== 'boolean') throw new BadRequestException('Falta indicar si se activa o no.')
    const connection = await this.prisma.xubioConnection.findUnique({ where: { id: 'main' } })
    if (!connection) throw new NotFoundException('Primero conectá Xubio.')
    if (body.autoSync && !connection.lastSyncAt) throw new BadRequestException('Antes de activarlo, revisá la vista previa y actualizá el stock una vez a mano.')
    await this.prisma.xubioConnection.update({ where: { id: 'main' }, data: { autoSync: body.autoSync } })
    await this.log(body.autoSync ? 'Stock automático desde Xubio activado' : 'Stock automático desde Xubio pausado', {})
    return this.status()
  }

  /**
   * Xubio puede tardar varios minutos en mandar el stock, así que la lectura corre en segundo plano
   * y el panel pregunta cómo va (getJob). "preview" no escribe nada; "sync" copia el stock a la página.
   */
  start(kind: 'preview' | 'sync') {
    if (this.job?.state === 'running') {
      if (this.job.kind === kind) return this.job
      throw new ConflictException('Ya se está leyendo Xubio. Esperá a que termine.')
    }
    if (this.running) throw new ConflictException('Ya se está actualizando el stock solo. Esperá un minuto.')
    const job: Job = { id: Date.now().toString(36), kind, state: 'running', progress: { done: 0, total: null }, startedAt: new Date().toISOString() }
    this.job = job
    this.running = true
    const onProgress: XubioProgress = (progress) => { job.progress = progress }
    void (async () => {
      try {
        job.result = kind === 'preview' ? await this.preview(onProgress) : await this.runSync('manual', onProgress)
        job.state = 'done'
      } catch (error) {
        job.error = error instanceof Error ? error.message : 'Error desconocido'
        job.state = 'error'
      } finally {
        job.finishedAt = new Date().toISOString()
        this.running = false
      }
    })()
    return job
  }

  getJob() {
    return this.job ?? { state: 'none' }
  }

  /** Muestra qué cambiaría, sin tocar nada. */
  private async preview(onProgress: XubioProgress) {
    const plan = await this.buildPlan(onProgress, false)
    // Si se pudo leer, el aviso rojo de un error anterior ya no corresponde.
    await this.prisma.xubioConnection.updateMany({ where: { id: 'main' }, data: { lastError: null } })
    return { summary: plan.summary, changes: plan.changes.slice(0, LIST_LIMIT), xubioNotOnWebSample: plan.xubioNotOnWebSample, blockedSample: plan.blockedSample, lists: plan.lists }
  }

  private async autoSync() {
    if (this.running) return
    this.running = true
    try {
      const connection = await this.prisma.xubioConnection.findUnique({ where: { id: 'main' }, select: { autoSync: true } })
      if (connection?.autoSync) await this.runSync('automatic', undefined)
    } catch (error) {
      this.logger.warn(`Stock automático desde Xubio falló: ${error instanceof Error ? error.message : error}`)
    } finally {
      this.running = false
    }
  }

  private async runSync(mode: 'manual' | 'automatic', onProgress: XubioProgress | undefined) {
    let plan: Plan
    try {
      plan = await this.buildPlan(onProgress, mode === 'manual')
    } catch (error) {
      await this.prisma.xubioConnection.updateMany({ where: { id: 'main' }, data: { lastError: error instanceof Error ? error.message : 'Error desconocido' } })
      throw error
    }

    let updatedProducts = 0
    let skippedBusy = 0
    for (const [id, update] of plan.updates) {
      const data: Prisma.ProductUpdateManyMutationInput = { stock: update.stock }
      if (update.variants) data.variants = update.variants as Prisma.InputJsonValue
      // Si justo se vendió o se editó el producto, no lo pisamos: se toma en la próxima vuelta.
      const changed = await this.prisma.product.updateMany({ where: { id, updatedAt: update.updatedAt, deletedAt: null }, data })
      if (changed.count) updatedProducts++
      else skippedBusy++
    }

    const result = { ...plan.summary, updatedProducts, skippedBusy, mode, at: new Date().toISOString() }
    await this.prisma.xubioConnection.updateMany({ where: { id: 'main' }, data: { lastSyncAt: new Date(), lastResult: result as Prisma.InputJsonValue, lastError: null } })
    if (plan.summary.changes || mode === 'manual') await this.log('Stock actualizado desde Xubio', result)
    return result
  }

  private async buildPlan(onProgress: XubioProgress | undefined, useCache: boolean): Promise<Plan> {
    const client = await this.getClient()
    const key = this.client?.key ?? ''
    const cached = useCache && this.cache && this.cache.key === key && Date.now() - this.cache.at < CACHE_MS ? this.cache.data : null
    const data = cached ?? await client.fetchItems(onProgress)
    if (!cached) this.cache = { at: Date.now(), key, data }
    const { items, unmatchedStock } = data

    const byCode = new Map<string, number[]>()
    const byBarcode = new Map<string, number[]>()
    items.forEach((item, index) => {
      const code = loose(item.code)
      if (code) byCode.set(code, [...(byCode.get(code) ?? []), index])
      const barcode = loose(item.barcode)
      if (barcode) byBarcode.set(barcode, [...(byBarcode.get(barcode) ?? []), index])
    })

    const used = new Set<number>()
    const find = (keys: string[]) => {
      const found = new Set<number>()
      for (const key of keys.map(loose).filter(Boolean)) for (const index of byCode.get(key) ?? []) found.add(index)
      if (!found.size) for (const key of keys.map(loose).filter(Boolean)) for (const index of byBarcode.get(key) ?? []) found.add(index)
      return [...found]
    }
    const stockOf = (indexes: number[]) => indexes.reduce((sum, index) => sum + items[index].stock, 0)

    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, sku: true, stock: true, variants: true, active: true, priceRetail: true, updatedAt: true },
    })

    const summary = { xubioProducts: items.length, matched: 0, changes: 0, unchanged: 0, notInXubio: 0, xubioNotOnWeb: 0, blockedNoPrice: 0, unreadable: unmatchedStock }
    const changes: Change[] = []
    const blockedSample: string[] = []
    const lists: Plan['lists'] = { notInXubio: [], xubioNotOnWeb: [], blocked: [] }
    const variantLabel = (variant: any) => [variant?.color, variant?.size].filter(Boolean).join(' · ')
    const updates: Plan['updates'] = new Map()

    for (const product of products) {
      const variants = Array.isArray(product.variants) ? (product.variants as any[]).map((variant) => ({ ...variant })) : []
      const productChanges: Change[] = []
      let total = 0

      if (variants.length) {
        for (const variant of variants) {
          const indexes = find([variant?.sku, ...(Array.isArray(variant?.codes) ? variant.codes : [])])
          const before = Math.max(0, Math.floor(Number(variant?.stock) || 0))
          if (!indexes.length) {
            summary.notInXubio++
            total += before
            if (lists.notInXubio.length < LIST_LIMIT) lists.notInXubio.push({ product: product.name, variant: variantLabel(variant), sku: String(variant?.sku ?? '') })
            continue
          }
          indexes.forEach((index) => used.add(index))
          summary.matched++
          const after = stockOf(indexes)
          total += after
          if (after === before) { summary.unchanged++; continue }
          productChanges.push({ productId: product.id, product: product.name, variant: [variant?.color, variant?.size].filter(Boolean).join(' · ') || String(variant?.sku ?? ''), code: items[indexes[0]].code, before, after })
          variant.stock = after
        }
      } else {
        const indexes = find([product.sku])
        if (!indexes.length) {
          summary.notInXubio++
          if (lists.notInXubio.length < LIST_LIMIT) lists.notInXubio.push({ product: product.name, variant: '', sku: product.sku })
          continue
        }
        indexes.forEach((index) => used.add(index))
        summary.matched++
        total = stockOf(indexes)
        if (total === product.stock) { summary.unchanged++; continue }
        productChanges.push({ productId: product.id, product: product.name, variant: '', code: items[indexes[0]].code, before: product.stock, after: total })
      }

      if (!productChanges.length) continue
      // Sin precio también se actualiza: en la tienda sale "Consultar precio" y el pedido se rechaza hasta que tenga precio.
      // Solo se cuentan para avisar en el panel.
      if (!(Number(product.priceRetail) > 0) && total > 0) {
        summary.blockedNoPrice++
        if (blockedSample.length < 50) blockedSample.push(product.name)
        if (lists.blocked.length < LIST_LIMIT) lists.blocked.push({ product: product.name, sku: product.sku, xubioStock: total })
      }
      summary.changes += productChanges.length
      changes.push(...productChanges)
      updates.set(product.id, { updatedAt: product.updatedAt, variants: variants.length ? variants : null, stock: total })
    }

    const notOnWeb = items.filter((_, index) => !used.has(index))
    summary.xubioNotOnWeb = notOnWeb.length
    changes.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))

    lists.xubioNotOnWeb = notOnWeb.slice(0, LIST_LIMIT).map((item) => ({ code: item.code, name: item.name, stock: item.stock }))
    const byName = (a: { product: string }, b: { product: string }) => a.product.localeCompare(b.product, 'es')
    lists.notInXubio.sort(byName)
    lists.blocked.sort(byName)
    lists.xubioNotOnWeb.sort((a, b) => a.name.localeCompare(b.name, 'es'))

    return { summary, changes, updates, blockedSample, lists, xubioNotOnWebSample: notOnWeb.slice(0, 50).map((item: XubioItem) => `${item.code} · ${item.name}`) }
  }

  private async getClient() {
    const connection = await this.prisma.xubioConnection.findUnique({ where: { id: 'main' } })
    if (!connection) throw new NotFoundException('Primero conectá Xubio.')
    const key = `${connection.clientIdEnc}:${connection.secretEnc}`
    if (this.client?.key !== key) {
      let clientId: string, secret: string
      try {
        clientId = decrypt(connection.clientIdEnc)
        secret = decrypt(connection.secretEnc)
      } catch {
        throw new BadRequestException('No se pudieron leer las claves guardadas. Desconectá y volvé a conectar Xubio.')
      }
      this.client = { key, instance: new XubioClient(clientId, secret) }
    }
    return this.client.instance
  }

  private log(action: string, metadata: Record<string, unknown>) {
    return this.prisma.activityLog.create({ data: { action, entity: 'xubio', metadata: metadata as Prisma.InputJsonValue } }).catch(() => null)
  }
}

const loose = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Cifrado AES-256-GCM. La llave sale de XUBIO_ENCRYPTION_KEY o, si no está, del JWT_SECRET del servidor.
function key() {
  const base = process.env.XUBIO_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me'
  return Buffer.from(hkdfSync('sha256', base, 'nezha-xubio', 'credentials', 32))
}

function encrypt(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

function decrypt(value: string) {
  const [version, iv, tag, data] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('formato')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
