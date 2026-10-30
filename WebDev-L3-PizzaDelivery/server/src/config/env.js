import { z } from 'zod';
import dotenv from 'dotenv';

// Skip .env file in test environment - use setupFiles instead
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('5000'),
  // In test mode, allow defaults; in other modes, require values
  MONGODB_URI: process.env.NODE_ENV === 'test'
    ? z.string().default('mongodb://127.0.0.1:27017/test')
    : z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_URL: process.env.NODE_ENV === 'test'
    ? z.string().url().default('http://localhost:5173')
    : z.string().url('CLIENT_URL must be a valid URL'),
  JWT_SECRET: process.env.NODE_ENV === 'test'
    ? z.string().min(32).default('test-jwt-secret-min-32-characters-long-for-testing')
    : z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRY: z.string().default('2h'),
  CSRF_SECRET: process.env.NODE_ENV === 'test'
    ? z.string().min(32).default('test-csrf-secret-min-32-characters-long-for-testing')
    : z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
  EMAIL_HOST: z.string().default('ethereal'),
  EMAIL_PORT: z.string().regex(/^\d+$/).transform(Number).default('587'),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
});

let env;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  console.error('❌ Environment validation failed:');
  if (error instanceof z.ZodError) {
    error.issues.forEach(err => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  }

  // In test environment, throw instead of exit to allow test framework to handle
  if (process.env.NODE_ENV === 'test') {
    throw error;
  }

  process.exit(1);
}

export default env;
