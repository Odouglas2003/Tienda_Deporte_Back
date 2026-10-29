// Tipos mínimos de Express (el proyecto no incluye @types/express).
type Request = { method: string; path: string; ip?: string; body?: any; socket: { remoteAddress?: string } }
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } }
type NextFunction = () => void

/**
 * Límite de pedidos por IP (en memoria). Frena fuerza bruta de contraseñas y cupones,
 * spam en formularios y abuso del checkout. Render pone la IP real en X-Forwarded-For
 * (por eso main.ts activa `trust proxy`).
 */
type Rule = { method: string; path: RegExp; limit: number; windowMs: number; key?: (req: Request) => string }

const MINUTE = 60_000
const rules: Rule[] = [
  { method: 'POST', path: /^\/api\/auth\/login$/, limit: 8, windowMs: 15 * MINUTE, key: (req) => String(req.body?.email ?? '').trim().toLowerCase() },
  { method: 'POST', path: /^\/api\/auth\/login$/, limit: 30, windowMs: 15 * MINUTE },
  { method: 'POST', path: /^\/api\/auth\/register$/, limit: 5, windowMs: 60 * MINUTE },
  { method: 'POST', path: /^\/api\/auth\/(forgot-password|reset-password)$/, limit: 6, windowMs: 30 * MINUTE },
  { method: 'PATCH', path: /^\/api\/auth\/me$/, limit: 10, windowMs: 15 * MINUTE },
  { method: 'POST', path: /^\/api\/coupons\/quote$/, limit: 15, windowMs: 10 * MINUTE },
  { method: 'POST', path: /^\/api\/communications\/(contact|newsletter)$/, limit: 5, windowMs: 10 * MINUTE },
  { method: 'POST', path: /^\/api\/orders(\/checkout)?$/, limit: 15, windowMs: 10 * MINUTE },
  { method: '*', path: /^\/api\//, limit: 600, windowMs: 5 * MINUTE },
]

const hits = new Map<string, { count: number; resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
}, MINUTE).unref()

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS') return next()
  const now = Date.now()
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  for (const [index, rule] of rules.entries()) {
    if ((rule.method !== '*' && rule.method !== req.method) || !rule.path.test(req.path)) continue
    const key = `${index}|${ip}|${rule.key ? rule.key(req) : ''}`
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + rule.windowMs })
      continue
    }
    entry.count += 1
    if (entry.count > rule.limit) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      res.status(429).json({ statusCode: 429, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' })
      return
    }
  }
  next()
}

/** En producción no se arranca con una clave de sesión débil o la de ejemplo: permitiría falsificar sesiones de administrador. */
export function assertStrongJwtSecret() {
  const secret = process.env.JWT_SECRET ?? ''
  const weak = !secret || secret.length < 32 || ['change-this-secret', 'qa-secret', 'secret'].includes(secret)
  if (weak && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET falta o es débil. Configurá en Render un valor aleatorio de al menos 32 caracteres.')
  }
}
