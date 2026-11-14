/**
 * Inventory Reservation Service
 * 
 * Implements Phase 4 Task 4.2 atomic inventory reservations with:
 * - MongoDB transactions (OD-09)
 * - All-or-nothing reservations
 * - Conditional stock availability checks
 * - Concurrency protection against overselling
 * - Safe rollback and bounded retries
 * - Compatible with Order model reservation metadata
 * 
 * Approved decisions: OD-04, OD-09, OD-16, OD-17
 */

import mongoose from 'mongoose';
import Ingredient from '../models/Ingredient.js';
import Order from '../models/Order.js';

/**
 * Configuration constants
 */
const RESERVATION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes per OD-09
const MAX_TRANSACTION_RETRIES = 3;
const TRANSACTION_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Calculate ingredient quantities needed for an order
 * Aggregates quantities across all items considering pizza quantities
 * 
 * Per OD-16: Each pizza requires exactly 1 unit per selected ingredient
 * Per OD-17: Multi-line orders with quantities
 * 
 * @param {Array} items - Order items array from Order model
 * @returns {Object} Map of ingredientId -> total quantity needed
 */
export function calculateIngredientQuantities(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Order items must be a non-empty array');
  }

  const quantities = {};

  for (const item of items) {
    const pizzaQuantity = item?.quantity;

    // Only positive, safe integer quantities are allowed.
    if (!Number.isSafeInteger(pizzaQuantity) || pizzaQuantity <= 0) {
      throw new Error('Pizza quantity must be a positive safe integer');
    }

    // Vegetables are optional but must be an array when provided.
    if (
      item.vegetables !== undefined &&
      !Array.isArray(item.vegetables)
    ) {
      throw new Error('Vegetables must be an array');
    }


    // Proteins are optional but must be an array when provided.
if (
  item.proteins !== undefined &&
  !Array.isArray(item.proteins)
) {
  throw new Error('Proteins must be an array');
}

    // Each pizza requires one base, sauce and cheese.
// Vegetables and proteins are optional toppings.
const selectedIngredients = [
  item.base,
  item.sauce,
  item.cheese,
  ...(item.vegetables || []),
  ...(item.proteins || [])
];

    const seenIngredients = new Set();

    for (const ingredient of selectedIngredients) {
      const rawId = ingredient?.ingredientId;
      const ingredientId = rawId == null
  ? ''
  : String(rawId).toLowerCase();

      // Reject missing or malformed ingredient IDs.
      if (!/^[0-9a-fA-F]{24}$/.test(ingredientId)) {
        throw new Error('Invalid ingredient ID in order');
      }

      // Prevent counting the same ingredient twice in one pizza.
      if (seenIngredients.has(ingredientId)) {
        throw new Error('Duplicate ingredient in pizza configuration');
      }

      seenIngredients.add(ingredientId);

      const currentQuantity = quantities[ingredientId] || 0;
      const updatedQuantity = currentQuantity + pizzaQuantity;

      // Prevent integer overflow during multi-line aggregation.
      if (!Number.isSafeInteger(updatedQuantity)) {
        throw new Error('Total ingredient quantity exceeds safe integer limit');
      }

      quantities[ingredientId] = updatedQuantity;
    }
  }

  return quantities;
}

/**
 * Reserve inventory atomically for an order
 * Uses MongoDB transactions to ensure all-or-nothing reservation
 * 
 * @param {Array} items - Order items array
 * @param {Object} options - Reservation options
 * @param {mongoose.ClientSession} options.session - Optional existing session
 * @returns {Promise<Object>} Reservation result with metadata
 * @throws {Error} If reservation fails
 */
