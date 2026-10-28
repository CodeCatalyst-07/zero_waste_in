import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import devApiPlugin from './vite.dev-api.js';

/** Vite configuration for mobile-first React client application. */
export default defineConfig({
  plugins: [react(), tailwindcss(), devApiPlugin()],
  resolve: {
    alias: {
      '@zerowastein/contract': path.resolve(__dirname, '../../packages/contract/src/index.ts'),
      '@zerowastein/rules': path.resolve(__dirname, '../../packages/rules/src/index.ts'),
      '@zerowastein/carbon': path.resolve(__dirname, '../../packages/carbon/src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
});
