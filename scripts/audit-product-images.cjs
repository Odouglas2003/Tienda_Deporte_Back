require('dotenv').config()
const fs = require('fs')
const { PrismaClient } = require('@prisma/client')

function dimensions(data) {
  if (!data?.startsWith('data:image/')) return null
  const comma = data.indexOf(',')
  if (comma < 0) return null
  const buffer = Buffer.from(data.slice(comma + 1), 'base64')
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length }
  }
  if (buffer.length >= 10 && buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), bytes: buffer.length }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (length < 2) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), bytes: buffer.length }
      }
      offset += 2 + length
    }
  }
  return { width: null, height: null, bytes: buffer.length }
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const products = await prisma.product.findMany({ where: { active: true, deletedAt: null }, select: { id: true, name: true, sku: true, images: true, variants: true } })
    const rows = products.map((product) => {
      const source = product.images[0] || ''
      const dimensionsMain = dimensions(source)
      const variants = Array.isArray(product.variants) ? product.variants : []
      const variantImages = variants.map((variant) => variant?.image).filter(Boolean)
      const sources = [...new Set([...product.images, ...variantImages])]
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        source: !source ? 'missing' : source.includes('placeholder-product.jpg') ? 'placeholder' : source.startsWith('data:image/') ? 'embedded' : /^https?:\/\//.test(source) ? 'remote' : 'local',
        width: dimensionsMain?.width ?? null,
        height: dimensionsMain?.height ?? null,
        bytes: dimensionsMain?.bytes ?? null,
        imageCount: sources.length,
        betterVariant: variantImages.some((image) => { const size = dimensions(image); return size?.width >= 800 && size?.height >= 800 }),
      }
    })
    const counts = rows.reduce((acc, row) => { acc[row.source] = (acc[row.source] || 0) + 1; return acc }, {})
    const lowResolution = rows.filter((row) => row.width && (row.width < 600 || row.height < 600))
    const report = { total: rows.length, counts, lowResolutionCount: lowResolution.length, lowResolution: lowResolution.map(({ id, sku, name, width, height, bytes, betterVariant }) => ({ id, sku, name, width, height, bytes, betterVariant })), other: rows.filter((row) => !row.width).map(({ id, sku, name, source, imageCount }) => ({ id, sku, name, source, imageCount })) }
    const dimensionsSummary = { minWidth: Math.min(...rows.filter((row) => row.width).map((row) => row.width)), maxWidth: Math.max(...rows.filter((row) => row.width).map((row) => row.width)), minHeight: Math.min(...rows.filter((row) => row.height).map((row) => row.height)), maxHeight: Math.max(...rows.filter((row) => row.height).map((row) => row.height)) }
    const outIndex = process.argv.indexOf('--out')
    if (outIndex >= 0) fs.writeFileSync(process.argv[outIndex + 1], JSON.stringify(report, null, 2))
    console.log(JSON.stringify(process.argv.includes('--json') ? report : { total: report.total, counts, dimensionsSummary, lowResolutionCount: report.lowResolutionCount, betterVariantCount: rows.filter((row) => row.betterVariant).length, reportFile: outIndex >= 0 ? process.argv[outIndex + 1] : undefined }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
