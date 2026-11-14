import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    port: 5173,

    proxy: {
      '/health': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },

      '/api/v1': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },

      '/api/auth': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },

      '/api/admin': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },

      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});