/**
 * SUNNYS Pizza — Razorpay Payment Service
 *
 * Handles payment initiation, verification, inventory
 * commitment, and uncertain gateway order reconciliation.
 */
import Razorpay from 'razorpay';
import crypto from 'crypto';
import mongoose from 'mongoose';
import env from '../config/env.js';
import Order from '../models/Order.js';
import Ingredient from '../models/Ingredient.js';
const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET
});
const LOCK_MS = 30_000;
// Create a service error with a specific error code.
function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
// Format payment initiation response.
function checkoutDetails(order, existing) {
  return {
    orderId: order._id.toString(),
    razorpayOrderId: order.razorpayOrderId,
    amountPaise: order.totalPricePaise,
    currency: 'INR',
    keyId: env.RAZORPAY_KEY_ID,
    existing
  };
}
// Mark an uncertain gateway outcome for reconciliation.
async function flagForReconciliation(orderId, token, generation) {
  try {
    await Order.updateOne(
      {
        _id: orderId,
        'gatewayLock.token': token,
        'gatewayLock.fencingGeneration': generation,
        razorpayOrderId: null
      },
      {
        $set: {
          gatewayReconciliationRequired: true
        }
      }
    );
  } catch {
    console.error(
      'Unable to flag gateway reconciliation for order:',
      String(orderId)
    );
  }
}
// Reuse an existing Razorpay order only when its payment history is safe.
// The original gateway order is reused; do not create a second gateway order.
async function ensureGatewayOrderIsSafeToRetry(order) {
  let gatewayOrder;
  let paymentAttempts;
  try {
    [gatewayOrder, paymentAttempts] = await Promise.all([
      razorpay.orders.fetch(order.razorpayOrderId),
      razorpay.orders.fetchPayments(order.razorpayOrderId)
    ]);
  } catch (error) {
    console.error('Razorpay retry status check failed:', error);
    throw serviceError(
      'GATEWAY_OUTCOME_UNKNOWN',
      'Unable to check the previous payment. Do not retry yet.'
    );
  }

  // Fail closed on inconsistent or incomplete gateway responses.
  if (
    gatewayOrder?.id !== order.razorpayOrderId ||
    gatewayOrder.amount !== order.totalPricePaise ||
    gatewayOrder.currency !== 'INR' ||
    !Number.isFinite(gatewayOrder.amount_paid) ||
    !Array.isArray(paymentAttempts?.items) ||
    !Number.isSafeInteger(paymentAttempts.count) ||
    paymentAttempts.count !== paymentAttempts.items.length ||
    paymentAttempts.items.some(
      payment => payment.order_id !== order.razorpayOrderId
    )
  ) {
    throw serviceError(
      'GATEWAY_OUTCOME_UNKNOWN',
      'The previous payment status could not be verified.'
    );
  }

  // Only previously failed attempts (or no attempts) may be retried.
  // Authorized, captured, created, refunded, or unknown = stop and reconcile.
  if (
    gatewayOrder.amount_paid !== 0 ||
    gatewayOrder.status === 'paid' ||
    paymentAttempts.items.some(payment => payment.status !== 'failed')
  ) {
    throw serviceError(
      'GATEWAY_RECONCILIATION_REQUIRED',
      'A previous payment may have succeeded. Do not pay again.'
    );
  }
}

