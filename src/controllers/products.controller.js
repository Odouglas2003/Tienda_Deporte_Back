const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  importProductsFromCatalog,
} = require('../services/products.service')

const getProducts = asyncHandler(async (req, res) => {
  const products = await listProducts(req.query)
  res.json(new ApiResponse({ data: products }))
})

const getOneProduct = asyncHandler(async (req, res) => {
  const product = await getProductById(req.params.productId)
  res.json(new ApiResponse({ data: product }))
})

const createOneProduct = asyncHandler(async (req, res) => {
  const product = await createProduct(req.body)
  res.status(201).json(new ApiResponse({ message: 'Producto creado correctamente', data: product }))
})

const updateOneProduct = asyncHandler(async (req, res) => {
  const product = await updateProduct(req.params.productId, req.body)
  res.json(new ApiResponse({ message: 'Producto actualizado correctamente', data: product }))
})

const importCatalog = asyncHandler(async (req, res) => {
  const summary = await importProductsFromCatalog(req.body?.rows)
  res.json(new ApiResponse({ message: 'Catalogo importado correctamente', data: summary }))
})

module.exports = {
  getProducts,
  getOneProduct,
  createOneProduct,
  updateOneProduct,
  importCatalog,
}
