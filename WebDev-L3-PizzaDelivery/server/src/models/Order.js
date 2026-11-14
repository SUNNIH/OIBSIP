/**
 * Order Model
 * 
 * Implements Phase 4 approved order structure with:
 * - Customer ownership (OD-17)
 * - Multi-line items with quantities (OD-17)
 * - Immutable pricing snapshots (OD-07)
 * - INR paise integer pricing (OD-19)
 * - Customer-scoped idempotency
 * - Order and payment states (OD-06)
 * - Reservation metadata (OD-04)
 * - Payment IDs
 * - Gateway locking (OD-24)
 */

import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Pizza line item schema
 * Each item represents a pizza configuration with quantity
 */
const OrderItemSchema = new Schema({
  // Pizza configuration
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  
  // Ingredient selections with immutable pricing
  base: {
    ingredientId: {
      type: Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true
    },
    name: { type: String, required: true },
    pricePaise: { 
      type: Number, 
      required: true, 
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer (paise)'
      }
    }
  },
  
  sauce: {
    ingredientId: {
      type: Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true
    },
    name: { type: String, required: true },
    pricePaise: { 
      type: Number, 
      required: true, 
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer (paise)'
      }
    }
  },
  
  cheese: {
    ingredientId: {
      type: Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true
    },
    name: { type: String, required: true },
    pricePaise: { 
      type: Number, 
      required: true, 
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer (paise)'
      }
    }
  },
  
  vegetables: [{
    ingredientId: {
      type: Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true
    },
    name: { type: String, required: true },
    pricePaise: { 
      type: Number, 
      required: true, 
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer (paise)'
      }
    }
  }],
  
  // Protein toppings with pricing snapshots
  proteins: [{
    ingredientId: {
      type: Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true
    },

    name: {
      type: String,
      required: true
    },

    pricePaise: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer (paise)'
      }
    }
  }],

  // Quantity and computed pricing (immutable snapshot)
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be an integer'
    }
  },
  
  unitPricePaise: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Unit price must be an integer (paise)'
    }
  },
  
  lineTotalPaise: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Line total must be an integer (paise)'
    }
  }
}, { _id: false });

/**
 * Reservation metadata schema (OD-04)
 * Tracks inventory reservation lifecycle
 */
const ReservationIngredientSchema = new Schema({
  ingredientId: {
    type: Schema.Types.ObjectId,
    ref: 'Ingredient',
    required: true
  },

  qty: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isSafeInteger,
      message: 'Reservation quantity must be a positive safe integer'
    }
  }
}, { _id: false });

const ReservationMetadataSchema = new Schema({
  state: {
    type: String,
    enum: ['held', 'committed', 'released'],
    default: 'held',
    required: true
  },

  reservedAt: {
    type: Date,
    required: true
  },

  expiresAt: {
    type: Date,
    required: true,
    index: true
  },

  committedAt: {
    type: Date,
    default: null
  },

  releasedAt: {
    type: Date,
    default: null
  },

  lines: {
    type: [ReservationIngredientSchema],
    default: []
  }
}, { _id: false });

/**
 * Gateway lock metadata schema (OD-24)
 * Prevents duplicate gateway order creation
 */
const GatewayLockSchema = new Schema({
  token: {
    type: String,
    required: true,
    index: true
  },
  
  fencingGeneration: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Fencing generation must be an integer'
    }
  },
  
  acquiredAt: {
    type: Date,
    required: true
  },
  
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, { _id: false });

/**
 * Main Order schema
 */
const OrderSchema = new Schema({

  // Reservation metadata (OD-04)
reservation: {
  type: ReservationMetadataSchema,
  required: true
},

// Persistent gateway fencing counter (OD-24)
gatewayGeneration: {
  type: Number,
  default: 0,
  min: 0
},

// Gateway reconciliation flag (OD-24)
gatewayReconciliationRequired: {
  type: Boolean,
  default: false,
  index: true
},

// Gateway lock (OD-24)
gatewayLock: {
  type: GatewayLockSchema,
  default: null
},

  // Customer ownership
  customerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Order items (multi-line cart)
  items: {
    type: [OrderItemSchema],
    required: true,
    validate: {
      validator: function(items) {
        return items && items.length > 0;
      },
      message: 'Order must contain at least one item'
    }
  },
  
  // Immutable pricing snapshot
  totalPricePaise: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Total price must be an integer (paise)'
    }
  },
  
  // Order state (OD-06 approved states)
  orderState: {
    type: String,
    required: true,
    enum: ['pending_payment', 'received', 'in_kitchen', 'sent_to_delivery', 'expired'],
    default: 'pending_payment',
    index: true
  },
  
  // Payment sub-status (OD-06)
  paymentStatus: {
    type: String,
    required: true,
    enum: ['pending_gateway', 'created', 'paid', 'paid_after_expiry'],
    default: 'pending_gateway',
    index: true
  },
  
  // Razorpay identifiers
  razorpayOrderId: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  
  razorpayPaymentId: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  
  razorpaySignature: {
    type: String,
    default: null
  },
  
  // Idempotency and deduplication (customer-scoped)
  idempotencyKey: {
    type: String,
    required: true,
    index: true
  },
  
  requestHash: {
    type: String,
    required: true,
    index: true
  },
  
  clientRequestId: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  
