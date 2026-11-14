/**
 * SUNNYS Pizza — Vegan Pizza Database Seeder
 *
 * File: server/src/scripts/seedVeganPizzas.js
 *
 * Usage (from the server directory):
 *
 * Dry run:
 * node src/scripts/seedVeganPizzas.js
 *
 * Apply changes:
 * node src/scripts/seedVeganPizzas.js --apply
 *
 * SAFETY:
 * - Does not delete existing records.
 * - Does not reset existing inventory.
 * - Does not overwrite existing pizzas.
 * - Checks ingredients before creating pizzas.
 * - Prevents duplicate pizza creation.
 * - Supports repeated execution.
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import Ingredient from '../models/Ingredient.js';
import Pizza from '../models/Pizza.js';


// ==========================================
// CONFIGURATION
// ==========================================

const apply = process.argv.includes('--apply');

const unsupportedArgs = process.argv.slice(2).filter(
  arg => arg !== '--apply'
);

if (unsupportedArgs.length > 0) {
  throw new Error(
    'Unsupported argument. Use no arguments or --apply.'
  );
}


// ==========================================
// NEW VEGAN INGREDIENT
// ==========================================

const veganCheese = {
  name: 'Vegan Mozzarella',
  category: 'cheese',

  // ₹180
  pricePaise: 18000,

  stock: 1000,
  reserved: 0,
  lowStockThreshold: 50,
  isActive: true,
};


// ==========================================
// VEGAN PIZZA RECIPES
// ==========================================

const recipes = [

  // Pizza 1
  {
    name: 'Vegan Garden',

    description:
      'Tomato sauce, plant-based mozzarella, mushrooms, and spinach on thin crust.',

    category: 'vegan',

    base: 'Thin Crust',

    sauce: 'Classic Tomato',

    cheese: 'Vegan Mozzarella',

    vegetables: [
      'Mushrooms',
      'Spinach'
    ],

    // ₹560
    expectedPricePaise: 56000,
  },


  // Pizza 2
  {
    name: 'Spicy Vegan Delight',

    description:
      'Spicy marinara, plant-based mozzarella, jalapeños, onions, and bell peppers on whole wheat.',

    category: 'vegan',

    base: 'Whole Wheat',

    sauce: 'Spicy Marinara',

    cheese: 'Vegan Mozzarella',

    vegetables: [
      'Jalapeños',
      'Onions',
      'Bell Peppers'
    ],

    // ₹625
    expectedPricePaise: 62500,
  },


  // Pizza 3
  {
    name: 'Vegan Mediterranean',

    description:
      'Tomato sauce, plant-based mozzarella, olives, tomatoes, and spinach on thin crust.',

    category: 'vegan',

    base: 'Thin Crust',

    sauce: 'Classic Tomato',

    cheese: 'Vegan Mozzarella',

    vegetables: [
      'Olives',
      'Tomatoes',
      'Spinach'
    ],

    // ₹630
    expectedPricePaise: 63000,
  },

];


// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Collect all required ingredient names
const ingredientNames = [
  ...new Set(
    recipes.flatMap(pizza => [
      pizza.base,
      pizza.sauce,
      pizza.cheese,
      ...pizza.vegetables
    ])
  )
];


// Convert MongoDB ObjectId to string
function objectIdString(value) {
  return (value?._id || value)?.toString();
}


// Convert ingredient names into MongoDB IDs
function recipeIds(recipe, ingredientByName) {

  const findId = name =>
    ingredientByName.get(name)?._id;

  return {
    base: findId(recipe.base),

    sauce: findId(recipe.sauce),

    cheese: findId(recipe.cheese),

    vegetables: recipe.vegetables.map(findId)
  };
}


// Verify existing pizzas without overwriting
function verifyExistingPizza(existing, desired) {

  if (existing.category !== desired.category) {
    throw new Error(
      `Existing pizza '${existing.name}' has a different category.`
    );
  }

  const saved = existing.ingredients || {};

  for (const field of [
    'base',
    'sauce',
    'cheese'
  ]) {

    if (
      objectIdString(saved[field]) !==
      objectIdString(desired[field])
    ) {
      throw new Error(
        `Existing pizza '${existing.name}' has a different ${field}.`
      );
    }
  }

  const savedVegetables = (
    saved.vegetables || []
  )
    .map(objectIdString)
    .sort();

  const wantedVegetables = desired.vegetables
    .map(objectIdString)
    .sort();

  if (
    JSON.stringify(savedVegetables) !==
    JSON.stringify(wantedVegetables)
  ) {
    throw new Error(
      `Existing pizza '${existing.name}' has different toppings.`
    );
  }

  if (!existing.isActive) {
    console.warn(
      `Pizza '${existing.name}' already exists but is inactive.`
    );
  }
}


// ==========================================
// DATABASE SEED FUNCTION
// ==========================================

async function main() {

  console.log('\n================================');
  console.log('SUNNYS PIZZA — VEGAN SEEDER');
  console.log('================================\n');

  console.log(
    `Mode: ${apply ? 'APPLY' : 'DRY RUN'}`
  );

  // Connect to existing MongoDB database
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  console.log('MongoDB connected successfully.\n');


  // ========================================
  // FETCH EXISTING RECORDS
  // ========================================

  const [
    foundIngredients,
    foundPizzas
  ] = await Promise.all([

    Ingredient.find({
      name: {
        $in: ingredientNames
      }
    }),

    Pizza.find({
      name: {
        $in: recipes.map(pizza => pizza.name)
      }
    })

  ]);


  const byName = new Map(
    foundIngredients.map(ingredient => [
      ingredient.name,
      ingredient
    ])
  );


  const existingPizzaByName = new Map(
    foundPizzas.map(pizza => [
      pizza.name,
      pizza
    ])
  );


  // ========================================
  // CHECK VEGAN MOZZARELLA
  // ========================================

  const currentCheese = byName.get(
    veganCheese.name
  );


  if (currentCheese) {

    if (
      currentCheese.category !== 'cheese' ||
      currentCheese.pricePaise !==
        veganCheese.pricePaise ||
      !currentCheese.isActive
    ) {

      throw new Error(
        'Existing Vegan Mozzarella has different category, price, or status. Review manually.'
      );
    }
  }


  // ========================================
  // VALIDATE ALL RECIPES
  // ========================================

  for (const recipe of recipes) {

    console.log(
      `Checking: ${recipe.name}`
    );


    const requiredIngredients = [

      [recipe.base, 'base'],

      [recipe.sauce, 'sauce'],

      [recipe.cheese, 'cheese'],

      ...recipe.vegetables.map(name => [
        name,
        'vegetable'
      ])

    ];


    // Validate every ingredient
    for (const [
      name,
      category
    ] of requiredIngredients) {

      if (
        name === veganCheese.name &&
        !currentCheese
      ) {
        continue;
      }


      const ingredient = byName.get(name);


      if (!ingredient) {

        throw new Error(
          `Required ingredient missing: '${name}'`
        );
      }


      if (ingredient.category !== category) {

        throw new Error(
          `Incorrect category for '${name}'. Expected '${category}'.`
        );
      }


      if (
        !ingredient.isActive ||
        ingredient.stock - ingredient.reserved <= 0
      ) {

        throw new Error(
          `Ingredient '${name}' is inactive or unavailable.`
        );
      }
    }


    // ======================================
    // CALCULATE EXPECTED PRICE
    // ======================================

    const pricePaise = [

      recipe.base,
      recipe.sauce,
      recipe.cheese,
      ...recipe.vegetables

    ].reduce((sum, name) => {

      if (
        name === veganCheese.name &&
        !currentCheese
      ) {

        return sum + veganCheese.pricePaise;
      }

      return sum + byName.get(name).pricePaise;

    }, 0);


    // Validate calculated price
    if (
      pricePaise !== recipe.expectedPricePaise
    ) {

      throw new Error(
        `${recipe.name}: calculated price ₹${(
          pricePaise / 100
        ).toFixed(2)} does not match expected ₹${(
          recipe.expectedPricePaise / 100
        ).toFixed(2)}`
      );
    }


    // ======================================
    // CHECK FOR EXISTING PIZZA
    // ======================================

    const existing = existingPizzaByName.get(
      recipe.name
    );


    if (existing) {

      if (!currentCheese) {

        throw new Error(
          `Pizza '${recipe.name}' exists but Vegan Mozzarella is missing.`
        );
      }


      verifyExistingPizza(existing, {

        ...recipeIds(recipe, byName),

        category: recipe.category

      });
    }


    console.log(
      `${existing ? 'SKIP' : 'CREATE'}: ${recipe.name}`
    );

    console.log(
      `Price: ₹${(pricePaise / 100).toFixed(2)}\n`
    );
  }


  console.log(
    `${currentCheese ? 'SKIP' : 'CREATE'} ingredient: Vegan Mozzarella`
  );


  // ========================================
  // DRY RUN
  // ========================================

  if (!apply) {

    console.log('\n================================');

    console.log('DRY RUN COMPLETE');

    console.log('No database records were modified.');

    console.log('Run with --apply to insert records.');

    console.log('================================\n');

    return;
  }


  // ========================================
  // CREATE VEGAN MOZZARELLA
  // ========================================

  if (!currentCheese) {

    const cheese = await Ingredient.create(
      veganCheese
    );

    byName.set(
      veganCheese.name,
      cheese
    );

    console.log(
      `Created ingredient: ${cheese.name}`
    );

  } else {

    console.log(
      'Vegan Mozzarella already exists. Skipping.'
    );
  }


  // ========================================
  // CREATE VEGAN PIZZAS
  // ========================================

  for (const recipe of recipes) {

    // Do not duplicate existing pizzas
    if (
      existingPizzaByName.has(recipe.name)
    ) {

      console.log(
        `Skipping existing pizza: ${recipe.name}`
      );

      continue;
    }


    const pizza = await Pizza.create({

      name: recipe.name,

      description: recipe.description,

      category: recipe.category,

      ingredients: recipeIds(
        recipe,
        byName
      ),

      isActive: true

    });


    // ======================================
    // VERIFY PRICE
    // ======================================

    const actualPrice = await pizza.calculatePrice();


    if (
      actualPrice !== recipe.expectedPricePaise
    ) {

      throw new Error(
        `Price verification failed for ${recipe.name}`
      );
    }


    // ======================================
    // VERIFY AVAILABILITY
    // ======================================

    const availability = await pizza.checkAvailability(1);


    if (!availability.available) {

      throw new Error(
        `Availability verification failed for ${recipe.name}`
      );
    }


    console.log(
      `Created: ${pizza.name}`
    );

    console.log(
      `Price: ₹${(
        actualPrice / 100
      ).toFixed(2)}`
    );

    console.log(
      `Available: ${availability.available}\n`
    );
  }


  // ========================================
  // COMPLETION
  // ========================================

  console.log('\n================================');

  console.log('VEGAN PIZZA SEEDING COMPLETE');

  console.log('Existing Vegetarian pizzas preserved.');

  console.log('================================\n');

}


// ==========================================
// EXECUTION
// ==========================================

try {

  await main();

} catch (error) {

  console.error(
    `\nSeed stopped: ${error.message}`
  );

  process.exitCode = 1;

} finally {

  await mongoose.disconnect();

}