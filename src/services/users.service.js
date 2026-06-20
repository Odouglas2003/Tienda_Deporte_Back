const User = require('../models/User')
const bcrypt = require('bcryptjs')
const ApiError = require('../utils/ApiError')
const { createLog } = require('./activityLogs.service')

async function listUsers(filters = {}) {
  const query = { deletedAt: null }

  if (filters.role) {
    query.role = filters.role
  }

  if (filters.accountType) {
    query.accountType = filters.accountType
  }

  if (filters.approvalStatus) {
    query.approvalStatus = filters.approvalStatus
  }

  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ]
  }

  return User.find(query).populate('assignedSeller', 'name email')
}

async function createSeller({ name, email, phone, actorId }) {
  const normalizedEmail = email.toLowerCase().trim()
  const existingUser = await User.findOne({ email: normalizedEmail, deletedAt: null })

  if (existingUser) {
    throw new ApiError(409, 'El email ya se encuentra registrado')
  }

  const temporaryPassword = name.trim()

  if (temporaryPassword.length < 6) {
    throw new ApiError(400, 'El nombre completo debe tener al menos 6 caracteres para usarse como contrasena inicial')
  }

  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password: await bcrypt.hash(temporaryPassword, 10),
    role: 'vendedor',
    accountType: 'minorista',
    approved: true,
    approvalStatus: 'approved',
    active: true,
    mustChangePassword: true,
    phone: phone?.trim?.() || '',
  })

  await createLog({
    user: actorId || null,
    action: 'Alta de vendedor',
    entity: 'user',
    metadata: { userId: user._id.toString(), email: normalizedEmail },
  })

  return { user, temporaryPassword }
}

async function getPendingWholesalers() {
  return User.find({
    deletedAt: null,
    accountType: 'mayorista',
    approvalStatus: 'pending',
  }).populate('assignedSeller', 'name email')
}

async function approveWholesale({ userId, sellerId, temporaryPassword, actorId }) {
  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado')
  }

  if (user.accountType !== 'mayorista') {
    throw new ApiError(400, 'Solo se pueden aprobar cuentas mayoristas')
  }

  user.approved = true
  user.approvalStatus = 'approved'
  user.assignedSeller = sellerId || null
  user.password = await bcrypt.hash(temporaryPassword, 10)
  user.mustChangePassword = true
  await user.save()

  await createLog({
    user: actorId || null,
    action: 'Aprobacion de mayorista',
    entity: 'user',
    metadata: { userId, sellerId: sellerId || '', temporaryPasswordAssigned: 'true' },
  })

  return user
}

async function rejectWholesale({ userId, actorId }) {
  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado')
  }

  user.approved = false
  user.approvalStatus = 'rejected'
  await user.save()

  await createLog({
    user: actorId || null,
    action: 'Rechazo de mayorista',
    entity: 'user',
    metadata: { userId },
  })

  return user
}

module.exports = {
  listUsers,
  createSeller,
  getPendingWholesalers,
  approveWholesale,
  rejectWholesale,
}
