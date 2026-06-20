const bcrypt = require('bcryptjs')
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const env = require('../config/env')
const ApiError = require('../utils/ApiError')
const { createLog } = require('./activityLogs.service')

function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  )
}

async function registerUser(payload) {
  const existingUser = await User.findOne({ email: payload.email.toLowerCase(), deletedAt: null })
  if (existingUser) {
    throw new ApiError(409, 'El email ya se encuentra registrado')
  }

  const isWholesale = payload.accountType === 'mayorista'
  const rawPassword = isWholesale ? crypto.randomBytes(16).toString('hex') : payload.password
  const password = await bcrypt.hash(rawPassword, 10)

  const user = await User.create({
    ...payload,
    email: payload.email.toLowerCase(),
    password,
    approved: !isWholesale,
    approvalStatus: isWholesale ? 'pending' : 'approved',
    role: 'cliente',
  })

  await createLog({
    user: user._id,
    action: 'Registro de usuario',
    entity: 'user',
    metadata: { accountType: user.accountType },
  })

  if (isWholesale) {
    return { user, token: null }
  }

  return { user, token: signToken(user) }
}

async function loginUser({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase(), deletedAt: null })
  if (!user) {
    throw new ApiError(401, 'Credenciales invalidas')
  }

  const isValid = await bcrypt.compare(password, user.password)
  if (!isValid) {
    throw new ApiError(401, 'Credenciales invalidas')
  }

  if (!user.active) {
    throw new ApiError(403, 'La cuenta se encuentra inactiva')
  }

  if (user.accountType === 'mayorista' && !user.approved) {
    throw new ApiError(403, 'La cuenta mayorista aun no fue aprobada')
  }

  await createLog({
    user: user._id,
    action: 'Login',
    entity: 'auth',
  })

  return { user, token: signToken(user) }
}

async function changeInitialPassword({ userId, password }) {
  const user = await User.findOne({ _id: userId, deletedAt: null })

  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado')
  }

  if (!user.mustChangePassword) {
    throw new ApiError(400, 'La cuenta no requiere cambio inicial de contrasena')
  }

  user.password = await bcrypt.hash(password, 10)
  user.mustChangePassword = false
  await user.save()

  await createLog({
    user: user._id,
    action: 'Cambio inicial de contrasena',
    entity: 'auth',
  })

  return { user, token: signToken(user) }
}

module.exports = {
  registerUser,
  loginUser,
  changeInitialPassword,
}
