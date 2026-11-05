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

// The frontend always talks to the relay at a same-origin URL. In dev, Vite
// forwards room WebSockets to the local relay (`bun run dev:relay`), which
// also makes LAN testing from a phone work through the Vite host.
const RELAY_PROXY = {
  '/room/': { target: 'ws://localhost:8765', ws: true },
  '/rooms': { target: 'http://localhost:8765' },
  '/health': { target: 'http://localhost:8765' },
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
    proxy: RELAY_PROXY,
  },
  preview: {
    headers: COI_HEADERS,
    proxy: RELAY_PROXY,
  },
  worker: {
    // Rapfi is an Emscripten IIFE loaded via importScripts, which only works
    // in classic (not module) workers.
    format: 'iife',
  },
});
