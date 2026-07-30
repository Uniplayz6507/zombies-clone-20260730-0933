import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so a production build can be dropped on any static host / subpath.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // three is ~600KB min; splitting it keeps the app chunk cacheable on its own.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: { port: 5173, open: false },
});
