#!/usr/bin/env node
'use strict';
/*
 * The developer tools: each build in its own workspace, suite tags read from
 * the code, a JSON report that carries no output text, `npm run doctor`, and
 * a `clean` that cannot reach the export.
 *
 *   node tests/verify-devtools-pure.js
 *
 * No export, no browser. The build is run on an invented page that its first
 * step refuses, which is enough to see where it worked and what it left.
 * clean runs in a temporary folder laid out like the repository, with a
 * stand-in export in source/ that it must never touch.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'devtools-'));
const node = (args, env) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });

(async () => {
  head('scripts/build.js: each run in its own workspace, and nothing half-written left behind');
  {
    const fake = path.join(TMP, 'zq-not-an-export.html');
    fs.writeFileSync(fake, '<html><head></head><body>zq</body></html>');
    const out = path.join(TMP, 'out.html');
    fs.writeFileSync(out, 'the previous build');
    const work = path.join(ROOT, 'build', '.work');
    const before = fs.existsSync(work) ? fs.readdirSync(work).sort() : [];
    const r = node([path.join(ROOT, 'scripts', 'build.js'), fake, '--out', out]);
    const after = fs.existsSync(work) ? fs.readdirSync(work).sort() : [];
    ok('a build its first step refuses fails', r.status !== 0, `exit ${r.status}`);
    ok('and leaves the previous output exactly as it was', fs.readFileSync(out, 'utf8') === 'the previous build');
    ok('and no workspace of its own behind', JSON.stringify(after) === JSON.stringify(before), after.filter(x => !before.includes(x)).join(', ') || 'none');
    ok('and no step files in build/ itself', !fs.existsSync(path.join(ROOT, 'build', 'stage0.html')));
    /* Where the steps are written, from the source: a run that is not --keep
       or --from must not share build/<step>.html. Read blanked, as the rule is. */
    const { blankComments } = require('./_source.js');
    const src = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8'));
    ok('a normal run\'s workspace is build/.work/run-<pid>-<time>, and only --keep or --from share build/',
       /const SHARED = KEEP \|\| !!FROM;/.test(src) && /'\.work', `run-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/.test(src));
  }

  head('suite tags: read from each suite\'s code');
  {
    const { tagsOf } = require('./_targets.js');
    ok('a suite that launches a browser and reads a build is browser and build', JSON.stringify(tagsOf('home')) === '["browser","build"]', JSON.stringify(tagsOf('home')));
    ok('one that only launches a browser is browser', JSON.stringify(tagsOf('bankstore')) === '["browser"]', JSON.stringify(tagsOf('bankstore')));
    ok('one that does neither is pure — verify-engine requires _engine and launches nothing', JSON.stringify(tagsOf('engine')) === '["pure"]', JSON.stringify(tagsOf('engine')));
    ok('and so is this one', JSON.stringify(tagsOf('devtools-pure')) === '["pure"]');
    /* The CI logic job is the set of pure suites CI can run: every one of
       them must be tagged pure, or the tag and the job disagree. */
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
    const logic = yml.slice(yml.indexOf('\n  logic:'), yml.indexOf('\n  memorizer-browser:'));
    const inLogic = [...logic.matchAll(/node\s+tests\/verify-([a-z0-9-]+)\.js/g)].map(m => m[1]);
    const notPure = inLogic.filter(n => tagsOf(n).join() !== 'pure');
    ok('every suite in CI\'s logic job is tagged pure', inLogic.length > 20 && notPure.length === 0, notPure.join(', ') || `${inLogic.length} suites`);
  }

  head('verify.js --tag and --report-json');
  {
    const target = path.join(TMP, 'target.html'); fs.writeFileSync(target, 'x');
    const rep = path.join(TMP, 'report.json');
    const r = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine,keys', '--tag', 'pure', '--report-json', rep]);
    let doc = null; try { doc = JSON.parse(fs.readFileSync(rep, 'utf8')); } catch (_) {}
    ok('--tag pure runs only the pure ones of those asked for', !!doc && doc.suites.map(s => s.suite).join() === 'engine', doc ? doc.suites.map(s => s.suite).join() : `no report (exit ${r.status})`);
    ok('the report says suite, tags, status, counts and time', !!doc && doc.format === 'systole-verify-report' && doc.suites[0].status === 'pass' &&
       doc.suites[0].checks > 50 && doc.suites[0].checks === doc.suites[0].passed && JSON.stringify(doc.suites[0].tags) === '["pure"]' && doc.suites[0].durationMs > 0,
       doc ? JSON.stringify(doc.suites[0]) : '');
    ok('and no line of output and no path', !!doc && !/PASS|FAIL|→/.test(JSON.stringify(doc)) && !JSON.stringify(doc).includes(TMP) && doc.target === 'file');
    const bad = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--tag', 'zqtag']);
    ok('a tag that is not one is refused before anything runs', bad.status === 1 && /is not a tag/.test(bad.stderr), bad.stderr.trim().split('\n')[0]);
    /* A failing suite is reported as failing: a stand-in suite in a copy of
       the registry would need a copy of the repository, so this reads the
       mapping from the source instead. */
    const { blankComments } = require('./_source.js');
    const vsrc = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8'));
    ok('a suite that died is "died", one that failed is "fail" — never "pass"', /status: r\.failed === null \? 'died' : \(r\.ok \? 'pass' : 'fail'\)/.test(vsrc));
  }

  head('npm run doctor');
  {
    const { diagnose, format } = require('../scripts/doctor.js');
    const fakeRoot = path.join(TMP, 'doc'); fs.mkdirSync(path.join(fakeRoot, 'source'), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }));
    fs.writeFileSync(path.join(fakeRoot, 'source', 'ACCSAP_zqsecret_title.html'), 'x');
    const base = { npmVersion: () => '10.0.0', git: () => 'git version 2', gitDirty: () => false, hooksPath: () => '.githooks',
                   playwright: () => ({ chromium: { executablePath: () => '/c' }, webkit: { executablePath: () => '/w' } }),
                   exists: p => p === '/c' || p === '/w' || fs.existsSync(p), portFree: async () => true, env: () => undefined };
    const good = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '20.11.0' }) }));
    ok('a ready machine exits 0 and says so', good.code === 0 && /Ready: npm test/.test(good.text), good.text.split('\n').pop());
    const old = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '18.19.0' }) }));
    ok('Node older than package.json wants is required: exit 1, with the fix', old.code === 1 && /✗ Node .*18\.19\.0/.test(old.text) && /fix: install Node 20/.test(old.text), old.text.split('\n')[0]);
    const noPw = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '22.0.0', playwright: () => null }) }));
    ok('no test tools is a warning, not a failure, and names npm ci', noPw.code === 0 && /! test tools \(playwright\)\s+not installed\n\s+fix: npm ci/.test(noPw.text));
    const noWk = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '22.0.0', exists: p => p === '/c' || fs.existsSync(p) }) }));
    ok('a missing browser names the install command for that browser', /! webkit for the browser suites\s+not installed\n\s+fix: npx playwright install webkit/.test(noWk.text));
    ok('the export is counted, never named', /licensed export.*1 found in source\//.test(good.text) && !/zqsecret/.test(good.text + old.text + noPw.text));
  }

  head('npm run clean, and clean:private');
  {
    const { clean } = require('../scripts/clean.js');
    const R = path.join(TMP, 'repo');
    const put = (rel, body) => { const f = path.join(R, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body || 'x'); };
    ['source/ACCSAP_export.html', 'content/refs-repo/note.md', 'content/refs/unit.md', 'content/questions.json', 'content/manifest.json',
     'content/figures/a.webp', 'build/systole.html', 'build/.work/run-1/stage0.html', 'dist/index.html', 'dist-memorizer/index.html'].forEach(f => put(f));
    const has = rel => fs.existsSync(path.join(R, rel));
    const pub = clean({ root: R });
    ok('the public clean removes only what a clone makes again without the export',
       !has('dist-memorizer') && !has('build/.work') && has('build/systole.html') && has('dist/index.html') && has('content/questions.json'), pub.removed.join(', '));
    const dry = clean({ root: R, private: true });
    ok('the private clean without --yes removes nothing, lists what it would, and exits non-zero',
       dry.code === 1 && has('build/systole.html') && has('dist/index.html') && dry.listed.length === 5, dry.listed.join(', '));
    const wet = clean({ root: R, private: true, yes: true });
    ok('with --yes it removes build/, dist/ and the three files extract-content writes',
       wet.code === 0 && !has('build') && !has('dist') && !has('content/questions.json') && !has('content/manifest.json') && !has('content/figures'), wet.removed.join(', '));
    ok('and never the export, the notes, or the notes\' submodule',
       has('source/ACCSAP_export.html') && has('content/refs/unit.md') && has('content/refs-repo/note.md'));
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
