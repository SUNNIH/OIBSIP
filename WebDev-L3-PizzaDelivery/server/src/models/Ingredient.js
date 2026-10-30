import mongoose from 'mongoose';

const ingredientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  category: {
    type: String,
    enum: ['base', 'sauce', 'cheese', 'vegetable'],
    required: true,
    index: true,
  },
  pricePaise: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Price must be an integer (paise)',
    },
  },
  stock: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Stock must be an integer',
    },
  },
  reserved: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Reserved must be an integer',
    },
  },
  lowStockThreshold: {
    type: Number,
    required: true,
    min: 0,
    default: 10,
    validate: {
      validator: Number.isInteger,
      message: 'Low stock threshold must be an integer',
    },
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for category + active status queries
ingredientSchema.index({ category: 1, isActive: 1 });

// Validation: reserved cannot exceed stock
ingredientSchema.pre('save', async function() {
  if (this.reserved > this.stock) {
    throw new Error('Reserved quantity cannot exceed stock');
  }

  this.updatedAt = new Date();
});

// Virtual field: compute if ingredient is low on stock
ingredientSchema.virtual('isLowStock').get(function() {
  return (this.stock - this.reserved) <= this.lowStockThreshold;
});

// Virtual field: available quantity (stock - reserved)
ingredientSchema.virtual('available').get(function() {
  return this.stock - this.reserved;
});

// Ensure virtuals are included in JSON/Object output
ingredientSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    // Don't expose internal fields to customers
    delete ret.__v;
    return ret;
  },
});

ingredientSchema.set('toObject', { virtuals: true });

// Static method: check availability for multiple ingredients
ingredientSchema.statics.checkAvailability = async function(ingredientQuantities) {
  const ingredientIds = Object.keys(ingredientQuantities);
  const ingredients = await this.find({ _id: { $in: ingredientIds } });

  // Hardening fix 1: Detect nonexistent ingredient IDs
  const foundIds = new Set(ingredients.map(ing => ing._id.toString()));
  const missingIds = ingredientIds.filter(id => !foundIds.has(id));

  const unavailable = [];

  // Report missing ingredients first
  for (const missingId of missingIds) {
    unavailable.push({
      ingredientId: missingId,
      name: 'Unknown',
      reason: 'not_found',
      requested: ingredientQuantities[missingId],
    });
  }

  // Check found ingredients
  for (const ingredient of ingredients) {
    const requestedQty = ingredientQuantities[ingredient._id.toString()];
    if (!ingredient.isActive) {
      unavailable.push({
        ingredientId: ingredient._id,
        name: ingredient.name,
        reason: 'inactive',
      });
    } else if (ingredient.available < requestedQty) {
      unavailable.push({
        ingredientId: ingredient._id,
        name: ingredient.name,
        reason: 'insufficient_stock',
        available: ingredient.available,
        requested: requestedQty,
      });
    }
  }

  return {
    available: unavailable.length === 0,
    unavailable,
  };
};

export default mongoose.model('Ingredient', ingredientSchema);
