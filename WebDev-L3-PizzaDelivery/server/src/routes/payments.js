/**
 * Payment Routes
 * 
 * Implements Phase 4 Task 4.4 payment initiation endpoints:
 * - Authenticated, CSRF-protected payment initiation
 * - Customer-owned order authorization
 * - Gateway locking and recovery (OD-24)
 * - Safe error handling without secret exposure
 */
import { doubleCsrfProtection } from '../middleware/security.js';
import express from 'express';
import { authenticateToken, requireCustomer } from '../middleware/auth.js';
import { initiatePayment, verifyPayment } from '../services/razorpayService.js';

const router = express.Router();

/**
 * POST /api/v1/payments/initiate
 * 
 * Initiate Razorpay payment for an order
 * 
 * Request body:
 * {
 *   orderId: string (MongoDB ObjectId)
 * }
 * 
 * Response:
 * {
 *   orderId: string,
 *   razorpayOrderId: string,
 *   amountPaise: number,
 *   currency: string,
 *   keyId: string,
 *   existing: boolean
 * }
 * 
 * Errors:
 * - 400: Invalid request
 * - 401: Not authenticated
 * - 403: Order belongs to different customer
 * - 404: Order not found
 * - 409: Invalid order state or expired reservation
 * - 503: Gateway error
 */
router.post(
  '/initiate',
  authenticateToken,
  requireCustomer,
  doubleCsrfProtection,
  async (req, res) => {
  try {
    const { orderId } = req.body ?? {};
    
    // Validate request
    if (!orderId) {
      return res.status(400).json({
        error: {
          code: 'MISSING_ORDER_ID',
          message: 'Order ID is required'
        }
      });
    }
    
    // Initiate payment with gateway locking
    const paymentDetails = await initiatePayment(orderId, req.user.id);
    
    return res.status(200).json(paymentDetails);
    
  } catch (error) {
    // Map service errors to HTTP responses
    switch (error.code) {
      case 'INVALID_ORDER_ID':
        return res.status(400).json({
          error: {
            code: error.code,
            message: 'Invalid order ID format'
          }


          
        });
      
      case 'ORDER_NOT_FOUND':
        return res.status(404).json({
          error: {
            code: error.code,
            message: 'Order not found'
          }
        });
      
      case 'INVALID_ORDER_STATE':
        return res.status(409).json({
          error: {
            code: error.code,
            message: 'Order is not pending payment'
          }
        });
      
      case 'RESERVATION_EXPIRED':
        return res.status(409).json({
          error: {
            code: error.code,
            message: 'Order reservation has expired'
          }
        });
      
      case 'GATEWAY_LOCK_HELD':
        return res.status(409).json({
          error: {
            code: error.code,
            message: 'Payment initiation in progress, please retry'
          }
        });
      
      case 'FENCING_VIOLATION':
  return res.status(409).json({
    error: {
      code: error.code,
      message:
        'Payment initiation outcome is uncertain. ' +
        'Do not retry payment until the order has been reviewed.'
    }
  });
      
      case 'GATEWAY_ERROR':
        return res.status(503).json({
          error: {
            code: error.code,
            message: 'Payment gateway temporarily unavailable'
          }
        });
      
      default:
        // Never expose internal error details
        console.error('Payment initiation error:', error);
        return res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An error occurred while initiating payment'
          }
        });

        case 'GATEWAY_RECONCILIATION_REQUIRED':
  return res.status(409).json({
    error: {
      code: error.code,
      message:
        'Previous payment initiation requires reconciliation'
    }
  });

case 'GATEWAY_OUTCOME_UNKNOWN':
  return res.status(503).json({
    error: {
      code: error.code,
      message:
        'Payment initiation outcome is uncertain'
    }
  });

  
    }

    
  }
});

