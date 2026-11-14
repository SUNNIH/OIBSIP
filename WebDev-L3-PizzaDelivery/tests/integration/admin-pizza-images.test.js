/**
 * SUNNYS Pizza — Admin Pizza Image Integration Tests
 *
 * Tests authentication, authorization, image validation,
 * upload, replacement, deletion, and filename safety.
 *
 * Cleanup must never delete the application's upload directory.
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
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import app from '../../server/src/app.js';

import {
  connectDB,
  disconnectDB
} from '../../server/src/db/connection.js';

import User from '../../server/src/models/User.js';
import Pizza from '../../server/src/models/Pizza.js';
import Ingredient from '../../server/src/models/Ingredient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_DIR = path.join(
  __dirname,
  '../../server/test-uploads/pizzas'
);

const runId = randomUUID().slice(0, 12);

const adminEmail = `pizza-admin-${runId}@test.com`;
const customerEmail = `pizza-customer-${runId}@test.com`;

let fixturesDir;
let testPizzaId;
let adminAgent;
let customerAgent;

// Track only resources created by this test run.
const createdUserIds = [];
const createdIngredientIds = [];
const uploadedFiles = new Set();

async function getCsrfToken(agent) {
  const response = await agent.get('/api/auth/csrf-token');

  return response.body.csrfToken;
}

/**
 * Upload an image and record its filename.
 *
 * Only successful uploads are tracked for cleanup.
 * Existing application images must never be removed.
 */
async function uploadImage(
  agent,
  pizzaId,
  csrfToken,
  filePath,
  filename
) {
  const upload = agent
    .post(`/api/admin/pizzas/${pizzaId}/image`)
    .set('x-csrf-token', csrfToken);

  const response = await (
    filename
      ? upload.attach('image', filePath, filename)
      : upload.attach('image', filePath)
  );

  if (
    response.status === 200 &&
    response.body?.pizza?.imageUrl
  ) {
    uploadedFiles.add(
      path.join(
        UPLOAD_DIR,
        path.basename(response.body.pizza.imageUrl)
      )
    );
  }

  return response;
}

