// SUNNYS Pizza — Admin Threshold Configuration Integration Tests
// Tests configurable low-stock thresholds

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../server/src/app.js';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Ingredient from '../../server/src/models/Ingredient.js';
import User from '../../server/src/models/User.js';
import {
  getAlertState,
  resetAlertState,
  checkAndNotify
} from '../../server/src/services/lowStockNotification.js';

let mongoServer;
let agent;
let csrfToken;
let testIngredient;

beforeAll(async () => {
  // Start in-memory MongoDB replica set
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Create admin user
  const admin = new User({
    email: 'admin@sunnys.local',
    password: 'SecureAdminPassword123!',
    isVerified: true,
    role: 'admin'
  });
  await admin.save();

  // Create agent to maintain cookies across requests
  agent = request.agent(app);

  // Get initial CSRF token
  const firstCsrf = await agent.get('/api/auth/csrf-token').expect(200);

  // Login as admin
  await agent
    .post('/api/auth/admin-login')
    .set('x-csrf-token', firstCsrf.body.csrfToken)
    .send({ email: 'admin@sunnys.local', password: 'SecureAdminPassword123!' })
    .expect(200);

  // Get fresh CSRF token for authenticated session
  const freshCsrf = await agent.get('/api/auth/csrf-token').expect(200);
  csrfToken = freshCsrf.body.csrfToken;
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clear ingredients and reset alert state
  await Ingredient.deleteMany({});
  resetAlertState();
  
  testIngredient = await Ingredient.create({
    name: 'Test Mozzarella',
    category: 'cheese',
    pricePaise: 8000,
    stock: 50,
    reserved: 10,
    lowStockThreshold: 15,
    isActive: true
  });
});

