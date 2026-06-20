const jwt = require('jsonwebtoken')
const env = require('../config/env')

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No autorizado',
    })
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    req.auth = payload
    return next()
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token invalido o vencido',
    })
  }
}

module.exports = authMiddleware
