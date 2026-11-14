/**
 * @file catalogue.api.test.js
 * @description Unit tests for catalogue API functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPizzas, getIngredients, formatPrice } from '../api/catalogue.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('Catalogue API', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('getPizzas', () => {
    it('should fetch pizzas successfully', async () => {
      const mockPizzas = [
        {
          _id: '1',
          name: 'Margherita',
          description: 'Classic cheese pizza',
          category: 'vegetarian',
          pricePaise: 29900,
          available: true,
          ingredients: {
            base: { _id: 'b1', name: 'Thin Crust' },
            sauce: { _id: 's1', name: 'Tomato' },
            cheese: { _id: 'c1', name: 'Mozzarella' },
            vegetables: []
          }
        }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPizzas // Backend returns array directly
      });

      const result = await getPizzas();

      expect(fetch).toHaveBeenCalledWith('/api/v1/pizzas', {
        method: 'GET',
        credentials: 'include'
      });
      expect(result).toEqual(mockPizzas);
    });

    it('should throw error when response is not ok', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Authentication required' })
      });

      await expect(getPizzas()).rejects.toThrow('Authentication required');
    });

    it('should throw generic error when no message provided', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({})
      });

      await expect(getPizzas()).rejects.toThrow('Failed to fetch pizzas');
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network failure'));

      await expect(getPizzas()).rejects.toThrow('Network failure');
    });
  });

  describe('getIngredients', () => {
    it('should fetch ingredients successfully', async () => {
      const mockIngredients = {
        base: [],
        sauce: [],
        cheese: [
          {
            id: 'i1',
            name: 'Mozzarella',
            category: 'cheese',
            pricePaise: 5000,
            inStock: true
          }
        ],
        vegetable: []
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockIngredients // Backend returns grouped object directly
      });

      const result = await getIngredients();

      expect(fetch).toHaveBeenCalledWith('/api/v1/ingredients', {
        method: 'GET',
        credentials: 'include'
      });
      expect(result).toEqual(mockIngredients);
    });

    it('should throw error when response is not ok', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Access denied' })
      });

      await expect(getIngredients()).rejects.toThrow('Access denied');
    });

    it('should throw generic error when no message provided', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({})
      });

      await expect(getIngredients()).rejects.toThrow('Failed to fetch ingredients');
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Connection timeout'));

      await expect(getIngredients()).rejects.toThrow('Connection timeout');
    });
  });

  describe('formatPrice', () => {
    it('should convert paise to rupees with ₹ symbol', () => {
      expect(formatPrice(29900)).toBe('₹299');
    });

    it('should handle zero price', () => {
      expect(formatPrice(0)).toBe('₹0');
    });

    it('should preserve two decimal places for fractional rupees', () => {
      expect(formatPrice(29950)).toBe('₹299.50');
    });

    it('should handle large prices', () => {
      expect(formatPrice(999900)).toBe('₹9999');
    });

    it('should handle single digit rupee amounts', () => {
      expect(formatPrice(500)).toBe('₹5');
    });

    it('should show two decimal places when needed', () => {
      expect(formatPrice(12345)).toBe('₹123.45');
    });

    it('should show one decimal with trailing zero', () => {
      expect(formatPrice(14990)).toBe('₹149.90');
    });

    it('should not add trailing zeros for whole rupees', () => {
      expect(formatPrice(10000)).toBe('₹100');
    });
  });
});
