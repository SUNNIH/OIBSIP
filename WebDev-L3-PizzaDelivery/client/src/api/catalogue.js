// SUNNYS Pizza — Catalogue API Client
// Communicates with backend catalogue endpoints

const API_BASE = '/api/v1';

/**
 * Get available pizzas from the catalogue
 * @returns {Promise<Array>} Array of pizza objects
 */
export async function getPizzas() {
  const response = await fetch(`${API_BASE}/pizzas`, {
    method: 'GET',
    credentials: 'include', // Include authentication cookie
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication required');
    }
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch pizzas');
  }

  const data = await response.json();
  return data; // Backend returns array directly, not wrapped
}

/**
 * Get available ingredients grouped by category
 * @returns {Promise<Object>} Ingredients grouped by category
 */
export async function getIngredients() {
  const response = await fetch(`${API_BASE}/ingredients`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication required');
    }
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch ingredients');
  }

  const data = await response.json();
  return data; // Backend returns grouped object, not wrapped
}

/**
 * Get price quote for order without creating order
 * @param {Array} lines - Order lines with recipe and quantity
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Quote with lines and total price
 */
export async function getQuote(lines, csrfToken, signal) {
  const response = await fetch(`${API_BASE}/orders/quote`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': csrfToken,
  },
  credentials: 'include',
  body: JSON.stringify({ lines }),
  signal,
});

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication required');
    }
    const data = await response.json();
    throw new Error(data.error?.message || data.error || 'Failed to get quote');
  }

  const data = await response.json();
  return data;
}

/**
 * Format price from paise to rupees for display
 * @param {number} pricePaise - Price in paise (integer)
 * @returns {string} Formatted price string (e.g., "₹299", "₹299.50")
 */
export function formatPrice(pricePaise) {
  if (typeof pricePaise !== 'number' || !Number.isSafeInteger(pricePaise)) {
    return '—';
  }
  
  const rupees = pricePaise / 100;
  // Format with 2 decimal places, then remove .00 for whole rupees
  const formatted = rupees.toFixed(2).replace(/\.00$/, '');
  return `₹${formatted}`;
}
