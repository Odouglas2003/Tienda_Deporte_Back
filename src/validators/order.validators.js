const { body } = require('express-validator')

const createOrderValidator = [
  body('paymentMethod').notEmpty().withMessage('El medio de pago es obligatorio'),
  body('items').isArray({ min: 1 }).withMessage('Debes enviar al menos un item'),
]

const updateOrderStatusValidator = [
  body('status')
    .isIn(['pendiente', 'en revision', 'aprobado', 'rechazado', 'en preparacion', 'entregado', 'cancelado'])
    .withMessage('Estado de pedido invalido'),
]

module.exports = {
  createOrderValidator,
  updateOrderStatusValidator,
}
