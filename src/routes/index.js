const { Router } = require('express')
const authRoutes = require('./auth.routes')
const usersRoutes = require('./users.routes')
const categoriesRoutes = require('./categories.routes')
const productsRoutes = require('./products.routes')
const ordersRoutes = require('./orders.routes')
const sellersRoutes = require('./sellers.routes')
const reportsRoutes = require('./reports.routes')
const settingsRoutes = require('./settings.routes')
const activityLogsRoutes = require('./activityLogs.routes')

const router = Router()

router.use('/auth', authRoutes)
router.use('/users', usersRoutes)
router.use('/categories', categoriesRoutes)
router.use('/products', productsRoutes)
router.use('/orders', ordersRoutes)
router.use('/sellers', sellersRoutes)
router.use('/reports', reportsRoutes)
router.use('/settings', settingsRoutes)
router.use('/activity-logs', activityLogsRoutes)

module.exports = router
