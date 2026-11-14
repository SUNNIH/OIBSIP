import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

// Load server/.env before importing application services
const envPath = fileURLToPath(
  new URL('../../.env', import.meta.url)
);

const { error: envError } = dotenv.config({
  path: envPath,
});

if (envError) {
  console.error('❌ Failed to load .env:', envError.message);
  process.exit(1);
}

console.log('✓ Environment variables loaded');

async function main() {
  let rl;

  try {
    // Import scheduler after environment initialization
    const { runImmediateCheck } = await import(
      './lowStockScheduler.js'
    );

    await mongoose.connect(process.env.MONGODB_URI);

    console.log('✓ MongoDB connected');
    console.log('🔍 Starting stock recovery QA...');

    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // CHECK 1: Initial low-stock condition
    console.log('\n--- CHECK 1: INITIAL LOW STOCK ---');

    const firstResult = await runImmediateCheck();

    console.log('First result:', firstResult);

    // Wait for manual stock recovery
    await rl.question(
      '\nRestock ONE low-stock ingredient ABOVE its threshold, then press Enter...'
    );

    // CHECK 2: Stock recovery
    console.log('\n--- CHECK 2: STOCK RECOVERY ---');

    const secondResult = await runImmediateCheck();

    console.log('Second result:', secondResult);

    // Wait for stock reduction
    await rl.question(
      '\nReduce the SAME ingredient BELOW its threshold, then press Enter...'
    );

    // CHECK 3: Low stock after recovery
    console.log('\n--- CHECK 3: LOW STOCK AGAIN ---');

    const thirdResult = await runImmediateCheck();

    console.log('Third result:', thirdResult);

    console.log('\n✓ Stock recovery QA completed');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (rl) {
      rl.close();
    }

    await mongoose.disconnect();

    console.log('✓ MongoDB disconnected');
  }
}

await main();