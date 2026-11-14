/**
 * SUNNYS Pizza — Order Creation Integration Tests
 * Phase 4, Task 4.3: Order Creation and Idempotency
 *
 * Tests authenticated customer order creation with:
 * - Client-supplied Idempotency-Key header
 * - Customer-scoped idempotency uniqueness
 * - Server-side pricing calculations
 * - Atomic inventory reservations
 * - Comprehensive validation
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach
} from 'vitest';

import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import app from '../../server/src/app.js';
import User from '../../server/src/models/User.js';
import Ingredient from '../../server/src/models/Ingredient.js';
import Pizza from '../../server/src/models/Pizza.js';
import Order from '../../server/src/models/Order.js';

let mongoServer;

let testCustomer1;
let testCustomer2;

let agent1;
let agent2;

let csrfToken1;
let csrfToken2;

let concurrentAgents;
let concurrentCsrfTokens;

let baseIngredient;
let sauceIngredient;
let cheeseIngredient;
let vegetableIngredient;
let presetPizza;

beforeAll(async () => {
  // Start MongoDB replica set for transactions
  mongoServer = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger'
    }
  });

  const uri = mongoServer.getUri();

  await mongoose.connect(uri);

  // Create test customers
  testCustomer1 = await User.create({
    email: 'customer1@test.com',
    password: 'Password123!',
    role: 'customer',
    isVerified: true
  });

  testCustomer2 = await User.create({
    email: 'customer2@test.com',
    password: 'Password123!',
    role: 'customer',
    isVerified: true
  });

  // Authenticate customer 1
  agent1 = request.agent(app);

  await agent1.get('/api/auth/csrf-token');

  let res = await agent1.get('/api/auth/csrf-token');

  csrfToken1 = res.body.csrfToken;

  await agent1
    .post('/api/auth/login')
    .set('x-csrf-token', csrfToken1)
    .send({
      email: 'customer1@test.com',
      password: 'Password123!'
    });

  // Authenticate customer 2
  agent2 = request.agent(app);

  await agent2.get('/api/auth/csrf-token');

  res = await agent2.get('/api/auth/csrf-token');

  csrfToken2 = res.body.csrfToken;

  await agent2
    .post('/api/auth/login')
    .set('x-csrf-token', csrfToken2)
    .send({
      email: 'customer2@test.com',
      password: 'Password123!'
    });

  // Create independent agents for concurrency tests
  concurrentAgents = [];
  concurrentCsrfTokens = [];

  for (let i = 0; i < 5; i++) {
    const agent = request.agent(app);

    await agent.get('/api/auth/csrf-token');

    const csrfRes = await agent.get(
      '/api/auth/csrf-token'
    );

    const csrfToken = csrfRes.body.csrfToken;

    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'customer1@test.com',
        password: 'Password123!'
      });

    concurrentAgents.push(agent);
    concurrentCsrfTokens.push(csrfToken);
  }

  // Create test ingredients
  baseIngredient = await Ingredient.create({
    name: 'Thin Crust',
    category: 'base',
    pricePaise: 5000,
    stock: 100,
    reserved: 0,
    lowStockThreshold: 10,
    isActive: true
  });

  sauceIngredient = await Ingredient.create({
    name: 'Tomato Sauce',
    category: 'sauce',
    pricePaise: 2000,
    stock: 100,
    reserved: 0,
    lowStockThreshold: 10,
    isActive: true
  });

  cheeseIngredient = await Ingredient.create({
    name: 'Mozzarella',
    category: 'cheese',
    pricePaise: 3000,
    stock: 100,
    reserved: 0,
    lowStockThreshold: 10,
    isActive: true
  });

  vegetableIngredient = await Ingredient.create({
    name: 'Mushrooms',
    category: 'vegetable',
    pricePaise: 1500,
    stock: 100,
    reserved: 0,
    lowStockThreshold: 10,
    isActive: true
  });

  // Create preset pizza
  presetPizza = await Pizza.create({
    name: 'Margherita',
    category: 'vegetarian',

    ingredients: {
      base: baseIngredient._id,
      sauce: sauceIngredient._id,
      cheese: cheeseIngredient._id,
      vegetables: []
    },

    isActive: true
  });

}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Order.deleteMany({});

  // Restore inventory between tests
  await Ingredient.updateMany(
    {},
    {
      $set: {
        stock: 100,
        reserved: 0
      }
    }
  );
});

describe('POST /api/v1/orders — Order Creation', () => {

  describe('Success Paths', () => {

    it('should create order with preset pizza', async () => {
      const idempotencyKey = `test-preset-${Date.now()}`;

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 2
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.orderId).toBeDefined();
      expect(res.body.totalPricePaise).toBe(20000);
      expect(res.body.orderState).toBe('pending_payment');
      expect(res.body.paymentStatus).toBe('pending_gateway');

      expect(
        res.body.reservation.expiresAt
      ).toBeDefined();

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      const sauce = await Ingredient.findById(
        sauceIngredient._id
      );

      const cheese = await Ingredient.findById(
        cheeseIngredient._id
      );

      expect(base.reserved).toBe(2);
      expect(sauce.reserved).toBe(2);
      expect(cheese.reserved).toBe(2);
    });

    it('should create order with custom pizza', async () => {
      const idempotencyKey = `test-custom-${Date.now()}`;

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          lines: [
            {
              customRecipe: {
                base: baseIngredient._id.toString(),
                sauce: sauceIngredient._id.toString(),
                cheese: cheeseIngredient._id.toString(),
                vegetables: [
                  vegetableIngredient._id.toString()
                ]
              },
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.totalPricePaise).toBe(11500);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      const vegetable = await Ingredient.findById(
        vegetableIngredient._id
      );

      expect(base.reserved).toBe(1);
      expect(vegetable.reserved).toBe(1);
    });

    it('should create order with multiple items', async () => {
      const idempotencyKey = `test-multi-${Date.now()}`;

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 2
            },
            {
              customRecipe: {
                base: baseIngredient._id.toString(),
                sauce: sauceIngredient._id.toString(),
                cheese: cheeseIngredient._id.toString(),
                vegetables: [
                  vegetableIngredient._id.toString()
                ]
              },
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.totalPricePaise).toBe(31500);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      const vegetable = await Ingredient.findById(
        vegetableIngredient._id
      );

      expect(base.reserved).toBe(3);
      expect(vegetable.reserved).toBe(1);
    });

    it('should use server-side pricing, ignoring client values', async () => {
      const idempotencyKey = `test-pricing-${Date.now()}`;

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1,
              unitPrice: 999999,
              totalPrice: 999999
            }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.totalPricePaise).toBe(10000);
    });

  });

  describe('Idempotency', () => {

    it('should return existing order for duplicate idempotency key', async () => {
      const idempotencyKey =
        `test-idempotent-${Date.now()}`;

      const payload = {
        lines: [
          {
            pizzaId: presetPizza._id.toString(),
            quantity: 1
          }
        ]
      };

      const res1 = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);

      const firstOrderId = res1.body.orderId;

      const res2 = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.orderId).toBe(firstOrderId);
      expect(res2.body.idempotent).toBe(true);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      expect(base.reserved).toBe(1);
    });

    it('should reject conflicting payload for same idempotency key', async () => {
      const idempotencyKey =
        `test-conflict-${Date.now()}`;

      const res1 = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res1.status).toBe(201);

      const res2 = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 2
            }
          ]
        });

      expect(res2.status).toBe(409);

      expect(res2.body.error.code).toBe(
        'IDEMPOTENCY_KEY_CONFLICT'
      );
    });

    it('should allow different customers to use same idempotency key', async () => {
      const sharedKey = `shared-key-${Date.now()}`;

      const res1 = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', sharedKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res1.status).toBe(201);

      const order1Id = res1.body.orderId;

      const res2 = await agent2
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken2)
        .set('Idempotency-Key', sharedKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 2
            }
          ]
        });

      expect(res2.status).toBe(201);

      const order2Id = res2.body.orderId;

      expect(order1Id).not.toBe(order2Id);

      expect(res2.body.totalPricePaise).toBe(20000);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      expect(base.reserved).toBe(3);
    });

  });

  describe('Validation', () => {

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(401);
    });

    it('should require CSRF token', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(403);
    });

    it('should require Idempotency-Key header', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(400);

      expect(res.body.error.code).toBe(
        'MISSING_IDEMPOTENCY_KEY'
      );
    });

    it('should reject an idempotency key shorter than 16 characters', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', 'short-key')
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(400);

      expect(res.body.error.code).toBe(
        'INVALID_IDEMPOTENCY_KEY'
      );
    });

    it('should reject invalid idempotency key characters', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', 'key-with-invalid!*')
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(400);

      expect(res.body.error.code).toBe(
        'INVALID_IDEMPOTENCY_KEY'
      );
    });

    it('should reject empty lines array', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: []
        });

      expect(res.status).toBe(422);
    });

    it('should reject invalid quantity', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 0
            }
          ]
        });

      expect(res.status).toBe(422);
    });

    it('should reject non-existent preset pizza', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              pizzaId: fakeId.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(422);

      expect(res.body.error.message).toContain(
        'not found'
      );
    });

    it('should reject unavailable preset pizza', async () => {
      const unavailablePizza = await Pizza.create({
        name: 'Out of Season',
        category: 'vegetarian',

        ingredients: {
          base: baseIngredient._id,
          sauce: sauceIngredient._id,
          cheese: cheeseIngredient._id,
          vegetables: []
        },

        isActive: false
      });

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              pizzaId: unavailablePizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(422);

      expect(res.body.error.message).toContain(
        'not available'
      );
    });

    it('should reject custom pizza missing required ingredient', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              customRecipe: {
                base: baseIngredient._id.toString(),
                sauce: sauceIngredient._id.toString()
              },
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(422);
    });

    it('should reject custom ingredients placed in the wrong category', async () => {
      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set(
          'Idempotency-Key',
          `wrong-category-${Date.now()}`
        )
        .send({
          lines: [
            {
              customRecipe: {
                base: cheeseIngredient._id.toString(),
                sauce: sauceIngredient._id.toString(),
                cheese: baseIngredient._id.toString()
              },
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(422);

      expect(res.body.error.code).toBe(
        'INVALID_ITEMS'
      );

      expect(
        await Order.countDocuments({})
      ).toBe(0);
    });

    it('should reject non-existent custom ingredient', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              customRecipe: {
                base: fakeId.toString(),
                sauce: sauceIngredient._id.toString(),
                cheese: cheeseIngredient._id.toString()
              },
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(422);

      expect(res.body.error.message).toContain(
        'not found'
      );
    });

    it('should reject unavailable custom ingredient', async () => {
      const unavailableIngredient = await Ingredient.create({
        name: 'Rare Truffle',
        category: 'vegetable',
        pricePaise: 50000,
        stock: 0,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: false
      });

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              customRecipe: {
                base: baseIngredient._id.toString(),
                sauce: sauceIngredient._id.toString(),
                cheese: cheeseIngredient._id.toString(),
                vegetables: [
                  unavailableIngredient._id.toString()
                ]
              },
              quantity: 1
            }
          ]
        });

      expect(res.status).toBe(422);

      expect(res.body.error.message).toContain(
        'not available'
      );
    });

  });

  describe('Atomicity', () => {

    it('should rollback on insufficient stock', async () => {
      await Ingredient.findByIdAndUpdate(
        baseIngredient._id,
        { stock: 1 }
      );

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 2
            }
          ]
        });

      expect(res.status).toBe(409);

      expect(res.body.error.code).toBe(
        'INSUFFICIENT_STOCK'
      );

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      expect(base.reserved).toBe(0);

      const orderCount = await Order.countDocuments({});

      expect(orderCount).toBe(0);
    });

    it('should rollback entire order if any ingredient insufficient', async () => {
      await Ingredient.findByIdAndUpdate(
        cheeseIngredient._id,
        { stock: 1 }
      );

      const res = await agent1
        .post('/api/v1/orders')
        .set('x-csrf-token', csrfToken1)
        .set('Idempotency-Key', `test-${Date.now()}`)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 2
            }
          ]
        });

      expect(res.status).toBe(409);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      const sauce = await Ingredient.findById(
        sauceIngredient._id
      );

      const cheese = await Ingredient.findById(
        cheeseIngredient._id
      );

      expect(base.reserved).toBe(0);
      expect(sauce.reserved).toBe(0);
      expect(cheese.reserved).toBe(0);

      const orderCount = await Order.countDocuments({});

      expect(orderCount).toBe(0);
    });

  });

  describe('Concurrency', () => {

    it('should handle concurrent requests with same idempotency key', async () => {
      const sharedKey =
        `concurrent-idempotent-${Date.now()}`;

      const promises = concurrentAgents.map(
        (agent, i) =>
          agent
            .post('/api/v1/orders')
            .set(
              'x-csrf-token',
              concurrentCsrfTokens[i]
            )
            .set('Idempotency-Key', sharedKey)
            .send({
              lines: [
                {
                  pizzaId: presetPizza._id.toString(),
                  quantity: 1
                }
              ]
            })
      );

      const results = await Promise.all(promises);

      const created = results.filter(
        r => r.status === 201
      ).length;

      const idempotent = results.filter(
        r =>
          r.status === 200 &&
          r.body.idempotent
      ).length;

      expect(created).toBe(1);

      expect(
        created + idempotent
      ).toBeGreaterThanOrEqual(1);

      for (const response of results) {
        expect([200, 201, 409]).toContain(
          response.status
        );

        if (response.status === 409) {
          expect(response.body.error.code).toBe(
            'REQUEST_IN_PROGRESS'
          );
        }
      }

      const successfulResponses = results.filter(
        r => r.status === 200 || r.status === 201
      );

      const orderIds = successfulResponses.map(
        r => r.body.orderId
      );

      const uniqueOrderIds = [...new Set(orderIds)];

      expect(uniqueOrderIds.length).toBe(1);

      const orderCount = await Order.countDocuments({
        customerId: testCustomer1._id,
        idempotencyKey: sharedKey
      });

      expect(orderCount).toBe(1);

      // Verify retry
      const retryResponse = await concurrentAgents[0]
        .post('/api/v1/orders')
        .set(
          'x-csrf-token',
          concurrentCsrfTokens[0]
        )
        .set('Idempotency-Key', sharedKey)
        .send({
          lines: [
            {
              pizzaId: presetPizza._id.toString(),
              quantity: 1
            }
          ]
        });

      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body.idempotent).toBe(true);

      expect(retryResponse.body.orderId).toBe(
        uniqueOrderIds[0]
      );

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      expect(base.reserved).toBe(1);
    });

    it('should handle concurrent orders correctly', async () => {
      await Ingredient.findByIdAndUpdate(
        baseIngredient._id,
        { stock: 5 }
      );

      await Ingredient.findByIdAndUpdate(
        sauceIngredient._id,
        { stock: 5 }
      );

      await Ingredient.findByIdAndUpdate(
        cheeseIngredient._id,
        { stock: 5 }
      );

      const timestamp = Date.now();

      const promises = concurrentAgents.map(
        (agent, i) =>
          agent
            .post('/api/v1/orders')
            .set(
              'x-csrf-token',
              concurrentCsrfTokens[i]
            )
            .set(
              'Idempotency-Key',
              `concurrent-${timestamp}-${i}`
            )
            .send({
              lines: [
                {
                  pizzaId: presetPizza._id.toString(),
                  quantity: 1
                }
              ]
            })
      );

      const results = await Promise.all(promises);

      const successCount = results.filter(
        r => r.status === 201
      ).length;

      expect(successCount).toBe(5);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      expect(base.reserved).toBe(5);
      expect(base.stock).toBe(5);

      const orderCount = await Order.countDocuments({
        customerId: testCustomer1._id
      });

      expect(orderCount).toBe(5);
    });

    it('should prevent overselling under concurrent load', async () => {
      await Ingredient.findByIdAndUpdate(
        baseIngredient._id,
        { stock: 3 }
      );

      await Ingredient.findByIdAndUpdate(
        sauceIngredient._id,
        { stock: 3 }
      );

      await Ingredient.findByIdAndUpdate(
        cheeseIngredient._id,
        { stock: 3 }
      );

      const timestamp = Date.now();

      const promises = concurrentAgents.map(
        (agent, i) =>
          agent
            .post('/api/v1/orders')
            .set(
              'x-csrf-token',
              concurrentCsrfTokens[i]
            )
            .set(
              'Idempotency-Key',
              `oversell-${timestamp}-${i}`
            )
            .send({
              lines: [
                {
                  pizzaId: presetPizza._id.toString(),
                  quantity: 1
                }
              ]
            })
      );

      const results = await Promise.all(promises);

      const successCount = results.filter(
        r => r.status === 201
      ).length;

      const insufficientCount = results.filter(
        r =>
          r.status === 409 &&
          r.body.error?.code === 'INSUFFICIENT_STOCK'
      ).length;

      expect(successCount).toBe(3);
      expect(insufficientCount).toBe(2);

      const base = await Ingredient.findById(
        baseIngredient._id
      );

      expect(base.reserved).toBe(3);

      expect(
        base.reserved
      ).toBeLessThanOrEqual(base.stock);

      const orderCount = await Order.countDocuments({
        customerId: testCustomer1._id,
        idempotencyKey: {
          $regex: `^oversell-${timestamp}`
        }
      });

      expect(orderCount).toBe(3);
    });

    /**
 * Customer Order Retrieval and Status Tracking
 */
