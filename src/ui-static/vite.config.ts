// @spec DFF-STATIC-001
// @spec DFF-STATIC-002
// @spec DFF-STATIC-003
// @spec DFF-STATIC-004
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const uiStaticRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(uiStaticRoot, '../..');
const snapshotSourcePath = path.resolve(repoRoot, 'data/snapshot.json');

// @spec DFF-STATIC-001
function copySnapshotPlugin(): Plugin {
  return {
    name: 'copy-static-snapshot',
    writeBundle(options) {
      const outDir = options.dir;

      if (!outDir) {
        return;
      }

      const destinationPath = path.resolve(outDir, 'data/snapshot.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(snapshotSourcePath, destinationPath);
    },
  };
}

export default defineConfig({
  root: uiStaticRoot,
  base: '/dynastyff/',
  plugins: [react(), copySnapshotPlugin()],
  build: {
    outDir: path.resolve(uiStaticRoot, '../../dist/static'),
    emptyOutDir: true,
  },
});
