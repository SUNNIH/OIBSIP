// SUNNYS Pizza — Authentication API Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as authApi from '../api/auth.js';

describe('Authentication API', () => {
  beforeEach(() => {
    // Reset fetch mocks
    global.fetch = vi.fn();
  });

  describe('fetchCsrfToken', () => {
    it('should fetch CSRF token successfully', async () => {
      const mockToken = 'test-csrf-token-123';
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: mockToken }),
      });

      const token = await authApi.fetchCsrfToken();

      expect(token).toBe(mockToken);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/csrf-token',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
        })
      );
    });

    it('should throw error when fetch fails', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
      });

      await expect(authApi.fetchCsrfToken()).rejects.toThrow('Failed to fetch CSRF token');
    });
  });

  describe('register', () => {
    it('should register with valid credentials', async () => {
      const mockResponse = {
        message: 'Registration successful',
        email: 'test@example.com',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.register('test@example.com', 'password123', 'csrf-token');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-csrf-token': 'csrf-token',
          }),
        })
      );
    });

    it('should throw error for duplicate email', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Email already registered' }),
      });

      await expect(authApi.register('test@example.com', 'password123', 'csrf-token'))
        .rejects.toThrow('Email already registered');
    });

    it('should throw error for short password', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Password must be at least 8 characters' }),
      });

      await expect(authApi.register('test@example.com', 'short', 'csrf-token'))
        .rejects.toThrow('Password must be at least 8 characters');
    });
  });

  describe('login', () => {
    it('should login with valid credentials', async () => {
      const mockResponse = {
        message: 'Login successful',
        user: { id: '123', email: 'test@example.com', role: 'customer' },
        csrfToken: 'new-csrf-token',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.login('test@example.com', 'password123', 'csrf-token');

      expect(result).toEqual(mockResponse);
      expect(result.user.email).toBe('test@example.com');
      expect(result.csrfToken).toBe('new-csrf-token');
    });

    it('should throw error for invalid credentials', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid email or password' }),
      });

      await expect(authApi.login('wrong@example.com', 'wrongpass', 'csrf-token'))
        .rejects.toThrow('Invalid email or password');
    });

    it('should throw error for unverified email', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Please verify your email before logging in' }),
      });

      await expect(authApi.login('unverified@example.com', 'password123', 'csrf-token'))
        .rejects.toThrow('Please verify your email before logging in');
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Logout successful' }),
      });

      const result = await authApi.logout('csrf-token');

      expect(result.message).toBe('Logout successful');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'x-csrf-token': 'csrf-token',
          }),
        })
      );
    });
  });

  describe('getCurrentUser', () => {
    it('should fetch current user when authenticated', async () => {
      const mockUser = {
        _id: '123',
        email: 'test@example.com',
        role: 'customer',
        isVerified: true,
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: mockUser }),
      });

      const user = await authApi.getCurrentUser();

      expect(user).toEqual(mockUser);
    });

    it('should return null when not authenticated', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const user = await authApi.getCurrentUser();

      expect(user).toBeNull();
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      const mockResponse = {
        message: 'Email verified successfully',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.verifyEmail('valid-token-123');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/verify-email',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ token: 'valid-token-123' }),
        })
      );
    });

    it('should throw error for invalid token', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid or expired verification token' }),
      });

      await expect(authApi.verifyEmail('invalid-token'))
        .rejects.toThrow('Invalid or expired verification token');
    });

    it('should throw error for expired token', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid or expired verification token' }),
      });

      await expect(authApi.verifyEmail('expired-token'))
        .rejects.toThrow('Invalid or expired verification token');
    });

    it('should throw error for already verified email', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Email already verified' }),
      });

      await expect(authApi.verifyEmail('token-for-verified-email'))
        .rejects.toThrow('Email already verified');
    });
  });

  describe('forgotPassword', () => {
    it('should send password reset email', async () => {
      const mockResponse = {
        message: 'Password reset email sent',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.forgotPassword('test@example.com', 'csrf-token');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/forgot-password',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-csrf-token': 'csrf-token',
          }),
          body: JSON.stringify({ email: 'test@example.com' }),
        })
      );
    });

    it('should return generic message for non-existent email', async () => {
      const mockResponse = {
        message: 'If the email exists, a password reset link has been sent',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.forgotPassword('nonexistent@example.com', 'csrf-token');

      expect(result.message).toContain('If the email exists');
    });

    it('should throw error for invalid email format', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid email address' }),
      });

      await expect(authApi.forgotPassword('invalid-email', 'csrf-token'))
        .rejects.toThrow('Invalid email address');
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const mockResponse = {
        message: 'Password reset successful',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.resetPassword('valid-token', 'newpassword123', 'csrf-token');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/reset-password',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-csrf-token': 'csrf-token',
          }),
          body: JSON.stringify({ token: 'valid-token', password: 'newpassword123' }),
        })
      );
    });

    it('should throw error for invalid or expired token', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid or expired reset token' }),
      });

      await expect(authApi.resetPassword('invalid-token', 'newpassword123', 'csrf-token'))
        .rejects.toThrow('Invalid or expired reset token');
    });

    it('should throw error for short password', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Password must be at least 8 characters' }),
      });

      await expect(authApi.resetPassword('valid-token', 'short', 'csrf-token'))
        .rejects.toThrow('Password must be at least 8 characters');
    });
  });

  describe('resendVerification', () => {
    it('should resend verification email', async () => {
      const mockResponse = {
        message: 'Verification email sent',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.resendVerification('test@example.com', 'csrf-token');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/resend-verification',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-csrf-token': 'csrf-token',
          }),
          body: JSON.stringify({ email: 'test@example.com' }),
        })
      );
    });

    it('should return generic message for non-existent email', async () => {
      const mockResponse = {
        message: 'If the email exists, a verification link has been sent',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await authApi.resendVerification('nonexistent@example.com', 'csrf-token');

      expect(result.message).toContain('If the email exists');
    });

    it('should throw error for already verified email', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Email already verified' }),
      });

      await expect(authApi.resendVerification('verified@example.com', 'csrf-token'))
        .rejects.toThrow('Email already verified');
    });
  });
});
