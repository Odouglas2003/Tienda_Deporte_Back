const { validationResult } = require('express-validator')

function validateMiddleware(req, res, next) {
  const errors = validationResult(req)

  if (errors.isEmpty()) {
    return next()
  }

  return res.status(422).json({
    success: false,
    message: 'Error de validacion',
    details: errors.array(),
  })
}

module.exports = validateMiddleware