export async function reserveInventory(items, options = {}) {
  const ingredientQuantities = calculateIngredientQuantities(items);
  const ingredientIds = Object.keys(ingredientQuantities).sort();

  const reservedAt = new Date();
  const expiresAt = new Date(
    reservedAt.getTime() + RESERVATION_TIMEOUT_MS
  );

  const reserveInSession = (session) =>
    executeReservationTransaction(
      ingredientIds,
      ingredientQuantities,
      session
    );

  let result;

  if (options.session) {
    // Caller owns the transaction, retries and rollback.
    if (!options.session.inTransaction?.()) {
      throw new Error('An active MongoDB transaction is required');
    }

    result = await reserveInSession(options.session);

  } else {
    // Standalone reservation: manage the complete transaction.
    const session = await mongoose.startSession();

   try {
  result = await session.withTransaction(
    () => reserveInSession(session),
    {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: TRANSACTION_TIMEOUT_MS
    }
  );

} finally {
  await session.endSession();
}
  }

  return {
    success: true,
    reservedAt,
    expiresAt,
    ingredientIds,
    quantities: ingredientQuantities,
    ...result
  };
}

/**
 * Execute reservation within a MongoDB transaction
 * Ensures atomicity and isolation
 * 
 * @private
 * @param {Array<string>} ingredientIds - Ingredient IDs to reserve
 * @param {Object} quantities - Map of ingredientId -> quantity
 * @param {mongoose.ClientSession} existingSession - Optional existing session
 * @returns {Promise<Object>} Transaction result
 */
async function executeReservationTransaction(ingredientIds, quantities, existingSession = null) {
  const useExistingSession = !!existingSession;
  const session = existingSession || await mongoose.startSession();
  
  try {
    if (!useExistingSession) {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        maxCommitTimeMS: TRANSACTION_TIMEOUT_MS
      });
    }
    
    // Step 1: Fetch all required ingredients with pessimistic locking
    // Use sort to ensure consistent lock ordering (prevents deadlocks)
    const ingredients = await Ingredient.find({
      _id: { $in: ingredientIds }
    })
      .sort({ _id: 1 })
      .session(session);
    
    // Step 2: Validate all ingredients exist and are active
    const foundIds = new Set(ingredients.map(ing => ing._id.toString()));
    const missingIds = ingredientIds.filter(id => !foundIds.has(id));
    
    if (missingIds.length > 0) {
      throw new Error(`Ingredients not found: ${missingIds.join(', ')}`);
    }
    
    const inactiveIngredients = ingredients.filter(ing => !ing.isActive);
    if (inactiveIngredients.length > 0) {
      const names = inactiveIngredients.map(ing => ing.name).join(', ');
      throw new Error(`Inactive ingredients: ${names}`);
    }
    
    // Step 3: Check availability (stock - reserved >= requested)
    const insufficientStock = [];
    for (const ingredient of ingredients) {
      const requested = quantities[ingredient._id.toString()];
      const available = ingredient.stock - ingredient.reserved;
      
      if (available < requested) {
        insufficientStock.push({
          name: ingredient.name,
          available,
          requested
        });
      }
    }
    
    if (insufficientStock.length > 0) {
      const details = insufficientStock
        .map(item => `${item.name} (need ${item.requested}, available ${item.available})`)
        .join('; ');
      throw new Error(`Insufficient stock: ${details}`);
    }
    
    // Step 4: Atomically increment reserved field for all ingredients
    const updates = [];
    for (const ingredient of ingredients) {
      const requested = quantities[ingredient._id.toString()];
      
      // Use $inc with conditional update to prevent race conditions
      const result = await Ingredient.updateOne(
        {
          _id: ingredient._id,
          // Ensure stock hasn't changed and sufficient availability
          stock: ingredient.stock,
          reserved: ingredient.reserved,
          $expr: {
            $gte: [
              { $subtract: ['$stock', '$reserved'] },
              requested
            ]
          }
        },
        {
          $inc: { reserved: requested },
          $set: { updatedAt: new Date() }
        },
        { session }
      );
      
      if (result.matchedCount === 0) {
        // Stock changed between read and update (concurrent modification)
        throw new Error(`Concurrent modification detected for ${ingredient.name}`);
      }
      
      updates.push({
        ingredientId: ingredient._id,
        name: ingredient.name,
        reserved: requested,
        previousReserved: ingredient.reserved,
        newReserved: ingredient.reserved + requested
      });
    }
    
    // Commit transaction
    if (!useExistingSession) {
      await session.commitTransaction();
    }
    
    return {
      updates,
      reservedCount: updates.length
    };
    
  } catch (error) {
    // Rollback on any error
    if (!useExistingSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (!useExistingSession) {
      await session.endSession();
    }
  }
}

