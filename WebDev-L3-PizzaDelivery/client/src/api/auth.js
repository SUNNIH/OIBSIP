// SUNNYS Pizza — Authentication API Client
// Communicates with backend authentication endpoints

const API_BASE = '/api/auth';

/**
 * Fetch CSRF token from the server
 * Required before making any mutating requests
 */
export async function fetchCsrfToken() {
  const response = await fetch(`${API_BASE}/csrf-token`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');

  throw new Error(
    retryAfter
      ? `Too many requests. Please try again after ${retryAfter} seconds.`
      : 'Too many requests. Please try again later.'
  );
}

if (!response.ok) {
  throw new Error(
    `Failed to fetch CSRF token (HTTP ${response.status})`
  );
}

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error('CSRF endpoint returned an invalid JSON response');
  }

  if (!data?.csrfToken) {
    throw new Error('CSRF token missing from server response');
  }

  return data.csrfToken;
}

/**
 * Register a new customer account
 * @param {string} email - User email address
 * @param {string} password - User password (min 8 characters)
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<{message: string, email: string}>}
 */
export async function register(email, password, csrfToken) {
  const response = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Registration failed');
  }

  return data;
}

/**
 * Login with email and password
 * @param {string} email - User email address
 * @param {string} password - User password
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<{message: string, user: object, csrfToken: string}>}
 */
export async function login(email, password, csrfToken) {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Login failed');
  }

  return data;
}

/**
 * Authenticate an administrator.
 * Uses the dedicated admin login endpoint.
 */
export async function adminLogin(email, password, csrfToken) {
  const response = await fetch(`${API_BASE}/admin-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Administrator login failed');
  }

  return data;
}

/**
 * Logout current user
 * @param {string} csrfToken - CSRF token
 */
export async function logout(csrfToken) {
  const response = await fetch(`${API_BASE}/logout`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Logout failed');
  }

  return response.json();
}

/**
 * Get current authenticated user
 * @returns {Promise<{user: object}>}
 */
export async function getCurrentUser() {
  const response = await fetch(`${API_BASE}/me`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      return null; // Not authenticated
    }
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch user');
  }

  const data = await response.json();
  return data.user;
}

/**
 * Verify email with token from verification link
 * @param {string} token - Verification token from email link
 * @returns {Promise<{message: string}>}
 */
export async function verifyEmail(token) {
  const response = await fetch(`${API_BASE}/verify-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ token }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Email verification failed');
  }

  return data;
}

/**
 * Request password reset email
 * @param {string} email - User email address
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<{message: string}>}
 */
export async function forgotPassword(email, csrfToken) {
  const response = await fetch(`${API_BASE}/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to send reset email');
  }

  return data;
}

/**
 * Reset password with token
 * @param {string} token - Reset token from email link
 * @param {string} password - New password
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<{message: string}>}
 */
export async function resetPassword(token, password, csrfToken) {
  const response = await fetch(`${API_BASE}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({ token, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Password reset failed');
  }

  return data;
}

/**
 * Resend verification email
 * @param {string} email - User email address
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<{message: string}>}
 */
export async function resendVerification(email, csrfToken) {
  const response = await fetch(`${API_BASE}/resend-verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to resend verification email');
  }

  return data;
}

/**
 * Update current user's profile
 * @param {Object} profileData - Profile fields to update
 * @param {string} profileData.displayName - Optional display name
 * @param {string} profileData.phoneNumber - Optional phone number
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<{message: string, user: object}>}
 */
export async function updateProfile(profileData, csrfToken) {
  const response = await fetch(`${API_BASE}/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify(profileData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to update profile');
  }

  return data;
}
