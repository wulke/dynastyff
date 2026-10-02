// @spec DFF-SCHED-001
// @spec DFF-SCHED-002
// @spec DFF-SCHED-003
// @spec DFF-SCHED-004
// @spec DFF-SCHED-020
// @spec DFF-SCHED-021
// @spec DFF-SCHED-022
// @spec DFF-SCHED-023
// @spec DFF-SCHED-024
// @spec DFF-STATIC-050
// @spec DFF-STATIC-051
// @spec DFF-STATIC-052
// @spec DFF-STATIC-053
// @spec DFF-STATIC-054
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readWorkflow(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

// @spec DFF-SCHED-001
// @spec DFF-SCHED-002
// @spec DFF-SCHED-003
test('scheduled-refresh workflow runs weekly, is dispatchable, and runs the ETL plus sanity-check pipeline from a fresh db', () => {
  const workflow = readWorkflow('.github/workflows/scheduled-refresh.yml');

  assert.match(workflow, /^on:\s*\n\s*schedule:\s*\n\s*-\s*cron:\s*'[^']+'\s*\n\s*workflow_dispatch:/m);
  assert.match(workflow, /concurrency:\s*\n\s*group:\s*scheduled-refresh\s*\n\s*cancel-in-progress:\s*false/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npx playwright install --with-deps chromium/);
  assert.match(workflow, /run:\s*npm run db:init/);
  assert.match(workflow, /run:\s*npm run etl\n/);
  assert.match(workflow, /run:\s*npm run export:snapshot/);
  assert.match(workflow, /run:\s*npm run etl:sanity-check/);

  const dbInitIndex = workflow.indexOf('npm run db:init');
  const etlIndex = workflow.indexOf('run: npm run etl\n');
  const exportIndex = workflow.indexOf('run: npm run export:snapshot');
  const sanityIndex = workflow.indexOf('run: npm run etl:sanity-check');
  assert.ok(dbInitIndex < etlIndex);
  assert.ok(etlIndex < exportIndex);
  assert.ok(exportIndex < sanityIndex);
});

// @spec DFF-SCHED-004
test('scheduled-refresh workflow does not restore or cache the sqlite database across runs', () => {
  const workflow = readWorkflow('.github/workflows/scheduled-refresh.yml');

  assert.doesNotMatch(workflow, /actions\/cache/);
  assert.doesNotMatch(workflow, /dynastyff\.sqlite/);
});

// @spec DFF-SCHED-020
// @spec DFF-SCHED-021
// @spec DFF-SCHED-022
// @spec DFF-SCHED-023
// @spec DFF-SCHED-024
test('scheduled-refresh workflow opens a PR rather than pushing to main, superseding stale refresh PRs first', () => {
  const workflow = readWorkflow('.github/workflows/scheduled-refresh.yml');
  const sanityIndex = workflow.indexOf('run: npm run etl:sanity-check');
  const diffIndex = workflow.indexOf('id: diff');
  const supersedeIndex = workflow.indexOf('Supersede stale refresh PRs');
  const openPrIndex = workflow.indexOf('Open refresh PR');

  assert.match(workflow, /git diff --quiet -- data\/snapshot\.json/);
  assert.match(workflow, /startswith\("refresh\/snapshot-"\)/);
  assert.match(workflow, /gh pr close "\$pr" --delete-branch/);
  assert.match(workflow, /branch="refresh\/snapshot-\$\(date -u \+%Y-%m-%d\)-\$\{GITHUB_RUN_NUMBER\}"/);
  assert.match(workflow, /git push origin "\$branch"/);
  assert.match(workflow, /gh pr create/);
  assert.doesNotMatch(workflow, /git push origin HEAD:/);
  assert.match(workflow, /gh workflow run ci\.yml --ref "\$branch"/);

  assert.notEqual(sanityIndex, -1);
  assert.notEqual(diffIndex, -1);
  assert.notEqual(supersedeIndex, -1);
  assert.notEqual(openPrIndex, -1);
  assert.ok(sanityIndex < diffIndex);
  assert.ok(diffIndex < supersedeIndex);
  assert.ok(supersedeIndex < openPrIndex);
});

// @spec DFF-SCHED-040
test('the superseded etl-snapshot workflow no longer exists', () => {
  assert.equal(fs.existsSync(path.resolve(process.cwd(), '.github/workflows/etl-snapshot.yml')), false);
});

// @spec DFF-STATIC-050
// @spec DFF-STATIC-051
// @spec DFF-STATIC-052
// @spec DFF-STATIC-053
// @spec DFF-STATIC-054
test('pages workflow deploys the static bundle to GitHub Pages on pushes to main', () => {
  const workflow = readWorkflow('.github/workflows/pages.yml');

  assert.match(workflow, /^on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]\s*\n/m);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm run build:static/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /path:\s*dist\/static\/?/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /jobs:\s*\n\s*build:\s*\n\s*runs-on:\s*ubuntu-latest\s*\n\s*permissions:\s*\n\s*contents:\s*read\s*\n\s*pages:\s*write/m);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*github-pages/);
});
