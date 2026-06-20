const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../services/categories.service')

const getCategories = asyncHandler(async (req, res) => {
  const categories = await listCategories()
  res.json(new ApiResponse({ data: categories }))
})

const createOneCategory = asyncHandler(async (req, res) => {
  const category = await createCategory(req.body)
  res.status(201).json(new ApiResponse({ message: 'Categoria creada correctamente', data: category }))
})

const updateOneCategory = asyncHandler(async (req, res) => {
  const category = await updateCategory(req.params.categoryId, req.body)
  res.json(new ApiResponse({ message: 'Categoria actualizada correctamente', data: category }))
})

const deleteOneCategory = asyncHandler(async (req, res) => {
  const result = await deleteCategory(req.params.categoryId)
  res.json(new ApiResponse({ message: 'Categoria eliminada correctamente', data: result }))
})

module.exports = {
  getCategories,
  createOneCategory,
  updateOneCategory,
  deleteOneCategory,
}
