/**
 * Clasificador de productos en los 8 TIPOS DE PRODUCTO que pidió el cliente (las "Categorías" de la tienda).
 * Los deportes van aparte, en el campo Deporte (subcategoría) / Disciplinas.
 * Lo usan: la importación del Excel (productos nuevos sin categoría) y "Ordenar categorías" del panel.
 */
export const PRODUCT_TYPES = ['Calzado', 'Indumentaria', 'Protecciones', 'Guantes', 'Gorras y accesorios de cabeza', 'Bolsos y mochilas', 'Accesorios', 'Equipamiento'] as const
export type ProductType = typeof PRODUCT_TYPES[number]

// Palabra → categoría. Se elige la palabra que aparece PRIMERO en el nombre (el sustantivo suele ir adelante:
// "MEDIAS DE FUTBOL" es Accesorios aunque después diga otra cosa). Las raíces matchean el inicio de una palabra.
const WORDS: Record<ProductType, string[]> = {
  Calzado: ['zapatilla', 'botin', 'botines', 'ojota', 'chancla', 'shoe', 'calzado', 'sandalia', 'pantufla'],
  Indumentaria: ['remera', 'remeron', 'short', 'calza', 'campera', 'camiseta', 'uniforme', 'buzo', 'malla', 'top', 'pantalon', 'musculosa', 'rompeviento', 'bermuda', 'jogger', 'pollera', 'jersey', 'body', 'chaleco', 'vestido', 'conjunto', 'chomba', 'zunga', 'tee', 'pechera', 'equipo de lluvia', 'enterito', 'polera', 'babucha', 'falda', 'corpiño', 'boxer', 'jardinero', 'mangas', 'manga', 'indumentaria', 't shirt', 'shirt', 'pierna termica', 'termica', 'termico'],
  Protecciones: ['protector', 'canillera', 'espinillera', 'rodillera', 'tobillera', 'codera', 'muñequera', 'muñeq', 'casco', 'coquera', 'menisquera', 'muslera', 'pantorrillera', 'pantorrllllera', 'faja', 'cabezal', 'venda', 'bucal', 'tope', 'soporte', 'pantorrlllera'],
  Guantes: ['guante', 'guantin', 'manopla', 'callera', 'goalkeeper', 'glove'],
  'Gorras y accesorios de cabeza': ['gorra', 'gorro', 'piluso', 'visera', 'vincha', 'cap', 'pasamontaña', 'cuello', 'lente', 'antiparra', 'tapon', 'snorkel', 'bandana', 'clip nasal', 'clip nariz', 'multifuncion'],
  'Bolsos y mochilas': ['mochila', 'bolso', 'morral', 'riñonera', 'bag', 'botinero', 'portanotebook', 'carro', 'valija', 'bolsos'],
  Equipamiento: ['pelota', 'pelotita', 'paleta', 'raqueta', 'banda', 'tiraband', 'mancuerna', 'disco', 'colchoneta', 'colchon', 'red', 'aro', 'tubo', 'inflador', 'palo', 'barra', 'pesa', 'soga', 'ping', 'medicine', 'rolo', 'rueda', 'escalera', 'cono', 'arco', 'bosu', 'step', 'valla', 'tablero', 'pizarra', 'bocha', 'kettlebell', 'pera', 'bolsa', 'ejercitador', 'ladrillo', 'mat', 'push', 'pushup', 'pull', 'rodillo', 'plumas', 'pluma', 'corebag', 'core', 'jirafa', 'tabla', 'collarin', 'agarre', 'gravit', 'hidro', 'flotador', 'tortuguita', 'octagono', 'bulto', 'masajeador', 'relajador', 'pedalera', 'pedales', 'prensa', 'balon', 'ball', 'balls', 'yoga', 'power', 'straps', 'escalador', 'trampolin', 'chaleco lastrado', 'tobillera lastrada', 'candela', 'cerrojo', 'destorcedor', 'mosqueton', 'equipamiento', 'basket', 'basquet', 'futbol', 'fut', 'handball', 'volley', 'voley', 'rugby', 'golf', 'hockey', 'stick', 'box jump', 'muñe'],
  Accesorios: ['media', 'medias', 'medlas', 'soquete', 'socks', 'botella', 'caramañola', 'termo', 'thermos', 'thermoc', 'ther', 'vaso', 'linterna', 'pila', 'pilas', 'cinta', 'llavero', 'billetera', 'toalla', 'toallon', 'cinto', 'cinturon', 'cinturón', 'silbato', 'luz', 'candado', 'candad', 'overgrip', 'cubregrip', 'grip', 'antivibrador', 'funda', 'estuche', 'cronometro', 'cargador', 'cable', 'bateria', 'brazalete', 'broche', 'timbre', 'cerradura', 'llave', 'manguera', 'aerosol', 'medidor', 'carpa', 'reposera', 'manta', 'fosforo', 'camel', 'contigo', 'bubba', 'porta', 'cubre', 'repuesto', 'kit', 'set', 'tripack', 'combo', 'juego', 'cola', 'baston', 'pico', 'picos', 'accesorio', 'sock', 'crew', 'quarter', 'sneaker', 'footie', 'kneehigh', 'x1par', 'x2par', 'x3par', 'x6par', 'luces', 'puño', 'cielo tierra', 'guarda cabo', 'tarjeta', 'tarjetas'],
}
// Productos que empiezan con la marca y no dicen qué son.
const BRAND_FALLBACK: Record<string, ProductType> = { skechers: 'Calzado', olympikus: 'Calzado', 'new balance': 'Calzado', fila: 'Calzado', diadora: 'Calzado', topper: 'Calzado', proton: 'Calzado', at10: 'Equipamiento', onyx: 'Equipamiento', varlion: 'Equipamiento', siux: 'Equipamiento', bolonia: 'Equipamiento', tau: 'Equipamiento', ionic: 'Equipamiento', 'x trust': 'Equipamiento', tormedo: 'Equipamiento' }
// Ítems que no son productos (descuentos, envíos, servicios): se informan aparte, no se tocan.
const NOT_PRODUCTS: string[] = ['descuento', 'flete', 'servicio', 'voucher', 'redondeo', 'reparacion', 'producto al', 'temp', 'nota de credito', 'producto generico', 'exhibidor', 'envio']

