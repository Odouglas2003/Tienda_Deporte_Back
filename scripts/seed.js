const dotenv = require('dotenv')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')

const User = require('../src/models/User')
const Product = require('../src/models/Product')
const Order = require('../src/models/Order')
const Settings = require('../src/models/Settings')
const ActivityLog = require('../src/models/ActivityLog')

dotenv.config()

const shouldReset = process.argv.includes('--reset')

const passwords = {
  admin: 'Admin123!',
  seller: '123456',
  client: '123456',
  wholesaler: '123456',
}

const productSeeds = [
  {
    name: 'Remera Running Pro',
    sku: 'NEZ-IND-001',
    description: 'Remera tecnica liviana para running y entrenamiento diario.',
    category: 'indumentaria',
    subcategory: 'running',
    brand: 'Nike',
    priceRetail: 45000,
    priceWholesale: 32000,
    tax: 21,
    stock: 25,
    images: ['/images/products/remera-running.jpg'],
    tags: ['running', 'entrenamiento'],
    featured: true,
    newArrival: false,
    active: true,
  },
  {
    name: 'Short Training Elite',
    sku: 'NEZ-IND-002',
    description: 'Short deportivo con tela respirable y cintura elastica.',
    category: 'indumentaria',
    subcategory: 'fitness-y-yoga',
    brand: 'Adidas',
    priceRetail: 38000,
    priceWholesale: 27000,
    tax: 21,
    stock: 42,
    images: ['/images/products/short-training.jpg'],
    tags: ['fitness-y-yoga', 'entrenamiento'],
    featured: true,
    newArrival: false,
    active: true,
  },
  {
    name: 'Campera Rompevientos',
    sku: 'NEZ-IND-003',
    description: 'Campera liviana resistente al viento y a lloviznas.',
    category: 'indumentaria',
    subcategory: 'running',
    brand: 'Puma',
    priceRetail: 89000,
    priceWholesale: 63000,
    tax: 21,
    stock: 12,
    images: ['/images/products/campera-rompevientos.jpg'],
    tags: ['running', 'ciclismo'],
    featured: true,
    newArrival: false,
    active: true,
  },
  {
    name: 'Mochila Deportiva Pro',
    sku: 'NEZ-ACC-001',
    description: 'Mochila amplia con compartimentos para calzado y notebook.',
    category: 'accesorios',
    subcategory: 'gimnasio',
    brand: 'Adidas',
    priceRetail: 65000,
    priceWholesale: 46000,
    tax: 21,
    stock: 18,
    images: ['/images/products/mochila-deportiva.jpg'],
    tags: ['gimnasio', 'fitness-y-yoga'],
    featured: true,
    newArrival: false,
    active: true,
  },
  {
    name: 'Bolso Gym Duffle',
    sku: 'NEZ-ACC-002',
    description: 'Bolso resistente para entrenamiento y uso diario.',
    category: 'accesorios',
    subcategory: 'gimnasio',
    brand: 'Puma',
    priceRetail: 55000,
    priceWholesale: 39000,
    tax: 21,
    stock: 30,
    images: ['/images/products/bolso-gym.jpg'],
    tags: ['gimnasio', 'crossfit'],
    newArrival: false,
    active: true,
  },
  {
    name: 'Pack Medias Performance x3',
    sku: 'NEZ-ACC-003',
    description: 'Pack de medias tecnicas con refuerzo en talon y puntera.',
    category: 'accesorios',
    subcategory: 'running',
    brand: 'Under Armour',
    priceRetail: 22000,
    priceWholesale: 15500,
    tax: 21,
    stock: 60,
    images: ['/images/products/medias-pack.jpg'],
    tags: ['running', 'fitness-y-yoga'],
    newArrival: false,
    active: true,
  },
  {
    name: 'Zapatillas Running Ultra',
    sku: 'NEZ-CAL-001',
    description: 'Zapatillas de running con amortiguacion y suela de alto agarre.',
    category: 'calzado',
    subcategory: 'running',
    brand: 'Asics',
    priceRetail: 185000,
    priceWholesale: 130000,
    tax: 21,
    stock: 15,
    images: ['/images/products/zapatillas-running.jpg'],
    tags: ['running'],
    featured: true,
    newArrival: false,
    active: true,
  },
  {
    name: 'Zapatillas Training Max',
    sku: 'NEZ-CAL-002',
    description: 'Modelo versatil para entrenamiento funcional y gimnasio.',
    category: 'calzado',
    subcategory: 'crossfit',
    brand: 'Nike',
    priceRetail: 165000,
    priceWholesale: 116000,
    tax: 21,
    stock: 9,
    images: ['/images/products/zapatillas-training.jpg'],
    tags: ['crossfit', 'gimnasio', 'fitness-y-yoga'],
    featured: true,
    newArrival: false,
    active: true,
  },
  {
    name: 'Botines Futbol Pro',
    sku: 'NEZ-CAL-003',
    description: 'Botines para cesped natural con gran traccion y control.',
    category: 'calzado',
    subcategory: 'futbol',
    brand: 'Adidas',
    priceRetail: 145000,
    priceWholesale: 102000,
    tax: 21,
    stock: 8,
    images: ['/images/products/botines-futbol.jpg'],
    tags: ['futbol'],
    featured: true,
    newArrival: false,
    active: true,
  },
]

