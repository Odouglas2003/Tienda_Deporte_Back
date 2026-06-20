const ApiResponse = require('../utils/ApiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { serializeUser, serializeUsers } = require('../utils/serializeUser')
const {
  listUsers,
  createSeller,
  getPendingWholesalers,
  approveWholesale,
  rejectWholesale,
} = require('../services/users.service')

const getUsers = asyncHandler(async (req, res) => {
  const users = await listUsers(req.query)
  res.json(new ApiResponse({ data: serializeUsers(users) }))
})

const getPendingUsers = asyncHandler(async (req, res) => {
  const users = await getPendingWholesalers()
  res.json(new ApiResponse({ data: serializeUsers(users) }))
})

const createSellerUser = asyncHandler(async (req, res) => {
  const result = await createSeller({
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    actorId: req.auth.sub,
  })

  res.status(201).json(
    new ApiResponse({
      message: 'Vendedor creado correctamente',
      data: {
        user: serializeUser(result.user),
        temporaryPassword: result.temporaryPassword,
      },
    })
  )
})

const approveUser = asyncHandler(async (req, res) => {
  const user = await approveWholesale({
    userId: req.params.userId,
    sellerId: req.body.sellerId,
    temporaryPassword: req.body.temporaryPassword,
    actorId: req.auth.sub,
  })

  res.json(new ApiResponse({ message: 'Mayorista aprobado correctamente', data: serializeUser(user) }))
})

const rejectUser = asyncHandler(async (req, res) => {
  const user = await rejectWholesale({
    userId: req.params.userId,
    actorId: req.auth.sub,
  })

  res.json(new ApiResponse({ message: 'Mayorista rechazado', data: serializeUser(user) }))
})

module.exports = {
  getUsers,
  getPendingUsers,
  createSellerUser,
  approveUser,
  rejectUser,
}
