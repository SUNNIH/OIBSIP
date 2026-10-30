import express from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import Ingredient from '../models/Ingredient.js';
import Pizza from '../models/Pizza.js';
import { authenticateToken } from '../middleware/auth.js';
import { doubleCsrfProtection } from '../middleware/security.js';

const router = express.Router();

// Validation schema for quote requests
const quoteLineSchema = z.object({
  pizzaId: z.string().refine(
    (val) => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid pizza ID format' }
  ).optional(),

  recipe: z.object({
    base: z.string().refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      { message: 'Invalid base ingredient ID format' }
    ),

    sauce: z.string().refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      { message: 'Invalid sauce ingredient ID format' }
    ),

    cheese: z.string().refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      { message: 'Invalid cheese ingredient ID format' }
    ),

    vegetables: z.array(
      z.string().refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        { message: 'Invalid vegetable ingredient ID format' }
      )
    )
      .optional()
      .default([])
      .refine(
        (arr) => arr.length === new Set(arr).size,
        { message: 'Duplicate vegetables are not allowed' }
      ),
  }).optional(),

  quantity: z.number()
    .int()
    .min(1, 'Quantity must be at least 1')
    .refine(
      Number.isSafeInteger,
      { message: 'Quantity must be a safe integer' }
    ),
}).refine(
  (data) => data.pizzaId || data.recipe,
  { message: 'Either pizzaId or recipe must be provided' }
);

const quoteRequestSchema = z.object({
  lines: z.array(quoteLineSchema)
    .min(1, 'At least one line item is required'),
});

/**
 * GET /api/v1/ingredients
 *
 * Returns active ingredients grouped by category.
 * Does not expose stock or reserved quantities.
 */
