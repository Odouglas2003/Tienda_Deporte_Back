// Envío de correos con Resend, compartido por las funciones que avisan al cliente.

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM)
}

export function storeUrl() {
  const configured = process.env.STORE_URL || (process.env.CLIENT_URL || '').split(',').map((origin) => origin.trim()).find((origin) => origin.startsWith('https://'))
  return (configured || 'https://www.nezhasport.com.ar').replace(/\/$/, '')
}

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Arma un correo simple con la estética de la tienda. `paragraphs` va escapado; el botón es opcional. */
export function simpleEmailHtml(title: string, paragraphs: string[], button?: { label: string; url: string }, footer?: string) {
  const body = paragraphs.map((text) => `<p style="line-height:1.5">${escapeHtml(text)}</p>`).join('')
  const action = button ? `<p style="margin:28px 0"><a href="${escapeHtml(button.url)}" style="background:#d9480f;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(button.label)}</a></p>` : ''
  const note = footer ? `<p style="font-size:13px;color:#64748b">${escapeHtml(footer)}</p>` : ''
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033"><main style="max-width:560px;margin:auto;background:#fff;padding:28px"><p style="color:#0891b2;font-weight:bold">NEZHA SPORTS</p><h1 style="font-size:24px">${escapeHtml(title)}</h1>${body}${action}${note}</main></body></html>`
}

/** Devuelve true si Resend aceptó el correo. Nunca tira error: el que llama decide qué hacer si no salió. */
export async function sendEmail(message: { to: string; subject: string; text: string; html: string; idempotencyKey?: string }) {
  if (!emailConfigured()) return false
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ from: process.env.ORDER_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    })
    return response.ok
  } catch {
    return false
  }
}
