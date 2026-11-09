import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { cellarLight } from './build/cellar-light.ts';

const BACKEND = { target: 'http://localhost:8080', changeOrigin: false };

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss(), cellarLight()],
  build: {
    outDir: 'dist',
    target: 'esnext',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '^/api/': BACKEND,
      '^/media/': BACKEND,
      '^/m/': BACKEND,
      '^/healthcheck$': BACKEND,
    },
  },
});
