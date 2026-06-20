const Category = require('../models/Category')
const Product = require('../models/Product')
const ApiError = require('../utils/ApiError')

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cleanName(value) {
  return String(value || '').trim()
}

function cleanCategoryList(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => cleanName(value))
        .filter(Boolean)
    )
  )
}

function getProductCategoryNames(product = {}) {
  return cleanCategoryList([...(Array.isArray(product.categories) ? product.categories : []), product.category])
}

async function ensureCategoryExists(name, options = {}) {
  const cleanedName = cleanName(name)

  if (!cleanedName) {
    return null
  }

  const normalizedName = normalizeText(cleanedName)
  const slug = slugify(cleanedName) || normalizedName || 'categoria'
  const existingCategory = await Category.findOne({ normalizedName })

  if (!existingCategory) {
    const createdCategory = await Category.create({
      name: cleanedName,
      normalizedName,
      slug,
      description: options.description || '',
      active: options.active ?? true,
    })

    return createdCategory.toObject()
  }

  if (existingCategory.deletedAt || existingCategory.name !== cleanedName || existingCategory.slug !== slug) {
    existingCategory.name = cleanedName
    existingCategory.slug = slug
    existingCategory.deletedAt = null
    if (typeof options.active === 'boolean') {
      existingCategory.active = options.active
    }
    if (options.description !== undefined) {
      existingCategory.description = options.description
    }
    await existingCategory.save()
  }

  return existingCategory.toObject()
}

async function syncCategoriesFromProducts() {
  const products = await Product.find({ deletedAt: null }).select('category categories').lean()
  const distinctCategories = Array.from(new Set(products.flatMap((product) => getProductCategoryNames(product))))

  for (const categoryName of distinctCategories) {
    await ensureCategoryExists(categoryName)
  }
}

async function attachProductCounts(categories) {
  const products = await Product.find({ deletedAt: null }).select('category categories').lean()
  const countsByCategory = new Map()

  products.forEach((product) => {
    getProductCategoryNames(product).forEach((categoryName) => {
      const normalizedName = normalizeText(categoryName)
      countsByCategory.set(normalizedName, (countsByCategory.get(normalizedName) ?? 0) + 1)
    })
  })

  return categories.map((category) => ({
    ...category,
    productCount: countsByCategory.get(category.normalizedName) ?? 0,
  }))
}

async function listCategories() {
  await syncCategoriesFromProducts()

  const categories = await Category.find({ deletedAt: null }).sort({ name: 1 }).lean()
  return attachProductCounts(categories)
}

async function createCategory(payload) {
  const name = cleanName(payload.name)

  if (!name) {
    throw new ApiError(400, 'El nombre de la categoria es obligatorio')
  }

  const normalizedName = normalizeText(name)
  const existingCategory = await Category.findOne({ normalizedName })

  if (existingCategory && !existingCategory.deletedAt) {
    throw new ApiError(409, 'La categoria ya existe')
  }

  const category = await ensureCategoryExists(name, {
    description: cleanName(payload.description),
    active: payload.active !== false,
  })

  return category
}

async function updateCategory(categoryId, payload) {
  const category = await Category.findOne({ _id: categoryId, deletedAt: null })

  if (!category) {
    throw new ApiError(404, 'Categoria no encontrada')
  }

  const nextName = cleanName(payload.name || category.name)
  const nextNormalizedName = normalizeText(nextName)

  if (!nextName) {
    throw new ApiError(400, 'El nombre de la categoria es obligatorio')
  }

  if (nextNormalizedName !== category.normalizedName) {
    const duplicatedCategory = await Category.findOne({ normalizedName: nextNormalizedName, deletedAt: null })

    if (duplicatedCategory) {
      throw new ApiError(409, 'Ya existe una categoria con ese nombre')
    }
  }

  const previousName = category.name
  category.name = nextName
  category.normalizedName = nextNormalizedName
  category.slug = slugify(nextName) || category.slug
  category.description = cleanName(payload.description ?? category.description)

  if (typeof payload.active === 'boolean') {
    category.active = payload.active
  }

  await category.save()

  if (previousName !== nextName) {
    const products = await Product.find({
      deletedAt: null,
      $or: [{ category: previousName }, { categories: previousName }],
    })

    for (const product of products) {
      const renamedCategories = cleanCategoryList(
        getProductCategoryNames(product).map((categoryName) => (categoryName === previousName ? nextName : categoryName))
      )

      product.categories = renamedCategories
      product.category = product.category === previousName ? nextName : product.category

      if (!product.category || !renamedCategories.includes(product.category)) {
        product.category = renamedCategories[0] || nextName
      }

      await product.save()
    }
  }

  return {
    ...category.toObject(),
    productCount: await Product.countDocuments({
      deletedAt: null,
      $or: [{ category: nextName }, { categories: nextName }],
    }),
  }
}

async function deleteCategory(categoryId) {
  const category = await Category.findOne({ _id: categoryId, deletedAt: null })

  if (!category) {
    throw new ApiError(404, 'Categoria no encontrada')
  }

  const productCount = await Product.countDocuments({
    deletedAt: null,
    $or: [{ category: category.name }, { categories: category.name }],
  })

  if (productCount > 0) {
    throw new ApiError(409, 'No podes eliminar una categoria que esta asignada a productos')
  }

  category.deletedAt = new Date()
  await category.save()

  return { id: category._id.toString(), deleted: true }
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  ensureCategoryExists,
  syncCategoriesFromProducts,
}