function createOrderItems(products, useWholesalePrice = false, quantityOffset = 1) {
  return products.map((product, index) => {
    const quantity = quantityOffset + index
    const unitPrice = useWholesalePrice ? product.priceWholesale : product.priceRetail

    return {
      product: product._id,
      productName: product.name,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
    }
  })
}

async function upsertUser(seed) {
  const password = await bcrypt.hash(seed.password, 10)
  const payload = {
    name: seed.name,
    email: seed.email.toLowerCase(),
    password,
    role: seed.role,
    accountType: seed.accountType,
    approved: seed.approved,
    approvalStatus: seed.approvalStatus,
    assignedSeller: seed.assignedSeller || null,
    mustChangePassword: seed.mustChangePassword || false,
    active: seed.active !== false,
    phone: seed.phone || '',
    cuit: seed.cuit || '',
    businessName: seed.businessName || '',
    deletedAt: null,
  }

  return User.findOneAndUpdate(
    { email: seed.email.toLowerCase() },
    payload,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
}

async function upsertProduct(seed) {
  return Product.findOneAndUpdate(
    { sku: seed.sku },
    {
      $set: { ...seed, deletedAt: null },
      $unset: { isNew: '' },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
}

async function seedSettings() {
  await Settings.findOneAndUpdate(
    {},
    {
      minWholesaleOrder: 150000,
      taxPercentage: 21,
      paymentMethods: ['transferencia', 'efectivo', 'cheque electronico'],
      whatsappNumber: '5491112345678',
      automaticMessages: {
        wholesaleApproved: 'Tu cuenta mayorista fue aprobada. Ya podes ingresar al catalogo.',
        orderCreated: 'Recibimos tu pedido y lo estamos revisando.',
        sellerAssigned: 'Te asignamos un vendedor para acompanarte en tus compras.',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
}

async function seedOrdersAndLogs(users, products) {
  if (shouldReset) {
    await Promise.all([Order.deleteMany({}), ActivityLog.deleteMany({})])
  } else {
    const existingOrders = await Order.countDocuments()
    const existingLogs = await ActivityLog.countDocuments()

    if (existingOrders > 0) {
      return {
        skipped: true,
        orders: existingOrders,
        logs: existingLogs,
      }
    }
  }

  const clientItems = createOrderItems(products.slice(0, 2), false, 1)
  const wholesalerItems = createOrderItems(products.slice(2, 5), true, 2)
  const pendingItems = createOrderItems(products.slice(5, 7), true, 1)

  const orders = await Order.insertMany([
    {
      user: users.client._id,
      seller: null,
      paymentMethod: 'transferencia',
      status: 'entregado',
      total: clientItems.reduce((sum, item) => sum + item.subtotal, 0),
      items: clientItems,
    },
    {
      user: users.wholesalerApproved._id,
      seller: users.seller._id,
      paymentMethod: 'cheque electronico',
      status: 'en preparacion',
      total: wholesalerItems.reduce((sum, item) => sum + item.subtotal, 0),
      items: wholesalerItems,
    },
    {
      user: users.wholesalerPending._id,
      seller: users.seller._id,
      paymentMethod: 'transferencia',
      status: 'en revision',
      total: pendingItems.reduce((sum, item) => sum + item.subtotal, 0),
      items: pendingItems,
    },
  ])

  const logs = await ActivityLog.insertMany([
    {
      user: users.admin._id,
      action: 'Seed inicial ejecutado',
      entity: 'system',
      metadata: { reset: shouldReset },
    },
    {
      user: users.admin._id,
      action: 'Aprobacion de mayorista',
      entity: 'user',
      metadata: { userId: users.wholesalerApproved._id.toString(), sellerId: users.seller._id.toString() },
    },
    {
      user: users.client._id,
      action: 'Creacion de pedido',
      entity: 'order',
      metadata: { orderId: orders[0]._id.toString() },
    },
    {
      user: users.wholesalerApproved._id,
      action: 'Creacion de pedido',
      entity: 'order',
      metadata: { orderId: orders[1]._id.toString() },
    },
    {
      user: users.seller._id,
      action: 'Cambio de estado de pedido',
      entity: 'order',
      metadata: { orderId: orders[1]._id.toString(), status: 'en preparacion' },
    },
  ])

  return {
    skipped: false,
    orders: orders.length,
    logs: logs.length,
  }
}

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error('Falta configurar MONGODB_URI en el archivo .env')
  }

  await mongoose.connect(process.env.MONGODB_URI)

  const summary = {
    reset: shouldReset,
    users: 0,
    products: 0,
    orders: 0,
    logs: 0,
  }

  if (shouldReset) {
    await Promise.all([
      Order.deleteMany({}),
      ActivityLog.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
      Settings.deleteMany({}),
    ])
  }

  const seller = await upsertUser({
    name: 'Carla Soto',
    email: 'vendedor@nezha.com',
    password: passwords.seller,
    role: 'vendedor',
    accountType: 'minorista',
    approved: true,
    approvalStatus: 'approved',
    phone: '+54 11 5555 5555',
  })

  const admin = await upsertUser({
    name: 'Admin Principal',
    email: 'admin@nezha.com',
    password: passwords.admin,
    role: 'admin',
    accountType: 'minorista',
    approved: true,
    approvalStatus: 'approved',
    phone: '+54 11 0000 0000',
  })

  const superAdmin = await upsertUser({
    name: 'Super Admin',
    email: 'superadmin@nezha.com',
    password: passwords.admin,
    role: 'superAdmin',
    accountType: 'minorista',
    approved: true,
    approvalStatus: 'approved',
    phone: '+54 11 9999 9999',
  })

  const client = await upsertUser({
    name: 'Juan Perez',
    email: 'cliente@nezha.com',
    password: passwords.client,
    role: 'cliente',
    accountType: 'minorista',
    approved: true,
    approvalStatus: 'approved',
    phone: '+54 11 1111 1111',
  })

  const wholesalerApproved = await upsertUser({
    name: 'Distribuidora Norte',
    email: 'mayorista@nezha.com',
    password: passwords.wholesaler,
    role: 'cliente',
    accountType: 'mayorista',
    approved: true,
    approvalStatus: 'approved',
    assignedSeller: seller._id,
    mustChangePassword: true,
    phone: '+54 11 2222 2222',
    businessName: 'Distribuidora Norte SRL',
    cuit: '30-71234567-9',
  })

  const wholesalerPending = await upsertUser({
    name: 'Casa del Deporte',
    email: 'pendiente@nezha.com',
    password: passwords.wholesaler,
    role: 'cliente',
    accountType: 'mayorista',
    approved: false,
    approvalStatus: 'pending',
    assignedSeller: seller._id,
    phone: '+54 11 3333 3333',
    businessName: 'Casa del Deporte',
    cuit: '30-73456789-1',
  })

  summary.users = 6

  const products = []
  for (const seed of productSeeds) {
    products.push(await upsertProduct(seed))
  }
  summary.products = products.length

  await seedSettings()

  const orderAndLogResult = await seedOrdersAndLogs(
    {
      admin,
      seller,
      client,
      wholesalerApproved,
      wholesalerPending,
    },
    products
  )

  summary.orders = orderAndLogResult.orders
  summary.logs = orderAndLogResult.logs

  console.log('')
  console.log('Seed completado')
  console.log(JSON.stringify(summary, null, 2))
  console.log('')
  console.log('Credenciales de prueba')
  console.log(`- Admin: admin@nezha.com / ${passwords.admin}`)
  console.log(`- Super Admin: superadmin@nezha.com / ${passwords.admin}`)
  console.log(`- Vendedor: vendedor@nezha.com / ${passwords.seller}`)
  console.log(`- Cliente: cliente@nezha.com / ${passwords.client}`)
  console.log(`- Mayorista aprobado: mayorista@nezha.com / ${passwords.wholesaler}`)
  console.log(`- Mayorista pendiente: pendiente@nezha.com / ${passwords.wholesaler}`)
  console.log('')

  if (!shouldReset && orderAndLogResult.skipped) {
    console.log('Pedidos y logs existentes detectados: no se recrearon en modo seguro.')
    console.log('Usa `npm run seed:reset` si queres regenerar todo desde cero.')
  }
}

run()
  .catch((error) => {
    console.error('Error al ejecutar seed:')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {})
  })
