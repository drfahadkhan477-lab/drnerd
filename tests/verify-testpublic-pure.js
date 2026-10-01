#!/usr/bin/env node
'use strict';
/*
 * `npm test` runs every check that needs no export, and says so honestly.
 *
 *   node tests/verify-testpublic-pure.js
 *
 * scripts/test-public.js takes its suite list from the workflow, so the first
 * half here holds that reading to the workflow itself: the pure suites are the
 * ones that launch no browser, the browser suites are the ones that do, and
 * nothing the two jobs invoke is dropped. The second half runs it on invented
 * suites in a temporary folder — tiny scripts that pass or fail on purpose —
 * because a runner is only as good as what it does with a failure, a missing
 * file, a browser that is not there, and the half it did not run.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { blankComments } = require('./_source.js');
const { suitesFromWorkflow, run } = require('../scripts/test-public.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const ROOT = path.join(__dirname, '..');

head('the list is the workflow’s, split the way the suites actually are');
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
const { pure, browser } = suitesFromWorkflow(yml);
/* The same "uses a browser" rule verify-stats and verify-engine apply. */
const launches = n => {
  const code = blankComments(fs.readFileSync(path.join(__dirname, `${n}.js`), 'utf8'));
  return /^[^'"`\n]*require\(\s*'playwright'\s*\)/m.test(code) || /^[^'"`\n]*\blaunch\(/m.test(code);
};
ok('it finds the pure suites', pure.length > 20, `${pure.length}`);
ok('and the browser suites', browser.length > 0, browser.join(', '));
ok('no pure suite launches a browser', pure.every(n => !launches(n)), pure.filter(launches).join(', ') || 'none');
ok('every browser suite does', browser.every(launches), browser.filter(n => !launches(n)).join(', ') || 'none');
const all = [...yml.matchAll(/node\s+tests\/(verify-[a-z0-9-]+)\.js/g)].map(m => m[1]);
ok('together they are every suite the workflow runs, each once',
   JSON.stringify(pure.concat(browser).sort()) === JSON.stringify(all.slice().sort()), `${pure.length + browser.length} of ${all.length}`);

head('reading a workflow');
const Y = (logic, browserJob, after) =>
  `jobs:\n  logic:\n    steps:\n${logic.map(n => `      - name: ${n} (1 checks)\n        run: node tests/${n}.js\n`).join('')}` +
  `  memorizer-browser:\n    strategy:\n      matrix:\n        engine: [chromium]\n    steps:\n${browserJob.map(n => `      - name: ${n}\n        run: node tests/${n}.js\n`).join('')}` +
  (after ? `  build-guard:\n    steps:\n      - run: node tests/${after}.js\n` : '');
{
  const s = suitesFromWorkflow(Y(['verify-a', 'verify-b'], ['verify-c'], 'verify-z'));
  ok('a job’s suites end where the next job begins', JSON.stringify(s) === JSON.stringify({ pure: ['verify-a', 'verify-b'], browser: ['verify-c'] }), JSON.stringify(s));
  let msg = '';
  try { suitesFromWorkflow('jobs:\n  logic:\n    steps: []\n'); } catch (e) { msg = e.message; }
  ok('a workflow without the browser job is refused, not read as zero browser suites', /no memorizer-browser job/.test(msg), msg || 'accepted');
}

head('running them');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'testpublic-'));
fs.mkdirSync(path.join(TMP, 'tests'));
const suite = (n, body) => fs.writeFileSync(path.join(TMP, 'tests', n + '.js'), body);
suite('verify-a', 'process.exit(0)');
suite('verify-b', 'console.log("  FAIL  zq"); process.exit(1)');
suite('verify-c', 'process.exit(process.env.SYSTOLE_ENGINE === "webkit" ? 0 : 3)');
const go = (logic, br, opts) => {
  const lines = [];
  const r = run(Object.assign({ root: TMP, yml: Y(logic, br), log: s => lines.push(s) }, opts));
  return Object.assign(r, { text: lines.join('\n') });
};
{
  const r = go(['verify-a', 'verify-b'], ['verify-c'], { pure: true });
  ok('a failing suite fails the run, and is named', r.code === 1 && JSON.stringify(r.failed) === '["verify-b"]', JSON.stringify(r.failed));
}
{
  const r = go(['verify-a', 'verify-gone'], ['verify-c'], { pure: true });
  ok('a suite whose file is missing is a failure, not a skip', r.code === 1 && r.failed.includes('verify-gone'), JSON.stringify(r.failed));
}
{
  const r = go(['verify-a'], ['verify-c'], { pure: true });
  const last = r.text.trim().split('\n').slice(-2)[0];
  ok('--pure passes on passing suites', r.code === 0 && r.ran.length === 1);
  ok('and says which browser suites it did not run, never "all"',
     /browser suites NOT run: verify-c/.test(last) && !/\ball\b/.test(last), last);
}
{
  /* engine pinned: the hint names the engine asked for, so an ambient
     SYSTOLE_ENGINE=webkit would otherwise make it say webkit. */
  const r = go(['verify-a'], ['verify-c'], { engine: 'chromium', executablePath: path.join(TMP, 'no-such-browser') });
  ok('with no browser installed, nothing runs and the run fails', r.code === 1 && r.ran.length === 0, JSON.stringify(r.ran));
  ok('and it says how to install one, or to run the pure half', /npx playwright install chromium/.test(r.text) && /test:pure/.test(r.text));
}
{
  const r = go(['verify-a'], ['verify-c'], { executablePath: process.execPath, engine: 'webkit' });
  ok('the full run runs the browser suites too, on the engine asked for', r.code === 0 && JSON.stringify(r.ran) === '["verify-a","verify-c"]', r.failed.join(',') || JSON.stringify(r.ran));
  const r2 = go(['verify-a'], ['verify-c'], { executablePath: process.execPath, engine: 'chromium' });
  ok('and a suite sees the engine it was handed, not a default', r2.code === 1 && r2.failed.includes('verify-c'));
  let msg = '';
  try { go(['verify-a'], ['verify-c'], { engine: 'safari' }); } catch (e) { msg = e.message; }
  ok('an engine that is not one is refused before anything runs', /not an engine/.test(msg), msg || 'accepted');
  msg = '';
  try { go([], ['verify-c'], { pure: true }); } catch (e) { msg = e.message; }
  ok('a logic job with no suites is refused, not reported as a pass', /invokes no suites/.test(msg), msg || 'accepted');
}
fs.rmSync(TMP, { recursive: true, force: true });

head('the commands say what they run');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
ok('npm test is the no-export run', pkg.scripts.test === 'node scripts/test-public.js', pkg.scripts.test);
ok('npm run test:pure is its browser-free half', pkg.scripts['test:pure'] === 'node scripts/test-public.js --pure', pkg.scripts['test:pure']);
ok('npm run test:private is the whole registry against your build', pkg.scripts['test:private'] === 'node scripts/verify.js', pkg.scripts['test:private']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
