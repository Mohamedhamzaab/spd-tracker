import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the front end runs on port 5173 and the API on 4000.
// This proxy forwards /api calls to the backend so both feel like one origin.
// In production the backend serves the built front end and no proxy is used.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
