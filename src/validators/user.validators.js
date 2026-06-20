const { body } = require('express-validator')

const approveWholesaleValidator = [
  body('sellerId').optional().isMongoId().withMessage('sellerId invalido'),
  body('temporaryPassword')
    .isLength({ min: 6 })
    .withMessage('La contrasena temporal debe tener al menos 6 caracteres'),
]

const createSellerValidator = [
  body('name').notEmpty().withMessage('El nombre es obligatorio'),
  body('email').isEmail().withMessage('Email invalido'),
  body('phone').optional().isString().withMessage('Telefono invalido'),
]

module.exports = {
  approveWholesaleValidator,
  createSellerValidator,
}
