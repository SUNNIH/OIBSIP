// SUNNYS Pizza — Authentication Hook
// Manages authentication state and CSRF tokens

import { useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth.js';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch CSRF token on mount
  useEffect(() => {
    async function initCsrf() {
      try {
        const token = await authApi.fetchCsrfToken();
        setCsrfToken(token);
      } catch (err) {
        console.error('Failed to fetch CSRF token:', err);
        setError('Failed to initialize security token');
      }
    }
    initCsrf();
  }, []);

  // Check if user is already authenticated on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
      } catch (err) {
        // Not authenticated or session expired
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  // Refresh CSRF token after authentication operations
  const refreshCsrfToken = useCallback(async () => {
    try {
      const token = await authApi.fetchCsrfToken();
      setCsrfToken(token);
      return token;
    } catch (err) {
      console.error('Failed to refresh CSRF token:', err);
      throw err;
    }
  }, []);

  const handleRegister = useCallback(async (email, password) => {
  setLoading(true);
  setError('');

  try {
    // Obtain a fresh CSRF token before registration
    const freshToken = await authApi.fetchCsrfToken();

    setCsrfToken(freshToken);

    // Submit registration using the fresh token
    const result = await authApi.register(
      email,
      password,
      freshToken
    );

    // Do not make registration success depend
    // on an additional CSRF refresh request.
    return result;

  } catch (err) {
    setError(err.message);
    throw err;

  } finally {
    setLoading(false);
  }
}, []);

  const handleLogin = useCallback(async (email, password) => {
  setLoading(true);
  setError('');

  try {
    // Fetch fresh CSRF token before login
    const freshToken = await authApi.fetchCsrfToken();

    const result = await authApi.login(
      email,
      password,
      freshToken
    );

    // Prefer the complete user profile after successful login
let signedInUser = result.user;

try {
  const currentUser = await authApi.getCurrentUser();

  if (currentUser) {
    signedInUser = currentUser;
  }
} catch (err) {
  console.warn('Could not refresh profile after login:', err);
}

// Update authentication state
setUser(signedInUser);

// Use the token returned by the backend
setCsrfToken(result.csrfToken);

return result;

  } catch (err) {
    setError(err.message);
    throw err;

  } finally {
    setLoading(false);
  }
}, []);


const handleAdminLogin = useCallback(async (email, password) => {
  setLoading(true);
  setError('');

  try {
    // Obtain a fresh CSRF token
    const freshToken = await authApi.fetchCsrfToken();

    setCsrfToken(freshToken);

    // Authenticate using the admin endpoint
    const result = await authApi.adminLogin(
      email,
      password,
      freshToken
    );

    // Load the complete admin profile
    let signedInUser = result.user;

    try {
      const currentUser = await authApi.getCurrentUser();

      if (currentUser) {
        signedInUser = currentUser;
      }
    } catch (err) {
      console.warn('Could not refresh admin profile:', err);
    }

    // Update authentication state
    setUser(signedInUser);
    setCsrfToken(result.csrfToken);

    return result;

  } catch (err) {
    setError(err.message);
    throw err;

  } finally {
    setLoading(false);
  }
}, []);

  const handleLogout = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      await authApi.logout(csrfToken);
      setUser(null);
      
      // Refresh CSRF token after logout
      await refreshCsrfToken();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [csrfToken, refreshCsrfToken]);

  // Update authenticated user state after profile changes
  const refreshUser = useCallback(async () => {
  const updatedUser = await authApi.getCurrentUser();

  if (!updatedUser) {
    throw new Error('Session expired. Please sign in again.');
  }

  setUser(updatedUser);

  return updatedUser;
}, []);

  return {
  user,
  loading,
  error,
  csrfToken,
  register: handleRegister,
  login: handleLogin,
  adminLogin: handleAdminLogin,
  logout: handleLogout,
  refreshUser,
  isAuthenticated: !!user,
};
}
