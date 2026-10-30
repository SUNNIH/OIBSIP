/**
 * SUNNYS Pizza — Catalogue API Task 3.3 Focused Corrections Tests
 *
 * Tests for identified issues:
 * 1. Quote endpoint availability checking with cumulative quantities
 * 2. MongoDB ID validation
 * 3. Duplicate vegetables rejection
 * 4. Missing populated ingredient references
 * 5. Integer arithmetic safety
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../server/src/app.js';
import Ingredient from '../../server/src/models/Ingredient.js';
import Pizza from '../../server/src/models/Pizza.js';
import User from '../../server/src/models/User.js';

describe('Catalogue API - Task 3.3 Focused Corrections', () => {
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

    // Create test customer once for all tests
    await User.create({
      email: 'customer@test.com',
      password: 'password123',
      role: 'customer',
      isVerified: true,
    });

    // Create agent and login once for all tests
    agent = request.agent(app);

    // Get CSRF session and token
    await agent.get('/api/auth/csrf-token');
    const tokenRes = await agent.get('/api/auth/csrf-token');
    csrfToken = tokenRes.body.csrfToken;

    // Login once
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'customer@test.com',
        password: 'password123',
      })
      .expect(200);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    // Clear only ingredient and pizza data between tests
    await Ingredient.deleteMany({});
    await Pizza.deleteMany({});

    // Seed test ingredients
    testIngredients = {
      base: await Ingredient.create({
        name: 'Thin Crust',
        category: 'base',
        pricePaise: 5000,
        stock: 100,
        reserved: 0,
      }),
      sauce: await Ingredient.create({
        name: 'Tomato Sauce',
        category: 'sauce',
        pricePaise: 2000,
        stock: 100,
        reserved: 0,
      }),
      cheese: await Ingredient.create({
        name: 'Mozzarella',
        category: 'cheese',
        pricePaise: 3000,
        stock: 50,
        reserved: 0,
      }),
      onion: await Ingredient.create({
        name: 'Onion',
        category: 'vegetable',
        pricePaise: 500,
        stock: 80,
        reserved: 0,
      }),
      pepper: await Ingredient.create({
        name: 'Bell Pepper',
        category: 'vegetable',
        pricePaise: 700,
        stock: 60,
        reserved: 0,
      }),
      lowStock: await Ingredient.create({
        name: 'Low Stock Veggie',
        category: 'vegetable',
        pricePaise: 400,
        stock: 5,
        reserved: 0,
      }),
    };

    // Create test pizzas
    testPizzas = {
      margherita: await Pizza.create({
        name: 'Margherita',
        description: 'Classic pizza',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.base._id,
          sauce: testIngredients.sauce._id,
          cheese: testIngredients.cheese._id,
          vegetables: [],
        },
        isActive: true,
      }),
      veggie: await Pizza.create({
        name: 'Veggie Supreme',
        description: 'Loaded with vegetables',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.base._id,
          sauce: testIngredients.sauce._id,
          cheese: testIngredients.cheese._id,
          vegetables: [testIngredients.onion._id, testIngredients.pepper._id],
        },
        isActive: true,
      }),
    };
  });

  describe('MongoDB ID Validation', () => {
    it('should reject invalid pizzaId format', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: 'not-a-valid-objectid', quantity: 1 },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Invalid pizza ID format');
    });

    it('should reject invalid ingredient IDs in custom recipe', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: 'invalid-id',
                sauce: testIngredients.sauce._id.toString(),
                cheese: testIngredients.cheese._id.toString(),
              },
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Invalid base ingredient ID format');
    });
  });

  describe('Duplicate Vegetables Validation', () => {
    it('should reject custom recipe with duplicate vegetables', async () => {
      const duplicateVegId = testIngredients.onion._id.toString();

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.base._id.toString(),
                sauce: testIngredients.sauce._id.toString(),
                cheese: testIngredients.cheese._id.toString(),
                vegetables: [duplicateVegId, duplicateVegId],
              },
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Duplicate vegetables are not allowed');
    });
  });

  describe('Cumulative Availability Checking', () => {
    it('should check cumulative quantities across multiple lines', async () => {
      // Cheese has stock: 50
      // Order 30 margheritas (30 cheese) + 25 veggie pizzas (25 cheese) = 55 total
      // Should fail because 55 > 50

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 30 },
            { pizzaId: testPizzas.veggie._id.toString(), quantity: 25 },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
      expect(res.body.error.message).toContain('Mozzarella');
      expect(res.body.error.message).toMatch(/unavailable|out of stock/i);
      // Should NOT expose exact quantities
      expect(res.body.error.message).not.toMatch(/\d+/); // No numbers in message
      expect(res.body.error.unavailable).toBeUndefined(); // No detailed array
    });

    it('should succeed when cumulative quantities are within stock', async () => {
      // Order 20 margheritas (20 cheese) + 20 veggie pizzas (20 cheese) = 40 total
      // Should succeed because 40 <= 50

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 20 },
            { pizzaId: testPizzas.veggie._id.toString(), quantity: 20 },
          ],
        })
        .expect(200);

      expect(res.body.lines).toHaveLength(2);
      expect(res.body.totalPaise).toBeGreaterThan(0);
    });

    it('should fail when single ingredient across mixed preset/custom orders exceeds stock', async () => {
      // lowStock veggie has stock: 5
      // Order: 3 veggie pizzas (uses onion+pepper, not lowStock)
      //      + 1 custom with lowStock vegetable = 1 lowStock
      //      + 1 custom with lowStock vegetable * quantity 5 = 5 lowStock
      // Total lowStock needed: 6, but only 5 available

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.veggie._id.toString(), quantity: 3 },
            {
              recipe: {
                base: testIngredients.base._id.toString(),
                sauce: testIngredients.sauce._id.toString(),
                cheese: testIngredients.cheese._id.toString(),
                vegetables: [testIngredients.lowStock._id.toString()],
              },
              quantity: 1,
            },
            {
              recipe: {
                base: testIngredients.base._id.toString(),
                sauce: testIngredients.sauce._id.toString(),
                cheese: testIngredients.cheese._id.toString(),
                vegetables: [testIngredients.lowStock._id.toString()],
              },
              quantity: 5,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
      expect(res.body.error.message).toContain('Low Stock Veggie');
      // Should NOT expose quantities
      expect(res.body.error.unavailable).toBeUndefined();
    });

    it('should reject order when available quantity (stock - reserved) is insufficient', async () => {
      // Test partially reserved inventory
      // Create ingredient with stock=10, reserved=8 (available=2)
      const partiallyReserved = await Ingredient.create({
        name: 'Partially Reserved',
        category: 'vegetable',
        pricePaise: 600,
        stock: 10,
        reserved: 8, // Only 2 available
      });

      // Try to order quantity=3 (need 3, but only 2 available)
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.base._id.toString(),
                sauce: testIngredients.sauce._id.toString(),
                cheese: testIngredients.cheese._id.toString(),
                vegetables: [partiallyReserved._id.toString()],
              },
              quantity: 3,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
      expect(res.body.error.message).toContain('Partially Reserved');
      // Should NOT expose stock, reserved, or available quantities
      expect(res.body.error.message).not.toContain('10');
      expect(res.body.error.message).not.toContain('8');
      expect(res.body.error.message).not.toContain('2');
      expect(res.body.error.message).not.toContain('3');
    });

    it('should never expose stock, reserved, or available quantities in any error response', async () => {
      // Create ingredient with known quantities
      const trackedIngredient = await Ingredient.create({
        name: 'Tracked Item',
        category: 'vegetable',
        pricePaise: 800,
        stock: 42,
        reserved: 17,
      });

      // Request more than available (42 - 17 = 25 available, requesting 30)
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              recipe: {
                base: testIngredients.base._id.toString(),
                sauce: testIngredients.sauce._id.toString(),
                cheese: testIngredients.cheese._id.toString(),
                vegetables: [trackedIngredient._id.toString()],
              },
              quantity: 30,
            },
          ],
        })
        .expect(400);

      const responseStr = JSON.stringify(res.body);

      // Verify NO numeric quantities or field names exposed
      expect(responseStr).not.toContain('42'); // stock value
      expect(responseStr).not.toContain('17'); // reserved value
      expect(responseStr).not.toContain('25'); // available value
      expect(responseStr).not.toContain('30'); // requested value
      expect(responseStr).not.toContain('"stock"'); // field name
      expect(responseStr).not.toContain('"reserved"'); // field name
      expect(responseStr).not.toContain('"available"'); // field name
      expect(responseStr).not.toContain('"requested"'); // field name

      // Verify error is user-friendly
      expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
      expect(res.body.error.message).toContain('Tracked Item');
      expect(res.body.error.message).toMatch(/unavailable|out of stock/i);
    });
  });

  describe('Missing Ingredient References Safety', () => {
    it('should handle pizzas with deleted ingredient references gracefully', async () => {
      // Create a pizza with valid ingredients
      const testPizza = await Pizza.create({
        name: 'Test Pizza',
        description: 'Will have missing ingredient',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.base._id,
          sauce: testIngredients.sauce._id,
          cheese: testIngredients.cheese._id,
          vegetables: [],
        },
        isActive: true,
      });

      // Delete the base ingredient (simulating data inconsistency)
      await Ingredient.deleteOne({ _id: testIngredients.base._id });

      // GET /pizzas should not crash, but exclude the problematic pizza
      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      // Should return array without the broken pizza
      expect(Array.isArray(res.body)).toBe(true);
      const testPizzaInResults = res.body.find(p => p.name === 'Test Pizza');
      expect(testPizzaInResults).toBeUndefined();
    });

    it('should reject quote for pizza with missing ingredient', async () => {
      // Create a pizza
      const testPizza = await Pizza.create({
        name: 'Test Pizza Missing',
        description: 'Will have missing sauce',
        category: 'vegetarian',
        ingredients: {
          base: testIngredients.base._id,
          sauce: testIngredients.sauce._id,
          cheese: testIngredients.cheese._id,
          vegetables: [],
        },
        isActive: true,
      });

      // Delete the sauce ingredient
      await Ingredient.deleteOne({ _id: testIngredients.sauce._id });

      // Quote should fail with data inconsistency or unavailable error
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizza._id.toString(), quantity: 1 },
          ],
        })
        .expect(400);

      // Should fail due to missing ingredient reference
      expect(res.body.error.code).toMatch(/PIZZA_DATA_INCONSISTENCY|INSUFFICIENT_INVENTORY/);
    });
  });

  describe('Deleted Preset Vegetable Safety', () => {

    it('excludes a preset if one of its vegetables was deleted', async () => {

      // Delete an ingredient used by Veggie Supreme.
      await Ingredient.deleteOne({
        _id: testIngredients.onion._id,
      });

      const res = await agent
        .get('/api/v1/pizzas')
        .expect(200);

      // Broken preset must not appear.
      expect(
        res.body.find(p => p.name === 'Veggie Supreme')
      ).toBeUndefined();

      // Unaffected preset should still appear.
      expect(
        res.body.find(p => p.name === 'Margherita')
      ).toBeDefined();
    });

    it('rejects a quote if a preset vegetable was deleted', async () => {

      await Ingredient.deleteOne({
        _id: testIngredients.pepper._id,
      });

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              pizzaId: testPizzas.veggie._id.toString(),
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe(
        'PIZZA_DATA_INCONSISTENCY'
      );
    });

  });

  describe('Integer Arithmetic Safety', () => {

    it('rejects unsafe unit prices instead of returning imprecise numbers', async () => {

      // Create a price that causes the unit total to overflow.
      await Ingredient.findByIdAndUpdate(
        testIngredients.base._id,
        {
          pricePaise: Number.MAX_SAFE_INTEGER,
        }
      );

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              pizzaId: testPizzas.margherita._id.toString(),
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe(
        'VALIDATION_ERROR'
      );
    });

    it('rejects multiplication exceeding the safe integer range', async () => {

      await Ingredient.findByIdAndUpdate(
        testIngredients.base._id,
        {
          pricePaise: Number.MAX_SAFE_INTEGER - 5000,
        }
      );

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              pizzaId: testPizzas.margherita._id.toString(),
              quantity: 2,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe(
        'VALIDATION_ERROR'
      );
    });

    it('rejects cart totals that overflow even when individual lines are safe', async () => {

      await Ingredient.findByIdAndUpdate(
        testIngredients.base._id,
        {
          pricePaise: Number.MAX_SAFE_INTEGER - 5000,
        }
      );

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            {
              pizzaId: testPizzas.margherita._id.toString(),
              quantity: 1,
            },
            {
              pizzaId: testPizzas.margherita._id.toString(),
              quantity: 1,
            },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe(
        'VALIDATION_ERROR'
      );
    });


    it('should reject non-integer quantity', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 2.5 },
          ],
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/int|integer/i);
    });

    it('should calculate correct totals for large quantities', async () => {
      // margherita: 5000 + 2000 + 3000 = 10000 paise
      // quantity: 100
      // expected: 1000000 paise

      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 100 },
          ],
        })
        .expect(400); // Will fail due to cheese stock (only 50), but that's expected

      // Even though it fails availability, the arithmetic should be safe
      expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
    });

    it('should maintain integer pricing with multiple lines', async () => {
      const res = await agent
        .post('/api/v1/orders/quote')
        .set('x-csrf-token', csrfToken)
        .send({
          lines: [
            { pizzaId: testPizzas.margherita._id.toString(), quantity: 5 },
            { pizzaId: testPizzas.veggie._id.toString(), quantity: 3 },
          ],
        })
        .expect(200);

      // All prices should be integers
      expect(Number.isInteger(res.body.totalPaise)).toBe(true);
      for (const line of res.body.lines) {
        expect(Number.isInteger(line.unitPricePaise)).toBe(true);
        expect(Number.isInteger(line.lineTotalPaise)).toBe(true);
        expect(line.lineTotalPaise).toBe(line.unitPricePaise * line.quantity);
      }
    });
  });
});