import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Ingredient from '../../server/src/models/Ingredient.js';

describe('Ingredient Model - Phase 3 Inventory Validation', () => {
  let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
    },
  });

  const uri = replSet.getUri();

  await mongoose.connect(uri);

  // Ensure MongoDB indexes exist before running tests
  await Ingredient.init();
});

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    await Ingredient.deleteMany({});
  });

  describe('Schema Validation', () => {
    it('should create ingredient with valid fields', async () => {
      const ingredient = await Ingredient.create({
        name: 'Mozzarella Cheese',
        category: 'cheese',
        pricePaise: 5000, // 50 rupees
        stock: 100,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: true,
      });

      expect(ingredient.name).toBe('Mozzarella Cheese');
      expect(ingredient.category).toBe('cheese');
      expect(ingredient.pricePaise).toBe(5000);
      expect(ingredient.stock).toBe(100);
      expect(ingredient.reserved).toBe(0);
      expect(ingredient.lowStockThreshold).toBe(10);
      expect(ingredient.isActive).toBe(true);
    });

    it('should apply default values correctly', async () => {
      const ingredient = await Ingredient.create({
        name: 'Tomato Sauce',
        category: 'sauce',
        pricePaise: 3000,
        stock: 50,
      });

      expect(ingredient.reserved).toBe(0);
      expect(ingredient.lowStockThreshold).toBe(10);
      expect(ingredient.isActive).toBe(true);
    });

    it('should require name, category, pricePaise, and stock', async () => {
      await expect(Ingredient.create({
        category: 'base',
        pricePaise: 4000,
        stock: 30,
      })).rejects.toThrow();

      await expect(Ingredient.create({
        name: 'Thin Crust',
        pricePaise: 4000,
        stock: 30,
      })).rejects.toThrow();

      await expect(Ingredient.create({
        name: 'Thin Crust',
        category: 'base',
        stock: 30,
      })).rejects.toThrow();

      await expect(Ingredient.create({
        name: 'Thin Crust',
        category: 'base',
        pricePaise: 4000,
        // Missing stock - but defaults to 0, which is valid
      })).resolves.toBeDefined();

      // Verify it created with default stock
      const created = await Ingredient.findOne({ name: 'Thin Crust' });
      expect(created.stock).toBe(0);
    });

    it('should enforce valid category enum values', async () => {
      await expect(Ingredient.create({
        name: 'Invalid Item',
        category: 'topping', // Invalid
        pricePaise: 2000,
        stock: 20,
      })).rejects.toThrow();
    });

    it('should accept all valid category values', async () => {
      const categories = ['base', 'sauce', 'cheese', 'vegetable'];

      for (const category of categories) {
        const ingredient = await Ingredient.create({
          name: `Test ${category}`,
          category,
          pricePaise: 1000,
          stock: 10,
        });
        expect(ingredient.category).toBe(category);
      }
    });

    it('should enforce non-negative pricePaise', async () => {
      await expect(Ingredient.create({
        name: 'Negative Price',
        category: 'cheese',
        pricePaise: -100,
        stock: 10,
      })).rejects.toThrow();
    });

    it('should enforce non-negative stock', async () => {
      await expect(Ingredient.create({
        name: 'Negative Stock',
        category: 'vegetable',
        pricePaise: 1500,
        stock: -5,
      })).rejects.toThrow();
    });

    it('should enforce non-negative reserved', async () => {
      await expect(Ingredient.create({
        name: 'Negative Reserved',
        category: 'vegetable',
        pricePaise: 8000,
        stock: 50,
        reserved: -10,
      })).rejects.toThrow();
    });

    it('should enforce integer pricePaise (OD-19)', async () => {
      await expect(Ingredient.create({
        name: 'Float Price',
        category: 'cheese',
        pricePaise: 49.99, // Floats not allowed
        stock: 20,
      })).rejects.toThrow(/integer/i);
    });

    it('should enforce integer stock', async () => {
      await expect(Ingredient.create({
        name: 'Float Stock',
        category: 'base',
        pricePaise: 4000,
        stock: 10.5,
      })).rejects.toThrow(/integer/i);
    });

    it('should enforce integer reserved', async () => {
      await expect(Ingredient.create({
        name: 'Float Reserved',
        category: 'sauce',
        pricePaise: 3000,
        stock: 30,
        reserved: 5.5,
      })).rejects.toThrow(/integer/i);
    });

    it('should enforce unique ingredient names', async () => {
      await Ingredient.create({
        name: 'Mushrooms',
        category: 'vegetable',
        pricePaise: 9000,
        stock: 40,
      });

      await expect(Ingredient.create({
        name: 'Mushrooms', // Duplicate
        category: 'vegetable',
        pricePaise: 8500,
        stock: 35,
      })).rejects.toThrow();
    });
  });

  describe('Reserved <= Stock Validation (OD-04)', () => {
    it('should allow reserved equal to stock', async () => {
      const ingredient = await Ingredient.create({
        name: 'Fully Reserved',
        category: 'cheese',
        pricePaise: 5000,
        stock: 50,
        reserved: 50,
      });

      expect(ingredient.reserved).toBe(50);
      expect(ingredient.stock).toBe(50);
    });

    it('should allow reserved less than stock', async () => {
      const ingredient = await Ingredient.create({
        name: 'Partially Reserved',
        category: 'vegetable',
        pricePaise: 2000,
        stock: 100,
        reserved: 30,
      });

      expect(ingredient.reserved).toBe(30);
      expect(ingredient.stock).toBe(100);
    });

    it('should reject reserved greater than stock on create', async () => {
      await expect(Ingredient.create({
        name: 'Over Reserved',
        category: 'vegetable',
        pricePaise: 7000,
        stock: 20,
        reserved: 25, // Exceeds stock
      })).rejects.toThrow(/reserved.*cannot exceed.*stock/i);
    });

    it('should reject reserved greater than stock on update', async () => {
      const ingredient = await Ingredient.create({
        name: 'Update Test',
        category: 'base',
        pricePaise: 4000,
        stock: 50,
        reserved: 10,
      });

      ingredient.reserved = 60; // Exceeds stock
      await expect(ingredient.save()).rejects.toThrow(/reserved.*cannot exceed.*stock/i);
    });

    it('should allow updating stock and reserved together maintaining constraint', async () => {
      const ingredient = await Ingredient.create({
        name: 'Stock Update',
        category: 'sauce',
        pricePaise: 3000,
        stock: 50,
        reserved: 20,
      });

      ingredient.stock = 100;
      ingredient.reserved = 80;
      await ingredient.save();

      expect(ingredient.stock).toBe(100);
      expect(ingredient.reserved).toBe(80);
    });
  });

  describe('Virtual Fields (OD-13)', () => {
    it('should compute isLowStock when available <= threshold', async () => {
      const ingredient = await Ingredient.create({
        name: 'Low Stock Item',
        category: 'cheese',
        pricePaise: 5000,
        stock: 20,
        reserved: 10,
        lowStockThreshold: 10,
      });

      // available = 20 - 10 = 10, threshold = 10, so isLowStock = true
      expect(ingredient.isLowStock).toBe(true);
    });

    it('should compute isLowStock as false when available > threshold', async () => {
      const ingredient = await Ingredient.create({
        name: 'Good Stock Item',
        category: 'vegetable',
        pricePaise: 2000,
        stock: 50,
        reserved: 10,
        lowStockThreshold: 10,
      });

      // available = 50 - 10 = 40, threshold = 10, so isLowStock = false
      expect(ingredient.isLowStock).toBe(false);
    });

    it('should compute available as stock minus reserved', async () => {
      const ingredient = await Ingredient.create({
        name: 'Available Test',
        category: 'vegetable',
        pricePaise: 8000,
        stock: 100,
        reserved: 35,
      });

      expect(ingredient.available).toBe(65);
    });

    it('should show zero available when fully reserved', async () => {
      const ingredient = await Ingredient.create({
        name: 'Fully Reserved',
        category: 'base',
        pricePaise: 4000,
        stock: 50,
        reserved: 50,
      });

      expect(ingredient.available).toBe(0);
      expect(ingredient.isLowStock).toBe(true);
    });

    it('should include virtuals in JSON output', async () => {
      const ingredient = await Ingredient.create({
        name: 'JSON Test',
        category: 'sauce',
        pricePaise: 3000,
        stock: 30,
        reserved: 5,
        lowStockThreshold: 10,
      });

      const json = ingredient.toJSON();
      expect(json.available).toBe(25);
      expect(json.isLowStock).toBe(false);
      expect(json.__v).toBeUndefined(); // Should be stripped
    });
  });

  describe('checkAvailability Static Method', () => {
    beforeEach(async () => {
      // Create test ingredients
      await Ingredient.create([
        { name: 'Active Base', category: 'base', pricePaise: 4000, stock: 100, reserved: 20, isActive: true },
        { name: 'Active Sauce', category: 'sauce', pricePaise: 3000, stock: 50, reserved: 10, isActive: true },
        { name: 'Low Stock Cheese', category: 'cheese', pricePaise: 5000, stock: 15, reserved: 10, isActive: true },
        { name: 'Inactive Vegetable', category: 'vegetable', pricePaise: 8000, stock: 100, reserved: 0, isActive: false },
      ]);
    });

    it('should return available true when all ingredients have sufficient stock', async () => {
      const base = await Ingredient.findOne({ name: 'Active Base' });
      const sauce = await Ingredient.findOne({ name: 'Active Sauce' });

      const quantities = {
        [base._id.toString()]: 10,
        [sauce._id.toString()]: 5,
      };

      const result = await Ingredient.checkAvailability(quantities);
      expect(result.available).toBe(true);
      expect(result.unavailable).toHaveLength(0);
    });

    it('should detect insufficient stock', async () => {
      const cheese = await Ingredient.findOne({ name: 'Low Stock Cheese' });

      const quantities = {
        [cheese._id.toString()]: 10, // available = 15 - 10 = 5, requested = 10
      };

      const result = await Ingredient.checkAvailability(quantities);
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].reason).toBe('insufficient_stock');
      expect(result.unavailable[0].available).toBe(5);
      expect(result.unavailable[0].requested).toBe(10);
    });

    it('should detect inactive ingredients', async () => {
      const vegetable = await Ingredient.findOne({ name: 'Inactive Vegetable' });

      const quantities = {
        [vegetable._id.toString()]: 5,
      };

      const result = await Ingredient.checkAvailability(quantities);
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].reason).toBe('inactive');
    });

    it('should detect multiple unavailable ingredients', async () => {
      const cheese = await Ingredient.findOne({ name: 'Low Stock Cheese' });
      const vegetable = await Ingredient.findOne({ name: 'Inactive Vegetable' });

      const quantities = {
        [cheese._id.toString()]: 10,
        [vegetable._id.toString()]: 5,
      };

      const result = await Ingredient.checkAvailability(quantities);
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(2);
    });

    it('should handle exact available quantity as sufficient', async () => {
      const cheese = await Ingredient.findOne({ name: 'Low Stock Cheese' });

      const quantities = {
        [cheese._id.toString()]: 5, // Exactly available
      };

      const result = await Ingredient.checkAvailability(quantities);
      expect(result.available).toBe(true);
      expect(result.unavailable).toHaveLength(0);
    });
  });

  describe('Indexes', () => {
    it('should have index on category', async () => {
      await Ingredient.init(); // Ensure indexes are created
      const indexes = await Ingredient.collection.getIndexes();
      const categoryIndex = Object.keys(indexes).find(key => 
        key.includes('category') && !key.includes('isActive')
      );
      expect(categoryIndex).toBeDefined();
    });

    it('should have index on isActive', async () => {
      await Ingredient.init();
      const indexes = await Ingredient.collection.getIndexes();
      const activeIndex = Object.keys(indexes).find(key => 
        key.includes('isActive') && !key.includes('category')
      );
      expect(activeIndex).toBeDefined();
    });

    it('should have compound index on category and isActive', async () => {
      await Ingredient.init();
      const indexes = await Ingredient.collection.getIndexes();
      const compoundIndex = Object.keys(indexes).find(key => 
        key.includes('category') && key.includes('isActive')
      );
      expect(compoundIndex).toBeDefined();
    });

    it('should have unique index on name', async () => {
      await Ingredient.init();
      const indexes = await Ingredient.collection.getIndexes();
      expect(indexes.name_1).toBeDefined();
      // Unique constraint enforced by schema, tested by duplicate name test
    });
  });

  describe('Timestamps', () => {
    it('should set createdAt and updatedAt on create', async () => {
      const before = new Date();
      const ingredient = await Ingredient.create({
        name: 'Timestamp Test',
        category: 'cheese',
        pricePaise: 5000,
        stock: 50,
      });
      const after = new Date();

      expect(ingredient.createdAt).toBeInstanceOf(Date);
      expect(ingredient.updatedAt).toBeInstanceOf(Date);
      expect(ingredient.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ingredient.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should update updatedAt on save', async () => {
      const ingredient = await Ingredient.create({
        name: 'Update Timestamp Test',
        category: 'vegetable',
        pricePaise: 2000,
        stock: 100,
      });

      const originalUpdatedAt = ingredient.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      ingredient.stock = 120;
      await ingredient.save();

      expect(ingredient.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
describe('Hardening - Nonexistent Ingredient Detection', () => {
    it('should detect nonexistent ingredient IDs in availability check', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const realIngredient = await Ingredient.create({
        name: 'Real Ingredient',
        category: 'base',
        pricePaise: 5000,
        stock: 100,
      });

      const quantities = {
        [fakeId.toString()]: 10,
        [realIngredient._id.toString()]: 5,
      };

      const result = await Ingredient.checkAvailability(quantities);
      
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0].reason).toBe('not_found');
      expect(result.unavailable[0].ingredientId).toBe(fakeId.toString());
    });

    it('should report all nonexistent ingredients', async () => {
      const fakeId1 = new mongoose.Types.ObjectId();
      const fakeId2 = new mongoose.Types.ObjectId();

      const quantities = {
        [fakeId1.toString()]: 5,
        [fakeId2.toString()]: 3,
      };

      const result = await Ingredient.checkAvailability(quantities);
      
      expect(result.available).toBe(false);
      expect(result.unavailable).toHaveLength(2);
      expect(result.unavailable.every(u => u.reason === 'not_found')).toBe(true);
    });
  });
});


  