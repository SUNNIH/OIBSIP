/**
 * Order Creation Routes
 *
 * Implements Phase 4 Task 4.3:
 * - Authenticated customer order creation
 * - Server-side pricing from current ingredient prices
 * - Atomic inventory reservation
 * - Client-supplied Idempotency-Key header (customer-scoped)
 * - Request validation
 * - CSRF protection
 *
 * Out of scope (later tasks):
 * - Razorpay gateway integration
 * - Payment verification
 * - Inventory commitment (stock deduction)
 * - Order status transitions beyond pending_payment
 */

import express from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Ingredient from '../models/Ingredient.js';
import Pizza from '../models/Pizza.js';
import { authenticateToken } from '../middleware/auth.js';
import { doubleCsrfProtection } from '../middleware/security.js';
import {
  reserveInventory,
  calculateIngredientQuantities
} from '../services/inventoryReservation.js';

const router = express.Router();

/**
 * Validation schemas
 */

const customRecipeSchema = z.object({
  base: z.string().refine(
    (val) => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid base ingredient ID' }
  ),

  sauce: z.string().refine(
    (val) => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid sauce ingredient ID' }
  ),

  cheese: z.string().refine(
    (val) => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid cheese ingredient ID' }
  ),

  vegetables: z.array(
    z.string().refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      { message: 'Invalid vegetable ingredient ID' }
    )
  )
    .optional()
    .default([])
    .refine(
      (arr) => arr.length === new Set(arr).size,
      { message: 'Duplicate vegetables not allowed' }
    ),
    // Optional protein toppings
proteins: z.array(
  z.string().refine(
    (val) => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid protein ingredient ID' }
  )
)
  .optional()
  .default([])
  .refine(
    (arr) => arr.length === new Set(arr).size,
    { message: 'Duplicate proteins not allowed' }
  )
});

const orderItemSchema = z.object({
  pizzaId: z.string()
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      { message: 'Invalid pizza ID' }
    )
    .optional(),

  customRecipe: customRecipeSchema.optional(),

  quantity: z.number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1')
    .max(100, 'Quantity cannot exceed 100 per item')
})
  .refine(
    (data) => data.pizzaId || data.customRecipe,
    { message: 'Either pizzaId or customRecipe is required' }
  )
  .refine(
    (data) => !(data.pizzaId && data.customRecipe),
    { message: 'Cannot specify both pizzaId and customRecipe' }
  );

const createOrderSchema = z.object({
  lines: z.array(orderItemSchema)
    .min(1, 'Order must contain at least one item')
    .max(20, 'Order cannot exceed 20 items')
});

/**
 * POST /api/v1/orders
 *
 * Create a new customer order with atomic inventory reservation
 *
 * Headers:
 * - Authorization: Bearer token (via cookie)
 * - Idempotency-Key: Client-supplied unique key (required)
 * - X-CSRF-Token: CSRF token (required)
 *
 * Body:
 * - lines: Array of order items (pizzaId OR customRecipe, quantity)
 *
 * Response:
 * - 201: Order created
 * - 200: Existing order returned (idempotent)
 * - 400: Missing or invalid Idempotency-Key
 * - 422: Invalid request body or inactive/nonexistent ingredients
 * - 401: Not authenticated
 * - 409: Insufficient stock or idempotency conflict
 */

