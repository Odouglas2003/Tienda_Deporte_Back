const { Router } = require('express')
const {
  getCategories,
  createOneCategory,
  updateOneCategory,
  deleteOneCategory,
} = require('../controllers/categories.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')
const validateMiddleware = require('../middlewares/validate.middleware')
const { categoryValidator } = require('../validators/category.validators')

const router = Router()

router.get('/', getCategories)
router.post('/', authMiddleware, roleMiddleware('admin', 'superAdmin'), categoryValidator, validateMiddleware, createOneCategory)
router.put('/:categoryId', authMiddleware, roleMiddleware('admin', 'superAdmin'), categoryValidator, validateMiddleware, updateOneCategory)
router.delete('/:categoryId', authMiddleware, roleMiddleware('admin', 'superAdmin'), deleteOneCategory)

module.exports = router
