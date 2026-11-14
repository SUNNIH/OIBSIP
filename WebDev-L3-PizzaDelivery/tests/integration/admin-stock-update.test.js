// SUNNYS Pizza — Admin Stock Update Integration Tests
// Tests manual inventory stock updates via admin endpoint

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
  // Clear and create test ingredient
  await Ingredient.deleteMany({});
  
  testIngredient = await Ingredient.create({
    name: 'Test Cheese',
    category: 'cheese',
    pricePaise: 8000,
    stock: 100,
    reserved: 20,
    lowStockThreshold: 15
  });
});

describe('Admin Stock Update', () => {
  describe('Authorization', () => {
    it('should reject non-authenticated requests', async () => {
      const res = await request(app)
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 150 });

      expect(res.status).toBe(401);
    });

    it('should reject requests without CSRF token', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .send({ stock: 150 });

      expect(res.status).toBe(403);
    });
  });

  describe('Validation', () => {
    it('should reject invalid ingredient ID format', async () => {
      const res = await agent
        .patch('/api/admin/ingredients/invalid-id/stock')
        .set('x-csrf-token', csrfToken)
        .send({ stock: 150 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    });

    it('should reject negative stock', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STOCK');
    });

    it('should reject non-integer stock', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 150.5 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STOCK');
    });

    it('should reject stock less than reserved quantity', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 10 }); // Less than reserved (20)

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STOCK_BELOW_RESERVED');
      expect(res.body.error.message).toContain('20');
    });

    it('should return 404 for non-existent ingredient', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await agent
        .patch(`/api/admin/ingredients/${fakeId}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 150 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Stock Update Operations', () => {
    it('should successfully increase stock', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 200 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Stock updated successfully');
      expect(res.body.ingredient.stock).toBe(200);
      expect(res.body.ingredient.reserved).toBe(20);
      expect(res.body.ingredient.available).toBe(180);

      // Verify in database
      const updated = await Ingredient.findById(testIngredient._id);
      expect(updated.stock).toBe(200);
      expect(updated.reserved).toBe(20);
    });

    it('should successfully decrease stock (within valid range)', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 50 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.stock).toBe(50);
      expect(res.body.ingredient.reserved).toBe(20);
      expect(res.body.ingredient.available).toBe(30);

      // Verify in database
      const updated = await Ingredient.findById(testIngredient._id);
      expect(updated.stock).toBe(50);
    });

    it('should allow stock equal to reserved', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 20 }); // Equal to reserved

      expect(res.status).toBe(200);
      expect(res.body.ingredient.stock).toBe(20);
      expect(res.body.ingredient.reserved).toBe(20);
      expect(res.body.ingredient.available).toBe(0);
    });

    it('should preserve reserved quantity', async () => {
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 150 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.reserved).toBe(20); // Unchanged
    });

    it('should correctly calculate isLowStock', async () => {
      // Set stock to make available <= lowStockThreshold
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 30 }); // available = 30-20 = 10, threshold = 15

      expect(res.status).toBe(200);
      expect(res.body.ingredient.available).toBe(10);
      expect(res.body.ingredient.isLowStock).toBe(true);
    });

    it('should update timestamp', async () => {
      const originalUpdatedAt = testIngredient.updatedAt;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 150 });

      expect(res.status).toBe(200);
      expect(new Date(res.body.ingredient.updatedAt).getTime())
        .toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('Concurrency Safety', () => {
    it('should maintain stock >= reserved invariant during updates', async () => {
      // Update stock while reserved exists
      const res = await agent
        .patch(`/api/admin/ingredients/${testIngredient._id}/stock`)
        .set('x-csrf-token', csrfToken)
        .send({ stock: 25 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.stock).toBe(25);
      expect(res.body.ingredient.reserved).toBe(20);
      expect(res.body.ingredient.available).toBe(5);

      // Verify invariant in database
      const updated = await Ingredient.findById(testIngredient._id);
      expect(updated.stock).toBeGreaterThanOrEqual(updated.reserved);
    });
  });
});
