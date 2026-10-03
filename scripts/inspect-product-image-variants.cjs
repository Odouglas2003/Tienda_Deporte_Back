require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()
  try {
    const products = await prisma.product.findMany({
      where: { active: true, deletedAt: null },
      select: { sku: true, name: true, images: true, variants: true },
    })
    const rows = products.map((product) => {
      const variants = Array.isArray(product.variants) ? product.variants : []
      const imageSet = new Set([...product.images, ...variants.map((variant) => variant?.image)].filter(Boolean))
      return { sku: product.sku, name: product.name, imageCount: imageSet.size, variantCount: variants.length }
    })
    console.log(JSON.stringify({
      totalProducts: rows.length,
      totalDistinctProductImages: rows.reduce((sum, row) => sum + row.imageCount, 0),
      productsWithMultipleImages: rows.filter((row) => row.imageCount > 1),
      productsWithVariants: rows.filter((row) => row.variantCount > 0).length,
      nonEmbeddedImages: products.flatMap((product) => product.images
        .filter((image) => image && !image.startsWith('data:image/'))
        .map((image) => ({ sku: product.sku, image }))),
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
