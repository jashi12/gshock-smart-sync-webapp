import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@api': fileURLToPath(new URL('./src/api', import.meta.url)),
      '@io': fileURLToPath(new URL('./src/api/io', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/api/utils', import.meta.url)),
      '@model': fileURLToPath(new URL('./src/model', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/pages/components', import.meta.url)),
    },
  },
});
