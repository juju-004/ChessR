import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Socket.IO client connects to `/` by default, which Vite would otherwise
      // try to serve itself. `ws: true` is required — without it the initial
      // HTTP long-polling handshake proxies fine but the WebSocket upgrade
      // silently fails, which looks identical to "nothing happens."
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
