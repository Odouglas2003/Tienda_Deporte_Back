const app = require('./app')
const env = require('./config/env')
const { connectDb } = require('./config/db')

async function bootstrap() {
  try {
    await connectDb()
    app.listen(env.port, () => {
      console.log(`Servidor escuchando en http://localhost:${env.port}`)
    })
  } catch (error) {
    console.error('Error al iniciar el servidor:', error.message)
    process.exit(1)
  }
}

bootstrap()
