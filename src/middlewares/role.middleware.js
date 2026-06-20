function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({
        success: false,
        message: 'No tenes permisos para realizar esta accion',
      })
    }

    return next()
  }
}

module.exports = roleMiddleware
