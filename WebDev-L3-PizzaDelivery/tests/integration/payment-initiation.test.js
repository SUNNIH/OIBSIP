/**
 * Phase 4 Task 4.4 — Razorpay initiation integration tests.
 * No real Razorpay requests are made.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi
} from 'vitest';


import { createHmac } from 'node:crypto';
import Ingredient from '../../server/src/models/Ingredient.js';
import Pizza from '../../server/src/models/Pizza.js';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';

// Configure the Razorpay mock before the service initializes.
const gatewayMock = vi.hoisted(() => ({
  orders: {
    create: vi.fn(),
    fetch: vi.fn(),
    fetchPayments: vi.fn()
  },
  payments: {
    fetch: vi.fn()
  }
}));

vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    constructor() {
      this.orders = gatewayMock.orders;
      this.payments = gatewayMock.payments;
    }
  }
}));

import app from '../../server/src/app.js';
import User from '../../server/src/models/User.js';
import Order from '../../server/src/models/Order.js';
import env from '../../server/src/config/env.js';
import { expireOrderReservation } from '../../server/src/services/inventoryReservation.js';

import {
  initiatePayment
} from '../../server/src/services/razorpayService.js';

let replSet;
let customer;
let agent;
let csrfToken;
let sequence = 0;

function makeOrder(overrides = {}) {
  const baseId = new mongoose.Types.ObjectId();
  const sauceId = new mongoose.Types.ObjectId();
  const cheeseId = new mongoose.Types.ObjectId();

  return Order.create({
    customerId: customer._id,

    idempotencyKey: `payment-init-${++sequence}`,

    requestHash: 'a'.repeat(64),

    orderState: 'pending_payment',
    paymentStatus: 'pending_gateway',

    totalPricePaise: 25000,

    items: [
      {
        name: 'Margherita',
        quantity: 1,

        unitPricePaise: 25000,
        lineTotalPaise: 25000,

        base: {
          ingredientId: baseId,
          name: 'Crust',
          pricePaise: 10000
        },

        sauce: {
          ingredientId: sauceId,
          name: 'Sauce',
          pricePaise: 5000
        },

        cheese: {
          ingredientId: cheeseId,
          name: 'Cheese',
          pricePaise: 10000
        },

        vegetables: []
      }
    ],

    reservation: {
      state: 'held',
      reservedAt: new Date(),

      expiresAt: new Date(
        Date.now() + 15 * 60 * 1000
      ),

      lines: []
    },

    ...overrides
  });
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger'
    }
  });

  await mongoose.connect(replSet.getUri());

  customer = await User.create({
    email: 'payment-test-customer@example.com',
    password: 'Password123!',
    role: 'customer',
    isVerified: true
  });

  agent = request.agent(app);

  await agent.get('/api/auth/csrf-token');

  const csrfResponse = await agent.get(
    '/api/auth/csrf-token'
  );

  csrfToken = csrfResponse.body.csrfToken;

  const login = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', csrfToken)
    .send({
      email: customer.email,
      password: 'Password123!'
    });

  expect(login.status).toBe(200);

}, 30000);

afterAll(async () => {
  await mongoose.disconnect();

  if (replSet) {
    await replSet.stop();
  }
});

beforeEach(async () => {
  await Order.deleteMany({});

  gatewayMock.orders.create.mockReset();
  gatewayMock.orders.fetch.mockReset();
  gatewayMock.orders.fetchPayments.mockReset();
  gatewayMock.payments.fetch.mockReset();

  gatewayMock.orders.create.mockImplementation(
    async ({ amount, currency }) => ({
      id: 'order_Mock123456',
      amount,
      currency,
      status: 'created'
    })
  );
});

describe('Task 4.4 — Payment initiation service', () => {

  it('creates a Razorpay order with the stored amount and persists its ID', async () => {
    const order = await makeOrder();

    ;

// TEMPORARY DIAGNOSTIC
const storedOrder = await Order.findById(order._id).lean();

;

    const response = await initiatePayment(
      String(order._id),
      String(customer._id)
    );

    expect(response).toMatchObject({
      orderId: String(order._id),
      razorpayOrderId: 'order_Mock123456',
      amountPaise: 25000,
      currency: 'INR',
      existing: false
    });

    expect(gatewayMock.orders.create).toHaveBeenCalledOnce();

    expect(gatewayMock.orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 25000,
        currency: 'INR',
        receipt: `order_${order._id}`
      })
    );

    const saved = await Order.findById(order._id);

    expect(saved.razorpayOrderId).toBe(
      'order_Mock123456'
    );

    expect(saved.paymentStatus).toBe('created');

    expect(saved.gatewayLock).toBeNull();

    expect(saved.gatewayGeneration).toBe(1);

    expect(
      saved.gatewayReconciliationRequired
    ).toBe(false);
  });

  it('returns the existing gateway order without another Razorpay call', async () => {
    const order = await makeOrder();

    await initiatePayment(
      String(order._id),
      String(customer._id)
    );

    gatewayMock.orders.fetch.mockResolvedValue({
      id: 'order_Mock123456',
      amount: 25000,
      currency: 'INR',
      amount_paid: 0,
      status: 'created'
    });

    gatewayMock.orders.fetchPayments.mockResolvedValue({
      count: 0,
      items: []
    });

    gatewayMock.orders.create.mockClear();

    const second = await initiatePayment(
      String(order._id),
      String(customer._id)
    );

    expect(second.existing).toBe(true);

    expect(second.razorpayOrderId).toBe(
      'order_Mock123456'
    );

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

  it('rejects invalid order IDs and another customer\'s order', async () => {
    const order = await makeOrder();

    await expect(
      initiatePayment(
        'invalid',
        String(customer._id)
      )
    ).rejects.toMatchObject({
      code: 'INVALID_ORDER_ID'
    });

    await expect(
      initiatePayment(
        String(order._id),
        String(new mongoose.Types.ObjectId())
      )
    ).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND'
    });

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

  it('rejects expired reservations', async () => {
    const order = await makeOrder({
      reservation: {
        state: 'held',

        reservedAt: new Date(
          Date.now() - 60_000
        ),

        expiresAt: new Date(
          Date.now() - 1000
        ),

        lines: []
      }
    });

    await expect(
      initiatePayment(
        String(order._id),
        String(customer._id)
      )
    ).rejects.toMatchObject({
      code: 'RESERVATION_EXPIRED'
    });

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

  it('rejects orders outside pending_payment', async () => {
    const order = await makeOrder({
      orderState: 'received'
    });

    await expect(
      initiatePayment(
        String(order._id),
        String(customer._id)
      )
    ).rejects.toMatchObject({
      code: 'INVALID_ORDER_STATE'
    });

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

  it('uses a committed lock and blocks another request while gateway call is pending', async () => {
    const order = await makeOrder();

    let markStarted;
    let releaseGateway;

    const started = new Promise(resolve => {
      markStarted = resolve;
    });

    const waiting = new Promise(resolve => {
      releaseGateway = resolve;
    });

    gatewayMock.orders.create.mockImplementationOnce(
      async ({ amount, currency }) => {
        markStarted();

        await waiting;

        return {
          id: 'order_Mock123456',
          amount,
          currency,
          status: 'created'
        };
      }
    );

    const first = initiatePayment(
      String(order._id),
      String(customer._id)
    );

    await started;

    try {
      const duringCall = await Order.findById(
        order._id
      );

      expect(duringCall.gatewayLock).not.toBeNull();

      expect(
        duringCall.gatewayLock.token
      ).toBeTruthy();

      expect(
        duringCall.gatewayLock.fencingGeneration
      ).toBe(1);

      await expect(
        initiatePayment(
          String(order._id),
          String(customer._id)
        )
      ).rejects.toMatchObject({
        code: 'GATEWAY_LOCK_HELD'
      });

    } finally {
      releaseGateway();
    }

    await expect(first).resolves.toMatchObject({
      existing: false
    });

    expect(gatewayMock.orders.create).toHaveBeenCalledOnce();
  });

  it('increments an existing fencing generation', async () => {
    const order = await makeOrder({
      gatewayGeneration: 7
    });

    gatewayMock.orders.create.mockImplementationOnce(
      async ({ amount, currency }) => {
        const duringCall = await Order.findById(
          order._id
        );

        expect(
          duringCall.gatewayLock.fencingGeneration
        ).toBe(8);

        return {
          id: 'order_Mock123456',
          amount,
          currency,
          status: 'created'
        };
      }
    );

    await initiatePayment(
      String(order._id),
      String(customer._id)
    );

    const saved = await Order.findById(order._id);

    expect(saved.gatewayGeneration).toBe(8);
  });

  it('does not retry after an uncertain gateway error', async () => {
    const order = await makeOrder();

    gatewayMock.orders.create.mockRejectedValueOnce(
      new Error('Gateway timeout')
    );

    await expect(
      initiatePayment(
        String(order._id),
        String(customer._id)
      )
    ).rejects.toMatchObject({
      code: 'GATEWAY_OUTCOME_UNKNOWN'
    });

    const saved = await Order.findById(order._id);

    expect(
      saved.gatewayReconciliationRequired
    ).toBe(true);

    expect(saved.gatewayLock).not.toBeNull();

    expect(saved.razorpayOrderId).toBeNull();

    await expect(
      initiatePayment(
        String(order._id),
        String(customer._id)
      )
    ).rejects.toMatchObject({
      code: 'GATEWAY_RECONCILIATION_REQUIRED'
    });

    expect(gatewayMock.orders.create).toHaveBeenCalledOnce();
  });

  it('does not automatically reuse an expired gateway lock', async () => {
    const order = await makeOrder({
      gatewayGeneration: 2,

      gatewayLock: {
        token: 'previous-attempt',
        fencingGeneration: 2,

        acquiredAt: new Date(
          Date.now() - 60_000
        ),

        expiresAt: new Date(
          Date.now() - 10_000
        )
      }
    });

    await expect(
      initiatePayment(
        String(order._id),
        String(customer._id)
      )
    ).rejects.toMatchObject({
      code: 'GATEWAY_RECONCILIATION_REQUIRED'
    });

    const saved = await Order.findById(order._id);

    expect(
      saved.gatewayReconciliationRequired
    ).toBe(true);

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

});

describe('POST /api/v1/payments/initiate — route security', () => {

  it('rejects requests without authentication', async () => {
    const order = await makeOrder();

    const response = await request(app)
      .post('/api/v1/payments/initiate')
      .send({
        orderId: String(order._id)
      });

    expect(response.status).toBe(401);

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

  it('rejects requests without a CSRF token', async () => {
    const order = await makeOrder();

    const response = await agent
      .post('/api/v1/payments/initiate')
      .send({
        orderId: String(order._id)
      });

    expect(response.status).toBe(403);

    expect(gatewayMock.orders.create).not.toHaveBeenCalled();
  });

  it('accepts an authenticated, CSRF-protected request', async () => {
    const order = await makeOrder();

    const response = await agent
      .post('/api/v1/payments/initiate')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: String(order._id)
      });

    expect(response.status).toBe(200);

    expect(response.body.razorpayOrderId).toBe(
      'order_Mock123456'
    );

    expect(gatewayMock.orders.create).toHaveBeenCalledOnce();
  });

  it('validates missing, invalid, and unknown order IDs', async () => {
  const missing = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({});

  expect(missing.status).toBe(400);
  expect(missing.body.error.code).toBe('MISSING_ORDER_ID');

  const invalid = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({ orderId: 'invalid-id' });

  expect(invalid.status).toBe(400);
  expect(invalid.body.error.code).toBe('INVALID_ORDER_ID');

  const unknown = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({
      orderId: new mongoose.Types.ObjectId().toString()
    });

  expect(unknown.status).toBe(404);
  expect(unknown.body.error.code).toBe('ORDER_NOT_FOUND');

  expect(gatewayMock.orders.create).not.toHaveBeenCalled();
});

it('prevents payment initiation for another customer', async () => {
  const otherCustomer = await User.create({
    email: 'other-payment-owner@example.com',
    password: 'Password123!',
    role: 'customer',
    isVerified: true
  });

  const order = await makeOrder({
    customerId: otherCustomer._id
  });

  const response = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({
      orderId: order._id.toString()
    });

  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe('ORDER_NOT_FOUND');

  expect(gatewayMock.orders.create).not.toHaveBeenCalled();
});

it('creates an order and initiates payment through the API', async () => {
  const [base, sauce, cheese] = await Ingredient.create([
    {
      name: 'Payment Test Crust',
      category: 'base',
      pricePaise: 10000,
      stock: 100
    },
    {
      name: 'Payment Test Sauce',
      category: 'sauce',
      pricePaise: 5000,
      stock: 100
    },
    {
      name: 'Payment Test Cheese',
      category: 'cheese',
      pricePaise: 10000,
      stock: 100
    }
  ]);

  const pizza = await Pizza.create({
    name: 'Payment Integration Pizza',
    category: 'vegetarian',
    ingredients: {
      base: base._id,
      sauce: sauce._id,
      cheese: cheese._id,
      vegetables: []
    },
    isActive: true
  });

  const orderResponse = await agent
    .post('/api/v1/orders')
    .set('x-csrf-token', csrfToken)
    .set('Idempotency-Key', `payment-flow-${Date.now()}`)
    .send({
      lines: [
        {
          pizzaId: pizza._id.toString(),
          quantity: 1
        }
      ]
    });

  expect(orderResponse.status).toBe(201);
  expect(orderResponse.body.totalPricePaise).toBe(25000);

  const paymentResponse = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({
      orderId: orderResponse.body.orderId,
      amountPaise: 1 // Must be ignored by the server
    });

  expect(paymentResponse.status).toBe(200);
  expect(paymentResponse.body.amountPaise).toBe(25000);

  expect(gatewayMock.orders.create).toHaveBeenCalledOnce();

  expect(gatewayMock.orders.create).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: 25000,
      currency: 'INR',
      receipt: `order_${orderResponse.body.orderId}`
    })
  );

  const saved = await Order.findById(
    orderResponse.body.orderId
  );

  expect(saved.razorpayOrderId).toBe('order_Mock123456');
  expect(saved.paymentStatus).toBe('created');
});

it('returns a safe error when the gateway outcome is unknown', async () => {
  const order = await makeOrder();

  gatewayMock.orders.create.mockRejectedValueOnce(
    new Error('SECRET_GATEWAY_INTERNAL_ERROR')
  );

  const response = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({
      orderId: order._id.toString()
    });

  expect(response.status).toBe(503);

  expect(response.body.error.code).toBe(
    'GATEWAY_OUTCOME_UNKNOWN'
  );

  expect(
    JSON.stringify(response.body)
  ).not.toContain('SECRET_GATEWAY_INTERNAL_ERROR');

  const saved = await Order.findById(order._id);

  expect(saved.gatewayReconciliationRequired).toBe(true);
  expect(saved.gatewayLock).not.toBeNull();
});

it('releases the lock when reservation expires before gateway call', async () => {
  const order = await makeOrder();

  // Verify lock doesn't exist initially
  let saved = await Order.findById(order._id);
  expect(saved.gatewayLock).toBeNull();

  // Manually expire the reservation to simulate expiration
  // happening between lock acquisition and gateway call
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'reservation.expiresAt': new Date(Date.now() - 1000)
      }
    }
  );

  const response = await agent
    .post('/api/v1/payments/initiate')
    .set('x-csrf-token', csrfToken)
    .send({
      orderId: order._id.toString()
    });

  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('RESERVATION_EXPIRED');

  // Verify gateway was never called
  expect(gatewayMock.orders.create).not.toHaveBeenCalled();

  // Verify lock was released (not retained)
  saved = await Order.findById(order._id);
  expect(saved.gatewayLock).toBeNull();

  // Verify reconciliation flag was NOT set (no gateway call made)
  expect(saved.gatewayReconciliationRequired).not.toBe(true);

  // Verify no gateway order ID was persisted
  expect(saved.razorpayOrderId).toBeNull();
  expect(saved.paymentStatus).toBe('pending_gateway');
});

});

describe('reconcileGatewayOrder() — internal reconciliation', () => {
  
  it('successfully reconciles an uncertain gateway order', async () => {
    // Create order flagged for reconciliation
    const order = await makeOrder({
      gatewayReconciliationRequired: true,
      
      gatewayLock: {
        token: 'reconcile-token-1',
        fencingGeneration: 1,
        acquiredAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 30_000)
      }
    });

    // Mock Razorpay fetch to return matching order
    const mockFetchResponse = {
      id: 'order_ReconcileTest123',
      amount: order.totalPricePaise,
      currency: 'INR',
      receipt: `order_${order._id}`,
      status: 'created',
      notes: {
        orderId: order._id.toString()
      }
    };
    
    gatewayMock.orders.fetch.mockResolvedValueOnce(mockFetchResponse);

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    const result = await reconcileGatewayOrder(
      order._id.toString(),
      'order_ReconcileTest123'
    );

    expect(result.status).toBe('reconciled');
    expect(result.razorpayOrderId).toBe('order_ReconcileTest123');

    // Verify order updated correctly
    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBe('order_ReconcileTest123');
    expect(saved.paymentStatus).toBe('created');
    expect(saved.gatewayReconciliationRequired).toBe(false);
    expect(saved.gatewayLock).toBeNull();

    expect(gatewayMock.orders.fetch).toHaveBeenCalledWith('order_ReconcileTest123');
  });

  it('is idempotent when already reconciled with same gateway order', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_AlreadyReconciled',
      paymentStatus: 'created',
      gatewayReconciliationRequired: false,
      gatewayLock: null
    });

    gatewayMock.orders.fetch.mockResolvedValueOnce({
      id: 'order_AlreadyReconciled',
      amount: order.totalPricePaise,
      currency: 'INR',
      receipt: `order_${order._id}`,
      status: 'created'
    });

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    const result = await reconcileGatewayOrder(
      order._id.toString(),
      'order_AlreadyReconciled'
    );

    expect(result.status).toBe('already_reconciled');
    expect(result.razorpayOrderId).toBe('order_AlreadyReconciled');

    // Verify no state changes
    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBe('order_AlreadyReconciled');
    expect(saved.paymentStatus).toBe('created');
  });

  it('rejects reconciliation with mismatched receipt', async () => {
    const order = await makeOrder({
      gatewayReconciliationRequired: true,
      gatewayLock: null
    });

    gatewayMock.orders.fetch.mockResolvedValueOnce({
      id: 'order_WrongReceipt123',
      amount: order.totalPricePaise,
      currency: 'INR',
      receipt: 'order_DIFFERENT_ID',
      status: 'created'
    });

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    await expect(
      reconcileGatewayOrder(
        order._id.toString(),
        'order_WrongReceipt123'
      )
    ).rejects.toMatchObject({
      code: 'RECONCILIATION_MISMATCH',
      message: expect.stringContaining('Receipt mismatch')
    });

    // Verify order remains blocked
    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBeNull();
    expect(saved.gatewayReconciliationRequired).toBe(true);
  });

  it('rejects reconciliation with mismatched amount', async () => {
    const order = await makeOrder({
      gatewayReconciliationRequired: true,
      gatewayLock: null
    });

    gatewayMock.orders.fetch.mockResolvedValueOnce({
      id: 'order_WrongAmount123',
      amount: order.totalPricePaise + 10000, // Wrong amount
      currency: 'INR',
      receipt: `order_${order._id}`,
      status: 'created'
    });

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    await expect(
      reconcileGatewayOrder(
        order._id.toString(),
        'order_WrongAmount123'
      )
    ).rejects.toMatchObject({
      code: 'RECONCILIATION_MISMATCH',
      message: expect.stringContaining('Amount mismatch')
    });

    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBeNull();
    expect(saved.gatewayReconciliationRequired).toBe(true);
  });

  it('rejects reconciliation when gateway order not found', async () => {
    const order = await makeOrder({
      gatewayReconciliationRequired: true,
      gatewayLock: null
    });

    gatewayMock.orders.fetch.mockRejectedValueOnce(
      new Error('Order not found')
    );

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    await expect(
      reconcileGatewayOrder(
        order._id.toString(),
        'order_NotFound123'
      )
    ).rejects.toMatchObject({
      code: 'GATEWAY_ORDER_NOT_FOUND'
    });

    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBeNull();
    expect(saved.gatewayReconciliationRequired).toBe(true);
  });

  it('prevents reconciliation conflict with different gateway order', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_Existing123',
      paymentStatus: 'created',
      gatewayReconciliationRequired: false,
      gatewayLock: null
    });

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    await expect(
      reconcileGatewayOrder(
        order._id.toString(),
        'order_Different456'
      )
    ).rejects.toMatchObject({
      code: 'RECONCILIATION_CONFLICT',
      message: expect.stringContaining('already associated with different')
    });

    // Verify original state preserved
    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBe('order_Existing123');
  });

  it('reconciles order without lock using direct update', async () => {
    const order = await makeOrder({
      gatewayReconciliationRequired: true,
      gatewayLock: null // No lock present
    });

    gatewayMock.orders.fetch.mockResolvedValueOnce({
      id: 'order_NoLock123',
      amount: order.totalPricePaise,
      currency: 'INR',
      receipt: `order_${order._id}`,
      status: 'created'
    });

    const { reconcileGatewayOrder } = await import(
      '../../server/src/services/razorpayService.js'
    );

    const result = await reconcileGatewayOrder(
      order._id.toString(),
      'order_NoLock123'
    );

    expect(result.status).toBe('reconciled');

    const saved = await Order.findById(order._id);
    expect(saved.razorpayOrderId).toBe('order_NoLock123');
    expect(saved.gatewayReconciliationRequired).toBe(false);
    expect(saved.gatewayLock).toBeNull();
  });

});

describe('Task 4.5 Step 1 — Payment verification security layer', () => {

  it('successfully verifies a valid payment signature', async () => {
    // Setup test ingredients for valid reservation
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    // Create order with Razorpay order ID and valid reservation
    const order = await makeOrder({
      razorpayOrderId: 'order_VerifyTest123',
      paymentStatus: 'created',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    // Reserve inventory for this order
    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $inc: { reserved: 1 } }
    );

    // Mock captured payment
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_VerifyTest123',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    // Generate valid signature
    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    // Should succeed with Step 3A
    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.committed).toBe(true);

    // Verify inventory was committed
    const baseAfter = await Ingredient.findById(base._id);
    const sauceAfter = await Ingredient.findById(sauce._id);
    const cheeseAfter = await Ingredient.findById(cheese._id);
    
    expect(baseAfter.stock).toBe(99);
    expect(baseAfter.reserved).toBe(0);
    expect(sauceAfter.stock).toBe(99);
    expect(sauceAfter.reserved).toBe(0);
    expect(cheeseAfter.stock).toBe(99);
    expect(cheeseAfter.reserved).toBe(0);
  });

  it('rejects missing required fields', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_TestMissing123',
      paymentStatus: 'created'
    });

    // Missing orderId
    let response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELDS');

    // Missing razorpayOrderId
    response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELDS');

    // Missing razorpayPaymentId
    response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELDS');

    // Missing razorpaySignature
    response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: 'pay_Test123'
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELDS');
  });

  it('rejects invalid order ID format', async () => {
    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: 'invalid-id',
        razorpayOrderId: 'order_Test123',
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ORDER_ID');
  });

  it('rejects non-existent orders', async () => {
    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: new mongoose.Types.ObjectId().toString(),
        razorpayOrderId: 'order_Test123',
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('prevents verification of another customer\'s order', async () => {
    const otherCustomer = await User.create({
      email: 'other-verify-owner@example.com',
      password: 'Password123!',
      role: 'customer',
      isVerified: true
    });

    const order = await makeOrder({
      customerId: otherCustomer._id,
      razorpayOrderId: 'order_OtherCustomer123',
      paymentStatus: 'created'
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('rejects orders not in pending_payment state', async () => {
    const order = await makeOrder({
      orderState: 'in_kitchen', // Invalid state for payment
      razorpayOrderId: 'order_Received123',
      paymentStatus: 'paid'
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_ORDER_STATE');
  });

  it('rejects orders without initiated payment', async () => {
    const order = await makeOrder({
      customerId: customer._id,
      razorpayOrderId: null,
      paymentStatus: 'pending_gateway'
    });

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: 'order_Test123',
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NO_GATEWAY_ORDER');
  });

  it('rejects mismatched Razorpay order IDs', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_StoredInDB123',
      paymentStatus: 'created'
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const wrongOrderId = 'order_DifferentID456';
    const body = `${wrongOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: wrongOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('ORDER_ID_MISMATCH');
  });

  it('rejects invalid signatures', async () => {
    const order = await makeOrder({
      customerId: customer._id,
      razorpayOrderId: 'order_SignatureTest123',
      paymentStatus: 'created'
    });

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: 'pay_TestPayment123',
        razorpaySignature: 'invalid_signature_wrong_hmac'
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects signatures with wrong secret', async () => {
    const order = await makeOrder({
      customerId: customer._id,
      razorpayOrderId: 'order_WrongSecret123',
      paymentStatus: 'created'
    });

    // Generate signature with wrong secret
    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const wrongSignature = crypto.default
      .createHmac('sha256', 'wrong_secret_key')
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: wrongSignature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('requires authentication', async () => {
    const unauthenticatedAgent = request.agent(app);

    await unauthenticatedAgent.get('/api/auth/csrf-token');
    const csrfResponse = await unauthenticatedAgent.get('/api/auth/csrf-token');
    const unauthCsrf = csrfResponse.body.csrfToken;

    const response = await unauthenticatedAgent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', unauthCsrf)
      .send({
        orderId: new mongoose.Types.ObjectId().toString(),
        razorpayOrderId: 'order_Test123',
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(401);
  });

  it('requires CSRF token', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_CSRFTest123',
      paymentStatus: 'created'
    });

    const response = await agent
      .post('/api/v1/payments/verify')
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: 'pay_Test123',
        razorpaySignature: 'a'.repeat(64)
      });

    expect(response.status).toBe(403);
  });
});




describe('Task 4.5 Step 2 — Payment capture verification', () => {

  it('successfully verifies a captured payment from gateway', async () => {
    // Setup test ingredients
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    const order = await makeOrder({
      razorpayOrderId: 'order_CaptureTest123',
      paymentStatus: 'created',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $inc: { reserved: 1 } }
    );

    // Mock successful payment fetch
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_CapturedPayment123',
      order_id: 'order_CaptureTest123',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_CapturedPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(gatewayMock.payments.fetch).toHaveBeenCalledWith(razorpayPaymentId);
    expect(gatewayMock.payments.fetch).toHaveBeenCalledOnce();

    // Verify inventory committed
    const baseAfter = await Ingredient.findById(base._id);
    expect(baseAfter.stock).toBe(99);
    expect(baseAfter.reserved).toBe(0);
  });

  it('rejects when Razorpay API fetch fails', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_APIFailure123',
      paymentStatus: 'created'
    });

    // Mock gateway API failure
    gatewayMock.payments.fetch.mockRejectedValueOnce(
      new Error('Network timeout')
    );

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PAYMENT_FETCH_FAILED');
  });

  it('rejects when payment ID does not match', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_IDMismatch123',
      paymentStatus: 'created'
    });

    // Mock payment with different ID
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_DifferentPayment999',
      order_id: 'order_IDMismatch123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_ExpectedPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_ID_MISMATCH');
  });

  it('rejects when payment belongs to different order', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_Expected123',
      paymentStatus: 'created'
    });

    // Mock payment with different order_id
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_Different999',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_ORDER_MISMATCH');
  });

  it('rejects when payment amount does not match order total', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_AmountMismatch123',
      paymentStatus: 'created',
      totalPricePaise: 25000
    });

    // Mock payment with different amount
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_AmountMismatch123',
      amount: 35000, // Different amount
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
  });

  it('rejects when payment currency is not INR', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_CurrencyTest123',
      paymentStatus: 'created'
    });

    // Mock payment with wrong currency
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_CurrencyTest123',
      amount: 25000,
      currency: 'USD', // Wrong currency
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_CURRENCY_MISMATCH');
  });

  it('rejects when payment status is not captured', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_NotCaptured123',
      paymentStatus: 'created'
    });

    // Mock payment with authorized but not captured status
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_NotCaptured123',
      amount: 25000,
      currency: 'INR',
      status: 'authorized', // Not captured
      captured: false
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_NOT_CAPTURED');
  });

  it('rejects when captured flag is inconsistent with status', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_InconsistentCapture123',
      paymentStatus: 'created'
    });

    // Mock payment with captured status but captured=false flag
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_InconsistentCapture123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: false // Inconsistent with status
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_CAPTURE_INCONSISTENT');
  });

  it('does NOT update payment status after successful verification', async () => {
    const order = await makeOrder({
      razorpayOrderId: 'order_NoUpdate123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [] // Empty for Step 2 test
      }
    });

    // Mock captured payment
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_TestPayment123',
      order_id: 'order_NoUpdate123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_TestPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    // With Step 3A, will fail with NO_RESERVATION_LINES
    expect(response.status).toBe(500);

    // Verify order state unchanged
    const saved = await Order.findById(order._id);
    expect(saved.paymentStatus).toBe('created'); // NOT 'paid'
    expect(saved.orderState).toBe('pending_payment'); // NOT 'received'
    expect(saved.reservation.state).toBe('held'); // NOT 'committed'
    expect(saved.razorpayPaymentId).toBeNull(); // NOT persisted yet
  });
});

describe('Task 4.5 Step 3A — Payment commitment and inventory', () => {

  it('commits inventory and updates order state after successful verification', async () => {
    // Create ingredients first
    const [base, sauce, cheese] = await Ingredient.create([
      { name: 'Commit Test Base', category: 'base', pricePaise: 10000, stock: 100, reserved: 2 },
      { name: 'Commit Test Sauce', category: 'sauce', pricePaise: 5000, stock: 100, reserved: 2 },
      { name: 'Commit Test Cheese', category: 'cheese', pricePaise: 10000, stock: 100, reserved: 2 }
    ]);

    const order = await makeOrder({
      razorpayOrderId: 'order_CommitTest123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 2 },
          { ingredientId: sauce._id, qty: 2 },
          { ingredientId: cheese._id, qty: 2 }
        ]
      }
    });

    // Mock captured payment
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_CommitPayment123',
      order_id: 'order_CommitTest123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_CommitPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.committed).toBe(true);

    // Verify order state updated
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.razorpaySignature).toBe(signature);
    expect(savedOrder.paymentStatus).toBe('paid');
    expect(savedOrder.orderState).toBe('received');
    expect(savedOrder.reservation.state).toBe('committed');
    expect(savedOrder.reservation.committedAt).toBeInstanceOf(Date);

    // Verify inventory committed (stock and reserved both decremented)
    const updatedBase = await Ingredient.findById(base._id);
    expect(updatedBase.stock).toBe(98); // 100 - 2
    expect(updatedBase.reserved).toBe(0); // 2 - 2

    const updatedSauce = await Ingredient.findById(sauce._id);
    expect(updatedSauce.stock).toBe(98);
    expect(updatedSauce.reserved).toBe(0);

    const updatedCheese = await Ingredient.findById(cheese._id);
    expect(updatedCheese.stock).toBe(98);
    expect(updatedCheese.reserved).toBe(0);
  });

  it('is idempotent - duplicate verification does not commit inventory twice', async () => {
    const [base, sauce, cheese] = await Ingredient.create([
      { name: 'Idempotent Base', category: 'base', pricePaise: 10000, stock: 100, reserved: 1 },
      { name: 'Idempotent Sauce', category: 'sauce', pricePaise: 5000, stock: 100, reserved: 1 },
      { name: 'Idempotent Cheese', category: 'cheese', pricePaise: 10000, stock: 100, reserved: 1 }
    ]);

    const order = await makeOrder({
      razorpayOrderId: 'order_Idempotent123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    // Mock captured payment
    gatewayMock.payments.fetch.mockResolvedValue({
      id: 'pay_IdempotentPayment123',
      order_id: 'order_Idempotent123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_IdempotentPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    // First verification - should commit
    const response1 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response1.status).toBe(200);

    // Check inventory after first commit
    const baseAfterFirst = await Ingredient.findById(base._id);
    expect(baseAfterFirst.stock).toBe(99);
    expect(baseAfterFirst.reserved).toBe(0);

    // Second verification with same payment - should be idempotent
    const response2 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response2.status).toBe(200);
    expect(response2.body.committed).toBe(true);

    // Check inventory didn't change on second call
    const baseAfterSecond = await Ingredient.findById(base._id);
    expect(baseAfterSecond.stock).toBe(99); // Still 99, not 98
    expect(baseAfterSecond.reserved).toBe(0); // Still 0
  });

  it('rejects conflicting payment ID without overwriting', async () => {
    const [base] = await Ingredient.create([
      { name: 'Conflict Base', category: 'base', pricePaise: 10000, stock: 100, reserved: 1 }
    ]);

    const order = await makeOrder({
      razorpayOrderId: 'order_Conflict123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [{ ingredientId: base._id, qty: 1 }]
      }
    });

    // First payment - mock and verify
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_FirstPayment123',
      order_id: 'order_Conflict123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const firstPaymentId = 'pay_FirstPayment123';
    const firstBody = `${order.razorpayOrderId}|${firstPaymentId}`;
    const firstSignature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(firstBody)
      .digest('hex');

    const response1 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: firstPaymentId,
        razorpaySignature: firstSignature
      });

    expect(response1.status).toBe(200);

    // Try second payment with different ID - should be rejected
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_SecondPayment999',
      order_id: 'order_Conflict123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const secondPaymentId = 'pay_SecondPayment999';
    const secondBody = `${order.razorpayOrderId}|${secondPaymentId}`;
    const secondSignature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(secondBody)
      .digest('hex');

    const response2 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: secondPaymentId,
        razorpaySignature: secondSignature
      });

    expect(response2.status).toBe(409);
    expect(response2.body.error.code).toBe('PAYMENT_CONFLICT');

    // Verify original payment preserved
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(firstPaymentId);
    expect(savedOrder.razorpaySignature).toBe(firstSignature);
  });

  it('rolls back transaction if inventory commitment fails', async () => {
    const [base] = await Ingredient.create([
      { name: 'Rollback Base', category: 'base', pricePaise: 10000, stock: 10, reserved: 1 }
    ]);

    const order = await makeOrder({
      razorpayOrderId: 'order_Rollback123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 20 } // More than available
        ]
      }
    });

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_RollbackPayment123',
      order_id: 'order_Rollback123',
      amount: 25000,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_RollbackPayment123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INVENTORY_COMMIT_FAILED');

    // Verify order state NOT changed (transaction rolled back)
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBeNull();
    expect(savedOrder.paymentStatus).toBe('created'); // NOT 'paid'
    expect(savedOrder.orderState).toBe('pending_payment'); // NOT 'received'
    expect(savedOrder.reservation.state).toBe('held'); // NOT 'committed'

    // Verify inventory NOT changed
    const savedBase = await Ingredient.findById(base._id);
    expect(savedBase.stock).toBe(10); // Unchanged
    expect(savedBase.reserved).toBe(1); // Unchanged
  });

  // FOCUSED TEST 1: Verify razorpayPaymentId persistence
  it('persists razorpayPaymentId and signature after commitment', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    const order = await makeOrder({
      razorpayOrderId: 'order_PersistTest456',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 2 },
          { ingredientId: sauce._id, qty: 2 },
          { ingredientId: cheese._id, qty: 2 }
        ]
      }
    });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $inc: { reserved: 2 } }
    );

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_Persist789',
      order_id: 'order_PersistTest456',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_Persist789';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.committed).toBe(true);

    const saved = await Order.findById(order._id);
    expect(saved.razorpayPaymentId).toBe('pay_Persist789');
    expect(saved.razorpaySignature).toBe(signature);
    expect(saved.paymentStatus).toBe('paid');
    expect(saved.orderState).toBe('received');
    expect(saved.reservation.state).toBe('committed');
  });

  // FOCUSED TEST 2: Reservation state validation for committed reservations
  it('rejects already-committed reservations', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    const initialStock = { base: base.stock, sauce: sauce.stock, cheese: cheese.stock };

    const order = await makeOrder({
      razorpayOrderId: 'order_Committed789',
      paymentStatus: 'paid',
      orderState: 'received',
      reservation: {
        state: 'committed', // Already committed
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        committedAt: new Date(Date.now() - 5 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 2 },
          { ingredientId: sauce._id, qty: 2 },
          { ingredientId: cheese._id, qty: 2 }
        ]
      },
      razorpayPaymentId: 'pay_AlreadyCommitted123'
    });

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_AlreadyCommitted123',
      order_id: 'order_Committed789',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_AlreadyCommitted123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.committed).toBe(true);

    // Verify no inventory modification occurred
    const baseAfter = await Ingredient.findById(base._id);
    const sauceAfter = await Ingredient.findById(sauce._id);
    const cheeseAfter = await Ingredient.findById(cheese._id);
    
    expect(baseAfter.stock).toBe(initialStock.base);
    expect(sauceAfter.stock).toBe(initialStock.sauce);
    expect(cheeseAfter.stock).toBe(initialStock.cheese);
  });

  // FOCUSED TEST 3: Released/expired reservations handled by Step 3B (late payment)
  it('handles released reservation as late payment (Step 3B)', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    const initialStock = { base: base.stock, sauce: sauce.stock, cheese: cheese.stock };

    const order = await makeOrder({
      razorpayOrderId: 'order_ReleasedHandled789',
      paymentStatus: 'created',
      orderState: 'expired',
      reservation: {
        state: 'released', // Released by expiration
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() - 10 * 60 * 1000),
        releasedAt: new Date(Date.now() - 5 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 2 },
          { ingredientId: sauce._id, qty: 2 },
          { ingredientId: cheese._id, qty: 2 }
        ]
      }
    });

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_ReleasedHandled456',
      order_id: 'order_ReleasedHandled789',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_ReleasedHandled456';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    // Step 3B handles this gracefully
    expect(response.status).toBe(200);
    expect(response.body.requiresResolution).toBe(true);

    // Verify no inventory modification occurred
    const baseAfter = await Ingredient.findById(base._id);
    const sauceAfter = await Ingredient.findById(sauce._id);
    const cheeseAfter = await Ingredient.findById(cheese._id);
    
    expect(baseAfter.stock).toBe(initialStock.base);
    expect(sauceAfter.stock).toBe(initialStock.sauce);
    expect(cheeseAfter.stock).toBe(initialStock.cheese);

    // Order should have late payment status
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.paymentStatus).toBe('paid_after_expiry');
    expect(savedOrder.reservation.state).toBe('released');
  });

  it('handles expired reservation as late payment (Step 3B)', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    const order = await makeOrder({
      razorpayOrderId: 'order_Expired789',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000), // Expired
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $inc: { reserved: 1 } }
    );

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_Expired123',
      order_id: 'order_Expired789',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_Expired123';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.requiresResolution).toBe(true);

    // Verify order not committed but payment persisted
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.paymentStatus).toBe('paid_after_expiry');
    expect(savedOrder.reservation.state).toBe('held');
  });

  // FOCUSED TEST 4: Concurrent commitment prevention with genuine concurrency
  it('prevents duplicate inventory commitment from concurrent requests', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    const order = await makeOrder({
      razorpayOrderId: 'order_Concurrent456',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 5 },
          { ingredientId: sauce._id, qty: 5 },
          { ingredientId: cheese._id, qty: 5 }
        ]
      }
    });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $inc: { reserved: 5 } }
    );

    const razorpayPaymentId = 'pay_Concurrent999';
    gatewayMock.payments.fetch.mockResolvedValue({
      id: razorpayPaymentId,
      order_id: 'order_Concurrent456',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    // Launch two concurrent requests
    const [response1, response2] = await Promise.all([
      agent
        .post('/api/v1/payments/verify')
        .set('x-csrf-token', csrfToken)
        .send({
          orderId: order._id.toString(),
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature: signature
        }),
      agent
        .post('/api/v1/payments/verify')
        .set('x-csrf-token', csrfToken)
        .send({
          orderId: order._id.toString(),
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature: signature
        })
    ]);

    // Both should succeed (idempotent)
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Verify inventory was only decremented once
    const baseAfter = await Ingredient.findById(base._id);
    const sauceAfter = await Ingredient.findById(sauce._id);
    const cheeseAfter = await Ingredient.findById(cheese._id);

    expect(baseAfter.stock).toBe(95); // Only decremented once (100 - 5)
    expect(baseAfter.reserved).toBe(0);
    expect(sauceAfter.stock).toBe(95);
    expect(sauceAfter.reserved).toBe(0);
    expect(cheeseAfter.stock).toBe(95);
    expect(cheeseAfter.reserved).toBe(0);

    // Verify order has correct final state
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.paymentStatus).toBe('paid');
    expect(savedOrder.reservation.state).toBe('committed');
  });
});

describe('Task 4.5 Step 3B — Late payment handling', () => {

  it('persists late payment without committing expired reservation', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    // Create order with expired reservation
    const order = await makeOrder({
      razorpayOrderId: 'order_LatePayment123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired 5 minutes ago
        lines: [
          { ingredientId: base._id, qty: 2 },
          { ingredientId: sauce._id, qty: 2 },
          { ingredientId: cheese._id, qty: 2 }
        ]
      }
    });

    // Mock captured payment
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_LatePayment456',
      order_id: 'order_LatePayment123',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_LatePayment456';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.committed).toBe(false);
    expect(response.body.requiresResolution).toBe(true);
    expect(response.body.paymentStatus).toBe('paid_after_expiry');

    // Verify payment details persisted
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.razorpaySignature).toBe(signature);
    expect(savedOrder.paymentStatus).toBe('paid_after_expiry');
    expect(savedOrder.orderState).toBe('pending_payment'); // Not 'received'
    expect(savedOrder.reservation.state).toBe('held'); // Not 'committed'

    // Verify NO inventory modification
    const baseAfter = await Ingredient.findById(base._id);
    const sauceAfter = await Ingredient.findById(sauce._id);
    const cheeseAfter = await Ingredient.findById(cheese._id);
    
    expect(baseAfter.stock).toBe(100); // Unchanged
    expect(baseAfter.reserved).toBe(0); // Unchanged
    expect(sauceAfter.stock).toBe(100);
    expect(sauceAfter.reserved).toBe(0);
    expect(cheeseAfter.stock).toBe(100);
    expect(cheeseAfter.reserved).toBe(0);
  });

  it('persists late payment for released reservation without committing', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    // Create order with released reservation
    const order = await makeOrder({
      razorpayOrderId: 'order_ReleasedLate789',
      paymentStatus: 'created',
      orderState: 'expired',
      reservation: {
        state: 'released', // Already released
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() - 10 * 60 * 1000),
        releasedAt: new Date(Date.now() - 5 * 60 * 1000),
        lines: [
          { ingredientId: base._id, qty: 3 },
          { ingredientId: sauce._id, qty: 3 },
          { ingredientId: cheese._id, qty: 3 }
        ]
      }
    });

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_ReleasedLate999',
      order_id: 'order_ReleasedLate789',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_ReleasedLate999';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.committed).toBe(false);
    expect(response.body.requiresResolution).toBe(true);

    // Verify payment persisted but reservation remains released
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.paymentStatus).toBe('paid_after_expiry');
    expect(savedOrder.orderState).toBe('expired'); // Unchanged
    expect(savedOrder.reservation.state).toBe('released'); // Unchanged

    // Verify NO inventory modification
    const baseAfter = await Ingredient.findById(base._id);
    expect(baseAfter.stock).toBe(100);
    expect(baseAfter.reserved).toBe(0);
  });

  it('is idempotent for repeated late payment verification', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    const order = await makeOrder({
      razorpayOrderId: 'order_LateIdempotent456',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000), // Expired
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    const razorpayPaymentId = 'pay_LateIdem789';
    gatewayMock.payments.fetch.mockResolvedValue({
      id: razorpayPaymentId,
      order_id: 'order_LateIdempotent456',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    // First request
    const response1 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response1.status).toBe(200);
    expect(response1.body.requiresResolution).toBe(true);

    // Second request - should be idempotent
    const response2 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response2.status).toBe(200);
    expect(response2.body.requiresResolution).toBe(true);
    expect(response2.body.paymentStatus).toBe('paid_after_expiry');

    // Verify still no inventory modification
    const baseAfter = await Ingredient.findById(base._id);
    expect(baseAfter.stock).toBe(100);
    expect(baseAfter.reserved).toBe(0);
  });

  it('rejects conflicting payment ID for late payment', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    const order = await makeOrder({
      razorpayOrderId: 'order_LateConflict999',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(Date.now() - 30 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000), // Expired
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    // First payment
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_FirstLate111',
      order_id: 'order_LateConflict999',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const firstPaymentId = 'pay_FirstLate111';
    const firstBody = `${order.razorpayOrderId}|${firstPaymentId}`;
    const firstSignature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(firstBody)
      .digest('hex');

    const response1 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: firstPaymentId,
        razorpaySignature: firstSignature
      });

    expect(response1.status).toBe(200);

    // Try second payment with different ID - should be rejected
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_SecondLate222',
      order_id: 'order_LateConflict999',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const secondPaymentId = 'pay_SecondLate222';
    const secondBody = `${order.razorpayOrderId}|${secondPaymentId}`;
    const secondSignature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(secondBody)
      .digest('hex');

    const response2 = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: secondPaymentId,
        razorpaySignature: secondSignature
      });

    expect(response2.status).toBe(409);
    expect(response2.body.error.code).toBe('PAYMENT_CONFLICT');

    // Verify first payment preserved
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(firstPaymentId);
    expect(savedOrder.paymentStatus).toBe('paid_after_expiry');
  });

  it('handles payment-versus-expiration race correctly', async () => {
    const base = await Ingredient.findOne({ category: 'base' });
    const sauce = await Ingredient.findOne({ category: 'sauce' });
    const cheese = await Ingredient.findOne({ category: 'cheese' });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $set: { stock: 100, reserved: 0 } }
    );

    // Create order expiring in 100ms
    const order = await makeOrder({
      razorpayOrderId: 'order_Race123',
      paymentStatus: 'created',
      orderState: 'pending_payment',
      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + 100), // Expires very soon
        lines: [
          { ingredientId: base._id, qty: 1 },
          { ingredientId: sauce._id, qty: 1 },
          { ingredientId: cheese._id, qty: 1 }
        ]
      }
    });

    await Ingredient.updateMany(
      { _id: { $in: [base._id, sauce._id, cheese._id] } },
      { $inc: { reserved: 1 } }
    );

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));

    // Now verify payment after expiration
    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: 'pay_Race456',
      order_id: 'order_Race123',
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const crypto = await import('crypto');
    const razorpayPaymentId = 'pay_Race456';
    const body = `${order.razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto.default
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(200);
    expect(response.body.requiresResolution).toBe(true);

    // Verify payment persisted but inventory not committed
    const savedOrder = await Order.findById(order._id);
    expect(savedOrder.razorpayPaymentId).toBe(razorpayPaymentId);
    expect(savedOrder.paymentStatus).toBe('paid_after_expiry');

    // Inventory should still be reserved (expiration worker hasn't run)
    const baseAfter = await Ingredient.findById(base._id);
    expect(baseAfter.reserved).toBe(1); // Still reserved
  });

  it('coordinates concurrent payment verification and expiration without double inventory changes', async () => {
  // Create ingredients with existing reservations.
  const [base, sauce, cheese] = await Ingredient.create([
    {
      name: 'Expiration Race Base',
      category: 'base',
      pricePaise: 10000,
      stock: 100,
      reserved: 1,
      isActive: true
    },
    {
      name: 'Expiration Race Sauce',
      category: 'sauce',
      pricePaise: 5000,
      stock: 100,
      reserved: 1,
      isActive: true
    },
    {
      name: 'Expiration Race Cheese',
      category: 'cheese',
      pricePaise: 10000,
      stock: 100,
      reserved: 1,
      isActive: true
    }
  ]);

  // Create an order item matching the reservation.
  const item = {
    name: 'Expiration Race Pizza',
    quantity: 1,

    base: {
      ingredientId: base._id,
      name: base.name,
      pricePaise: base.pricePaise
    },

    sauce: {
      ingredientId: sauce._id,
      name: sauce.name,
      pricePaise: sauce.pricePaise
    },

    cheese: {
      ingredientId: cheese._id,
      name: cheese.name,
      pricePaise: cheese.pricePaise
    },

    vegetables: [],
    unitPricePaise: 25000,
    lineTotalPaise: 25000
  };

  const razorpayOrderId = 'order_ExpiryConcurrent123';
  const razorpayPaymentId = 'pay_ExpiryConcurrent123';

  // Create an order whose reservation has expired
  // but whose inventory is still held.
  const order = await makeOrder({
    items: [item],
    razorpayOrderId,
    paymentStatus: 'created',

    reservation: {
      state: 'held',

      reservedAt: new Date(
        Date.now() - 20 * 60_000
      ),

      expiresAt: new Date(
        Date.now() - 60_000
      ),

      lines: [base, sauce, cheese].map(
        ingredient => ({
          ingredientId: ingredient._id,
          qty: 1
        })
      )
    }
  });

  // Mock a successfully captured Razorpay payment.
  gatewayMock.payments.fetch.mockResolvedValue({
    id: razorpayPaymentId,
    order_id: razorpayOrderId,
    amount: 25000,
    currency: 'INR',
    status: 'captured',
    captured: true
  });

  // Generate a valid Razorpay signature.
  const crypto = await import('crypto');

  const razorpaySignature = crypto.default
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  // Start payment verification and reservation
  // expiration concurrently against the same order.
  const [paymentResponse, expiration] = await Promise.all([
    agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      }),

    expireOrderReservation(order._id)
  ]);

  // Payment must be verified, but inventory
  // must not be committed after expiration.
  expect(paymentResponse.status).toBe(200);

  expect(
    paymentResponse.body.requiresResolution
  ).toBe(true);

  expect(
    paymentResponse.body.committed
  ).toBe(false);

  // Expiration must release the held inventory.
  expect(expiration.expired).toBe(true);

  // Verify the final order state.
  const saved = await Order.findById(order._id);

  expect(saved.orderState).toBe('expired');

  expect(saved.paymentStatus).toBe(
    'paid_after_expiry'
  );

  expect(saved.razorpayPaymentId).toBe(
    razorpayPaymentId
  );

  expect(saved.reservation.state).toBe(
    'released'
  );

  expect(
    saved.reservation.releasedAt
  ).toBeInstanceOf(Date);

  expect(
    saved.reservation.committedAt
  ).toBeNull();

  // Physical stock must remain unchanged.
  // Reserved quantities must be released exactly once.
  for (const ingredient of [base, sauce, cheese]) {
    const updated = await Ingredient.findById(
      ingredient._id
    );

    expect(updated.stock).toBe(100);
    expect(updated.reserved).toBe(0);
  }
});

/**
 * Task 4.8 — Payment Security Regression Tests
 */
