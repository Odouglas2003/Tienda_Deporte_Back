require('dotenv').config()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error('Usage: node export-product-variant-images.cjs <output directory>')
  fs.mkdirSync(output, { recursive: true })
  const prisma = new PrismaClient()
  try {
    const products = await prisma.product.findMany({
      where: { active: true, deletedAt: null },
      select: { sku: true, name: true, images: true, variants: true },
    })
    const manifest = []
    for (const product of products) {
      const variants = Array.isArray(product.variants) ? product.variants : []
      const primary = product.images[0]
      const sources = [...new Set([...product.images, ...variants.map((item) => item?.image)].filter(Boolean))]
      for (const source of sources) {
        if (source === primary) continue
        if (!source.startsWith('data:image/')) {
          manifest.push({ sku: product.sku, name: product.name, sourceType: 'non-embedded', source })
          continue
        }
        const comma = source.indexOf(',')
        const bytes = Buffer.from(source.slice(comma + 1), 'base64')
        const hash = crypto.createHash('sha256').update(bytes).digest('hex')
        const subtype = source.slice(11, source.indexOf(';')).toLowerCase()
        const extension = subtype === 'jpeg' ? 'jpg' : subtype === 'webp' ? 'webp' : 'png'
        const file = `${product.sku.replace(/[^a-zA-Z0-9._-]/g, '_')}--${hash.slice(0, 12)}.${extension}`
        fs.writeFileSync(path.join(output, file), bytes)
        const colors = [...new Set(variants.filter((item) => item?.image === source).map((item) => item?.color).filter(Boolean))]
        manifest.push({ sku: product.sku, name: product.name, colors, hash, file, bytes: bytes.length, sourceType: 'embedded' })
      }
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log(JSON.stringify({ products: products.length, extraImages: manifest.length, embedded: manifest.filter((item) => item.sourceType === 'embedded').length }))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