// Persistent gateway fencing counter (OD-24)
// Incremented whenever a new gateway lock is acquired.
// Never reset when the temporary lock is released.
gatewayGeneration: {
  type: Number,
  default: 0,
  min: 0
},

// Gateway reconciliation flag (OD-24)
// Prevents another gateway order from being created
// when the previous gateway outcome is uncertain.
gatewayReconciliationRequired: {
  type: Boolean,
  default: false,
  index: true
},

// Gateway lock (OD-24)
gatewayLock: {
  type: GatewayLockSchema,
  default: null
},
  
  // Gateway lock (OD-24)
  gatewayLock: {
    type: GatewayLockSchema,
    default: null
  },
  
  // Manual review flags
  requiresManualRefundReview: {
    type: Boolean,
    default: false,
    index: true
  },
  
  manualReviewNotes: {
    type: String,
    default: null
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

/**
 * Compound indexes for queries
 */
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ orderState: 1, 'reservation.expiresAt': 1 });
OrderSchema.index({ paymentStatus: 1, updatedAt: -1 });
OrderSchema.index({ requiresManualRefundReview: 1, updatedAt: -1 });

// Customer-scoped idempotency: same customer cannot reuse same key
OrderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });

/**
 * Pre-save hook to validate pricing consistency
 */
OrderSchema.pre('save', function() {
  // Validate that totalPricePaise matches sum of line items
  const computedTotal = this.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  
  if (this.totalPricePaise !== computedTotal) {
    throw new Error(`Total price mismatch: order total ${this.totalPricePaise} does not match computed sum ${computedTotal}`);
  }
  
  // Validate that each line item's lineTotalPaise = unitPricePaise * quantity
  for (const item of this.items) {
    const expectedLineTotal = item.unitPricePaise * item.quantity;
    if (item.lineTotalPaise !== expectedLineTotal) {
      throw new Error(`Line total mismatch for "${item.name}": ${item.lineTotalPaise} does not match ${item.unitPricePaise} * ${item.quantity}`);
    }
  }
});

/**
 * Instance method: Validate state transition (OD-06 approved transitions)
 */
OrderSchema.methods.canTransitionTo = function(newState) {
  const currentState = this.orderState;
  
  const allowedTransitions = {
    'pending_payment': ['received', 'expired'],
    'received': ['in_kitchen'],
    'in_kitchen': ['sent_to_delivery'],
    'expired': ['received'], // Only for late payment recovery
    'sent_to_delivery': []
  };
  
  const allowed = allowedTransitions[currentState] || [];
  return allowed.includes(newState);
};

/**
 * Instance method: Transition to new state with validation
 */
OrderSchema.methods.transitionTo = function(newState) {
  if (!this.canTransitionTo(newState)) {
    throw new Error(`Invalid transition from ${this.orderState} to ${newState}`);
  }
  
  this.orderState = newState;
  return this;
};

/**
 * Instance method: Check if reservation is expired
 */
OrderSchema.methods.isReservationExpired = function() {
  if (!this.reservation || !this.reservation.expiresAt) {
    return false;
  }
  return Date.now() >= this.reservation.expiresAt.getTime();
};

/**
 * Instance method: Check if gateway lock is expired
 */
OrderSchema.methods.isGatewayLockExpired = function() {
  if (!this.gatewayLock || !this.gatewayLock.expiresAt) {
    return true; // No lock = expired
  }
  return Date.now() >= this.gatewayLock.expiresAt.getTime();
};

/**
 * Instance method: Check if gateway lock is held by token
 */
OrderSchema.methods.isGatewayLockHeldBy = function(token) {
  if (!this.gatewayLock || this.isGatewayLockExpired()) {
    return false;
  }
  return this.gatewayLock.token === token;
};

/**
 * Static method: Find orders with expired reservations
 */
OrderSchema.statics.findExpiredReservations = function() {
  return this.find({
    'reservation.state': 'held',
    'reservation.expiresAt': { $lte: new Date() },
    'reservation.releasedAt': null,
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
  });
};

/**
 * Static method: Find orders requiring manual refund review
 */
OrderSchema.statics.findRequiringRefundReview = function() {
  return this.find({
    requiresManualRefundReview: true
  }).sort({ updatedAt: -1 });
};

const Order = mongoose.model('Order', OrderSchema);

export default Order;
