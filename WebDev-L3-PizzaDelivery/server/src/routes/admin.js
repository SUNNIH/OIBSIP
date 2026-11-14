// SUNNYS Pizza — Admin Management Routes
// Requires administrator authentication

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Pizza from '../models/Pizza.js';
import Order from '../models/Order.js';
import Ingredient from '../models/Ingredient.js';
import { notifyOrderUpdated } from '../realtime/socket.js';
import { clearAlertState } from '../services/lowStockNotification.js';
import fs from 'fs/promises';
import crypto from 'crypto';
import multer from 'multer';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { doubleCsrfProtection } from '../middleware/security.js';


const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep development uploads separate from automated test uploads.
const UPLOAD_DIR = path.join(
  __dirname,
  '../../',
  process.env.NODE_ENV === 'test' ? 'test-uploads' : 'uploads',
  'pizzas'
);

// Allowed image types with magic number signatures
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// File signature validation (magic numbers)
const FILE_SIGNATURES = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]] // RIFF header, WebP has 'WEBP' at offset 8
};

// Ensure upload directory exists
async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
}

// Validate file signature against mime type
async function validateFileSignature(filepath, mimetype) {
  const signatures = FILE_SIGNATURES[mimetype];
  if (!signatures) return false;

  const buffer = Buffer.alloc(16);
  const fd = await fs.open(filepath, 'r');
  try {
    await fd.read(buffer, 0, 16, 0);
    
    for (const signature of signatures) {
      const matches = signature.every((byte, index) => buffer[index] === byte);
      if (matches) {
        // Additional check for WebP
        if (mimetype === 'image/webp') {
          const webpMarker = buffer.slice(8, 12).toString('ascii');
          return webpMarker === 'WEBP';
        }
        return true;
      }
    }
    return false;
  } finally {
    await fd.close();
  }
}

// Sanitize filename to prevent path traversal
function sanitizeFilename(filename) {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await ensureUploadDir();
      cb(null, UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate secure random filename
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(sanitizeFilename(file.originalname)).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    
    if (!allowedExts.includes(ext)) {
      return cb(new Error('Invalid file extension'));
    }
    
    cb(null, `${hash}${ext}`);
  }
});

// Configure multer upload
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed'));
    }
    cb(null, true);
  }
});

/**
 * POST /api/admin/pizzas/:pizzaId/image
 * 
 * Upload or replace pizza image.
 * Requires admin authentication and CSRF protection.
 */
