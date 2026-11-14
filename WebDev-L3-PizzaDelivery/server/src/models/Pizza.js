import mongoose from 'mongoose';

const pizzaSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  category: {
    type: String,
    enum: ['vegetarian', 'non-vegetarian', 'vegan'],
    required: true,
    index: true,
  },
  ingredients: {
    base: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true,
    },
    sauce: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true,
    },
    cheese: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true,
    },
    vegetables: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Ingredient',
}],
proteins: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Ingredient',
}],
  },
  imageUrl: {
    type: String,
    trim: true,
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

// Update timestamp on save
pizzaSchema.pre('save', async function() {
  this.updatedAt = new Date();
});

// Hardening fix 3: Enforce correct ingredient categories when saving pizzas
pizzaSchema.pre('save', async function() {
  const Ingredient = mongoose.model('Ingredient');
  
  // Validate all ingredient categories match their placement
  const errors = [];
  
  // Check base
  if (this.ingredients.base) {
    const base = await Ingredient.findById(this.ingredients.base);
    if (!base) {
      errors.push('Base ingredient not found');
    } else if (base.category !== 'base') {
      errors.push(`Base must be a base ingredient, got ${base.category}`);
    }
  }
  
  // Check sauce
  if (this.ingredients.sauce) {
    const sauce = await Ingredient.findById(this.ingredients.sauce);
    if (!sauce) {
      errors.push('Sauce ingredient not found');
    } else if (sauce.category !== 'sauce') {
      errors.push(`Sauce must be a sauce ingredient, got ${sauce.category}`);
    }
  }
  
  // Check cheese
  if (this.ingredients.cheese) {
    const cheese = await Ingredient.findById(this.ingredients.cheese);
    if (!cheese) {
      errors.push('Cheese ingredient not found');
    } else if (cheese.category !== 'cheese') {
      errors.push(`Cheese must be a cheese ingredient, got ${cheese.category}`);
    }
  }
  
  // Hardening fix 4: Reject duplicate vegetables
  if (this.ingredients.vegetables && this.ingredients.vegetables.length > 0) {
    const vegIds = this.ingredients.vegetables.map(id => id.toString());
    const uniqueVegIds = new Set(vegIds);
    if (vegIds.length !== uniqueVegIds.size) {
      errors.push('Duplicate vegetables are not allowed');
    }
    
    // Check each vegetable
    for (const vegId of this.ingredients.vegetables) {
      const veg = await Ingredient.findById(vegId);
      if (!veg) {
        errors.push(`Vegetable ${vegId} not found`);
      } else if (veg.category !== 'vegetable') {
        errors.push(`Vegetable must be a vegetable ingredient, got ${veg.category}`);
      }
    }
  }

  // Validate protein ingredient categories
const proteins = this.ingredients.proteins || [];

for (const proteinId of proteins) {
  const protein = await Ingredient.findById(proteinId);

  if (!protein) {
    errors.push(`Protein ${proteinId} not found`);
  } else if (protein.category !== 'protein') {
    errors.push(
      `Protein must be a protein ingredient, got ${protein.category}`
    );
  }
}
  
  if (errors.length > 0) {
    throw new Error(`Pizza validation failed: ${errors.join('; ')}`);
  }
});

// Validate protein requirements based on pizza category
pizzaSchema.pre('validate', function () {
  const proteins = this.ingredients?.proteins || [];

  const proteinIds = proteins.map(
    id => id?.toString().toLowerCase()
  );

  // Non-vegetarian pizzas require at least one protein
  if (
    this.category === 'non-vegetarian' &&
    proteins.length === 0
  ) {
    this.invalidate(
      'ingredients.proteins',
      'Non-vegetarian pizzas must contain at least one protein'
    );
  }

  // Vegetarian and vegan pizzas cannot contain proteins
  if (
    ['vegetarian', 'vegan'].includes(this.category) &&
    proteins.length > 0
  ) {
    this.invalidate(
      'ingredients.proteins',
      'Vegetarian and vegan pizzas cannot contain protein toppings'
    );
  }

  // Reject duplicate protein ingredients
  if (
    proteinIds.some(id => !id) ||
    new Set(proteinIds).size !== proteinIds.length
  ) {
    this.invalidate(
      'ingredients.proteins',
      'Duplicate or invalid protein ingredients are not allowed'
    );
  }
});

// Static method: validate ingredient categories match their placement
pizzaSchema.statics.validateIngredientCategories = async function(ingredientConfig) {
  const Ingredient = mongoose.model('Ingredient');
  
  const validationErrors = [];
  
  // Validate base
  if (ingredientConfig.base) {
    const base = await Ingredient.findById(ingredientConfig.base);
    if (!base) {
      validationErrors.push({ field: 'base', error: 'Ingredient not found' });
    } else if (base.category !== 'base') {
      validationErrors.push({ 
        field: 'base', 
        error: `Ingredient is ${base.category}, expected base` 
      });
    }
  }
  
  // Validate sauce
  if (ingredientConfig.sauce) {
    const sauce = await Ingredient.findById(ingredientConfig.sauce);
    if (!sauce) {
      validationErrors.push({ field: 'sauce', error: 'Ingredient not found' });
    } else if (sauce.category !== 'sauce') {
      validationErrors.push({ 
        field: 'sauce', 
        error: `Ingredient is ${sauce.category}, expected sauce` 
      });
    }
  }
  
  // Validate cheeses
  if (ingredientConfig.cheese) {
    const cheese = await Ingredient.findById(ingredientConfig.cheese);
    if (!cheese) {
      validationErrors.push({ field: 'cheese', error: 'Cheese not found' });
    } else if (cheese.category !== 'cheese') {
      validationErrors.push({ 
        field: 'cheese', 
        error: `Ingredient ${cheese.name} is ${cheese.category}, expected cheese` 
      });
    }
  }
  
  // Validate vegetables
  if (ingredientConfig.vegetables && ingredientConfig.vegetables.length > 0) {
    for (const vegId of ingredientConfig.vegetables) {
      const veg = await Ingredient.findById(vegId);
      if (!veg) {
        validationErrors.push({ field: 'vegetables', error: `Vegetable ${vegId} not found` });
      } else if (veg.category !== 'vegetable') {
        validationErrors.push({ 
          field: 'vegetables', 
          error: `Ingredient ${veg.name} is ${veg.category}, expected vegetable` 
        });
      }
    }
  }
  
// Validate protein toppings
if (ingredientConfig.proteins !== undefined) {
  if (!Array.isArray(ingredientConfig.proteins)) {
    validationErrors.push({
      field: 'proteins',
      error: 'Proteins must be an array'
    });
  } else {
    const proteinIds = ingredientConfig.proteins.map(String);

    // Prevent duplicate protein selections
    if (new Set(proteinIds).size !== proteinIds.length) {
      validationErrors.push({
        field: 'proteins',
        error: 'Duplicate proteins are not allowed'
      });
    }

    for (const proteinId of proteinIds) {
      const protein = await Ingredient.findById(proteinId);

      if (!protein) {
        validationErrors.push({
          field: 'proteins',
          error: `Protein ${proteinId} not found`
        });
      } else if (protein.category !== 'protein') {
        validationErrors.push({
          field: 'proteins',
          error: `Ingredient ${protein.name} is ${protein.category}, expected protein`
        });
      }
    }
  }
}

  return validationErrors;
};

// Instance method: calculate total price by summing ingredient prices
pizzaSchema.methods.calculatePrice = async function() {
  const Ingredient = mongoose.model('Ingredient');
  
  // Collect all ingredient IDs, handling both populated and unpopulated cases
  const extractId = (ref) => (ref && ref._id) || ref;
  
  const ingredientIds = [
  this.ingredients.base,
  this.ingredients.sauce,
  this.ingredients.cheese,
  ...(this.ingredients.vegetables || []),
  ...(this.ingredients.proteins || []),
].filter(Boolean);
  
  // Hardening fix 2: Reject missing ingredients during price calculation
  const expectedCount = ingredientIds.length;
  const ingredients = await Ingredient.find({ _id: { $in: ingredientIds } });
  
  if (ingredients.length !== expectedCount) {
    const foundIds = new Set(ingredients.map(ing => ing._id.toString()));
    const missingIds = ingredientIds
      .map(id => id.toString())
      .filter(id => !foundIds.has(id));
    throw new Error(`Cannot calculate price: ingredients not found: ${missingIds.join(', ')}`);
  }
  
  // Sum prices (OD-07: per-ingredient pricing, OD-16: 1 unit per ingredient)
  const totalPaise = ingredients.reduce((sum, ing) => sum + ing.pricePaise, 0);
  
  return totalPaise;
};

// Instance method: check if all ingredients are in stock and active
pizzaSchema.methods.checkAvailability = async function(quantity = 1) {
  const Ingredient = mongoose.model('Ingredient');
  
  // Collect all ingredient IDs, handling both populated and unpopulated cases
  const extractId = (ref) => (ref && ref._id) || ref;
  
  const ingredientIds = [
  this.ingredients.base,
  this.ingredients.sauce,
  this.ingredients.cheese,
  ...(this.ingredients.vegetables || []),
  ...(this.ingredients.proteins || []),
].filter(Boolean);
  
  // Build quantity map: each ingredient needs 'quantity' units per OD-16
  const ingredientQuantities = {};
  for (const id of ingredientIds) {
    ingredientQuantities[id.toString()] = quantity;
  }
  
  return await Ingredient.checkAvailability(ingredientQuantities);
};

// Ensure virtuals are included in JSON/Object output
pizzaSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

pizzaSchema.set('toObject', { virtuals: true });

export default mongoose.model('Pizza', pizzaSchema);
