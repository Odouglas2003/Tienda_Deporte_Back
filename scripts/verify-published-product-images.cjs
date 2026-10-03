require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../image-review/publish-manifest.json'), 'utf8'))
const bySku = new Map(manifest.map((item) => [item.sku, item]))
const prisma = new PrismaClient()

async function main() {
  const products = await prisma.product.findMany({
    where: { active: true, deletedAt: null },
    select: { sku: true, images: true, variants: true },
  })
  const errors = []
  let variantCount = 0
  let imageCount = 0
  for (const product of products) {
    const entry = bySku.get(product.sku)
    if (!entry) {
      errors.push(`Unexpected SKU: ${product.sku}`)
      continue
    }
    const validUrls = new Set([entry.mainUrl, ...entry.variants.map((variant) => variant.url)])
    if (product.images[0] !== entry.mainUrl) errors.push(`${product.sku}: incorrect main image`)
    for (const image of product.images) {
      imageCount++
      if (!validUrls.has(image)) errors.push(`${product.sku}: unmapped product image`)
    }
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      variantCount++
      if (!validUrls.has(variant.image)) errors.push(`${product.sku}: missing or unmapped variant image`)
    }
  }
  if (products.length !== manifest.length) errors.push(`Product count ${products.length}/${manifest.length}`)
  console.log(JSON.stringify({ products: products.length, productImages: imageCount, variants: variantCount, errors: errors.slice(0, 10) }, null, 2))
  if (errors.length) process.exitCode = 1
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
