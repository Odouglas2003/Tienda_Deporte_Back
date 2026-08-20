import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const vercelPreviewOrigin = /^https:\/\/tienda-deporte-front-[a-z0-9]+-odouglas2003s-projects\.vercel\.app$/

  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || configuredOrigins.includes(origin) || vercelPreviewOrigin.test(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('Origen no permitido por CORS'))
    },
    credentials: true,
  })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(Number(process.env.PORT || 3900))
}

bootstrap()
