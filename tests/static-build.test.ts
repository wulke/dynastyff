// @spec DFF-STATIC-001
// @spec DFF-STATIC-002
// @spec DFF-STATIC-003
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// @spec DFF-STATIC-001
test('package.json exposes npm run build:static as a standalone entry point', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.['build:static'], 'vite build --config src/ui-static/vite.config.ts');
});

// @spec DFF-STATIC-002
test('static vite config sets the GitHub Pages base path', async () => {
  const configModule = (await import('../src/ui-static/vite.config.js')) as {
    default: {
      base?: string;
      build?: {
        outDir?: string;
      };
    };
  };

  assert.equal(configModule.default.base, '/dynastyff/');
  assert.match(configModule.default.build?.outDir ?? '', /dist\/static$/);
});

// @spec DFF-STATIC-001
// @spec DFF-STATIC-003
test('npm run build:static produces a browser bundle in dist/static with snapshot data', () => {
  const buildResult = spawnSync('npm', ['run', 'build:static'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(buildResult.status, 0, buildResult.stderr);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'dist/static/index.html')), true);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'dist/static/data/snapshot.json')), true);
});
