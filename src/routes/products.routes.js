const { Router } = require('express')
const {
  getProducts,
  getOneProduct,
  createOneProduct,
  updateOneProduct,
  importCatalog,
} = require('../controllers/products.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')
const validateMiddleware = require('../middlewares/validate.middleware')
const { productValidator } = require('../validators/product.validators')

const router = Router()

router.get('/', getProducts)
router.get('/:productId', getOneProduct)
router.post('/import', authMiddleware, roleMiddleware('admin', 'superAdmin'), importCatalog)
router.post('/', authMiddleware, roleMiddleware('admin', 'superAdmin'), productValidator, validateMiddleware, createOneProduct)
router.put('/:productId', authMiddleware, roleMiddleware('admin', 'superAdmin'), productValidator, validateMiddleware, updateOneProduct)

module.exports = router
