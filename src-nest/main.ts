import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { json } from 'express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.use(json({ limit: '25mb' }))
  app.setGlobalPrefix('api')
  const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const trustedOrigins = new Set([
    ...configuredOrigins,
    'https://tienda-deporte-front.vercel.app',
    'https://nezha.com.ar',
    'https://www.nezha.com.ar',
  ])
  const vercelPreviewOrigin = /^https:\/\/tienda-deporte-front-(?:git-main|[a-z0-9]+)-odouglas2003s-projects\.vercel\.app$/

  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || trustedOrigins.has(origin) || vercelPreviewOrigin.test(origin)) {
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
