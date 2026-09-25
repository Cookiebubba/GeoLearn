import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.GEOLEARN_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': api,
      '/data': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