router.post(
  '/pizzas/:pizzaId/image',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  upload.single('image'),
  async (req, res, next) => {
    let uploadedFilePath = null;
    
    try {
      const { pizzaId } = req.params;

      // Validate pizzaId format before processing upload
      if (!pizzaId.match(/^[0-9a-fA-F]{24}$/)) {
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        return res.status(400).json({
          error: { code: 'INVALID_ID', message: 'Invalid pizza ID format' }
        });
      }

      // Verify file was uploaded
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No image file provided' }
        });
      }

      uploadedFilePath = req.file.path;

      // Validate file signature matches claimed mime type
      const isValidSignature = await validateFileSignature(
        uploadedFilePath,
        req.file.mimetype
      );

      if (!isValidSignature) {
        // Remove invalid file
        await fs.unlink(uploadedFilePath);
        return res.status(400).json({
          error: {
            code: 'INVALID_FILE_SIGNATURE',
            message: 'File content does not match the claimed image type'
          }
        });
      }

      // Find pizza
      const pizza = await Pizza.findById(pizzaId);
      if (!pizza) {
        // Remove uploaded file since pizza doesn't exist
        await fs.unlink(uploadedFilePath);
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Pizza not found' }
        });
      }

      // Store old image URL for cleanup after successful update
      const oldImageUrl = pizza.imageUrl;

      // Update pizza with new image URL
      const imageUrl = `/uploads/pizzas/${req.file.filename}`;
      pizza.imageUrl = imageUrl;

      try {
        await pizza.save();
      } catch (saveError) {
        // Database save failed - remove the uploaded file
        await fs.unlink(uploadedFilePath);
        throw saveError;
      }

      // Success - clean up old image if it exists
      if (oldImageUrl) {
        const oldFilename = path.basename(oldImageUrl);
        const oldFilePath = path.join(UPLOAD_DIR, oldFilename);
        
        try {
          await fs.unlink(oldFilePath);
        } catch (cleanupError) {
          // Log but don't fail the request if old file cleanup fails
          console.warn(`Could not delete old image file: ${oldFilePath}`, cleanupError.message);
        }
      }

      res.json({
        message: 'Pizza image uploaded successfully',
        pizza: {
          id: pizza._id,
          name: pizza.name,
          imageUrl: pizza.imageUrl
        }
      });
    } catch (error) {
      // Clean up uploaded file on any error
      if (uploadedFilePath) {
        try {
          await fs.unlink(uploadedFilePath);
        } catch (cleanupError) {
          console.error('Failed to clean up uploaded file:', cleanupError);
        }
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/admin/pizzas/:pizzaId/image
 * 
 * Remove pizza image.
 * Requires admin authentication and CSRF protection.
 */
router.delete(
  '/pizzas/:pizzaId/image',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { pizzaId } = req.params;

      // Validate pizzaId format
      if (!pizzaId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({
          error: { code: 'INVALID_ID', message: 'Invalid pizza ID format' }
        });
      }

      const pizza = await Pizza.findById(pizzaId);
      if (!pizza) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Pizza not found' }
        });
      }

      if (!pizza.imageUrl) {
        return res.status(400).json({
          error: { code: 'NO_IMAGE', message: 'Pizza has no image to remove' }
        });
      }

      // Extract filename from imageUrl (e.g., "/uploads/pizzas/abc123.jpg")
      const filename = path.basename(pizza.imageUrl);
      const filepath = path.join(UPLOAD_DIR, filename);

      // Remove from filesystem (ignore errors if file doesn't exist)
      try {
        await fs.unlink(filepath);
      } catch (err) {
        console.warn(`Could not delete image file: ${filepath}`, err.message);
      }

      // Update pizza record
      pizza.imageUrl = null;
      await pizza.save();

      res.json({
        message: 'Pizza image removed successfully',
        pizza: {
          id: pizza._id,
          name: pizza.name,
          imageUrl: pizza.imageUrl
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/pizzas
 * 
 * List all pizzas (active and inactive) for admin management.
 * Includes populated ingredients and calculated prices.
 * Requires admin authentication.
 */
router.get(
  '/pizzas',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const pizzas = await Pizza.find({})
        .populate('ingredients.base', 'name pricePaise category')
        .populate('ingredients.sauce', 'name pricePaise category')
        .populate('ingredients.cheese', 'name pricePaise category')
        .populate('ingredients.vegetables', 'name pricePaise category')
        .populate('ingredients.proteins', 'name pricePaise category')
        .lean();

      // Calculate price for each pizza
      const pizzasWithPrices = await Promise.all(
        pizzas.map(async (p) => {
          try {
            // Reconstruct Mongoose document to use calculatePrice method
            const pizzaDoc = new Pizza(p);
            const pricePaise = await pizzaDoc.calculatePrice();
            
            return {
              id: p._id,
              name: p.name,
              description: p.description,
              category: p.category,
              imageUrl: p.imageUrl,
              isActive: p.isActive,
              pricePaise,
              ingredients: {
                base: p.ingredients.base ? {
                  id: p.ingredients.base._id,
                  name: p.ingredients.base.name,
                  pricePaise: p.ingredients.base.pricePaise
                } : null,
                sauce: p.ingredients.sauce ? {
                  id: p.ingredients.sauce._id,
                  name: p.ingredients.sauce.name,
                  pricePaise: p.ingredients.sauce.pricePaise
                } : null,
                cheese: p.ingredients.cheese ? {
                  id: p.ingredients.cheese._id,
                  name: p.ingredients.cheese.name,
                  pricePaise: p.ingredients.cheese.pricePaise
                } : null,
                vegetables: (p.ingredients.vegetables || []).map(v => ({
                  id: v._id,
                  name: v.name,
                  pricePaise: v.pricePaise
                })),
                proteins: (p.ingredients.proteins || []).map(pr => ({
                  id: pr._id,
                  name: pr.name,
                  pricePaise: pr.pricePaise
                }))
              },
              createdAt: p.createdAt,
              updatedAt: p.updatedAt
            };
          } catch (err) {
            // If price calculation fails, return pizza without price
            console.error(`Failed to calculate price for pizza ${p.name}:`, err.message);
            return {
              id: p._id,
              name: p.name,
              description: p.description,
              category: p.category,
              imageUrl: p.imageUrl,
              isActive: p.isActive,
              pricePaise: null,
              ingredients: {
                base: p.ingredients.base,
                sauce: p.ingredients.sauce,
                cheese: p.ingredients.cheese,
                vegetables: p.ingredients.vegetables || [],
                proteins: p.ingredients.proteins || []
              },
              createdAt: p.createdAt,
              updatedAt: p.updatedAt
            };
          }
        })
      );

      res.json({ pizzas: pizzasWithPrices });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/pizzas
 * 
 * Create a new pizza.
 * Requires admin authentication and CSRF protection.
 */
router.post(
  '/pizzas',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { name, description, category, ingredients } = req.body;

      // Validate required fields
      if (!name || !category || !ingredients) {
        return res.status(400).json({
          error: 'Name, category, and ingredients are required'
        });
      }

      if (!ingredients.base || !ingredients.sauce || !ingredients.cheese) {
        return res.status(400).json({
          error: 'Base, sauce, and cheese are required'
        });
      }

      // Check name uniqueness
      const existing = await Pizza.findOne({ name: name.trim() });
      if (existing) {
        return res.status(400).json({
          error: `Pizza name "${name}" already exists`
        });
      }

      // Create pizza (model validation will enforce category rules)
      const pizza = new Pizza({
        name: name.trim(),
        description: description?.trim() || '',
        category,
        ingredients: {
          base: ingredients.base,
          sauce: ingredients.sauce,
          cheese: ingredients.cheese,
          vegetables: ingredients.vegetables || [],
          proteins: ingredients.proteins || []
        }
      });

      await pizza.save();

      // Return created pizza with populated ingredients
      const created = await Pizza.findById(pizza._id)
        .populate('ingredients.base', 'name pricePaise category')
        .populate('ingredients.sauce', 'name pricePaise category')
        .populate('ingredients.cheese', 'name pricePaise category')
        .populate('ingredients.vegetables', 'name pricePaise category')
        .populate('ingredients.proteins', 'name pricePaise category')
        .lean();

      const pricePaise = await new Pizza(created).calculatePrice();

      res.status(201).json({
        message: 'Pizza created successfully',
        pizza: {
          id: created._id,
          name: created.name,
          description: created.description,
          category: created.category,
          imageUrl: created.imageUrl,
          isActive: created.isActive,
          pricePaise,
          ingredients: created.ingredients
        }
      });
    } catch (error) {
      // Handle Mongoose validation errors
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(e => e.message);
        return res.status(400).json({ error: messages.join('; ') });
      }
      next(error);
    }
  }
);

/**
 * PUT /api/admin/pizzas/:pizzaId
 * 
 * Update an existing pizza.
 * Requires admin authentication and CSRF protection.
 */
router.put(
  '/pizzas/:pizzaId',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { pizzaId } = req.params;
      const { name, description, category, ingredients } = req.body;

      const pizza = await Pizza.findById(pizzaId);
      if (!pizza) {
        return res.status(404).json({ error: 'Pizza not found' });
      }

      // Validate required fields
      if (!name || !category || !ingredients) {
        return res.status(400).json({
          error: 'Name, category, and ingredients are required'
        });
      }

      if (!ingredients.base || !ingredients.sauce || !ingredients.cheese) {
        return res.status(400).json({
          error: 'Base, sauce, and cheese are required'
        });
      }

      // Check name uniqueness (excluding current pizza)
      const existing = await Pizza.findOne({
        name: name.trim(),
        _id: { $ne: pizzaId }
      });
      if (existing) {
        return res.status(400).json({
          error: `Pizza name "${name}" already exists`
        });
      }

      // Update pizza fields
      pizza.name = name.trim();
      pizza.description = description?.trim() || '';
      pizza.category = category;
      pizza.ingredients = {
        base: ingredients.base,
        sauce: ingredients.sauce,
        cheese: ingredients.cheese,
        vegetables: ingredients.vegetables || [],
        proteins: ingredients.proteins || []
      };

      await pizza.save();

      // Return updated pizza with populated ingredients
      const updated = await Pizza.findById(pizza._id)
        .populate('ingredients.base', 'name pricePaise category')
        .populate('ingredients.sauce', 'name pricePaise category')
        .populate('ingredients.cheese', 'name pricePaise category')
        .populate('ingredients.vegetables', 'name pricePaise category')
        .populate('ingredients.proteins', 'name pricePaise category')
        .lean();

      const pricePaise = await new Pizza(updated).calculatePrice();

      res.json({
        message: 'Pizza updated successfully',
        pizza: {
          id: updated._id,
          name: updated.name,
          description: updated.description,
          category: updated.category,
          imageUrl: updated.imageUrl,
          isActive: updated.isActive,
          pricePaise,
          ingredients: updated.ingredients
        }
      });
    } catch (error) {
      // Handle Mongoose validation errors
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(e => e.message);
        return res.status(400).json({ error: messages.join('; ') });
      }
      next(error);
    }
  }
);