/**
 * POST /api/v1/payments/verify
 * 
 * Verify Razorpay payment signature (Task 4.5 Step 1)
 * 
 * This endpoint validates:
 * - Order ownership
 * - Order state
 * - Razorpay order ID match
 * - Payment signature (HMAC-SHA256)
 * 
 * Does NOT yet:
 * - Confirm payment capture with gateway
 * - Update payment status
 * - Commit inventory
 * 
 * Request body:
 * {
 *   orderId: string (MongoDB ObjectId),
 *   razorpayOrderId: string,
 *   razorpayPaymentId: string,
 *   razorpaySignature: string (HMAC hex)
 * }
 * 
 * Response:
 * {
 *   orderId: string,
 *   razorpayOrderId: string,
 *   razorpayPaymentId: string,
 *   amountPaise: number,
 *   verified: true
 * }
 * 
 * Errors:
 * - 400: Invalid request or missing fields
 * - 401: Not authenticated
 * - 403: Order belongs to different customer
 * - 404: Order not found
 * - 409: Invalid order state or no gateway order
 * - 422: Signature verification failed or order ID mismatch
 */
router.post(
  '/verify',
  authenticateToken,
  requireCustomer,
  doubleCsrfProtection,
  async (req, res) => {
    try {
      const {
  orderId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
} = req.body ?? {};
      
      // Validate required fields
      if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'Order ID, Razorpay order ID, payment ID, and signature are required'
          }
        });
      }
      
      // Verify payment signature and ownership
      const result = await verifyPayment(
        orderId,
        req.user.id,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );
      
      return res.status(200).json(result);
      
    } catch (error) {
      // Map service errors to HTTP responses
      switch (error.code) {
        case 'INVALID_ORDER_ID':
          return res.status(400).json({
            error: {
              code: error.code,
              message: 'Invalid order ID format'
            }
          });
        
        case 'ORDER_NOT_FOUND':
          return res.status(404).json({
            error: {
              code: error.code,
              message: 'Order not found'
            }
          });
        
        case 'INVALID_ORDER_STATE':
          return res.status(409).json({
            error: {
              code: error.code,
              message: 'Order is not pending payment'
            }
          });
        
        case 'NO_GATEWAY_ORDER':
          return res.status(409).json({
            error: {
              code: error.code,
              message: 'No payment has been initiated for this order'
            }
          });
        
        case 'ORDER_ID_MISMATCH':
          return res.status(422).json({
            error: {
              code: error.code,
              message: 'Razorpay order ID does not match'
            }
          });
        
        case 'INVALID_SIGNATURE':
          return res.status(422).json({
            error: {
              code: error.code,
              message: 'Payment signature verification failed'
            }
          });
        
        case 'PAYMENT_FETCH_FAILED':
          return res.status(503).json({
            error: {
              code: error.code,
              message: 'Unable to verify payment with gateway'
            }
          });
        
        case 'PAYMENT_ID_MISMATCH':
        case 'PAYMENT_ORDER_MISMATCH':
        case 'PAYMENT_AMOUNT_MISMATCH':
        case 'PAYMENT_CURRENCY_MISMATCH':
          return res.status(422).json({
            error: {
              code: error.code,
              message: 'Payment details do not match order'
            }
          });
        
        case 'PAYMENT_NOT_CAPTURED':
        case 'PAYMENT_CAPTURE_INCONSISTENT':
          return res.status(422).json({
            error: {
              code: error.code,
              message: 'Payment has not been captured'
            }
          });
        
        case 'PAYMENT_CONFLICT':
          return res.status(409).json({
            error: {
              code: error.code,
              message: 'Order already has a different payment'
            }
          });
        
        case 'RESERVATION_NOT_HELD':
          return res.status(409).json({
            error: {
              code: error.code,
              message: 'Order reservation is not in held state'
            }
          });
        
        case 'RESERVATION_EXPIRED':
          return res.status(409).json({
            error: {
              code: error.code,
              message: 'Order reservation has expired'
            }
          });
        
        case 'NO_RESERVATION_LINES':
        case 'INVENTORY_COMMIT_FAILED':
          return res.status(500).json({
            error: {
              code: error.code,
              message: 'Unable to commit inventory'
            }
          });
        
        case 'COMMITMENT_FAILED':
          return res.status(500).json({
            error: {
              code: error.code,
              message: 'Failed to commit payment and inventory'
            }
          });
        
        default:
          // Never expose internal error details
          console.error('Payment verification error:', error);
          return res.status(500).json({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'An error occurred while verifying payment'
            }
          });
      }
    }
  }
);

export default router;