router.get(
  '/ingredients',
  authenticateToken,
  async (req, res, next) => {
    try {
      const ingredients = await Ingredient.find({
        isActive: true,
      })
        .select('name category pricePaise stock reserved')
        .lean();

      const grouped = {
        base: [],
        sauce: [],
        cheese: [],
        vegetable: [],
      };

      for (const ingredient of ingredients) {
        const inStock =
          (ingredient.stock - ingredient.reserved) > 0;

        grouped[ingredient.category].push({
          id: ingredient._id,
          name: ingredient.name,
          category: ingredient.category,
          pricePaise: ingredient.pricePaise,
          inStock,
        });
      }

      res.json(grouped);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/pizzas
 *
 * Returns active pizza presets with computed prices.
 *
 * IMPORTANT:
 * Preserve original ObjectIds to detect deleted
 * ingredients, including deleted vegetables.
 */
router.get(
  '/pizzas',
  authenticateToken,
  async (req, res, next) => {
    try {
      // Do not populate immediately.
      // Populating arrays can omit deleted references.
      const pizzas = await Pizza.find({
        isActive: true,
      });

      const pizzasWithPrices = await Promise.all(
        pizzas.map(async (pizza) => {
          try {
            const refs = pizza.ingredients;

            const ingredientIds = [
              refs.base,
              refs.sauce,
              refs.cheese,
              ...(refs.vegetables || []),
            ];

            // Ensure no required references are missing.
            if (ingredientIds.some((id) => !id)) {
              throw new Error(
                `Pizza ${pizza.name} has missing ingredient references`
              );
            }

            // Fetch all originally referenced ingredients.
            const ingredientDocs = await Ingredient.find({
              _id: {
                $in: ingredientIds,
              },
            });

            // Detect deleted ingredients, including vegetables.
            if (ingredientDocs.length !== ingredientIds.length) {
              throw new Error(
                `Pizza ${pizza.name} has deleted or duplicate ingredient references`
              );
            }

            const byId = new Map(
              ingredientDocs.map((ing) => [
                ing._id.toString(),
                ing,
              ])
            );

            const base = byId.get(refs.base.toString());

            const sauce = byId.get(refs.sauce.toString());

            const cheese = byId.get(refs.cheese.toString());

            const vegetables = (refs.vegetables || [])
              .map((id) => byId.get(id.toString()));

            // Reject incomplete recipes.
            if (
              !base ||
              !sauce ||
              !cheese ||
              vegetables.some((v) => !v)
            ) {
              throw new Error(
                `Pizza ${pizza.name} has invalid ingredient references`
              );
            }

            // Calculate using existing model methods.
            const pricePaise = await pizza.calculatePrice();

            const availability = await pizza.checkAvailability();

            // Explicitly shape customer response.
            // Never expose inventory quantities.
            return {
              id: pizza._id,
              name: pizza.name,
              description: pizza.description,
              category: pizza.category,
              pricePaise,
              available: availability.available,

              ingredients: {
                base: {
                  id: base._id,
                  name: base.name,
                },

                sauce: {
                  id: sauce._id,
                  name: sauce.name,
                },

                cheese: {
                  id: cheese._id,
                  name: cheese.name,
                },

                vegetables: vegetables.map((v) => ({
                  id: v._id,
                  name: v.name,
                })),
              },
            };
          } catch (error) {
            // Exclude inconsistent presets instead of
            // returning an incomplete or incorrectly priced pizza.
            console.error(
              `Error processing pizza ${pizza.name}:`,
              error.message
            );

            return null;
          }
        })
      );

      const validPizzas = pizzasWithPrices.filter(
        (pizza) => pizza !== null
      );

      res.json(validPizzas);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/orders/quote
 *
 * Calculates prices without creating an order.
 *
 * - Server-side pricing
 * - Cumulative ingredient availability
 * - Missing-reference detection
 * - Safe integer calculations
 * - No inventory mutations
 */
router.post(
  '/orders/quote',
  authenticateToken,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const validated = quoteRequestSchema.parse(req.body);

      const quotedLines = [];

      let totalPaise = 0;

      // Track total ingredient requirements across the cart.
      const cumulativeQuantities = {};

      const resolvedLines = [];

      /**
       * FIRST PASS:
       * Resolve recipes and aggregate quantities.
       */
      for (const line of validated.lines) {
        let ingredientIds;

        let pizzaName = null;

        if (line.pizzaId) {
          /**
           * PRESET PIZZA
           *
           * Keep original references.
           * Do not populate because deleted vegetables
           * can disappear from populated arrays.
           */
          const pizza = await Pizza.findById(line.pizzaId);

          if (!pizza) {
            return res.status(400).json({
              error: {
                code: 'INVALID_PIZZA',
                message: `Pizza with ID ${line.pizzaId} not found`,
              },
            });
          }

          if (!pizza.isActive) {
            return res.status(400).json({
              error: {
                code: 'PIZZA_NOT_AVAILABLE',
                message: `Pizza "${pizza.name}" is not currently available`,
              },
            });
          }

          pizzaName = pizza.name;

          const extractId = (ref) =>
            (ref && ref._id) || ref;

          const baseId = extractId(
            pizza.ingredients.base
          );

          const sauceId = extractId(
            pizza.ingredients.sauce
          );

          const cheeseId = extractId(
            pizza.ingredients.cheese
          );

          const vegIds = (
            pizza.ingredients.vegetables || []
          )
            .map(extractId)
            .filter(Boolean);

          if (!baseId || !sauceId || !cheeseId) {
            return res.status(400).json({
              error: {
                code: 'PIZZA_DATA_INCONSISTENCY',
                message: `Pizza "${pizza.name}" has missing ingredient references`,
              },
            });
          }

          ingredientIds = [
            baseId,
            sauceId,
            cheeseId,
            ...vegIds,
          ];
        } else {
          /**
           * CUSTOM PIZZA
           */
          const {
            base,
            sauce,
            cheese,
            vegetables = [],
          } = line.recipe;

          const [
            baseIng,
            sauceIng,
            cheeseIng,
            ...vegetableIngs
          ] = await Promise.all([
            Ingredient.findById(base),
            Ingredient.findById(sauce),
            Ingredient.findById(cheese),

            ...vegetables.map(
              (id) => Ingredient.findById(id)
            ),
          ]);

          // Validate required ingredient existence.
          if (!baseIng) {
            return res.status(400).json({
              error: {
                code: 'INVALID_INGREDIENT',
                message: 'Base ingredient not found',
              },
            });
          }

          if (!sauceIng) {
            return res.status(400).json({
              error: {
                code: 'INVALID_INGREDIENT',
                message: 'Sauce ingredient not found',
              },
            });
          }

          if (!cheeseIng) {
            return res.status(400).json({
              error: {
                code: 'INVALID_INGREDIENT',
                message: 'Cheese ingredient not found',
              },
            });
          }

          // Validate all vegetables exist.
          for (let i = 0; i < vegetables.length; i++) {
            if (!vegetableIngs[i]) {
              return res.status(400).json({
                error: {
                  code: 'INVALID_INGREDIENT',
                  message: `Vegetable ingredient not found: ${vegetables[i]}`,
                },
              });
            }
          }

          // Validate ingredient categories.
          if (baseIng.category !== 'base') {
            return res.status(400).json({
              error: {
                code: 'INVALID_CATEGORY',
                message: 'Base ingredient must be of category "base"',
              },
            });
          }

          if (sauceIng.category !== 'sauce') {
            return res.status(400).json({
              error: {
                code: 'INVALID_CATEGORY',
                message: 'Sauce ingredient must be of category "sauce"',
              },
            });
          }

          if (cheeseIng.category !== 'cheese') {
            return res.status(400).json({
              error: {
                code: 'INVALID_CATEGORY',
                message: 'Cheese ingredient must be of category "cheese"',
              },
            });
          }

          for (const veg of vegetableIngs) {
            if (veg.category !== 'vegetable') {
              return res.status(400).json({
                error: {
                  code: 'INVALID_CATEGORY',
                  message: `Ingredient "${veg.name}" is not a vegetable`,
                },
              });
            }
          }

          // Validate active status.
          const allIngredients = [
            baseIng,
            sauceIng,
            cheeseIng,
            ...vegetableIngs,
          ];

          for (const ing of allIngredients) {
            if (!ing.isActive) {
              return res.status(400).json({
                error: {
                  code: 'INGREDIENT_NOT_AVAILABLE',
                  message: `Ingredient "${ing.name}" is not currently available`,
                },
              });
            }
          }

          ingredientIds = [
            base,
            sauce,
            cheese,
            ...vegetables,
          ];

          pizzaName = 'Custom Pizza';
        }

        /**
         * Aggregate total ingredient quantities.
         *
         * Each pizza requires one unit of each ingredient.
         */
        for (const ingId of ingredientIds) {
          const idStr = ingId.toString();

          const updatedQuantity =
            (cumulativeQuantities[idStr] || 0) +
            line.quantity;

          // Prevent unsafe cumulative quantities.
          if (!Number.isSafeInteger(updatedQuantity)) {
            return res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Cart quantity exceeds safe integer range',
              },
            });
          }

          cumulativeQuantities[idStr] = updatedQuantity;
        }

        resolvedLines.push({
          pizzaId: line.pizzaId || null,
          pizzaName,
          quantity: line.quantity,
          ingredientIds,
        });
      }

      /**
       * Verify that EVERY referenced ingredient exists.
       *
       * Ingredient.checkAvailability() does not
       * report missing database IDs.
       */
      const requestedIds = Object.keys(
        cumulativeQuantities
      );

      const existingIngredients = await Ingredient.find({
        _id: {
          $in: requestedIds,
        },
      })
        .select('_id')
        .lean();

      if (existingIngredients.length !== requestedIds.length) {
        return res.status(400).json({
          error: {
            code: 'PIZZA_DATA_INCONSISTENCY',
            message: 'One or more ingredients no longer exist',
          },
        });
      }

      /**
       * Check cumulative availability.
       *
       * Available stock = stock - reserved.
       *
       * No reservations or inventory mutations occur.
       */
      const availabilityCheck =
        await Ingredient.checkAvailability(
          cumulativeQuantities
        );

      if (!availabilityCheck.available) {
        const unavailableIngredients =
          availabilityCheck.unavailable.map((item) => {
            if (item.reason === 'not_found') {
              return 'Unknown ingredient';
            }

            return item.name;
          });

        const uniqueIngredients = [
          ...new Set(unavailableIngredients),
        ];

        const ingredientList =
          uniqueIngredients.join(', ');

        // Never expose stock, reserved, available,
        // or requested quantities.
        return res.status(400).json({
          error: {
            code: 'INSUFFICIENT_INVENTORY',
            message:
              `Cannot fulfill order: ${ingredientList} unavailable or out of stock`,
          },
        });
      }

      /**
       * SECOND PASS:
       * Calculate prices from database ingredients.
       */
      for (const line of resolvedLines) {
        const ingredients = await Ingredient.find({
          _id: {
            $in: line.ingredientIds,
          },
        });

        if (ingredients.length !== line.ingredientIds.length) {
          return res.status(500).json({
            error: {
              code: 'INTERNAL_ERROR',
              message:
                'Price calculation failed: ingredient mismatch',
            },
          });
        }

        /**
         * Safely calculate unit price.
         */
        let linePricePaise = 0;

        for (const ing of ingredients) {
          if (
            !Number.isSafeInteger(ing.pricePaise) ||
            ing.pricePaise < 0 ||
            !Number.isSafeInteger(
              linePricePaise + ing.pricePaise
            )
          ) {
            return res.status(400).json({
              error: {
                code: 'VALIDATION_ERROR',
                message:
                  'Quote price exceeds safe integer range',
              },
            });
          }

          linePricePaise += ing.pricePaise;
        }

        /**
         * Safely calculate line total.
         */
        const lineTotal =
          linePricePaise * line.quantity;

        if (
          !Number.isSafeInteger(lineTotal) ||
          !Number.isSafeInteger(
            totalPaise + lineTotal
          )
        ) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'Quote total exceeds safe integer range',
            },
          });
        }

        quotedLines.push({
          pizzaId: line.pizzaId,
          pizzaName: line.pizzaName,
          quantity: line.quantity,
          unitPricePaise: linePricePaise,
          lineTotalPaise: lineTotal,
        });

        totalPaise += lineTotal;
      }

      /**
       * Return price summary.
       */
      res.json({
        lines: quotedLines,
        totalPaise,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.issues[0].message,
            details: error.issues,
          },
        });
      }

      next(error);
    }
  }
);

export default router;