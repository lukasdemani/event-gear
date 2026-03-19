/**
 * @file vite.config.ts
 * @purpose Vite build configuration for EventGear React frontend
 * @ai-notes S3/CloudFront deployment — base path is '/', all API calls go to API_BASE_URL env var
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  define: {
    __API_BASE_URL__: JSON.stringify(process.env['VITE_API_BASE_URL'] ?? ''),
  },
});
