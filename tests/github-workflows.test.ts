// @spec DFF-STATIC-040
// @spec DFF-STATIC-041
// @spec DFF-STATIC-042
// @spec DFF-STATIC-043
// @spec DFF-STATIC-044
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

// @spec DFF-STATIC-040
// @spec DFF-STATIC-041
// @spec DFF-STATIC-042
// @spec DFF-STATIC-043
// @spec DFF-STATIC-044
test('etl-snapshot workflow is manual-only and runs the ETL plus snapshot export pipeline', () => {
  const workflow = readWorkflow('.github/workflows/etl-snapshot.yml');

  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:\s*\n/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*/m);
  assert.doesNotMatch(workflow, /^\s*schedule:\s*/m);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npx playwright install --with-deps chromium/);
  assert.match(workflow, /run:\s*npm run etl/);
  assert.match(workflow, /run:\s*npm run export:snapshot/);
});

// @spec DFF-STATIC-042
// @spec DFF-STATIC-043
// @spec DFF-STATIC-044
test('etl-snapshot workflow commits only snapshot diffs with the github-actions bot identity', () => {
  const workflow = readWorkflow('.github/workflows/etl-snapshot.yml');
  const exportIndex = workflow.indexOf('run: npm run export:snapshot');
  const diffIndex = workflow.indexOf('- id: snapshot_diff');
  const commitGuardIndex = workflow.indexOf("if: steps.snapshot_diff.outputs.changed == 'true'");

  assert.match(workflow, /git diff --quiet --exit-code -- data\/snapshot\.json/);
  assert.match(workflow, /git config user\.name "github-actions\[bot\]"/);
  assert.match(workflow, /git config user\.email "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/);
  assert.match(workflow, /git add data\/snapshot\.json/);
  assert.match(workflow, /git commit -m "chore: refresh static snapshot"/);
  assert.match(workflow, /git push origin HEAD:\$\{\{\s*github\.ref_name\s*\}\}/);
  assert.match(workflow, /if:\s*steps\.snapshot_diff\.outputs\.changed == 'true'/);
  assert.notEqual(exportIndex, -1);
  assert.notEqual(diffIndex, -1);
  assert.notEqual(commitGuardIndex, -1);
  assert.ok(exportIndex < diffIndex);
  assert.ok(diffIndex < commitGuardIndex);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
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