// Categorías viejas que son DEPORTES: pasan a la subcategoría (Deporte) para que sigan en Disciplinas.
export const SPORT_CATEGORY: Record<string, string> = { running: 'Running', crossfit: 'CrossFit', 'fitness y yoga': 'Fitness y Yoga', gimnasio: 'Gimnasio', 'fitness gym aerobic': 'Gimnasio', 'lentes de natacion': 'Natación', 'gorra de natacion': 'Natación', 'guantes de arquero': 'Fútbol', canillera: 'Fútbol', rodilleras: 'Volley' }
// Categorías viejas que ya son un tipo de producto.
const OLD_TYPE: Record<string, ProductType> = { calzado: 'Calzado', zapatillas: 'Calzado', indumentaria: 'Indumentaria', 'bolsos y mochilas': 'Bolsos y mochilas', 'gorras deportivas': 'Gorras y accesorios de cabeza', 'gorra de natacion': 'Gorras y accesorios de cabeza', 'lentes de natacion': 'Gorras y accesorios de cabeza', 'guantes de arquero': 'Guantes', canillera: 'Protecciones', rodilleras: 'Protecciones', billeteras: 'Accesorios', 'fitness gym aerobic': 'Equipamiento' }

export const foldText = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

type Rule = { category: string; word: string }
const RULES: Rule[] = (Object.entries(WORDS) as Array<[ProductType, string[]]>).flatMap(([category, words]) => words.map((word) => ({ category, word: foldText(word) })))
const NOT_PRODUCT_RULES: Rule[] = NOT_PRODUCTS.map((word) => ({ category: '', word: foldText(word) }))
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ruleRegExps = new Map<string, RegExp>()
const regExpFor = (word: string) => {
  let re = ruleRegExps.get(word)
  if (!re) { re = new RegExp(`\\s${escapeRegExp(word)}(?:s|es)?(?=\\s)`); ruleRegExps.set(word, re) }
  return re
}

/** La palabra conocida que aparece primero en el nombre (el sustantivo suele ir adelante). */
function firstMatch(name: string, rules: Rule[]) {
  const text = ` ${foldText(name).replace(/[^a-z0-9 ]+/g, ' ')} `
  let best: (Rule & { index: number }) | null = null
  for (const rule of rules) {
    const match = regExpFor(rule.word).exec(text)
    if (match && (!best || match.index < best.index || (match.index === best.index && rule.word.length > best.word.length))) best = { ...rule, index: match.index }
  }
  return best
}

/** true si el nombre es de un ítem de facturación que no es producto (Flete, Descuento, Voucher...). */
export function isNotAProduct(name: string) {
  return firstMatch(name, NOT_PRODUCT_RULES)?.index === 0
}

/** Tipo de producto según el nombre (y la categoría vieja o la marca si el nombre no lo dice). Siempre devuelve uno. */
export function classifyProduct(name: string, oldCategories: string[] = []): { category: ProductType; reason: string } {
  const hit = firstMatch(name, RULES)
  if (hit) return { category: hit.category as ProductType, reason: `dice "${hit.word}"` }
  for (const old of oldCategories) {
    const type = OLD_TYPE[foldText(old)] ?? PRODUCT_TYPES.find((item) => foldText(item) === foldText(old))
    if (type) return { category: type, reason: `categoría anterior "${old}"` }
  }
  const folded = foldText(name)
  const brand = Object.keys(BRAND_FALLBACK).find((key) => folded.startsWith(key))
  if (brand) return { category: BRAND_FALLBACK[brand], reason: `marca ${brand}` }
  return { category: 'Accesorios', reason: 'sin pista' }
}
