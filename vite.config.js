import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // The Express API writes its JSON data stores (server/*.json) on every
      // admin action and every chatbot question. Without this, Vite's root
      // watcher treats those writes as project changes and FULL-RELOADS the
      // page — wiping in-app state such as the open chat conversation.
      // The API runs as its own process; Vite never needs to watch it.
      ignored: ['**/server/**'],
    },
    proxy: {
      // Forward API calls to the Express proxy that holds the Zoom credentials.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
