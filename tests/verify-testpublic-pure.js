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
const { pure, browser, synthetic } = suitesFromWorkflow(yml);
const synNames = synthetic.suites.map(x => x.name);
/* The same "uses a browser" rule verify-stats and verify-engine apply. */
/* The rule verify.js tags suites with (tests/_targets.js tagsOf), not a copy
   of it: a copy here saw only direct launches. */
const launches = n => require('./_targets.js').tagsOf(n.replace(/^verify-/, '')).includes('browser');
ok('it finds the pure suites', pure.length > 20, `${pure.length}`);
ok('and the browser suites', browser.length > 0, browser.join(', '));
ok('no pure suite launches a browser', pure.every(n => !launches(n)), pure.filter(launches).join(', ') || 'none');
ok('every browser suite does', browser.every(launches), browser.filter(n => !launches(n)).join(', ') || 'none');
/* Each suite once: synthetic-webkit runs some of the synthetic job's suites
   again in WebKit, and npm test runs them once, in the engine it is given. A
   suite only that job named would still be missing below. */
const all = [...new Set([...yml.matchAll(/node\s+tests\/(verify-[a-z0-9-]+)\.js/g)].map(m => m[1]))];
ok('the synthetic job\u2019s suites are found, each with a target', synNames.length > 0 && synthetic.suites.every(x => /\.html$/.test(x.target)),
   `${synNames.length} suites`);
ok('and every one of them launches a browser', synNames.every(launches), synNames.filter(n => !launches(n)).join(', ') || 'none');
ok('the commands that build their target are found, and each script exists',
   synthetic.build.length >= 2 && synthetic.build.every(([s]) => fs.existsSync(path.join(ROOT, s))),
   synthetic.build.map(c => c[0]).join(', '));
ok('and the last of them writes the target the suites read',
   synthetic.build.length > 0 && synthetic.suites.every(x => synthetic.build[synthetic.build.length - 1].includes(x.target)));
ok('together they are every suite the workflow runs, each once',
   JSON.stringify(pure.concat(browser, synNames).sort()) === JSON.stringify(all.slice().sort()), `${pure.length + browser.length + synNames.length} of ${all.length}`);

