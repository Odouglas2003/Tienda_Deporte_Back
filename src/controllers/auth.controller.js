const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { loginUser, registerUser, changeInitialPassword } = require('../services/auth.service')
const { serializeUser } = require('../utils/serializeUser')

const register = asyncHandler(async (req, res) => {
  const result = await registerUser(req.body)

  res.status(201).json(
    new ApiResponse({
      message: result.token ? 'Usuario registrado correctamente' : 'Solicitud mayorista registrada',
      data: {
        ...result,
        user: serializeUser(result.user),
      },
    })
  )
})

const login = asyncHandler(async (req, res) => {
  const result = await loginUser(req.body)

  res.json(
    new ApiResponse({
      message: 'Sesion iniciada correctamente',
      data: {
        ...result,
        user: serializeUser(result.user),
      },
    })
  )
})

const updateInitialPassword = asyncHandler(async (req, res) => {
  const result = await changeInitialPassword({
    userId: req.auth.sub,
    password: req.body.password,
  })

  res.json(
    new ApiResponse({
      message: 'Contrasena actualizada correctamente',
      data: {
        ...result,
        user: serializeUser(result.user),
      },
    })
  )
})

module.exports = {
  register,
  login,
  updateInitialPassword,
}
