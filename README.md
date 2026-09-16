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

El backend Nest consulta `GET https://api.servidos.ar/api/v1/tax/iva/rates` cuando se configura `SERVIDOS_API_KEY`. Conserva la tasa general durante 6 horas y vuelve a intentar cada 15 minutos si falla la consulta. Usa la última tasa obtenida o la tasa configurada como respaldo. Los productos con tasa estándar histórica de 21% siguen la tasa general vigente; las tasas especiales configuradas por producto permanecen fijas.

Configurá `SERVIDOS_API_KEY` únicamente en las variables de entorno del backend (por ejemplo, en Render). Nunca uses `NEXT_PUBLIC_` para esta clave. La API requiere una cuenta y clave propias: https://servidos.ar/developers
