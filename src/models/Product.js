const mongoose = require('mongoose')

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, required: true, trim: true },
    categories: [{ type: String, trim: true }],
    subcategory: { type: String, default: '', trim: true },
    brand: { type: String, default: '' },
    priceRetail: { type: Number, required: true, min: 0 },
    priceWholesale: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    images: [{ type: String }],
    tags: [{ type: String, trim: true }],
    featured: { type: Boolean, default: false },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    newArrival: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Product', productSchema)
