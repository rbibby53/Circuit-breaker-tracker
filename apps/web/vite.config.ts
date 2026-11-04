import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative file names, so one build works at the root and under BASE_PATH: the server makes
  // the page's links absolute for the prefix it runs under.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:2757',
      '/healthz': 'http://localhost:2757',
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
