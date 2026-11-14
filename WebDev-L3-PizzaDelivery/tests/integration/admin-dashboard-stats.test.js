// SUNNYS Pizza — Admin Dashboard Statistics Integration Tests
// Tests for accurate inventory statistics calculation

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../server/src/app.js';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Ingredient from '../../server/src/models/Ingredient.js';
import User from '../../server/src/models/User.js';

let mongoServer;
let agent;
let csrfToken;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  const admin = new User({
    email: 'admin@sunnys.local',
    password: 'SecureAdminPassword123!',
    isVerified: true,
    role: 'admin'
  });
  await admin.save();

  agent = request.agent(app);
  const firstCsrf = await agent.get('/api/auth/csrf-token').expect(200);
  await agent
    .post('/api/auth/admin-login')
    .set('x-csrf-token', firstCsrf.body.csrfToken)
    .send({ email: 'admin@sunnys.local', password: 'SecureAdminPassword123!' })
    .expect(200);
  const freshCsrf = await agent.get('/api/auth/csrf-token').expect(200);
  csrfToken = freshCsrf.body.csrfToken;
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Ingredient.deleteMany({});
});

describe('Dashboard Inventory Statistics', () => {
  it('should correctly calculate low-stock count with reserved quantities', async () => {
    await Ingredient.create([
      {
        name: 'Low Stock Item',
        category: 'cheese',
        pricePaise: 8000,
        stock: 25,
        reserved: 15, // available = 10
        lowStockThreshold: 12, // 10 <= 12, low stock
        isActive: true
      },
      {
        name: 'Adequate Stock Item',
        category: 'sauce',
        pricePaise: 5000,
        stock: 50,
        reserved: 10, // available = 40
        lowStockThreshold: 20, // 40 > 20, not low
        isActive: true
      }
    ]);

    const res = await agent
      .get('/api/admin/dashboard/stats')
      .expect(200);

    expect(res.body.lowStockCount).toBe(1);
  });

  it('should count items at threshold boundary as low stock', async () => {
    await Ingredient.create({
      name: 'Boundary Item',
      category: 'cheese',
      pricePaise: 8000,
      stock: 30,
      reserved: 10, // available = 20
      lowStockThreshold: 20, // 20 <= 20, low stock
      isActive: true
    });

    const res = await agent
      .get('/api/admin/dashboard/stats')
      .expect(200);

    expect(res.body.lowStockCount).toBe(1);
  });

  it('should exclude inactive ingredients from low-stock count', async () => {
    await Ingredient.create([
      {
        name: 'Inactive Low Stock',
        category: 'cheese',
        pricePaise: 8000,
        stock: 5,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: false // inactive
      },
      {
        name: 'Active Low Stock',
        category: 'sauce',
        pricePaise: 5000,
        stock: 5,
        reserved: 0,
        lowStockThreshold: 10,
        isActive: true
      }
    ]);

    const res = await agent
      .get('/api/admin/dashboard/stats')
      .expect(200);

    expect(res.body.lowStockCount).toBe(1); // Only active one
  });

  it('should include out-of-stock items in low-stock count', async () => {
    await Ingredient.create({
      name: 'Out of Stock',
      category: 'cheese',
      pricePaise: 8000,
      stock: 20,
      reserved: 20, // available = 0
      lowStockThreshold: 10, // 0 <= 10, low stock
      isActive: true
    });

    const res = await agent
      .get('/api/admin/dashboard/stats')
      .expect(200);

    expect(res.body.lowStockCount).toBe(1);
  });

  it('should respect individual configurable thresholds', async () => {
    await Ingredient.create([
      {
        name: 'High Threshold Item',
        category: 'cheese',
        pricePaise: 8000,
        stock: 60,
        reserved: 10, // available = 50
        lowStockThreshold: 55, // 50 <= 55, low stock
        isActive: true
      },
      {
        name: 'Low Threshold Item',
        category: 'sauce',
        pricePaise: 5000,
        stock: 15,
        reserved: 5, // available = 10
        lowStockThreshold: 5, // 10 > 5, not low
        isActive: true
      }
    ]);

    const res = await agent
      .get('/api/admin/dashboard/stats')
      .expect(200);

    expect(res.body.lowStockCount).toBe(1); // Only high-threshold item
  });

  it('should update after stock adjustments', async () => {
    const ingredient = await Ingredient.create({
      name: 'Dynamic Stock',
      category: 'cheese',
      pricePaise: 8000,
      stock: 18,
      reserved: 5, // available = 13
      lowStockThreshold: 15, // 13 <= 15, low stock
      isActive: true
    });

    let res = await agent.get('/api/admin/dashboard/stats').expect(200);
    expect(res.body.lowStockCount).toBe(1);

    // Increase stock
    await agent
      .patch(`/api/admin/ingredients/${ingredient._id}/stock`)
      .set('x-csrf-token', csrfToken)
      .send({ stock: 25 }); // available = 20, no longer low

    res = await agent.get('/api/admin/dashboard/stats').expect(200);
    expect(res.body.lowStockCount).toBe(0);
  });

  it('should update after threshold changes', async () => {
    const ingredient = await Ingredient.create({
      name: 'Dynamic Threshold',
      category: 'cheese',
      pricePaise: 8000,
      stock: 50,
      reserved: 10, // available = 40
      lowStockThreshold: 30, // 40 > 30, not low
      isActive: true
    });

    let res = await agent.get('/api/admin/dashboard/stats').expect(200);
    expect(res.body.lowStockCount).toBe(0);

    // Increase threshold
    await agent
      .patch(`/api/admin/ingredients/${ingredient._id}/threshold`)
      .set('x-csrf-token', csrfToken)
      .send({ lowStockThreshold: 45 }); // 40 <= 45, now low

    res = await agent.get('/api/admin/dashboard/stats').expect(200);
    expect(res.body.lowStockCount).toBe(1);
  });

  it('should handle zero threshold correctly', async () => {
    await Ingredient.create({
      name: 'Zero Threshold',
      category: 'cheese',
      pricePaise: 8000,
      stock: 0,
      reserved: 0, // available = 0
      lowStockThreshold: 0, // 0 <= 0, low stock
      isActive: true
    });

    const res = await agent.get('/api/admin/dashboard/stats').expect(200);
    expect(res.body.lowStockCount).toBe(1);
  });
});
