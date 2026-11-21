// Cómo se cargan los precios:
// - Precio minorista (retail): es el precio FINAL con IVA incluido.
// - Precio mayorista: es SIN IVA; el IVA se suma aparte.
// La tienda calcula igual (tienda_front/utils/tax.ts); si cambiás algo acá, cambialo allá también.

const round2 = (value: number) => Math.round(value * 100) / 100

/** Parte sin IVA de un importe con IVA incluido. */
export function netFromGross(gross: number, taxRate: number) {
  return round2(gross / (1 + taxRate / 100))
}

/**
 * IVA de una línea. Si el precio ya traía IVA (minorista sin cupón), el IVA es la diferencia,
 * así "sin IVA + IVA" da exactamente el precio publicado. Si no, se calcula sobre el neto.
 */
export function lineTaxAmount(listPrice: number, quantity: number, taxRate: number, isWholesale: boolean, couponPercent = 0) {
  const net = netLineAmount(listPrice, quantity, taxRate, isWholesale)
  if (!isWholesale && !couponPercent) return round2(round2(listPrice * quantity) - net)
  const discount = Math.round(net * couponPercent) / 100
  return Math.round((net - discount) * taxRate) / 100
}

/** Importe sin IVA de una línea del pedido. */
export function netLineAmount(listPrice: number, quantity: number, taxRate: number, isWholesale: boolean) {
  const line = round2(listPrice * quantity)
  return isWholesale ? line : netFromGross(line, taxRate)
}
