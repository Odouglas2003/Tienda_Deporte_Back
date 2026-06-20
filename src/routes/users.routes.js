const { Router } = require('express')
const { getUsers, getPendingUsers, createSellerUser, approveUser, rejectUser } = require('../controllers/users.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const roleMiddleware = require('../middlewares/role.middleware')
const validateMiddleware = require('../middlewares/validate.middleware')
const { approveWholesaleValidator, createSellerValidator } = require('../validators/user.validators')

const router = Router()

router.use(authMiddleware, roleMiddleware('admin', 'superAdmin'))
router.get('/', getUsers)
router.get('/pending-wholesalers', getPendingUsers)
router.post('/sellers', createSellerValidator, validateMiddleware, createSellerUser)
router.patch('/:userId/approve', approveWholesaleValidator, validateMiddleware, approveUser)
router.patch('/:userId/reject', rejectUser)

module.exports = router
