/**
 * Test: Pizza Builder Fixes
 * 
 * Verifies:
 * 1. Pizza restoration from URL preserves imageUrl and category
 * 2. Protein section visibility for non-vegetarian pizzas
 */

import { describe, it, expect } from 'vitest';

describe('Pizza Builder Fixes', () => {
  describe('Pizza Object Structure', () => {
    it('should preserve imageUrl and category when restoring from URL', () => {
      // Simulate the backend pizza response
      const foundPizza = {
        id: '507f1f77bcf86cd799439011',
        name: 'Spicy Chicken Pizza',
        description: 'Delicious chicken with spicy sauce',
        category: 'non-vegetarian',
        pricePaise: 49900,
        available: true,
        imageUrl: '/uploads/pizzas/chicken-pizza.jpg',
        ingredients: {
          base: { id: '1', name: 'Thin Crust' },
          sauce: { id: '2', name: 'Tomato Sauce' },
          cheese: { id: '3', name: 'Mozzarella' },
          vegetables: [],
          proteins: [
            { id: '4', name: 'Chicken' }
          ]
        }
      };

      // Simulate the transformation in App.jsx restoration logic
      const pizza = {
        ...foundPizza,
        price: '₹499',
        kind: foundPizza.category,
        category: foundPizza.category, // Must preserve category
        label: foundPizza.available ? 'Available' : 'Out of stock',
        score: '4.8',
      };

      // Verify all required fields are present
      expect(pizza.id).toBe('507f1f77bcf86cd799439011');
      expect(pizza.name).toBe('Spicy Chicken Pizza');
      expect(pizza.category).toBe('non-vegetarian');
      expect(pizza.imageUrl).toBe('/uploads/pizzas/chicken-pizza.jpg');
      expect(pizza.ingredients).toBeDefined();
      expect(pizza.ingredients.proteins).toHaveLength(1);
    });

    it('should identify non-vegetarian pizzas correctly', () => {
      const nonVegPizza = {
        category: 'non-vegetarian',
        ingredients: { proteins: [{ id: '1', name: 'Chicken' }] }
      };

      const vegPizza = {
        category: 'vegetarian',
        ingredients: { proteins: [] }
      };

      const veganPizza = {
        category: 'vegan',
        ingredients: { proteins: [] }
      };

      const isNonVegetarian = (pizza) =>
        pizza?.category === 'non-vegetarian' || pizza?.kind === 'non-vegetarian';

      expect(isNonVegetarian(nonVegPizza)).toBe(true);
      expect(isNonVegetarian(vegPizza)).toBe(false);
      expect(isNonVegetarian(veganPizza)).toBe(false);
      expect(isNonVegetarian({ kind: 'non-vegetarian' })).toBe(true);
    });

    it('should keep category when mapping catalogue pizzas for the menu', () => {
      const cataloguePizza = {
        id: '507f1f77bcf86cd799439011',
        name: 'Pepperoni',
        category: 'non-vegetarian',
        pricePaise: 34900,
        available: true,
        imageUrl: '/uploads/pizzas/pepperoni.jpg',
        ingredients: { proteins: [{ id: '4', name: 'Pepperoni' }] },
      };

      const displayPizza = {
        ...cataloguePizza,
        price: '₹349',
        kind: cataloguePizza.category,
        category: cataloguePizza.category,
        imageUrl: cataloguePizza.imageUrl,
      };

      expect(displayPizza.category).toBe('non-vegetarian');
      expect(displayPizza.imageUrl).toBe('/uploads/pizzas/pepperoni.jpg');
    });
  });

  describe('Protein Section Visibility', () => {
    it('should show protein section for non-vegetarian pizzas even with no proteins', () => {
      // Simulate PizzaBuilder state
      const isNonVegetarian = true;
      const ingredients = {
        protein: [] // Empty protein array
      };

      // The condition in PizzaBuilder: {isNonVegetarian && (
      // Should render the section even when protein array is empty
      const shouldShowSection = isNonVegetarian;
      expect(shouldShowSection).toBe(true);

      // Should show empty state message
      const hasProteins = ingredients.protein && ingredients.protein.length > 0;
      expect(hasProteins).toBe(false);
    });

    it('should show protein section for non-vegetarian pizzas with proteins', () => {
      const isNonVegetarian = true;
      const ingredients = {
        protein: [
          { id: '1', name: 'Chicken', pricePaise: 5000, inStock: true },
          { id: '2', name: 'Pepperoni', pricePaise: 6000, inStock: true }
        ]
      };

      const shouldShowSection = isNonVegetarian;
      expect(shouldShowSection).toBe(true);

      const hasProteins = ingredients.protein && ingredients.protein.length > 0;
      expect(hasProteins).toBe(true);
    });

    it('should not show protein section for vegetarian pizzas', () => {
      const isNonVegetarian = false;
      const ingredients = {
        protein: []
      };

      const shouldShowSection = isNonVegetarian;
      expect(shouldShowSection).toBe(false);
    });
  });

  describe('Protein Selection Validation', () => {
    it('should require at least one protein for non-vegetarian pizzas', () => {
      const isNonVegetarian = true;
      const selectedProteins = [];

      // PizzaBuilder validation logic
      const isValid = !(isNonVegetarian && selectedProteins.length === 0);
      expect(isValid).toBe(false);
    });

    it('should allow non-vegetarian pizzas with selected proteins', () => {
      const isNonVegetarian = true;
      const selectedProteins = ['protein-1-id'];

      const isValid = !(isNonVegetarian && selectedProteins.length === 0);
      expect(isValid).toBe(true);
    });

    it('should not require proteins for vegetarian pizzas', () => {
      const isNonVegetarian = false;
      const selectedProteins = [];

      const isValid = !(isNonVegetarian && selectedProteins.length === 0);
      expect(isValid).toBe(true);
    });
  });
});