// Validate an order before initiating payment.
async function assessOrder(orderId, customerId) {
  const order = await Order.findOne({
    _id: orderId,
    customerId
  });
  if (!order) {
    throw serviceError(
      'ORDER_NOT_FOUND',
      'Order not found'
    );
  }
  if (order.orderState !== 'pending_payment') {
    throw serviceError(
      'INVALID_ORDER_STATE',
      'Order is not pending payment'
    );
  }
  if (
    order.reservation?.state !== 'held' ||
    !order.reservation?.expiresAt ||
    order.reservation.expiresAt <= new Date()
  ) {
    throw serviceError(
      'RESERVATION_EXPIRED',
      'Reservation is not active'
    );
  }
  if (order.gatewayReconciliationRequired) {
    throw serviceError(
      'GATEWAY_RECONCILIATION_REQUIRED',
      'Payment initiation requires reconciliation'
    );
  }
  // Reuse an existing gateway order instead of creating another.
  if (order.razorpayOrderId) {
    if (order.paymentStatus !== 'created') {
      throw serviceError(
        'GATEWAY_RECONCILIATION_REQUIRED',
        'Payment state requires review'
      );
    }
    await ensureGatewayOrderIsSafeToRetry(order);

    // Re-check order/reservation after the external API calls.
    const stillPending = await Order.findOne({
      _id: order._id,
      customerId,
      orderState: 'pending_payment',
      paymentStatus: 'created',
      razorpayOrderId: order.razorpayOrderId,
      'reservation.state': 'held',
      'reservation.expiresAt': { $gt: new Date() },
      gatewayReconciliationRequired: { $ne: true }
    });
    if (!stillPending) {
      throw serviceError(
        'GATEWAY_RECONCILIATION_REQUIRED',
        'Order state changed during payment retry.'
      );
    }
    return { response: checkoutDetails(stillPending, true) };
  }
  if (order.paymentStatus !== 'pending_gateway') {
    throw serviceError(
      'GATEWAY_RECONCILIATION_REQUIRED',
      'Payment initiation requires reconciliation'
    );
  }
  if (order.gatewayLock) {
    if (order.gatewayLock.expiresAt <= new Date()) {
      await flagForReconciliation(
        order._id,
        order.gatewayLock.token,
        order.gatewayLock.fencingGeneration
      );
      throw serviceError(
        'GATEWAY_RECONCILIATION_REQUIRED',
        'Previous gateway outcome is unknown'
      );
    }
    throw serviceError(
      'GATEWAY_LOCK_HELD',
      'Payment initiation is already in progress'
    );
  }
  return { order };
}
/**
 * Initiate payment for a customer-owned order.
 *
 * A persistent database lock must be acquired before
 * calling Razorpay. Unknown outcomes must not trigger
 * another gateway order creation.
 */
