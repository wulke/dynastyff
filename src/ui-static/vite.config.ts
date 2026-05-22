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
export const STATIC_SNAPSHOT_MISSING_MESSAGE =
  'data/snapshot.json not found — run npm run export:snapshot first';

const STATIC_BUILD_FORBIDDEN_PATTERNS = [
  {
    kind: 'dependency',
    label: 'express',
    pattern: /(?:from\s*['"]express['"]|import\s*\(\s*['"]express['"]\s*\)|require\s*\(\s*['"]express['"]\s*\))/,
  },
  {
    kind: 'dependency',
    label: 'better-sqlite3',
    pattern:
      /(?:from\s*['"]better-sqlite3['"]|import\s*\(\s*['"]better-sqlite3['"]\s*\)|require\s*\(\s*['"]better-sqlite3['"]\s*\))/,
  },
  {
    kind: 'dependency',
    label: 'drizzle-orm',
    pattern:
      /(?:from\s*['"]drizzle-orm(?:\/[^'"]*)?['"]|import\s*\(\s*['"]drizzle-orm(?:\/[^'"]*)?['"]\s*\)|require\s*\(\s*['"]drizzle-orm(?:\/[^'"]*)?['"]\s*\))/,
  },
  {
    kind: 'dependency',
    label: 'node:*',
    pattern:
      /(?:from\s*['"]node:[^'"]+['"]|import\s*\(\s*['"]node:[^'"]+['"]\s*\)|require\s*\(\s*['"]node:[^'"]+['"]\s*\))/,
  },
  {
    kind: 'dependency',
    label: '@anthropic-ai/sdk',
    pattern:
      /(?:from\s*['"]@anthropic-ai\/sdk['"]|import\s*\(\s*['"]@anthropic-ai\/sdk['"]\s*\)|require\s*\(\s*['"]@anthropic-ai\/sdk['"]\s*\))/,
  },
  {
    kind: 'reference',
    label: 'ANTHROPIC_API_KEY',
    pattern: /\bANTHROPIC_API_KEY\b/,
  },
  {
    kind: 'reference',
    label: '/advisor/*',
    pattern: /\/advisor\/(advise|chat|analysis)\b/,
  },
] as const;

function shouldCheckStaticModule(id: string) {
  const normalizedId = id.split('?')[0];

  if (!normalizedId || normalizedId.startsWith('\0')) {
    return false;
  }

  return !normalizedId.includes('/node_modules/');
}

function getStaticBuildViolationMessage(id: string, label: string, kind: 'dependency' | 'reference') {
  return `Forbidden static build ${kind} "${label}" found in ${id}`;
}

// @spec DFF-STATIC-003
// @spec DFF-STATIC-004
export function createStaticBuildGuardPlugin(): Plugin {
  return {
    name: 'guard-static-build-dependencies',
    enforce: 'pre',
    transform(code, id) {
      if (!shouldCheckStaticModule(id)) {
        return null;
      }

      for (const rule of STATIC_BUILD_FORBIDDEN_PATTERNS) {
        if (rule.pattern.test(code)) {
          throw new Error(getStaticBuildViolationMessage(id, rule.label, rule.kind));
        }
      }

      return null;
    },
  };
}

// @spec DFF-STATIC-001
export function createSnapshotCopyPlugin(snapshotPath = snapshotSourcePath): Plugin {
  return {
    name: 'copy-static-snapshot',
    configureServer(server) {
      // Serve data/snapshot.json in dev mode so the runtime fetch succeeds.
      // Handles both /data/snapshot.json (dev without base) and
      // /dynastyff/data/snapshot.json (dev with base /dynastyff/).
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';

        if (!url.endsWith('/data/snapshot.json')) {
          next();
          return;
        }

        if (!fs.existsSync(snapshotPath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end(STATIC_SNAPSHOT_MISSING_MESSAGE);
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(snapshotPath, 'utf-8'));
      });
    },
    writeBundle(options) {
      const outDir = options.dir;

      if (!outDir) {
        return;
      }

      const destinationPath = path.resolve(outDir, 'data/snapshot.json');
      if (!fs.existsSync(snapshotPath)) {
        throw new Error(STATIC_SNAPSHOT_MISSING_MESSAGE);
      }

      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(snapshotPath, destinationPath);
    },
  };
}

export default defineConfig({
  root: uiStaticRoot,
  base: '/dynastyff/',
  plugins: [react(), createStaticBuildGuardPlugin(), createSnapshotCopyPlugin()],
  build: {
    outDir: path.resolve(uiStaticRoot, '../../dist/static'),
    emptyOutDir: true,
  },
});
