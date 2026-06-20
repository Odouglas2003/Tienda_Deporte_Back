const Product = require('../models/Product')
const Order = require('../models/Order')
const ApiError = require('../utils/ApiError')
const { ensureCategoryExists } = require('./categories.service')

function stringValue(value) {
  if (value === undefined || value === null) {
    return ''
  }

  return String(value).trim()
}

function parseSpreadsheetNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const rawValue = stringValue(value)

  if (!rawValue) {
    return null
  }

  let normalizedValue = rawValue.replace(/[^\d,.-]/g, '')

  if (!normalizedValue) {
    return null
  }

  const hasComma = normalizedValue.includes(',')
  const hasDot = normalizedValue.includes('.')

  if (hasComma && hasDot) {
    if (normalizedValue.lastIndexOf(',') > normalizedValue.lastIndexOf('.')) {
      normalizedValue = normalizedValue.replace(/\./g, '').replace(',', '.')
    } else {
      normalizedValue = normalizedValue.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = normalizedValue.split(',')
    if (parts.length === 2 && parts[1].length <= 2) {
      normalizedValue = `${parts[0].replace(/\./g, '')}.${parts[1]}`
    } else {
      normalizedValue = normalizedValue.replace(/,/g, '')
    }
  }

  const parsedValue = Number(normalizedValue)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

function parseSpreadsheetCurrency(value) {
  return parseSpreadsheetNumber(value)
}

function normalizeDiscountValue(value) {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, parsedValue))
}

function parseBoolean(value, fallback = null) {
  if (typeof value === 'boolean') {
    return value
  }

  const rawValue = stringValue(value).toLowerCase()

  if (!rawValue) {
    return fallback
  }

  if (['true', '1', 'si', 'sí', 'yes', 'y', 'active', 'activo'].includes(rawValue)) {
    return true
  }

  if (['false', '0', 'no', 'n', 'inactive', 'inactivo'].includes(rawValue)) {
    return false
  }

  return fallback
}

function normalizeCatalogRow(row = {}) {
  return Object.entries(row).reduce((accumulator, [key, value]) => {
    accumulator[stringValue(key).toLowerCase()] = value
    return accumulator
  }, {})
}

function absoluteArray(value) {
  return Array.from(new Set(value.filter(Boolean)))
}

function parseCategoryInput(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseCategoryInput(item))
  }

  const rawValue = stringValue(value)

  if (!rawValue) {
    return []
  }

  return rawValue
    .split(',')
    .map((item) => stringValue(item))
    .filter(Boolean)
}

function normalizeProductCategories(payload = {}, fallbackCategory = '') {
  const categories = absoluteArray([
    stringValue(payload.category || fallbackCategory),
    ...parseCategoryInput(payload.categories),
  ])

  return {
    category: categories[0] ?? '',
    categories,
  }
}

async function ensureCategoriesExist(categoryNames = []) {
  for (const categoryName of absoluteArray(categoryNames.map((item) => stringValue(item)))) {
    await ensureCategoryExists(categoryName)
  }
}

