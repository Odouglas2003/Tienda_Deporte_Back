const { Router } = require('express')
const { getReportSummary } = require('../controllers/reports.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')

const router = Router()

router.use(authMiddleware, roleMiddleware('admin', 'superAdmin'))
router.get('/summary', getReportSummary)

module.exports = router