head('the workflow runs once per commit');
{
  /* A push to a branch with a pull request fired this workflow as `push` and
     as `pull_request`: every job twice per commit. Held in the workflow's own
     trigger block, comments blanked. */
  const top = yml.slice(yml.indexOf('\non:'), yml.indexOf('\njobs:')).replace(/#.*$/gm, '');
  ok('`push` is for master only, so a branch with a pull request is not run twice',
     /\n\s+push:\s*\n\s+branches:\s*\[\s*master\s*\]/.test(top), top.replace(/\s+/g, ' ').slice(0, 120));
  ok('pull requests are still tested', /\n\s+pull_request:/.test(top));
  ok('a newer push cancels the pull request run before it, and never a master run',
     /cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/.test(top));
}

head('reading a workflow');
const SYN = syn => !syn ? '' : `  synthetic-browser:\n    steps:\n      - name: build\n        run: |\n${syn.build.map(c => `          node ${c.join(' ')}\n`).join('')}` +
  syn.suites.map(n => `      - name: ${n} (1 checks)\n        run: node tests/${n}.js ${syn.target}\n`).join('');
const Y = (logic, browserJob, after, syn) =>
  `jobs:\n  logic:\n    steps:\n${logic.map(n => `      - name: ${n} (1 checks)\n        run: node tests/${n}.js\n`).join('')}` +
  `  memorizer-browser:\n    strategy:\n      matrix:\n        engine: [chromium]\n    steps:\n${browserJob.map(n => `      - name: ${n}\n        run: node tests/${n}.js\n`).join('')}` +
  SYN(syn) + (after ? `  build-guard:\n    steps:\n      - run: node tests/${after}.js\n` : '');
{
  const s = suitesFromWorkflow(Y(['verify-a', 'verify-b'], ['verify-c'], 'verify-z'));
  ok('a job’s suites end where the next job begins', JSON.stringify(s) === JSON.stringify({ pure: ['verify-a', 'verify-b'], browser: ['verify-c'], synthetic: { build: [], suites: [] } }), JSON.stringify(s));
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
suite('verify-g', 'process.exit(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0"].some(k => k in process.env) ? 4 : 0)');
const go = (logic, br, opts, syn) => {
  const lines = [];
  const r = run(Object.assign({ root: TMP, yml: Y(logic, br, null, syn), log: s => lines.push(s) }, opts));
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
{
  /* What git hands the commands it runs: a linked worktree's pre-push hook
     gets GIT_DIR and its siblings, and `git -c …` (or `rebase -x`, `bisect
     run`) passes its settings on. A suite that inherits them runs its
     throwaway repositories' git commands against the real one, or with the
     caller's settings. */
  const VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0'];
  const keep = {}; for (const k of VARS) keep[k] = process.env[k];
  Object.assign(process.env, { GIT_DIR: path.join(TMP, 'not-this'), GIT_WORK_TREE: TMP, GIT_INDEX_FILE: path.join(TMP, 'idx'),
    GIT_CONFIG_PARAMETERS: "'commit.gpgsign'='true'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare' });
  let r;
  try { r = go(['verify-g'], [], { pure: true }); }
  finally { for (const k in keep) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  ok('a suite run from a git hook does not inherit where git looks for the repository', r.code === 0 && r.ran.includes('verify-g'), JSON.stringify(r.failed));
}
head('the synthetic build, then its suites');
{
  /* A build that writes the target, a suite that passes only when handed a
     target that exists, and a suite that leaves a mark when it runs at all. */
  fs.mkdirSync(path.join(TMP, 'scripts'));
  fs.writeFileSync(path.join(TMP, 'scripts', 'mk.js'), 'require("fs").writeFileSync(process.argv.slice(2)[0], "x")');
  fs.writeFileSync(path.join(TMP, 'scripts', 'broken.js'), 'process.exit(1)');
  /* argv.slice, not argv[2], in both fixtures: tests/_targets.js tags a
     suite "build" when its source binds argv[2], and verify-engine expects a
     suite that mentions it to bind a target. A fixture's text is in this
     suite's source, so it read as this suite taking a build. */
  suite('verify-s', 'const f = process.argv.slice(2)[0]; require("fs").writeFileSync(require("path").join(__dirname, "ran-s"), "1"); process.exit(f && require("fs").existsSync(f) ? 0 : 4)');
  const T = path.join(TMP, 'syn.html');
  const parsed = suitesFromWorkflow(Y(['verify-a'], ['verify-c'], null, { build: [['scripts/mk.js', T]], suites: ['verify-s'], target: T }));
  ok('a synthetic job is read as its build and its suites, each with its target',
     JSON.stringify(parsed.synthetic) === JSON.stringify({ build: [['scripts/mk.js', T]], suites: [{ name: 'verify-s', target: T }] }),
     JSON.stringify(parsed.synthetic));
  const good = go(['verify-a'], [], { executablePath: process.execPath, engine: 'chromium' },
                  { build: [['scripts/mk.js', T]], suites: ['verify-s'], target: T });
  ok('the build runs first, and each suite is handed the target', good.code === 0 && good.ran.includes('verify-s'),
     good.failed.join(',') || JSON.stringify(good.ran));
  fs.rmSync(T, { force: true }); fs.rmSync(path.join(TMP, 'tests', 'ran-s'), { force: true });
  const bad = go(['verify-a'], [], { executablePath: process.execPath, engine: 'chromium' },
                 { build: [['scripts/broken.js'], ['scripts/mk.js', T]], suites: ['verify-s'], target: T });
  ok('a build that fails fails its suites, rather than skipping them', bad.code === 1 && bad.failed.includes('verify-s'), JSON.stringify(bad.failed));
  ok('and they are not run against a build that is not there', !fs.existsSync(path.join(TMP, 'tests', 'ran-s')) && !fs.existsSync(T));
  ok('and the run says the build is why', /synthetic build failed at scripts\/broken\.js/.test(bad.text));
  fs.rmSync(T, { force: true });
  const p = go(['verify-a'], [], { pure: true }, { build: [['scripts/mk.js', T]], suites: ['verify-s'], target: T });
  ok('--pure names them among the suites it did not run', p.notRun.includes('verify-s') && !fs.existsSync(T), JSON.stringify(p.notRun));
}
fs.rmSync(TMP, { recursive: true, force: true });

head('the commands say what they run');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
ok('npm test is the no-export run', pkg.scripts.test === 'node scripts/test-public.js', pkg.scripts.test);
ok('npm run test:pure is its browser-free half', pkg.scripts['test:pure'] === 'node scripts/test-public.js --pure', pkg.scripts['test:pure']);
ok('npm run test:private is the whole registry against your build', pkg.scripts['test:private'] === 'node scripts/verify.js', pkg.scripts['test:private']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
