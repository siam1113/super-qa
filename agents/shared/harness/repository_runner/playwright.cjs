'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const profile = JSON.parse(fs.readFileSync('/qa-profile.json', 'utf8'));
const identify = test => {
  const titles = [test.title];
  for (let suite = test.parent; suite && suite.type === 'describe'; suite = suite.parent) titles.unshift(suite.title);
  if (typeof test.parent.type !== 'string') throw new Error('QA reporter requires Playwright 1.44 or newer');
  return crypto.createHash('sha256').update(JSON.stringify([
    path.relative(process.cwd(), test.location.file).split(path.sep).join('/'),
    test.parent.project()?.name || '', titles,
  ])).digest('hex');
};

module.exports = class QAReporter {
  onBegin(config, suite) {
    this.tests = suite.allTests().map(test => ({ nativeId: test.id, id: identify(test), attempts: [] }));
    if (this.tests.length > 100) throw new Error('QA test inventory budget exceeded');
  }
  onTestEnd(test, result) {
    const record = this.tests.find(item => item.nativeId === test.id);
    if (!record || record.attempts.length >= 3) throw new Error('QA attempt inventory mismatch');
    record.attempts.push({ retry: result.retry, status: result.status, durationMs: Math.round(result.duration) });
  }
  onEnd(result) {
    const report = { schemaVersion: 1, framework: 'playwright', frameworkVersion: process.env.QA_FRAMEWORK_VERSION,
      revision: profile.revision, runnerStatus: result.status,
      tests: (this.tests || []).map(({ id, attempts }) => ({ id, attempts })) };
    const raw = JSON.stringify(report);
    if (Buffer.byteLength(raw) > 64000) throw new Error('QA report budget exceeded');
    fs.writeFileSync('/qa-results/report.json', raw, { flag: 'wx' });
  }
};
