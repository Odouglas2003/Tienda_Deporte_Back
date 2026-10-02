require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

async function main() {
  const sku = process.argv[2]
  const output = process.argv[3]
  if (!sku || !output) throw new Error('Usage: node export-product-image.cjs <sku|--all> <output file|directory>')
  const prisma = new PrismaClient()
  try {
    if (sku === '--all') {
      const products = await prisma.product.findMany({ where: { active: true, deletedAt: null }, select: { sku: true, name: true, images: true } })
      fs.mkdirSync(output, { recursive: true })
      const saved = []
      for (const product of products) {
        const image = product.images[0]
        if (!image?.startsWith('data:image/')) continue
        const comma = image.indexOf(',')
        const subtype = image.slice(11, image.indexOf(';')).toLowerCase()
        const extension = subtype === 'jpeg' ? 'jpg' : subtype === 'webp' ? 'webp' : 'png'
        const file = path.join(output, `${product.sku.replace(/[^a-zA-Z0-9._-]/g, '_')}.${extension}`)
        const bytes = Buffer.from(image.slice(comma + 1), 'base64')
        fs.writeFileSync(file, bytes)
        saved.push({ sku: product.sku, name: product.name, file, bytes: bytes.length })
      }
      console.log(JSON.stringify({ exported: saved.length, directory: output, totalBytes: saved.reduce((sum, item) => sum + item.bytes, 0) }))
      return
    }
    const product = await prisma.product.findUnique({ where: { sku }, select: { name: true, images: true } })
    const image = product?.images?.[0]
    if (!image?.startsWith('data:image/')) throw new Error('No embedded image for that SKU')
    const comma = image.indexOf(',')
    const bytes = Buffer.from(image.slice(comma + 1), 'base64')
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, bytes)
    console.log(JSON.stringify({ sku, name: product.name, bytes: bytes.length, output }))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