/**
 * Release reserved inventory (reverse of reservation)
 * Used when payment fails, expires, or is cancelled
 * 
 * @param {Array<string>} ingredientIds - Ingredient IDs to release
 * @param {Object} quantities - Map of ingredientId -> quantity to release
 * @param {Object} options - Release options
 * @returns {Promise<Object>} Release result
 */
/**
 * Release inventory belonging to a specific order.
 *
 * Only call after the payment workflow has established that
 * releasing the reservation is safe.
 *
 * An optional session allows the caller to manage the transaction.
 */
export async function releaseInventory(orderId, options = {}) {
  const id = String(orderId ?? '');

  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new Error('Valid orderId is required');
  }

  if (options.session) {
    if (!options.session.inTransaction?.()) {
      throw new Error('An active MongoDB transaction is required');
    }

    return releaseOrderReservation(id, options.session);
  }

  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(
      () => releaseOrderReservation(id, session),
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        maxCommitTimeMS: TRANSACTION_TIMEOUT_MS
      }
    );
  } finally {
    await session.endSession();
  }

}

/**
 * Release an expired reservation and expire the order when still pending.
 *
 * Handles unpaid orders and late-paid orders with held inventory.
 * Captured payment metadata is never changed.
 */
export async function expireOrderReservation(orderId) {
  const id = String(orderId ?? '');

  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new Error('Valid orderId is required');
  }

  const session = await mongoose.startSession();

  try {
    return await session.withTransaction(async () => {
      const now = new Date();

      // Include late-paid orders that still hold expired inventory.
      const order = await Order.findOne({
        _id: id,
        'reservation.state': 'held',
        'reservation.releasedAt': null,
        'reservation.expiresAt': { $lte: now },
        $or: [
          {
            orderState: 'pending_payment',
            paymentStatus: { $in: ['pending_gateway', 'created'] }
          },
          {
            orderState: { $in: ['pending_payment', 'expired'] },
            paymentStatus: 'paid_after_expiry'
          }
        ]
      }).session(session);

      if (!order) {
        return {
          success: true,
          expired: false,
          reason: 'not_eligible'
        };
      }

      // Release inventory inside this transaction.
      const releaseResult = await releaseInventory(
        order._id,
        { session }
      );

      if (releaseResult.alreadyReleased) {
        throw new Error(
          'Reservation was already released during expiration'
        );
      }

      // Only pending orders transition to expired.
      // Already-expired late-paid orders retain their states.
      if (order.orderState === 'pending_payment') {
        const updateResult = await Order.updateOne(
          {
            _id: order._id,
            orderState: 'pending_payment',
            paymentStatus: order.paymentStatus,
            'reservation.state': 'released',
            'reservation.expiresAt': { $lte: now }
          },
          {
            $set: {
              orderState: 'expired'
            }
          },
          { session }
        );

        if (updateResult.modifiedCount !== 1) {
          throw new Error(
            'Order state changed during expiration'
          );
        }
      }

      return {
        success: true,
        expired: true,
        orderId: order._id,
        releasedCount: releaseResult.releasedCount
      };

    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: TRANSACTION_TIMEOUT_MS
    });

  } finally {
    await session.endSession();
  }
}
/**
 * Release one order's reservation within an active transaction.
 */
