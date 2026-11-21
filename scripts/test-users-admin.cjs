// Aprobación de mayoristas con enlace para crear clave, ficha de cliente y eliminación de cuentas.
const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
delete process.env.RESEND_API_KEY
const { UsersService } = require('../src-nest/users/users.service')

function fixture() {
  const users = [
    { id: 'w1', name: 'Club Norte', email: 'club@example.com', role: 'cliente', accountType: 'mayorista', approved: false, approvalStatus: 'pending', active: true, deletedAt: null, password: 'old', phone: '3511234567', assignedSellerId: null },
    { id: 'c1', name: 'Ana Gómez', email: 'ana@example.com', role: 'cliente', accountType: 'minorista', approved: true, approvalStatus: 'approved', active: true, deletedAt: null, password: 'x', phone: '', assignedSellerId: 's1' },
    { id: 's1', name: 'Lucía Vendedora', email: 'lucia@example.com', role: 'vendedor', accountType: 'minorista', approved: true, approvalStatus: 'approved', active: true, deletedAt: null, password: 'x', phone: '', assignedSellerId: null },
    { id: 'a1', name: 'Admin', email: 'admin@example.com', role: 'admin', accountType: 'minorista', approved: true, approvalStatus: 'approved', active: true, deletedAt: null, password: 'x', phone: '', assignedSellerId: null },
  ]
  const tokens = []
  const prisma = {
    user: {
      findUnique: async ({ where }) => users.find((user) => user.id === where.id) ?? null,
      update: async ({ where, data }) => Object.assign(users.find((user) => user.id === where.id), data),
      updateMany: async ({ where, data }) => { users.filter((user) => user.assignedSellerId === where.assignedSellerId).forEach((user) => Object.assign(user, data)); return { count: 1 } },
    },
    passwordResetToken: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => { tokens.push(data); return data },
      deleteMany: async () => ({ count: 0 }),
    },
    order: { findMany: async () => [{ id: 'o1', code: 'PED-1', status: 'entregado', total: 24200, createdAt: new Date('2026-11-01'), paymentMethod: 'cash', shipping: { method: 'delivery', address: 'Calle 1', city: 'Córdoba', phone: '351 999 8888' } }] },
    activityLog: { create: async () => ({}) },
  }
  prisma.$transaction = async (arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))
  return { service: new UsersService(prisma), users, tokens }
}

async function main() {
  let f = fixture()
  // Sin servicio de correo configurado, la aprobación devuelve el enlace para mandarlo por WhatsApp.
  const approved = await f.service.approve('w1', 's1', 'a1')
  assert.equal(approved.user.approvalStatus, 'approved')
  assert.equal(approved.emailSent, false)
  assert.match(approved.setupLink, /\/recuperar-password\?token=[a-f0-9]{64}&bienvenida=1$/)
  assert.equal(f.tokens.length, 1)
  assert.ok(f.tokens[0].expiresAt > new Date(Date.now() + 6 * 24 * 60 * 60000), 'el enlace dura 7 días')
  assert.notEqual(f.users[0].password, 'old', 'la clave anterior deja de servir')
  assert.equal(approved.user.password, undefined, 'nunca se devuelve la clave')
  await assert.rejects(() => f.service.approve('w1', 'c1', 'a1'), /vendedor elegido/)

  // Ficha completa con teléfonos y direcciones de sus pedidos.
  const details = await f.service.details('c1')
  assert.deepEqual(details.phones, ['351 999 8888'])
  assert.deepEqual(details.addresses, ['Calle 1, Córdoba'])
  assert.equal(details.stats.spent, 24200)

  // Eliminar: no se puede uno mismo ni un admin; un vendedor libera a sus clientes.
  await assert.rejects(() => f.service.remove('a1', 'a1'), /tu propia cuenta/)
  await assert.rejects(() => f.service.remove('a1', 'x'), /administrador/)
  f = fixture()
  await f.service.remove('s1', 'a1')
  const seller = f.users.find((user) => user.id === 's1')
  assert.ok(seller.deletedAt)
  assert.equal(seller.active, false)
  assert.equal(seller.email, 'eliminado-s1@nezha.invalid')
  assert.equal(f.users.find((user) => user.id === 'c1').assignedSellerId, null)
  await assert.rejects(() => f.service.details('s1'), /no encontrado/i)

  console.log('usuarios admin ok')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