function buildCatalogProductPayload(row, existingProduct) {
  const sku = stringValue(row.id || row.sku || existingProduct?.sku)
  const name = stringValue(row.title || row.name || existingProduct?.name)
  const description = stringValue(row.description || existingProduct?.description)
  const category = stringValue(
    row.category ||
      row.google_product_category ||
      row.fb_product_category ||
      existingProduct?.category
  ).toLowerCase()
  const categoryList = absoluteArray([
    category,
    ...parseCategoryInput(row.categories).map((value) => value.toLowerCase()),
    ...parseCategoryInput(row.categorias).map((value) => value.toLowerCase()),
    ...parseCategoryInput(existingProduct?.categories).map((value) => value.toLowerCase()),
  ])
  const subcategory = stringValue(row.subcategory || row['style[0]'] || existingProduct?.subcategory).toLowerCase()
  const brand = stringValue(row.brand || existingProduct?.brand)

  const priceRetail =
    parseSpreadsheetCurrency(row.price_retail || row.price || existingProduct?.priceRetail) ??
    existingProduct?.priceRetail ??
    null
  const priceWholesale =
    parseSpreadsheetCurrency(
      row.price_wholesale ||
        row.precio_mayorista ||
        row.wholesale_price ||
        existingProduct?.priceWholesale
    ) ??
    existingProduct?.priceWholesale ??
    null

  const quantity =
    parseSpreadsheetNumber(row.stock || row.quantity_to_sell_on_facebook || existingProduct?.stock) ??
    existingProduct?.stock ??
    0
  const tax =
    parseSpreadsheetNumber(row.tax || row.iva || existingProduct?.tax) ??
    existingProduct?.tax ??
    0

  const active =
    parseBoolean(row.active, null) ??
    parseBoolean(row.nezha_active, null) ??
    existingProduct?.active ??
    true

  const featured =
    parseBoolean(row.featured, null) ??
    parseBoolean(row.destacado, null) ??
    existingProduct?.featured ??
    false
  const discount = normalizeDiscountValue(
    parseSpreadsheetNumber(row.discount || row.descuento || row.sale_discount || existingProduct?.discount) ??
      existingProduct?.discount ??
      0
  )

  const imageLink = stringValue(row.image_link || row.image || existingProduct?.images?.[0])
  const images = imageLink ? [imageLink] : existingProduct?.images ?? []
  const tags = absoluteArray([
    stringValue(row['product_tags[0]']),
    stringValue(row['product_tags[1]']),
    stringValue(row.tag_1),
    stringValue(row.tag_2),
    ...(existingProduct?.tags ?? []),
  ])

  return {
    sku,
    name,
    description,
    category: categoryList[0] ?? category,
    categories: categoryList,
    subcategory,
    brand,
    priceRetail,
    priceWholesale,
    stock: quantity,
    tax,
    active,
    featured,
    discount,
    images,
    tags,
  }
}

function validateCatalogProductPayload(payload) {
  if (!payload.sku) {
    return 'El SKU/id es obligatorio'
  }

  if (!payload.name) {
    return 'El nombre/titulo es obligatorio'
  }

  if (!payload.category) {
    return 'La categoria es obligatoria'
  }

  if (payload.priceRetail === null) {
    return 'El precio retail es obligatorio'
  }

  if (payload.priceWholesale === null) {
    return 'El precio mayorista es obligatorio'
  }

  return null
}

async function listBestSellingProducts(query, limit) {
  const ranking = await Order.aggregate([
    {
      $match: {
        deletedAt: null,
        status: { $nin: ['cancelado', 'rechazado'] },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: {
          productId: '$items.product',
          productName: '$items.productName',
        },
        soldQuantity: { $sum: '$items.quantity' },
        soldRevenue: { $sum: '$items.subtotal' },
        lastSoldAt: { $max: '$createdAt' },
      },
    },
    { $sort: { soldQuantity: -1, soldRevenue: -1, lastSoldAt: -1 } },
  ])

  if (ranking.length === 0) {
    return []
  }

  const rankedIds = ranking.map((item) => item._id.productId).filter(Boolean)
  const rankedNames = ranking.map((item) => item._id.productName).filter(Boolean)
  const products = await Product.find({
    $and: [
      query,
      {
        $or: [{ _id: { $in: rankedIds } }, { name: { $in: rankedNames } }],
      },
    ],
  }).lean()

  const productsById = new Map(products.map((product) => [product._id.toString(), product]))
  const productsByName = new Map(products.map((product) => [product.name, product]))

  const rankedProducts = ranking
    .map((item) => {
      const product =
        productsById.get(item._id.productId?.toString()) ??
        productsByName.get(item._id.productName)

      if (!product) {
        return null
      }

      return {
        ...product,
        soldQuantity: item.soldQuantity,
      }
    })
    .filter(Boolean)

  return typeof limit === 'number' ? rankedProducts.slice(0, limit) : rankedProducts
}

