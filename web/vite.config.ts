import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: Vite on :5173 proxies the API to the Fastify dev server on :3000 (same origin as in prod,
// where Fastify serves web/dist itself — ADR 0008).
const api = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/version': api, '/health': api },
  },
  build: { outDir: 'dist', sourcemap: true },
});
