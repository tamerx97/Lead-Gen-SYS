import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // The dashboard talks to the API on the same origin in dev, so the
    // httpOnly session cookie is sent without any CORS/SameSite friction.
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true },
      '/mock': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true },
      '/health': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
});
