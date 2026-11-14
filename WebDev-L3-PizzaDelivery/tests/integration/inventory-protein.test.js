import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import {
  calculateIngredientQuantities
} from '../../server/src/services/inventoryReservation.js';

describe('Protein Inventory Quantity Calculation', () => {

  const createId = () =>
    new mongoose.Types.ObjectId();

  const snapshot = (ingredientId) => ({
    ingredientId,
    name: 'Test Ingredient',
    pricePaise: 10000
  });

  it('should calculate protein quantities across multiple pizzas', () => {

    const base = createId();
    const sauce = createId();
    const cheese = createId();
    const onions = createId();
    const chicken = createId();
    const pepperoni = createId();

    const items = [
      {
        quantity: 2,

        base: snapshot(base),
        sauce: snapshot(sauce),
        cheese: snapshot(cheese),

        vegetables: [snapshot(onions)],

        proteins: [
          snapshot(chicken),
          snapshot(pepperoni)
        ]
      },
      {
        quantity: 1,

        base: snapshot(base),
        sauce: snapshot(sauce),
        cheese: snapshot(cheese),

        vegetables: [],

        proteins: [snapshot(chicken)]
      }
    ];

    const quantities =
      calculateIngredientQuantities(items);

    expect(quantities[base.toString()]).toBe(3);
    expect(quantities[sauce.toString()]).toBe(3);
    expect(quantities[cheese.toString()]).toBe(3);

    expect(quantities[onions.toString()]).toBe(2);

    // Chicken: 2 + 1 = 3 portions
    expect(quantities[chicken.toString()]).toBe(3);

    // Pepperoni: 2 portions
    expect(quantities[pepperoni.toString()]).toBe(2);
  });

  it('should support vegetarian pizzas without proteins', () => {

    const base = createId();
    const sauce = createId();
    const cheese = createId();

    const items = [{
      quantity: 2,

      base: snapshot(base),
      sauce: snapshot(sauce),
      cheese: snapshot(cheese),

      vegetables: []
    }];

    const quantities =
      calculateIngredientQuantities(items);

    expect(quantities[base.toString()]).toBe(2);
    expect(quantities[sauce.toString()]).toBe(2);
    expect(quantities[cheese.toString()]).toBe(2);

    expect(Object.keys(quantities)).toHaveLength(3);
  });

  it('should reject duplicate proteins in one pizza', () => {

    const chicken = createId();

    const items = [{
      quantity: 1,

      base: snapshot(createId()),
      sauce: snapshot(createId()),
      cheese: snapshot(createId()),

      vegetables: [],

      proteins: [
        snapshot(chicken),
        snapshot(chicken)
      ]
    }];

    expect(() =>
      calculateIngredientQuantities(items)
    ).toThrow(
      /Duplicate ingredient in pizza configuration/
    );
  });

  it('should reject invalid protein arrays', () => {

    const items = [{
      quantity: 1,

      base: snapshot(createId()),
      sauce: snapshot(createId()),
      cheese: snapshot(createId()),

      vegetables: [],

      proteins: 'Chicken'
    }];

    expect(() =>
      calculateIngredientQuantities(items)
    ).toThrow(/Proteins must be an array/);
  });

});