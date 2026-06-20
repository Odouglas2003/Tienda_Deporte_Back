const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const cookieParser = require('cookie-parser')
const env = require('./config/env')
const routes = require('./routes')
const notFoundMiddleware = require('./middlewares/notFound.middleware')
const errorMiddleware = require('./middlewares/error.middleware')

const app = express()

app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
)
app.use(helmet())
app.use(morgan('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API funcionando',
    data: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  })
})

app.use('/api', routes)
app.use(notFoundMiddleware)
app.use(errorMiddleware)

module.exports = app
