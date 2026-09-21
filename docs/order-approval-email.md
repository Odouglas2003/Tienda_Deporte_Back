# Correo de aprobación de pedidos

Implementación del backend NestJS. Al pasar un pedido a `en preparacion`, la misma transacción guarda el estado, la auditoría y un único aviso por pedido. Repetir el estado o volver a preparación no genera un segundo aviso. El correo también aplica a invitados y mayoristas.

## Activación

1. Aplicar la migración con `npx prisma migrate deploy` y generar el cliente con `npm run prisma:generate`.
2. Configurar en el backend `RESEND_API_KEY` y `ORDER_EMAIL_FROM` con un remitente verificado. No poner estas variables en el frontend. Reiniciar/desplegar el backend.
3. El proceso revisa una notificación cada 30 segundos. Sin configuración quedan pendientes y el pedido se actualiza normalmente.
4. Probar con una dirección de prueba real controlada por el dueño: pendiente → en preparación, recargar, revisar recepción y comprobar que repetir la transición no duplica el email.

El detalle muestra pendiente, enviando, aceptado por el servicio o fallido. `sent` significa aceptado por Resend, no entrega confirmada en bandeja de entrada. Rebotes y entrega final se consultan en Resend; no se implementan webhooks en este cambio.

Se reintentan fallos de red, 408, 409, 429 y 5xx hasta ocho intentos con la misma clave y payload. Se detienen antes de 24 horas desde el primer intento para evitar duplicados fuera de la ventana de idempotencia. Fallos permanentes requieren revisión del operador en `OrderApprovalEmail`; no reiniciar intentos sin comprobar entrega en el proveedor. Los avisos pendientes se cancelan al rechazar/cancelar; uno ya en vuelo no puede retirarse.

No se rellenan avisos retroactivos para pedidos existentes en preparación. El pedido QA de esta revisión ya estaba en preparación antes del despliegue. Las fotos nuevas se guardan como URL al comprar; en pedidos anteriores se usa la primera foto actual del producto. Un archivo remoto eliminado se muestra como “Sin foto disponible”.

Validación local sin correos ni base real: `node scripts/test-order-approval.cjs`, `npm run prisma:validate`, `npm run prisma:generate`, `npm run build:nest`. Frontend: `npx tsc --noEmit`.

Referencia del proveedor: https://resend.com/docs/api-reference/emails/send-email y https://resend.com/docs/dashboard/emails/idempotency-keys

## Envío y entrega

La migración 20260920130000 agrega el estado enviado y una clave única por pedido y tipo de aviso. El modelo interno OrderApprovalEmail conserva su nombre por compatibilidad con la primera migración; ahora almacena approval, shipped y delivered. La API expone emailNotifications como lista en el pedido.

- En preparación: “Tu compra fue aprobada”.
- Enviado: “Tu pedido fue enviado”, con aviso de que está en camino.
- Entregado: “Tu pedido fue entregado”, con agradecimiento e indicación de contacto si el cliente no lo recibió.

Cada cambio lo realiza el operador; no se afirma seguimiento automático del transportista. Cada hito genera como máximo una notificación por pedido, incluso al volver a un estado anterior. Se muestran los tres avisos y su resultado en el detalle administrativo. No se envían avisos retroactivos al migrar. Este envío de correos se implementa en NestJS; el servidor Express legado solo conserva compatibilidad del estado enviado en modelo, validación y reportes.
