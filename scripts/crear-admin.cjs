// Crea un usuario administrador nuevo en la base de la tienda.
// Pide nombre y email, genera una clave temporal y la muestra solo en esta pantalla.
// En su primer ingreso, la persona tiene que cambiar esa clave por una propia.
// Uso: node scripts/crear-admin.cjs   (desde la carpeta tienda_back)
require('dotenv').config()
const readline = require('readline/promises')
const { randomInt } = require('crypto')
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const name = (await rl.question('Nombre y apellido del administrador: ')).trim()
  const email = (await rl.question('Email con el que va a entrar: ')).trim().toLowerCase()
  rl.close()

  if (name.length < 3) throw new Error('El nombre es muy corto.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El email no es válido.')
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new Error('Ya existe un usuario con ese email. No se cambió nada.')
  }

  const temporaryPassword = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('')
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash(temporaryPassword, 10),
      role: 'admin',
      accountType: 'minorista',
      approved: true,
      approvalStatus: 'approved',
      active: true,
      mustChangePassword: true,
    },
  })

  console.log('\nAdministrador creado.')
  console.log(`  Email:          ${user.email}`)
  console.log(`  Clave temporal: ${temporaryPassword}`)
  console.log('\nPasale estos datos al cliente. Al entrar por primera vez en /login le va a pedir una clave nueva.')
}

main()
  .catch((error) => { console.error(`\nNo se pudo crear: ${error.message}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
