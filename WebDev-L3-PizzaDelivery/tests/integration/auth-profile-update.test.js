// SUNNYS Pizza — Profile Update Integration Tests
// Tests PATCH /api/auth/me endpoint

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../../server/src/app.js';
import User from '../../server/src/models/User.js';

let replSet;

beforeAll(async () => {
  // Start in-memory replica set
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

describe('Profile Update Integration Tests', () => {
  let agent;
  let csrfToken;

  // Setup once for all tests in this suite
  beforeAll(async () => {
    // Clear users
    await User.deleteMany({});

    // Create and verify a test user
    await User.create({
      email: 'test@example.com',
      password: 'password123',
      role: 'customer',
      isVerified: true,
    });

    // Create agent to persist cookies across requests
    agent = request.agent(app);

    // Get CSRF token
    const csrfRes = await agent.get('/api/auth/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    
    if (!csrfToken) {
      throw new Error('Failed to get initial CSRF token');
    }

    // Login once for all tests
    const loginRes = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'test@example.com',
        password: 'password123',
      });

    // Verify login succeeded
    if (loginRes.status !== 200) {
      throw new Error(`Login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }

    // Get refreshed CSRF token after login
    csrfToken = loginRes.body.csrfToken;
    
    if (!csrfToken) {
      throw new Error('Failed to get CSRF token after login');
    }
  });

  describe('PATCH /api/auth/me', () => {
    it('should update displayName successfully', async () => {
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: 'John Doe',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Profile updated successfully');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.displayName).toBe('John Doe');
      expect(res.body.user.email).toBe('test@example.com');

      // Verify in database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.displayName).toBe('John Doe');
    });

    it('should update phoneNumber successfully', async () => {
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          phoneNumber: '+91 9876543210',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.phoneNumber).toBe('+91 9876543210');

      // Verify in database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.phoneNumber).toBe('+91 9876543210');
    });

    it('should update both displayName and phoneNumber', async () => {
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: 'Jane Smith',
          phoneNumber: '+91 1234567890',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.displayName).toBe('Jane Smith');
      expect(res.body.user.phoneNumber).toBe('+91 1234567890');
    });

    it('should clear displayName when empty string provided', async () => {
      // First set a displayName
      await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: 'Test User',
        });

      // Then clear it
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: '',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.displayName).toBe('');
    });

    it('should trim whitespace from displayName', async () => {
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: '  Trimmed Name  ',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.displayName).toBe('Trimmed Name');
    });

    it('should reject displayName exceeding 100 characters', async () => {
      const longName = 'a'.repeat(101);

      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: longName,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('100 characters or less');
    });

    it('should reject phoneNumber exceeding 20 characters', async () => {
      const longPhone = '1'.repeat(21);

      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          phoneNumber: longPhone,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('20 characters or less');
    });

    it('should require authentication', async () => {
      // Create fresh agent without login
      const freshAgent = request.agent(app);
      const freshCsrf = await freshAgent.get('/api/auth/csrf-token');
      
      const res = await freshAgent
        .patch('/api/auth/me')
        .set('x-csrf-token', freshCsrf.body.csrfToken)
        .send({
          displayName: 'No Auth',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    it('should require CSRF token', async () => {
      const res = await agent
        .patch('/api/auth/me')
        .send({
          displayName: 'No CSRF',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('invalid csrf token');
    });

    it('should not expose password or tokenVersion', async () => {
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: 'Secure User',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.password).toBeUndefined();
      expect(res.body.user.tokenVersion).toBeUndefined();
    });

    it('should ignore attempts to update email', async () => {
      // Ensure we have a valid CSRF token
      if (!csrfToken) {
        throw new Error('CSRF token is undefined in test');
      }
      
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          email: 'hacker@example.com',
          displayName: 'Valid Name',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('test@example.com'); // Original email preserved
      expect(res.body.user.displayName).toBe('Valid Name');

      // Verify email unchanged in database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user).toBeDefined();
      expect(user.email).toBe('test@example.com');
    });

    it('should ignore attempts to update role', async () => {
      // Ensure we have a valid CSRF token
      if (!csrfToken) {
        throw new Error('CSRF token is undefined in test');
      }
      
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          role: 'admin',
          displayName: 'Valid Name',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('customer'); // Original role preserved

      // Verify role unchanged in database
      const user = await User.findOne({ email: 'test@example.com' });
      expect(user.role).toBe('customer');
    });

    it('should handle empty update gracefully', async () => {
      // Ensure we have a valid CSRF token
      if (!csrfToken) {
        throw new Error('CSRF token is undefined in test');
      }
      
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Profile updated successfully');
    });

    it('should preserve existing displayName when only updating phoneNumber', async () => {
      // Ensure we have a valid CSRF token
      if (!csrfToken) {
        throw new Error('CSRF token is undefined in test');
      }
      
      // Set initial profile
      await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          displayName: 'Original Name',
          phoneNumber: '1111111111',
        });

      // Update only phone
      const res = await agent
        .patch('/api/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({
          phoneNumber: '2222222222',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.displayName).toBe('Original Name');
      expect(res.body.user.phoneNumber).toBe('2222222222');
    });
  });

  describe('Backward Compatibility', () => {
    it('should support existing users without profile fields', async () => {
      // For this test, we need a fresh user without profile data
      // Clear and recreate user without profile fields
      await User.deleteMany({});
      await User.create({
        email: 'clean@example.com',
        password: 'password123',
        role: 'customer',
        isVerified: true,
      });

      // Create fresh agent and login for this specific test
      const cleanAgent = request.agent(app);
      const csrfRes = await cleanAgent.get('/api/auth/csrf-token');
      const cleanCsrf = csrfRes.body.csrfToken;

      await cleanAgent
        .post('/api/auth/login')
        .set('x-csrf-token', cleanCsrf)
        .send({
          email: 'clean@example.com',
          password: 'password123',
        });

      // Get current user without profile fields
      const getRes = await cleanAgent.get('/api/auth/me');

      expect(getRes.status).toBe(200);
      expect(getRes.body.user.displayName).toBeUndefined();
      expect(getRes.body.user.phoneNumber).toBeUndefined();

      // Get fresh CSRF after login
      const freshCsrf = await cleanAgent.get('/api/auth/csrf-token');

      // Should be able to add profile fields to existing user
      const updateRes = await cleanAgent
        .patch('/api/auth/me')
        .set('x-csrf-token', freshCsrf.body.csrfToken)
        .send({
          displayName: 'New Profile',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.user.displayName).toBe('New Profile');
    });
  });
});
