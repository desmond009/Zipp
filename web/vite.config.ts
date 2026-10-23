import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development Vite serves the app on :5173 and forwards API calls to the
// Fastify server on :3000, so the browser sees one origin (cookies just work).
// In production Fastify serves the built files itself; there is no Vite.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
