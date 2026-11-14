// SUNNYS Pizza — Admin API Client
// Requires administrator authentication

const API_BASE_URL = '';

/**
 * Get aggregated dashboard statistics
 * @returns {Promise<Object>} Dashboard statistics
 */
export async function getDashboardStats() {
  const response = await fetch(`${API_BASE_URL}/api/admin/dashboard/stats`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch dashboard statistics' }));
    throw new Error(error.message || 'Failed to fetch dashboard statistics');
  }

  return response.json();
}

/**
 * Get recent orders
 * @param {number} limit - Number of orders to fetch (1-50)
 * @returns {Promise<Object>} Recent orders list
 */
export async function getRecentOrders(limit = 10) {
  const validLimit = Math.max(1, Math.min(50, limit));
  
  const response = await fetch(`${API_BASE_URL}/api/admin/orders?limit=${validLimit}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch recent orders' }));
    throw new Error(error.message || 'Failed to fetch recent orders');
  }

  return response.json();
}

/**
 * Get all pizzas (including inactive) for admin management
 * @returns {Promise<Array>} Pizza catalogue with ingredients and prices
 */
export async function getAllPizzas() {
  const response = await fetch(`${API_BASE_URL}/api/admin/pizzas`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch pizzas' }));
    throw new Error(error.message || 'Failed to fetch pizzas');
  }

  const data = await response.json();
  return data.pizzas || [];
}

/**
 * Get all pizzas (reusing existing catalogue endpoint)
 * @returns {Promise<Array>} Pizza catalogue
 */
export async function getPizzas() {
  const response = await fetch(`${API_BASE_URL}/api/v1/pizzas`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch pizzas' }));
    throw new Error(error.message || 'Failed to fetch pizzas');
  }

  return response.json();
}


/**
 * Create a new pizza
 * @param {Object} pizzaData - Pizza data (name, description, category, ingredients)
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Created pizza
 */
export async function createPizza(pizzaData, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/pizzas`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify(pizzaData)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to create pizza' }));
    throw new Error(error.error || error.message || 'Failed to create pizza');
  }

  return response.json();
}

/**
 * Update an existing pizza
 * @param {string} pizzaId - Pizza ID
 * @param {Object} pizzaData - Pizza data (name, description, category, ingredients)
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Updated pizza
 */
export async function updatePizza(pizzaId, pizzaData, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/pizzas/${pizzaId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify(pizzaData)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to update pizza' }));
    throw new Error(error.error || error.message || 'Failed to update pizza');
  }

  return response.json();
}

/**
 * Update pizza activation status
 * @param {string} pizzaId - Pizza ID
 * @param {boolean} isActive - New activation status
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Updated pizza data
 */
export async function updatePizzaStatus(pizzaId, isActive, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/pizzas/${pizzaId}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({ isActive })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to update pizza status' }));
    throw new Error(error.error?.message || error.error || error.message || 'Failed to update pizza status');
  }

  return response.json();
}

/**
 * Upload pizza image
 * @param {string} pizzaId - Pizza ID
 * @param {File} imageFile - Image file to upload
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Updated pizza data with imageUrl
 */
export async function uploadPizzaImage(pizzaId, imageFile, csrfToken) {
  const formData = new FormData();
  formData.append('image', imageFile);

  const response = await fetch(`${API_BASE_URL}/api/admin/pizzas/${pizzaId}/image`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrfToken
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to upload image' }));
    throw new Error(error.error?.message || error.message || 'Failed to upload image');
  }

  return response.json();
}

/**
 * Delete pizza image
 * @param {string} pizzaId - Pizza ID
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Updated pizza data
 */
export async function deletePizzaImage(pizzaId, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/pizzas/${pizzaId}/image`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrfToken
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to delete image' }));
    throw new Error(error.error?.message || error.message || 'Failed to delete image');
  }

  return response.json();
}

/**
 * Get all ingredients with inventory information
 * @returns {Promise<Array>} Ingredients list with stock data
 */
export async function getIngredients() {
  const response = await fetch(`${API_BASE_URL}/api/admin/ingredients`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch ingredients' }));
    throw new Error(error.message || 'Failed to fetch ingredients');
  }

  const data = await response.json();
  return data.ingredients || [];
}

/**
 * Update ingredient stock
 * @param {string} ingredientId - Ingredient ID
 * @param {number} stock - New stock quantity
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Updated ingredient data
 */
export async function updateIngredientStock(ingredientId, stock, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/ingredients/${ingredientId}/stock`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({ stock })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to update stock' }));
    throw new Error(error.error?.message || error.message || 'Failed to update stock');
  }

  return response.json();
}

/**
 * Update ingredient low-stock threshold
 * @param {string} ingredientId - Ingredient ID
 * @param {number} lowStockThreshold - New threshold value
 * @param {string} csrfToken - CSRF token for the request
 * @returns {Promise<Object>} Updated ingredient data
 */
export async function updateIngredientThreshold(ingredientId, lowStockThreshold, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/ingredients/${ingredientId}/threshold`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({ lowStockThreshold })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to update threshold' }));
    throw new Error(error.error?.message || error.message || 'Failed to update threshold');
  }

  return await response.json();
}

/**
 * Get all orders with filtering
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Orders list
 */
export async function getAllOrders(filters = {}) {
  const params = new URLSearchParams();
  
  if (filters.status) params.append('status', filters.status);
  if (filters.limit) params.append('limit', filters.limit);
  
  const queryString = params.toString();
  const url = `${API_BASE_URL}/api/admin/orders${queryString ? `?${queryString}` : ''}`;
  
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch orders' }));
    throw new Error(error.message || 'Failed to fetch orders');
  }

  return response.json();
}

/**
 * Get single order details
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Order details
 */
export async function getOrderDetails(orderId) {
  const response = await fetch(`${API_BASE_URL}/api/admin/orders/${orderId}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch order details' }));
    throw new Error(error.error?.message || error.message || 'Failed to fetch order details');
  }

  return response.json();
}

/**
 * Update order status
 * @param {string} orderId - Order ID
 * @param {string} status - New status (received, in_kitchen, sent_to_delivery)
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<Object>} Updated order
 */
export async function updateOrderStatus(orderId, status, csrfToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to update order status' }));
    throw new Error(error.error?.message || error.message || 'Failed to update order status');
  }

  return response.json();
}
