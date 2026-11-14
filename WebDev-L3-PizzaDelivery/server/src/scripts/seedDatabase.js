import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import Ingredient from '../models/Ingredient.js';
import Pizza from '../models/Pizza.js';
import env from '../config/env.js';

// Seed data definitions
const ingredientsData = [
  // Bases (5)
  { name: 'Thin Crust', category: 'base', pricePaise: 15000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Thick Crust', category: 'base', pricePaise: 18000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Stuffed Crust', category: 'base', pricePaise: 22000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Gluten-Free', category: 'base', pricePaise: 25000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Whole Wheat', category: 'base', pricePaise: 16000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  
  // Sauces (5)
  { name: 'Classic Tomato', category: 'sauce', pricePaise: 8000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Pesto', category: 'sauce', pricePaise: 12000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'White Garlic', category: 'sauce', pricePaise: 10000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'BBQ', category: 'sauce', pricePaise: 11000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Spicy Marinara', category: 'sauce', pricePaise: 9000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  
  // Cheese (3)
  { name: 'Mozzarella', category: 'cheese', pricePaise: 15000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Cheddar', category: 'cheese', pricePaise: 13000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Parmesan', category: 'cheese', pricePaise: 18000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  
  // Vegetables (8)
  { name: 'Bell Peppers', category: 'vegetable', pricePaise: 7000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Onions', category: 'vegetable', pricePaise: 5000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Mushrooms', category: 'vegetable', pricePaise: 8000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Olives', category: 'vegetable', pricePaise: 9000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Tomatoes', category: 'vegetable', pricePaise: 6000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Jalapeños', category: 'vegetable', pricePaise: 7500, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Spinach', category: 'vegetable', pricePaise: 7000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
  { name: 'Corn', category: 'vegetable', pricePaise: 6000, stock: 1000, reserved: 0, lowStockThreshold: 50 },
];

// Pizza preset definitions (ingredient names resolved to IDs during seeding)
const pizzasData = [
  {
    name: 'Margherita Classic',
    description: 'Classic Italian pizza with fresh tomatoes and mozzarella',
    category: 'vegetarian',
    ingredients: {
      base: 'Thin Crust',
      sauce: 'Classic Tomato',
      cheese: 'Mozzarella',
      vegetables: ['Tomatoes'],
    },
  },
  {
    name: 'Veggie Supreme',
    description: 'Loaded with fresh vegetables on thick crust',
    category: 'vegetarian',
    ingredients: {
      base: 'Thick Crust',
      sauce: 'Classic Tomato',
      cheese: 'Mozzarella',
      vegetables: ['Bell Peppers', 'Onions', 'Mushrooms', 'Olives'],
    },
  },
  {
    name: 'Mediterranean',
    description: 'Mediterranean flavors with white garlic sauce',
    category: 'vegetarian',
    ingredients: {
      base: 'Thin Crust',
      sauce: 'White Garlic',
      cheese: 'Parmesan',
      vegetables: ['Spinach', 'Olives', 'Tomatoes'],
    },
  },
  {
    name: 'Spicy Veggie',
    description: 'Spicy kick with jalapeños on whole wheat',
    category: 'vegetarian',
    ingredients: {
      base: 'Whole Wheat',
      sauce: 'Spicy Marinara',
      cheese: 'Cheddar',
      vegetables: ['Jalapeños', 'Onions', 'Bell Peppers'],
    },
  },
];

/**
 * Seed ingredients with idempotent upsert
 * Preserves existing stock and prices if ingredient already exists
 * Detects and reports category conflicts
 */
async function seedIngredients() {
  console.log('Seeding ingredients...');
  const results = { created: 0, existing: 0, conflicts: [], errors: [] };
  
  for (const ingredientData of ingredientsData) {
    try {
      const existing = await Ingredient.findOne({ name: ingredientData.name });
      
      if (existing) {
        // Check for category conflict
        if (existing.category !== ingredientData.category) {
          const conflict = {
            ingredient: ingredientData.name,
            existingCategory: existing.category,
            seedCategory: ingredientData.category,
            message: `Category mismatch: existing ${existing.category}, seed data expects ${ingredientData.category}`
          };
          results.conflicts.push(conflict);
          console.error(`  ⚠️  ${ingredientData.name}: ${conflict.message}`);
        } else {
          // Ingredient exists with correct category - preserve current stock/prices
          results.existing++;
          console.log(`  ✓ ${ingredientData.name} (${ingredientData.category}) already exists, preserving current data`);
        }
      } else {
        // Create new ingredient
        await Ingredient.create(ingredientData);
        results.created++;
        console.log(`  + ${ingredientData.name} (${ingredientData.category}) created at ₹${ingredientData.pricePaise / 100}`);
      }
    } catch (error) {
      results.errors.push({ ingredient: ingredientData.name, error: error.message });
      console.error(`  ✗ Error seeding ${ingredientData.name}: ${error.message}`);
    }
  }
  
  return results;
}

/**
 * Seed pizza presets with calculated prices
 * Resolves ingredient names to IDs and creates pizzas
 * Detects and reports conflicts with existing pizzas
 */
async function seedPizzas() {
  console.log('Seeding pizza presets...');
  const results = { created: 0, existing: 0, conflicts: [], errors: [] };
  
  // Build ingredient name-to-ID map
  const ingredientMap = new Map();
  const allIngredients = await Ingredient.find({});
  for (const ingredient of allIngredients) {
    ingredientMap.set(ingredient.name, ingredient._id);
  }
  
  for (const pizzaData of pizzasData) {
    try {
      const existing = await Pizza.findOne({ name: pizzaData.name });
      
      if (existing) {
        // Check for recipe or category conflicts
        const recipeConflicts = [];
        
        // Resolve seed ingredient names to IDs for comparison
        const seedBase = ingredientMap.get(pizzaData.ingredients.base);
        const seedSauce = ingredientMap.get(pizzaData.ingredients.sauce);
        const seedCheese = ingredientMap.get(pizzaData.ingredients.cheese);
        const seedVegetables = pizzaData.ingredients.vegetables.map(name => ingredientMap.get(name)).sort();
        const existingVegetables = existing.ingredients.vegetables.map(id => id.toString()).sort();
        
        if (existing.ingredients.base.toString() !== seedBase?.toString()) {
          recipeConflicts.push('base mismatch');
        }
        if (existing.ingredients.sauce.toString() !== seedSauce?.toString()) {
          recipeConflicts.push('sauce mismatch');
        }
        if (existing.ingredients.cheese.toString() !== seedCheese?.toString()) {
          recipeConflicts.push('cheese mismatch');
        }
        if (existingVegetables.length !== seedVegetables.length || 
            !existingVegetables.every((v, i) => v === seedVegetables[i]?.toString())) {
          recipeConflicts.push('vegetables mismatch');
        }
        if (existing.category !== pizzaData.category) {
          recipeConflicts.push(`category mismatch (existing: ${existing.category}, seed: ${pizzaData.category})`);
        }
        
        if (recipeConflicts.length > 0) {
          const conflict = {
            pizza: pizzaData.name,
            conflicts: recipeConflicts,
            message: `Recipe/category conflicts: ${recipeConflicts.join(', ')}`
          };
          results.conflicts.push(conflict);
          console.error(`  ⚠️  ${pizzaData.name}: ${conflict.message}`);
        } else {
          // Pizza exists with correct recipe - preserve
          results.existing++;
          const price = await existing.calculatePrice();
          console.log(`  ✓ ${pizzaData.name} already exists (₹${price / 100})`);
        }
      } else {
        // Resolve ingredient names to IDs
        const resolvedIngredients = {
          base: ingredientMap.get(pizzaData.ingredients.base),
          sauce: ingredientMap.get(pizzaData.ingredients.sauce),
          cheese: ingredientMap.get(pizzaData.ingredients.cheese),
          vegetables: pizzaData.ingredients.vegetables.map(name => ingredientMap.get(name)),
        };
        
        // Validate all ingredients exist
        const missingIngredients = [];
        if (!resolvedIngredients.base) missingIngredients.push(`base: ${pizzaData.ingredients.base}`);
        if (!resolvedIngredients.sauce) missingIngredients.push(`sauce: ${pizzaData.ingredients.sauce}`);
        if (!resolvedIngredients.cheese) missingIngredients.push(`cheese: ${pizzaData.ingredients.cheese}`);
        const missingVeggies = pizzaData.ingredients.vegetables.filter(name => !ingredientMap.has(name));
        if (missingVeggies.length > 0) missingIngredients.push(...missingVeggies.map(v => `vegetable: ${v}`));
        
        if (missingIngredients.length > 0) {
          throw new Error(`Missing ingredients: ${missingIngredients.join(', ')}`);
        }
        
        // Create pizza
        const pizza = await Pizza.create({
          name: pizzaData.name,
          description: pizzaData.description,
          category: pizzaData.category,
          ingredients: resolvedIngredients,
        });
        
        // Calculate and display price
        const calculatedPrice = await pizza.calculatePrice();
        results.created++;
        console.log(`  + ${pizzaData.name} created (₹${calculatedPrice / 100})`);
      }
    } catch (error) {
      results.errors.push({ pizza: pizzaData.name, error: error.message });
      console.error(`  ✗ Error seeding ${pizzaData.name}: ${error.message}`);
    }
  }
  
  return results;
}

/**
 * Validate the exact database target before any write.
 * Development seeding requires an explicit database-name allowlist;
 * test seeding is restricted to the test database on loopback.
 */
function validateSeedTarget(uri) {
  const mode = process.env.NODE_ENV || env.NODE_ENV;
  if (mode === 'production' || env.NODE_ENV === 'production') {
    throw new Error('PRODUCTION SEEDING BLOCKED: NODE_ENV=production');
  }
  if (mode !== 'development' && mode !== 'test') {
    throw new Error('SEED TARGET BLOCKED: unsupported environment');
  }

  let target;
  try {
    target = new URL(uri);
  } catch {
    throw new Error('SEED TARGET BLOCKED: invalid MongoDB URI');
  }

  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (target.protocol !== 'mongodb:' || target.host.includes(',') ||
      !allowedHosts.has(target.hostname.toLowerCase())) {
    throw new Error('PRODUCTION SEEDING BLOCKED: MongoDB must use a single loopback host');
  }
  // An option must not be allowed to silently override the URI database.
  if ([...target.searchParams.keys()].some(key => key.toLowerCase() === 'dbname')) {
    throw new Error('SEED TARGET BLOCKED: URI dbName override is not permitted');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(target.pathname.slice(1)) || 'test';
  } catch {
    throw new Error('SEED TARGET BLOCKED: invalid database name');
  }
  const expectedName = mode === 'test' ? 'test' : process.env.SEED_DB_NAME?.trim();
  if (!expectedName) {
    throw new Error('SEED TARGET BLOCKED: set SEED_DB_NAME in server/.env');
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(databaseName) ||
      !/^[a-zA-Z0-9_.-]+$/.test(expectedName) ||
      (mode !== 'test' && ['test', 'admin', 'local', 'config', 'prod', 'production'].includes(expectedName.toLowerCase())) ||
      databaseName !== expectedName) {
    throw new Error('SEED TARGET BLOCKED: database name does not match the approved seed target');
  }

  return { databaseName, port: Number(target.port || 27017) };
}

function assertActiveSeedConnection(target) {
  const connection = mongoose.connection;
  const activeHost = connection.host?.toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (connection.readyState !== 1 || !allowedHosts.has(activeHost) ||
      Number(connection.port || 27017) !== target.port ||
      connection.db?.databaseName !== target.databaseName) {
    throw new Error('SEED TARGET BLOCKED: active MongoDB connection does not match the approved target');
  }
}

/**
 * Main seeding function
 * Idempotent - safe to run multiple times
 * Blocks production database seeding
 */
export async function seedDatabase() {
  console.log('\n=== Starting Database Seeding ===\n');
  
  try {
    // Validate the same URI we will actually use, before connecting or writing.
    const dbUri = process.env.MONGODB_URI || env.MONGODB_URI;
    const target = validateSeedTarget(dbUri);

    if (mongoose.connection.readyState === 0) {
      console.log('Connecting to the approved local database...');
      await mongoose.connect(dbUri);
    }
    // Also check an existing test/app connection; never trust an env var alone.
    assertActiveSeedConnection(target);

    // Seed ingredients first
    const ingredientResults = await seedIngredients();
    console.log(`\nIngredients: ${ingredientResults.created} created, ${ingredientResults.existing} existing`);
    if (ingredientResults.conflicts.length > 0) {
      console.log(`⚠️  Conflicts: ${ingredientResults.conflicts.length}`);
    }
    if (ingredientResults.errors.length > 0) {
      console.log(`Errors: ${ingredientResults.errors.length}`);
    }
    
    // Seed pizzas
    const pizzaResults = await seedPizzas();
    console.log(`Pizzas: ${pizzaResults.created} created, ${pizzaResults.existing} existing`);
    if (pizzaResults.conflicts.length > 0) {
      console.log(`⚠️  Conflicts: ${pizzaResults.conflicts.length}`);
    }
    if (pizzaResults.errors.length > 0) {
      console.log(`Errors: ${pizzaResults.errors.length}`);
    }
    
    // Summary
    console.log('\n=== Seeding Complete ===');
    console.log(`Total ingredients in database: ${await Ingredient.countDocuments()}`);
    console.log(`Total pizzas in database: ${await Pizza.countDocuments()}`);
    
    // Check for failures
    const allErrors = [...ingredientResults.errors, ...pizzaResults.errors];
    const allConflicts = [...ingredientResults.conflicts, ...pizzaResults.conflicts];
    
    if (allConflicts.length > 0) {
      console.log('\n⚠️  Data conflicts detected (existing data preserved):');
      allConflicts.forEach(conflict => {
        const item = conflict.ingredient || conflict.pizza;
        console.log(`  - ${item}: ${conflict.message}`);
      });
    }
    
    if (allErrors.length > 0) {
      console.log('\n❌ Some items failed to seed:');
      allErrors.forEach(err => console.log(`  - ${err.ingredient || err.pizza}: ${err.error}`));
      return { 
        success: false, 
        ingredientResults, 
        pizzaResults,
        conflicts: allConflicts,
        errors: allErrors 
      };
    }
    
    // Conflicts also make the CLI exit nonzero (without overwriting records).
    return { 
      success: allConflicts.length === 0, 
      ingredientResults, 
      pizzaResults,
      conflicts: allConflicts,
      errors: []
    };
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    throw error;
  }
}

// CLI execution support
const __filename = fileURLToPath(import.meta.url);
const currentScriptPath = process.argv[1];

// Normalize paths for Windows comparison
const normalizedScriptPath = __filename.replace(/\\/g, '/');
const normalizedArgPath = currentScriptPath?.replace(/\\/g, '/');

if (normalizedScriptPath === normalizedArgPath) {
  seedDatabase()
    .then((result) => {
      console.log('\nDisconnecting...');
      return mongoose.disconnect().then(() => result);
    })
    .then((result) => {
      console.log('Done.\n');
      // Exit with error code if seeding failed
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal seeding error:', error.message);
      mongoose.disconnect().then(() => {
        process.exit(1);
      }).catch(() => {
        process.exit(1);
      });
    });
}