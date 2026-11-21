const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const ts = require('typescript')
const frontRequire = createRequire(path.resolve(__dirname, '../../tienda_front/package.json'))
const XLSX = frontRequire('xlsx')
let exported
const source = fs.readFileSync(path.resolve(__dirname, '../../tienda_front/utils/productCatalogWorkbook.ts'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText
const moduleValue = { exports: {} }
new Function('require', 'module', 'exports', js)(name => name === 'xlsx' ? { ...XLSX, writeFile: workbook => { exported = workbook } } : frontRequire(name), moduleValue, moduleValue.exports)
const { exportProductCatalogWorkbook, parseProductCatalogWorkbook, downloadProductTemplateWorkbook } = moduleValue.exports
const asFile = workbook => ({ arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) })

test('the exported workbook imports again with exact cents, descriptions, category and variant SKUs', async () => {
  const product = { id: 'p1', sku: 'P', name: 'Remera', description: 'Descripción propia', brand: 'NEZHA', category: 'indumentaria', subcategory: 'running', priceRetail: 119.99, priceWholesale: 80.01, stock: 3, images: [], variants: [{ sku: 'P-S', size: 'S', color: 'Negro', stock: 3, priceRetail: 119.99, priceWholesale: 80.01 }] }
  await exportProductCatalogWorkbook([product])
  const parsed = await parseProductCatalogWorkbook(asFile(exported))
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.rows[0].id, 'P-S')
  assert.equal(parsed.rows[0].price, '119.99 ARS')
  assert.equal(parsed.rows[0].price_wholesale, '80.01 ARS')
  assert.equal(parsed.rows[0].description, product.description)
  assert.equal(parsed.rows[0].google_product_category, product.category)
  assert.equal(parsed.rows[0]['style[0]'], 'running')
  assert.equal(parsed.issues.length, 0)
})
test('a minimal SKU and stock workbook accepts zero without requiring prices or names', async () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['SKU', 'Stock'], ['P-S', 0]]), 'Stock')
  const parsed = await parseProductCatalogWorkbook(asFile(workbook))
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.rows[0].id, 'P-S')
  assert.equal(parsed.rows[0].quantity_to_sell_on_facebook, '0')
})
test('the billing-system model (USRCODE, NOMBRE, TASAIVA) is read and asks for the missing prices', async () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['NUMERODECONTROL', 'NOMBRE', 'UNIDADDEMEDIDA', 'CATEGORIA', 'TASAIVA', 'CUENTACONTABLE', 'USRCODE', 'CODIGODEBARRAS', 'CATEGORIAIVAWEB2002'],
    [1, 'Cuaderno', 'Unidad (U)', 0, 'IVA21', 'Venta de Bienes', 'CUADERNO', '', 1],
    [2, 'Alquiler', 'Unidad (U)', 1, 'IVA10_5', 'Venta de Servicios', '', '779123', 12],
    ['', '', '', '', '', '', '', '', ''],
  ]), 'Sheet0')
  const parsed = await parseProductCatalogWorkbook(asFile(workbook))
  assert.equal(parsed.rows.length, 2)
  assert.deepEqual(parsed.rows.map(row => [row.id, row.title, row.tax, row.google_product_category]), [['CUADERNO', 'Cuaderno', 21, 'sin-categoria'], ['779123', 'Alquiler', 10.5, 'sin-categoria']])
  assert.deepEqual(parsed.issues.map(issue => issue.fields), [['PRECIO MAYORISTA', 'PRECIO MINORISTA'], ['PRECIO MAYORISTA', 'PRECIO MINORISTA']])
})
test('the downloadable model imports back without issues', async () => {
  await downloadProductTemplateWorkbook()
  const parsed = await parseProductCatalogWorkbook(asFile(exported))
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.issues.length, 0)
  assert.deepEqual([parsed.rows[0].id, parsed.rows[0].price, parsed.rows[0].price_wholesale, parsed.rows[0].quantity_to_sell_on_facebook, parsed.rows[0].brand, parsed.rows[0].tax, parsed.rows[0].google_product_category], ['PEL-FUT-5', '15000', '12000', '10', 'Penalty', 21, 'pelotas'])
})
