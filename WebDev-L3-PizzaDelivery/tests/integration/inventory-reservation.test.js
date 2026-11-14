/**
 * Inventory Reservation Service Integration Tests
 * 
 * Tests Phase 4 Task 4.2 atomic inventory reservations:
 * - All-or-nothing reservations
 * - Transaction rollback
 * - Concurrency protection
 * - Quantity aggregation
 * - Availability checks
 * - Release operations
 */
import {sweepExpiredReservations,sweepLatePaymentRecoveries} from '../../server/src/services/reservationExpirationWorker.js';
import { recoverLatePaidOrder } from '../../server/src/services/latePaymentRecovery.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Ingredient from '../../server/src/models/Ingredient.js';
import Order from '../../server/src/models/Order.js';
import {
  calculateIngredientQuantities,
  reserveInventory,
  releaseInventory,
  expireOrderReservation
} from '../../server/src/services/inventoryReservation.js';

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
  await Ingredient.deleteMany({});
});

describe('Ingredient Quantity Calculation', () => {
  it('should calculate quantities for single-line order', () => {
    const items = [{
      quantity: 2,
      base: { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011') },
      sauce: { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012') },
      cheese: { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013') },
      vegetables: []
    }];
    
    const quantities = calculateIngredientQuantities(items);
    
    expect(quantities['507f1f77bcf86cd799439011']).toBe(2); // base
    expect(quantities['507f1f77bcf86cd799439012']).toBe(2); // sauce
    expect(quantities['507f1f77bcf86cd799439013']).toBe(2); // cheese
  });
  
  it('should calculate quantities with vegetables', () => {
    const items = [{
      quantity: 3,
      base: { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011') },
      sauce: { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012') },
      cheese: { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013') },
      vegetables: [
        { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439014') },
        { ingredientId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439015') }
      ]
    }];
    
    const quantities = calculateIngredientQuantities(items);
    
    expect(quantities['507f1f77bcf86cd799439011']).toBe(3); // base
    expect(quantities['507f1f77bcf86cd799439014']).toBe(3); // veg1
    expect(quantities['507f1f77bcf86cd799439015']).toBe(3); // veg2
  });
  
  it('should aggregate quantities across multiple items', () => {
    const baseId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const sauceId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
    const cheeseId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
    
    const items = [
      {
        quantity: 2,
        base: { ingredientId: baseId },
        sauce: { ingredientId: sauceId },
        cheese: { ingredientId: cheeseId },
        vegetables: []
      },
      {
        quantity: 3,
        base: { ingredientId: baseId }, // Same base
        sauce: { ingredientId: sauceId }, // Same sauce
        cheese: { ingredientId: cheeseId }, // Same cheese
        vegetables: []
      }
    ];
    
    const quantities = calculateIngredientQuantities(items);
    
    expect(quantities[baseId.toString()]).toBe(5); // 2 + 3
    expect(quantities[sauceId.toString()]).toBe(5);
    expect(quantities[cheeseId.toString()]).toBe(5);
  });
  
  it('should handle shared and unique ingredients', () => {
    const baseId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const sauce1Id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
    const sauce2Id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');
    const cheeseId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
    
    const items = [
      {
        quantity: 2,
        base: { ingredientId: baseId },
        sauce: { ingredientId: sauce1Id },
        cheese: { ingredientId: cheeseId },
        vegetables: []
      },
      {
        quantity: 1,
        base: { ingredientId: baseId },
        sauce: { ingredientId: sauce2Id }, // Different sauce
        cheese: { ingredientId: cheeseId },
        vegetables: []
      }
    ];
    
    const quantities = calculateIngredientQuantities(items);
    
    expect(quantities[baseId.toString()]).toBe(3); // Shared
    expect(quantities[sauce1Id.toString()]).toBe(2); // Unique to first
    expect(quantities[sauce2Id.toString()]).toBe(1); // Unique to second
    expect(quantities[cheeseId.toString()]).toBe(3); // Shared
  });
});

describe('Ingredient Quantity Validation', () => {
  const baseId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const sauceId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  const cheeseId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');

  const createItem = (quantity) => ({
    quantity,
    base: { ingredientId: baseId },
    sauce: { ingredientId: sauceId },
    cheese: { ingredientId: cheeseId },
    vegetables: []
  });

  it('should reject empty or invalid order items', () => {
    expect(() => calculateIngredientQuantities([])).toThrow();
    expect(() => calculateIngredientQuantities(null)).toThrow();
  });

  it('should reject invalid pizza quantities', () => {
    const invalidQuantities = [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      '2',
      null,
      Number.MAX_SAFE_INTEGER + 1
    ];

    for (const quantity of invalidQuantities) {
      expect(() =>
        calculateIngredientQuantities([createItem(quantity)])
      ).toThrow();
    }
  });

  it('should reject unsafe quantity aggregation', () => {
    const items = [
      createItem(Number.MAX_SAFE_INTEGER),
      createItem(1)
    ];

    expect(() => calculateIngredientQuantities(items))
      .toThrow(/safe integer/i);
  });

  it('should reject duplicate ingredient selections', () => {
    const item = createItem(2);

    item.vegetables = [
      { ingredientId: baseId }
    ];

    expect(() => calculateIngredientQuantities([item]))
      .toThrow(/duplicate ingredient/i);
  });

  it('should reject malformed ingredient IDs', () => {
    const item = createItem(2);

    item.base.ingredientId = 'invalid-id';

    expect(() => calculateIngredientQuantities([item]))
      .toThrow(/invalid ingredient ID/i);
  });it('should normalize uppercase ingredient IDs', () => {
  const item = createItem(2);

  item.base.ingredientId = baseId.toString().toUpperCase();

  const quantities = calculateIngredientQuantities([item]);

  expect(quantities[baseId.toString()]).toBe(2);
  expect(Object.keys(quantities)).toHaveLength(3);
});

it('should reject duplicate ingredients regardless of ID case', () => {
  const item = createItem(2);

  item.vegetables = [
    { ingredientId: baseId.toString().toUpperCase() }
  ];

  expect(() => calculateIngredientQuantities([item]))
    .toThrow(/duplicate ingredient/i);
});
});

describe('Atomic Inventory Reservation', () => {
  let baseId, sauceId, cheeseId, vegId;
  
  beforeEach(async () => {
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
      stock: 50,
      reserved: 0,
      isActive: true
    });
    vegId = veg._id;
  });
  
  it('should successfully reserve available inventory', async () => {
    const items = [{
      quantity: 10,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    const result = await reserveInventory(items);
    
    expect(result.success).toBe(true);
    expect(result.reservedCount).toBe(3);
    expect(result.reservedAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBeInstanceOf(Date);
    
    // Verify reserved quantities in database
    const base = await Ingredient.findById(baseId);
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);
    
    expect(base.reserved).toBe(10);
    expect(sauce.reserved).toBe(10);
    expect(cheese.reserved).toBe(10);
  });
  
  it('should reserve correct quantities for multi-line order', async () => {
    const items = [
      {
        quantity: 5,
        base: { ingredientId: baseId },
        sauce: { ingredientId: sauceId },
        cheese: { ingredientId: cheeseId },
        vegetables: []
      },
      {
        quantity: 3,
        base: { ingredientId: baseId },
        sauce: { ingredientId: sauceId },
        cheese: { ingredientId: cheeseId },
        vegetables: [{ ingredientId: vegId }]
      }
    ];
    
    const result = await reserveInventory(items);
    
    expect(result.success).toBe(true);
    expect(result.reservedCount).toBe(4); // base, sauce, cheese, veg
    
    const base = await Ingredient.findById(baseId);
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);
    const veg = await Ingredient.findById(vegId);
    
    expect(base.reserved).toBe(8); // 5 + 3
    expect(sauce.reserved).toBe(8);
    expect(cheese.reserved).toBe(8);
    expect(veg.reserved).toBe(3);
  });
  
  it('should reject reservation when ingredient not found', async () => {
    const items = [{
      quantity: 1,
      base: { ingredientId: new mongoose.Types.ObjectId() }, // Non-existent
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    await expect(reserveInventory(items)).rejects.toThrow(/not found/);
    
    // Verify no reservation occurred (rollback)
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);
    
    expect(sauce.reserved).toBe(0);
    expect(cheese.reserved).toBe(0);
  });
  
  it('should reject reservation when ingredient is inactive', async () => {
    await Ingredient.updateOne(
      { _id: baseId },
      { isActive: false }
    );
    
    const items = [{
      quantity: 1,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    await expect(reserveInventory(items)).rejects.toThrow(/Inactive ingredients/);
    
    // Verify no reservation occurred (rollback)
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);
    
    expect(sauce.reserved).toBe(0);
    expect(cheese.reserved).toBe(0);
  });
  
  it('should reject reservation with insufficient stock', async () => {
    const items = [{
      quantity: 101, // More than stock (100)
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    await expect(reserveInventory(items)).rejects.toThrow(/Insufficient stock/);
    
    // Verify no reservation occurred (rollback)
    const base = await Ingredient.findById(baseId);
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);
    
    expect(base.reserved).toBe(0);
    expect(sauce.reserved).toBe(0);
    expect(cheese.reserved).toBe(0);
  });
  
  it('should rollback all reservations if one fails (all-or-nothing)', async () => {
    const items = [{
      quantity: 10,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: [{ ingredientId: vegId }]
    }];
    
    // First reservation succeeds
    await reserveInventory(items);
    
    // Attempt second reservation that will fail (insufficient veg stock)
    const items2 = [{
      quantity: 45, // veg only has 50 stock, 10 already reserved
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: [{ ingredientId: vegId }]
    }];
    
    await expect(reserveInventory(items2)).rejects.toThrow(/Insufficient stock/);
    
    // Verify first reservation is intact, second didn't partially apply
    const base = await Ingredient.findById(baseId);
    const veg = await Ingredient.findById(vegId);
    
    expect(base.reserved).toBe(10); // Only first reservation
    expect(veg.reserved).toBe(10); // Only first reservation
  });
  
  it('should handle reservation with existing reserved stock', async () => {
    // Manually set some reserved stock
    await Ingredient.updateOne(
      { _id: baseId },
      { reserved: 30 }
    );
    
    const items = [{
      quantity: 60, // Available: 100 - 30 = 70, requesting 60 should work
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    const result = await reserveInventory(items);
    
    expect(result.success).toBe(true);
    
    const base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(90); // 30 + 60
  });
  
  it('should reject when requested exceeds available (stock - reserved)', async () => {
    await Ingredient.updateOne(
      { _id: baseId },
      { reserved: 30 }
    );
    
    const items = [{
      quantity: 71, // Available: 100 - 30 = 70, requesting 71 fails
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    await expect(reserveInventory(items)).rejects.toThrow(/Insufficient stock/);
  });
});

describe('Inventory Release', () => {
  let baseId, sauceId, cheeseId;

  beforeEach(async () => {
    const ingredients = await Ingredient.create([
      {
        name: 'Thin Crust',
        category: 'base',
        pricePaise: 5000,
        stock: 100,
        reserved: 0,
        isActive: true
      },
      {
        name: 'Tomato Sauce',
        category: 'sauce',
        pricePaise: 2000,
        stock: 100,
        reserved: 0,
        isActive: true
      },
      {
        name: 'Mozzarella',
        category: 'cheese',
        pricePaise: 3000,
        stock: 100,
        reserved: 0,
        isActive: true
      }
    ]);

    baseId = ingredients[0]._id;
    sauceId = ingredients[1]._id;
    cheeseId = ingredients[2]._id;
  });

  async function createHeldOrder(quantity = 5) {
    const item = {
      name: 'Margherita',
      base: {
        ingredientId: baseId,
        name: 'Thin Crust',
        pricePaise: 5000
      },
      sauce: {
        ingredientId: sauceId,
        name: 'Tomato Sauce',
        pricePaise: 2000
      },
      cheese: {
        ingredientId: cheeseId,
        name: 'Mozzarella',
        pricePaise: 3000
      },
      vegetables: [],
      quantity,
      unitPricePaise: 10000,
      lineTotalPaise: 10000 * quantity
    };

    const session = await mongoose.startSession();

    try {
      return await session.withTransaction(async () => {
        const reservation = await reserveInventory(
          [item],
          { session }
        );

        const order = new Order({
  customerId: new mongoose.Types.ObjectId(),
  items: [item],
  totalPricePaise: item.lineTotalPaise,
  idempotencyKey: new mongoose.Types.ObjectId().toString(),
  requestHash: 'test-fixture-request-hash',
  reservation: {
            state: 'held',
            reservedAt: reservation.reservedAt,
            expiresAt: reservation.expiresAt,
            lines: Object.entries(reservation.quantities).map(
              ([ingredientId, qty]) => ({
                ingredientId,
                qty
              })
            )
          }
        });

        return order.save({ session });
      });
    } finally {
      await session.endSession();
    }
  }

  it('releases inventory belonging to one order', async () => {
    const order = await createHeldOrder(5);

    const result = await releaseInventory(order._id);

    expect(result.success).toBe(true);
    expect(result.alreadyReleased).toBe(false);
    expect(result.releasedCount).toBe(3);

    const updatedOrder = await Order.findById(order._id);
    const base = await Ingredient.findById(baseId);
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);

    expect(updatedOrder.reservation.state).toBe('released');
    expect(updatedOrder.reservation.releasedAt).toBeInstanceOf(Date);

    expect(base.reserved).toBe(0);
    expect(sauce.reserved).toBe(0);
    expect(cheese.reserved).toBe(0);

    expect(base.stock).toBe(100);
  });

  it('does not release another order on duplicate release', async () => {
    const orderA = await createHeldOrder(5);
    const orderB = await createHeldOrder(7);

    let base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(12);

    await releaseInventory(orderA._id);

    base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(7);

    const repeatedRelease = await releaseInventory(orderA._id);

    expect(repeatedRelease.success).toBe(true);
    expect(repeatedRelease.alreadyReleased).toBe(true);
    expect(repeatedRelease.releasedCount).toBe(0);

    base = await Ingredient.findById(baseId);

    expect(base.reserved).toBe(7);

    const remainingOrder = await Order.findById(orderB._id);

    expect(remainingOrder.reservation.state).toBe('held');
  });

  it('rejects release of committed or paid orders', async () => {
    const committedOrder = await createHeldOrder(3);

    await Order.updateOne(
      { _id: committedOrder._id },
      {
        $set: {
          'reservation.state': 'committed',
          'reservation.committedAt': new Date()
        }
      }
    );

    await expect(
      releaseInventory(committedOrder._id)
    ).rejects.toThrow(/active reservation/);

    const paidOrder = await createHeldOrder(3);

    await Order.updateOne(
      { _id: paidOrder._id },
      { $set: { paymentStatus: 'paid' } }
    );

    await expect(
      releaseInventory(paidOrder._id)
    ).rejects.toThrow(/not eligible/);

    const base = await Ingredient.findById(baseId);

    expect(base.reserved).toBe(6);
  });

  it('rejects mismatched reservation metadata', async () => {
    const order = await createHeldOrder(5);

    await Order.updateOne(
      { _id: order._id },
      { $set: { 'reservation.lines.0.qty': 999 } }
    );

    await expect(
      releaseInventory(order._id)
    ).rejects.toThrow(/do not match/);

    const updatedOrder = await Order.findById(order._id);
    const base = await Ingredient.findById(baseId);

    expect(updatedOrder.reservation.state).toBe('held');
    expect(base.reserved).toBe(5);
  });

  it('allows caller-owned transaction rollback', async () => {
    const order = await createHeldOrder(5);
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const result = await releaseInventory(
        order._id,
        { session }
      );

      expect(result.success).toBe(true);

      // Simulate another operation failing in the same transaction.
      await session.abortTransaction();

    } finally {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      await session.endSession();
    }

    const updatedOrder = await Order.findById(order._id);
    const base = await Ingredient.findById(baseId);

    expect(updatedOrder.reservation.state).toBe('held');
    expect(base.reserved).toBe(5);
  });

  it('rolls back if inventory invariants are violated', async () => {
    const order = await createHeldOrder(5);

    // Deliberately corrupt one inventory counter.
    await Ingredient.updateOne(
      { _id: sauceId },
      { $set: { reserved: 0 } }
    );

    await expect(
      releaseInventory(order._id)
    ).rejects.toThrow(/invariant violated/);

    const updatedOrder = await Order.findById(order._id);

    const base = await Ingredient.findById(baseId);
    const cheese = await Ingredient.findById(cheeseId);

    // No partial release or reservation-state change.
    expect(updatedOrder.reservation.state).toBe('held');
    expect(base.reserved).toBe(5);
    expect(cheese.reserved).toBe(5);
  });

it('prevents simultaneous duplicate releases from affecting another order', async () => {
  const orderA = await createHeldOrder(5);
  const orderB = await createHeldOrder(7);

  // Both orders hold reservations for the same ingredients.
  let base = await Ingredient.findById(baseId);
  expect(base.reserved).toBe(12);

  // Attempt to release Order A twice concurrently.
  const results = await Promise.allSettled([
    releaseInventory(orderA._id),
    releaseInventory(orderA._id)
  ]);

  // Both calls should complete successfully.
  const successes = results.filter(
    result => result.status === 'fulfilled'
  );

  expect(successes).toHaveLength(2);

  const values = successes.map(result => result.value);

  // Exactly one call performs the release.
  expect(
    values.filter(result => !result.alreadyReleased)
  ).toHaveLength(1);

  // The other call recognizes the completed release.
  expect(
    values.filter(result => result.alreadyReleased)
  ).toHaveLength(1);

  // Order B's reserved inventory remains untouched.
  const updatedBase = await Ingredient.findById(baseId);
  const updatedSauce = await Ingredient.findById(sauceId);
  const updatedCheese = await Ingredient.findById(cheeseId);

  expect(updatedBase.reserved).toBe(7);
  expect(updatedSauce.reserved).toBe(7);
  expect(updatedCheese.reserved).toBe(7);

  const updatedOrderA = await Order.findById(orderA._id);
  const updatedOrderB = await Order.findById(orderB._id);

  expect(updatedOrderA.reservation.state).toBe('released');
  expect(updatedOrderB.reservation.state).toBe('held');
});

it('finds only expired unpaid orders with held reservations', async () => {
  const eligibleOrder = await createHeldOrder(1);
  const futureOrder = await createHeldOrder(1);
  const paidOrder = await createHeldOrder(1);
  const committedOrder = await createHeldOrder(1);
  const releasedOrder = await createHeldOrder(1);

  const expiredAt = new Date(Date.now() - 60000);

  // Expire four reservations, leaving one unexpired.
  await Order.updateMany(
    {
      _id: {
        $in: [
          eligibleOrder._id,
          paidOrder._id,
          committedOrder._id,
          releasedOrder._id
        ]
      }
    },
    {
      $set: {
        'reservation.expiresAt': expiredAt
      }
    }
  );

  // Simulate successful payment.
  await Order.updateOne(
    { _id: paidOrder._id },
    { $set: { paymentStatus: 'paid' } }
  );

  // Simulate committed inventory.
  await Order.updateOne(
    { _id: committedOrder._id },
    {
      $set: {
        'reservation.state': 'committed',
        'reservation.committedAt': new Date()
      }
    }
  );

  // Release one reservation.
  await releaseInventory(releasedOrder._id);

  const expiredOrders = await Order.findExpiredReservations();

  expect(expiredOrders).toHaveLength(1);

  expect(expiredOrders[0]._id.toString())
    .toBe(eligibleOrder._id.toString());
});

it('expires unpaid order and releases inventory atomically', async () => {
  // Create two orders sharing the same ingredients.
  const orderA = await createHeldOrder(5);
  const orderB = await createHeldOrder(7);

  // Both reservations should be reflected in inventory.
  let base = await Ingredient.findById(baseId);
  expect(base.reserved).toBe(12);

  // Simulate expiration of Order A.
  await Order.updateOne(
    { _id: orderA._id },
    {
      $set: {
        'reservation.expiresAt': new Date(Date.now() - 60000)
      }
    }
  );

  // Expire Order A and release its reservation.
  const result = await expireOrderReservation(orderA._id);

  expect(result.success).toBe(true);
  expect(result.expired).toBe(true);
  expect(result.releasedCount).toBe(3);

  // Verify the order state and reservation state.
  const updatedOrderA = await Order.findById(orderA._id);

  expect(updatedOrderA.orderState).toBe('expired');
  expect(updatedOrderA.reservation.state).toBe('released');
  expect(updatedOrderA.reservation.releasedAt)
    .toBeInstanceOf(Date);

  // Verify inventory was released correctly.
  const updatedBase = await Ingredient.findById(baseId);
  const updatedSauce = await Ingredient.findById(sauceId);
  const updatedCheese = await Ingredient.findById(cheeseId);

  expect(updatedBase.reserved).toBe(7);
  expect(updatedSauce.reserved).toBe(7);
  expect(updatedCheese.reserved).toBe(7);

  // Physical stock must remain unchanged.
  expect(updatedBase.stock).toBe(100);
  expect(updatedSauce.stock).toBe(100);
  expect(updatedCheese.stock).toBe(100);

  // Order B must remain unaffected.
  const updatedOrderB = await Order.findById(orderB._id);

  expect(updatedOrderB.orderState).toBe('pending_payment');
  expect(updatedOrderB.reservation.state).toBe('held');
});

it('recovers released late-paid inventory once without touching other reservations', async () => {
  const latePaid = await createHeldOrder(5);
  const active = await createHeldOrder(7);

  await Order.updateOne(
    { _id: latePaid._id },
    {
      $set: {
        paymentStatus: 'paid_after_expiry',
        razorpayPaymentId: 'pay_recovery_test_123',
        razorpaySignature: 'verified-test-signature',
        'reservation.expiresAt': new Date(Date.now() - 60_000)
      }
    }
  );

  await expireOrderReservation(latePaid._id);

  const released = await Order.findById(latePaid._id);
  const releasedAt = released.reservation.releasedAt;

  expect(released.reservation.state).toBe('released');

  // First recovery should consume available inventory.
  const first = await recoverLatePaidOrder(latePaid._id);

  expect(first).toMatchObject({
    success: true,
    recovered: true,
    alreadyRecovered: false,
    ingredientCount: 3
  });

  // Second recovery must not deduct stock again.
  const second = await recoverLatePaidOrder(latePaid._id);

  expect(second).toMatchObject({
    success: true,
    recovered: true,
    alreadyRecovered: true,
    ingredientCount: 0
  });

  // Verify payment and order state.
  const recovered = await Order.findById(latePaid._id);

  expect(recovered.orderState).toBe('received');
  expect(recovered.paymentStatus).toBe('paid');

  expect(recovered.razorpayPaymentId).toBe(
    'pay_recovery_test_123'
  );

  expect(recovered.razorpaySignature).toBe(
    'verified-test-signature'
  );

  expect(recovered.reservation.state).toBe('committed');

  expect(recovered.reservation.committedAt)
    .toBeInstanceOf(Date);

  // Original release timestamp must be preserved.
  expect(recovered.reservation.releasedAt)
    .toEqual(releasedAt);

  // The other customer's reservation must remain intact.
  const stillActive = await Order.findById(active._id);

  expect(stillActive.reservation.state).toBe('held');
  expect(stillActive.orderState).toBe('pending_payment');

  // Stock decreases only for the recovered order.
  // The active order still holds its 7 reserved units.
  for (const ingredientId of [baseId, sauceId, cheeseId]) {
    const ingredient = await Ingredient.findById(
      ingredientId
    );

    expect(ingredient.stock).toBe(95);
    expect(ingredient.reserved).toBe(7);
  }
});

it('rolls back late-payment recovery when stock is insufficient', async () => {
  const order = await createHeldOrder(5);

  // Simulate a captured payment after reservation expiry.
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentStatus: 'paid_after_expiry',
        razorpayPaymentId: 'pay_recovery_shortage_123',
        razorpaySignature: 'verified-test-signature',
        'reservation.expiresAt': new Date(Date.now() - 60_000)
      }
    }
  );

  // Release the original expired reservation.
  await expireOrderReservation(order._id);

  // Reduce sauce stock below the required quantity.
  await Ingredient.updateOne(
    { _id: sauceId },
    {
      $set: {
        stock: 4
      }
    }
  );

  // Recovery must fail because the order requires 5 units.
  await expect(
    recoverLatePaidOrder(order._id)
  ).rejects.toMatchObject({
    code: 'INVENTORY_UNAVAILABLE'
  });

  // Verify the order was not incorrectly recovered.
  const unchanged = await Order.findById(order._id);

  // Insufficient inventory must trigger manual refund review.
expect(unchanged.requiresManualRefundReview).toBe(true);

expect(unchanged.manualReviewNotes)
  .toMatch(/inventory unavailable/i);

  expect(unchanged.paymentStatus).toBe('paid_after_expiry');
  expect(unchanged.orderState).toBe('expired');

  // Captured payment must remain recorded.
  expect(unchanged.razorpayPaymentId).toBe(
    'pay_recovery_shortage_123'
  );

  expect(unchanged.reservation.state).toBe('released');
  expect(unchanged.reservation.committedAt).toBeNull();

  // Verify no partial inventory deduction occurred.
  const base = await Ingredient.findById(baseId);
  const sauce = await Ingredient.findById(sauceId);
  const cheese = await Ingredient.findById(cheeseId);

  expect(base.stock).toBe(100);
  expect(sauce.stock).toBe(4);
  expect(cheese.stock).toBe(100);

  expect(base.reserved).toBe(0);
  expect(sauce.reserved).toBe(0);
  expect(cheese.reserved).toBe(0);
});

it('flags invalid late-payment reservation metadata for manual review', async () => {

  const order = await createHeldOrder(5);

  // Simulate a verified late payment.
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentStatus: 'paid_after_expiry',

        razorpayPaymentId: 'pay_invalid_metadata_123',

        razorpaySignature: 'verified-test-signature',

        'reservation.expiresAt':
          new Date(Date.now() - 60_000)
      }
    }
  );

  // Release the expired reservation normally.
  await expireOrderReservation(order._id);

  // Simulate corrupted reservation metadata.
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'reservation.lines.0.qty': 999
      }
    }
  );

  // Recovery must reject the inconsistent metadata.
  await expect(
    recoverLatePaidOrder(order._id)
  ).rejects.toMatchObject({
    code: 'INVALID_RESERVATION'
  });

  const saved = await Order.findById(order._id);

  // Payment evidence must remain intact.
  expect(saved.paymentStatus).toBe(
    'paid_after_expiry'
  );

  expect(saved.razorpayPaymentId).toBe(
    'pay_invalid_metadata_123'
  );

  // No inventory commitment should occur.
  expect(saved.orderState).toBe('expired');

  expect(saved.reservation.state).toBe(
    'released'
  );

  expect(saved.reservation.committedAt).toBeNull();

  // The order must require administrator attention.
  expect(
    saved.requiresManualRefundReview
  ).toBe(true);

  expect(saved.manualReviewNotes).toContain(
    'Invalid reservation metadata'
  );

  // Physical inventory must remain unchanged.
  for (const ingredientId of [
    baseId,
    sauceId,
    cheeseId
  ]) {

    const ingredient = await Ingredient.findById(
      ingredientId
    );

    expect(ingredient.stock).toBe(100);
    expect(ingredient.reserved).toBe(0);
  }
});

it('flags late-paid orders for manual refund review when automatic recovery fails', async () => {
  const order = await createHeldOrder(5);

  // Simulate a verified payment received after expiration.
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentStatus: 'paid_after_expiry',
        razorpayPaymentId: 'pay_worker_shortage_123',
        razorpaySignature: 'verified-test-signature',
        'reservation.expiresAt': new Date(Date.now() - 60_000)
      }
    }
  );

  // Release the expired reservation.
  const expiration = await sweepExpiredReservations();

  expect(expiration).toMatchObject({
    checked: 1,
    released: 1,
    failed: 0
  });

  // Simulate insufficient stock for recovery.
  await Ingredient.updateOne(
    { _id: sauceId },
    {
      $set: {
        stock: 4
      }
    }
  );

  // The order requires 5 units, but only 4 are available.
  const recovery = await sweepLatePaymentRecoveries();

  expect(recovery).toEqual({
    checked: 1,
    recovered: 0,
    unavailable: 1,
    failed: 0
  });

  // Verify that the order requires manual review.
  const updated = await Order.findById(order._id);

  expect(updated.requiresManualRefundReview).toBe(true);

  expect(updated.manualReviewNotes).toMatch(
    /inventory unavailable/i
  );

  // Captured payment information must remain intact.
  expect(updated.paymentStatus).toBe('paid_after_expiry');

  expect(updated.razorpayPaymentId).toBe(
    'pay_worker_shortage_123'
  );

  expect(updated.razorpaySignature).toBe(
    'verified-test-signature'
  );

  // The order must not be incorrectly fulfilled.
  expect(updated.orderState).toBe('expired');

  expect(updated.reservation.state).toBe('released');

  expect(updated.reservation.committedAt).toBeNull();

  // Inventory must not be partially deducted.
  const base = await Ingredient.findById(baseId);
  const sauce = await Ingredient.findById(sauceId);
  const cheese = await Ingredient.findById(cheeseId);

  expect(base.stock).toBe(100);
  expect(sauce.stock).toBe(4);
  expect(cheese.stock).toBe(100);

  expect(base.reserved).toBe(0);
  expect(sauce.reserved).toBe(0);
  expect(cheese.reserved).toBe(0);

  // Orders already flagged for review must not
  // be retried automatically.
  const secondSweep = await sweepLatePaymentRecoveries();

  expect(secondSweep).toEqual({
    checked: 0,
    recovered: 0,
    unavailable: 0,
    failed: 0
  });
});

it('automatically recovers a late-paid order after the expiration sweep', async () => {

  // Create two orders sharing the same ingredients.
  const latePaid = await createHeldOrder(5);
  const active = await createHeldOrder(7);

  // Simulate a verified payment received after expiration.
  await Order.updateOne(
    {
      _id: latePaid._id
    },
    {
      $set: {
        paymentStatus: 'paid_after_expiry',

        razorpayPaymentId: 'pay_worker_recovery_123',

        razorpaySignature: 'verified-test-signature',

        'reservation.expiresAt': new Date(
          Date.now() - 60_000
        )
      }
    }
  );

  // First, run the expiration sweep.
  const expirationResult =
    await sweepExpiredReservations();

  expect(expirationResult).toMatchObject({
    checked: 1,
    released: 1,
    failed: 0
  });

  // Confirm that the original reservation was released.
  const releasedOrder = await Order.findById(
    latePaid._id
  );

  expect(releasedOrder.orderState).toBe('expired');

  expect(releasedOrder.reservation.state).toBe(
    'released'
  );

  // Now run the automatic late-payment recovery sweep.
  const recoveryResult =
    await sweepLatePaymentRecoveries();

  expect(recoveryResult).toEqual({
    checked: 1,
    recovered: 1,
    unavailable: 0,
    failed: 0
  });

  // Verify the recovered order.
  const recovered = await Order.findById(
    latePaid._id
  );

  expect(recovered.paymentStatus).toBe('paid');

  expect(recovered.orderState).toBe('received');

  expect(recovered.reservation.state).toBe(
    'committed'
  );

  expect(
    recovered.reservation.committedAt
  ).toBeInstanceOf(Date);

  // Captured payment information must remain unchanged.
  expect(recovered.razorpayPaymentId).toBe(
    'pay_worker_recovery_123'
  );

  expect(recovered.razorpaySignature).toBe(
    'verified-test-signature'
  );

  // Verify the second order was not affected.
  const activeOrder = await Order.findById(
    active._id
  );

  expect(activeOrder.orderState).toBe(
    'pending_payment'
  );

  expect(activeOrder.reservation.state).toBe(
    'held'
  );

  // Verify inventory quantities.
  for (const ingredientId of [
    baseId,
    sauceId,
    cheeseId
  ]) {

    const ingredient = await Ingredient.findById(
      ingredientId
    );

    // Recovery consumed 5 physical units.
    expect(ingredient.stock).toBe(95);

    // The active order still reserves its 7 units.
    expect(ingredient.reserved).toBe(7);
  }

  // Recovery must not process the same order again.
  const secondSweep =
    await sweepLatePaymentRecoveries();

  expect(secondSweep).toMatchObject({
    checked: 0,
    recovered: 0,
    unavailable: 0,
    failed: 0
  });
});

it('sweeps expired orders without releasing active reservations', async () => {
  const expiredOrder = await createHeldOrder(5);
  const activeOrder = await createHeldOrder(7);

  // Only the first reservation has reached its deadline.
  await Order.updateOne(
    { _id: expiredOrder._id },
    {
      $set: {
        'reservation.expiresAt': new Date(Date.now() - 60_000)
      }
    }
  );

  const firstSweep = await sweepExpiredReservations();

  expect(firstSweep).toEqual({
    checked: 1,
    released: 1,
    failed: 0
  });

  const expired = await Order.findById(expiredOrder._id);
  const active = await Order.findById(activeOrder._id);

  expect(expired.orderState).toBe('expired');
  expect(expired.reservation.state).toBe('released');
  expect(expired.reservation.releasedAt).toBeInstanceOf(Date);

  // The active order must remain untouched.
  expect(active.orderState).toBe('pending_payment');
  expect(active.reservation.state).toBe('held');

  // Physical stock stays unchanged.
  // Only the active order's 7 units remain reserved.
  for (const id of [baseId, sauceId, cheeseId]) {
    const ingredient = await Ingredient.findById(id);

    expect(ingredient.stock).toBe(100);
    expect(ingredient.reserved).toBe(7);
  }

  // Running the worker again must not release inventory twice.
  expect(await sweepExpiredReservations()).toEqual({
    checked: 0,
    released: 0,
    failed: 0
  });
});

it('does not expire or release inventory for paid orders', async () => {
  const order = await createHeldOrder(5);

  // Simulate an expired reservation with successful payment.
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentStatus: 'paid',
        'reservation.expiresAt': new Date(Date.now() - 60000)
      }
    }
  );

  // Attempt to expire the paid order.
  const result = await expireOrderReservation(order._id);

  expect(result.success).toBe(true);
  expect(result.expired).toBe(false);
  expect(result.reason).toBe('not_eligible');

  // Verify the order was not expired.
  const updatedOrder = await Order.findById(order._id);

  expect(updatedOrder.orderState).toBe('pending_payment');
  expect(updatedOrder.paymentStatus).toBe('paid');
  expect(updatedOrder.reservation.state).toBe('held');
  expect(updatedOrder.reservation.releasedAt).toBeNull();

  // Verify inventory was not released.
  const base = await Ingredient.findById(baseId);
  const sauce = await Ingredient.findById(sauceId);
  const cheese = await Ingredient.findById(cheeseId);

  expect(base.reserved).toBe(5);
  expect(sauce.reserved).toBe(5);
  expect(cheese.reserved).toBe(5);
});

