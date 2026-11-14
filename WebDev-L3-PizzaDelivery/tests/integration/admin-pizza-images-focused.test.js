/**
 * @file admin-pizza-images-focused.test.js
 * @description Focused integration tests for admin pizza image uploads.
 *
 * Test cleanup must never delete development data
 * or the application's entire uploads directory.
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
import mongoose from 'mongoose';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import app from '../../server/src/app.js';

import {
  connectDB,
  disconnectDB
} from '../../server/src/db/connection.js';

import User from '../../server/src/models/User.js';
import Pizza from '../../server/src/models/Pizza.js';
import Ingredient from '../../server/src/models/Ingredient.js';

// Application upload directory.
// Never remove this directory during test cleanup.
const UPLOAD_DIR = path.resolve(
  'server/test-uploads/pizzas'
);

// Unique identifiers prevent conflicts with other tests.
const runId = randomUUID().slice(0, 12);

const adminEmail = `focused-admin-${runId}@test.com`;
const customerEmail = `focused-customer-${runId}@test.com`;

let fixturesDir;
let adminAgent;
let customerAgent;
let testPizzaId;

// Track only records created by this test suite.
const createdUserIds = [];
const createdIngredientIds = [];

// Track only images uploaded by this test suite.
const uploadedFiles = new Set();

async function getCsrfToken(agent) {
  const response = await agent.get('/api/auth/csrf-token');

  return response.body.csrfToken;
}

// Upload an image and track it for safe cleanup.
async function uploadTestImage(agent, pizzaId, filename) {
  const csrf = await getCsrfToken(agent);

  const response = await agent
    .post(`/api/admin/pizzas/${pizzaId}/image`)
    .set('x-csrf-token', csrf)
    .attach('image', path.join(fixturesDir, filename));

  if (
    response.status === 200 &&
    response.body?.pizza?.imageUrl
  ) {
    const uploadedFilename = path.basename(
      response.body.pizza.imageUrl
    );

    uploadedFiles.add(
      path.join(UPLOAD_DIR, uploadedFilename)
    );
  }

  return response;
}

describe('Admin Pizza Image Upload - Phase 5.3B (Focused)', () => {

  beforeAll(async () => {
    await connectDB();

    const databaseName = mongoose.connection.name || '';

if (!/^(test|.+[_-]test)$/i.test(databaseName)) {
  throw new Error(
    `Image tests must use a test database. Connected to: ${databaseName}`
  );
}


    // Create a private temporary fixtures directory.
    fixturesDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sunnys-focused-images-')
    );

    // Create test ingredients with unique names.
    const base = await Ingredient.create({
      name: `Focused Thin Crust ${runId}`,
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0
    });

    createdIngredientIds.push(base._id);

    const sauce = await Ingredient.create({
      name: `Focused Tomato ${runId}`,
      category: 'sauce',
      pricePaise: 3000,
      stock: 100,
      reserved: 0
    });

    createdIngredientIds.push(sauce._id);

    const cheese = await Ingredient.create({
      name: `Focused Mozzarella ${runId}`,
      category: 'cheese',
      pricePaise: 7000,
      stock: 100,
      reserved: 0
    });

    createdIngredientIds.push(cheese._id);

    // Create one pizza belonging to this test run.
    const pizza = await Pizza.create({
      name: `Focused Test Margherita ${runId}`,
      description: 'Test pizza for image upload',
      category: 'vegetarian',
      ingredients: {
        base: base._id,
        sauce: sauce._id,
        cheese: cheese._id,
        vegetables: []
      }
    });

    testPizzaId = pizza._id.toString();

    // Create test administrator.
    const adminUser = await User.create({
      email: adminEmail,
      password: 'Admin123!@#',
      role: 'admin',
      isVerified: true
    });

    createdUserIds.push(adminUser._id);

    // Create test customer.
    const customerUser = await User.create({
      email: customerEmail,
      password: 'Customer123!@#',
      role: 'customer',
      isVerified: true
    });

    createdUserIds.push(customerUser._id);

    // Set up authenticated agents.
    adminAgent = request.agent(app);
    customerAgent = request.agent(app);

    // Administrator login.
    const adminCsrf = await getCsrfToken(adminAgent);

    const adminLoginRes = await adminAgent
      .post('/api/auth/admin-login')
      .set('x-csrf-token', adminCsrf)
      .send({
        email: adminEmail,
        password: 'Admin123!@#'
      });

    expect(adminLoginRes.status).toBe(200);

    // Customer login.
    const customerCsrf = await getCsrfToken(customerAgent);

    const customerLoginRes = await customerAgent
      .post('/api/auth/login')
      .set('x-csrf-token', customerCsrf)
      .send({
        email: customerEmail,
        password: 'Customer123!@#'
      });

    expect(customerLoginRes.status).toBe(200);

    // Create minimal JPEG fixture.
    const jpegBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0,
      0x00, 0x10, 0x4A, 0x46,
      0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48
    ]);

    await fs.writeFile(
      path.join(fixturesDir, 'test.jpg'),
      jpegBuffer
    );

    // Create minimal PNG fixture.
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47,
      0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52
    ]);

    await fs.writeFile(
      path.join(fixturesDir, 'test.png'),
      pngBuffer
    );

    // Create invalid image fixture.
    await fs.writeFile(
      path.join(fixturesDir, 'invalid.jpg'),
      Buffer.from([0x00, 0x00, 0x00, 0x00])
    );
  });

  afterAll(async () => {
    try {
      // Delete only the pizza created by this test.
      if (testPizzaId) {
        await Pizza.deleteOne({
          _id: testPizzaId
        });
      }

      // Delete only users created by this test.
      if (createdUserIds.length > 0) {
        await User.deleteMany({
          _id: {
            $in: createdUserIds
          }
        });
      }

      // Delete only ingredients created by this test.
      if (createdIngredientIds.length > 0) {
        await Ingredient.deleteMany({
          _id: {
            $in: createdIngredientIds
          }
        });
      }

    } finally {
      try {
        // Remove only images uploaded by this test.
        // Never remove the entire uploads directory.
        for (const filepath of uploadedFiles) {
          await fs.rm(filepath, {
            force: true
          });
        }

        // Remove only this test's temporary fixtures.
        if (fixturesDir) {
          await fs.rm(fixturesDir, {
            recursive: true,
            force: true
          });
        }

      } finally {
        await disconnectDB();
      }
    }
  });

  beforeEach(async () => {
    // Reset only this test pizza.
    await Pizza.findByIdAndUpdate(
      testPizzaId,
      { imageUrl: null }
    );
  });

  it('should upload valid JPEG image', async () => {
    const response = await uploadTestImage(
      adminAgent,
      testPizzaId,
      'test.jpg'
    );

    expect(response.status).toBe(200);

    expect(
      response.body.pizza.imageUrl
    ).toContain('/uploads/pizzas/');

    expect(
      response.body.pizza.imageUrl
    ).toMatch(/\.jpg$/);

    // Verify uploaded image exists.
    const filename = path.basename(
      response.body.pizza.imageUrl
    );

    const filepath = path.join(UPLOAD_DIR, filename);

    await expect(
      fs.access(filepath)
    ).resolves.toBeUndefined();
  });

  it('should reject file with invalid signature', async () => {
    const response = await uploadTestImage(
      adminAgent,
      testPizzaId,
      'invalid.jpg'
    );

    expect(response.status).toBe(400);

    expect(
      response.body.error.code
    ).toBe('INVALID_FILE_SIGNATURE');
  });

  it('should require admin role', async () => {
    const response = await uploadTestImage(
      customerAgent,
      testPizzaId,
      'test.jpg'
    );

    expect(response.status).toBe(403);
  });

  it('should delete image', async () => {
    // Upload an image first.
    const uploadRes = await uploadTestImage(
      adminAgent,
      testPizzaId,
      'test.jpg'
    );

    expect(uploadRes.status).toBe(200);

    const imageUrl = uploadRes.body.pizza.imageUrl;

    const filename = path.basename(imageUrl);

    const filepath = path.join(UPLOAD_DIR, filename);

    // Delete the uploaded image.
    const csrf = await getCsrfToken(adminAgent);

    const deleteRes = await adminAgent
      .delete(`/api/admin/pizzas/${testPizzaId}/image`)
      .set('x-csrf-token', csrf);

    expect(deleteRes.status).toBe(200);

    expect(
      deleteRes.body.pizza.imageUrl
    ).toBeNull();

    // Verify the database image reference was cleared.
    const pizza = await Pizza.findById(testPizzaId);

    expect(pizza.imageUrl).toBeNull();

    // Verify the physical image was deleted.
    await expect(
      fs.access(filepath)
    ).rejects.toThrow();
  });

  it('should list pizzas with imageUrl field', async () => {
    const response = await adminAgent.get(
      '/api/admin/pizzas'
    );

    expect(response.status).toBe(200);

    expect(
      response.body.pizzas
    ).toBeInstanceOf(Array);

    expect(
      response.body.pizzas.length
    ).toBeGreaterThan(0);

    expect(
      response.body.pizzas[0]
    ).toHaveProperty('imageUrl');
  });

});