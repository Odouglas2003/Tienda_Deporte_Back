type ApprovalOrder = {
  code: string; customerName?: string; customerEmail?: string
  user?: { name: string; email: string } | null
  items: Array<{ productName: string; image?: string; product?: { images: string[] }; variantSku?: string; selectedColor?: string; selectedSize?: string; selectedGender?: string; quantity: number; unitPrice: number; subtotal: number }>
  total: number; taxAmount: number; shippingCost: number; paymentMethod: string; shipping?: unknown
}

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
const money = (value: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value)

export type OrderEmailKind = 'approval' | 'shipped' | 'delivered'

const messages: Record<OrderEmailKind, { title: string; intro: string; footer: string }> = {
  approval: { title: 'Tu compra fue aprobada', intro: 'Ya estamos preparando tu pedido.', footer: 'La aprobación del pedido no acredita el pago ni indica que ya fue despachado.' },
  shipped: { title: 'Tu pedido fue enviado', intro: 'Tu pedido ya fue despachado y está en camino a la dirección indicada.', footer: 'Este aviso confirma el despacho. La entrega todavía está pendiente.' },
  delivered: { title: 'Tu pedido fue entregado', intro: 'Registramos la entrega de tu pedido. ¡Gracias por elegir NEZHA!', footer: 'Si no recibiste tu pedido o tenés alguna consulta, comunicate con la tienda.' },
}

export function buildApprovalEmail(order: ApprovalOrder) { return buildOrderStatusEmail(order, 'approval') }

export function buildOrderStatusEmail(order: ApprovalOrder, kind: OrderEmailKind) {
  const message = messages[kind]
  const name = order.customerName || order.user?.name || 'Cliente'
  const email = order.customerEmail || order.user?.email || ''
  const shipping = (order.shipping ?? {}) as { address?: string; city?: string; postalCode?: string; notes?: string }
  const address = [shipping.address, shipping.city, shipping.postalCode].filter(Boolean).join(', ')
  const payment = ({ cash: 'Efectivo en local', transfer: 'Transferencia bancaria', transferencia: 'Transferencia bancaria' } as Record<string, string>)[order.paymentMethod] ?? order.paymentMethod
  const subtotal = order.items.reduce((sum, item) => sum + item.subtotal, 0)
  const rows = order.items.map(item => {
    const variant = [item.selectedColor, item.selectedSize && `Talle ${item.selectedSize}`, item.selectedGender].filter(Boolean).join(' · ')
    const image = item.image || item.product?.images[0]
    const photo = image && /^https:\/\//i.test(image) ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.productName)}" width="64" height="64" style="object-fit:contain">` : ''
    return `<tr><td style="padding:12px;border-bottom:1px solid #ddd">${photo}<br><strong>${escapeHtml(item.productName)}</strong><br>${escapeHtml(variant)}<br>SKU: ${escapeHtml(item.variantSku || '—')}</td><td style="padding:12px">${item.quantity}</td><td style="padding:12px">${money(item.unitPrice)}</td><td style="padding:12px">${money(item.subtotal)}</td></tr>`
  }).join('')
  const heading = `${message.title} · ${order.code}`
  const text = [
    'NEZHA SPORTS', heading, `Hola ${name}. ${message.intro}`,
    ...order.items.map(item => `${item.productName} | ${[item.selectedColor, item.selectedSize, item.selectedGender].filter(Boolean).join(' / ')} | SKU ${item.variantSku || '—'} | ${item.quantity} x ${money(item.unitPrice)} = ${money(item.subtotal)} (sin IVA)`),
    `Subtotal: ${money(subtotal)}`, `IVA: ${money(order.taxAmount)}`, `Envío: ${money(order.shippingCost)}`, `Total: ${money(order.total)}`,
    `Medio de pago: ${payment}`, `Entrega: ${address || 'A coordinar'}`, shipping.notes ? `Notas: ${shipping.notes}` : '',
    message.footer, 'Gracias por comprar en NEZHA.',
  ].filter(Boolean).join('\n')
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033"><main style="max-width:640px;margin:auto;background:white;padding:28px"><p style="color:#0891b2;font-weight:bold">NEZHA SPORTS</p><h1 style="font-size:26px">${escapeHtml(heading)}</h1><p>Hola ${escapeHtml(name)}. ${escapeHtml(message.intro)}</p><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th align="left">Producto</th><th>Cant.</th><th>Unitario sin IVA</th><th>Subtotal sin IVA</th></tr></thead><tbody>${rows}</tbody></table><p>Productos: ${money(subtotal)}<br>IVA: ${money(order.taxAmount)}<br>Envío: ${money(order.shippingCost)}</p><p style="font-size:22px"><strong>Total: ${money(order.total)}</strong></p><h2 style="font-size:18px">Pago y entrega</h2><p>Medio de pago: ${escapeHtml(payment)}<br>Entrega: ${escapeHtml(address || 'A coordinar')}</p>${shipping.notes ? `<p>Notas: ${escapeHtml(shipping.notes)}</p>` : ''}<p style="font-size:12px;color:#64748b">${escapeHtml(message.footer)}</p><p>Gracias por comprar en NEZHA.</p></main></body></html>`
  return { to: [email], subject: heading, html, text }
}
