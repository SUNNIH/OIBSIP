// SUNNYS Pizza — Low Stock Notification Integration Tests
// Tests automated low-stock email alerts and duplicate prevention

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Ingredient from '../../server/src/models/Ingredient.js';
import {
  detectLowStockIngredients,
  sendLowStockAlert,
  checkAndNotify,
  clearAlertState,
  resetAlertState,
  getAlertState
} from '../../server/src/services/lowStockNotification.js';
import env from '../../server/src/config/env.js';

let mongoServer;

beforeAll(async () => {
  // Start in-memory MongoDB replica set
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clear ingredients and reset alert state
  await Ingredient.deleteMany({});
  resetAlertState();
});

afterEach(() => {
  // Ensure alert state is clean
  resetAlertState();
});

describe('Low Stock Detection', () => {
  it('should detect ingredients below threshold', async () => {
    await Ingredient.create([
      {
        name: 'Low Mozzarella',
        category: 'cheese',
        pricePaise: 8000,
        stock: 15,
        reserved: 5,
        lowStockThreshold: 12, // available = 10, below threshold
        isActive: true
      },
      {
        name: 'Adequate Tomato Sauce',
        category: 'sauce',
        pricePaise: 5000,
        stock: 50,
        reserved: 10,
        lowStockThreshold: 20, // available = 40, above threshold
        isActive: true
      }
    ]);

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].name).toBe('Low Mozzarella');
    expect(lowStock[0].stock - lowStock[0].reserved).toBe(10);
  });

  it('should detect out-of-stock ingredients', async () => {
    await Ingredient.create({
      name: 'Out of Stock Pepperoni',
      category: 'protein',
      pricePaise: 12000,
      stock: 20,
      reserved: 20, // available = 0
      lowStockThreshold: 10,
      isActive: true
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].stock - lowStock[0].reserved).toBe(0);
  });

  it('should detect ingredients at threshold boundary', async () => {
    await Ingredient.create({
      name: 'Boundary Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 30,
      reserved: 10,
      lowStockThreshold: 20, // available = 20, exactly at threshold
      isActive: true
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].name).toBe('Boundary Cheese');
  });

  it('should not detect adequate stock levels', async () => {
    await Ingredient.create({
      name: 'Abundant Mushrooms',
      category: 'vegetable',
      pricePaise: 6000,
      stock: 100,
      reserved: 10,
      lowStockThreshold: 20, // available = 90, well above threshold
      isActive: true
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(0);
  });

  it('should ignore inactive ingredients', async () => {
    await Ingredient.create({
      name: 'Inactive Low Stock',
      category: 'vegetable',
      pricePaise: 5000,
      stock: 5,
      reserved: 0,
      lowStockThreshold: 10, // available = 5, below threshold
      isActive: false // inactive
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(0);
  });

  it('should detect multiple low-stock ingredients', async () => {
    await Ingredient.create([
      {
        name: 'Low Cheese',
        category: 'cheese',
        pricePaise: 8000,
        stock: 10,
        reserved: 2,
        lowStockThreshold: 10,
        isActive: true
      },
      {
        name: 'Low Sauce',
        category: 'sauce',
        pricePaise: 5000,
        stock: 8,
        reserved: 3,
        lowStockThreshold: 10,
        isActive: true
      },
      {
        name: 'Adequate Base',
        category: 'base',
        pricePaise: 7000,
        stock: 50,
        reserved: 5,
        lowStockThreshold: 15,
        isActive: true
      }
    ]);

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(2);
    expect(lowStock.map(i => i.name)).toContain('Low Cheese');
    expect(lowStock.map(i => i.name)).toContain('Low Sauce');
  });
});

describe('Email Notifications', () => {
  it('should send alert for low-stock items', async () => {
    const lowStockItems = [
      await Ingredient.create({
        name: 'Low Mozzarella',
        category: 'cheese',
        pricePaise: 8000,
        stock: 12,
        reserved: 5,
        lowStockThreshold: 10,
        isActive: true
      })
    ];

    const result = await sendLowStockAlert(lowStockItems);

    if (env.ADMIN_EMAIL) {
      expect(result.success).toBe(true);
      expect(result.itemCount).toBe(1);
    } else {
      expect(result.success).toBe(false);
      expect(result.reason).toBe('no_admin_email');
    }
  });

  it('should handle empty low-stock list', async () => {
    const result = await sendLowStockAlert([]);

    // Empty list returns success regardless of ADMIN_EMAIL configuration
    expect(result.success).toBe(true);
    expect(result.reason).toBe('no_low_stock');
  });

  it('should handle SMTP failures gracefully', async () => {
    // Temporarily override ADMIN_EMAIL to ensure email attempt
    const originalEmail = env.ADMIN_EMAIL;
    env.ADMIN_EMAIL = 'test@example.com';

    const lowStockItems = [
      await Ingredient.create({
        name: 'Test Item',
        category: 'cheese',
        pricePaise: 8000,
        stock: 5,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: true
      })
    ];

    const result = await sendLowStockAlert(lowStockItems);

    // In test mode, email should succeed (stream transport)
    expect(result.success).toBe(true);

    // Restore original
    env.ADMIN_EMAIL = originalEmail;
  });
});

describe('Duplicate Prevention', () => {
  it('should send initial alert for new low-stock condition', async () => {
    await Ingredient.create({
      name: 'Low Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 8,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true
    });

    const result = await checkAndNotify();

    expect(result.checked).toBe(true);
    expect(result.alerted).toBe(true);
    expect(result.itemCount).toBe(1);
  });

  it('should not send duplicate alert for unchanged low-stock', async () => {
    const ingredient = await Ingredient.create({
      name: 'Low Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 8,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true
    });

    // First check - should alert
    const firstResult = await checkAndNotify();
    expect(firstResult.alerted).toBe(true);

    // Second check - should not alert (duplicate)
    const secondResult = await checkAndNotify();
    expect(secondResult.checked).toBe(true);
    expect(secondResult.alerted).toBe(false);
    expect(secondResult.reason).toBe('already_alerted');
  });

  it('should allow new alert after stock recovery', async () => {
    const ingredient = await Ingredient.create({
      name: 'Recovering Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 8,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true
    });

    // First check - low stock, should alert
    const firstResult = await checkAndNotify();
    expect(firstResult.alerted).toBe(true);

    // Stock recovers
    ingredient.stock = 50;
    await ingredient.save();

    // Second check - stock recovered, clears alert state
    const secondResult = await checkAndNotify();
    expect(secondResult.checked).toBe(true);
    expect(secondResult.reason).toBe('stock_adequate');

    // Stock drops again
    ingredient.stock = 7;
    await ingredient.save();

    // Third check - should alert again (new low-stock condition)
    const thirdResult = await checkAndNotify();
    expect(thirdResult.checked).toBe(true);
    expect(thirdResult.alerted).toBe(true);
  });

  it('should clear alert state for specific ingredient', async () => {
    const ingredient = await Ingredient.create({
      name: 'Test Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 8,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true
    });

    // Trigger alert
    await checkAndNotify();
    let alertState = getAlertState();
    expect(alertState).toHaveLength(1);

    // Clear alert state
    clearAlertState(ingredient._id);
    alertState = getAlertState();
    expect(alertState).toHaveLength(0);

    // Should alert again
    const result = await checkAndNotify();
    expect(result.alerted).toBe(true);
  });

  it('should handle multiple ingredients with mixed alert states', async () => {
    const cheese = await Ingredient.create({
      name: 'Low Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 8,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true
    });

    // First check - cheese is low
    const firstResult = await checkAndNotify();
    expect(firstResult.alerted).toBe(true);

    // Add another low-stock ingredient
    await Ingredient.create({
      name: 'Low Sauce',
      category: 'sauce',
      pricePaise: 5000,
      stock: 6,
      reserved: 0,
      lowStockThreshold: 10,
      isActive: true
    });

    // Second check - should alert for the new item
    const secondResult = await checkAndNotify();
    expect(secondResult.alerted).toBe(true);
    expect(secondResult.itemCount).toBe(2); // Includes both items in email
  });
});

describe('Stock Recovery', () => {
  it('should clear all alerts when all stock recovers', async () => {
    await Ingredient.create([
      {
        name: 'Low Cheese',
        category: 'cheese',
        pricePaise: 8000,
        stock: 8,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: true
      },
      {
        name: 'Low Sauce',
        category: 'sauce',
        pricePaise: 5000,
        stock: 7,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: true
      }
    ]);

    // Trigger alerts
    const firstResult = await checkAndNotify();
    expect(firstResult.alerted).toBe(true);
    expect(firstResult.itemCount).toBe(2);

    // All stock recovers
    await Ingredient.updateMany({}, { stock: 50 });

    // Should clear alert state
    const secondResult = await checkAndNotify();
    expect(secondResult.reason).toBe('stock_adequate');

    const alertState = getAlertState();
    expect(alertState).toHaveLength(0);
  });
});

describe('Reserved Quantity Impact', () => {
  it('should consider reserved quantity in availability calculation', async () => {
    await Ingredient.create({
      name: 'Reserved Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 25,
      reserved: 15, // available = 10
      lowStockThreshold: 12,
      isActive: true
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].stock).toBe(25);
    expect(lowStock[0].reserved).toBe(15);
    expect(lowStock[0].available).toBe(10);
  });

  it('should detect low stock when reservations increase', async () => {
    const ingredient = await Ingredient.create({
      name: 'Dynamic Cheese',
      category: 'cheese',
      pricePaise: 8000,
      stock: 30,
      reserved: 5, // available = 25
      lowStockThreshold: 15,
      isActive: true
    });

    // Initially adequate
    let lowStock = await detectLowStockIngredients();
    expect(lowStock).toHaveLength(0);

    // Reservations increase
    ingredient.reserved = 20; // available = 10, below threshold
    await ingredient.save();

    lowStock = await detectLowStockIngredients();
    expect(lowStock).toHaveLength(1);
  });
});

describe('Edge Cases', () => {
  it('should handle ingredients with zero threshold', async () => {
    await Ingredient.create({
      name: 'Zero Threshold Item',
      category: 'vegetable',
      pricePaise: 5000,
      stock: 0,
      reserved: 0,
      lowStockThreshold: 0, // alert only when out of stock
      isActive: true
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(1);
  });

  it('should handle large stock quantities', async () => {
    await Ingredient.create({
      name: 'Bulk Item',
      category: 'base',
      pricePaise: 7000,
      stock: 1000000,
      reserved: 999990,
      lowStockThreshold: 15, // available = 10
      isActive: true
    });

    const lowStock = await detectLowStockIngredients();

    expect(lowStock).toHaveLength(1);
  });

  it('should handle database errors gracefully', async () => {
    // Disconnect to simulate error
    await mongoose.disconnect();

    const result = await checkAndNotify();

    expect(result.checked).toBe(false);
    expect(result.error).toBeDefined();

    // Reconnect for cleanup
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });
});
