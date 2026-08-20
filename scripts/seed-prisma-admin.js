const { PrismaClient, UserRole, AccountType, ApprovalStatus } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD || ''

if (!email || !password || password.length < 8) {
  throw new Error('Definí ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres).')
}

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: UserRole.admin,
      approved: true,
      approvalStatus: ApprovalStatus.approved,
      active: true,
      mustChangePassword: false,
      password: await bcrypt.hash(password, 12),
    },
    create: {
      name: 'Administrador principal',
      email,
      password: await bcrypt.hash(password, 12),
      role: UserRole.admin,
      accountType: AccountType.minorista,
      approved: true,
      approvalStatus: ApprovalStatus.approved,
      active: true,
    },
  })

  console.log(`Administrador configurado: ${user.email}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