it('releases expired late-paid inventory once without altering captured payment', async () => {
  const order = await createHeldOrder(5);
  const paymentId = 'pay_late_test_123';
  const signature = 'late-payment-test-signature';

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentStatus: 'paid_after_expiry',
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
        'reservation.expiresAt': new Date(Date.now() - 60000)
      }
    }
  );

  const eligibleOrders = await Order.findExpiredReservations();

  expect(
    eligibleOrders.some(o => o._id.equals(order._id))
  ).toBe(true);

  // First expiration should release inventory.
  const first = await expireOrderReservation(order._id);

  expect(first.expired).toBe(true);
  expect(first.releasedCount).toBe(3);

  // Verify the order and captured payment remain intact.
  const updated = await Order.findById(order._id);

  expect(updated.orderState).toBe('expired');
  expect(updated.paymentStatus).toBe('paid_after_expiry');
  expect(updated.razorpayPaymentId).toBe(paymentId);
  expect(updated.razorpaySignature).toBe(signature);

  expect(updated.reservation.state).toBe('released');
  expect(updated.reservation.releasedAt).toBeInstanceOf(Date);

  // Second expiration must not release inventory again.
  const repeated = await expireOrderReservation(order._id);

  expect(repeated.expired).toBe(false);
  expect(repeated.reason).toBe('not_eligible');

  // Verify physical stock is unchanged and reservations are cleared.
  for (const id of [baseId, sauceId, cheeseId]) {
    const ingredient = await Ingredient.findById(id);

    expect(ingredient.stock).toBe(100);
    expect(ingredient.reserved).toBe(0);
  }
});

