/**
 * SUNNYS Pizza
 * Non-Vegetarian Pizza Database Seeder
 *
 * Adds:
 * - Chicken
 * - Pepperoni
 * - Sausage
 *
 * Creates:
 * - BBQ Chicken Supreme
 * - Pepperoni Classic
 * - Meat Lovers Special
 *
 * SAFETY:
 * - Dry run by default
 * - Requires --apply to write
 * - Development database only
 * - Local MongoDB only
 * - Does not delete existing data
 * - Does not reset inventory
 * - Does not overwrite ingredient prices
 * - Skips existing matching records
 * - Rejects conflicting pizza recipes
 *
 * Usage from server directory:
 *
 * node src/scripts/seedNonVegetarianPizzas.js
 *
 * node src/scripts/seedNonVegetarianPizzas.js --apply
 */

import mongoose from 'mongoose';

import env from '../config/env.js';

import Ingredient from '../models/Ingredient.js';

import Pizza from '../models/Pizza.js';


// =====================================================
// 1. COMMAND-LINE OPTIONS
// =====================================================

const args = process.argv.slice(2);

if (
  args.length > 1 ||
  (args.length === 1 && args[0] !== '--apply')
) {
  throw new Error(
    'Usage: node src/scripts/seedNonVegetarianPizzas.js [--apply]'
  );
}

const apply = args.includes('--apply');


// =====================================================
// 2. PROTEIN INGREDIENT DEFINITIONS
// =====================================================

// Prices are stored in paise.
// 100 paise = ₹1.
//
// These are development prices and initial stock values.

const newProteins = [

  {
    name: 'Chicken',
    category: 'protein',
    pricePaise: 20000,
    stock: 1000,
    reserved: 0,
    lowStockThreshold: 50,
    isActive: true
  },

  {
    name: 'Pepperoni',
    category: 'protein',
    pricePaise: 18000,
    stock: 1000,
    reserved: 0,
    lowStockThreshold: 50,
    isActive: true
  },

  {
    name: 'Sausage',
    category: 'protein',
    pricePaise: 17000,
    stock: 1000,
    reserved: 0,
    lowStockThreshold: 50,
    isActive: true
  }

];


// =====================================================
// 3. NON-VEGETARIAN PIZZA RECIPES
// =====================================================

const recipes = [

  {
    name: 'BBQ Chicken Supreme',

    description:
      'Chicken, onions and bell peppers with BBQ sauce and mozzarella on thick crust.',

    base: 'Thick Crust',

    sauce: 'BBQ',

    cheese: 'Mozzarella',

    vegetables: [
      'Onions',
      'Bell Peppers'
    ],

    proteins: [
      'Chicken'
    ]
  },

  {
    name: 'Pepperoni Classic',

    description:
      'Pepperoni, classic tomato sauce and mozzarella on thin crust.',

    base: 'Thin Crust',

    sauce: 'Classic Tomato',

    cheese: 'Mozzarella',

    vegetables: [],

    proteins: [
      'Pepperoni'
    ]
  },

  {
    name: 'Meat Lovers Special',

    description:
      'Chicken, pepperoni and sausage with onions, tomato sauce and mozzarella on thick crust.',

    base: 'Thick Crust',

    sauce: 'Classic Tomato',

    cheese: 'Mozzarella',

    vegetables: [
      'Onions'
    ],

    proteins: [
      'Chicken',
      'Pepperoni',
      'Sausage'
    ]
  }

];


// =====================================================
// 4. DATABASE SAFETY VALIDATION
// =====================================================

function approvedTarget(uri) {

  const mode = process.env.NODE_ENV || env.NODE_ENV;

  // Never seed a production database.
  if (
    mode !== 'development' ||
    env.NODE_ENV !== 'development'
  ) {
    throw new Error(
      'SEED BLOCKED: development environment only'
    );
  }

  let target;

  try {
    target = new URL(uri);
  } catch {
    throw new Error(
      'SEED BLOCKED: invalid database URI'
    );
  }

  // Only permit a single local MongoDB instance.
  const allowedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]'
  ]);

  if (
    target.protocol !== 'mongodb:' ||
    target.host.includes(',') ||
    !allowedHosts.has(target.hostname.toLowerCase()) ||
    [...target.searchParams.keys()].some(
      key => key.toLowerCase() === 'dbname'
    )
  ) {
    throw new Error(
      'SEED BLOCKED: single local MongoDB host required'
    );
  }

  let dbName;

  try {
    dbName = decodeURIComponent(
      target.pathname.slice(1)
    );
  } catch {
    throw new Error(
      'SEED BLOCKED: invalid database name'
    );
  }

  const approvedName =
    process.env.SEED_DB_NAME?.trim();

  const reservedNames = new Set([
    'test',
    'admin',
    'local',
    'config',
    'prod',
    'production'
  ]);

  if (
    !approvedName ||
    !/^[a-zA-Z0-9_.-]+$/.test(approvedName) ||
    dbName !== approvedName ||
    reservedNames.has(approvedName.toLowerCase())
  ) {
    throw new Error(
      'SEED BLOCKED: SEED_DB_NAME must match the approved local database'
    );
  }

  return {
    dbName,
    port: Number(target.port || 27017),
    allowedHosts
  };

}


