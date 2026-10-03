require('dotenv').config()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')

const manifestPath = path.resolve(__dirname, '../../image-review/publish-manifest.json')
const backupDir = path.resolve(__dirname, '../../image-review')

function imageHash(data) {
  const comma = data.indexOf(',')
  if (comma < 0) throw new Error('Invalid embedded image')
  return crypto.createHash('sha256').update(Buffer.from(data.slice(comma + 1), 'base64')).digest('hex')
}

async function main() {
  const apply = process.argv.includes('--apply')
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const bySku = new Map(entries.map((entry) => [entry.sku, entry]))
  if (entries.length !== bySku.size) throw new Error('Duplicate SKU in manifest')
  const prisma = new PrismaClient()
  try {
    const products = await prisma.product.findMany({
      where: { active: true, deletedAt: null },
      select: { id: true, sku: true, images: true, variants: true },
    })
    if (products.length !== entries.length) throw new Error(`Catalog/manifest mismatch: ${products.length}/${entries.length}`)
    const updates = products.map((product) => {
      const entry = bySku.get(product.sku)
      if (!entry) throw new Error(`Missing SKU in manifest: ${product.sku}`)
      const variantUrls = new Map(entry.variants.map((item) => [item.hash, item.url]))
      function replace(image) {
        if (!image || image === 'SIN FOTO' || image === product.images[0]) return entry.mainUrl
        if (!image.startsWith('data:image/')) throw new Error(`Unknown image format for ${product.sku}`)
        const url = variantUrls.get(imageHash(image))
        if (!url) throw new Error(`Unmapped variant image for ${product.sku}`)
        return url
      }
      const images = [...new Set(product.images.map(replace))]
      if (!images.length) images.push(entry.mainUrl)
      const variants = Array.isArray(product.variants) ? product.variants.map((variant) => ({
        ...variant,
        image: replace(variant?.image),
      })) : product.variants
      return { id: product.id, sku: product.sku, images, variants }
    })
    const imageCount = updates.reduce((sum, item) => sum + item.images.length, 0)
    if (!apply) {
      console.log(JSON.stringify({ mode: 'dry-run', products: updates.length, productImages: imageCount, variants: updates.reduce((sum, item) => sum + (Array.isArray(item.variants) ? item.variants.length : 0), 0) }))
      return
    }
    const backupPath = path.join(backupDir, `product-images-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(backupPath, JSON.stringify(products))
    await prisma.$transaction(updates.map((item) => prisma.product.update({
      where: { id: item.id },
      data: { images: item.images, variants: item.variants },
    })), { timeout: 120000 })
    console.log(JSON.stringify({ mode: 'applied', products: updates.length, productImages: imageCount, backupPath }))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
