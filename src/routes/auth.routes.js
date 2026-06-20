const { Router } = require('express')
const { login, register, updateInitialPassword } = require('../controllers/auth.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const validateMiddleware = require('../middlewares/validate.middleware')
const { loginValidator, registerValidator, changeInitialPasswordValidator } = require('../validators/auth.validators')

const router = Router()

router.post('/register', registerValidator, validateMiddleware, register)
router.post('/login', loginValidator, validateMiddleware, login)
router.post('/change-initial-password', authMiddleware, changeInitialPasswordValidator, validateMiddleware, updateInitialPassword)

module.exports = router