// =====================================================
// 5. HELPER FUNCTIONS
// =====================================================

// Collect every ingredient required by a pizza.

function nameCategories(recipe) {

  return [

    [recipe.base, 'base'],

    [recipe.sauce, 'sauce'],

    [recipe.cheese, 'cheese'],

    ...recipe.vegetables.map(
      name => [name, 'vegetable']
    ),

    ...recipe.proteins.map(
      name => [name, 'protein']
    )

  ];

}


// Convert a Mongoose document or ObjectId into a string.

function getId(value) {

  return (value?._id || value)?.toString();

}


// =====================================================
// 6. MAIN SEEDING FUNCTION
// =====================================================

async function main() {

  const uri = env.MONGODB_URI;

  // Validate database target before connecting.
  const approved = approvedTarget(uri);

  console.log('\n====================================');
  console.log('SUNNYS PIZZA - NON-VEGETARIAN SEED');
  console.log('====================================\n');

  console.log(
    `Mode: ${apply ? 'APPLY' : 'DRY RUN'}`
  );

  console.log(
    `Database: ${approved.dbName}\n`
  );


  // ---------------------------------------------------
  // CONNECT TO MONGODB
  // ---------------------------------------------------

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000
  });

  const connection = mongoose.connection;

  // Verify the actual connected database.
  if (
    connection.readyState !== 1 ||
    !approved.allowedHosts.has(
      connection.host?.toLowerCase()
    ) ||
    Number(connection.port || 27017) !== approved.port ||
    connection.db?.databaseName !== approved.dbName
  ) {
    throw new Error(
      'SEED BLOCKED: active database connection does not match approved target'
    );
  }

  console.log('MongoDB connection verified.\n');


  // ---------------------------------------------------
  // FETCH EXISTING INGREDIENTS AND PIZZAS
  // ---------------------------------------------------

  const proposed = new Map(
    newProteins.map(
      protein => [protein.name, protein]
    )
  );

  const ingredientNames = [

    ...new Set(

      recipes.flatMap(
        recipe =>
          nameCategories(recipe).map(
            ([name]) => name
          )
      )

    )

  ];

  const [
    existingIngredients,
    existingPizzas
  ] = await Promise.all([

    Ingredient.find({
      name: {
        $in: ingredientNames
      }
    }),

    Pizza.find({
      name: {
        $in: recipes.map(
          recipe => recipe.name
        )
      }
    })

  ]);


  // Create lookup maps.

  const byName = new Map(

    existingIngredients.map(
      ingredient => [
        ingredient.name,
        ingredient
      ]
    )

  );

  const existingPizzaMap = new Map(

    existingPizzas.map(
      pizza => [
        pizza.name,
        pizza
      ]
    )

  );


  // ---------------------------------------------------
  // VALIDATE REQUIRED INGREDIENTS
  // ---------------------------------------------------

  function required(name, category) {

    const ingredient =
      byName.get(name) ||
      proposed.get(name);

    if (!ingredient) {

      throw new Error(
        `Missing required ${category}: ${name}`
      );

    }

    if (ingredient.category !== category) {

      throw new Error(
        `${name}: expected ${category}, found ${ingredient.category}`
      );

    }

    if (
      !ingredient.isActive ||
      ingredient.stock - ingredient.reserved < 1
    ) {

      throw new Error(
        `${name} is inactive or out of stock`
      );

    }

    return ingredient;

  }


  // ---------------------------------------------------
  // PREFLIGHT VALIDATE ALL PIZZAS
  // ---------------------------------------------------

  console.log('Checking pizza recipes...\n');

  for (const recipe of recipes) {

    const recipeIngredients =
      nameCategories(recipe);

    // Reject duplicate ingredient names.
    const selectedNames =
      recipeIngredients.map(
        ([name]) => name
      );

    if (
      new Set(selectedNames).size !==
      selectedNames.length
    ) {

      throw new Error(
        `Duplicate ingredient in ${recipe.name}`
      );

    }


    // Validate every selected ingredient.
    const components =
      recipeIngredients.map(
        ([name, category]) =>
          required(name, category)
      );


    // Calculate price from database ingredients.
    const pricePaise =
      components.reduce(
        (sum, ingredient) =>
          sum + ingredient.pricePaise,
        0
      );


    if (!Number.isSafeInteger(pricePaise)) {

      throw new Error(
        `Invalid price for ${recipe.name}`
      );

    }


    // -------------------------------------------------
    // CHECK EXISTING PIZZA FOR RECIPE CONFLICTS
    // -------------------------------------------------

    const existing =
      existingPizzaMap.get(recipe.name);

    if (existing) {

      if (
        !existing.isActive ||
        existing.category !== 'non-vegetarian'
      ) {

        throw new Error(
          `Existing ${recipe.name} is inactive or has conflicting category`
        );

      }


      // Compare base, sauce, and cheese.
      for (
        const field of [
          'base',
          'sauce',
          'cheese'
        ]
      ) {

        const existingId =
          getId(
            existing.ingredients[field]
          );

        const expectedId =
          getId(
            byName.get(recipe[field])
          );

        if (existingId !== expectedId) {

          throw new Error(
            `Existing ${recipe.name} has different ${field}`
          );

        }

      }


      // Compare vegetable and protein toppings.
      for (
        const field of [
          'vegetables',
          'proteins'
        ]
      ) {

        const savedIds = (
          existing.ingredients[field] || []
        )
          .map(getId)
          .sort();

        const expectedIds =
          recipe[field]
            .map(
              name =>
                getId(
                  byName.get(name)
                )
            )
            .sort();

        if (
          savedIds.length !== expectedIds.length ||
          savedIds.some(
            (value, index) =>
              value !== expectedIds[index]
          )
        ) {

          throw new Error(
            `Existing ${recipe.name} has different ${field}`
          );

        }

      }

    }


    // Display planned operation.
    console.log(
      `${existing ? 'SKIP' : 'CREATE'} pizza: ${recipe.name}`
    );

    console.log(
      `Calculated price: ₹${(pricePaise / 100).toFixed(2)}\n`
    );

  }


  // ---------------------------------------------------
  // DISPLAY PLANNED INGREDIENT OPERATIONS
  // ---------------------------------------------------

  console.log('Checking protein ingredients...\n');

  for (const protein of newProteins) {

    const existing =
      byName.get(protein.name);

    const pricePaise =
      (existing || protein).pricePaise;

    console.log(
      `${existing ? 'SKIP' : 'CREATE'} ingredient: ${protein.name}`
    );

    console.log(
      `Price: ₹${(pricePaise / 100).toFixed(2)}\n`
    );

  }


  // ---------------------------------------------------
  // DRY RUN — DO NOT WRITE ANYTHING
  // ---------------------------------------------------

  if (!apply) {

    console.log('====================================');

    console.log('DRY RUN COMPLETED SUCCESSFULLY');

    console.log('No database records were changed.');

    console.log('====================================\n');

    return;

  }


  // ---------------------------------------------------
  // CREATE MISSING PROTEIN INGREDIENTS
  // ---------------------------------------------------

  console.log('\nCreating missing ingredients...\n');

  for (const protein of newProteins) {

    // Preserve existing ingredient records.
    if (byName.has(protein.name)) {

      console.log(
        `Already exists: ${protein.name}`
      );

      continue;

    }

    const created =
      await Ingredient.create(protein);

    byName.set(
      protein.name,
      created
    );

    console.log(
      `Created ingredient: ${created.name}`
    );

  }


  // ---------------------------------------------------
  // CREATE MISSING NON-VEGETARIAN PIZZAS
  // ---------------------------------------------------

  console.log('\nCreating missing pizzas...\n');

  for (const recipe of recipes) {

    // Preserve existing matching pizzas.
    if (
      existingPizzaMap.has(recipe.name)
    ) {

      console.log(
        `Already exists: ${recipe.name}`
      );

      continue;

    }


    // Resolve ingredient names to ObjectIds.
    const ingredientId = name => {

      const ingredient = byName.get(name);

      if (!ingredient) {

        throw new Error(
          `Ingredient missing during creation: ${name}`
        );

      }

      return ingredient._id;

    };


    // Create pizza.
    const pizza = await Pizza.create({

      name: recipe.name,

      description: recipe.description,

      category: 'non-vegetarian',

      ingredients: {

        base: ingredientId(
          recipe.base
        ),

        sauce: ingredientId(
          recipe.sauce
        ),

        cheese: ingredientId(
          recipe.cheese
        ),

        vegetables:
          recipe.vegetables.map(
            ingredientId
          ),

        proteins:
          recipe.proteins.map(
            ingredientId
          )

      },

      isActive: true

    });


    // Verify price using Pizza model.
    const pricePaise =
      await pizza.calculatePrice();


    // Verify inventory availability.
    const availability =
      await pizza.checkAvailability(1);

    if (!availability.available) {

      throw new Error(
        `Availability verification failed for ${recipe.name}`
      );

    }


    console.log(
      `Created: ${pizza.name}`
    );

    console.log(
      `Price: ₹${(pricePaise / 100).toFixed(2)}`
    );

    console.log(
      `Available: ${availability.available}\n`
    );

  }


  // ---------------------------------------------------
  // COMPLETION
  // ---------------------------------------------------

  console.log('====================================');

  console.log('NON-VEGETARIAN SEED COMPLETED');

  console.log('Existing Vegetarian and Vegan pizzas preserved.');

  console.log('Existing ingredient prices and stock preserved.');

  console.log('====================================\n');

}


// =====================================================
// 7. EXECUTE SEEDER
// =====================================================

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