// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  build: {
    outDir: path.resolve(uiRoot, '../../dist/ui'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: [path.resolve(uiRoot, '../../tests/ui-app-scaffold.test.tsx')],
    setupFiles: path.resolve(uiRoot, 'vitest.setup.ts'),
  },
});
