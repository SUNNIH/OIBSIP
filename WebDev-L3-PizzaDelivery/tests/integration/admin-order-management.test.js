// SUNNYS Pizza — Admin Order Management Integration Tests

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../server/src/app.js';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Order from '../../server/src/models/Order.js';
import User from '../../server/src/models/User.js';

let mongoServer;
let agent;
let csrfToken;
let testOrder;
let customer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Create customer
  customer = new User({
    email: 'customer@test.com',
    password: 'Customer123!',
    isVerified: true,
    role: 'customer'
  });
  await customer.save();

  // Create admin
  const admin = new User({
    email: 'admin@sunnys.local',
    password: 'SecureAdminPassword123!',
    isVerified: true,
    role: 'admin'
  });
  await admin.save();

  // Admin login
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
  await Order.deleteMany({});
  
  // Create test order
  testOrder = await Order.create({
    customerId: customer._id,
    items: [{
      name: 'Test Pizza',
      quantity: 1,
      base: { ingredientId: new mongoose.Types.ObjectId(), name: 'Regular', pricePaise: 5000 },
      sauce: { ingredientId: new mongoose.Types.ObjectId(), name: 'Tomato', pricePaise: 3000 },
      cheese: { ingredientId: new mongoose.Types.ObjectId(), name: 'Mozzarella', pricePaise: 4000 },
      vegetables: [],
      unitPricePaise: 12000,
      totalPricePaise: 12000,
      lineTotalPaise: 12000
    }],
    totalPricePaise: 12000,
    orderState: 'received',
    paymentStatus: 'paid',
    idempotencyKey: 'test-order-' + Date.now(),
    requestHash: 'test-hash',
    reservation: {
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
});

describe('Admin Order Retrieval', () => {
  it('should fetch order list', async () => {
    const res = await agent
      .get('/api/admin/orders?limit=10')
      .expect(200);

    expect(res.body.orders).toBeInstanceOf(Array);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].orderId).toBe(testOrder._id.toString());
  });

  it('should fetch order details', async () => {
    const res = await agent
      .get(`/api/admin/orders/${testOrder._id}`)
      .expect(200);

    expect(res.body.order.orderId).toBe(testOrder._id.toString());
    expect(res.body.order.customerEmail).toBe('customer@test.com');
    expect(res.body.order.items).toHaveLength(1);
  });

  it('should return 404 for non-existent order', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await agent
      .get(`/api/admin/orders/${fakeId}`)
      .expect(404);

    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('Order Status Updates', () => {
  it('should advance from received to in_kitchen', async () => {
    const res = await agent
      .patch(`/api/admin/orders/${testOrder._id}/status`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'in_kitchen' })
      .expect(200);

    expect(res.body.order.orderState).toBe('in_kitchen');
    
    const updated = await Order.findById(testOrder._id);
    expect(updated.orderState).toBe('in_kitchen');
  });

  it('should advance from in_kitchen to sent_to_delivery', async () => {
    testOrder.orderState = 'in_kitchen';
    await testOrder.save();

    const res = await agent
      .patch(`/api/admin/orders/${testOrder._id}/status`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'sent_to_delivery' })
      .expect(200);

    expect(res.body.order.orderState).toBe('sent_to_delivery');
  });

  it('should reject unpaid orders', async () => {
    testOrder.paymentStatus = 'pending_gateway';
    await testOrder.save();

    const res = await agent
      .patch(`/api/admin/orders/${testOrder._id}/status`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'in_kitchen' })
      .expect(409);

    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('should reject invalid transitions', async () => {
    const res = await agent
      .patch(`/api/admin/orders/${testOrder._id}/status`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'sent_to_delivery' }) // Skip in_kitchen
      .expect(409); // Conflict status code

    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('should reject backward transitions', async () => {
    testOrder.orderState = 'in_kitchen';
    await testOrder.save();

    const res = await agent
      .patch(`/api/admin/orders/${testOrder._id}/status`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'received' })
      .expect(422); // Unprocessable Entity

    expect(res.body.error.code).toBe('INVALID_STATUS');
  });
});

describe('Authorization', () => {
  it('should require authentication', async () => {
    const res = await request(app)
      .get('/api/admin/orders')
      .expect(401);
  });

  it('should require CSRF token for updates', async () => {
    const res = await agent
      .patch(`/api/admin/orders/${testOrder._id}/status`)
      .send({ status: 'in_kitchen' })
      .expect(403);
  });
});
