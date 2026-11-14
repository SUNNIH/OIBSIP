/**
 * Order Model Integration Tests
 * 
 * Tests Phase 4 Task 4.1 Order model implementation:
 * - Schema validation
 * - State transitions (OD-06)
 * - Pricing consistency
 * - Idempotency
 * - Reservation metadata
 * - Gateway locking (OD-24)
 * - Customer authorization
 * - Query methods
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Order from '../../server/src/models/Order.js';
import User from '../../server/src/models/User.js';
import Ingredient from '../../server/src/models/Ingredient.js';
const TEST_REQUEST_HASH = 'a'.repeat(64);

let replSet;

beforeAll(async () => {
  // Start in-memory replica set for transaction support
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  
  const uri = replSet.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  // Clean collections before each test
  await Order.deleteMany({});
  await User.deleteMany({});
  await Ingredient.deleteMany({});
});

describe('Order Model - Schema Validation', () => {
  let customerId;
  let baseId, sauceId, cheeseId, vegId;
  
  beforeEach(async () => {
    // Create test customer
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    // Create test ingredients
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
    
    const veg = await Ingredient.create({
      name: 'Mushrooms',
      category: 'vegetable',
      pricePaise: 1500,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    vegId = veg._id;
  });
  
  it('should create valid order with all required fields', async () => {
    const unitPricePaise = 5000 + 2000 + 3000; // 100.00 INR
    const quantity = 2;
    const lineTotalPaise = unitPricePaise * quantity;
    
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Margherita',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity,
        unitPricePaise,
        lineTotalPaise
      }],
      totalPricePaise: lineTotalPaise,
      idempotencyKey: 'test-idem-001',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order._id).toBeDefined();
    expect(order.customerId.toString()).toBe(customerId.toString());
    expect(order.items).toHaveLength(1);
    expect(order.totalPricePaise).toBe(lineTotalPaise);
    expect(order.orderState).toBe('pending_payment');
    expect(order.paymentStatus).toBe('pending_gateway');
    expect(order.idempotencyKey).toBe('test-idem-001');
  });
  
  it('should create order with vegetables', async () => {
    const unitPricePaise = 5000 + 2000 + 3000 + 1500; // 115.00 INR
    
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Veggie Supreme',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [
          { ingredientId: vegId, name: 'Mushrooms', pricePaise: 1500 }
        ],
        quantity: 1,
        unitPricePaise,
        lineTotalPaise: unitPricePaise
      }],
      totalPricePaise: unitPricePaise,
      idempotencyKey: 'test-idem-002',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.items[0].vegetables).toHaveLength(1);
    expect(order.items[0].vegetables[0].name).toBe('Mushrooms');
  });
  
  it('should create multi-line order', async () => {
    const item1UnitPrice = 10000;
    const item1Quantity = 2;
    const item1Total = item1UnitPrice * item1Quantity;
    
    const item2UnitPrice = 11500;
    const item2Quantity = 1;
    const item2Total = item2UnitPrice * item2Quantity;
    
    const totalPricePaise = item1Total + item2Total;
    
    const order = await Order.create({
      customerId,
      items: [
        {
          name: 'Margherita',
          base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
          sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
          cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
          vegetables: [],
          quantity: item1Quantity,
          unitPricePaise: item1UnitPrice,
          lineTotalPaise: item1Total
        },
        {
          name: 'Veggie',
          base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
          sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
          cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
          vegetables: [
            { ingredientId: vegId, name: 'Mushrooms', pricePaise: 1500 }
          ],
          quantity: item2Quantity,
          unitPricePaise: item2UnitPrice,
          lineTotalPaise: item2Total
        }
      ],
      totalPricePaise,
      idempotencyKey: 'test-idem-003',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.items).toHaveLength(2);
    expect(order.totalPricePaise).toBe(31500);
  });
  
  it('should reject order without customerId', async () => {
    await expect(Order.create({
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-004',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow();
  });
  
  it('should reject order with empty items array', async () => {
    await expect(Order.create({
      customerId,
      items: [],
      totalPricePaise: 0,
      idempotencyKey: 'test-idem-005',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow(/at least one item/);
  });
  
  it('should reject order without idempotencyKey', async () => {
    await expect(Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
requestHash: TEST_REQUEST_HASH,
reservation: {
  reservedAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000)
}
    })).rejects.toThrow();
  });
  
  it('should reject duplicate idempotencyKey', async () => {
    const orderData = {
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'duplicate-key',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    };
    
    await Order.create(orderData);
    await expect(Order.create(orderData)).rejects.toThrow(/duplicate key/);
  });
  
  it('should allow different customers to use same idempotencyKey', async () => {
    const customer2 = await User.create({
      email: 'customer2@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    
    const orderData1 = {
      customerId,
      items: [{
        name: 'Customer 1 Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'shared-key',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    };
    
    const orderData2 = {
      customerId: customer2._id,
      items: [{
        name: 'Customer 2 Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'shared-key',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    };
    
    const order1 = await Order.create(orderData1);
    const order2 = await Order.create(orderData2);
    
    expect(order1.idempotencyKey).toBe('shared-key');
    expect(order2.idempotencyKey).toBe('shared-key');
    expect(order1.customerId.toString()).not.toBe(order2.customerId.toString());
  });
  
  it('should reject non-integer quantity', async () => {
    await expect(Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1.5,
        unitPricePaise: 10000,
        lineTotalPaise: 15000
      }],
      totalPricePaise: 15000,
      idempotencyKey: 'test-idem-006',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow(/integer/);
  });
  
  it('should reject non-integer prices', async () => {
    await expect(Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000.5 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-007',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow();
  });
});

describe('Order Model - Pricing Consistency', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should reject order when lineTotalPaise does not match unitPricePaise * quantity', async () => {
    await expect(Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 2,
        unitPricePaise: 10000,
        lineTotalPaise: 19999 // Wrong!
      }],
      totalPricePaise: 19999,
      idempotencyKey: 'test-idem-008',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow(/Line total mismatch/);
  });
  
  it('should reject order when totalPricePaise does not match sum of line items', async () => {
    await expect(Order.create({
      customerId,
      items: [
        {
          name: 'Pizza 1',
          base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
          sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
          cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
          vegetables: [],
          quantity: 1,
          unitPricePaise: 10000,
          lineTotalPaise: 10000
        },
        {
          name: 'Pizza 2',
          base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
          sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
          cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
          vegetables: [],
          quantity: 2,
          unitPricePaise: 10000,
          lineTotalPaise: 20000
        }
      ],
      totalPricePaise: 29999, // Wrong! Should be 30000
      idempotencyKey: 'test-idem-009',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow(/Total price mismatch/);
  });
});

describe('Order Model - State Transitions (OD-06)', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should allow transition from pending_payment to received', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-010',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('received')).toBe(true);
    order.transitionTo('received');
    expect(order.orderState).toBe('received');
  });
  
  it('should allow transition from pending_payment to expired', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-011',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('expired')).toBe(true);
    order.transitionTo('expired');
    expect(order.orderState).toBe('expired');
  });
  
  it('should allow transition from received to in_kitchen', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      orderState: 'received',
      idempotencyKey: 'test-idem-012',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('in_kitchen')).toBe(true);
    order.transitionTo('in_kitchen');
    expect(order.orderState).toBe('in_kitchen');
  });
  
  it('should allow transition from in_kitchen to sent_to_delivery', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      orderState: 'in_kitchen',
      idempotencyKey: 'test-idem-013',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('sent_to_delivery')).toBe(true);
    order.transitionTo('sent_to_delivery');
    expect(order.orderState).toBe('sent_to_delivery');
  });
  
  it('should allow transition from expired to received (late payment recovery)', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      orderState: 'expired',
      idempotencyKey: 'test-idem-014',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('received')).toBe(true);
    order.transitionTo('received');
    expect(order.orderState).toBe('received');
  });
  
  it('should reject invalid transition from pending_payment to in_kitchen', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-015',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('in_kitchen')).toBe(false);
    expect(() => order.transitionTo('in_kitchen')).toThrow(/Invalid transition/);
  });
  
  it('should reject transition from sent_to_delivery to any state', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      orderState: 'sent_to_delivery',
      idempotencyKey: 'test-idem-016',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    expect(order.canTransitionTo('received')).toBe(false);
    expect(order.canTransitionTo('in_kitchen')).toBe(false);
    expect(order.canTransitionTo('expired')).toBe(false);
  });
});

describe('Order Model - Reservation Metadata', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should track reservation timestamps', async () => {
    const reservedAt = new Date();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-017',
      requestHash: TEST_REQUEST_HASH,
     reservation: {
  state: 'held',
  reservedAt,
  expiresAt,
  lines: [
    { ingredientId: baseId, qty: 1 },
    { ingredientId: sauceId, qty: 1 },
    { ingredientId: cheeseId, qty: 1 }
  ]
}
    });
    
    expect(order.reservation.reservedAt).toEqual(reservedAt);
    expect(order.reservation.expiresAt).toEqual(expiresAt);
    expect(order.reservation.committedAt).toBeNull();
    expect(order.reservation.releasedAt).toBeNull();
    expect(order.reservation.state).toBe('held');
    expect(order.reservation.lines).toHaveLength(3);
    expect(order.reservation.lines[0].ingredientId.toString())
  .toBe(baseId.toString());

expect(order.reservation.lines[0].qty).toBe(1); 
  });
  
  it('should detect expired reservation', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-018',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(Date.now() - 20 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000) // Expired 5 minutes ago
      }
    });
    
    expect(order.isReservationExpired()).toBe(true);
  });
  
  it('should detect non-expired reservation', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-019',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000) // Expires in 15 minutes
      }
    });
    
    expect(order.isReservationExpired()).toBe(false);
  });
  
  it('should find orders with expired reservations', async () => {
    await Order.create({
      customerId,
      items: [{
        name: 'Expired Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      orderState: 'pending_payment',
      idempotencyKey: 'test-idem-020',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(Date.now() - 20 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000)
      }
    });
    
    await Order.create({
      customerId,
      items: [{
        name: 'Active Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      orderState: 'pending_payment',
      idempotencyKey: 'test-idem-021',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    const expiredOrders = await Order.findExpiredReservations();
    expect(expiredOrders).toHaveLength(1);
    expect(expiredOrders[0].items[0].name).toBe('Expired Order');
  });
});

describe('Order Model - Gateway Locking (OD-24)', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should create order with gateway lock', async () => {
    const lockToken = 'lock-token-001';
    const acquiredAt = new Date();
    const expiresAt = new Date(Date.now() + 30 * 1000);
    
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-022',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      gatewayLock: {
        token: lockToken,
        fencingGeneration: 1,
        acquiredAt,
        expiresAt
      }
    });
    
    expect(order.gatewayLock.token).toBe(lockToken);
    expect(order.gatewayLock.fencingGeneration).toBe(1);
    expect(order.isGatewayLockHeldBy(lockToken)).toBe(true);
  });
  
  it('should detect expired gateway lock', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-023',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      gatewayLock: {
        token: 'expired-token',
        fencingGeneration: 1,
        acquiredAt: new Date(Date.now() - 60 * 1000),
        expiresAt: new Date(Date.now() - 30 * 1000) // Expired 30 seconds ago
      }
    });
    
    expect(order.isGatewayLockExpired()).toBe(true);
    expect(order.isGatewayLockHeldBy('expired-token')).toBe(false);
  });
  
  it('should reject wrong lock token', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-024',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      gatewayLock: {
        token: 'correct-token',
        fencingGeneration: 1,
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 1000)
      }
    });
    
    expect(order.isGatewayLockHeldBy('wrong-token')).toBe(false);
  });
  
  it('should require integer fencing generation', async () => {
    await expect(Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-025',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      gatewayLock: {
        token: 'test-token',
        fencingGeneration: 1.5, // Invalid
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 1000)
      }
    })).rejects.toThrow(/integer/);
  });
});

describe('Order Model - Payment IDs and States', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should store Razorpay payment identifiers', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-026',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      razorpayOrderId: 'order_test123',
      razorpayPaymentId: 'pay_test456',
      razorpaySignature: 'sig_test789'
    });
    
    expect(order.razorpayOrderId).toBe('order_test123');
    expect(order.razorpayPaymentId).toBe('pay_test456');
    expect(order.razorpaySignature).toBe('sig_test789');
  });
  
  it('should support approved payment sub-statuses', async () => {
    const paymentStatuses = ['pending_gateway', 'created', 'paid', 'paid_after_expiry'];
    
    for (const status of paymentStatuses) {
      const order = await Order.create({
        customerId,
        items: [{
          name: 'Test',
          base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
          sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
          cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
          vegetables: [],
          quantity: 1,
          unitPricePaise: 10000,
          lineTotalPaise: 10000
        }],
        totalPricePaise: 10000,
        paymentStatus: status,
        idempotencyKey: `test-idem-payment-${status}`,
        requestHash: TEST_REQUEST_HASH,
        reservation: {
          reservedAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
      });
      
      expect(order.paymentStatus).toBe(status);
    }
  });
  
  it('should reject invalid payment status', async () => {
    await expect(Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      paymentStatus: 'invalid_status',
      idempotencyKey: 'test-idem-027',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    })).rejects.toThrow();
  });
});

describe('Order Model - Customer Authorization', () => {
  let customer1Id, customer2Id, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer1 = await User.create({
      email: 'customer1@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customer1Id = customer1._id;
    
    const customer2 = await User.create({
      email: 'customer2@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customer2Id = customer2._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should find orders by customerId', async () => {
    await Order.create({
      customerId: customer1Id,
      items: [{
        name: 'Customer 1 Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-028',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    await Order.create({
      customerId: customer2Id,
      items: [{
        name: 'Customer 2 Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-029',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    const customer1Orders = await Order.find({ customerId: customer1Id });
    expect(customer1Orders).toHaveLength(1);
    expect(customer1Orders[0].items[0].name).toBe('Customer 1 Order');
    
    const customer2Orders = await Order.find({ customerId: customer2Id });
    expect(customer2Orders).toHaveLength(1);
    expect(customer2Orders[0].items[0].name).toBe('Customer 2 Order');
  });
});

describe('Order Model - Manual Review Flags', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should flag order for manual refund review', async () => {
    const order = await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-030',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      requiresManualRefundReview: true,
      manualReviewNotes: 'Inventory recovery failed after late payment'
    });
    
    expect(order.requiresManualRefundReview).toBe(true);
    expect(order.manualReviewNotes).toBe('Inventory recovery failed after late payment');
  });
  
  it('should find orders requiring manual refund review', async () => {
    await Order.create({
      customerId,
      items: [{
        name: 'Normal Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-031',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    await Order.create({
      customerId,
      items: [{
        name: 'Review Order',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-032',
      requestHash: TEST_REQUEST_HASH,
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      },
      requiresManualRefundReview: true
    });
    
    const reviewOrders = await Order.findRequiringRefundReview();
    expect(reviewOrders).toHaveLength(1);
    expect(reviewOrders[0].items[0].name).toBe('Review Order');
  });
});

describe('Order Model - Indexes', () => {
  let customerId, baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
    const customer = await User.create({
      email: 'customer@test.com',
      password: 'Password123!',
      role: 'customer',
      emailVerified: true
    });
    customerId = customer._id;
    
    const base = await Ingredient.create({
      name: 'Thin Crust',
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    baseId = base._id;
    
    const sauce = await Ingredient.create({
      name: 'Tomato Sauce',
      category: 'sauce',
      pricePaise: 2000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    sauceId = sauce._id;
    
    const cheese = await Ingredient.create({
      name: 'Mozzarella',
      category: 'cheese',
      pricePaise: 3000,
      stock: 100,
      reserved: 0,
      isActive: true
    });
    cheeseId = cheese._id;
  });
  
  it('should query by razorpayOrderId', async () => {
    await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-033',
      requestHash: TEST_REQUEST_HASH,
      razorpayOrderId: 'order_indexed123',
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    const order = await Order.findOne({ razorpayOrderId: 'order_indexed123' });
    expect(order).toBeDefined();
    expect(order.razorpayOrderId).toBe('order_indexed123');
  });
  
  it('should query by clientRequestId', async () => {
    await Order.create({
      customerId,
      items: [{
        name: 'Test',
        base: { ingredientId: baseId, name: 'Thin Crust', pricePaise: 5000 },
        sauce: { ingredientId: sauceId, name: 'Tomato Sauce', pricePaise: 2000 },
        cheese: { ingredientId: cheeseId, name: 'Mozzarella', pricePaise: 3000 },
        vegetables: [],
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000
      }],
      totalPricePaise: 10000,
      idempotencyKey: 'test-idem-034',
      requestHash: TEST_REQUEST_HASH,
      clientRequestId: 'client-req-789',
      reservation: {
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }
    });
    
    const order = await Order.findOne({ clientRequestId: 'client-req-789' });
    expect(order).toBeDefined();
    expect(order.clientRequestId).toBe('client-req-789');
  });
});
