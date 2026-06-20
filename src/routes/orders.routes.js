const { Router } = require('express')
const { getOrders, createOneOrder, updateOneOrderStatus } = require('../controllers/orders.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')
const validateMiddleware = require('../middlewares/validate.middleware')
const { createOrderValidator, updateOrderStatusValidator } = require('../validators/order.validators')

const router = Router()

router.use(authMiddleware)
router.get('/', getOrders)
router.post('/', createOrderValidator, validateMiddleware, createOneOrder)
router.patch('/:orderId/status', roleMiddleware('vendedor', 'admin', 'superAdmin'), updateOrderStatusValidator, validateMiddleware, updateOneOrderStatus)

module.exports = router
