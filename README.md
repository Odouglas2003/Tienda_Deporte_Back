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
