const { PrismaClient } = require('@prisma/client')

const categoryNames = [
  'Accesorios', 'Artes Marciales', 'Badminton', 'Basquet', 'Boxeo', 'Calzado',
  'Ciclismo', 'CrossFit', 'Fitness y Yoga', 'Futbol', 'Gimnasia Ritmica',
  'Gimnasio', 'Handball', 'Hockey', 'Indumentaria', 'Kickboxing', 'MMA',
  'Natacion', 'Padel', 'Rugby', 'Running', 'Squash', 'Tenis', 'Tenis de Mesa',
  'Tenis de mesa profesional', 'Volley', 'Waterpolo',
]

const normalize = (value) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const slug = (value) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const prisma = new PrismaClient()

async function main() {
  for (const name of categoryNames) {
    const normalizedName = normalize(name)
    await prisma.category.upsert({
      where: { normalizedName },
      update: { active: true, deletedAt: null },
      create: {
        name,
        normalizedName,
        slug: slug(name),
        description: 'Categoría disponible para productos y navegación de la tienda.',
        active: true,
      },
    })
  }

  console.log(`${categoryNames.length} categorías configuradas.`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
