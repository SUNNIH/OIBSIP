// SUNNYS Pizza — Shopping Cart Utilities
// Manages cart state with localStorage persistence

const CART_STORAGE_PREFIX = 'sunnys-pizza-cart';

export function getCartOwnerId(user) {
  const id = user?.id ?? user?._id;
  return typeof id === 'string' && id.trim() ? id : null;
}

function getCartStorageKey(user) {
  const userId = getCartOwnerId(user);

  if (!userId) return null;

  return `${CART_STORAGE_PREFIX}:${userId}`;
}
const MAX_CART_LINES = 20;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 100;

/**
 * Cart item structure:
 * {
 *   id: string (unique identifier),
 *   name: string,
 *   recipe: {
 *     base: string,
 *     sauce: string,
 *     cheese: string,
 *     vegetables: string[],
 *     proteins: string[]
 *   },
 *   quantity: number,
 *   pizzaId: string | null (if from preset)
 * }
 */

/**
 * Load cart from localStorage with validation
 */
export function loadCart(user) {
  const storageKey = getCartStorageKey(user);

  if (!storageKey) return [];

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return [];
    
    const cart = JSON.parse(stored);
    
    // Validate cart structure
    if (!Array.isArray(cart)) return [];
    
    // Validate each item
    const validatedCart = cart.filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (!item.id || typeof item.id !== 'string') return false;
      if (!item.name || typeof item.name !== 'string') return false;
      if (!item.recipe || typeof item.recipe !== 'object') return false;
      if (!item.recipe.base || !item.recipe.sauce || !item.recipe.cheese) return false;
      // Validate vegetable selections
if (!Array.isArray(item.recipe.vegetables)) {
  return false;
}

// Validate protein selections when present
if (
  item.recipe.proteins !== undefined &&
  !Array.isArray(item.recipe.proteins)
) {
  return false;
}

if (typeof item.quantity !== 'number') return false;
      if (item.quantity < MIN_QUANTITY || item.quantity > MAX_QUANTITY) return false;
      return true;
    });
    
   // Enforce max lines limit and normalize older cart items
return validatedCart
  .slice(0, MAX_CART_LINES)
  .map(item => ({
    ...item,

    recipe: {
      ...item.recipe,

      // Older carts may not contain this field
      proteins: item.recipe.proteins ?? [],
    },
  }));
  } catch (err) {
    console.error('Failed to load cart from localStorage:', err);
    return [];
  }
}

/**
 * Save cart to localStorage
 */
export function saveCart(cart, user) {
  const storageKey = getCartStorageKey(user);

  if (!storageKey) return false;

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(cart)
    );

    return true;
  } catch (err) {
    console.error('Failed to save cart to localStorage:', err);
    return false;
  }
}

/**
 * Add item to cart
 */
export function addToCart(cart, item) {
  // Enforce max lines limit
  if (cart.length >= MAX_CART_LINES) {
    throw new Error(`Cart is full. Maximum ${MAX_CART_LINES} items allowed.`);
  }
  
  // Validate quantity
  if (item.quantity < MIN_QUANTITY || item.quantity > MAX_QUANTITY) {
    throw new Error(`Quantity must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}.`);
  }
  
  // Validate recipe structure
  if (!item.recipe || !item.recipe.base || !item.recipe.sauce || !item.recipe.cheese) {
    throw new Error('Invalid recipe: missing required ingredients.');
  }
  
  // Validate vegetables array
  if (!Array.isArray(item.recipe.vegetables)) {
    throw new Error('Invalid recipe: vegetables must be an array.');
  }
  
// Validate protein toppings
if (
  item.recipe.proteins !== undefined &&
  !Array.isArray(item.recipe.proteins)
) {
  throw new Error(
    'Invalid recipe: proteins must be an array.'
  );
}

  // Generate unique ID
  const id = `cart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const newItem = {
  id,

  name: item.name || 'Custom Pizza',

  recipe: {
    base: item.recipe.base,

    sauce: item.recipe.sauce,

    cheese: item.recipe.cheese,

    // Preserve vegetable selections
    vegetables: [...item.recipe.vegetables],

    // Preserve protein selections
    proteins: [...(item.recipe.proteins ?? [])],
  },

  quantity: item.quantity,

  pizzaId: item.pizzaId || null,
};
  return [...cart, newItem];
}

/**
 * Update item quantity
 */
export function updateQuantity(cart, itemId, newQuantity) {
  if (newQuantity < MIN_QUANTITY || newQuantity > MAX_QUANTITY) {
    throw new Error(`Quantity must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}.`);
  }
  
  return cart.map(item => 
    item.id === itemId 
      ? { ...item, quantity: newQuantity }
      : item
  );
}

/**
 * Remove item from cart
 */
export function removeFromCart(cart, itemId) {
  return cart.filter(item => item.id !== itemId);
}

/**
 * Clear entire cart
 */
export function clearCart() {
  return [];
}

/**
 * Get cart item count
 */
export function getCartItemCount(cart) {
  return cart.reduce((total, item) => total + item.quantity, 0);
}

/**
 * Convert cart to quote API format
 */
export function cartToQuoteLines(cart) {
  return cart.map(item => ({
    recipe: {
      base: item.recipe.base,

      sauce: item.recipe.sauce,

      cheese: item.recipe.cheese,

      vegetables: item.recipe.vegetables,

      // Include proteins in server-side price calculations
      proteins: item.recipe.proteins ?? [],
    },

    quantity: item.quantity,
  }));
}

export const CART_LIMITS = {
  MAX_LINES: MAX_CART_LINES,
  MIN_QUANTITY,
  MAX_QUANTITY,
};