describe('Task 4.8 — Payment verification hardening', () => {

  function signPayment(razorpayOrderId, razorpayPaymentId) {
    return createHmac(
      'sha256',
      env.RAZORPAY_KEY_SECRET
    )
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
  }

  it.each([
    'in_kitchen',
    'sent_to_delivery'
  ])(
    'allows verification retry for an already-paid order in %s without deducting inventory again',
    async (orderState) => {

      const ingredient = await Ingredient.create({
        name: `Retry Test Base ${++sequence}`,
        category: 'base',
        pricePaise: 10000,
        stock: 25,
        reserved: 0,
        isActive: true
      });

      const razorpayOrderId =
        `order_Retry_${orderState}`;

      const razorpayPaymentId =
        `pay_Retry_${orderState}`;

      const signature = signPayment(
        razorpayOrderId,
        razorpayPaymentId
      );

      const order = await makeOrder({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: signature,
        paymentStatus: 'paid',
        orderState,

        reservation: {
          state: 'committed',

          reservedAt: new Date(
            Date.now() - 60_000
          ),

          expiresAt: new Date(
            Date.now() - 10_000
          ),

          committedAt: new Date(
            Date.now() - 20_000
          ),

          lines: [
            {
              ingredientId: ingredient._id,
              qty: 1
            }
          ]
        }
      });

      gatewayMock.payments.fetch.mockResolvedValueOnce({
        id: razorpayPaymentId,
        order_id: razorpayOrderId,
        amount: order.totalPricePaise,
        currency: 'INR',
        status: 'captured',
        captured: true
      });

      const response = await agent
        .post('/api/v1/payments/verify')
        .set('x-csrf-token', csrfToken)
        .send({
          orderId: order._id.toString(),
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature: signature
        });

      expect(response.status).toBe(200);
      expect(response.body.verified).toBe(true);
      expect(response.body.committed).toBe(true);

      expect(
        gatewayMock.payments.fetch
      ).toHaveBeenCalledWith(razorpayPaymentId);

      const savedOrder = await Order.findById(
        order._id
      );

      expect(savedOrder.orderState).toBe(orderState);
      expect(savedOrder.paymentStatus).toBe('paid');

      expect(savedOrder.razorpayPaymentId).toBe(
        razorpayPaymentId
      );

      expect(savedOrder.reservation.state).toBe(
        'committed'
      );

      // An idempotent retry must not deduct inventory.
      const updatedIngredient = await Ingredient.findById(
        ingredient._id
      );

      expect(updatedIngredient.stock).toBe(25);
      expect(updatedIngredient.reserved).toBe(0);
    }
  );

  it('rejects a different payment after an order reaches delivery', async () => {

    const razorpayOrderId = 'order_DeliveryConflict123';
    const originalPaymentId = 'pay_OriginalDelivery123';
    const differentPaymentId = 'pay_DifferentDelivery456';

    const order = await makeOrder({
      razorpayOrderId,
      razorpayPaymentId: originalPaymentId,
      paymentStatus: 'paid',
      orderState: 'sent_to_delivery',

      reservation: {
        state: 'committed',
        reservedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 15 * 60_000),
        committedAt: new Date(),
        lines: []
      }
    });

    const signature = signPayment(
      razorpayOrderId,
      differentPaymentId
    );

    const response = await agent
      .post('/api/v1/payments/verify')
      .set('x-csrf-token', csrfToken)
      .send({
        orderId: order._id.toString(),
        razorpayOrderId,
        razorpayPaymentId: differentPaymentId,
        razorpaySignature: signature
      });

    expect(response.status).toBe(409);

    expect(response.body.error.code).toBe(
      'INVALID_ORDER_STATE'
    );

    expect(
      gatewayMock.payments.fetch
    ).not.toHaveBeenCalled();

    const savedOrder = await Order.findById(
      order._id
    );

    expect(savedOrder.razorpayPaymentId).toBe(
      originalPaymentId
    );

    expect(savedOrder.paymentStatus).toBe('paid');
    expect(savedOrder.orderState).toBe(
      'sent_to_delivery'
    );
  });

  it('wraps unexpected database errors instead of exposing internal error codes', async () => {

    const ingredient = await Ingredient.create({
      name: `Database Error Test ${++sequence}`,
      category: 'base',
      pricePaise: 10000,
      stock: 10,
      reserved: 1,
      isActive: true
    });

    const razorpayOrderId = 'order_DatabaseError123';
    const razorpayPaymentId = 'pay_DatabaseError456';

    const order = await makeOrder({
      razorpayOrderId,
      paymentStatus: 'created',

      reservation: {
        state: 'held',
        reservedAt: new Date(),
        expiresAt: new Date(
          Date.now() + 15 * 60_000
        ),

        lines: [
          {
            ingredientId: ingredient._id,
            qty: 1
          }
        ]
      }
    });

    const signature = signPayment(
      razorpayOrderId,
      razorpayPaymentId
    );

    gatewayMock.payments.fetch.mockResolvedValueOnce({
      id: razorpayPaymentId,
      order_id: razorpayOrderId,
      amount: order.totalPricePaise,
      currency: 'INR',
      status: 'captured',
      captured: true
    });

    const databaseError = new Error(
      'DO_NOT_EXPOSE_DATABASE_DETAILS'
    );

    databaseError.code = 'DB_SIMULATED_FAILURE';

    const updateSpy = vi.spyOn(
      Ingredient,
      'updateOne'
    ).mockRejectedValueOnce(databaseError);

    try {
      const response = await agent
        .post('/api/v1/payments/verify')
        .set('x-csrf-token', csrfToken)
        .send({
          orderId: order._id.toString(),
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature: signature
        });

      expect(response.status).toBe(500);

      expect(response.body.error.code).toBe(
        'COMMITMENT_FAILED'
      );

      expect(
        JSON.stringify(response.body)
      ).not.toContain(
        'DO_NOT_EXPOSE_DATABASE_DETAILS'
      );

      // The failed transaction must not commit payment.
      const savedOrder = await Order.findById(order._id);

      expect(savedOrder.paymentStatus).toBe('created');
      expect(savedOrder.razorpayPaymentId).toBeNull();

      const savedIngredient = await Ingredient.findById(
        ingredient._id
      );

      expect(savedIngredient.stock).toBe(10);
      expect(savedIngredient.reserved).toBe(1);

    } finally {
      updateSpy.mockRestore();
    }
  });

});

});
