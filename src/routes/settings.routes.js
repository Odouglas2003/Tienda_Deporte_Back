const { Router } = require('express')
const { getCurrentSettings, updateCurrentSettings } = require('../controllers/settings.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')

const router = Router()

router.use(authMiddleware, roleMiddleware('admin', 'superAdmin'))
router.get('/', getCurrentSettings)
router.put('/', updateCurrentSettings)

module.exports = router
