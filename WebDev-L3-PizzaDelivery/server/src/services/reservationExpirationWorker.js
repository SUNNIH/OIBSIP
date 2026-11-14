/**
 * Periodically release expired reservations and recover eligible late-paid orders.
 * Each operation uses its existing transactional service.
 */

import Order from '../models/Order.js';

import {
  expireOrderReservation
} from './inventoryReservation.js';

import {
  recoverLatePaidOrder
} from './latePaymentRecovery.js';

const SWEEP_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
const MAX_ORDERS_PER_SWEEP = 500;

/**
 * Find expired reservations and release their inventory.
 */
export async function sweepExpiredReservations() {
  let lastId = null;
  let checked = 0;
  let released = 0;
  let failed = 0;

  while (checked < MAX_ORDERS_PER_SWEEP) {
    const pageSize = Math.min(
      BATCH_SIZE,
      MAX_ORDERS_PER_SWEEP - checked
    );

    const query = Order.findExpiredReservations()
      .select('_id')
      .sort({ _id: 1 })
      .limit(pageSize)
      .lean();

    if (lastId) {
      query.where('_id').gt(lastId);
    }

    const orders = await query;

    if (orders.length === 0) {
      break;
    }

    for (const order of orders) {
      lastId = order._id;
      checked += 1;

      try {
        const result = await expireOrderReservation(
          order._id
        );

        if (result.expired) {
          released += 1;
        }

      } catch (error) {
        failed += 1;

        console.error(
          `[reservation-expiration] Failed for order ${order._id}:`,
          error
        );
      }
    }

    if (orders.length < pageSize) {
      break;
    }
  }

  return {
    checked,
    released,
    failed
  };
}

/**
 * Recover captured late payments after their expired reservations were released.
 * Orders requiring manual refund review are not retried automatically.
 */
export async function sweepLatePaymentRecoveries() {
  let lastId = null;
  let checked = 0;
  let recovered = 0;
  let unavailable = 0;
  let failed = 0;

  while (checked < MAX_ORDERS_PER_SWEEP) {
    const pageSize = Math.min(
      BATCH_SIZE,
      MAX_ORDERS_PER_SWEEP - checked
    );

    // Select only verified late-paid orders with released inventory.
    const filter = {
      paymentStatus: 'paid_after_expiry',

      orderState: {
        $in: ['pending_payment', 'expired']
      },

      'reservation.state': 'released',

      'reservation.releasedAt': {
        $type: 'date'
      },

      'reservation.committedAt': null,

      'reservation.expiresAt': {
        $lte: new Date()
      },

      requiresManualRefundReview: {
        $ne: true
      },

      razorpayPaymentId: {
        $type: 'string',
        $ne: ''
      },

      razorpaySignature: {
        $type: 'string',
        $ne: ''
      }
    };

    // Continue from the last processed order.
    if (lastId) {
      filter._id = {
        $gt: lastId
      };
    }

    const orders = await Order.find(filter)
      .select('_id')
      .sort({ _id: 1 })
      .limit(pageSize)
      .lean();

    if (orders.length === 0) {
      break;
    }

    for (const order of orders) {
      lastId = order._id;
      checked += 1;

      try {
        // The existing recovery service handles all inventory
        // deductions and order updates inside a transaction.
        const result = await recoverLatePaidOrder(
          order._id
        );

        if (
          result.recovered &&
          !result.alreadyRecovered
        ) {
          recovered += 1;
        }

      } catch (error) {

        if (error.code === 'INVENTORY_UNAVAILABLE') {

          // The recovery service flags the order for manual refund review.
          unavailable += 1;

          console.warn(
            `[late-payment-recovery] Stock unavailable for order ${order._id}`
          );

        } else if (
          error.code === 'RECOVERY_NOT_ELIGIBLE' ||
          error.code === 'RECOVERY_CONFLICT'
        ) {

          // Another operation may have resolved the order
          // after it was selected for processing.

        } else {

          // Temporary or unexpected failures are logged.
          // Eligible orders can be retried on a later sweep.
          failed += 1;

          console.error(
            `[late-payment-recovery] Failed for order ${order._id}:`,
            error
          );
        }
      }
    }

    if (orders.length < pageSize) {
      break;
    }
  }

  return {
    checked,
    recovered,
    unavailable,
    failed
  };
}

/**
 * Start recurring reservation expiration and late-payment recovery.
 */
export function startReservationExpirationWorker() {
  let stopped = false;
  let activeRun = null;

  const tick = () => {

    // Prevent overlapping worker cycles in this process.
    if (stopped || activeRun) {
      return;
    }

    activeRun = (async () => {

      // Release expired inventory first.
      try {
        const {
          checked,
          released,
          failed
        } = await sweepExpiredReservations();

        if (released || failed) {
          console.log(
            `[reservation-expiration] Checked ${checked}; ` +
            `released ${released}; failed ${failed}`
          );
        }

      } catch (error) {
        console.error(
          '[reservation-expiration] Sweep failed:',
          error
        );
      }

      // Attempt recovery after expired reservations are released.
      try {
        const {
          checked,
          recovered,
          unavailable,
          failed
        } = await sweepLatePaymentRecoveries();

        if (recovered || unavailable || failed) {
          console.log(
            `[late-payment-recovery] Checked ${checked}; ` +
            `recovered ${recovered}; ` +
            `unavailable ${unavailable}; failed ${failed}`
          );
        }

      } catch (error) {
        console.error(
          '[late-payment-recovery] Sweep failed:',
          error
        );
      }

    })().finally(() => {
      activeRun = null;
    });
  };

  // Run the worker every 30 seconds.
  const timer = setInterval(
    tick,
    SWEEP_INTERVAL_MS
  );

  // The timer should not prevent Node.js from exiting.
  timer.unref?.();

  // Run the first cycle immediately after startup.
  tick();

  return {

    /**
     * Stop scheduling and wait for an active worker cycle.
     */
    async stop() {
      stopped = true;

      clearInterval(timer);

      if (activeRun) {
        await activeRun;
      }
    }
  };
}