async function releaseOrderReservation(orderId, session) {
  const order = await Order.findById(orderId).session(session);

  if (!order) {
    throw new Error('Order not found');
  }

  // Duplicate release: do nothing.
  if (order.reservation?.state === 'released') {
    return {
      success: true,
      alreadyReleased: true,
      releasedCount: 0,
      releases: [],
      releasedAt: order.reservation.releasedAt
    };
  }

  // Committed inventory must never be released.
  if (order.reservation?.state !== 'held') {
    throw new Error(
      'Order does not have an active reservation'
    );
  }

  // Ordinary unpaid release retains its existing behavior.
  const isUnpaidPending =
    order.orderState === 'pending_payment' &&
    ['pending_gateway', 'created'].includes(
      order.paymentStatus
    );

  // Late-paid inventory can only be released after its deadline.
  // Never touch normally paid or committed orders.
  const isExpiredLatePaid =
    ['pending_payment', 'expired'].includes(
      order.orderState
    ) &&
    order.paymentStatus === 'paid_after_expiry' &&
    order.reservation.expiresAt <= new Date();

  if (!isUnpaidPending && !isExpiredLatePaid) {
    throw new Error(
      'Order is not eligible for reservation release'
    );
  }

  // Validate original reservation quantities.
  const lines = order.reservation.lines || [];
  const reservedQuantities = new Map();

  for (const line of lines) {
    const ingredientId = String(
      line.ingredientId ?? ''
    );

    const qty = line.qty;

    if (
      !/^[0-9a-fA-F]{24}$/.test(ingredientId) ||
      !Number.isSafeInteger(qty) ||
      qty <= 0 ||
      reservedQuantities.has(ingredientId)
    ) {
      throw new Error(
        'Invalid order reservation metadata'
      );
    }

    reservedQuantities.set(ingredientId, qty);
  }

  // Verify reservation quantities match the order.
  const expectedQuantities =
    calculateIngredientQuantities(order.items);

  const expectedEntries =
    Object.entries(expectedQuantities);

  if (
    reservedQuantities.size !== expectedEntries.length ||
    expectedEntries.some(
      ([ingredientId, qty]) =>
        reservedQuantities.get(ingredientId) !== qty
    )
  ) {
    throw new Error(
      'Order reservation quantities do not match'
    );
  }

  const releasedAt = new Date();

  // Claim exactly once, checking payment/order state.
  const claim = await Order.updateOne(
    {
      _id: order._id,
      'reservation.state': 'held',
      'reservation.releasedAt': null,
      orderState: order.orderState,
      paymentStatus: order.paymentStatus,

      ...(isExpiredLatePaid && {
        'reservation.expiresAt': {
          $lte: releasedAt
        }
      })
    },
    {
      $set: {
        'reservation.state': 'released',
        'reservation.releasedAt': releasedAt
      }
    },
    { session }
  );

  if (claim.modifiedCount !== 1) {
    throw new Error(
      'Reservation changed during release'
    );
  }

  const releases = [];

  // Release exact quantities belonging to this order.
  for (
    const [ingredientId, qty] of expectedEntries.sort(
      ([a], [b]) => a.localeCompare(b)
    )
  ) {
    const result = await Ingredient.updateOne(
      {
        _id: ingredientId,
        reserved: { $gte: qty }
      },
      {
        $inc: {
          reserved: -qty
        }
      },
      { session }
    );

    if (result.modifiedCount !== 1) {
      throw new Error(
        `Inventory reservation invariant violated: ${ingredientId}`
      );
    }

    releases.push({
      ingredientId,
      released: qty
    });
  }

  return {
    success: true,
    alreadyReleased: false,
    releasedCount: releases.length,
    releases,
    releasedAt
  };
}

/**
 * Check if error is retryable (transient transaction error)
 * 
 * @private
 * @param {Error} error - Error to check
 * @returns {boolean} True if retryable
 */
function isRetryableError(error) {
  if (!error) return false;
  
  const errorCode = error.code;
  const errorMessage = error.message || '';
  
  // MongoDB error codes for retryable errors
  const retryableCodes = [
    112, // WriteConflict
    117, // ConflictingOperationInProgress
    11600, // InterruptedAtShutdown
    11602, // InterruptedDueToReplStateChange
    189, // PrimarySteppedDown
    10107, // NotMaster/NotWritablePrimary
    13436  // NotPrimaryNoSecondaryOk
  ];
  
  if (retryableCodes.includes(errorCode)) {
    return true;
  }
  
  // Check for transient transaction errors
  if (errorMessage.includes('TransientTransactionError')) {
    return true;
  }
  
  // Concurrent modification (stock changed) is retryable
  if (errorMessage.includes('Concurrent modification detected')) {
    return true;
  }
  
  return false;
}

export default {
  calculateIngredientQuantities,
  reserveInventory,
  releaseInventory,
  expireOrderReservation,
  RESERVATION_TIMEOUT_MS
};
