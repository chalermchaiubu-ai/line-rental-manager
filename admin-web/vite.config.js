import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CLT Tenant Hub Web Admin — standalone Vite SPA.
// Deployed separately from the LINE bot (server.js / Render Web Service).
// See README.md for the recommended deployment (Render Static Site,
// root directory = admin-web/) so the bot's own service is never touched.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
