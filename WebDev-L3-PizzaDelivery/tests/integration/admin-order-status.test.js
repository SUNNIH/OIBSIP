/**
 * SUNNYS Pizza
 * Task 5.5B — Administrator Order Status Integration Tests
 *
 * Endpoint:
 * PATCH /api/admin/orders/:orderId/status
 *
 * Testing infrastructure:
 * - Vitest
 * - Supertest
 * - MongoDB Memory Server (Replica Set)
 * - Mocked Socket.IO notification delivery
 *
 * These tests use an isolated in-memory MongoDB database.
 *
 * Run only this test file:
 *
 * npx vitest run tests/integration/admin-order-status.test.js --config tests/vitest.config.integration.js
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
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';

// ============================================================
// Test Environment
// ============================================================

// Set environment variables before importing application modules.

process.env.NODE_ENV = 'test';

process.env.CLIENT_URL = 'http://localhost:5173';

process.env.JWT_SECRET =
  'test-jwt-secret-min-32-characters-long-for-testing';

process.env.CSRF_SECRET =
  'test-csrf-secret-min-32-characters-long-for-testing';

process.env.JWT_EXPIRY = '2h';

// Dynamically import application modules after setting NODE_ENV.

const [
  { default: app },
  { default: User },
  { default: Order }
] = await Promise.all([
  import('../../server/src/app.js'),
  import('../../server/src/models/User.js'),
  import('../../server/src/models/Order.js')
]);

// ============================================================
// Constants
// ============================================================

const PATH = '/api/admin/orders';

const PASSWORD = 'TestPassword123!';

// ============================================================
// Test Variables
// ============================================================

let replSet;

let owner;

let adminSession;

let customerSession;

let events = [];

// ============================================================
// Authentication Helper
// ============================================================

async function signIn(email, role) {
  const agent = request.agent(app);

  // Obtain the initial CSRF token.

  const firstCsrf = await agent
    .get('/api/auth/csrf-token')
    .expect(200);

  const loginPath =
    role === 'admin'
      ? '/api/auth/admin-login'
      : '/api/auth/login';

  // Authenticate using the existing backend login route.

  const login = await agent
    .post(loginPath)
    .set('x-csrf-token', firstCsrf.body.csrfToken)
    .send({
      email,
      password: PASSWORD
    })
    .expect(200);

  expect(login.body.user.role).toBe(role);

  // Obtain a fresh CSRF token for authenticated requests.

  const freshCsrf = await agent
    .get('/api/auth/csrf-token')
    .expect(200);

  return {
    agent,
    csrfToken: freshCsrf.body.csrfToken
  };
}

// ============================================================
// Order Fixture Helper
// ============================================================

async function makeOrder({
  orderState = 'received',
  paymentStatus = 'paid'
} = {}) {
  const baseId = new mongoose.Types.ObjectId();

  const sauceId = new mongoose.Types.ObjectId();

  const cheeseId = new mongoose.Types.ObjectId();

  const paid = [
    'paid',
    'paid_after_expiry'
  ].includes(paymentStatus);

  const now = new Date();

  return Order.create({
    customerId: owner._id,

    items: [
      {
        name: 'Test Margherita',

        base: {
          ingredientId: baseId,
          name: 'Crust',
          pricePaise: 5000
        },

        sauce: {
          ingredientId: sauceId,
          name: 'Tomato',
          pricePaise: 2000
        },

        cheese: {
          ingredientId: cheeseId,
          name: 'Mozzarella',
          pricePaise: 3000
        },

        vegetables: [],

        quantity: 1,

        unitPricePaise: 10000,

        lineTotalPaise: 10000
      }
    ],

    totalPricePaise: 10000,

    orderState,

    paymentStatus,

    idempotencyKey: `admin-order-status-${randomUUID()}`,

    requestHash: 'a'.repeat(64),

    reservation: {
      state: paid ? 'committed' : 'held',

      reservedAt: now,

      expiresAt: new Date(
        now.getTime() + 15 * 60 * 1000
      ),

      ...(paid ? { committedAt: now } : {}),

      lines: []
    }
  });
}

// ============================================================
// PATCH Request Helper
// ============================================================

function patch(
  session,
  orderId,
  status,
  token = session.csrfToken
) {
  const req = session.agent.patch(
    `${PATH}/${orderId}/status`
  );

  if (token !== null) {
    req.set('x-csrf-token', token);
  }

  return req.send({ status });
}

// ============================================================
// Administrator Order Status Integration Tests
// ============================================================

describe(
  'PATCH /api/admin/orders/:orderId/status — Task 5.5B',
  () => {

    // ========================================================
    // Test Database Initialization
    // ========================================================

    beforeAll(async () => {
      // Start isolated MongoDB replica set.

      replSet = await MongoMemoryReplSet.create({
        replSet: {
          count: 1,
          storageEngine: 'wiredTiger'
        }
      });

      // Connect only to the temporary in-memory database.

      await mongoose.connect(replSet.getUri());

      // Create the customer who owns test orders.

      owner = await User.create({
        email: 'owner-status@test.example',
        password: PASSWORD,
        role: 'customer',
        isVerified: true
      });

      // Create administrator account.

      await User.create({
        email: 'admin-status@test.example',
        password: PASSWORD,
        role: 'admin',
        isVerified: true
      });

      // Authenticate both users.

      adminSession = await signIn(
        'admin-status@test.example',
        'admin'
      );

      customerSession = await signIn(
        'owner-status@test.example',
        'customer'
      );

    }, 30000);

    // ========================================================
    // Test Cleanup
    // ========================================================

    afterAll(async () => {
      app.set('io', undefined);

      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }

      if (replSet) {
        await replSet.stop();
      }
    });

    // ========================================================
    // Prepare Each Test
    // ========================================================

    beforeEach(async () => {
      // Delete orders only from the isolated test database.

      await Order.deleteMany({});

      // Reset recorded Socket.IO events.

      events = [];

      // Mock Socket.IO customer-room notifications.

      app.set('io', {
        to(room) {
          return {
            emit(event, payload) {
              events.push({
                room,
                event,
                payload
              });
            }
          };
        }
      });
    });

    // ========================================================
    // TEST 1 — Authentication Required
    // ========================================================

    it(
      '1. rejects unauthenticated requests (401)',
      async () => {
        const res = await request(app)
          .patch(
            `${PATH}/${new mongoose.Types.ObjectId()}/status`
          )
          .send({
            status: 'in_kitchen'
          });

        expect(res.status).toBe(401);

        expect(events).toHaveLength(0);
      }
    );

    // ========================================================
    // TEST 2 — Customer Authorization
    // ========================================================

    it(
      '2. rejects authenticated customers (403)',
      async () => {
        const res = await patch(
          customerSession,
          new mongoose.Types.ObjectId(),
          'in_kitchen'
        );

        expect(res.status).toBe(403);

        expect(events).toHaveLength(0);
      }
    );

    // ========================================================
    // TEST 3 — Missing CSRF Token
    // ========================================================

    it(
      '3. rejects an admin request without a CSRF header (403)',
      async () => {
        const res = await patch(
          adminSession,
          new mongoose.Types.ObjectId(),
          'in_kitchen',
          null
        );

        expect(res.status).toBe(403);
      }
    );

    // ========================================================
    // TEST 4 — Invalid CSRF Token
    // ========================================================

    it(
      '4. rejects an invalid CSRF token (403)',
      async () => {
        const res = await patch(
          adminSession,
          new mongoose.Types.ObjectId(),
          'in_kitchen',
          'invalid-token'
        );

        expect(res.status).toBe(403);
      }
    );

    // ========================================================
    // TEST 5 — Invalid Order ID
    // ========================================================

    it(
      '5. rejects an invalid order ID (400)',
      async () => {
        const res = await patch(
          adminSession,
          'not-an-object-id',
          'in_kitchen'
        );

        expect(res.status).toBe(400);

        expect(res.body.error.code).toBe(
          'INVALID_ORDER_ID'
        );
      }
    );

    // ========================================================
    // TEST 6 — Nonexistent Order
    // ========================================================

    it(
      '6. returns 404 for a nonexistent order',
      async () => {
        const res = await patch(
          adminSession,
          new mongoose.Types.ObjectId(),
          'in_kitchen'
        );

        expect(res.status).toBe(404);

        expect(res.body.error.code).toBe(
          'ORDER_NOT_FOUND'
        );
      }
    );

    // ========================================================
    // TEST 7 — Unsupported Status
    // ========================================================

    it(
      '7. rejects unsupported administrator statuses (422)',
      async () => {
        const order = await makeOrder();

        const res = await patch(
          adminSession,
          order._id,
          'delivered'
        );

        expect(res.status).toBe(422);

        expect(res.body.error.code).toBe(
          'INVALID_STATUS'
        );

        const saved = await Order.findById(order._id);

        expect(saved.orderState).toBe('received');
      }
    );

    // ========================================================
    // TEST 8 — Payment Verification Requirement
    // ========================================================

    it(
      '8. rejects fulfillment before payment confirmation (409)',
      async () => {
        const order = await makeOrder({
          orderState: 'received',
          paymentStatus: 'pending_gateway'
        });

        const res = await patch(
          adminSession,
          order._id,
          'in_kitchen'
        );

        expect(res.status).toBe(409);

        expect(res.body.error.code).toBe(
          'INVALID_TRANSITION'
        );

        const saved = await Order.findById(order._id);

        expect(saved.orderState).toBe('received');

        expect(events).toHaveLength(0);
      }
    );

    // ========================================================
    // TEST 9 — Order Received → In Kitchen
    // ========================================================

    it(
      '9. advances a paid order received → in_kitchen (200)',
      async () => {
        const order = await makeOrder();

        const res = await patch(
          adminSession,
          order._id,
          'in_kitchen'
        );

        expect(res.status).toBe(200);

        expect(res.body.order).toMatchObject({
          orderId: order._id.toString(),
          orderState: 'in_kitchen'
        });

        const saved = await Order.findById(order._id);

        expect(saved.orderState).toBe('in_kitchen');

        expect(saved.paymentStatus).toBe('paid');

        expect(saved.totalPricePaise).toBe(10000);
      }
    );

    // ========================================================
    // TEST 10 — In Kitchen → Sent to Delivery
    // ========================================================

    it(
      '10. advances in_kitchen → sent_to_delivery for paid-after-expiry (200)',
      async () => {
        const order = await makeOrder({
          orderState: 'in_kitchen',
          paymentStatus: 'paid_after_expiry'
        });

        const res = await patch(
          adminSession,
          order._id,
          'sent_to_delivery'
        );

        expect(res.status).toBe(200);

        expect(res.body.order.orderState).toBe(
          'sent_to_delivery'
        );

        const saved = await Order.findById(order._id);

        expect(saved.orderState).toBe(
          'sent_to_delivery'
        );

        expect(saved.paymentStatus).toBe(
          'paid_after_expiry'
        );
      }
    );

    // ========================================================
    // TEST 11 — Duplicate Transition Rejection
    // ========================================================

    it(
      '11. rejects a duplicate transition and does not emit again (409)',
      async () => {
        const order = await makeOrder();

        // First transition is valid.

        const first = await patch(
          adminSession,
          order._id,
          'in_kitchen'
        );

        expect(first.status).toBe(200);

        expect(events).toHaveLength(1);

        // Repeating the transition must be rejected.

        const second = await patch(
          adminSession,
          order._id,
          'in_kitchen'
        );

        expect(second.status).toBe(409);

        expect(second.body.error.code).toBe(
          'INVALID_TRANSITION'
        );

        // Rejected transitions must not emit notifications.

        expect(events).toHaveLength(1);
      }
    );

    // ========================================================
    // TEST 12 — Customer Notification Isolation
    // ========================================================

    it(
      '12. notifies only the order owner after a successful update',
      async () => {
        const order = await makeOrder();

        const res = await patch(
          adminSession,
          order._id,
          'in_kitchen'
        );

        expect(res.status).toBe(200);

        // The notification must target only the owning customer.

        expect(events).toEqual([
          {
            room: `customer:${owner._id.toString()}`,

            event: 'order:updated',

            payload: {
              orderId: order._id.toString()
            }
          }
        ]);
      }
    );

  }
);