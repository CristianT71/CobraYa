import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En desarrollo, Vite sirve la página y reenvía las rutas de la API al servicio
// (por defecto en el puerto 3000). En producción el propio servicio sirve esta
// carpeta compilada (frontend/dist), así que todo queda en el mismo origen.
const API = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/public': API,
      '/admin': API,
      '/a2a': API,
      '/health': API,
      '/docs': API,
      '/.well-known': API,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