describe('GET /api/v1/orders — Customer Order Retrieval', () => {

  // Create an order through the existing authenticated API.
  async function createCustomerTestOrder(
    agent,
    csrfToken,
    quantity = 1
  ) {
    const key =
      `order-read-${Date.now()}-` +
      Math.random().toString(36).slice(2, 12);

    const response = await agent
      .post('/api/v1/orders')
      .set('x-csrf-token', csrfToken)
      .set('Idempotency-Key', key)
      .send({
        lines: [
          {
            pizzaId: presetPizza._id.toString(),
            quantity
          }
        ]
      });

    expect(response.status).toBe(201);

    return response.body.orderId;
  }

  it('requires authentication for order retrieval', async () => {
    const history = await request(app)
      .get('/api/v1/orders');

    expect(history.status).toBe(401);

    const single = await request(app)
      .get(
        '/api/v1/orders/507f1f77bcf86cd799439011'
      );

    expect(single.status).toBe(401);
  });

  it('returns only the customer’s orders with pagination', async () => {
    const firstId = await createCustomerTestOrder(
      agent1,
      csrfToken1
    );

    const secondId = await createCustomerTestOrder(
      agent1,
      csrfToken1
    );

    const thirdId = await createCustomerTestOrder(
      agent1,
      csrfToken1
    );

    const otherCustomerId = await createCustomerTestOrder(
      agent2,
      csrfToken2
    );

    // Retrieve the first page.
    const firstPage = await agent1
      .get('/api/v1/orders?page=1&limit=2');

    expect(firstPage.status).toBe(200);

    expect(firstPage.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2
    });

    expect(firstPage.body.orders).toHaveLength(2);

    // Retrieve the second page.
    const secondPage = await agent1
      .get('/api/v1/orders?page=2&limit=2');

    expect(secondPage.status).toBe(200);

    expect(secondPage.body.orders).toHaveLength(1);

    // All three orders must belong to customer 1.
    const returnedIds = [
      ...firstPage.body.orders,
      ...secondPage.body.orders
    ].map(order => order.orderId);

    expect(returnedIds.sort()).toEqual(
      [firstId, secondId, thirdId].sort()
    );

    expect(returnedIds).not.toContain(
      otherCustomerId
    );

    // Customer 2 must see only their own order.
    const customer2History = await agent2
      .get('/api/v1/orders');

    expect(customer2History.status).toBe(200);

    expect(customer2History.body.pagination.total).toBe(1);

    expect(customer2History.body.orders[0].orderId)
      .toBe(otherCustomerId);

    // Invalid pagination must be rejected.
    const invalidPage = await agent1
      .get('/api/v1/orders?page=0');

    expect(invalidPage.status).toBe(400);

    const invalidLimit = await agent1
      .get('/api/v1/orders?limit=51');

    expect(invalidLimit.status).toBe(400);
  });

  it('retrieves an owned order with pricing snapshots', async () => {
    const orderId = await createCustomerTestOrder(
      agent1,
      csrfToken1,
      2
    );

    // GET requests do not require a CSRF token.
    const response = await agent1
      .get(`/api/v1/orders/${orderId}`);

    expect(response.status).toBe(200);

    const order = response.body.order;

    expect(order.orderId).toBe(orderId);

    expect(order.orderState).toBe(
      'pending_payment'
    );

    expect(order.paymentStatus).toBe(
      'pending_gateway'
    );

    expect(order.totalPricePaise).toBe(20000);

    expect(order.items).toHaveLength(1);

    expect(order.items[0]).toMatchObject({
      name: 'Margherita',
      quantity: 2,
      unitPricePaise: 10000,
      lineTotalPaise: 20000
    });

    expect(order.items[0].base.name).toBe(
      'Thin Crust'
    );

    expect(order.reservationExpiresAt).toBeTruthy();

    // Internal payment and gateway data must remain private.
    const responseText = JSON.stringify(response.body);

    expect(responseText).not.toContain(
      'requestHash'
    );

    expect(responseText).not.toContain(
      'idempotencyKey'
    );

    expect(responseText).not.toContain(
      'razorpaySignature'
    );

    expect(responseText).not.toContain(
      'gatewayLock'
    );

    expect(responseText).not.toContain(
      'manualReviewNotes'
    );

    expect(response.headers['cache-control'])
      .toContain('no-store');
  });

  it('prevents customers from accessing another customer’s order', async () => {
    const orderId = await createCustomerTestOrder(
      agent1,
      csrfToken1
    );

    // Customer 2 attempts to retrieve Customer 1's order.
    const response = await agent2
      .get(`/api/v1/orders/${orderId}`);

    expect(response.status).toBe(404);

    expect(response.body.error.code).toBe(
      'ORDER_NOT_FOUND'
    );
  });

  it('rejects invalid and nonexistent order IDs', async () => {
    const invalid = await agent1
      .get('/api/v1/orders/not-a-valid-id');

    expect(invalid.status).toBe(400);

    expect(invalid.body.error.code).toBe(
      'INVALID_ORDER_ID'
    );

    const nonexistent = await agent1
      .get(
        '/api/v1/orders/507f1f77bcf86cd799439011'
      );

    expect(nonexistent.status).toBe(404);

    expect(nonexistent.body.error.code).toBe(
      'ORDER_NOT_FOUND'
    );
  });

  it('returns updated order and payment statuses', async () => {
    const orderId = await createCustomerTestOrder(
      agent1,
      csrfToken1
    );

    // Simulate an order whose payment was confirmed
    // and whose preparation has started.
    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          orderState: 'in_kitchen',
          paymentStatus: 'paid'
        }
      }
    );

    const response = await agent1
      .get(`/api/v1/orders/${orderId}`);

    expect(response.status).toBe(200);

    expect(response.body.order.orderState).toBe(
      'in_kitchen'
    );

    expect(response.body.order.paymentStatus).toBe(
      'paid'
    );

    // An already-paid order should not show an active
    // payment reservation deadline.
    expect(
      response.body.order.reservationExpiresAt
    ).toBeNull();
  });
});

  });

});