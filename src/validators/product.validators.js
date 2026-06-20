const { body } = require('express-validator')

const productValidator = [
  body('name').notEmpty().withMessage('El nombre es obligatorio'),
  body('sku').notEmpty().withMessage('El SKU es obligatorio'),
  body('category')
    .custom((value, { req }) => {
      const categories = Array.isArray(req.body?.categories) ? req.body.categories.filter(Boolean) : []
      return Boolean(String(value || '').trim() || categories.length > 0)
    })
    .withMessage('La categoria es obligatoria'),
  body('categories').optional().isArray().withMessage('categories invalido'),
  body('subcategory').optional().isString().withMessage('subcategory invalido'),
  body('priceRetail').isFloat({ min: 0 }).withMessage('priceRetail invalido'),
  body('priceWholesale').isFloat({ min: 0 }).withMessage('priceWholesale invalido'),
  body('discount').optional().isFloat({ min: 0, max: 100 }).withMessage('discount invalido'),
  body('tags').optional().isArray().withMessage('tags invalido'),
  body('featured').optional().isBoolean().withMessage('featured invalido'),
  body('newArrival').optional().isBoolean().withMessage('newArrival invalido'),
]

module.exports = {
  productValidator,
}
