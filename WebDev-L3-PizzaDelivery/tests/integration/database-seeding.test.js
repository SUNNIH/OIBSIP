import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { exec } from 'child_process';
import { promisify } from 'util';
import { seedDatabase } from '../../server/src/scripts/seedDatabase.js';
import Ingredient from '../../server/src/models/Ingredient.js';
import Pizza from '../../server/src/models/Pizza.js';

const execAsync = promisify(exec);

describe('Database Seeding - Phase 3 Task 3.2', () => {
  let replSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    const uri = replSet.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    // Clear database before each test
    await Ingredient.deleteMany({});
    await Pizza.deleteMany({});

    // Ensure process.env.MONGODB_URI matches the test connection
    process.env.MONGODB_URI = replSet.getUri();
  });

  describe('Ingredient Seeding', () => {
    it('should seed all 21 ingredients (5 bases, 5 sauces, 3 cheeses, 8 vegetables)', async () => {
      await seedDatabase();

      const totalCount = await Ingredient.countDocuments();
      expect(totalCount).toBe(21);

      const basesCount = await Ingredient.countDocuments({ category: 'base' });
      expect(basesCount).toBe(5);

      const saucesCount = await Ingredient.countDocuments({ category: 'sauce' });
      expect(saucesCount).toBe(5);

      const cheesesCount = await Ingredient.countDocuments({ category: 'cheese' });
      expect(cheesesCount).toBe(3);

      const vegetablesCount = await Ingredient.countDocuments({ category: 'vegetable' });
      expect(vegetablesCount).toBe(8);
    });

    it('should create ingredients with correct stock levels (1000 units, 0 reserved, threshold 50)', async () => {
      await seedDatabase();

      const ingredients = await Ingredient.find({});
      expect(ingredients.length).toBeGreaterThan(0);

      for (const ingredient of ingredients) {
        expect(ingredient.stock).toBe(1000);
        expect(ingredient.reserved).toBe(0);
        expect(ingredient.lowStockThreshold).toBe(50);
        expect(ingredient.isActive).toBe(true);
      }
    });

    it('should create ingredients with prices in paise (OD-19)', async () => {
      await seedDatabase();

      const thinCrust = await Ingredient.findOne({ name: 'Thin Crust' });
      expect(thinCrust.pricePaise).toBe(15000); // ₹150

      const mozzarella = await Ingredient.findOne({ name: 'Mozzarella' });
      expect(mozzarella.pricePaise).toBe(15000); // ₹150

      const bellPeppers = await Ingredient.findOne({ name: 'Bell Peppers' });
      expect(bellPeppers.pricePaise).toBe(7000); // ₹70
    });

    it('should create ingredients with unique names', async () => {
      await seedDatabase();

      const names = await Ingredient.distinct('name');
      const ingredients = await Ingredient.find({});

      expect(names.length).toBe(ingredients.length);
    });
  });

  describe('Pizza Preset Seeding', () => {
    it('should seed 4 vegetarian pizza presets', async () => {
      await seedDatabase();

      const totalCount = await Pizza.countDocuments();
      expect(totalCount).toBe(4);

      const vegetarianCount = await Pizza.countDocuments({ category: 'vegetarian' });
      expect(vegetarianCount).toBe(4);
    });

    it('should create pizzas with valid ingredient references', async () => {
      await seedDatabase();

      const pizzas = await Pizza.find({}).populate('ingredients.base ingredients.sauce ingredients.cheese');

      for (const pizza of pizzas) {
        expect(pizza.ingredients.base).toBeDefined();
        expect(pizza.ingredients.base.category).toBe('base');

        expect(pizza.ingredients.sauce).toBeDefined();
        expect(pizza.ingredients.sauce.category).toBe('sauce');

        expect(pizza.ingredients.cheese).toBeDefined();
        expect(pizza.ingredients.cheese.category).toBe('cheese');
      }
    });

    it('should create Margherita Classic with correct composition and price ₹440', async () => {
      await seedDatabase();

      const margherita = await Pizza.findOne({ name: 'Margherita Classic' });
      expect(margherita).toBeDefined();
      expect(margherita.category).toBe('vegetarian');
      expect(margherita.description).toContain('Classic Italian');

      const price = await margherita.calculatePrice();
      // Thin Crust (15000) + Classic Tomato (8000) + Mozzarella (15000) + Tomatoes (6000) = 44000 paise = ₹440
      expect(price).toBe(44000);
    });

    it('should create Veggie Supreme with correct composition and price ₹700', async () => {
      await seedDatabase();

      const veggie = await Pizza.findOne({ name: 'Veggie Supreme' });
      expect(veggie).toBeDefined();
      expect(veggie.ingredients.vegetables).toHaveLength(4);

      const price = await veggie.calculatePrice();
      // Thick Crust (18000) + Classic Tomato (8000) + Mozzarella (15000)
      // + Bell Peppers (7000) + Onions (5000) + Mushrooms (8000) + Olives (9000) = 70000 paise = ₹700
      expect(price).toBe(70000);
    });

    it('should create Mediterranean with correct composition and price ₹650', async () => {
      await seedDatabase();

      const mediterranean = await Pizza.findOne({ name: 'Mediterranean' });
      expect(mediterranean).toBeDefined();
      expect(mediterranean.ingredients.vegetables).toHaveLength(3);

      const price = await mediterranean.calculatePrice();
      // Thin Crust (15000) + White Garlic (10000) + Parmesan (18000)
      // + Spinach (7000) + Olives (9000) + Tomatoes (6000) = 65000 paise = ₹650
      expect(price).toBe(65000);
    });

    it('should create Spicy Veggie with correct composition and price ₹575', async () => {
      await seedDatabase();

      const spicy = await Pizza.findOne({ name: 'Spicy Veggie' });
      expect(spicy).toBeDefined();
      expect(spicy.ingredients.vegetables).toHaveLength(3);

      const price = await spicy.calculatePrice();
      // Whole Wheat (16000) + Spicy Marinara (9000) + Cheddar (13000)
      // + Jalapeños (7500) + Onions (5000) + Bell Peppers (7000) = 57500 paise = ₹575
      expect(price).toBe(57500);
    });
  });

  describe('Idempotent Seeding', () => {
    it('should not create duplicates when run twice', async () => {
      // First run
      const firstResult = await seedDatabase();
      expect(firstResult.success).toBe(true);
      expect(firstResult.ingredientResults.created).toBe(21);
      expect(firstResult.pizzaResults.created).toBe(4);

      const firstIngredientCount = await Ingredient.countDocuments();
      const firstPizzaCount = await Pizza.countDocuments();

      // Second run
      const secondResult = await seedDatabase();
      expect(secondResult.success).toBe(true);
      expect(secondResult.ingredientResults.created).toBe(0);
      expect(secondResult.ingredientResults.existing).toBe(21);
      expect(secondResult.pizzaResults.created).toBe(0);
      expect(secondResult.pizzaResults.existing).toBe(4);

      const secondIngredientCount = await Ingredient.countDocuments();
      const secondPizzaCount = await Pizza.countDocuments();

      expect(firstIngredientCount).toBe(secondIngredientCount);
      expect(firstPizzaCount).toBe(secondPizzaCount);
    });

    it('should preserve existing stock and prices on rerun', async () => {
      // First run
      await seedDatabase();

      // Modify an ingredient
      const thinCrust = await Ingredient.findOne({ name: 'Thin Crust' });
      const originalPrice = thinCrust.pricePaise;
      thinCrust.stock = 500;
      thinCrust.pricePaise = 20000;
      await thinCrust.save();

      // Second run
      await seedDatabase();

      // Check that modifications were preserved
      const modifiedThinCrust = await Ingredient.findOne({ name: 'Thin Crust' });
      expect(modifiedThinCrust.stock).toBe(500); // Preserved
      expect(modifiedThinCrust.pricePaise).toBe(20000); // Preserved
      expect(modifiedThinCrust.pricePaise).not.toBe(originalPrice);
    });

    it('should complete partial seeding and recover on retry', async () => {
      // Seed only ingredients
      const thinCrust = await Ingredient.create({
        name: 'Thin Crust',
        category: 'base',
        pricePaise: 15000,
        stock: 1000,
        reserved: 0,
        lowStockThreshold: 50,
      });

      expect(await Ingredient.countDocuments()).toBe(1);
      expect(await Pizza.countDocuments()).toBe(0);

      // Run full seeding - should complete
      await seedDatabase();

      expect(await Ingredient.countDocuments()).toBe(21);
      expect(await Pizza.countDocuments()).toBe(4);

      // Verify original ingredient wasn't duplicated
      const thinCrusts = await Ingredient.find({ name: 'Thin Crust' });
      expect(thinCrusts).toHaveLength(1);
    });

    it('should handle missing ingredients gracefully when seeding pizzas', async () => {
      // Seed only some ingredients (not enough for pizzas)
      await Ingredient.create({
        name: 'Thin Crust',
        category: 'base',
        pricePaise: 15000,
        stock: 1000,
      });

      // Run seeding - should complete ingredients but pizzas will succeed now too
      const result = await seedDatabase();

      // All ingredients should be created (including the pre-existing one)
      expect(await Ingredient.countDocuments()).toBe(21);

      // Pizzas should now succeed because all ingredients exist
      expect(await Pizza.countDocuments()).toBe(4);
      expect(result.success).toBe(true);
    });
  });

  describe('Data Integrity', () => {
    it('should maintain ingredient category constraints', async () => {
      await seedDatabase();

      const bases = await Ingredient.find({ category: 'base' });
      const sauces = await Ingredient.find({ category: 'sauce' });
      const cheeses = await Ingredient.find({ category: 'cheese' });
      const vegetables = await Ingredient.find({ category: 'vegetable' });

      // Check no invalid categories
      expect(bases.every(i => i.category === 'base')).toBe(true);
      expect(sauces.every(i => i.category === 'sauce')).toBe(true);
      expect(cheeses.every(i => i.category === 'cheese')).toBe(true);
      expect(vegetables.every(i => i.category === 'vegetable')).toBe(true);
    });

    it('should create pizzas with all required fields (R-12)', async () => {
      await seedDatabase();

      const pizzas = await Pizza.find({});

      for (const pizza of pizzas) {
        expect(pizza.ingredients.base).toBeDefined();
        expect(pizza.ingredients.sauce).toBeDefined();
        expect(pizza.ingredients.cheese).toBeDefined();
        expect(pizza.name).toBeTruthy();
        expect(pizza.category).toBeTruthy();
        expect(pizza.isActive).toBe(true);
      }
    });

    it('should calculate prices correctly from seeded ingredients', async () => {
      await seedDatabase();

      const pizzas = await Pizza.find({});

      for (const pizza of pizzas) {
        const calculatedPrice = await pizza.calculatePrice();
        expect(calculatedPrice).toBeGreaterThan(0);
        expect(Number.isInteger(calculatedPrice)).toBe(true);

        // All pizzas should have reasonable prices (₹300-₹1000)
        expect(calculatedPrice).toBeGreaterThanOrEqual(30000); // ₹300
        expect(calculatedPrice).toBeLessThanOrEqual(100000); // ₹1000
      }
    });
  });

  describe('Conflict Detection', () => {
    it('should detect and report ingredient category conflicts', async () => {
      // Create an ingredient with wrong category
      await Ingredient.create({
        name: 'Corn',
        category: 'cheese', // Wrong! Should be 'vegetable'
        pricePaise: 6000,
        stock: 1000,
        reserved: 0,
        lowStockThreshold: 50,
      });

      const result = await seedDatabase();

      // Should report conflict
      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts.length).toBeGreaterThan(0);

      const cornConflict = result.conflicts.find(c => c.ingredient === 'Corn');
      expect(cornConflict).toBeDefined();
      expect(cornConflict.existingCategory).toBe('cheese');
      expect(cornConflict.seedCategory).toBe('vegetable');

      // Should NOT overwrite existing data
      const existing = await Ingredient.findOne({ name: 'Corn' });
      expect(existing.category).toBe('cheese'); // Preserved original

      // Other ingredients should seed successfully
      expect(await Ingredient.countDocuments()).toBeGreaterThan(1);
    });

    it('should detect and report pizza recipe conflicts', async () => {
      // First seed to get ingredients
      await seedDatabase();

      // Modify a pizza's recipe
      const margherita = await Pizza.findOne({ name: 'Margherita Classic' });
      const wrongCheese = await Ingredient.findOne({ name: 'Cheddar' });
      margherita.ingredients.cheese = wrongCheese._id; // Wrong! Should be Mozzarella
      await margherita.save();

      // Clear other pizzas to isolate the conflict
      await Pizza.deleteMany({ name: { $ne: 'Margherita Classic' } });

      const result = await seedDatabase();

      // Should report conflict
      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts.length).toBeGreaterThan(0);

      const margheritaConflict = result.conflicts.find(c => c.pizza === 'Margherita Classic');
      expect(margheritaConflict).toBeDefined();
      expect(margheritaConflict.conflicts).toContain('cheese mismatch');

      // Should NOT overwrite existing data
      const existingPizza = await Pizza.findOne({ name: 'Margherita Classic' }).populate('ingredients.cheese');
      expect(existingPizza.ingredients.cheese.name).toBe('Cheddar'); // Preserved
    });

    it('should detect and report pizza category conflicts', async () => {
      // First seed to get ingredients
      await seedDatabase();

      // Modify a pizza's category
      const margherita = await Pizza.findOne({ name: 'Margherita Classic' });
      margherita.category = 'vegan'; // Wrong! Should be vegetarian
      await margherita.save();

      // Clear other pizzas
      await Pizza.deleteMany({ name: { $ne: 'Margherita Classic' } });

      const result = await seedDatabase();

      // Should report conflict
      expect(result.success).toBe(false);
      const margheritaConflict = result.conflicts.find(c => c.pizza === 'Margherita Classic');
      expect(margheritaConflict).toBeDefined();
      expect(margheritaConflict.conflicts.some(c => c.includes('category mismatch'))).toBe(true);
    });

    it('should succeed when no conflicts exist', async () => {
      const result = await seedDatabase();

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Production Safety', () => {
    it('should block seeding to production databases', async () => {
      // Temporarily override MONGODB_URI
      const originalUri = process.env.MONGODB_URI;
      process.env.MONGODB_URI = 'mongodb://production-server:27017/sunnys-pizza';

      try {
        // seedDatabase checks the URI without actually connecting
        await expect(seedDatabase()).rejects.toThrow('PRODUCTION SEEDING BLOCKED');
      } finally {
        // Restore original URI
        process.env.MONGODB_URI = originalUri;
      }
    });

    it('should allow seeding to localhost databases', async () => {
      // Current test setup uses localhost, should work
      // Set the env variable explicitly to match the connection
      const testUri = replSet.getUri();
      process.env.MONGODB_URI = testUri;

      const result = await seedDatabase();
      expect(result.success).toBe(true);
    });

    it('should allow seeding to 127.0.0.1 databases', async () => {
      // Save original
      const originalUri = process.env.MONGODB_URI;

      // Create URI with 127.0.0.1
      const currentUri = replSet.getUri();
      const localhostUri = currentUri.replace('localhost', '127.0.0.1');
      process.env.MONGODB_URI = localhostUri;

      await mongoose.disconnect();
      await mongoose.connect(localhostUri);

      try {
        const result = await seedDatabase();
        expect(result.success).toBe(true);
      } finally {
        process.env.MONGODB_URI = originalUri;
        await mongoose.disconnect();
        await mongoose.connect(currentUri);
      }
    });
  });

  describe('Strict Seed Target Safety', () => {
    it('rejects remote hosts even if the database name says localhost', async () => {
      const original = process.env.MONGODB_URI;
      process.env.MONGODB_URI = 'mongodb://remote.example.com/localhost';
      try {
        await expect(seedDatabase()).rejects.toThrow('PRODUCTION SEEDING BLOCKED');
      } finally {
        process.env.MONGODB_URI = original;
      }
    });

    it('rejects a remote host when localhost is in the username', async () => {
      const original = process.env.MONGODB_URI;
      process.env.MONGODB_URI = 'mongodb://localhost@remote.example.com/test';
      try {
        await expect(seedDatabase()).rejects.toThrow('PRODUCTION SEEDING BLOCKED');
      } finally {
        process.env.MONGODB_URI = original;
      }
    });

    it('rejects a URI for the wrong local database', async () => {
      const original = process.env.MONGODB_URI;
      const uri = new URL(replSet.getUri());
      uri.pathname = '/wrong-database';
      process.env.MONGODB_URI = uri.toString();
      try {
        await expect(seedDatabase()).rejects.toThrow('SEED TARGET BLOCKED');
      } finally {
        process.env.MONGODB_URI = original;
      }
    });

    it('rejects a different local port when already connected', async () => {
      const original = process.env.MONGODB_URI;
      const uri = new URL(replSet.getUri());
      uri.port = String(Number(uri.port || 27017) + 1);
      process.env.MONGODB_URI = uri.toString();
      try {
        await expect(seedDatabase()).rejects.toThrow('active MongoDB connection does not match');
      } finally {
        process.env.MONGODB_URI = original;
      }
    });

    it('refuses NODE_ENV=production even with a loopback URI', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(seedDatabase()).rejects.toThrow('PRODUCTION SEEDING BLOCKED');
      } finally {
        if (original === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = original;
      }
    });

    it('requires an explicitly approved DB name outside tests', async () => {
      const originalMode = process.env.NODE_ENV;
      const originalName = process.env.SEED_DB_NAME;
      process.env.NODE_ENV = 'development';
      delete process.env.SEED_DB_NAME;
      try {
        await expect(seedDatabase()).rejects.toThrow('SEED_DB_NAME');
      } finally {
        if (originalMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalMode;
        if (originalName === undefined) delete process.env.SEED_DB_NAME;
        else process.env.SEED_DB_NAME = originalName;
      }
    });
  });

  describe('CLI Execution', () => {
    it('should exit with code 0 on successful seeding via CLI', async () => {
      // Use the test database URI
      const testUri = replSet.getUri();
      const env = { ...process.env, MONGODB_URI: testUri, NODE_ENV: 'test' };

      try {
        const { stdout, stderr } = await execAsync('node server/src/scripts/seedDatabase.js', {
          cwd: process.cwd(),
          env,
          timeout: 30000,
        });

        // Should complete successfully
        expect(stdout).toContain('Seeding Complete');
        expect(stdout).toContain('Done.');
      } catch (error) {
        // If command failed, test should fail
        throw new Error(`CLI execution failed: ${error.message}\nstdout: ${error.stdout}\nstderr: ${error.stderr}`);
      }
    }, 35000);

    it('should exit with code 1 when conflicts exist', async () => {
      // Create a conflicting ingredient first (use one not critical to pizza seeding)
      await Ingredient.create({
        name: 'Corn',
        category: 'cheese', // Wrong category
        pricePaise: 6000,
        stock: 1000,
      });

      const testUri = replSet.getUri();
      const env = { ...process.env, MONGODB_URI: testUri, NODE_ENV: 'test' };

      try {
        await execAsync('node server/src/scripts/seedDatabase.js', {
          cwd: process.cwd(),
          env,
          timeout: 30000,
        });

        // Should not reach here - command should fail
        throw new Error('Expected CLI to exit with non-zero code due to conflicts');
      } catch (error) {
        // Expect non-zero exit code
        expect(error.code).toBe(1);
        const output = error.stderr || error.stdout;
        expect(output).toContain('Category mismatch');
      }
    }, 35000);

    it('should exit with code 1 when production database is targeted', async () => {
      // Use test NODE_ENV to pass env.js validation, but with production URI
      const env = {
        ...process.env,
        MONGODB_URI: 'mongodb://production-server:27017/sunnys-pizza',
        NODE_ENV: 'test',
        // Provide required test-mode defaults to pass env validation
        CLIENT_URL: 'http://localhost:5173',
        JWT_SECRET: 'test-jwt-secret-minimum-32-characters-long-for-validation',
        CSRF_SECRET: 'test-csrf-secret-minimum-32-characters-long'
      };

      try {
        await execAsync('node server/src/scripts/seedDatabase.js', {
          cwd: process.cwd(),
          env,
          timeout: 30000,
        });

        throw new Error('Expected CLI to block production seeding');
      } catch (error) {
        expect(error.code).toBe(1);
        const output = error.stderr || error.stdout;
        expect(output).toContain('PRODUCTION SEEDING BLOCKED');
      }
    }, 35000);
  });

  describe('Specific Ingredient Verification', () => {
    it('should seed all expected base varieties', async () => {
      await seedDatabase();

      const expectedBases = ['Thin Crust', 'Thick Crust', 'Stuffed Crust', 'Gluten-Free', 'Whole Wheat'];

      for (const baseName of expectedBases) {
        const base = await Ingredient.findOne({ name: baseName, category: 'base' });
        expect(base).toBeDefined();
        expect(base.pricePaise).toBeGreaterThan(0);
      }
    });

    it('should seed all expected sauce varieties', async () => {
      await seedDatabase();

      const expectedSauces = ['Classic Tomato', 'Pesto', 'White Garlic', 'BBQ', 'Spicy Marinara'];

      for (const sauceName of expectedSauces) {
        const sauce = await Ingredient.findOne({ name: sauceName, category: 'sauce' });
        expect(sauce).toBeDefined();
        expect(sauce.pricePaise).toBeGreaterThan(0);
      }
    });

    it('should seed all expected cheese varieties', async () => {
      await seedDatabase();

      const expectedCheeses = ['Mozzarella', 'Cheddar', 'Parmesan'];

      for (const cheeseName of expectedCheeses) {
        const cheese = await Ingredient.findOne({ name: cheeseName, category: 'cheese' });
        expect(cheese).toBeDefined();
        expect(cheese.pricePaise).toBeGreaterThan(0);
      }
    });

    it('should seed all expected vegetable varieties', async () => {
      await seedDatabase();

      const expectedVegetables = ['Bell Peppers', 'Onions', 'Mushrooms', 'Olives', 'Tomatoes', 'Jalapeños', 'Spinach', 'Corn'];

      for (const vegName of expectedVegetables) {
        const vegetable = await Ingredient.findOne({ name: vegName, category: 'vegetable' });
        expect(vegetable).toBeDefined();
        expect(vegetable.pricePaise).toBeGreaterThan(0);
      }
    });
  });
});