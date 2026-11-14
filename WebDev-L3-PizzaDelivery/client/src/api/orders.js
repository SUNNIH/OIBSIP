// SUNNYS Pizza — Orders API Client

const API_BASE = '/api/v1/orders';

// Parse API responses and preserve backend error details.
async function handleApiResponse(response, fallbackMessage) {
  let data;

  try {
    data = await response.json();
  } catch {
    const error = new Error('Unable to read server response');
    error.status = response.status;
    error.code = 'INVALID_RESPONSE';
    throw error;
  }

  if (!response.ok) {
    const details = data?.error;

    const message =
      (typeof details === 'string' ? details : details?.message) ||
      data?.message ||
      (response.status === 401 ? 'Authentication required' : null) ||
      (response.status === 404 ? 'Order not found' : null) ||
      fallbackMessage;

    const error = new Error(message);

    error.status = response.status;
    error.code = details?.code || data?.code || 'API_ERROR';

    throw error;
  }

  return data;
}

// Create an order using the original idempotency key.
export async function createOrder(lines, csrfToken, idempotencyKey) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
      'Idempotency-Key': idempotencyKey
    },
    credentials: 'include',
    body: JSON.stringify({ lines })
  });

  return handleApiResponse(response, 'Failed to create order');
}

// Retrieve a customer's existing order.
export async function getOrder(orderId) {
  const response = await fetch(`${API_BASE}/${orderId}`, {
    method: 'GET',
    credentials: 'include'
  });

  const data = await handleApiResponse(
    response,
    'Failed to fetch order'
  );

  return data.order;
}

// Retrieve customer's order history with pagination.
export async function getOrders(page = 1, limit = 10) {
  const response = await fetch(`${API_BASE}?page=${page}&limit=${limit}`, {
    method: 'GET',
    credentials: 'include'
  });

  const data = await handleApiResponse(
    response,
    'Failed to fetch orders'
  );

  return {
    orders: data.orders,
    pagination: data.pagination
  };
}

// Generate a unique key to prevent duplicate order creation.
export function generateIdempotencyKey() {
  return crypto.randomUUID();
}

// Convert cart items into the backend order format.
// Preserve all ingredient selections, including protein toppings.
export function cartToOrderLines(cart) {
  return cart.map(item => ({
    customRecipe: {
      base: item.recipe.base,
      sauce: item.recipe.sauce,
      cheese: item.recipe.cheese,

      // Vegetable toppings
      vegetables: item.recipe.vegetables ?? [],

      // Protein toppings
      proteins: item.recipe.proteins ?? []
    },

    quantity: item.quantity
  }));
}