const { body } = require('express-validator')

const categoryValidator = [
  body('name').notEmpty().withMessage('El nombre es obligatorio'),
  body('description').optional().isString().withMessage('description invalido'),
  body('active').optional().isBoolean().withMessage('active invalido'),
]

module.exports = {
  categoryValidator,
}