describe('Admin Pizza Image Upload - Phase 5.3B', () => {

  beforeAll(async () => {
    await connectDB();

    // Use a dedicated temporary directory for test fixtures.
    fixturesDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sunnys-image-test-')
    );

    // Create uniquely named test ingredients.
    const base = await Ingredient.create({
      name: `Thin Crust ${runId}`,
      category: 'base',
      pricePaise: 5000,
      stock: 100,
      reserved: 0
    });

    createdIngredientIds.push(base._id);

    const sauce = await Ingredient.create({
      name: `Tomato ${runId}`,
      category: 'sauce',
      pricePaise: 3000,
      stock: 100,
      reserved: 0
    });

    createdIngredientIds.push(sauce._id);

    const cheese = await Ingredient.create({
      name: `Mozzarella ${runId}`,
      category: 'cheese',
      pricePaise: 7000,
      stock: 100,
      reserved: 0
    });

    createdIngredientIds.push(cheese._id);

    // Create a pizza owned by this test run.
    const pizza = await Pizza.create({
      name: `Test Margherita ${runId}`,
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

    // Create a test administrator.
    const admin = await User.create({
      email: adminEmail,
      password: 'Admin123!@#',
      role: 'admin',
      isVerified: true
    });

    createdUserIds.push(admin._id);

    // Create a test customer.
    const customer = await User.create({
      email: customerEmail,
      password: 'Customer123!@#',
      role: 'customer',
      isVerified: true
    });

    createdUserIds.push(customer._id);

    adminAgent = request.agent(app);
    customerAgent = request.agent(app);

    // Authenticate administrator.
    const adminCsrf = await getCsrfToken(adminAgent);

    const adminLogin = await adminAgent
      .post('/api/auth/admin-login')
      .set('x-csrf-token', adminCsrf)
      .send({
        email: adminEmail,
        password: 'Admin123!@#'
      });

    expect(adminLogin.status).toBe(200);

    // Authenticate customer.
    const customerCsrf = await getCsrfToken(customerAgent);

    const customerLogin = await customerAgent
      .post('/api/auth/login')
      .set('x-csrf-token', customerCsrf)
      .send({
        email: customerEmail,
        password: 'Customer123!@#'
      });

    expect(customerLogin.status).toBe(200);

    // Minimal JPEG fixture.
    await fs.writeFile(
      path.join(fixturesDir, 'test.jpg'),
      Buffer.from([
        0xff, 0xd8, 0xff, 0xe0,
        0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x48
      ])
    );

    // Minimal PNG fixture.
    await fs.writeFile(
      path.join(fixturesDir, 'test.png'),
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52
      ])
    );

    // Invalid image fixture.
    await fs.writeFile(
      path.join(fixturesDir, 'invalid.jpg'),
      Buffer.from([0, 0, 0, 0])
    );
  });

  afterAll(async () => {
    try {
      // Delete only database documents created by this suite.
      if (testPizzaId) {
        await Pizza.deleteOne({
          _id: testPizzaId
        });
      }

      if (createdUserIds.length) {
        await User.deleteMany({
          _id: {
            $in: createdUserIds
          }
        });
      }

      if (createdIngredientIds.length) {
        await Ingredient.deleteMany({
          _id: {
            $in: createdIngredientIds
          }
        });
      }

    } finally {

      // Remove only images uploaded by this test run.
      // Never delete UPLOAD_DIR itself.
      for (const file of uploadedFiles) {
        await fs.unlink(file).catch(error => {
          if (error.code !== 'ENOENT') {
            console.warn(
              'Unable to remove test image:',
              file,
              error
            );
          }
        });
      }

      // Remove only this test run's temporary fixtures.
      if (fixturesDir) {
        await fs.rm(fixturesDir, {
          recursive: true,
          force: true
        });
      }

      await disconnectDB();
    }
  });

  beforeEach(async () => {
    await Pizza.findByIdAndUpdate(
      testPizzaId,
      { imageUrl: null }
    );
  });

  describe('Authorization and Authentication', () => {

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/admin/pizzas/${testPizzaId}/image`)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('should require admin role', async () => {
      const csrf = await getCsrfToken(customerAgent);

      const response = await uploadImage(
        customerAgent,
        testPizzaId,
        csrf,
        path.join(fixturesDir, 'test.jpg')
      );

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('should require CSRF token', async () => {
      const response = await adminAgent
        .post(`/api/admin/pizzas/${testPizzaId}/image`)
        .attach(
          'image',
          path.join(fixturesDir, 'test.jpg')
        );

      expect(response.status).toBe(403);
    });

  });

  describe('File Validation', () => {

    it('should reject request without file', async () => {
      const csrf = await getCsrfToken(adminAgent);

      const response = await adminAgent
        .post(`/api/admin/pizzas/${testPizzaId}/image`)
        .set('x-csrf-token', csrf);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('NO_FILE');
    });

    it('should accept valid JPEG image', async () => {
      const csrf = await getCsrfToken(adminAgent);

      const response = await uploadImage(
        adminAgent,
        testPizzaId,
        csrf,
        path.join(fixturesDir, 'test.jpg')
      );

      expect(response.status).toBe(200);

      expect(
        response.body.pizza.imageUrl
      ).toContain('/uploads/pizzas/');

      expect(
        response.body.pizza.imageUrl
      ).toMatch(/\.jpg$/);
    });

    it('should accept valid PNG image', async () => {
      const csrf = await getCsrfToken(adminAgent);

      const response = await uploadImage(
        adminAgent,
        testPizzaId,
        csrf,
        path.join(fixturesDir, 'test.png')
      );

      expect(response.status).toBe(200);

      expect(
        response.body.pizza.imageUrl
      ).toContain('/uploads/pizzas/');

      expect(
        response.body.pizza.imageUrl
      ).toMatch(/\.png$/);
    });

    it('should reject file with invalid signature', async () => {
      const csrf = await getCsrfToken(adminAgent);

      const response = await uploadImage(
        adminAgent,
        testPizzaId,
        csrf,
        path.join(fixturesDir, 'invalid.jpg')
      );

      expect(response.status).toBe(400);

      expect(
        response.body.error.code
      ).toBe('INVALID_FILE_SIGNATURE');
    });

    it('should reject oversized file', async () => {
      const largePath = path.join(
        fixturesDir,
        'large.jpg'
      );

      await fs.writeFile(
        largePath,
        Buffer.alloc(6 * 1024 * 1024)
      );

      try {
        const csrf = await getCsrfToken(adminAgent);

        const response = await uploadImage(
          adminAgent,
          testPizzaId,
          csrf,
          largePath
        );

        expect(response.status).toBe(400);

      } finally {
        await fs.unlink(largePath).catch(() => {});
      }
    });

  });

  describe('Image Lifecycle', () => {

    it('should store image and update pizza imageUrl', async () => {
      const csrf = await getCsrfToken(adminAgent);

      const response = await uploadImage(
        adminAgent,
        testPizzaId,
        csrf,
        path.join(fixturesDir, 'test.jpg')
      );

      expect(response.status).toBe(200);

      const pizza = await Pizza.findById(testPizzaId);

      expect(pizza.imageUrl).toBe(
        response.body.pizza.imageUrl
      );

      const filepath = path.join(
        UPLOAD_DIR,
        path.basename(pizza.imageUrl)
      );

      await expect(
        fs.access(filepath)
      ).resolves.toBeUndefined();
    });

    it('should replace existing image', async () => {
      const firstCsrf = await getCsrfToken(adminAgent);

      const first = await uploadImage(
        adminAgent,
        testPizzaId,
        firstCsrf,
        path.join(fixturesDir, 'test.jpg')
      );

      expect(first.status).toBe(200);

      const oldFile = path.join(
        UPLOAD_DIR,
        path.basename(first.body.pizza.imageUrl)
      );

      const secondCsrf = await getCsrfToken(adminAgent);

      const second = await uploadImage(
        adminAgent,
        testPizzaId,
        secondCsrf,
        path.join(fixturesDir, 'test.png')
      );

      expect(second.status).toBe(200);

      expect(second.body.pizza.imageUrl).not.toBe(
        first.body.pizza.imageUrl
      );

      // The previous image should be deleted.
      await expect(
        fs.access(oldFile)
      ).rejects.toThrow();

      // The replacement should exist.
      const newFile = path.join(
        UPLOAD_DIR,
        path.basename(second.body.pizza.imageUrl)
      );

      await expect(
        fs.access(newFile)
      ).resolves.toBeUndefined();
    });

    it(
      'should handle non-existent pizza without orphaning an image',
      async () => {
        const unknownId = '507f1f77bcf86cd799439011';

        await fs.mkdir(UPLOAD_DIR, {
          recursive: true
        });

        const before = new Set(
          await fs.readdir(UPLOAD_DIR)
        );

        const csrf = await getCsrfToken(adminAgent);

        const response = await uploadImage(
          adminAgent,
          unknownId,
          csrf,
          path.join(fixturesDir, 'test.jpg')
        );

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('NOT_FOUND');

        const newFiles = (
          await fs.readdir(UPLOAD_DIR)
        ).filter(file => !before.has(file));

        expect(newFiles).toEqual([]);
      }
    );

  });

  describe('Image Deletion', () => {

    it('should remove image from pizza', async () => {
      const uploadCsrf = await getCsrfToken(adminAgent);

      const uploaded = await uploadImage(
        adminAgent,
        testPizzaId,
        uploadCsrf,
        path.join(fixturesDir, 'test.jpg')
      );

      expect(uploaded.status).toBe(200);

      const imageFile = path.join(
        UPLOAD_DIR,
        path.basename(uploaded.body.pizza.imageUrl)
      );

      const deleteCsrf = await getCsrfToken(adminAgent);

      const deleted = await adminAgent
        .delete(`/api/admin/pizzas/${testPizzaId}/image`)
        .set('x-csrf-token', deleteCsrf);

      expect(deleted.status).toBe(200);
      expect(deleted.body.pizza.imageUrl).toBeNull();

      const pizza = await Pizza.findById(testPizzaId);

      expect(pizza.imageUrl).toBeNull();

      await expect(
        fs.access(imageFile)
      ).rejects.toThrow();
    });

    it('should require authentication for deletion', async () => {
      const response = await request(app)
        .delete(`/api/admin/pizzas/${testPizzaId}/image`);

      expect(response.status).toBe(401);
    });

    it('should require admin role for deletion', async () => {
      const csrf = await getCsrfToken(customerAgent);

      const response = await customerAgent
        .delete(`/api/admin/pizzas/${testPizzaId}/image`)
        .set('x-csrf-token', csrf);

      expect(response.status).toBe(403);
    });

    it('should handle pizza with no image', async () => {
      const csrf = await getCsrfToken(adminAgent);

      const response = await adminAgent
        .delete(`/api/admin/pizzas/${testPizzaId}/image`)
        .set('x-csrf-token', csrf);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('NO_IMAGE');
    });

  });

  describe('Admin Pizza List', () => {

    it('should list pizzas with imageUrl', async () => {
      const response = await adminAgent.get(
        '/api/admin/pizzas'
      );

      expect(response.status).toBe(200);
      expect(response.body.pizzas).toBeInstanceOf(Array);
      expect(response.body.pizzas.length).toBeGreaterThan(0);

      expect(
        response.body.pizzas[0]
      ).toHaveProperty('imageUrl');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/admin/pizzas');

      expect(response.status).toBe(401);
    });

    it('should require admin role', async () => {
      const response = await customerAgent
        .get('/api/admin/pizzas');

      expect(response.status).toBe(403);
    });

  });

  describe('Filename Safety', () => {

    it(
      'should not expose user-provided path segments in the stored filename',
      async () => {
        const imagePath = path.join(
          fixturesDir,
          'passwd.jpg'
        );

        await fs.copyFile(
          path.join(fixturesDir, 'test.jpg'),
          imagePath
        );

        const csrf = await getCsrfToken(adminAgent);

        const response = await uploadImage(
          adminAgent,
          testPizzaId,
          csrf,
          imagePath,
          '../../etc/passwd.jpg'
        );

        // The server may sanitize or reject unsafe filenames.
        expect([200, 400]).toContain(response.status);

        if (response.status === 200) {
          const imageUrl = response.body.pizza.imageUrl;

          expect(imageUrl).toContain('/uploads/pizzas/');
          expect(imageUrl).not.toContain('../');
          expect(imageUrl).not.toContain('etc');
          expect(imageUrl).not.toContain('passwd');
        }
      }
    );

  });

});