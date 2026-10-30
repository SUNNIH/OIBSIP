import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../server/src/app.js';
import User from '../../server/src/models/User.js';
import Ingredient from '../../server/src/models/Ingredient.js';
import Pizza from '../../server/src/models/Pizza.js';

describe('Catalogue API - Phase 3 Task 3.3', () => {
  let replSet;
  let agent;
  let csrfToken;
  let testIngredients;
  let testPizzas;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Create and verify a customer user
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'password123',
      role: 'customer',
      isVerified: true,
    });

    // Create agent for persistent cookies
    agent = request.agent(app);

    // Get CSRF session by making a request
    await agent.get('/api/auth/csrf-token');

    // Get CSRF token
    const csrfRes = await agent.get('/api/auth/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    // Login to get authentication cookie
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'customer@test.com', password: 'password123' })
      .expect(200);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    // Clear and seed test data
    await Ingredient.deleteMany({});
    await Pizza.deleteMany({});

    // Create test ingredients
    const thinCrust = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 15000,
      stock: 100,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true,
    });

    const tomato = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 8000,
      stock: 100,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true,
    });

    const mozzarella = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 15000,
      stock: 100,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true,
    });

    const mushrooms = await Ingredient.create({
      name: 'Mushrooms',
      category: 'vegetable',
      pricePaise: 8000,
      stock: 100,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true,
    });

    const onions = await Ingredient.create({
      name: 'Onions',
      category: 'vegetable',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true,
    });

    // Create an inactive ingredient (should not appear in catalogue)
    await Ingredient.create({
      name: 'Discontinued Base',
      category: 'base',
      pricePaise: 20000,
      stock: 0,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: false,
    });

    // Create an out-of-stock ingredient
    await Ingredient.create({
      name: 'Out of Stock Veggie',
      category: 'vegetable',
      pricePaise: 7000,
      stock: 10,
      reserved: 10, // All stock reserved
      lowStockThreshold: 10,
      isActive: true,
    });

    testIngredients = {
      thinCrust,
      tomato,
      mozzarella,
      mushrooms,
      onions,
    };

    // Create test pizzas
    const margherita = await Pizza.create({
      name: 'Margherita',
      description: 'Classic margherita pizza',
      category: 'vegetarian',
      ingredients: {
        base: thinCrust._id,
        sauce: tomato._id,
        cheese: mozzarella._id,
        vegetables: [],
      },
      isActive: true,
    });

    const veggie = await Pizza.create({
      name: 'Veggie Supreme',
      description: 'Loaded with vegetables',
      category: 'vegetarian',
      ingredients: {
        base: thinCrust._id,
        sauce: tomato._id,
        cheese: mozzarella._id,
        vegetables: [mushrooms._id, onions._id],
      },
      isActive: true,
    });

    // Create inactive pizza (should not appear)
    await Pizza.create({
      name: 'Discontinued Pizza',
      description: 'No longer available',
      category: 'vegetarian',
      ingredients: {
        base: thinCrust._id,
        sauce: tomato._id,
        cheese: mozzarella._id,
        vegetables: [],
      },
      isActive: false,
    });

    testPizzas = { margherita, veggie };
  });

  describe('GET /api/v1/ingredients', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/v1/ingredients')
        .expect(401);

      expect(res.body.error).toBe('Authentication required');
    });

    it('should return active ingredients grouped by category', async () => {
      const res = await agent
        .get('/api/v1/ingredients')
        .expect(200);

      expect(res.body).toHaveProperty('base');
      expect(res.body).toHaveProperty('sauce');
      expect(res.body).toHaveProperty('cheese');
      expect(res.body).toHaveProperty('vegetable');

      // Check structure
      expect(res.body.base).toHaveLength(1);
      expect(res.body.base[0]).toMatchObject({
        name: 'Thin Crust',
        category: 'base',
        pricePaise: 15000,
        inStock: true,
      });
      expect(res.body.base[0]).toHaveProperty('id');
    });

    it('should not expose exact stock or reserved quantities', async () => {
      const res = await agent
        .get('/api/v1/ingredients')
        .expect(200);

      const allIngredients = [
        ...res.body.base,
        ...res.body.sauce,
        ...res.body.cheese,
        ...res.body.vegetable,
      ];

      for (const ing of allIngredients) {
        expect(ing).not.toHaveProperty('stock');
        expect(ing).not.toHaveProperty('reserved');
        expect(ing).toHaveProperty('inStock');
      }
    });

    it('should show inStock=false for out-of-stock ingredients', async () => {
      const res = await agent
        .get('/api/v1/ingredients')
        .expect(200);

      const outOfStockVeggie = res.body.vegetable.find(
        v => v.name === 'Out of Stock Veggie'
      );

      expect(outOfStockVeggie).toBeDefined();
      expect(outOfStockVeggie.inStock).toBe(false);
    });

    it('should not include inactive ingredients', async () => {
      const res = await agent
        .get('/api/v1/ingredients')
        .expect(200);

      const allIngredients = [
        ...res.body.base,
        ...res.body.sauce,
        ...res.body.cheese,
        ...res.body.vegetable,
      ];

      const hasDiscontinued = allIngredients.some(
        ing => ing.name === 'Discontinued Base'
      );

      expect(hasDiscontinued).toBe(false);
    });

    it('should return correct vegetable count', async () => {
      const res = await agent
        .get('/api/v1/ingredients')
        .expect(200);

      // 2 active vegetables + 1 out-of-stock but active
      expect(res.body.vegetable.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/v1/pizzas', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/v1/pizzas')
        .expect(401);

      expect(res.body.error).toBe('Authentication required');
    });

    it('should return active pizzas with computed prices', async () => {
      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      const margherita = res.body.find(p => p.name === 'Margherita');
      expect(margherita).toBeDefined();
      expect(margherita.pricePaise).toBe(38000); // 15000 + 8000 + 15000
      expect(margherita).toHaveProperty('available');
      expect(margherita).toHaveProperty('ingredients');
    });

    it('should calculate correct price for pizza with vegetables', async () => {
      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      const veggie = res.body.find(p => p.name === 'Veggie Supreme');
      expect(veggie).toBeDefined();
      // 15000 + 8000 + 15000 + 8000 + 5000 = 51000
      expect(veggie.pricePaise).toBe(51000);
      expect(veggie.ingredients.vegetables).toHaveLength(2);
    });

    it('should include ingredient details but not stock quantities', async () => {
      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      const pizza = res.body[0];
      expect(pizza.ingredients.base).toHaveProperty('id');
      expect(pizza.ingredients.base).toHaveProperty('name');
      expect(pizza.ingredients.base).not.toHaveProperty('stock');
      expect(pizza.ingredients.base).not.toHaveProperty('reserved');
    });

    it('should not include inactive pizzas', async () => {
      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      const hasDiscontinued = res.body.some(
        p => p.name === 'Discontinued Pizza'
      );

      expect(hasDiscontinued).toBe(false);
    });

    it('should return pizzas with availability status', async () => {
      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      for (const pizza of res.body) {
        expect(pizza).toHaveProperty('available');
        expect(typeof pizza.available).toBe('boolean');
      }
    });
  });

  describe('POST /api/v1/orders/quote', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/orders/quote')
        .send({ lines: [] })
        .expect(401);

      expect(res.body.error).toBe('Authentication required');
    });

    it('should require CSRF token', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 1 },
          ],
        })
        .expect(403);

      // csrf-csrf returns error in different formats
      const errorText = res.text.toLowerCase();
      expect(errorText).toContain('csrf');
    });

    it('should quote preset pizza by ID', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 2 },
          ],
        })
        .expect(200);

      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0]).toMatchObject({
        pizzaId: testPizzas.margherita._id.toString(),
        pizzaName: 'Margherita',
        quantity: 2,
        unitPricePaise: 38000,
        lineTotalPaise: 76000,
      });
      expect(res.body.totalPaise).toBe(76000);
    });

    it('should quote custom pizza by recipe', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.thinCrust._id.toString(),
                sauce: testIngredients.tomato._id.toString(),
                cheese: testIngredients.mozzarella._id.toString(),
                vegetables: [testIngredients.mushrooms._id.toString()],
              },
              quantity: 1,
            },
          ],
        })
        .expect(200);

      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0]).toMatchObject({
        pizzaName: 'Custom Pizza',
        quantity: 1,
        unitPricePaise: 46000, // 15000 + 8000 + 15000 + 8000
        lineTotalPaise: 46000,
      });
      expect(res.body.totalPaise).toBe(46000);
    });

    it('should handle multi-line orders', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 2 },
            { pizzaId: testPizzas.veggie._id.toString(), quantity: 1 },
          ],
        })
        .expect(200);

      expect(res.body.lines).toHaveLength(2);
      expect(res.body.totalPaise).toBe(127000); // (38000 * 2) + 51000
    });

    it('should reject invalid pizza ID', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: '507f1f77bcf86cd799439011', quantity: 1 },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_PIZZA');
    });

    it('should reject inactive pizza', async () => {
      const inactivePizza = await Pizza.create({
        name: 'Temporarily Inactive',
        description: 'Test',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.thinCrust._id,
          sauce: testIngredients.tomato._id,
          cheese: testIngredients.mozzarella._id,
          vegetables: [],
        },
        isActive: false,
      });

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [{ pizzaId: inactivePizza._id.toString(), quantity: 1 }],
        })
        .expect(400);

      expect(res.body.error.code).toBe('PIZZA_NOT_AVAILABLE');
    });

    it('should reject missing ingredient in recipe', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: '507f1f77bcf86cd799439011',
                sauce: testIngredients.tomato._id.toString(),
                cheese: testIngredients.mozzarella._id.toString(),
                vegetables: [],
              },
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_INGREDIENT');
    });

    it('should reject wrong ingredient categories', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.tomato._id.toString(), // Wrong! This is a sauce
                sauce: testIngredients.tomato._id.toString(),
                cheese: testIngredients.mozzarella._id.toString(),
                vegetables: [],
              },
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_CATEGORY');
    });

    it('should reject inactive ingredients in recipe', async () => {
      const inactiveIng = await Ingredient.create({
        name: 'Inactive Sauce',
        category: 'sauce',
        pricePaise: 10000,
        stock: 100,
        isActive: false,
      });

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.thinCrust._id.toString(),
                sauce: inactiveIng._id.toString(),
                cheese: testIngredients.mozzarella._id.toString(),
                vegetables: [],
              },
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INGREDIENT_NOT_AVAILABLE');
    });

    it('should require at least one line item', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({ lines: [] })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require positive quantity', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 0 },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should calculate server-side prices ignoring any client-supplied values', async () => {
      // Even if client sends a price, server must recalculate
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              pizzaId: testPizzas.margherita._id.toString(),
              quantity: 1,
              tamperedPricePaise: 1, // Attempting to tamper
            },
          ],
        })
        .expect(200);

      // Server should calculate correct price, ignoring tampering
      expect(res.body.lines[0].unitPricePaise).toBe(38000);
      expect(res.body.totalPaise).toBe(38000);
    });

    it('should allow custom pizza with no vegetables (OD-25)', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.thinCrust._id.toString(),
                sauce: testIngredients.tomato._id.toString(),
                cheese: testIngredients.mozzarella._id.toString(),
                vegetables: [],
              },
              quantity: 1,
            },
          ],
        })
        .expect(200);

      expect(res.body.lines[0].unitPricePaise).toBe(38000);
    });
  });

  describe('Price Calculation Integrity (R-26)', () => {
    it('should always use integer pricePaise values', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.veggie._id.toString(), quantity: 3 },
          ],
        })
        .expect(200);

      expect(Number.isInteger(res.body.totalPaise)).toBe(true);
      expect(Number.isInteger(res.body.lines[0].unitPricePaise)).toBe(true);
      expect(Number.isInteger(res.body.lines[0].lineTotalPaise)).toBe(true);
    });

    it('should recalculate prices from current ingredient data', async () => {
      // Get initial quote
      const initialRes = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 1 },
          ],
        })
        .expect(200);

      const initialPrice = initialRes.body.totalPaise;

      // Update ingredient price
      await Ingredient.findByIdAndUpdate(testIngredients.thinCrust._id, {
        pricePaise: 20000, // Increased from 15000
      });

      // Get new quote - should reflect new price
      const updatedRes = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 1 },
          ],
        })
        .expect(200);

      expect(updatedRes.body.totalPaise).toBe(initialPrice + 5000);
    });
  });
});