it('rolls back expiration when inventory release fails', async () => {
  // Create an order holding 5 units of each ingredient.
  const order = await createHeldOrder(5);

  // Make the reservation eligible for expiration.
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'reservation.expiresAt': new Date(Date.now() - 60000)
      }
    }
  );

  // Deliberately corrupt the sauce reservation counter.
  // The order expects 5 reserved units, but inventory has 0.
  await Ingredient.updateOne(
    { _id: sauceId },
    {
      $set: {
        reserved: 0
      }
    }
  );

  // Expiration must fail because inventory invariants are violated.
  await expect(
    expireOrderReservation(order._id)
  ).rejects.toThrow(/invariant violated/i);

  // Verify the order was NOT expired.
  const updatedOrder = await Order.findById(order._id);

  expect(updatedOrder.orderState).toBe('pending_payment');
  expect(updatedOrder.paymentStatus).toBe('pending_gateway');

  // Reservation must remain held.
  expect(updatedOrder.reservation.state).toBe('held');
  expect(updatedOrder.reservation.releasedAt).toBeNull();

  // Verify no partial inventory release was committed.
  const base = await Ingredient.findById(baseId);
  const sauce = await Ingredient.findById(sauceId);
  const cheese = await Ingredient.findById(cheeseId);

  expect(base.reserved).toBe(5);
  expect(sauce.reserved).toBe(0);
  expect(cheese.reserved).toBe(5);

  // Physical stock must remain unchanged.
  expect(base.stock).toBe(100);
  expect(sauce.stock).toBe(100);
  expect(cheese.stock).toBe(100);
});

});