describe('Threshold Configuration', () => {
  describe('Authorization', () => {
    it('should reject non-authenticated requests', async () => {
      const res = await request(app)
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 20 });

      expect(res.status).toBe(401);
    });

    it('should reject requests without CSRF token', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .send({ lowStockThreshold: 20 });

      expect(res.status).toBe(403);
    });
  });

  describe('Validation', () => {
    it('should reject invalid ingredient ID format', async () => {
      const res = await agent
        .patch('/api/admin/ingredients/invalid-id/threshold')
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 20 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    });

    it('should reject negative threshold', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: -5 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_THRESHOLD');
    });

    it('should reject non-integer threshold', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 15.5 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_THRESHOLD');
    });

    it('should return 404 for non-existent ingredient', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await agent
        .patch(`/api/admin/ingredients/${fakeId}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 20 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Threshold Updates', () => {
    it('should successfully increase threshold', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 25 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Threshold updated successfully');
      expect(res.body.ingredient.lowStockThreshold).toBe(25);
      expect(res.body.ingredient.available).toBe(40);

      // Verify in database
      const updated = await Ingredient.findById(testIngredient._id);
      expect(updated.lowStockThreshold).toBe(25);
    });

    it('should successfully decrease threshold', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 5 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.lowStockThreshold).toBe(5);
      expect(res.body.ingredient.available).toBe(40);

      // Verify in database
      const updated = await Ingredient.findById(testIngredient._id);
      expect(updated.lowStockThreshold).toBe(5);
    });

    it('should allow threshold to be zero', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 0 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.lowStockThreshold).toBe(0);
    });

    it('should correctly update isLowStock status', async () => {
      // Current: stock=50, reserved=10, available=40, threshold=15
      // Not low stock (40 > 15)
      
      // Increase threshold to 50 (40 <= 50)
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 50 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.available).toBe(40);
      expect(res.body.ingredient.lowStockThreshold).toBe(50);
      expect(res.body.ingredient.isLowStock).toBe(true);
    });

    it('should preserve stock and reserved quantities', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 25 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.stock).toBe(50);
      expect(res.body.ingredient.reserved).toBe(10);
    });

    it('should update timestamp', async () => {
      const originalUpdatedAt = testIngredient.updatedAt;
      
      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 20 });

      expect(res.status).toBe(200);
      expect(new Date(res.body.ingredient.updatedAt).getTime())
        .toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('Alert State Management', () => {
    it('should clear alert state when threshold increase makes ingredient adequate', async () => {
      // Set ingredient to low stock and trigger alert
      testIngredient.stock = 20;
      testIngredient.reserved = 5;
      // available = 15, threshold = 15, isLowStock = true
      await testIngredient.save();

      await checkAndNotify();
      let alertState = getAlertState();
      expect(alertState).toHaveLength(1);

      // Increase threshold to 5 (available 15 > 5, no longer low)
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 5 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.isLowStock).toBe(false);

      // Alert state should be cleared
      alertState = getAlertState();
      expect(alertState).toHaveLength(0);
    });

    it('should NOT clear alert state when ingredient remains low after threshold change', async () => {
      // Set ingredient to low stock
      testIngredient.stock = 20;
      testIngredient.reserved = 5;
      testIngredient.lowStockThreshold = 15;
      // available = 15, isLowStock = true
      await testIngredient.save();

      await checkAndNotify();
      let alertState = getAlertState();
      expect(alertState).toHaveLength(1);

      // Increase threshold to 20 (available 15 <= 20, still low)
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 20 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.isLowStock).toBe(true);

      // Alert state should NOT be cleared (prevents duplicate alert)
      alertState = getAlertState();
      expect(alertState).toHaveLength(1);
    });

    it('should allow new alert after threshold decrease triggers low stock', async () => {
      // Start with adequate stock
      testIngredient.stock = 50;
      testIngredient.reserved = 10;
      testIngredient.lowStockThreshold = 15;
      // available = 40, not low
      await testIngredient.save();

      // Increase threshold to 50 (makes it low stock)
      await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 50 });

      // Should trigger new alert
      const result = await checkAndNotify();
      expect(result.alerted).toBe(true);
    });
  });

  describe('Stock Update Alert Behavior', () => {
    it('should NOT clear alert state when stock update keeps ingredient low', async () => {
      // Set to low stock
      testIngredient.stock = 18;
      testIngredient.reserved = 5;
      testIngredient.lowStockThreshold = 15;
      // available = 13, low stock
      await testIngredient.save();

      await checkAndNotify();
      let alertState = getAlertState();
      expect(alertState).toHaveLength(1);

      // Update stock but keep it low (new available = 15, still <= 15)
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 20 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.available).toBe(15);
      expect(res.body.ingredient.isLowStock).toBe(true);

      // Alert state should NOT be cleared
      alertState = getAlertState();
      expect(alertState).toHaveLength(1);

      // Should not send duplicate alert
      const result = await checkAndNotify();
      expect(result.alerted).toBe(false);
      expect(result.reason).toBe('already_alerted');
    });

    it('should clear alert state when stock update makes ingredient adequate', async () => {
      // Set to low stock
      testIngredient.stock = 18;
      testIngredient.reserved = 5;
      testIngredient.lowStockThreshold = 15;
      // available = 13, low stock
      await testIngredient.save();

      await checkAndNotify();
      let alertState = getAlertState();
      expect(alertState).toHaveLength(1);

      // Update stock to make it adequate (available = 45 > 15)
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 50 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.isLowStock).toBe(false);

      // Alert state should be cleared
      alertState = getAlertState();
      expect(alertState).toHaveLength(0);
    });
  });

  describe('Scheduler Integration', () => {
    it('should respect updated thresholds in scheduled checks', async () => {
      // Set initial adequate stock
      testIngredient.stock = 50;
      testIngredient.reserved = 10;
      testIngredient.lowStockThreshold = 15;
      // available = 40, not low
      await testIngredient.save();

      let result = await checkAndNotify();
      expect(result.reason).toBe('stock_adequate');

      // Update threshold to trigger low stock
      await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/threshold`)
        .set('x-csrf-token', csrfToken)
        .send({ lowStockThreshold: 45 });

      // Next scheduled check should detect low stock
      result = await checkAndNotify();
      expect(result.alerted).toBe(true);
      expect(result.itemCount).toBe(1);
    });

    it('should use available quantity (stock - reserved) for threshold comparison', async () => {
      testIngredient.stock = 30;
      testIngredient.reserved = 20;
      testIngredient.lowStockThreshold = 15;
      // available = 10, low stock (10 <= 15)
      await testIngredient.save();

      const result = await checkAndNotify();
      expect(result.alerted).toBe(true);
    });
  });
});
