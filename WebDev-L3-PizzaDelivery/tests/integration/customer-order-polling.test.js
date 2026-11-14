// SUNNYS Pizza — Customer Order Polling Integration Tests
// Verifies polling behavior, status synchronization, and notification logic

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import app from '../../server/src/app.js';
import User from '../../server/src/models/User.js';
import Order from '../../server/src/models/Order.js';
import Ingredient from '../../server/src/models/Ingredient.js';

let mongoServer;

describe('Customer Order Polling', () => {
  let agent;
  let csrfToken;
  let testCustomer;
  let testOrder;
  let testIngredient;

  beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger'
      }
    });

    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Create test ingredient once
    testIngredient = await Ingredient.create({
      name: 'Test Cheese',
      category: 'cheese',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true,
      isVegetarian: true
    });

    // Create test customer once
    testCustomer = await User.create({
      email: 'customer@test.com',
      password: 'SecurePass123!',
      role: 'customer',
      isVerified: true
    });

    // Create authenticated session ONCE (shared across all tests)
    agent = request.agent(app);
    
    // Get CSRF token
    const csrfRes = await agent.get('/api/auth/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    
    // Login once with CSRF token
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'customer@test.com',
        password: 'SecurePass123!'
      })
      .expect(200);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Order.deleteMany({});
    await Ingredient.deleteMany({});
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean up only orders between tests
    await Order.deleteMany({});

    // Create a test order for each test
    testOrder = await Order.create({
      customerId: testCustomer._id,
      items: [{
        name: 'Custom Pizza',
        base: { 
          ingredientId: testIngredient._id, 
          name: 'Test Cheese',
          pricePaise: 5000
        },
        sauce: { 
          ingredientId: testIngredient._id, 
          name: 'Test Cheese',
          pricePaise: 5000
        },
        cheese: { 
          ingredientId: testIngredient._id, 
          name: 'Test Cheese',
          pricePaise: 5000
        },
        vegetables: [],
        proteins: [],
        quantity: 1,
        unitPricePaise: 15000,
        lineTotalPaise: 15000
      }],
      subtotalPaise: 15000,
      taxPaise: 0,
      totalPricePaise: 15000,
      orderState: 'received',
      paymentStatus: 'paid',
      idempotencyKey: `test-polling-order-${Date.now()}`,
      requestHash: `test-hash-${Date.now()}`,
      reservation: {
        state: 'committed',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ingredients: []
      }
    });
  });

  afterEach(async () => {
    await Order.deleteMany({});
  });

  describe('Order List Polling', () => {
    it('should fetch orders list successfully', async () => {
      const res = await agent
        .get('/api/v1/orders?page=1&limit=10')
        .expect(200);

      expect(res.body).toHaveProperty('orders');
      expect(res.body.orders).toBeInstanceOf(Array);
      expect(res.body.orders.length).toBeGreaterThan(0);
      expect(res.body.orders[0].orderId).toBe(testOrder._id.toString());
    });

    it('should return fresh order state on repeated calls', async () => {
      // First call
      const res1 = await agent
        .get('/api/v1/orders?page=1&limit=10')
        .expect(200);

      expect(res1.body.orders[0].orderState).toBe('received');

      // Update order state
      testOrder.orderState = 'in_kitchen';
      await testOrder.save();

      // Second call - should reflect the change
      const res2 = await agent
        .get('/api/v1/orders?page=1&limit=10')
        .expect(200);

      expect(res2.body.orders[0].orderState).toBe('in_kitchen');
    });

    it('should only return orders owned by the customer', async () => {
      // Create another customer and their order
      const otherCustomer = await User.create({
        email: 'other@test.com',
        password: 'SecurePass123!',
        role: 'customer',
        isVerified: true
      });

      await Order.create({
        customerId: otherCustomer._id,
        items: [{
          name: 'Other Pizza',
          base: { 
            ingredientId: testIngredient._id, 
            name: 'Test Cheese',
            pricePaise: 5000
          },
          sauce: { 
            ingredientId: testIngredient._id, 
            name: 'Test Cheese',
            pricePaise: 5000
          },
          cheese: { 
            ingredientId: testIngredient._id, 
            name: 'Test Cheese',
            pricePaise: 5000
          },
          vegetables: [],
          proteins: [],
          quantity: 1,
          unitPricePaise: 15000,
          lineTotalPaise: 15000
        }],
        subtotalPaise: 15000,
        taxPaise: 0,
        totalPricePaise: 15000,
        orderState: 'received',
        paymentStatus: 'paid',
        idempotencyKey: `other-order-${Date.now()}`,
        requestHash: `other-hash-${Date.now()}`,
        reservation: {
          state: 'committed',
          reservedAt: new Date(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          ingredients: []
        }
      });

      // Current customer should only see their own order
      const res = await agent
        .get('/api/v1/orders?page=1&limit=10')
        .expect(200);

      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].orderId).toBe(testOrder._id.toString());

      // Clean up
      await User.deleteOne({ _id: otherCustomer._id });
    });
  });

  describe('Individual Order Polling', () => {
    it('should fetch individual order details', async () => {
      const res = await agent
        .get(`/api/v1/orders/${testOrder._id}`)
        .expect(200);

      expect(res.body).toHaveProperty('order');
      expect(res.body.order.orderId).toBe(testOrder._id.toString());
      expect(res.body.order.orderState).toBe('received');
    });

    it('should return updated state on repeated polls', async () => {
      // First poll
      const res1 = await agent
        .get(`/api/v1/orders/${testOrder._id}`)
        .expect(200);

      expect(res1.body.order.orderState).toBe('received');

      // Simulate admin updating order status
      testOrder.orderState = 'in_kitchen';
      await testOrder.save();

      // Second poll - should show new state
      const res2 = await agent
        .get(`/api/v1/orders/${testOrder._id}`)
        .expect(200);

      expect(res2.body.order.orderState).toBe('in_kitchen');

      // Third poll - status changed again
      testOrder.orderState = 'sent_to_delivery';
      await testOrder.save();

      const res3 = await agent
        .get(`/api/v1/orders/${testOrder._id}`)
        .expect(200);

      expect(res3.body.order.orderState).toBe('sent_to_delivery');
    });

    it('should prevent access to other customers orders', async () => {
      // Create another customer
      const otherCustomer = await User.create({
        email: 'other@test.com',
        password: 'SecurePass123!',
        role: 'customer',
        isVerified: true
      });

      const otherOrder = await Order.create({
        customerId: otherCustomer._id,
        items: [{
          name: 'Other Pizza 2',
          base: { 
            ingredientId: testIngredient._id, 
            name: 'Test Cheese',
            pricePaise: 5000
          },
          sauce: { 
            ingredientId: testIngredient._id, 
            name: 'Test Cheese',
            pricePaise: 5000
          },
          cheese: { 
            ingredientId: testIngredient._id, 
            name: 'Test Cheese',
            pricePaise: 5000
          },
          vegetables: [],
          proteins: [],
          quantity: 1,
          unitPricePaise: 15000,
          lineTotalPaise: 15000
        }],
        subtotalPaise: 15000,
        taxPaise: 0,
        totalPricePaise: 15000,
        orderState: 'received',
        paymentStatus: 'paid',
        idempotencyKey: `other-order-2-${Date.now()}`,
        requestHash: `other-hash-2-${Date.now()}`,
        reservation: {
          state: 'committed',
          reservedAt: new Date(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          ingredients: []
        }
      });

      // Attempt to access other customer's order
      await agent
        .get(`/api/v1/orders/${otherOrder._id}`)
        .expect(404); // Returns 404, not 403, since query includes customerId filter

      // Clean up
      await User.deleteOne({ _id: otherCustomer._id });
    });

    it('should return 404 for non-existent orders', async () => {
      // Use a valid ObjectId format that doesn't exist
      const fakeOrderId = '000000000000000000000000';
      
      await agent
        .get(`/api/v1/orders/${fakeOrderId}`)
        .expect(404);
    });
  });

  describe('Order State Transitions', () => {
    it('should reflect all order states', async () => {
      const states = ['received', 'in_kitchen', 'sent_to_delivery'];

      for (const state of states) {
        testOrder.orderState = state;
        await testOrder.save();

        const res = await agent
          .get(`/api/v1/orders/${testOrder._id}`)
          .expect(200);

        expect(res.body.order.orderState).toBe(state);
      }
    });

    it('should show expired state when applicable', async () => {
      testOrder.orderState = 'expired';
      await testOrder.save();

      const res = await agent
        .get(`/api/v1/orders/${testOrder._id}`)
        .expect(200);

      expect(res.body.order.orderState).toBe('expired');
    });
  });

  describe('Polling Authorization', () => {
    it('should require authentication for order list', async () => {
      await request(app)
        .get('/api/v1/orders')
        .expect(401);
    });

    it('should require authentication for order details', async () => {
      // Use a valid ObjectId format for the test
      const fakeOrderId = '000000000000000000000000';
      
      await request(app)
        .get(`/api/v1/orders/${fakeOrderId}`)
        .expect(401);
    });
  });

  describe('Concurrent Polling', () => {
    it('should handle multiple simultaneous requests', async () => {
      const requests = Array(5).fill(null).map(() => 
        agent.get('/api/v1/orders?page=1&limit=10')
      );

      const responses = await Promise.all(requests);

      responses.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.orders).toBeInstanceOf(Array);
      });
    });
  });
});