router.post(
  '/',
  authenticateToken,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      // Validate idempotency key from header
      const idempotencyKey = req.headers['idempotency-key'];

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        return res.status(400).json({
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Idempotency-Key header is required'
          }
        });
      }

      if (!/^[A-Za-z0-9_-]{16,64}$/.test(idempotencyKey)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_IDEMPOTENCY_KEY',
            message:
              'Idempotency-Key must be 16–64 characters (letters, numbers, underscores, hyphens)'
          }
        });
      }

      // Validate request body
      const validated = createOrderSchema.parse(req.body);
      const customerId = req.user.id;

      // Calculate stable request hash for idempotency
      const requestPayload = {
        customerId,
        lines: validated.lines.map(item => ({
          pizzaId: item.pizzaId || null,
          customRecipe: item.customRecipe || null,
          quantity: item.quantity
        }))
      };

      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(requestPayload))
        .digest('hex');

      // Check for existing order with same idempotency key
      const existingOrder = await Order.findOne({
        customerId,
        idempotencyKey
      });

      if (existingOrder) {
        // Check for payload conflict
        if (existingOrder.requestHash !== requestHash) {
          return res.status(409).json({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'Idempotency key already used with different payload'
            }
          });
        }

        // Idempotent response
        return res.status(200).json({
          orderId: existingOrder._id,
          totalPricePaise: existingOrder.totalPricePaise,
          orderState: existingOrder.orderState,
          paymentStatus: existingOrder.paymentStatus,
          items: existingOrder.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            unitPricePaise: item.unitPricePaise,
            lineTotalPaise: item.lineTotalPaise
          })),
          createdAt: existingOrder.createdAt,
          idempotent: true
        });
      }

      // Process new order within transaction
      const MAX_RETRIES = 5;
      const BASE_BACKOFF_MS = 100;

      let lastError;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const session = await mongoose.startSession();

        try {
          session.startTransaction();

          // Step 1: Resolve recipes
          const resolvedItems = [];

          for (const item of validated.lines) {
            let recipe;
            let pizzaName;

            if (item.pizzaId) {
              // Preset pizza
              const pizza = await Pizza.findById(
                item.pizzaId
              ).session(session);

              if (!pizza) {
                throw new Error(`Pizza not found: ${item.pizzaId}`);
              }

              if (!pizza.isActive) {
                throw new Error(`Pizza not available: ${pizza.name}`);
              }

             recipe = {
  base: pizza.ingredients.base,
  sauce: pizza.ingredients.sauce,
  cheese: pizza.ingredients.cheese,
  vegetables: pizza.ingredients.vegetables || [],
  proteins: pizza.ingredients.proteins || []
};

              pizzaName = pizza.name;

            } else {
              // Custom recipe
              recipe = {
                base: new mongoose.Types.ObjectId(
                  item.customRecipe.base
                ),

                sauce: new mongoose.Types.ObjectId(
                  item.customRecipe.sauce
                ),

                cheese: new mongoose.Types.ObjectId(
                  item.customRecipe.cheese
                ),

                vegetables: (
  item.customRecipe.vegetables || []
).map(
  id => new mongoose.Types.ObjectId(id)
),

proteins: (
  item.customRecipe.proteins || []
).map(
  id => new mongoose.Types.ObjectId(id)
)
              };

              pizzaName = 'Custom Pizza';
            }

            // Fetch ingredients
            const ingredientIds = [
  recipe.base,
  recipe.sauce,
  recipe.cheese,
  ...recipe.vegetables,
  ...recipe.proteins
];

// Reject duplicate ingredient IDs across the entire recipe
if (
  new Set(ingredientIds.map(id => id.toString())).size !==
  ingredientIds.length
) {
  throw new Error('Duplicate ingredients in pizza recipe');
}

            const ingredients = await Ingredient.find({
              _id: { $in: ingredientIds }
            }).session(session);

            // Verify all ingredients exist
            if (ingredients.length !== ingredientIds.length) {
              const foundIds = new Set(
                ingredients.map(i => i._id.toString())
              );

              const missing = ingredientIds
                .filter(id => !foundIds.has(id.toString()))
                .map(id => id.toString());

              throw new Error(
                `Ingredients not found: ${missing.join(', ')}`
              );
            }

            // Check availability
            const inactive = ingredients.filter(
              i => !i.isActive
            );

            if (inactive.length > 0) {
              const names = inactive
                .map(i => i.name)
                .join(', ');

              throw new Error(
                `Ingredients not available: ${names}`
              );
            }

            // Build ingredient map
            const ingredientMap = {};

            ingredients.forEach(ing => {
              ingredientMap[ing._id.toString()] = ing;
            });

            // Validate ingredient categories
            const expectedCategories = [
  [recipe.base, 'base'],
  [recipe.sauce, 'sauce'],
  [recipe.cheese, 'cheese'],

  ...recipe.vegetables.map(
    id => [id, 'vegetable']
  ),

  ...recipe.proteins.map(
    id => [id, 'protein']
  )
];

            for (const [id, expectedCategory] of expectedCategories) {
              if (
                ingredientMap[id.toString()].category !==
                expectedCategory
              ) {
                throw new Error(
                  `Invalid ingredient category: expected ${expectedCategory}`
                );
              }
            }

            // Resolve ingredient references
            const baseIng =
              ingredientMap[recipe.base.toString()];

            const sauceIng =
              ingredientMap[recipe.sauce.toString()];

            const cheeseIng =
              ingredientMap[recipe.cheese.toString()];

            // Build order item
            const orderItem = {
              name: pizzaName,
              quantity: item.quantity,

              base: {
                ingredientId: baseIng._id,
                name: baseIng.name,
                pricePaise: baseIng.pricePaise
              },

              sauce: {
                ingredientId: sauceIng._id,
                name: sauceIng.name,
                pricePaise: sauceIng.pricePaise
              },

              cheese: {
                ingredientId: cheeseIng._id,
                name: cheeseIng.name,
                pricePaise: cheeseIng.pricePaise
              },

              vegetables: recipe.vegetables.map(vegId => {
                const veg = ingredientMap[vegId.toString()];

                return {
                  ingredientId: veg._id,
                  name: veg.name,
                  pricePaise: veg.pricePaise
                };
              }),

              proteins: recipe.proteins.map(proteinId => {
  const protein = ingredientMap[proteinId.toString()];

  return {
    ingredientId: protein._id,
    name: protein.name,
    pricePaise: protein.pricePaise
  };
})
            };

            // Calculate server-side prices
            orderItem.unitPricePaise =
  baseIng.pricePaise +
  sauceIng.pricePaise +
  cheeseIng.pricePaise +
  orderItem.vegetables.reduce(
    (sum, v) => sum + v.pricePaise,
    0
  ) +
  orderItem.proteins.reduce(
    (sum, p) => sum + p.pricePaise,
    0
  );

            orderItem.lineTotalPaise =
              orderItem.unitPricePaise * item.quantity;

            resolvedItems.push(orderItem);
          }

          // Step 2: Calculate total price
          const totalPricePaise = resolvedItems.reduce(
            (sum, item) => sum + item.lineTotalPaise,
            0
          );

          // Step 3: Reserve inventory atomically
          const reservation = await reserveInventory(
            resolvedItems,
            { session }
          );

          // Build reservation lines
          const reservationLines = reservation.ingredientIds.map(
            ingredientId => ({
              ingredientId,
              qty:
                reservation.quantities[
                  ingredientId.toString()
                ]
            })
          );

          // Step 4: Create order
          const orderData = {
            customerId,
            items: resolvedItems,
            totalPricePaise,
            orderState: 'pending_payment',
            paymentStatus: 'pending_gateway',
            idempotencyKey,
            requestHash,

            reservation: {
              state: 'held',
              reservedAt: reservation.reservedAt,
              expiresAt: reservation.expiresAt,
              lines: reservationLines
            }
          };

          const [order] = await Order.create(
            [orderData],
            { session }
          );

          // Step 5: Commit transaction
          await session.commitTransaction();

          // Success response
          return res.status(201).json({
            orderId: order._id,
            totalPricePaise: order.totalPricePaise,
            orderState: order.orderState,
            paymentStatus: order.paymentStatus,

            items: order.items.map(item => ({
              name: item.name,
              quantity: item.quantity,
              unitPricePaise: item.unitPricePaise,
              lineTotalPaise: item.lineTotalPaise
            })),

            reservation: {
              expiresAt: order.reservation.expiresAt
            },

            createdAt: order.createdAt
          });

        } catch (error) {
          // Abort only an active transaction
          if (session.inTransaction()) {
            await session.abortTransaction();
          }

          // Handle duplicate idempotency key
          if (
            error.code === 11000 &&
            error.message.includes('idempotencyKey')
          ) {
            const existingOrder = await Order.findOne({
              customerId,
              idempotencyKey
            });

            if (existingOrder) {
              if (
                existingOrder.requestHash !== requestHash
              ) {
                return res.status(409).json({
                  error: {
                    code: 'IDEMPOTENCY_KEY_CONFLICT',
                    message:
                      'Idempotency key already used with different payload'
                  }
                });
              }

              return res.status(200).json({
                orderId: existingOrder._id,
                totalPricePaise:
                  existingOrder.totalPricePaise,
                orderState: existingOrder.orderState,
                paymentStatus: existingOrder.paymentStatus,

                items: existingOrder.items.map(item => ({
                  name: item.name,
                  quantity: item.quantity,
                  unitPricePaise: item.unitPricePaise,
                  lineTotalPaise: item.lineTotalPaise
                })),

                createdAt: existingOrder.createdAt,
                idempotent: true
              });
            }

            return res.status(409).json({
              error: {
                code: 'REQUEST_IN_PROGRESS',
                message:
                  'Order creation in progress, please retry'
              }
            });
          }

          // Detect MongoDB write conflicts
          const isWriteConflict =
            error.code === 112 ||
            error.code === 117 ||
            (
              error.message &&
              error.message.includes('Write conflict')
            );

          // Detect permanent errors
          const isPermanentError =
            error.message &&
            (
              error.message.includes('Duplicate ingredients in pizza recipe') ||
              error.message.includes('not found') ||
              error.message.includes('not available') ||
              error.message.includes(
                'Invalid ingredient category'
              ) ||
              error.message.includes('Insufficient stock')
            );

            if (
  error.message?.includes('Duplicate ingredients in pizza recipe')
) {
  return res.status(422).json({
    error: {
      code: 'INVALID_ITEMS',
      message: error.message
    }
  });
}

          if (isPermanentError) {
            throw error;
          }

          // Retry transient write conflicts
          if (
            isWriteConflict &&
            attempt < MAX_RETRIES - 1
          ) {
            lastError = error;

            const backoffMs =
              BASE_BACKOFF_MS * Math.pow(2, attempt) +
              Math.random() * BASE_BACKOFF_MS;

            await new Promise(
              resolve => setTimeout(resolve, backoffMs)
            );

            continue;
          }

          throw error;

        } finally {
          await session.endSession();
        }
      }

      throw lastError ||
        new Error('Transaction failed after retries');

    } catch (error) {
      // Zod validation errors
      if (error instanceof z.ZodError) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: error.errors
          }
        });
      }

      // Insufficient stock
      if (
        error.message &&
        error.message.includes('Insufficient stock')
      ) {
        return res.status(409).json({
          error: {
            code: 'INSUFFICIENT_STOCK',
            message:
              'Cannot fulfill order due to insufficient inventory',
            details: error.message
          }
        });
      }

      // Missing or unavailable ingredients
      if (
        error.message &&
        (
          error.message.includes('not found') ||
          error.message.includes('not available') ||
          error.message.includes(
            'Invalid ingredient category'
          )
        )
      ) {
        return res.status(422).json({
          error: {
            code: 'INVALID_ITEMS',
            message: error.message
          }
        });
      }

      next(error);
    }
  }
);

