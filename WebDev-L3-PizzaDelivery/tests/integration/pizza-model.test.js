import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Pizza from '../../server/src/models/Pizza.js';
import Ingredient from '../../server/src/models/Ingredient.js';

describe('Pizza Model - Phase 3 Recipe and Pricing', () => {
  let replSet;
  let testIngredients = {};

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
      },
    });

    const uri = replSet.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    // Create test ingredients for each category
    const ingredients = await Ingredient.create([
      { name: 'Thin Crust', category: 'base', pricePaise: 4000, stock: 100 },
      { name: 'Thick Crust', category: 'base', pricePaise: 5000, stock: 100 },
      { name: 'Tomato Sauce', category: 'sauce', pricePaise: 3000, stock: 100 },
      { name: 'Pesto Sauce', category: 'sauce', pricePaise: 4000, stock: 100 },
      { name: 'Mozzarella', category: 'cheese', pricePaise: 5000, stock: 100 },
      { name: 'Cheddar', category: 'cheese', pricePaise: 4500, stock: 100 },
      { name: 'Bell Peppers', category: 'vegetable', pricePaise: 2000, stock: 100 },
      { name: 'Onions', category: 'vegetable', pricePaise: 1500, stock: 100 },
      { name: 'Mushrooms', category: 'vegetable', pricePaise: 2500, stock: 100 },
      { name: 'Olives', category: 'vegetable', pricePaise: 1800, stock: 100 },
      { name: 'Low Stock Base', category: 'base', pricePaise: 4000, stock: 15, reserved: 10 },
      { name: 'Inactive Sauce', category: 'sauce', pricePaise: 3000, stock: 100, isActive: false },
    ]);

    testIngredients = {
      thinCrust: ingredients[0]._id,
      thickCrust: ingredients[1]._id,
      tomatoSauce: ingredients[2]._id,
      pestoSauce: ingredients[3]._id,
      mozzarella: ingredients[4]._id,
      cheddar: ingredients[5]._id,
      bellPeppers: ingredients[6]._id,
      onions: ingredients[7]._id,
      mushrooms: ingredients[8]._id,
      olives: ingredients[9]._id,
      lowStockBase: ingredients[10]._id,
      inactiveSauce: ingredients[11]._id,
    };
  });

  afterEach(async () => {
    await Pizza.deleteMany({});
    await Ingredient.deleteMany({});
    testIngredients = {};
  });

  describe('Schema Validation', () => {
    it('should create pizza with valid minimal fields (base + sauce + cheese, R-12)', async () => {
      const pizza = await Pizza.create({
        name: 'Simple Margherita',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      expect(pizza.name).toBe('Simple Margherita');
      expect(pizza.category).toBe('vegetarian');
      expect(pizza.ingredients.base).toEqual(testIngredients.thinCrust);
      expect(pizza.ingredients.sauce).toEqual(testIngredients.tomatoSauce);
      expect(pizza.ingredients.cheese).toEqual(testIngredients.mozzarella);
      expect(pizza.ingredients.vegetables).toEqual([]);
    });

    it('should create pizza with all ingredient categories', async () => {
      const pizza = await Pizza.create({
        name: 'Supreme Pizza',
        description: 'Loaded with everything',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thickCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
          vegetables: [testIngredients.bellPeppers, testIngredients.onions],
        },
      });

      expect(pizza.name).toBe('Supreme Pizza');
      expect(pizza.ingredients.cheese).toEqual(testIngredients.mozzarella);
      expect(pizza.ingredients.vegetables).toHaveLength(2);
    });

    it('should require name and category', async () => {
      await expect(Pizza.create({
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
        },
      })).rejects.toThrow();

      await expect(Pizza.create({
        name: 'Test Pizza',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
        },
      })).rejects.toThrow();
    });

    it('should require base ingredient', async () => {
      await expect(Pizza.create({
        name: 'No Base Pizza',
        category: 'vegetarian',
        ingredients: {
          sauce: testIngredients.tomatoSauce,
        },
      })).rejects.toThrow(); // Will throw Mongoose required error or our custom error
    });

    it('should require sauce ingredient', async () => {
      await expect(Pizza.create({
        name: 'No Sauce Pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
        },
      })).rejects.toThrow(); // Will throw Mongoose required error or our custom error
    });

    it('should enforce valid category enum', async () => {
      await expect(Pizza.create({
        name: 'Invalid Category',
        category: 'gluten-free', // Invalid
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      })).rejects.toThrow();
    });

    it('should accept all valid category values', async () => {
      const categories = ['vegetarian', 'non-vegetarian', 'vegan'];

      for (let i = 0; i < categories.length; i++) {
        const pizza = await Pizza.create({
          name: `${categories[i]} Pizza ${i}`,
          category: categories[i],
          ingredients: {
            base: testIngredients.thinCrust,
            sauce: testIngredients.tomatoSauce,
            cheese: testIngredients.mozzarella,
          },
        });
        expect(pizza.category).toBe(categories[i]);
      }
    });

    it('should enforce unique pizza names', async () => {
      await Pizza.create({
        name: 'Margherita',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      await expect(Pizza.create({
        name: 'Margherita', // Duplicate
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.pestoSauce,
          cheese: testIngredients.cheddar,
        },
      })).rejects.toThrow();
    });

    it('should default isActive to true', async () => {
      const pizza = await Pizza.create({
        name: 'Active Default',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      expect(pizza.isActive).toBe(true);
    });
  });

  describe('validateIngredientCategories Static Method', () => {
    it('should validate correct ingredient categories', async () => {
      const ingredientConfig = {
        base: testIngredients.thinCrust,
        sauce: testIngredients.tomatoSauce,
        cheese: testIngredients.mozzarella,
        vegetables: [testIngredients.bellPeppers],
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors).toHaveLength(0);
    });

    it('should detect wrong category for base', async () => {
      const ingredientConfig = {
        base: testIngredients.mozzarella, // Cheese, not base
        sauce: testIngredients.tomatoSauce,
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('base');
      expect(errors[0].error).toMatch(/cheese.*expected base/i);
    });

    it('should detect wrong category for sauce', async () => {
      const ingredientConfig = {
        base: testIngredients.thinCrust,
        sauce: testIngredients.bellPeppers, // Vegetable, not sauce
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('sauce');
      expect(errors[0].error).toMatch(/vegetable.*expected sauce/i);
    });

    it('should detect wrong category for cheese (R-12 requires cheese)', async () => {
      const ingredientConfig = {
        base: testIngredients.thinCrust,
        sauce: testIngredients.tomatoSauce,
        cheese: testIngredients.bellPeppers, // Vegetable, not cheese
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('cheese');
      expect(errors[0].error).toMatch(/vegetable.*expected cheese/i);
    });

    it('should detect wrong category in vegetables array', async () => {
      const ingredientConfig = {
        base: testIngredients.thinCrust,
        sauce: testIngredients.tomatoSauce,
        vegetables: [testIngredients.cheddar], // Cheese, not vegetable
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('vegetables');
      expect(errors[0].error).toMatch(/cheese.*expected vegetable/i);
    });

    it('should detect multiple category mismatches', async () => {
      const ingredientConfig = {
        base: testIngredients.tomatoSauce, // Wrong
        sauce: testIngredients.thinCrust, // Wrong
        cheese: testIngredients.bellPeppers, // Wrong
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should detect non-existent ingredient', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const ingredientConfig = {
        base: fakeId,
        sauce: testIngredients.tomatoSauce,
      };

      const errors = await Pizza.validateIngredientCategories(ingredientConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('base');
      expect(errors[0].error).toMatch(/not found/i);
    });
  });

  describe('calculatePrice Instance Method (OD-07, OD-16)', () => {
    it('should calculate price for base + sauce + cheese (R-12 minimum)', async () => {
      const pizza = await Pizza.create({
        name: 'Simple Pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust, // 4000 paise
          sauce: testIngredients.tomatoSauce, // 3000 paise
          cheese: testIngredients.mozzarella, // 5000 paise
        },
      });

      const price = await pizza.calculatePrice();
      expect(price).toBe(12000); // 4000 + 3000 + 5000
    });

    it('should sum all ingredient prices correctly', async () => {
      const pizza = await Pizza.create({
        name: 'Full Pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thickCrust, // 5000
          sauce: testIngredients.tomatoSauce, // 3000
          cheese: testIngredients.mozzarella, // 5000
          vegetables: [testIngredients.bellPeppers, testIngredients.onions], // 2000 + 1500
        },
      });

      const price = await pizza.calculatePrice();
      expect(price).toBe(16500); // 5000 + 3000 + 5000 + 2000 + 1500
    });

    it('should handle multiple vegetables', async () => {
      const pizza = await Pizza.create({
        name: 'Veggie Supreme',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust, // 4000
          sauce: testIngredients.pestoSauce, // 4000
          cheese: testIngredients.mozzarella, // 5000
          vegetables: [testIngredients.bellPeppers, testIngredients.onions, testIngredients.mushrooms], // 2000 + 1500 + 2500
        },
      });

      const price = await pizza.calculatePrice();
      expect(price).toBe(19000); // 4000 + 4000 + 5000 + 2000 + 1500 + 2500
    });

    it('should return integer price in paise (OD-19)', async () => {
      const pizza = await Pizza.create({
        name: 'Price Check',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      const price = await pizza.calculatePrice();
      expect(Number.isInteger(price)).toBe(true);
    });
  });

  describe('checkAvailability Instance Method', () => {
    it('should return available true for pizza with sufficient stock', async () => {
      const pizza = await Pizza.create({
        name: 'Available Pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust, // stock: 100, reserved: 0
          sauce: testIngredients.tomatoSauce, // stock: 100, reserved: 0
          cheese: testIngredients.mozzarella, // stock: 100, reserved: 0
        },
      });

      const result = await pizza.checkAvailability(10);
      expect(result.available).toBe(true);
      expect(result.unavailable).toHaveLength(0);
    });

    it('should detect insufficient stock for one ingredient', async () => {
      const pizza = await Pizza.create({
        name: 'Low Stock Pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.lowStockBase, // stock: 15, reserved: 10, available: 5
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      const result = await pizza.checkAvailability(10); // Requesting 10, only 5 available
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].reason).toBe('insufficient_stock');
    });

    it('should detect inactive ingredient', async () => {
      const pizza = await Pizza.create({
        name: 'Inactive Ingredient Pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.inactiveSauce, // isActive: false
          cheese: testIngredients.mozzarella,
        },
      });

      const result = await pizza.checkAvailability(1);
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].reason).toBe('inactive');
    });

    it('should check availability for multiple pizzas (OD-16: 1 unit per ingredient)', async () => {
      const pizza = await Pizza.create({
        name: 'Quantity Check',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust, // 100 available
          sauce: testIngredients.tomatoSauce, // 100 available
          cheese: testIngredients.mozzarella, // 100 available
        },
      });

      // Requesting 50 pizzas = 50 units of each ingredient
      const result = await pizza.checkAvailability(50);
      expect(result.available).toBe(true);
    });

    it('should default to quantity 1 when not specified', async () => {
      const pizza = await Pizza.create({
        name: 'Default Quantity',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      const result = await pizza.checkAvailability();
      expect(result.available).toBe(true);
    });
  });

  describe('Indexes', () => {
    it('should have index on category', async () => {
      await Pizza.init(); // Ensure indexes are created
      const indexes = await Pizza.collection.getIndexes();
      const categoryIndex = Object.keys(indexes).find(key =>
        key.includes('category')
      );
      expect(categoryIndex).toBeDefined();
    });

    it('should have index on isActive', async () => {
      await Pizza.init();
      const indexes = await Pizza.collection.getIndexes();
      const activeIndex = Object.keys(indexes).find(key =>
        key.includes('isActive')
      );
      expect(activeIndex).toBeDefined();
    });

    it('should have unique index on name', async () => {
      await Pizza.init();
      const indexes = await Pizza.collection.getIndexes();
      expect(indexes.name_1).toBeDefined();
      // Unique constraint enforced by schema, tested by duplicate name test
    });
  });

  describe('Timestamps', () => {
    it('should set createdAt and updatedAt on create', async () => {
      const before = new Date();
      const pizza = await Pizza.create({
        name: 'Timestamp Test',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });
      const after = new Date();

      expect(pizza.createdAt).toBeInstanceOf(Date);
      expect(pizza.updatedAt).toBeInstanceOf(Date);
      expect(pizza.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(pizza.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should update updatedAt on save', async () => {
      const pizza = await Pizza.create({
        name: 'Update Test',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      const originalUpdatedAt = pizza.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      pizza.description = 'Updated description';
      await pizza.save();

      expect(pizza.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('JSON Serialization', () => {
    it('should exclude __v from JSON output', async () => {
      const pizza = await Pizza.create({
        name: 'JSON Test',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      const json = pizza.toJSON();
      expect(json.__v).toBeUndefined();
      expect(json.name).toBe('JSON Test');
    });

    it('should include virtuals in JSON', async () => {
      const pizza = await Pizza.create({
        name: 'Virtual Test',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      });

      const json = pizza.toJSON();
      expect(json.id).toBeDefined(); // Virtual id field from Mongoose
    });
  });

  describe('Hardening - Missing Ingredient Validation', () => {
    it('should reject missing ingredients during price calculation', async () => {
  // Step 1: Create a valid pizza
  const pizza = await Pizza.create({
    name: 'Missing Ingredient Pricing Test',
    category: 'vegetarian',
    ingredients: {
      base: testIngredients.thinCrust,
      sauce: testIngredients.tomatoSauce,
      cheese: testIngredients.mozzarella,
    },
  });

  // Step 2: Delete the cheese after creating the pizza
  await Ingredient.deleteOne({
    _id: testIngredients.mozzarella,
  });

  // Step 3: Pricing must reject the missing ingredient
  await expect(
    pizza.calculatePrice()
  ).rejects.toThrow();
});

    it('should reject nonexistent base ingredient on save', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(Pizza.create({
        name: 'Bad Base',
        category: 'vegetarian',
        ingredients: {
          base: fakeId,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
        },
      })).rejects.toThrow(/Base ingredient not found/);
    });

    it('should reject nonexistent sauce ingredient on save', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(Pizza.create({
        name: 'Bad Sauce',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: fakeId,
          cheese: testIngredients.mozzarella,
        },
      })).rejects.toThrow(/Sauce ingredient not found/);
    });

    it('should reject nonexistent cheese ingredient on save', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(Pizza.create({
        name: 'Bad Cheese',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: fakeId,
        },
      })).rejects.toThrow(/Cheese ingredient not found/);
    });

    it('should reject nonexistent vegetable ingredient on save', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(Pizza.create({
        name: 'Bad Veggie',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
          vegetables: [testIngredients.bellPeppers, fakeId],
        },
      })).rejects.toThrow(/not found/);
    });
  });

  describe('Hardening - Category Enforcement', () => {
    it('should reject wrong category for base', async () => {
      await expect(Pizza.create({
        name: 'Wrong Base Category',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.mozzarella, // Cheese, not base
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.cheddar,
        },
      })).rejects.toThrow(/Base must be a base ingredient/);
    });

    it('should reject wrong category for sauce', async () => {
      await expect(Pizza.create({
        name: 'Wrong Sauce Category',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.bellPeppers, // Vegetable, not sauce
          cheese: testIngredients.mozzarella,
        },
      })).rejects.toThrow(/Sauce must be a sauce ingredient/);
    });

    it('should reject wrong category for cheese', async () => {
      await expect(Pizza.create({
        name: 'Wrong Cheese Category',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.onions, // Vegetable, not cheese
        },
      })).rejects.toThrow(/Cheese must be a cheese ingredient/);
    });

    it('should reject wrong category for vegetables', async () => {
      await expect(Pizza.create({
        name: 'Wrong Veggie Category',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
          vegetables: [testIngredients.cheddar], // Cheese, not vegetable
        },
      })).rejects.toThrow(/Vegetable must be a vegetable ingredient/);
    });
  });

  describe('Hardening - Duplicate Vegetables', () => {
    it('should reject duplicate vegetables in the same pizza', async () => {
      await expect(Pizza.create({
        name: 'Duplicate Veggies',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
          vegetables: [
            testIngredients.bellPeppers,
            testIngredients.onions,
            testIngredients.bellPeppers, // Duplicate
          ],
        },
      })).rejects.toThrow(/Duplicate vegetables are not allowed/);
    });

    it('should allow same vegetable in different pizzas', async () => {
      const pizza1 = await Pizza.create({
        name: 'Pizza One',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust,
          sauce: testIngredients.tomatoSauce,
          cheese: testIngredients.mozzarella,
          vegetables: [testIngredients.bellPeppers],
        },
      });

      const pizza2 = await Pizza.create({
        name: 'Pizza Two',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thickCrust,
          sauce: testIngredients.pestoSauce,
          cheese: testIngredients.cheddar,
          vegetables: [testIngredients.bellPeppers], // Same vegetable, different pizza
        },
      });

      expect(pizza1._id).not.toEqual(pizza2._id);
      expect(pizza1.ingredients.vegetables[0]).toEqual(pizza2.ingredients.vegetables[0]);
    });
  });
});
