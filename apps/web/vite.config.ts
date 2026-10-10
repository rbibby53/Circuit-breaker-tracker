import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:2757',
      '/healthz': 'http://localhost:2757',
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
