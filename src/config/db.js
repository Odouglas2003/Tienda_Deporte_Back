const mongoose = require('mongoose')
const env = require('./env')

async function connectDb() {
  if (!env.mongoUri) {
    throw new Error('Falta configurar MONGODB_URI')
  }

  await mongoose.connect(env.mongoUri)
  console.log('MongoDB Atlas conectado correctamente')
}

module.exports = { connectDb }
