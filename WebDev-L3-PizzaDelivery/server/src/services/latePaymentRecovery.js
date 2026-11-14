/**
 * Recover a verified late-paid order after its original reservation was released.
 * All inventory and order changes commit together or are rolled back together.
 * This internal service must not be exposed as a customer-controlled endpoint.
 */

import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Ingredient from '../models/Ingredient.js';
import { calculateIngredientQuantities } from './inventoryReservation.js';

const TRANSACTION_TIMEOUT_MS = 10_000;

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Reallocate currently available stock to an already captured, late-paid order.
 * The original release timestamp is preserved for auditing.
 */
export async function recoverLatePaidOrder(orderId) {
  const id = String(orderId ?? '');

  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw recoveryError('INVALID_ORDER_ID', 'Valid orderId is required');
  }

  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);

      if (!order) {
        throw recoveryError('ORDER_NOT_FOUND', 'Order not found');
      }

      // A repeated recovery cannot deduct inventory a second time.
      if (
        order.paymentStatus === 'paid' &&
        order.orderState === 'received' &&
        order.reservation?.state === 'committed' &&
        order.reservation?.releasedAt &&
        order.reservation?.committedAt
      ) {
        return {
          success: true,
          recovered: true,
          alreadyRecovered: true,
          orderId: order._id.toString(),
          ingredientCount: 0
        };
      }

      const now = new Date();

      const eligible =
        order.paymentStatus === 'paid_after_expiry' &&
        ['pending_payment', 'expired'].includes(order.orderState) &&
        order.reservation?.state === 'released' &&
        order.reservation?.releasedAt instanceof Date &&
        order.reservation?.expiresAt instanceof Date &&
        order.reservation.expiresAt <= now &&
        !order.reservation.committedAt &&
        !order.requiresManualRefundReview &&
        typeof order.razorpayPaymentId === 'string' &&
        order.razorpayPaymentId.length > 0 &&
        typeof order.razorpaySignature === 'string' &&
        order.razorpaySignature.length > 0;

      if (!eligible) {
        throw recoveryError(
          'RECOVERY_NOT_ELIGIBLE',
          'Order is not eligible for late-payment recovery'
        );
      }

      // Reject missing, duplicate, or altered reservation quantities.
      const expected = calculateIngredientQuantities(order.items);

      const entries = Object.entries(expected).sort(
        ([a], [b]) => a.localeCompare(b)
      );

      const original = new Map();

      for (const line of order.reservation.lines ?? []) {
        const ingredientId = String(
          line.ingredientId ?? ''
        ).toLowerCase();

        if (
          !/^[0-9a-f]{24}$/.test(ingredientId) ||
          !Number.isSafeInteger(line.qty) ||
          line.qty <= 0 ||
          original.has(ingredientId)
        ) {
          throw recoveryError(
            'INVALID_RESERVATION',
            'Invalid reservation metadata'
          );
        }

        original.set(ingredientId, line.qty);
      }

      if (
        original.size !== entries.length ||
        entries.some(
          ([ingredientId, qty]) =>
            original.get(ingredientId) !== qty
        )
      ) {
        throw recoveryError(
          'INVALID_RESERVATION',
          'Reservation quantities do not match order items'
        );
      }

      // Claim the order first. Concurrent recovery attempts compete for
      // the same document, and a failed transaction rolls back the claim.
      const claim = await Order.updateOne(
        {
          _id: order._id,
          paymentStatus: 'paid_after_expiry',
          orderState: order.orderState,
          razorpayPaymentId: order.razorpayPaymentId,

          'reservation.state': 'released',
          'reservation.releasedAt': order.reservation.releasedAt,
          'reservation.committedAt': null,
          'reservation.expiresAt': { $lte: now },

          requiresManualRefundReview: { $ne: true }
        },
        {
          $set: {
            paymentStatus: 'paid',
            orderState: 'received',
            'reservation.state': 'committed',
            'reservation.committedAt': now
          }
        },
        {
          session,
          runValidators: true
        }
      );

      if (claim.modifiedCount !== 1) {
        throw recoveryError(
          'RECOVERY_CONFLICT',
          'Order changed during recovery'
        );
      }

      // Consume only currently unreserved stock. Other orders' reservations
      // are never reduced or borrowed. A shortage aborts the whole transaction.
      for (const [ingredientId, qty] of entries) {
        const result = await Ingredient.updateOne(
          {
            _id: ingredientId,
            isActive: true,

            $expr: {
              $gte: [
                { $subtract: ['$stock', '$reserved'] },
                qty
              ]
            }
          },
          {
            $inc: {
              stock: -qty
            }
          },
          { session }
        );

        if (result.modifiedCount !== 1) {
          throw recoveryError(
            'INVENTORY_UNAVAILABLE',
            `Ingredient unavailable for recovery: ${ingredientId}`
          );
        }
      }

      return {
        success: true,
        recovered: true,
        alreadyRecovered: false,
        orderId: order._id.toString(),
        ingredientCount: entries.length
      };

    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: TRANSACTION_TIMEOUT_MS
    });

  } catch (error) {

  // Captured payments requiring manual intervention.
  const requiresManualReview =
    error.code === 'INVENTORY_UNAVAILABLE' ||
    error.code === 'INVALID_RESERVATION';

  if (requiresManualReview) {

    const reviewNotes =
      error.code === 'INVALID_RESERVATION'
        ? 'Invalid reservation metadata during late-payment recovery. ' +
          'Captured payment requires manual refund review.'
        : 'Inventory unavailable during late-payment recovery. ' +
          'Captured payment requires manual refund review.';

    await Order.updateOne(
      {
        _id: id,

        paymentStatus: 'paid_after_expiry',

        orderState: {
          $in: ['pending_payment', 'expired']
        },

        'reservation.state': 'released',

        'reservation.committedAt': null,

        requiresManualRefundReview: {
          $ne: true
        }
      },

      {
        $set: {
          requiresManualRefundReview: true,
          manualReviewNotes: reviewNotes
        }
      }
    );
  }

  // Preserve the original recovery error.
  throw error;

} finally {
  await session.endSession();
}

}