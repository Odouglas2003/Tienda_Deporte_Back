const { Router } = require('express')
const { getMyClients, getMyOrders } = require('../controllers/sellers.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')

const router = Router()

router.use(authMiddleware, roleMiddleware('vendedor', 'admin', 'superAdmin'))
router.get('/my/clients', getMyClients)
router.get('/my/orders', getMyOrders)

module.exports = router