/**
 * PATCH /api/admin/pizzas/:pizzaId/status
 * 
 * Toggle pizza activation status (activate or deactivate).
 * Requires admin authentication and CSRF protection.
 */
router.patch(
  '/pizzas/:pizzaId/status',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { pizzaId } = req.params;
      const { isActive } = req.body;

      // Validate pizzaId format
      if (!pizzaId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({
          error: { code: 'INVALID_ID', message: 'Invalid pizza ID format' }
        });
      }

      // Validate isActive value
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          error: { code: 'INVALID_STATUS', message: 'isActive must be a boolean' }
        });
      }

      const pizza = await Pizza.findById(pizzaId);
      if (!pizza) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Pizza not found' }
        });
      }

      // Update status
      pizza.isActive = isActive;
      await pizza.save();

      res.json({
        message: `Pizza ${isActive ? 'activated' : 'deactivated'} successfully`,
        pizza: {
          id: pizza._id,
          name: pizza.name,
          isActive: pizza.isActive,
          updatedAt: pizza.updatedAt
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/orders/:orderId/status
 *
 * Advance a paid order through its approved fulfillment stages.
 *
 * Allowed transitions:
 * received -> in_kitchen
 * in_kitchen -> sent_to_delivery
 *
 * Payment confirmation remains exclusively controlled
 * by the existing payment verification workflow.
 */
router.patch(
  '/orders/:orderId/status',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body || {};

      // Validate MongoDB ObjectId.
      if (!/^[0-9a-fA-F]{24}$/.test(orderId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ORDER_ID',
            message: 'Invalid order ID'
          }
        });
      }

      // Administrators can perform only these two transitions.
      if (!['in_kitchen', 'sent_to_delivery'].includes(status)) {
        return res.status(422).json({
          error: {
            code: 'INVALID_STATUS',
            message: 'Invalid administrator order status'
          }
        });
      }

      const expectedCurrentState =
        status === 'in_kitchen'
          ? 'received'
          : 'in_kitchen';

      // Atomically validate and update the order state.
      // Only payment-confirmed orders are eligible.
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: orderId,
          orderState: expectedCurrentState,
          paymentStatus: {
            $in: ['paid', 'paid_after_expiry']
          }
        },
        {
          $set: {
            orderState: status
          }
        },
        {
          returnDocument: 'after',
  runValidators: true
        }
      ).select('_id customerId orderState updatedAt');

      if (!updatedOrder) {
        const exists = await Order.exists({ _id: orderId });

        if (!exists) {
          return res.status(404).json({
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'Order not found'
            }
          });
        }

        return res.status(409).json({
          error: {
            code: 'INVALID_TRANSITION',
            message:
              'Order is not eligible for this status transition'
          }
        });
      }

      // Notify the owning customer after MongoDB succeeds.
      // Notification failure must not undo a saved transition.
      try {
        const io = req.app.get('io');

        notifyOrderUpdated(io, updatedOrder);
      } catch (notificationError) {
        console.error(
          'Order status saved, but notification failed:',
          notificationError
        );
      }

      return res.status(200).json({
        message: 'Order status updated successfully',
        order: {
          orderId: updatedOrder._id.toString(),
          orderState: updatedOrder.orderState,
          updatedAt: updatedOrder.updatedAt
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/ingredients/:ingredientId/stock
 * 
 * Update ingredient stock quantity.
 * Admin-only endpoint for manual inventory management.
 * Requires admin authentication and CSRF protection.
 */
router.patch(
  '/ingredients/:ingredientId/stock',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { ingredientId } = req.params;
      const { stock } = req.body;

      // Validate ingredient ID format
      if (!ingredientId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({
          error: { code: 'INVALID_ID', message: 'Invalid ingredient ID format' }
        });
      }

      // Validate stock value
      if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({
          error: { code: 'INVALID_STOCK', message: 'Stock must be a non-negative integer' }
        });
      }

      // Use atomic update with validation
      const ingredient = await Ingredient.findOneAndUpdate(
        {
          _id: ingredientId,
          // Ensure new stock is not less than reserved quantity
          $expr: { $lte: ['$reserved', stock] }
        },
        {
          $set: { stock, updatedAt: new Date() }
        },
        {
          new: true,
          runValidators: true
        }
      );

      if (!ingredient) {
        // Check if ingredient exists
        const exists = await Ingredient.exists({ _id: ingredientId });
        
        if (!exists) {
          return res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Ingredient not found' }
          });
        }

        // Ingredient exists but update failed - likely due to stock < reserved constraint
        const currentIng = await Ingredient.findById(ingredientId);
        return res.status(400).json({
          error: {
            code: 'STOCK_BELOW_RESERVED',
            message: `Stock cannot be less than reserved quantity (${currentIng.reserved})`
          }
        });
      }

      // Calculate derived fields for response
      const available = ingredient.stock - ingredient.reserved;
      const isLowStock = available <= ingredient.lowStockThreshold;

      // Clear alert state only if stock is now adequate
      // Don't clear if ingredient remains low - this prevents duplicate alerts
      if (!isLowStock) {
        clearAlertState(ingredient._id);
      }

      res.json({
        message: 'Stock updated successfully',
        ingredient: {
          id: ingredient._id,
          name: ingredient.name,
          category: ingredient.category,
          pricePaise: ingredient.pricePaise,
          stock: ingredient.stock,
          reserved: ingredient.reserved,
          available,
          lowStockThreshold: ingredient.lowStockThreshold,
          isLowStock,
          isActive: ingredient.isActive,
          updatedAt: ingredient.updatedAt
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/ingredients/:ingredientId/threshold
 * 
 * Update ingredient low-stock threshold.
 * Admin-only endpoint for configuring inventory alerts.
 * Requires admin authentication and CSRF protection.
 */
router.patch(
  '/ingredients/:ingredientId/threshold',
  authenticateToken,
  requireAdmin,
  doubleCsrfProtection,
  async (req, res, next) => {
    try {
      const { ingredientId } = req.params;
      const { lowStockThreshold } = req.body;

      // Validate ingredient ID format
      if (!ingredientId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({
          error: { code: 'INVALID_ID', message: 'Invalid ingredient ID format' }
        });
      }

      // Validate threshold value
      if (typeof lowStockThreshold !== 'number' || !Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
        return res.status(400).json({
          error: { code: 'INVALID_THRESHOLD', message: 'Threshold must be a non-negative integer' }
        });
      }

      // Update threshold
      const ingredient = await Ingredient.findByIdAndUpdate(
        ingredientId,
        {
          $set: { lowStockThreshold, updatedAt: new Date() }
        },
        {
          new: true,
          runValidators: true
        }
      );

      if (!ingredient) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Ingredient not found' }
        });
      }

      // Calculate derived fields
      const available = ingredient.stock - ingredient.reserved;
      const isLowStock = available <= ingredient.lowStockThreshold;

      // Clear alert state only if ingredient is no longer low stock
      // If it's still low stock after threshold change, keep alert state
      if (!isLowStock) {
        clearAlertState(ingredient._id);
      }

      res.json({
        message: 'Threshold updated successfully',
        ingredient: {
          id: ingredient._id,
          name: ingredient.name,
          category: ingredient.category,
          pricePaise: ingredient.pricePaise,
          stock: ingredient.stock,
          reserved: ingredient.reserved,
          available,
          lowStockThreshold: ingredient.lowStockThreshold,
          isLowStock,
          isActive: ingredient.isActive,
          updatedAt: ingredient.updatedAt
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/ingredients
 * 
 * Retrieve all ingredients with inventory information.
 * Read-only endpoint for inventory management.
 * Requires admin authentication.
 */
router.get(
  '/ingredients',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const ingredients = await Ingredient.find({})
        .select('name category pricePaise stock reserved lowStockThreshold isActive createdAt updatedAt')
        .lean();

      // Add computed fields (available, isLowStock)
      const ingredientsWithComputed = ingredients.map(ing => {
        const available = ing.stock - ing.reserved;
        const isLowStock = available <= ing.lowStockThreshold;
        
        return {
          id: ing._id,
          name: ing.name,
          category: ing.category,
          pricePaise: ing.pricePaise,
          stock: ing.stock,
          reserved: ing.reserved,
          available,
          lowStockThreshold: ing.lowStockThreshold,
          isLowStock,
          isActive: ing.isActive,
          createdAt: ing.createdAt,
          updatedAt: ing.updatedAt
        };
      });

      res.json({ ingredients: ingredientsWithComputed });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/dashboard/stats
 * 
 * Retrieve aggregated dashboard statistics.
 * Requires admin authentication.
 */
router.get(
  '/dashboard/stats',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      // Aggregate order statistics
      const orderStats = await Order.aggregate([
        {
          $group: {
            _id: '$orderState',
            count: { $sum: 1 },
            totalRevenue: { $sum: '$totalPricePaise' }
          }
        }
      ]);

      // Calculate totals
      let totalOrders = 0;
      let totalRevenue = 0;
      let pendingPaymentOrders = 0;
      let activeOrders = 0;

      orderStats.forEach(stat => {
        totalOrders += stat.count;
        totalRevenue += stat.totalRevenue;
        
        if (stat._id === 'pending_payment') {
          pendingPaymentOrders = stat.count;
        } else if (['received', 'in_kitchen', 'sent_to_delivery'].includes(stat._id)) {
          activeOrders += stat.count;
        }
      });

      // Get low stock ingredients
      // Note: 'available' and 'isLowStock' are virtual fields
      // We must calculate them manually since .lean() doesn't include virtuals
      const allIngredients = await Ingredient.find({ isActive: true })
        .select('stock reserved lowStockThreshold')
        .lean();

      const lowStockCount = allIngredients.filter(ing => {
        const available = ing.stock - ing.reserved;
        return available <= ing.lowStockThreshold;
      }).length;

      // Get total active pizzas
      const activePizzas = await Pizza.countDocuments({ isActive: true });

      res.json({
        totalOrders,
        totalRevenue, // in paise
        pendingPaymentOrders,
        activeOrders,
        lowStockCount,
        activePizzas
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/orders
 * 
 * Retrieve recent orders with pagination.
 * Requires admin authentication.
 * 
 * Query params:
 *   - limit: number of orders (1-50, default 10)
 */
router.get(
  '/orders',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      // Validate and parse limit parameter
      let limit = parseInt(req.query.limit, 10);
      
      if (isNaN(limit) || limit < 1) {
        limit = 10;
      } else if (limit > 50) {
        limit = 50;
      }

      // Fetch recent orders with minimal customer data
      const orders = await Order.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('customerId', 'email') // Only expose email
        .select('orderState paymentStatus totalPricePaise createdAt customerId')
        .lean();

      res.json({
        orders: orders.map(order => ({
          orderId: order._id.toString(),
          orderState: order.orderState,
          paymentStatus: order.paymentStatus,
          totalPricePaise: order.totalPricePaise,
          createdAt: order.createdAt,
          customerEmail: order.customerId?.email || 'Unknown'
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/orders/:orderId
 * 
 * Retrieve detailed information for a single order.
 * Requires admin authentication.
 */
router.get(
  '/orders/:orderId',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { orderId } = req.params;

      // Validate MongoDB ObjectId
      if (!/^[0-9a-fA-F]{24}$/.test(orderId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ORDER_ID',
            message: 'Invalid order ID format'
          }
        });
      }

      // Fetch order with customer details
      const order = await Order.findById(orderId)
        .populate('customerId', 'email')
        .lean();

      if (!order) {
        return res.status(404).json({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'Order not found'
          }
        });
      }

      // Format response
      res.json({
        order: {
          orderId: order._id.toString(),
          customerEmail: order.customerId?.email || 'Unknown',
          items: order.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            unitPricePaise: item.unitPricePaise,
            totalPricePaise: item.totalPricePaise,
            base: item.base.name,
            sauce: item.sauce.name,
            cheese: item.cheese.name,
            vegetables: item.vegetables.map(v => v.name)
          })),
          totalPricePaise: order.totalPricePaise,
          orderState: order.orderState,
          paymentStatus: order.paymentStatus,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: order.razorpayPaymentId,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          reservationExpiresAt: order.reservationExpiresAt,
          paymentCapturedAt: order.paymentCapturedAt
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
