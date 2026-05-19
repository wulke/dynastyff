// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../../dist/ui'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: path.resolve(__dirname, 'vitest.setup.ts'),
  },
});
