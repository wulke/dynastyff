// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApiBaseUrl } from '../server/runtime.js';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  server: {
    proxy: {
      '/configs': {
        target: resolveApiBaseUrl(),
      },
      '/drafts': {
        target: resolveApiBaseUrl(),
      },
    },
  },
  build: {
    outDir: path.resolve(uiRoot, '../../dist/ui'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: [path.resolve(uiRoot, '../../tests/**/*.test.tsx')],
    setupFiles: path.resolve(uiRoot, 'vitest.setup.ts'),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
