require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

async function main() {
  const sku = process.argv[2]
  const output = process.argv[3]
  if (!sku || !output) throw new Error('Usage: node export-product-image.cjs <sku> <output.png>')
  const prisma = new PrismaClient()
  try {
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
