const { Router } = require('express')
const { getActivityLogs } = require('../controllers/activityLogs.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')

const router = Router()

router.use(authMiddleware, roleMiddleware('admin', 'superAdmin'))
router.get('/', getActivityLogs)

module.exports = router
