# Tienda_Deporte_Back

## Backend NestJS + Prisma

La migración nueva está preparada en `src-nest/` y el modelo relacional en `prisma/schema.prisma`.

Comandos:

- `npm run dev` mantiene activo el backend actual durante la migración.
- `npm run dev:nest` levanta NestJS.
- `npm run prisma:generate` genera Prisma Client.
- `npm run prisma:migrate -- --name init` crea la migración cuando `DATABASE_URL` apunta a Supabase.
- `npm run build:nest` verifica la compilación NestJS.

No se debe eliminar MongoDB hasta migrar y probar usuarios, productos, pedidos y auditoría en PostgreSQL.
# IVA automático

El backend Nest consulta `GET https://api.vatsense.com/1.0/rates?country_code=AR` cuando se configura `VATSENSE_API_KEY`. Conserva la tasa general durante 12 horas y vuelve a intentar luego de 12 horas si falla la consulta, dentro del límite gratuito de 100 consultas mensuales por instancia. Usa la última tasa obtenida o la tasa configurada como respaldo. Los productos con tasa estándar histórica de 21% siguen la tasa general vigente; las tasas especiales configuradas por producto permanecen fijas.

Configurá `VATSENSE_API_KEY` únicamente en las variables de entorno del backend (por ejemplo, en Render). Nunca uses `NEXT_PUBLIC_` para esta clave. La API requiere una cuenta y clave propias: https://vatsense.com/signup . La respuesta real debe verificarse con una clave antes de considerar activa la integración.