/**
 * Validate pagination parameters for customer order history.
 */
const orderHistoryQuerySchema = z.object({
  page: z.coerce.number()
    .int()
    .min(1)
    .max(10000)
    .default(1),

  limit: z.coerce.number()
    .int()
    .min(1)
    .max(50)
    .default(10)
});

/**
 * Convert an order into a customer-safe response.
 * Internal payment signatures, idempotency data,
 * gateway locks and manual review notes are excluded.
 */
function serializeCustomerOrder(order) {
  const serializeIngredient = (ingredient) => ({
    ingredientId: ingredient.ingredientId,
    name: ingredient.name,
    pricePaise: ingredient.pricePaise
  });

  return {
    orderId: order._id.toString(),

    items: order.items.map(item => ({
      name: item.name,
      quantity: item.quantity,

      base: serializeIngredient(item.base),
      sauce: serializeIngredient(item.sauce),
      cheese: serializeIngredient(item.cheese),

      vegetables: (item.vegetables || []).map(
        serializeIngredient
      ),

      proteins: (item.proteins || []).map(
  serializeIngredient
),

      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: item.lineTotalPaise
    })),

    totalPricePaise: order.totalPricePaise,

    orderState: order.orderState,
    paymentStatus: order.paymentStatus,

    reservationExpiresAt:
      order.orderState === 'pending_payment' &&
      order.reservation?.state === 'held'
        ? order.reservation.expiresAt
        : null,

    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}


/**
 * GET /api/v1/orders
 *
 * Retrieve the authenticated customer's order history.
 *
 * Supports pagination:
 * - page: default 1
 * - limit: default 10, maximum 50
 *
 * Customers can retrieve only their own orders.
 */
router.get(
  '/',
  authenticateToken,
  async (req, res, next) => {
    try {
      // Validate pagination parameters.
      const parsed = orderHistoryQuerySchema.safeParse(
        req.query
      );

      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_PAGINATION',
            message:
              'Page must be 1–10000 and limit must be 1–50'
          }
        });
      }

      const { page, limit } = parsed.data;

      const skip = (page - 1) * limit;

      // Restrict results to the authenticated customer.
      const filter = {
        customerId: req.user.id
      };

      // Count the customer's orders.
      const total = await Order.countDocuments(filter);

      // Retrieve the newest orders first.
      const orders = await Order.find(filter)
        .select(
          '_id items totalPricePaise orderState ' +
          'paymentStatus reservation.state ' +
          'reservation.expiresAt createdAt updatedAt'
        )
        .sort({
          createdAt: -1,
          _id: -1
        })
        .skip(skip)
        .limit(limit)
        .lean();

      // Convert database records into safe responses.
      const safeOrders = orders.map(
        serializeCustomerOrder
      );

      // Prevent caching of private order information.
      res.set('Cache-Control', 'private, no-store');

      return res.status(200).json({
        orders: safeOrders,

        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/orders/:orderId
 *
 * Retrieve a specific order belonging to the
 * authenticated customer.
 *
 * Responses:
 * - 200: Order found
 * - 400: Invalid order ID
 * - 401: Not authenticated
 * - 404: Order not found or not owned by customer
 */
router.get(
  '/:orderId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { orderId } = req.params;

      // Require a valid 24-character MongoDB ObjectId.
      if (!/^[0-9a-fA-F]{24}$/.test(orderId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ORDER_ID',
            message: 'Invalid order ID'
          }
        });
      }

      // Include customerId in the database query.
      // This prevents cross-customer order access.
      const order = await Order.findOne({
        _id: orderId,
        customerId: req.user.id
      })
        .select(
          '_id items totalPricePaise orderState ' +
          'paymentStatus reservation.state ' +
          'reservation.expiresAt createdAt updatedAt'
        )
        .lean();

      if (!order) {
        return res.status(404).json({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'Order not found'
          }
        });
      }

      // Return only customer-safe order information.
      const safeOrder = serializeCustomerOrder(order);

      res.set('Cache-Control', 'private, no-store');

      return res.status(200).json({
        order: safeOrder
      });

    } catch (error) {
      next(error);
    }
  }
);

export default router;