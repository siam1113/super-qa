'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

async function main() {
  const profile = JSON.parse(fs.readFileSync('/qa-profile.json', 'utf8'));
  fs.cpSync('/qa-input', '/work/repository', { recursive: true, dereference: false, errorOnExist: true });
  const root = path.resolve('/work/repository', profile.projectPath);
  if (root !== '/work/repository' && !root.startsWith('/work/repository/')) throw new Error('Project path escaped');
  process.chdir(root);
  const lockHash = crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');
  if (fs.readFileSync('/opt/qa/lock.sha256', 'utf8').trim() !== lockHash) throw new Error('Dependency image does not match repository lockfile');
  fs.symlinkSync('/opt/qa/node_modules', path.join(root, 'node_modules'), 'dir');
  process.env.HOME = '/tmp';
  process.env.CI = '1';
  process.env.QA_TARGET_ORIGIN = profile.targetOrigin || '';
  process.env.QA_DATASET_NAMESPACE = profile.namespace || '';
  process.env.CYPRESS_QA_DATASET_NAMESPACE = profile.namespace || '';
  const packageName = profile.framework === 'playwright' ? '@playwright/test' : 'cypress';
  const version = require('/opt/qa/node_modules/' + packageName + '/package.json').version;
  if (version !== profile.frameworkVersion) throw new Error('Framework version does not match the approved profile');
  process.env.QA_FRAMEWORK_VERSION = version;
  if (profile.framework === 'playwright') {
    const args = ['/opt/qa/node_modules/@playwright/test/cli.js', 'test', ...profile.specs,
      '--reporter=/qa-adapter/playwright.cjs', '--workers=1', '--forbid-only', '--retries=' + profile.retries,
      '--output=/qa-results/attachments', ...profile.projects.map(project => '--project=' + project)];
    const result = spawnSync(process.execPath, args, { stdio: 'ignore', timeout: profile.timeoutSeconds * 1000 });
    return Number.isInteger(result.status) ? result.status : 1;
  }
  const cypress = require('/opt/qa/node_modules/cypress');
  const result = await cypress.run({ project: root, spec: profile.specs.join(','), headless: true, record: false,
    config: { retries: { runMode: profile.retries, openMode: 0 }, video: false, screenshotsFolder: '/qa-results/attachments' },
    env: { QA_DATASET_NAMESPACE: profile.namespace || '' } });
  if (!Array.isArray(result.runs)) throw new Error('Cypress did not return run results');
  const tests = result.runs.flatMap(run => (run.tests || []).map(test => {
    const id = crypto.createHash('sha256').update(JSON.stringify([run.spec.relative.split(path.sep).join('/'), '', test.title])).digest('hex');
    return { id, attempts: (test.attempts || []).map((attempt, retry) => ({ retry,
      status: attempt.state === 'pending' ? 'skipped' : attempt.state,
      durationMs: Math.round(attempt.wallClockDuration || 0) })) };
  }));
  if (result.totalTests !== tests.length || tests.length > 100) throw new Error('Cypress inventory mismatch');
  const failed = Boolean(result.totalFailed || result.failures || result.runs.some(run => run.error));
  const report = { schemaVersion: 1, framework: 'cypress', frameworkVersion: version, revision: profile.revision,
    runnerStatus: failed ? 'failed' : 'passed', tests };
  const raw = JSON.stringify(report);
  if (Buffer.byteLength(raw) > 64000) throw new Error('QA report budget exceeded');
  fs.writeFileSync('/qa-results/report.json', raw, { flag: 'wx' });
  return failed ? 1 : 0;
}

main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
