import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Lets the new src/components/ui/* design-system kit (and anything
      // else going forward) import as `@/components/ui/...` instead of a
      // pile of `../../`. Existing app code keeps its relative imports —
      // this is additive, not a migration.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Socket.IO client connects to `/` by default, which Vite would otherwise
      // try to serve itself. `ws: true` is required for the WebSocket upgrade —
      // without it the initial handshake proxies fine but upgrades silently fail.
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
