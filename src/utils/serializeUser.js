function serializeUser(userDocument) {
  if (!userDocument) {
    return null
  }

  const user =
    typeof userDocument.toObject === 'function'
      ? userDocument.toObject({ virtuals: true })
      : userDocument

  const assignedSeller =
    user.assignedSeller && typeof user.assignedSeller === 'object' && !Array.isArray(user.assignedSeller)
      ? user.assignedSeller
      : null

  return {
    id: user._id?.toString?.() ?? user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountType: user.accountType,
    approvalStatus: user.approvalStatus,
    approved: Boolean(user.approved),
    active: Boolean(user.active),
    mustChangePassword: Boolean(user.mustChangePassword),
    phone: user.phone || '',
    businessName: user.businessName || '',
    cuit: user.cuit || '',
    assignedSellerId:
      assignedSeller?._id?.toString?.() ??
      (typeof user.assignedSeller === 'string' ? user.assignedSeller : undefined),
    assignedSellerName: assignedSeller?.name || undefined,
    createdAt:
      user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt || new Date().toISOString(),
  }
}

function serializeUsers(users = []) {
  return users.map((user) => serializeUser(user))
}

module.exports = {
  serializeUser,
  serializeUsers,
}
