const { body } = require('express-validator')

const loginValidator = [
  body('email').isEmail().withMessage('Email invalido'),
  body('password').isLength({ min: 6 }).withMessage('La contrasena debe tener al menos 6 caracteres'),
]

const registerValidator = [
  body('name').notEmpty().withMessage('El nombre es obligatorio'),
  body('email').isEmail().withMessage('Email invalido'),
  body('accountType')
    .isIn(['minorista', 'mayorista'])
    .withMessage('accountType debe ser minorista o mayorista'),
  body('password').custom((value, { req }) => {
    if (req.body.accountType === 'mayorista') {
      return true
    }

    if (typeof value !== 'string' || value.length < 6) {
      throw new Error('La contrasena debe tener al menos 6 caracteres')
    }

    return true
  }),
  body('businessName')
    .if(body('accountType').equals('mayorista'))
    .notEmpty()
    .withMessage('La razon social es obligatoria para mayoristas'),
  body('cuit')
    .if(body('accountType').equals('mayorista'))
    .notEmpty()
    .withMessage('El CUIT es obligatorio para mayoristas'),
]

const changeInitialPasswordValidator = [
  body('password').isLength({ min: 6 }).withMessage('La contrasena debe tener al menos 6 caracteres'),
]

module.exports = {
  loginValidator,
  registerValidator,
  changeInitialPasswordValidator,
}
