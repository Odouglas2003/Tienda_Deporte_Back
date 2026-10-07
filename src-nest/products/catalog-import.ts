export type ImportMode = 'full' | 'prices' | 'stock'
export interface ImportOptions { mode?: ImportMode; dryRun?: boolean; expectedVersions?: Record<string, string | null> }
export interface ImportChange { field: string; before: string | number | null; after: string | number | null }
export interface ImportPlan { sku: string; name: string; kind: 'create' | 'update' | 'unchanged'; changes: ImportChange[] }

export function catalogNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const raw = String(value).trim().replace(/\s|ARS|\$/gi, '')
  if (!/^-?\d[\d.,]*$/.test(raw)) return NaN
  const normalized = raw.includes(',') && raw.includes('.')
    ? raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
    : raw.replace(',', '.')
  return Number(normalized)
}

export function catalogChanges(before: any, after: any): ImportChange[] {
  const result: ImportChange[] = []
  const fields = { name: 'Nombre', description: 'Descripción', category: 'Categoría', brand: 'Marca', subcategory: 'Disciplina', priceRetail: 'Minorista sin IVA', priceWholesale: 'Mayorista sin IVA', stock: 'Stock total', tax: 'IVA' }
  for (const [key, label] of Object.entries(fields)) {
    if (after[key] !== undefined && before?.[key] !== after[key]) result.push({ field: label, before: before?.[key] ?? null, after: after[key] })
  }
  for (const key of ['categories', 'tags', 'colors', 'sizes']) {
    if (after[key] && JSON.stringify(before?.[key] ?? []) !== JSON.stringify(after[key])) result.push({ field: { categories: 'Categorías', tags: 'Etiquetas', colors: 'Colores', sizes: 'Talles' }[key]!, before: (before?.[key] ?? []).join(', '), after: after[key].join(', ') })
  }
  for (const variant of after.variants ?? []) {
    const saved = before?.variants?.find((item: any) => item.sku === variant.sku)
    for (const [key, label] of Object.entries({ priceRetail: 'Minorista', priceWholesale: 'Mayorista', stock: 'Stock', color: 'Color', size: 'Talle', gender: 'Género' })) {
      if (variant[key] !== undefined && saved?.[key] !== variant[key]) result.push({ field: `${label} · ${variant.sku}`, before: saved?.[key] ?? null, after: variant[key] })
    }
  }
  return result
}
