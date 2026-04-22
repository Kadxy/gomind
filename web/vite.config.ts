import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Cross-origin isolation headers are required by SharedArrayBuffer, which the
// threaded WASM build relies on. Single-threaded builds ignore them harmlessly.
const COI_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    headers: COI_HEADERS,
  },
  preview: {
    headers: COI_HEADERS,
  },
  worker: {
    // Rapfi is an Emscripten IIFE loaded via importScripts, which only works
    // in classic (not module) workers.
    format: 'iife',
  },
});