export async function initiatePayment(orderId, customerId) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw serviceError(
      'INVALID_ORDER_ID',
      'Invalid order ID format'
    );
  }
  const checked = await assessOrder(orderId, customerId);
  if (checked.response) {
    return checked.response;
  }
  const now = new Date();
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + LOCK_MS);
  // Atomically acquire gateway ownership.
  const lockedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      customerId,
      orderState: 'pending_payment',
      paymentStatus: 'pending_gateway',
      'reservation.state': 'held',
      'reservation.expiresAt': {
        $gt: now
      },
      razorpayOrderId: null,
      gatewayLock: null,
      gatewayReconciliationRequired: {
        $ne: true
      }
    },
    [
      {
        $set: {
          gatewayGeneration: {
            $add: [
              {
                $ifNull: ['$gatewayGeneration', 0]
              },
              1
            ]
          }
        }
      },
      {
        $set: {
          gatewayLock: {
            token,
            fencingGeneration: '$gatewayGeneration',
            acquiredAt: now,
            expiresAt
          }
        }
      }
    ],
    {
      returnDocument: 'after',
      updatePipeline: true
    }
  );
  if (!lockedOrder) {
    const latest = await assessOrder(orderId, customerId);
    if (latest.response) {
      return latest.response;
    }
    throw serviceError(
      'GATEWAY_LOCK_HELD',
      'Payment initiation is in progress'
    );
  }
  const generation =
    lockedOrder.gatewayLock.fencingGeneration;
  // Verify lock ownership before contacting Razorpay.
  const lockIsCurrent = await Order.exists({
    _id: lockedOrder._id,
    'gatewayLock.token': token,
    'gatewayLock.fencingGeneration': generation,
    'gatewayLock.expiresAt': {
      $gt: new Date()
    },
    razorpayOrderId: null
  });
  if (!lockIsCurrent) {
    await flagForReconciliation(
      lockedOrder._id,
      token,
      generation
    );
    throw serviceError(
      'FENCING_VIOLATION',
      'Gateway lock is no longer current'
    );
  }
  // Release the lock if the reservation expires before
  // the gateway request begins.
  if (lockedOrder.reservation.expiresAt <= new Date()) {
    try {
      await Order.updateOne(
        {
          _id: lockedOrder._id,
          'gatewayLock.token': token,
          'gatewayLock.fencingGeneration': generation,
          razorpayOrderId: null
        },
        {
          $set: {
            gatewayLock: null
          }
        }
      );
    } catch {
      console.error(
        'Unable to release gateway lock for expired reservation:',
        String(lockedOrder._id)
      );
    }
    throw serviceError(
      'RESERVATION_EXPIRED',
      'Reservation expired before gateway call'
    );
  }
  // Create Razorpay order using the saved backend price.
  let gatewayOrder;
  try {
    gatewayOrder = await razorpay.orders.create({
      amount: lockedOrder.totalPricePaise,
      currency: 'INR',
      receipt: `order_${lockedOrder._id}`,
      notes: {
        orderId: lockedOrder._id.toString()
      }
    });
  } catch {
    await flagForReconciliation(
      lockedOrder._id,
      token,
      generation
    );
    throw serviceError(
      'GATEWAY_OUTCOME_UNKNOWN',
      'Gateway outcome requires reconciliation'
    );
  }
  // Validate Razorpay response before persisting its ID.
  if (
    !gatewayOrder ||
    typeof gatewayOrder.id !== 'string' ||
    !Number.isSafeInteger(gatewayOrder.amount) ||
    gatewayOrder.amount !== lockedOrder.totalPricePaise ||
    gatewayOrder.currency !== 'INR'
  ) {
    await flagForReconciliation(
      lockedOrder._id,
      token,
      generation
    );
    throw serviceError(
      'GATEWAY_OUTCOME_UNKNOWN',
      'Gateway response requires reconciliation'
    );
  }
  // Persist the gateway order with fencing protection.
  let saved;
  try {
    saved = await Order.findOneAndUpdate(
      {
        _id: lockedOrder._id,
        customerId,
        razorpayOrderId: null,
        paymentStatus: 'pending_gateway',
        'gatewayLock.token': token,
        'gatewayLock.fencingGeneration': generation
      },
      {
        $set: {
          razorpayOrderId: gatewayOrder.id,
          paymentStatus: 'created',
          gatewayLock: null,
          gatewayReconciliationRequired: false
        }
      },
      {
        returnDocument: 'after',
        runValidators: true
      }
    );
  } catch {
    await flagForReconciliation(
      lockedOrder._id,
      token,
      generation
    );
    throw serviceError(
      'GATEWAY_OUTCOME_UNKNOWN',
      'Gateway order persistence requires reconciliation'
    );
  }
  if (!saved) {
    await flagForReconciliation(
      lockedOrder._id,
      token,
      generation
    );
    throw serviceError(
      'FENCING_VIOLATION',
      'Gateway ownership changed'
    );
  }
  if (
    saved.reservation.expiresAt <= new Date() ||
    saved.orderState !== 'pending_payment'
  ) {
    throw serviceError(
      'RESERVATION_EXPIRED',
      'Reservation expired during payment initiation'
    );
  }
  return checkoutDetails(saved, false);
}
/**
 * Verify Razorpay payment signature using HMAC-SHA256
 * and constant-time comparison.
 */
function verifyPaymentSignatureHelper(
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
) {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(razorpaySignature || '')) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(razorpaySignature, 'hex')
  );
}
/**
 * Verify payment and commit reserved inventory.
 *
 * Prevents duplicate commitments and handles payments
 * captured after the reservation expires.
 */
