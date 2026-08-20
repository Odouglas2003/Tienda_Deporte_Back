const { Router } = require('express')
const { body } = require('express-validator')
const ContactMessage = require('../models/ContactMessage')
const NewsletterSubscriber = require('../models/NewsletterSubscriber')
const validateMiddleware = require('../middlewares/validate.middleware')
const asyncHandler = require('../utils/asyncHandler')
const ApiResponse = require('../utils/ApiResponse')
const ApiError = require('../utils/ApiError')

const router = Router()

router.post(
  '/contact',
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('El nombre es obligatorio'),
    body('email').isEmail().withMessage('El email no es valido').normalizeEmail(),
    body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 40 }),
    body('subject').trim().isLength({ min: 2, max: 60 }).withMessage('El asunto es obligatorio'),
    body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('El mensaje debe tener entre 10 y 2000 caracteres'),
  ],
  validateMiddleware,
  asyncHandler(async (req, res) => {
    await ContactMessage.create(req.body)
    res.status(201).json(new ApiResponse({ message: 'Mensaje recibido correctamente' }))
  })
)

router.post(
  '/newsletter',
  [body('email').isEmail().withMessage('El email no es valido').normalizeEmail()],
  validateMiddleware,
  asyncHandler(async (req, res) => {
    const subscriber = await NewsletterSubscriber.findOneAndUpdate(
      { email: req.body.email },
      { email: req.body.email, active: true, subscribedAt: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )

    if (!subscriber) {
      throw new ApiError(500, 'No se pudo registrar la suscripcion')
    }

    res.status(201).json(new ApiResponse({ message: 'Suscripcion registrada correctamente' }))
  })
)

module.exports = router
