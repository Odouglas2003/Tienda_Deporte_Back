module.exports = function notFoundMiddleware(req, res) {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.originalUrl}`,
  })
}