export async function verifyPayment(
  orderId,
  customerId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw serviceError(
      'INVALID_ORDER_ID',
      'Invalid order ID format'
    );
  }
  const order = await Order.findById(orderId);
  if (!order) {
    throw serviceError(
      'ORDER_NOT_FOUND',
      'Order not found'
    );
  }
  // Verify customer ownership.
  if (order.customerId.toString() !== customerId.toString()) {
    throw serviceError(
      'ORDER_NOT_FOUND',
      'Order not found'
    );
  }
  const eligibleStates = [
    'pending_payment',
    'received',
    'expired'
  ];
  const isExistingPaidRetry =
    ['in_kitchen', 'sent_to_delivery'].includes(
      order.orderState
    ) &&
    order.paymentStatus === 'paid' &&
    order.razorpayPaymentId === razorpayPaymentId;
  if (
    !eligibleStates.includes(order.orderState) &&
    !isExistingPaidRetry
  ) {
    throw serviceError(
      'INVALID_ORDER_STATE',
      'Order state does not permit payment verification'
    );
  }
  // Confirm that the gateway order belongs to this order.
  if (!order.razorpayOrderId) {
    throw serviceError(
      'NO_GATEWAY_ORDER',
      'No payment has been initiated for this order'
    );
  }
  if (order.razorpayOrderId !== razorpayOrderId) {
    throw serviceError(
      'ORDER_ID_MISMATCH',
      'Razorpay order ID does not match'
    );
  }
  // Verify the payment signature.
  const isValid = verifyPaymentSignatureHelper(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    throw serviceError(
      'INVALID_SIGNATURE',
      'Payment signature verification failed'
    );
  }
  // Fetch payment details directly from Razorpay.
  let payment;
  try {
    payment = await razorpay.payments.fetch(razorpayPaymentId);
  } catch (error) {
    console.error('Razorpay payment fetch failed:', error);
    throw serviceError(
      'PAYMENT_FETCH_FAILED',
      'Unable to verify payment with gateway'
    );
  }
  // Validate payment information.
  if (payment.id !== razorpayPaymentId) {
    throw serviceError(
      'PAYMENT_ID_MISMATCH',
      'Payment ID does not match gateway response'
    );
  }
  if (payment.order_id !== razorpayOrderId) {
    throw serviceError(
      'PAYMENT_ORDER_MISMATCH',
      'Payment does not belong to this order'
    );
  }
  if (payment.amount !== order.totalPricePaise) {
    throw serviceError(
      'PAYMENT_AMOUNT_MISMATCH',
      'Payment amount does not match order total'
    );
  }
  if (payment.currency !== 'INR') {
    throw serviceError(
      'PAYMENT_CURRENCY_MISMATCH',
      'Payment currency must be INR'
    );
  }
  if (payment.status !== 'captured') {
    throw serviceError(
      'PAYMENT_NOT_CAPTURED',
      'Payment has not been captured'
    );
  }
  if (!payment.captured) {
    throw serviceError(
      'PAYMENT_CAPTURE_INCONSISTENT',
      'Payment capture status is inconsistent'
    );
  }
  // Commit inventory and payment details atomically.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const orderInTx = await Order.findById(order._id)
        .session(session);
      if (!orderInTx) {
        throw serviceError(
          'ORDER_NOT_FOUND',
          'Order not found'
        );
      }
      // Prevent conflicting payments.
      if (
        orderInTx.razorpayPaymentId &&
        orderInTx.razorpayPaymentId !== razorpayPaymentId
      ) {
        throw serviceError(
          'PAYMENT_CONFLICT',
          'Order already has a different payment'
        );
      }
      // Skip duplicate inventory commitments.
      if (
        orderInTx.razorpayPaymentId === razorpayPaymentId &&
        orderInTx.paymentStatus === 'paid'
      ) {
        return;
      }
      if (
        orderInTx.razorpayPaymentId === razorpayPaymentId &&
        orderInTx.paymentStatus === 'paid_after_expiry'
      ) {
        return;
      }
      const now = new Date();
      const isExpired =
        orderInTx.reservation.expiresAt <= now;
      const isReleased =
        orderInTx.reservation.state === 'released';
      // Record late payments without committing inventory.
      if (isExpired || isReleased) {
        orderInTx.razorpayPaymentId = razorpayPaymentId;
        orderInTx.razorpaySignature = razorpaySignature;
        orderInTx.paymentStatus = 'paid_after_expiry';
        await orderInTx.save({ session });
        return;
      }
      if (orderInTx.reservation.state !== 'held') {
        throw serviceError(
          'RESERVATION_NOT_HELD',
          `Cannot commit inventory - reservation is ${orderInTx.reservation.state}`
        );
      }
      const reservationLines =
        orderInTx.reservation.lines || [];
      if (reservationLines.length === 0) {
        throw serviceError(
          'NO_RESERVATION_LINES',
          'Order has no reservation lines to commit'
        );
      }
      // Decrement stock and reserved quantities.
      for (const line of reservationLines) {
        const result = await Ingredient.updateOne(
          {
            _id: line.ingredientId,
            reserved: { $gte: line.qty },
            stock: { $gte: line.qty }
          },
          {
            $inc: {
              stock: -line.qty,
              reserved: -line.qty
            }
          },
          { session }
        );
        if (result.matchedCount === 0) {
          throw serviceError(
            'INVENTORY_COMMIT_FAILED',
            'Unable to commit inventory - insufficient stock or reserved quantity'
          );
        }
      }
      // Confirm payment and order.
      orderInTx.razorpayPaymentId = razorpayPaymentId;
      orderInTx.razorpaySignature = razorpaySignature;
      orderInTx.paymentStatus = 'paid';
      orderInTx.orderState = 'received';
      orderInTx.reservation.state = 'committed';
      orderInTx.reservation.committedAt = new Date();
      await orderInTx.save({ session });
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: 10000
    });
  } catch (error) {
    const expectedServiceErrors = new Set([
      'ORDER_NOT_FOUND',
      'PAYMENT_CONFLICT',
      'RESERVATION_NOT_HELD',
      'NO_RESERVATION_LINES',
      'INVENTORY_COMMIT_FAILED'
    ]);
    if (expectedServiceErrors.has(error.code)) {
      throw error;
    }
    console.error(
      'Payment commitment transaction failed:',
      error
    );
    throw serviceError(
      'COMMITMENT_FAILED',
      'Failed to commit payment and inventory'
    );
  } finally {
    await session.endSession();
  }
  // Retrieve final order state.
  const finalOrder = await Order.findById(order._id);
  if (finalOrder.paymentStatus === 'paid_after_expiry') {
    return {
      orderId: finalOrder._id.toString(),
      razorpayOrderId: finalOrder.razorpayOrderId,
      razorpayPaymentId,
      amountPaise: finalOrder.totalPricePaise,
      verified: true,
      committed: false,
      requiresResolution: true,
      paymentStatus: 'paid_after_expiry'
    };
  }
  return {
    orderId: finalOrder._id.toString(),
    razorpayOrderId: finalOrder.razorpayOrderId,
    razorpayPaymentId,
    amountPaise: finalOrder.totalPricePaise,
    verified: true,
    committed: true
  };
}
/**
 * Reconcile uncertain Razorpay order creation.
 *
 * This operation requires a Razorpay order ID obtained
 * through operator investigation.
 */
