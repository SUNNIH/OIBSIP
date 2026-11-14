import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Run backend test files sequentially to prevent
    // interference between suites sharing MongoDB
    // connections and image-upload directories.
    fileParallelism: false,

    // Only discover backend tests.
    include: [
      'tests/**/*.{test,spec}.{js,jsx,ts,tsx}'
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/src/**/*.js'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.js',
        '**/*.config.ts',
        '**/dist/**',
      ],
    },
  },
});