// @spec DFF-STATIC-001
// @spec DFF-STATIC-002
// @spec DFF-STATIC-003
// @spec DFF-STATIC-004
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';

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

// @spec DFF-STATIC-003
test('the static build guard rejects forbidden server-side imports in the source graph', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-static-guard-'));

  try {
    fs.writeFileSync(
      path.join(tempDir, 'entry.ts'),
      "import express from 'express';\nconsole.log(express);\n",
      'utf8',
    );

    const configModule = (await import('../src/ui-static/vite.config.js')) as {
      createStaticBuildGuardPlugin?: () => unknown;
    };

    await assert.rejects(
      () =>
        build({
          configFile: false,
          root: tempDir,
          plugins: [configModule.createStaticBuildGuardPlugin?.()].filter(Boolean),
          build: {
            outDir: path.join(tempDir, 'dist'),
            emptyOutDir: true,
            lib: {
              entry: path.join(tempDir, 'entry.ts'),
              formats: ['es'],
              fileName: () => 'entry.js',
            },
          },
          logLevel: 'silent',
        }),
      /forbidden static build dependency/i,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// @spec DFF-STATIC-001
test('build:static fails with guidance when data/snapshot.json is missing', () => {
  const snapshotPath = path.resolve(process.cwd(), 'data/snapshot.json');
  const backupPath = path.resolve(process.cwd(), 'data/snapshot.json.test-backup');
  fs.renameSync(snapshotPath, backupPath);

  try {
    const buildResult = spawnSync('npm', ['run', 'build:static'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.notEqual(buildResult.status, 0);
    assert.match(
      `${buildResult.stdout}\n${buildResult.stderr}`,
      /data\/snapshot\.json not found — run npm run export:snapshot first/i,
    );
  } finally {
    fs.renameSync(backupPath, snapshotPath);
  }
});

// @spec DFF-STATIC-004
test('the built static bundle excludes advisor sdk imports, advisor endpoints, and api-key config', () => {
  const assetsDir = path.resolve(process.cwd(), 'dist/static/assets');
  const bundleContents = fs
    .readdirSync(assetsDir)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => fs.readFileSync(path.join(assetsDir, fileName), 'utf8'))
    .join('\n');

  assert.doesNotMatch(bundleContents, /@anthropic-ai\/sdk/i);
  assert.doesNotMatch(bundleContents, /ANTHROPIC_API_KEY/i);
  assert.doesNotMatch(bundleContents, /\/advisor\/(advise|chat|analysis)/i);
});