async function listProducts(filters = {}) {
  const query = { deletedAt: null }
  const andConditions = []
  const limit = Number(filters.limit)
  const hasLimit = Number.isFinite(limit) && limit > 0

  if (filters.active !== undefined) {
    query.active = filters.active === 'true' || filters.active === true
  }

  if (filters.category) {
    andConditions.push({
      $or: [{ category: filters.category }, { categories: filters.category }],
    })
  }

  if (filters.brand) {
    query.brand = filters.brand
  }

  if (filters.onlyFeatured === 'true' || filters.onlyFeatured === true) {
    query.featured = true
  }

  if (filters.onSale === 'true' || filters.onSale === true || filters.ofertas === 'true' || filters.ofertas === true) {
    query.discount = { $gt: 0 }
  }

  if (filters.discipline) {
    andConditions.push({
      $or: [{ subcategory: filters.discipline }, { tags: filters.discipline }],
    })
  }

  if (filters.minPrice || filters.maxPrice) {
    query.priceRetail = {}

    if (filters.minPrice !== undefined) {
      query.priceRetail.$gte = Number(filters.minPrice)
    }

    if (filters.maxPrice !== undefined) {
      query.priceRetail.$lte = Number(filters.maxPrice)
    }
  }

  if (filters.search) {
    andConditions.push({
      $or: [
      { name: { $regex: filters.search, $options: 'i' } },
      { brand: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } },
      ],
    })
  }

  if (andConditions.length === 1) {
    query.$or = andConditions[0].$or
  }

  if (andConditions.length > 1) {
    query.$and = andConditions
  }

  if (filters.bestSelling === 'true' || filters.bestSelling === true) {
    const bestSellingProducts = await listBestSellingProducts(query, hasLimit ? limit : undefined)

    if (bestSellingProducts.length > 0) {
      return bestSellingProducts
    }
  }

  const productsQuery = Product.find(query).sort({ featured: -1, createdAt: -1 })

  if (hasLimit) {
    productsQuery.limit(limit)
  }

  return productsQuery.lean()
}

async function getProductById(productId) {
  const product = await Product.findOne({ _id: productId, deletedAt: null }).lean()

  if (!product) {
    throw new ApiError(404, 'Producto no encontrado')
  }

  return product
}

async function createProduct(payload) {
  const normalizedCategories = normalizeProductCategories(payload)
  await ensureCategoriesExist(normalizedCategories.categories)

  const product = await Product.create({
    ...payload,
    ...normalizedCategories,
    newArrival: payload.newArrival ?? true,
  })

  return product.toObject()
}

async function updateProduct(productId, payload) {
  const normalizedCategories = normalizeProductCategories(payload)

  if (normalizedCategories.categories.length > 0) {
    await ensureCategoriesExist(normalizedCategories.categories)
  }

  return Product.findOneAndUpdate(
    { _id: productId, deletedAt: null },
    { ...payload, ...normalizedCategories },
    { new: true, lean: true }
  )
}

async function importProductsFromCatalog(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, 'No se recibieron filas para importar')
  }

  const normalizedRows = rows.map((row, index) => ({
    rowNumber: Number(row?.rowNumber) || index + 3,
    values: normalizeCatalogRow(row),
  }))

  const skus = normalizedRows
    .map((row) => stringValue(row.values.id || row.values.sku))
    .filter(Boolean)

  const existingProducts = await Product.find({ sku: { $in: skus } }).lean()
  const existingBySku = new Map(existingProducts.map((product) => [product.sku, product]))

  let createdCount = 0
  let updatedCount = 0
  let skippedCount = 0
  const errors = []

  for (const row of normalizedRows) {
    try {
      const sku = stringValue(row.values.id || row.values.sku)
      const existingProduct = existingBySku.get(sku)
      const payload = buildCatalogProductPayload(row.values, existingProduct)
      const validationError = validateCatalogProductPayload(payload)

      if (validationError) {
        skippedCount += 1
        errors.push({
          rowNumber: row.rowNumber,
          sku: payload.sku || sku || null,
          message: validationError,
        })
        continue
      }

      const normalizedCategories = normalizeProductCategories(payload, payload.category)
      await ensureCategoriesExist(normalizedCategories.categories)

      const savedProduct = await Product.findOneAndUpdate(
        { sku: payload.sku },
        {
          $set: {
            ...payload,
            ...normalizedCategories,
            deletedAt: null,
          },
          $setOnInsert: {
            newArrival: true,
          },
        },
        {
          new: true,
          upsert: true,
          lean: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      )

      if (existingProduct) {
        updatedCount += 1
      } else {
        createdCount += 1
      }

      existingBySku.set(savedProduct.sku, savedProduct)
    } catch (error) {
      skippedCount += 1
      errors.push({
        rowNumber: row.rowNumber,
        sku: stringValue(row.values.id || row.values.sku) || null,
        message: error.message || 'No se pudo importar la fila',
      })
    }
  }

  return {
    totalRows: normalizedRows.length,
    createdCount,
    updatedCount,
    skippedCount,
    errorCount: errors.length,
    errors,
  }
}

module.exports = {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  importProductsFromCatalog,
}