describe('Concurrency Protection', () => {
  let baseId, sauceId, cheeseId;
  
  beforeEach(async () => {
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
  
  it('should prevent overselling with concurrent reservations', async () => {
    const items = [{
      quantity: 60,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    // Start two concurrent reservations
    const promise1 = reserveInventory(items);
    const promise2 = reserveInventory(items);
    
    const results = await Promise.allSettled([promise1, promise2]);
    
    // One should succeed, one should fail
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    
    // Verify only 60 units reserved, not 120
    const base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(60);
  });
  
  it('should handle multiple concurrent small reservations correctly', async () => {
    const items = [{
      quantity: 10,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    // Start 5 concurrent reservations
    const promises = Array(5).fill(null).map(() => reserveInventory(items));
    
    const results = await Promise.allSettled(promises);
    
    const successes = results.filter(r => r.status === 'fulfilled');
    
    // All should succeed with retries (5 * 10 = 50, well within 100 stock)
    expect(successes.length).toBe(5);
    
    // Verify exactly 50 units reserved
    const base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(50);
  });
  
  it('should handle concurrent reservations near stock limit', async () => {
    const items = [{
      quantity: 95,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    // Start 3 concurrent reservations (only 1 can succeed)
    const promises = Array(3).fill(null).map(() => reserveInventory(items));
    
    const results = await Promise.allSettled(promises);
    
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
    
    const base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(95);
  });
  
  it('should maintain invariant: 0 <= reserved <= stock', async () => {
    // Set up scenario with partial stock
    await Ingredient.updateOne(
      { _id: baseId },
      { stock: 50, reserved: 25 }
    );
    
    const items = [{
      quantity: 20,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    // Multiple concurrent attempts
    const promises = Array(3).fill(null).map(() => reserveInventory(items));
    
    await Promise.allSettled(promises);
    
    const base = await Ingredient.findById(baseId);
    
    // Invariant must hold
    expect(base.reserved).toBeGreaterThanOrEqual(0);
    expect(base.reserved).toBeLessThanOrEqual(base.stock);
  });
});

describe('Transaction Rollback', () => {
  let baseId, sauceId, cheeseId, vegId;
  
  beforeEach(async () => {
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
      stock: 10,
      reserved: 0,
      isActive: true
    });
    vegId = veg._id;
  });
  
  it('should rollback when last ingredient has insufficient stock', async () => {
    const items = [{
      quantity: 15, // veg only has 10 stock
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: [{ ingredientId: vegId }]
    }];
    
    await expect(reserveInventory(items)).rejects.toThrow(/Insufficient stock/);
    
    // Verify no ingredients were reserved (complete rollback)
    const base = await Ingredient.findById(baseId);
    const sauce = await Ingredient.findById(sauceId);
    const cheese = await Ingredient.findById(cheeseId);
    const veg = await Ingredient.findById(vegId);
    
    expect(base.reserved).toBe(0);
    expect(sauce.reserved).toBe(0);
    expect(cheese.reserved).toBe(0);
    expect(veg.reserved).toBe(0);
  });
  
  it('should rollback when middle ingredient fails', async () => {
    // Deactivate sauce
    await Ingredient.updateOne(
      { _id: sauceId },
      { isActive: false }
    );
    
    const items = [{
      quantity: 10,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId }, // Inactive
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    await expect(reserveInventory(items)).rejects.toThrow(/Inactive ingredients/);
    
    // Verify no reservation
    const base = await Ingredient.findById(baseId);
    const cheese = await Ingredient.findById(cheeseId);
    
    expect(base.reserved).toBe(0);
    expect(cheese.reserved).toBe(0);
  });
  
  it('should maintain consistency across failed transactions', async () => {
    // Perform several failed reservations
    const items1 = [{
      quantity: 150, // Too much
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    const items2 = [{
      quantity: 10,
      base: { ingredientId: new mongoose.Types.ObjectId() }, // Non-existent
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    await expect(reserveInventory(items1)).rejects.toThrow();
    await expect(reserveInventory(items2)).rejects.toThrow();
    
    // Now perform successful reservation
    const items3 = [{
      quantity: 10,
      base: { ingredientId: baseId },
      sauce: { ingredientId: sauceId },
      cheese: { ingredientId: cheeseId },
      vegetables: []
    }];
    
    const result = await reserveInventory(items3);
    expect(result.success).toBe(true);
    
    // Verify only successful reservation applied
    const base = await Ingredient.findById(baseId);
    expect(base.reserved).toBe(10);
  });
});