export async function reconcileGatewayOrder(
  localOrderId,
  razorpayOrderId
) {
  if (!mongoose.Types.ObjectId.isValid(localOrderId)) {
    throw serviceError(
      'INVALID_ORDER_ID',
      'Invalid order ID format'
    );
  }
  if (
    typeof razorpayOrderId !== 'string' ||
    !razorpayOrderId.startsWith('order_')
  ) {
    throw serviceError(
      'INVALID_RAZORPAY_ORDER_ID',
      'Invalid Razorpay order ID format'
    );
  }
  const order = await Order.findById(localOrderId);
  if (!order) {
    throw serviceError(
      'ORDER_NOT_FOUND',
      'Order not found'
    );
  }
  // Prevent reconciliation conflicts.
  if (!order.gatewayReconciliationRequired) {
    if (order.razorpayOrderId) {
      if (order.razorpayOrderId === razorpayOrderId) {
        return {
          status: 'already_reconciled',
          orderId: order._id.toString(),
          razorpayOrderId: order.razorpayOrderId,
          message: 'Order already reconciled with this gateway order'
        };
      }
      throw serviceError(
        'RECONCILIATION_CONFLICT',
        'Order already associated with different gateway order'
      );
    }
    throw serviceError(
      'RECONCILIATION_NOT_REQUIRED',
      'Order does not require reconciliation'
    );
  }
  if (order.orderState !== 'pending_payment') {
    throw serviceError(
      'INVALID_ORDER_STATE',
      'Order state does not permit reconciliation'
    );
  }
  if (order.paymentStatus !== 'pending_gateway') {
    throw serviceError(
      'INVALID_PAYMENT_STATUS',
      'Payment status does not permit reconciliation'
    );
  }
  // Retrieve the Razorpay order.
  let gatewayOrder;
  try {
    gatewayOrder = await razorpay.orders.fetch(
      razorpayOrderId
    );
  } catch {
    throw serviceError(
      'GATEWAY_ORDER_NOT_FOUND',
      'Razorpay order not found or cannot be fetched'
    );
  }
  // Verify gateway order metadata.
  const expectedReceipt = `order_${order._id}`;
  if (gatewayOrder.receipt !== expectedReceipt) {
    throw serviceError(
      'RECONCILIATION_MISMATCH',
      `Receipt mismatch: expected ${expectedReceipt}, got ${gatewayOrder.receipt}`
    );
  }
  if (
    !Number.isSafeInteger(gatewayOrder.amount) ||
    gatewayOrder.amount !== order.totalPricePaise
  ) {
    throw serviceError(
      'RECONCILIATION_MISMATCH',
      `Amount mismatch: expected ${order.totalPricePaise}, got ${gatewayOrder.amount}`
    );
  }
  if (gatewayOrder.currency !== 'INR') {
    throw serviceError(
      'RECONCILIATION_MISMATCH',
      `Currency mismatch: expected INR, got ${gatewayOrder.currency}`
    );
  }
  if (
    gatewayOrder.notes &&
    gatewayOrder.notes.orderId &&
    gatewayOrder.notes.orderId !== order._id.toString()
  ) {
    throw serviceError(
      'RECONCILIATION_MISMATCH',
      'Order ID in notes does not match'
    );
  }
  // Build the conditional update filter.
  let updateQuery;
  if (order.gatewayLock) {
    updateQuery = {
      _id: order._id,
      razorpayOrderId: null,
      paymentStatus: 'pending_gateway',
      gatewayReconciliationRequired: true,
      'gatewayLock.token': order.gatewayLock.token,
      'gatewayLock.fencingGeneration':
        order.gatewayLock.fencingGeneration
    };
  } else {
    updateQuery = {
      _id: order._id,
      razorpayOrderId: null,
      paymentStatus: 'pending_gateway',
      gatewayReconciliationRequired: true
    };
  }
  // Persist the reconciled gateway order.
  const reconciled = await Order.findOneAndUpdate(
    updateQuery,
    {
      $set: {
        razorpayOrderId: gatewayOrder.id,
        paymentStatus: 'created',
        gatewayReconciliationRequired: false,
        gatewayLock: null
      }
    },
    {
      returnDocument: 'after',
      runValidators: true
    }
  );
  if (!reconciled) {
    throw serviceError(
      'RECONCILIATION_CONFLICT',
      'Order state changed during reconciliation'
    );
  }
  return {
    status: 'reconciled',
    orderId: reconciled._id.toString(),
    razorpayOrderId: reconciled.razorpayOrderId,
    message: 'Gateway order successfully reconciled'
  };
}