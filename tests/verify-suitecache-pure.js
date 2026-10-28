#!/usr/bin/env node
'use strict';
/*
 * A browser suite's pass is reused when, and only when, nothing it depended on
 * has changed — in bare Node, no browser.
 *
 *   node tests/verify-suitecache-pure.js
 *
 * scripts/suite-cache.js remembers a pass with what the run read (watched by
 * scripts/trace-inputs.js), and scripts/test-public.js reuses it. A cache that
 * is wrong fails in the worst direction: it says PASS about code nobody ran.
 * So this holds it from both sides. A pass must NOT be reused when the suite,
 * a file it read, a file it asked about and did not find, a directory it
 * listed, the build it was handed, a variable its source reads, the day,
 * Playwright, the engine, or a file a CHILD of it read has changed; and it
 * MUST be reused when only something irrelevant did (a file's mtime, another
 * suite's data, a build stamp, a variable nothing reads), or the cache is
 * only a slow way of re-running everything.
 *
 * The runner is driven the way tests/verify-testpublic-pure.js drives it: the
 * real run() on invented suites in a temporary folder. Each invented suite
 * appends its name to out/runs.log when it RUNS. A write is not an input, so
 * the log is the proof of execution, and a reuse is a run that left no line.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('../scripts/test-public.js');
const SC = require('../scripts/suite-cache.js');
const TR = require('../scripts/trace-inputs.js');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'suitecache-')));
const R = path.join(TMP, 'proj');
const LOG = path.join(R, 'out', 'runs.log');
const w = (rel, text) => { const f = path.join(R, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const PRE = "const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');\n" +
  "const R = path.join(__dirname, '..');\n" +
  "fs.appendFileSync(path.join(R, 'out', 'runs.log'), path.basename(__filename, '.js') + '\\n');\n";
const suite = (name, body) => w('tests/' + name + '.js', PRE + body + '\n');
const flagFile = tag => path.join(os.tmpdir(), 'suitecache-' + tag + '-' + process.pid);

/* The invented suites, each reading what its name says. */
suite('verify-pure', 'void 0;');
suite('verify-a', "fs.readFileSync(path.join(R, 'data', 'a.txt'), 'utf8');");
suite('verify-b', "fs.readFileSync(path.join(R, 'data', 'b.txt'), 'utf8');");
suite('verify-flag', "fs.existsSync(path.join(R, 'data', 'flag')); fs.readdirSync(path.join(R, 'data', 'dir'));");
suite('verify-env', 'void process.env.PROBE_ENV;');
suite('verify-dynenv', "for (const k of ['PROBE_DYN']) void process.env[k];");
suite('verify-child', "cp.execFileSync(process.execPath, [path.join(R, 'scripts', 'child.js')]);");
suite('verify-child2', "cp.execFileSync(process.execPath, [path.join(R, 'scripts', 'child2.js')], { env: { PATH: process.env.PATH || '' } });");
suite('verify-mode', "if (fs.readFileSync(path.join(R, 'data', 'mode.txt'), 'utf8').trim() === 'bad') { console.log('  FAIL  the mode is bad'); process.exit(1); }");
suite('verify-flaky', "if (fs.existsSync(path.join(os.tmpdir(), 'suitecache-flaky-' + process.ppid))) { console.log('  FAIL  it flaked'); process.exit(1); }");
suite('verify-spawn', "cp.spawnSync(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/c', 'exit 0'] : ['-c', 'true']);");
suite('verify-touch', "const f = path.join(R, 'data', 'm.txt'); fs.readFileSync(f); fs.appendFileSync(f, 'x');");
suite('verify-recursive', "fs.readdirSync(path.join(R, 'data', 'tree'), { recursive: true });");
suite('verify-cp', "fs.cpSync(path.join(R, 'data', 'cpdir'), path.join(os.tmpdir(), 'suitecache-cp-' + process.ppid), { recursive: true });");
suite('verify-target', 'void 0;');
suite('verify-readtarget', "fs.readFileSync(path.join(R, 'build', 't.html'));");
w('scripts/child.js', "require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'c.txt'));\n");
w('scripts/child2.js', "require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'c2.txt'));\n");
/* The build both synthetic suites are handed: a page whose stamp names a commit. */
w('scripts/mkt.js', "const fs = require('fs'), path = require('path'); const R = path.join(__dirname, '..');\n" +
  "const body = fs.readFileSync(path.join(R, 'data', 'page.txt'), 'utf8'), commit = fs.readFileSync(path.join(R, 'data', 'commit.txt'), 'utf8').trim();\n" +
  "fs.mkdirSync(path.join(R, 'build'), { recursive: true });\n" +
  "fs.writeFileSync(path.join(R, 'build', 't.html'), '<html><head>' + body + '<!-- systole-build 0123456789abcdef commit ' + commit + ' -->\\n</head></html>');\n");
fs.mkdirSync(path.join(R, 'out'), { recursive: true });
for (const [f, t] of [['a.txt', 'one'], ['b.txt', 'one'], ['c.txt', 'one'], ['c2.txt', 'one'], ['mode.txt', 'ok'], ['m.txt', 'one'], ['page.txt', 'one'], ['commit.txt', 'aaaaaaaaaaaa']]) w('data/' + f, t);
w('data/dir/x.txt', 'x'); w('data/tree/sub/y.txt', 'y'); w('data/cpdir/sub/z.txt', 'z');

const BROWSER = ['verify-a', 'verify-b', 'verify-dynenv', 'verify-flag', 'verify-env', 'verify-child', 'verify-child2', 'verify-mode', 'verify-flaky', 'verify-spawn', 'verify-touch', 'verify-recursive', 'verify-cp'];
const SYN = ['verify-target', 'verify-readtarget'];
const yml = (browser, syn) => 'jobs:\n  logic:\n    steps:\n      - name: pure (1 checks)\n        run: node tests/verify-pure.js\n' +
  '  public-browser:\n    strategy:\n      matrix:\n        engine: [chromium]\n    steps:\n' + browser.map(n => `      - name: ${n}\n        run: node tests/${n}.js\n`).join('') +
  (syn.length ? '  synthetic-browser:\n    steps:\n      - name: build\n        run: |\n          node scripts/mkt.js build/t.html\n' +
    syn.map(n => `      - name: ${n} (1 checks)\n        run: node tests/${n}.js build/t.html\n`).join('') : '');

let NOW = new Date('2026-10-14T12:00:00'), OVERRIDE = {};
const executed = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : []);
const reset = () => fs.writeFileSync(LOG, '');
/* One run of the real runner over the named suites. `cacheOpts` reaches the
   cache; `engine` changes which entries are consulted. Returns what ran. */
function go(names, cacheOpts = {}, o = {}) {
  reset();
  const lines = [];
  const browser = names.filter(n => !SYN.includes(n)), syn = names.filter(n => SYN.includes(n));
  const r = run(Object.assign({ root: R, yml: yml(browser, syn), engine: 'chromium', executablePath: process.execPath, log: s => lines.push(s),
    cache: ({ root, engine }) => SC.open(Object.assign({ root, engine, now: () => NOW, override: OVERRIDE, allowSpawn: () => false, commit: 'abc1234' }, cacheOpts)) }, o));
  const ran = executed().filter(n => n !== 'verify-pure');
  return Object.assign(r, { text: lines.join('\n'), execs: ran, pureRuns: executed().filter(n => n === 'verify-pure').length });
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const withEnv = (vars, fn) => {
  const keep = {}; for (const k in vars) { keep[k] = process.env[k]; if (vars[k] === null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k in keep) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const touchLater = f => { const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t); };

head('a pass is remembered, and a second run measures nothing it need not');
{
  const cold = go(['verify-a', 'verify-b']);
  ok('a cold run runs both suites, and says it measured them', same(cold.execs, ['verify-a', 'verify-b']) && same(cold.ran.filter(n => n !== 'verify-pure'), ['verify-a', 'verify-b']) && cold.reused.length === 0, cold.execs.join(','));
  ok('and the cold run keeps its old, plain summary line', /all 3 no-export suites passed \(1 pure, 2 in chromium, 0 of them on a synthetic build\)\./.test(cold.text), cold.text.split('\n').slice(-3)[0]);
  ok('it writes under node_modules/.cache of the root it ran in', fs.existsSync(path.join(R, 'node_modules', '.cache', 'systole-suite-results')));
  const warm = go(['verify-a', 'verify-b']);
  ok('a second run executes neither of them', warm.execs.length === 0, warm.execs.join(',') || 'none');
  ok('it reports both as reused, and as not measured', same(warm.reused, ['verify-a', 'verify-b']) && !warm.ran.some(n => /^verify-[ab]$/.test(n)), JSON.stringify(warm.reused));
  ok('a reused suite is printed REUSED, never PASS', /REUSED\s+verify-a/.test(warm.text) && !/PASS\s+verify-a/.test(warm.text) && !/PASS\s+verify-b/.test(warm.text));
  ok('the last line splits measured now from reused, and names the way to measure all',
     /all 3 no-export suites passed: 1 measured now, 2 REUSED/.test(warm.text) && /npm run test:fresh/.test(warm.text), warm.text.split('\n').filter(l => /no-export/.test(l)).join(' | '));
  ok('and the pure suite is measured every time', warm.pureRuns === 1 && warm.ran.includes('verify-pure'));
  ok('a run that reuses passes still exits 0', warm.code === 0);
}

head('reused when something irrelevant changes');
{
  go(['verify-a', 'verify-b']);
  touchLater(path.join(R, 'data', 'a.txt'));
  ok('a file touched and not changed', go(['verify-a', 'verify-b']).execs.length === 0);
  w('data/unrelated.txt', 'noise');
  ok('a file no suite read', go(['verify-a', 'verify-b']).execs.length === 0);
  /* From an empty cache and under the variable, so that the pass kept holds it if the cache holds every variable: an older pass made without it
     would otherwise match and hide the difference. */
  fs.rmSync(SC.cacheDir(R), { recursive: true, force: true });
  withEnv({ PROBE_UNRELATED: 'x' }, () => go(['verify-a', 'verify-b']));
  withEnv({ PROBE_UNRELATED: 'y' }, () => ok('a variable no file it read mentions, changed from what it was when the pass was made', go(['verify-a', 'verify-b']).execs.length === 0));
}

head('re-measured when something it depended on changes — and only that suite');
{
  go(['verify-a', 'verify-b']);
  w('data/a.txt', 'two');
  const r = go(['verify-a', 'verify-b']);
  ok('a file it read: that suite runs, the other is reused', same(r.execs, ['verify-a']) && same(r.reused, ['verify-b']), r.execs.join(','));
  ok('and the run names the file that made it run', (() => { w('data/a.txt', 'three'); const p = go(['verify-a'], { plan: true }); return /RUN\s+verify-a\s+data\/a\.txt changed/.test(p.text); })());
  w('data/a.txt', 'one');
  ok('an edit undone finds the pass kept from before it: nothing runs', go(['verify-a', 'verify-b']).execs.length === 0);
  const before = fs.readFileSync(path.join(R, 'tests', 'verify-b.js'), 'utf8');
  fs.writeFileSync(path.join(R, 'tests', 'verify-b.js'), before + '// edited\n');
  const s = go(['verify-a', 'verify-b']);
  ok('the suite’s own file', same(s.execs, ['verify-b']) && same(s.reused, ['verify-a']), s.execs.join(','));
  fs.writeFileSync(path.join(R, 'tests', 'verify-b.js'), before);
}

head('within one run, a file hashed once is hashed again after it is edited');
{
  w('data/a.txt', 'one'); w('data/b.txt', 'one');
  go(['verify-a', 'verify-cp']);
  const mk = () => SC.open({ root: R, engine: 'chromium', now: () => NOW, override: OVERRIDE, allowSpawn: () => false, commit: 'abc1234' });
  const c = mk();
  ok('asked once, a pass whose inputs are as they were is reusable', c.decide('verify-a', []).reuse === true && c.decide('verify-cp', []).reuse === true);
  ok('and a pass made with no arguments is not a pass made with one', c.decide('verify-a', ['other.html']).reuse === false && c.decide('verify-a', []).reuse === true);
  /* the same length, so that only the clock and the content can tell them apart */
  const a = path.join(R, 'data', 'a.txt'); fs.writeFileSync(a, 'Q1x'); touchLater(a);
  const z = path.join(R, 'data', 'cpdir', 'sub', 'z.txt'); const zWas = fs.readFileSync(z, 'utf8'); fs.writeFileSync(z, zWas.replace(/./g, 'q'));
  const again = c.decide('verify-a', []);
  ok('asked again by the same cache after an edit of the same length, a file is not taken for what it was', again.reuse === false && /data\/a\.txt changed/.test(again.why), JSON.stringify(again));
  const tree = c.decide('verify-cp', []);
  ok('nor a file deep in a copied tree, whose directories’ own mtimes do not move', tree.reuse === false && /changed/.test(tree.why), JSON.stringify(tree));
  fs.writeFileSync(a, 'one'); fs.writeFileSync(z, zWas);
}

head('what a suite asked about and did not find is an input too');
{
  go(['verify-flag']);
  ok('unchanged, it is reused', go(['verify-flag']).execs.length === 0);
  w('data/flag', 'here');
  const r = go(['verify-flag']);
  ok('a file it asked for that now exists', same(r.execs, ['verify-flag']), r.execs.join(','));
  fs.rmSync(path.join(R, 'data', 'flag'));
  ok('and removing it again finds the earlier pass', go(['verify-flag']).execs.length === 0);
  w('data/dir/new.txt', 'n');
  const l = go(['verify-flag']);
  ok('a file added to a directory it listed', same(l.execs, ['verify-flag']), l.execs.join(','));
  ok('and the reason says a file was added', /has a file added, removed or renamed/.test(go(['verify-flag'], { plan: false, fresh: false }).text + (() => { w('data/dir/new2.txt', 'n'); return go(['verify-flag'], { plan: true }).text; })()));
  w('data/dir/x.txt', 'changed content');
  ok('but a listed file’s content, which it did not read, is not what it depended on', (() => { go(['verify-flag']); w('data/dir/x.txt', 'changed again'); return go(['verify-flag']).execs.length === 0; })());
}

head('what its children read, and what a tree it listed or copied holds');
{
  go(['verify-child', 'verify-child2']);
  ok('unchanged, both are reused', go(['verify-child', 'verify-child2']).execs.length === 0);
  w('data/c.txt', 'two');
  const a = go(['verify-child', 'verify-child2']);
  ok('a file a child process read', same(a.execs, ['verify-child']) && same(a.reused, ['verify-child2']), a.execs.join(','));
  w('data/c2.txt', 'two');
  const b = go(['verify-child', 'verify-child2']);
  ok('and one read by a child started with an environment of its own, which the tracer must put back', same(b.execs, ['verify-child2']), b.execs.join(','));
  go(['verify-recursive', 'verify-cp']);
  w('data/tree/sub/deep.txt', 'd');
  ok('a file added deep inside a directory it listed recursively', same(go(['verify-recursive', 'verify-cp']).execs, ['verify-recursive']));
  w('data/cpdir/sub/z.txt', 'zz');
  ok('and a file changed deep inside a directory it copied', same(go(['verify-recursive', 'verify-cp']).execs, ['verify-cp']));
}

head('the build it was handed, less the stamp that names the commit');
{
  const names = ['verify-target', 'verify-readtarget'];
  const cold = go(names);
  ok('both are measured on a cold run, behind the build step', same(cold.execs, names) && /build\s+node scripts\/mkt\.js/.test(cold.text), cold.execs.join(','));
  ok('and reused when the rebuilt page is identical', go(names).execs.length === 0);
  w('data/commit.txt', 'bbbbbbbbbbbb');
  const stamp = go(names);
  ok('a page that differs only in its stamp is the same app to a browser: the suite that did not read it in node is reused',
     !stamp.execs.includes('verify-target'), stamp.execs.join(',') || 'none');
  ok('but a suite that READ the file in node saw the stamp, which it could have measured: it runs', stamp.execs.includes('verify-readtarget'), stamp.execs.join(','));
  w('data/page.txt', 'two');
  ok('and a page that differs in its content runs both', same(go(names).execs, names));
}

head('a build that breaks is a failure, never a reuse');
{
  const names = ['verify-target', 'verify-readtarget'];
  w('data/commit.txt', 'aaaaaaaaaaaa'); w('data/page.txt', 'one');
  go(names);
  ok('warm: both suites are reused', go(names).execs.length === 0);
  const mk = fs.readFileSync(path.join(R, 'scripts', 'mkt.js'), 'utf8');
  w('scripts/mkt.js', "process.stderr.write('the assembler failed\\n'); process.exit(3);\n");
  const broken = go(names);
  ok('the page from the last good build is still on disk, and neither suite is reused on the strength of it',
     broken.code === 1 && broken.reused.length === 0 && broken.execs.length === 0 && same(broken.failed, names), JSON.stringify({ code: broken.code, reused: broken.reused, failed: broken.failed }));
  ok('and the run says the build failed', /synthetic build failed at scripts\/mkt\.js/.test(broken.text) || /FAIL\s+verify-target\s+synthetic build failed/.test(broken.text), broken.text.split('\n').filter(l => /build/.test(l)).slice(0, 2).join(' | ').replace(/FAIL/g, 'failed'));
  fs.writeFileSync(path.join(R, 'scripts', 'mkt.js'), mk);
  ok('mended, the pass from before it is there to be reused', go(names).execs.length === 0);
}

head('the environment, the clock, and the tools');
{
  go(['verify-env']);
  ok('a variable the suite’s own source reads, changed', withEnv({ PROBE_ENV: 'x' }, () => same(go(['verify-env']).execs, ['verify-env'])));
  ok('and set back, finds the earlier pass', go(['verify-env']).execs.length === 0);
  /* A read by a name the scan cannot see, built at run time. */
  go(['verify-dynenv']);
  ok('a variable read by a name built at run time, which no scan could name: one the file spells out in capitals, changed', withEnv({ PROBE_DYN: 'x' }, () => same(go(['verify-dynenv']).execs, ['verify-dynenv'])));
  ok('and any SYSTOLE_ variable, added', withEnv({ SYSTOLE_DYNTEST: 'x' }, () => same(go(['verify-dynenv']).execs, ['verify-dynenv'])));
  ok('and one that was already set when a pass was made, changed to another value', withEnv({ SYSTOLE_DYNTEST: 'y' }, () => same(go(['verify-dynenv']).execs, ['verify-dynenv'])));
  ok('and set back, the pass from before is found', go(['verify-dynenv']).execs.length === 0);
  ok('but a file that reads only by literal names does not take on every SYSTOLE_ variable', withEnv({ SYSTOLE_DYNTEST: 'y' }, () => go(['verify-env']).execs.length === 0));
  ok('a variable node and the browsers read (TZ)', withEnv({ TZ: 'Pacific/Kiritimati' }, () => same(go(['verify-env']).execs, ['verify-env'])));
  go(['verify-a']);
  OVERRIDE = { playwright: '9.9.9' };
  const p = go(['verify-a']);
  ok('Playwright’s version', same(p.execs, ['verify-a']), p.execs.join(','));
  OVERRIDE = { playwright: '8.8.8' };
  ok('and the plan says which part of the fingerprint moved', /RUN\s+verify-a\s+playwright \S+ → 8\.8\.8/.test(go(['verify-a'], { plan: true }).text));
  OVERRIDE = {};
  go(['verify-a']);
  OVERRIDE = { node: 'v99.0.0' };
  ok('node’s version', same(go(['verify-a']).execs, ['verify-a']));
  OVERRIDE = {};
  go(['verify-a']);
  NOW = new Date('2026-10-15T09:00:00');
  ok('the day', same(go(['verify-a']).execs, ['verify-a']));
  ok('and the run says the date changed', (() => { NOW = new Date('2026-10-16T09:00:00'); return /the date changed \(2026-10-15 → 2026-10-16\)/.test(go(['verify-a'], { plan: true }).text); })());
  /* The plan names the newest pass's first difference, so the newest must differ from this run in the runner alone. A day no pass
     was made on is measured, and its pass is the newest; a day with a pass kept from earlier is reused or not by what else is kept,
     which on Windows left the pass of the 15th newest and the plan naming the date. */
  NOW = new Date('2026-10-17T12:00:00');
  const made = go(['verify-a']);
  OVERRIDE = { runner: 'another-version-of-the-code' };
  const why = go(['verify-a'], { plan: true }).text;
  ok('and the plan says that is why', same(made.execs, ['verify-a']) && /RUN\s+verify-a\s+the code of the result cache or the runner changed/.test(why),
     made.execs.length ? (why.split('\n').filter(l => /verify-a/.test(l))[0] || '').trim() : 'the run before it measured nothing, so its pass is not the newest');
  const rn = go(['verify-a']);
  ok('a pass made by other code of the cache or the runner is measured again', same(rn.execs, ['verify-a']), rn.execs.join(','));
  OVERRIDE = {};
  NOW = new Date('2026-10-14T12:00:00');
  go(['verify-a']);
  const other = go(['verify-a'], {}, { engine: 'webkit' });
  ok('another engine has its own passes: webkit measures what chromium already has', same(other.execs, ['verify-a']), other.execs.join(','));
  ok('and neither disturbs the other', go(['verify-a']).execs.length === 0 && go(['verify-a'], {}, { engine: 'webkit' }).execs.length === 0);
}

head('the code that decides what a pass means is part of what a pass depends on');
{
  ok('the fingerprint holds a hash of it', /^[0-9a-f]{16}$/.test(SC.fingerprint({ root: R, engine: 'chromium' }).runner), SC.fingerprint({ root: R, engine: 'chromium' }).runner);
  const dir = path.join(TMP, 'runner'); fs.mkdirSync(dir);
  for (const n of SC.RUNNER_FILES) fs.copyFileSync(path.join(ROOT, 'scripts', n), path.join(dir, n));
  const base = SC.runnerHash(dir);
  ok('a copy of the files hashes as the files do', base === SC.runnerHash(), base);
  const moved = [];
  for (const n of SC.RUNNER_FILES) {
    const p = path.join(dir, n), was = fs.readFileSync(p);
    fs.appendFileSync(p, '\n// edited\n');
    if (SC.runnerHash(dir) !== base) moved.push(n);
    fs.writeFileSync(p, was);
  }
  ok('and each of them moves it when edited', same(moved, SC.RUNNER_FILES), 'moved by ' + moved.join(', '));
  ok('every file listed is there to be hashed', SC.RUNNER_FILES.every(n => fs.existsSync(path.join(ROOT, 'scripts', n))), SC.RUNNER_FILES.filter(n => !fs.existsSync(path.join(ROOT, 'scripts', n))).join(', ') || 'all present');
  /* A file the runner or the cache starts to require and nobody lists would be edited without a pass being doubted. */
  const { blankComments } = require('./_source.js');
  const listed = new Set(SC.RUNNER_FILES), missing = [];
  for (const n of SC.RUNNER_FILES) {
    const text = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', n), 'utf8'));
    for (const m of text.matchAll(/require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g)) if (!listed.has(m[1] + '.js')) missing.push(n + ' requires ' + m[1] + '.js');
  }
  ok('and every script they require is listed too', missing.length === 0, missing.join('; ') || 'closed');
}

head('only a pass that can be vouched for is kept');
{
  go(['verify-mode']);
  w('data/mode.txt', 'bad');
  const bad = go(['verify-mode']);
  ok('a failing suite fails the run, and is measured', bad.code === 1 && same(bad.execs, ['verify-mode']) && bad.failed.includes('verify-mode'));
  ok('a failure is never reused: run again, it runs again', same(go(['verify-mode']).execs, ['verify-mode']));
  w('data/mode.txt', 'ok');
  ok('and the pass from before the failure is still there when its inputs return', go(['verify-mode']).execs.length === 0);
  go(['verify-flaky']);
  ok('a pass is reused while nothing says otherwise', go(['verify-flaky']).execs.length === 0);
  fs.writeFileSync(flagFile('flaky'), '1');
  const fresh = go(['verify-flaky'], { fresh: true });
  fs.rmSync(flagFile('flaky'), { force: true });
  ok('--fresh measures it regardless, and it fails: something outside every input moved', fresh.code === 1 && same(fresh.execs, ['verify-flaky']));
  ok('and the contradicted pass is dropped, so it is measured again, not reused', same(go(['verify-flaky']).execs, ['verify-flaky']));
  const sp = go(['verify-spawn']);
  const keptFor = name => { const d = path.join(R, 'node_modules', '.cache', 'systole-suite-results'); try { return fs.readdirSync(d).filter(x => { try { return JSON.parse(fs.readFileSync(path.join(d, x), 'utf8')).suite === name; } catch (_) { return false; } }); } catch (_) { return []; } };
  ok('a suite that starts a process the cache does not follow passes, and nothing is kept for it', sp.code === 0 && same(sp.execs, ['verify-spawn']) && keptFor('verify-spawn').length === 0, keptFor('verify-spawn').join(','));
  ok('whereas one the cache can follow has an entry', keptFor('verify-a').length > 0);
  ok('and every time, with the reason said', same(go(['verify-spawn']).execs, ['verify-spawn']) && /not remembered, so measured every run: verify-spawn \(it starts /.test(go(['verify-spawn']).text));
  go(['verify-touch']);
  ok('a suite that changes its own input while it runs is not trusted: measured again', same(go(['verify-touch']).execs, ['verify-touch']));
  ok('and the reason is said', /verify-touch \(data\/m\.txt changed while it ran\)/.test(go(['verify-touch']).text));
  /* A file stamped in the future (an archive from a machine with a faster clock) was not written during this run. */
  const future = path.join(R, 'data', 'a.txt'), later = new Date(Date.now() + 3600 * 1000);
  w('data/a.txt', 'stamped-in-the-future'); fs.utimesSync(future, later, later);
  fs.rmSync(SC.cacheDir(R), { recursive: true, force: true });
  go(['verify-a']);
  ok('a file whose modification time is in the future is not taken for one written during the run: the pass is kept', go(['verify-a']).execs.length === 0);
  w('data/a.txt', 'one');
}

head('the cache’s own files cannot make it lie');
{
  go(['verify-a']);
  const dir = path.join(R, 'node_modules', '.cache', 'systole-suite-results');
  const entryOf = () => {
    for (const f of fs.readdirSync(dir)) { try { const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (e.suite === 'verify-a' && e.engine === 'chromium') return path.join(dir, f); } catch (_) { /* not an entry */ } }
    return null;
  };
  const entryFile = entryOf();
  ok('the pass just made is in the cache directory as one file for its suite and engine', !!entryFile);
  const good = fs.readFileSync(entryFile, 'utf8');
  /* The runner fails open when the cache throws, so a run alone cannot tell an entry the cache handles from one that crashes it and is swallowed.
     The cache is therefore asked directly as well. */
  const asked = () => { const c = SC.open({ root: R, engine: 'chromium', now: () => NOW, override: OVERRIDE, allowSpawn: () => false, commit: 'abc1234' }); try { return c.decide('verify-a', []); } catch (e) { return { threw: e.message }; } };
  const noEntry = () => { const d = asked(); return !d.threw && d.reuse === false; };
  fs.writeFileSync(entryFile, good.slice(0, good.length >> 1));
  ok('an entry cut off in the middle is no entry: asked directly, it says there is no pass and does not throw; the suite runs', noEntry() && same(go(['verify-a']).execs, ['verify-a']), JSON.stringify(asked()).slice(0, 100));
  ok('and the run puts a whole one back', go(['verify-a']).execs.length === 0);
  fs.writeFileSync(entryFile, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(entryFile, 'utf8')), { v: 999 })));
  ok('an entry from another version of the cache is no entry', noEntry() && same(go(['verify-a']).execs, ['verify-a']), JSON.stringify(asked()).slice(0, 100));
  fs.writeFileSync(entryFile, '{"v":1,"slots":"nope"}');
  ok('an entry of the wrong shape is no entry', noEntry() && same(go(['verify-a']).execs, ['verify-a']), JSON.stringify(asked()).slice(0, 100));
  // more passes than slots: the oldest goes
  for (let i = 0; i < SC.SLOTS + 2; i++) { w('data/a.txt', 'gen' + i); go(['verify-a']); }
  const kept = JSON.parse(fs.readFileSync(entryFile, 'utf8')).slots.length;
  ok('only the last few passes are kept', kept === SC.SLOTS, `${kept} kept of ${SC.SLOTS}`);
  w('data/a.txt', 'gen0');
  ok('so one older than that is measured again', same(go(['verify-a']).execs, ['verify-a']));
}

head('what a reuse says it saved');
{
  fs.rmSync(SC.cacheDir(R), { recursive: true, force: true });
  w('data/a.txt', 'one'); w('data/b.txt', 'one');
  go(['verify-a', 'verify-b']);
  /* The fake suites take a few hundredths of a second, which prints as 0.0 whether or not the cache adds up what it saved. Say each took 90 s. */
  const dir = SC.cacheDir(R);
  for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x), e = JSON.parse(fs.readFileSync(p, 'utf8')); e.slots.forEach(sl => { sl.result.seconds = 90; }); fs.writeFileSync(p, JSON.stringify(e)); }
  const warm = go(['verify-a', 'verify-b']);
  ok('a run that reuses two passes of 90 s says 3.0 min were not spent', warm.reused.length === 2 && /\(3\.0 min of browser time not spent/.test(warm.text), warm.text.split('\n').filter(l => /no-export/.test(l)).join(' | '));
  ok('and each REUSED line says what that one saved', /REUSED\s+verify-a .*\(90\.0s not spent\)/.test(warm.text), warm.text.split('\n').filter(l => /REUSED/.test(l))[0]);
  const plan = go(['verify-a', 'verify-b'], { plan: true });
  ok('and the plan says the same before anything is run', /2 would be REUSED \(about 3\.0 min of browser time not spent\)/.test(plan.text), plan.text.split('\n').filter(l => /plan:/.test(l)).join(''));
}

head('--fresh, --plan, and where there is no cache at all');
{
  go(['verify-a', 'verify-b']);
  const f = go(['verify-a', 'verify-b'], { fresh: true });
  ok('--fresh measures every browser suite', same(f.execs, ['verify-a', 'verify-b']) && f.reused.length === 0);
  ok('and records them again, so the next run reuses', go(['verify-a', 'verify-b']).execs.length === 0);
  w('data/b.txt', 'changed');
  const p = go(['verify-a', 'verify-b'], { plan: true });
  ok('--plan runs nothing, not even the pure suites', p.execs.length === 0 && p.pureRuns === 0 && p.planned === true && p.code === 0);
  ok('it says what would be reused and what would run, and why', /REUSE\s+verify-a/.test(p.text) && /RUN\s+verify-b\s+data\/b\.txt changed/.test(p.text), p.text.split('\n').filter(l => /verify-/.test(l)).join(' | '));
  ok('and its last line counts them, with the time the reuse would save', /of 2 browser suites, 1 would be REUSED \(about \d+\.\d min of browser time not spent\) and 1 would run\. The 1 pure suites always run/.test(p.text), p.text.split('\n').filter(l => /plan:/.test(l)).join(''));
  ok('after a plan, a real run still has its passes to reuse', same(go(['verify-a', 'verify-b']).execs, ['verify-b']));
  const ci = SC.fromEnv({ root: R, engine: 'chromium', env: { CI: 'true' } });
  ok('CI turns the cache off, and the cache that is left remembers nothing and says why',
     SC.disabledBy({ CI: 'true' }) === 'CI is set' && ci.off === 'CI is set' && ci.decide('verify-a', []).reuse === false && ci.prepare('verify-a') === null && ci.store('verify-a', [], null, { status: 'pass' }).stored === false);
  ok('SYSTOLE_FRESH asks for what --fresh asks for, and without it nothing is fresh', SC.fromEnv({ root: R, engine: 'chromium', env: { SYSTOLE_FRESH: '1' } }).fresh === true && SC.fromEnv({ root: R, engine: 'chromium', env: {} }).fresh === false && SC.fromEnv({ root: R, engine: 'chromium', fresh: true, env: {} }).fresh === true);
  ok('so does SYSTOLE_NO_CACHE, and nothing else does', SC.disabledBy({ SYSTOLE_NO_CACHE: '1' }) === 'SYSTOLE_NO_CACHE is set' && SC.disabledBy({}) === '' && SC.disabledBy({ SYSTOLE_FRESH: '1' }) === '');
  /* An off cache in a real run: nothing remembered, nothing reused, and the run says so. */
  const offFactory = (env, plan) => ({ root, engine }) => SC.fromEnv({ root, engine, plan, env });
  fs.rmSync(SC.cacheDir(R), { recursive: true, force: true });
  go(['verify-a', 'verify-b'], {}, { cache: offFactory({ CI: 'true' }) });
  const offAgain = go(['verify-a', 'verify-b'], {}, { cache: offFactory({ CI: 'true' }) });
  ok('with CI set, a second run measures both again, says the cache is off and why, and reuses nothing', same(offAgain.execs, ['verify-a', 'verify-b']) && offAgain.reused.length === 0 && /result cache: off \(CI is set\)/.test(offAgain.text) && !/REUSED/.test(offAgain.text), offAgain.text.split('\n').filter(l => /cache/.test(l)).join(' | '));
  ok('and it kept nothing: with the cache back on, the first run still has to measure', same(go(['verify-a', 'verify-b']).execs, ['verify-a', 'verify-b']));
  const offPlan = go(['verify-a', 'verify-b'], {}, { cache: offFactory({ CI: 'true' }, true) });
  ok('--plan with the cache off runs nothing and says every suite would run, and why', offPlan.execs.length === 0 && offPlan.pureRuns === 0 && /RUN\s+verify-a\s+CI is set/.test(offPlan.text) && /0 would be REUSED and 2 would run/.test(offPlan.text), offPlan.text.split('\n').filter(l => /verify-a|plan:/.test(l)).join(' | '));
  const { ENGINES } = require('./_engine.js');
  ok('an engine that does not report what its pages load is not traced: the cache is off for it, and names it', SC.disabledBy({}, 'firefox') !== '' && /^firefox does not report/.test(SC.disabledBy({}, 'firefox')) && SC.fromEnv({ root: R, engine: 'firefox', env: {} }).off === SC.disabledBy({}, 'firefox'));
  ok('and the engines it does trace are engines the suites know, with the cache on for them', SC.TRACED_ENGINES.length > 0 && SC.TRACED_ENGINES.every(e => ENGINES.includes(e) && SC.disabledBy({}, e) === ''), SC.TRACED_ENGINES.join(','));
  const ff = go(['verify-a'], {}, { engine: 'firefox', cache: offFactory({}) });
  ok('a run in such an engine measures everything and says why', same(ff.execs, ['verify-a']) && /result cache: off \(firefox does not report/.test(ff.text) && go(['verify-a'], {}, { engine: 'firefox', cache: offFactory({}) }).execs.length === 1);
  /* A cache that throws at every step: it may cost a measurement and nothing else. */
  const hostile = () => ({ plan: false, decide() { throw new Error('boom-decide'); }, prepare() { throw new Error('boom-prepare'); }, env: b => b, store() { throw new Error('boom-store'); }, discard() {}, notRemembered: [] });
  const hs = go(['verify-a', 'verify-b'], {}, { cache: hostile });
  ok('a cache that throws when asked, when prepared and when told to keep stops nothing: both suites run, the run passes', same(hs.execs, ['verify-a', 'verify-b']) && hs.code === 0 && hs.reused.length === 0, hs.execs.join(','));
  ok('and says it could not read it, and why nothing was remembered', /not remembered, so measured every run: verify-a \(the cache could not prepare a trace \(boom-prepare\)\)/.test(hs.text), hs.text.split('\n').filter(l => /not remembered/.test(l)).join(' | '));
  const storeOnly = () => Object.assign(hostile(), { prepare: name => ({ name, tmp: os.tmpdir(), file: path.join(os.tmpdir(), 'no-such-trace-' + process.pid) }) });
  const so = go(['verify-a'], {}, { cache: storeOnly });
  ok('and one that fails only at the end, when told to keep a pass, says that', so.code === 0 && /verify-a \(the cache could not keep it \(boom-store\)\)/.test(so.text), so.text.split('\n').filter(l => /not remembered/.test(l)).join(' | '));
  const none = go(['verify-a', 'verify-b'], {}, { cache: null });
  ok('a run given no cache is the run it always was: everything measured, the old summary', same(none.execs, ['verify-a', 'verify-b']) && none.reused.length === 0 && /all 3 no-export suites passed \(1 pure, 2 in chromium/.test(none.text));
}

head('the versions come from the install, and only its browser may be started');
{
  const pw = path.join(R, 'node_modules', 'playwright-core');
  fs.mkdirSync(pw, { recursive: true });
  const install = (version, rev) => {
    fs.writeFileSync(path.join(pw, 'package.json'), JSON.stringify({ name: 'playwright-core', version }));
    fs.writeFileSync(path.join(pw, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium', revision: rev, browserVersion: '9.8.7' }, { name: 'chromium-headless-shell', revision: rev }, { name: 'webkit', revision: '2200' }, { name: 'firefox', revision: '1500' }] }));
  };
  const fpOf = engine => SC.fingerprint({ root: R, engine, now: NOW });
  install('1.63.0', '1200'); const a = fpOf('chromium');
  install('1.64.0', '1200'); const b = fpOf('chromium');
  install('1.63.0', '1201'); const c = fpOf('chromium');
  install('1.63.0', '1200');
  ok('Playwright’s version is the one installed', a.playwright === '1.63.0' && b.playwright === '1.64.0', a.playwright + ' / ' + b.playwright);
  ok('the browser’s revision is the one this engine would launch, and a new revision moves it', /chromium@1200/.test(a.browser) && a.browser !== c.browser && a.browser === b.browser, a.browser + ' / ' + c.browser);
  ok('another engine’s builds are not in this one’s', fpOf('webkit').browser === 'webkit@2200' && !/webkit|firefox/.test(a.browser), fpOf('webkit').browser + ' / ' + a.browser);
  fs.rmSync(pw, { recursive: true, force: true });
  ok('with no install, it says unknown rather than nothing', fpOf('chromium').playwright === 'unknown' && fpOf('chromium').browser === 'unknown');

  const stub = path.join(R, 'node_modules', 'playwright'), BROWSERS = path.join(TMP, 'ms-playwright');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'package.json'), '{"name":"playwright","version":"0.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(stub, 'index.js'), 'module.exports = { chromium: { executablePath: () => ' + JSON.stringify(path.join(BROWSERS, 'chromium-1200', 'chrome-linux', 'chrome')) + ' }, webkit: { executablePath: () => { throw new Error("not installed"); } } };');
  const allow = SC.browserSpawnAllowed(R, 'chromium');
  ok('the browser Playwright installed for this engine may be started, with arguments', allow(path.join(BROWSERS, 'chromium-1200', 'chrome-linux', 'chrome') + ' --headless'));
  ok('another program may not, nor one in a directory that only starts with the same letters', !allow('/usr/bin/git status') && !allow('git') && !allow(BROWSERS + '-evil/chromium-1/chrome') && !allow(path.join(TMP, 'chrome')));
  ok('and where Playwright cannot say where the browser is, nothing may', SC.browserSpawnAllowed(R, 'webkit')(path.join(BROWSERS, 'webkit-2200', 'pw_run.sh')) === false);
  fs.rmSync(stub, { recursive: true, force: true });
}

head('a project reached by another spelling of its path');
{
  const link = path.join(TMP, 'link');
  let made = true; try { fs.symlinkSync(R, link, 'dir'); } catch (_) { made = false; }
  if (!made) console.log('  SKIP  this file system makes no symlinks: the root-spelling checks were not measured');
  else {
    fs.rmSync(SC.cacheDir(R), { recursive: true, force: true });
    const first = go(['verify-a'], {}, { root: link });
    ok('a first run through the link measures the suite (so the second is a test of what the first kept)', same(first.execs, ['verify-a']), first.execs.join(','));
    const again = go(['verify-a'], {}, { root: link });
    ok('run through a symlink, a pass is remembered and reused', again.execs.length === 0 && again.reused.includes('verify-a'), JSON.stringify(again.execs));
    ok('and the pass made by the real path is the same pass', go(['verify-a']).execs.length === 0);
    w('data/a.txt', 'through-the-link');
    ok('a file the suite read by its real path, edited, is noticed from either spelling of the root (the tracer knows both)', same(go(['verify-a'], {}, { root: link }).execs, ['verify-a']) && go(['verify-a']).execs.length === 0);
    w('data/a.txt', 'one');
    fs.rmSync(link, { force: true });
  }
}

head('the tracer: what it records, what it leaves out, and how it is started');
{
  ok('node is node, by path, by name, and by shell line', TR.isNode(process.execPath) && TR.isNode('node') && TR.isNode('/usr/bin/node') && TR.isNode('node.exe') && TR.isNode(process.execPath + ' x.js') && TR.isNode('node scripts/a.js --b'));
  ok('and a pipe, a list or a substitution is not', !TR.isNode('node a.js | tee x') && !TR.isNode('node a.js && git status') && !TR.isNode('node $(which git)') && !TR.isNode('git status') && !TR.isNode('python3 x.py'));
  ok('a path with no space is passed to node bare', TR.requireOption('/a/b/trace.js') === '--require=/a/b/trace.js');
  ok('a path with a space is quoted, and a Windows one has its backslashes doubled', TR.requireOption('/a b/trace.js') === '--require="/a b/trace.js"' && TR.requireOption('C:\\Program Files\\x\\trace.js') === '--require="C:\\\\Program Files\\\\x\\\\trace.js"', TR.requireOption('C:\\Program Files\\x\\trace.js'));
  const spaced = path.join(TMP, 'with space'); fs.mkdirSync(spaced); fs.copyFileSync(path.join(ROOT, 'scripts', 'trace-inputs.js'), path.join(spaced, 'trace-inputs.js'));
  const probe = spawnSync(process.execPath, ['-e', "process.stdout.write(String(globalThis[Symbol.for('systole.trace-inputs')]))"],
    { env: TR.traceEnv(process.env, path.join(TMP, 't.jsonl'), R, path.join(spaced, 'trace-inputs.js')), encoding: 'utf8' });
  ok('node really loads the tracer from a directory with a space in it', probe.stdout === 'true', probe.stdout + (probe.stderr || '').slice(0, 100));
  const T1 = path.join(TMP, 'unit.jsonl');
  const out = spawnSync(process.execPath, ['-e', [
    "const fs = require('fs'), path = require('path'); const R = process.env.SYSTOLE_TRACE_ROOT;",
    "fs.readFileSync(path.join(R, 'data', 'a.txt')); fs.existsSync(path.join(R, 'data', 'nope')); fs.readdirSync(path.join(R, 'data', 'dir'));",
    "fs.readFileSync(__filename.replace(/.*/, process.execPath));  fs.existsSync(path.join(R, 'node_modules', 'x'));  fs.existsSync(path.join(R, '.git', 'HEAD'));",
    "fs.writeFileSync(path.join(R, 'out', 'w.txt'), 'w'); fs.appendFileSync(path.join(R, 'out', 'w.txt'), 'w'); fs.existsSync(require('os').tmpdir());"].join('\n')],
    { env: TR.traceEnv(process.env, T1, R), encoding: 'utf8' });
  const rec = fs.readFileSync(T1, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rel = rec.filter(r => r[1] && r[1].startsWith(R)).map(r => r[0] + ' ' + path.relative(R, r[1]).split(path.sep).join('/'));
  ok('it records a read, an exists-check that found nothing, and a directory listing',
     rel.includes('read data/a.txt') && rel.includes('stat data/nope') && rel.includes('list data/dir'), rel.join(' | '));
  ok('it leaves out node_modules, .git, files outside the root, and files only written',
     !rec.some(r => /node_modules|[\\/]\.git[\\/]/.test(r[1] || '')) && !rec.some(r => r[1] === process.execPath) && !rel.some(x => /out\/w\.txt/.test(x)) && !rec.some(r => r[1] === os.tmpdir()), rel.join(' | '));
  const T2 = path.join(TMP, 'browser.jsonl');
  const url = require('url').pathToFileURL(path.join(R, 'data', 'a.txt')).href;
  spawnSync(process.execPath, ['-e', `const T = require(${JSON.stringify(path.join(ROOT, 'scripts', 'trace-inputs.js'))}); T.noteBrowserRequest(${JSON.stringify(url)}); T.noteBrowserRequest('https://example.com/x'); T.noteBrowserRequest('data:text/html,x'); T.noteBrowserRequest(${JSON.stringify(require('url').pathToFileURL(path.join(os.tmpdir(), 'elsewhere.js')).href)});`],
    { env: Object.assign({}, process.env, { SYSTOLE_TRACE_FILE: T2, SYSTOLE_TRACE_ROOT: R }) });
  const br = fs.existsSync(T2) ? fs.readFileSync(T2, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  ok('a file:// request inside the root is recorded as the browser’s; http, data: and a file outside the root are not',
     br.length === 1 && br[0][0] === 'browser' && path.relative(R, br[0][1]).split(path.sep).join('/') === 'data/a.txt', JSON.stringify(br));
}

head('the tracer changes nothing about what it watches, and watches every call that reads a path');
{
  const util = require('util');
  const run = (code, env) => { const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', cwd: R }); return r.stdout || (r.stderr || '').slice(0, 300); };
  const plainEnv = Object.assign({}, process.env); delete plainEnv.NODE_OPTIONS; delete plainEnv.SYSTOLE_TRACE_FILE; delete plainEnv.SYSTOLE_TRACE_ROOT;
  const tracedEnv = TR.traceEnv(plainEnv, path.join(TMP, 'surface.jsonl'), R);
  /* The surface the code under test sees: name, length and properties of each function node gives it for files and processes. */
  const surface = `const fs = require('fs'), cp = require('child_process'), util = require('util'); const out = {};
    for (const [label, o] of [['fs', fs], ['promises', fs.promises], ['cp', cp]])
      for (const k of Object.keys(o).sort()) { const f = o[k]; if (typeof f !== 'function') continue;
        out[label + '.' + k] = [f.name, f.length, Reflect.ownKeys(f).filter(x => !['prototype', 'arguments', 'caller'].includes(x)).map(String).sort(), typeof f[util.promisify.custom]]; }
    util.promisify(cp.execFile)(process.execPath, ['-e', '0']).then(r => { out.execFileResolves = Object.keys(r).sort(); process.stdout.write(JSON.stringify(out)); });`;
  const a = run(surface, plainEnv), b = run(surface, tracedEnv);
  let sa, sb; try { sa = JSON.parse(a); sb = JSON.parse(b); } catch (_) { sa = sb = null; }
  const differ = sa && sb ? Object.keys(Object.assign({}, sa, sb)).filter(k => JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) : ['(no output)'];
  ok('every function of fs, fs.promises and child_process has the same name, length and properties under the tracer', !!sa && Object.keys(sa).length > 80 && differ.length === 0, differ.slice(0, 4).join(', ') + ' of ' + (sa ? Object.keys(sa).length : 0) + ' compared');
  ok('and realpathSync.native, and the {stdout, stderr} that promisify(execFile) resolves, are among what is kept', !!sa && JSON.stringify(sb.execFileResolves) === '["stderr","stdout"]' && sb['fs.realpathSync'][2].includes('native') && sb['cp.exec'][3] === 'function', sb && JSON.stringify(sb.execFileResolves));

  /* every function node exposes on fs is watched, or excused here with the reason */
  const NOT_INPUTS = [
    /* they write, or change what is already there */
    'appendFile', 'appendFileSync', 'writeFile', 'writeFileSync', 'createWriteStream', 'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync',
    'chmod', 'chmodSync', 'chown', 'chownSync', 'fchmod', 'fchmodSync', 'fchown', 'fchownSync', 'lchmod', 'lchown', 'lchownSync',
    'lutimes', 'lutimesSync', 'utimes', 'utimesSync', 'futimes', 'futimesSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'mkdtempDisposable', 'mkdtempDisposableSync',
    'rename', 'renameSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'link', 'linkSync', 'symlink', 'symlinkSync',
    /* they act on a descriptor that an open call, which is watched, handed out */
    'close', 'closeSync', 'fdatasync', 'fdatasyncSync', 'fsync', 'fsyncSync', 'fstat', 'fstatSync', 'read', 'readSync', 'readv', 'readvSync', 'write', 'writeSync', 'writev', 'writevSync',
    /* the file system's totals, not the repository's content; and the end of a watch */
    'statfs', 'statfsSync', 'unwatchFile'];
  const fnsOf = o => Object.keys(o).filter(k => typeof o[k] === 'function' && /^[a-z]/.test(k));
  const loose = [];
  for (const [side, obj] of [['fs', fs], ['promises', fs.promises]]) for (const k of fnsOf(obj)) if (!TR.WATCHED[side].includes(k) && !NOT_INPUTS.includes(k)) loose.push(side + '.' + k);
  ok('and every function of fs and fs.promises in this node is either watched or excused above as not reading a path', loose.length === 0 && fnsOf(fs).length > 80, loose.join(', ') + ' (decide whether it reads a path; add it to WATCH in scripts/trace-inputs.js or to NOT_INPUTS here)');

  /* every watched call leaves its record */
  const EXPECT = {
    read: { fs: ['readFileSync', 'readFile', 'createReadStream', 'copyFileSync', 'copyFile', 'openAsBlob', 'openSync', 'open'], promises: ['readFile', 'copyFile', 'open'] },
    tree: { fs: ['cpSync', 'cp'], promises: ['cp'] },
    list: { fs: ['readdirSync', 'readdir', 'opendirSync', 'opendir'], promises: ['readdir', 'opendir'] },
    stat: { fs: ['statSync', 'lstatSync', 'stat', 'lstat', 'existsSync', 'exists', 'accessSync', 'access', 'realpathSync', 'realpath', 'readlinkSync', 'readlink'], promises: ['stat', 'lstat', 'access', 'realpath', 'readlink'] },
    flag: { fs: ['globSync', 'glob', 'watch', 'watchFile'], promises: ['glob', 'watch'] },
  };
  const wanted = side => [].concat(...Object.values(EXPECT).map(e => e[side])).sort();
  ok('the calls this test makes are the calls the tracer table lists', same(wanted('fs'), TR.WATCHED.fs) && same(wanted('promises'), TR.WATCHED.promises), 'test: ' + wanted('fs').length + '+' + wanted('promises').length + ', tracer: ' + TR.WATCHED.fs.length + '+' + TR.WATCHED.promises.length);
  const CALL = {
    fs: { readFileSync: 'fs.readFileSync(P)', readFile: 'fs.readFile(P, () => {})', createReadStream: "fs.createReadStream(P).on('error', () => {}).destroy()",
      copyFileSync: 'fs.copyFileSync(P, O)', copyFile: 'fs.copyFile(P, O, () => {})', openAsBlob: 'fs.openAsBlob(P).catch(() => {})', openSync: "fs.closeSync(fs.openSync(P, 'r'))", open: "fs.open(P, 'r', (e, fd) => { if (fd) fs.close(fd, () => {}); })",
      cpSync: 'fs.cpSync(P, O, { recursive: true })', cp: 'fs.cp(P, O, { recursive: true }, () => {})',
      readdirSync: 'fs.readdirSync(P)', readdir: 'fs.readdir(P, () => {})', opendirSync: 'fs.opendirSync(P).closeSync()', opendir: 'fs.opendir(P, (e, d) => { if (d) d.close(() => {}); })',
      statSync: 'fs.statSync(P)', lstatSync: 'fs.lstatSync(P)', stat: 'fs.stat(P, () => {})', lstat: 'fs.lstat(P, () => {})', existsSync: 'fs.existsSync(P)', exists: 'fs.exists(P, () => {})',
      accessSync: 'fs.accessSync(P)', access: 'fs.access(P, () => {})', realpathSync: 'fs.realpathSync(P)', realpath: 'fs.realpath(P, () => {})', readlinkSync: 'fs.readlinkSync(P)', readlink: 'fs.readlink(P, () => {})',
      globSync: 'fs.globSync(P)', glob: 'fs.glob(P, () => {})', watch: 'fs.watch(P).close()', watchFile: 'fs.watchFile(P, () => {}); fs.unwatchFile(P)' },
    promises: { readFile: 'fs.promises.readFile(P)', copyFile: 'fs.promises.copyFile(P, O)', open: "fs.promises.open(P, 'r').then(h => h.close())", cp: 'fs.promises.cp(P, O, { recursive: true })',
      readdir: 'fs.promises.readdir(P)', opendir: 'fs.promises.opendir(P).then(d => d.close())', stat: 'fs.promises.stat(P)', lstat: 'fs.promises.lstat(P)', access: 'fs.promises.access(P)',
      realpath: 'fs.promises.realpath(P)', readlink: 'fs.promises.readlink(P)', glob: 'fs.promises.glob(P)', watch: 'fs.promises.watch(P)' },
  };
  const cases = [];
  for (const [op, e] of Object.entries(EXPECT)) for (const side of ['fs', 'promises']) for (const name of e[side]) cases.push({ op, side, name, tag: side + '-' + name });
  const script = ["process.on('unhandledRejection', () => {}); const fs = require('fs'), path = require('path'); const R = process.env.SYSTOLE_TRACE_ROOT.split(path.delimiter)[0];",
    ...cases.map(c => "{ const P = path.join(R, 'data', 'inv', " + JSON.stringify(c.tag) + "), O = path.join(R, 'out', 'inv-' + " + JSON.stringify(c.tag) + "); try { " + CALL[c.side][c.name] + "; } catch (_) {} }")].join('\n');
  const missingCall = cases.filter(c => !CALL[c.side][c.name]).map(c => c.tag);
  const T3 = path.join(TMP, 'watch.jsonl');
  const ran = spawnSync(process.execPath, ['-e', script], { env: TR.traceEnv(plainEnv, T3, R), encoding: 'utf8', cwd: R, timeout: 60000 });
  const got = fs.existsSync(T3) ? fs.readFileSync(T3, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const has = (c) => c.op === 'flag' ? got.some(r => r[0] === 'flag' && r[1].includes('fs.' + c.name + ' ')) : got.some(r => r[0] === c.op && r[1] === path.join(R, 'data', 'inv', c.tag) && !r[2]);
  const lacking = cases.filter(c => !has(c)).map(c => c.tag);
  ok('every call in the table leaves the record it should, including the callback, promise and stream forms', missingCall.length === 0 && lacking.length === 0 && ran.status === 0, (missingCall.length ? 'no call for ' + missingCall.join(', ') + '; ' : '') + (lacking.length ? 'no record for ' + lacking.join(', ') : '') + (ran.status ? ' | child: ' + String(ran.stderr).slice(0, 150) : '') + ' (' + cases.length + ' calls)');
  ok('a recursive listing leaves the record of one', (() => { const T4 = path.join(TMP, 'rec.jsonl'); spawnSync(process.execPath, ['-e', "const fs = require('fs'), path = require('path'); const R = process.env.SYSTOLE_TRACE_ROOT.split(path.delimiter)[0]; fs.readdirSync(path.join(R, 'data'), { recursive: true }); fs.readdir(path.join(R, 'data', 'dir'), { recursive: true }, () => {}); fs.promises.readdir(path.join(R, 'data', 'tree'), { recursive: true }).catch(() => {});"], { env: TR.traceEnv(plainEnv, T4, R), cwd: R });
    const r = fs.readFileSync(T4, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); return ['data', 'data/dir', 'data/tree'].every(d => r.some(x => x[0] === 'list' && x[1] === path.join(R, d) && x[2] === 'r')); })());

  /* a file opened to write what is in it is not an input; one opened to read is */
  const C = fs.constants;
  const OPENS = [['r', true], ['r+', true], ['rs', true], ['w', false], ['wx', false], ['a', false], ['w+', false], ['a+', false], [C.O_RDONLY, true], [C.O_RDWR, true], [C.O_WRONLY | C.O_CREAT, false], [C.O_WRONLY | C.O_APPEND, false]];
  const T5 = path.join(TMP, 'open.jsonl');
  const openScript = "const fs = require('fs'), path = require('path'); const R = process.env.SYSTOLE_TRACE_ROOT.split(path.delimiter)[0];\n" + OPENS.map(([fl, reads], i) =>
    "try { fs.closeSync(fs.openSync(path.join(R, " + (reads ? "'data', 'inv'" : "'out'") + ", 'open-" + i + "'), " + JSON.stringify(fl) + ")); } catch (_) {}\n" +
    "fs.promises.open(path.join(R, " + (reads ? "'data', 'inv'" : "'out'") + ", 'popen-" + i + "'), " + JSON.stringify(fl) + ").then(h => h.close(), () => {});").join('\n');
  spawnSync(process.execPath, ['-e', openScript], { env: TR.traceEnv(plainEnv, T5, R), cwd: R, timeout: 30000 });
  const og = fs.existsSync(T5) ? fs.readFileSync(T5, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const wrong = [];
  OPENS.forEach(([fl, reads], i) => { for (const [pre, dir] of [['open-', reads ? ['data', 'inv'] : ['out']], ['popen-', reads ? ['data', 'inv'] : ['out']]]) {
    const seen = og.some(r => r[0] === 'read' && r[1] === path.join(R, ...dir, pre + i)); if (seen !== reads) wrong.push(pre + i + ' ' + JSON.stringify(fl) + (seen ? ' recorded' : ' not recorded')); } });
  ok('open and promises.open record the read flags and leave out the write ones', wrong.length === 0 && og.length > 0, wrong.slice(0, 4).join('; '));
  ok('onlyWrites agrees, for the flags it is asked about', OPENS.every(([fl, reads]) => TR.onlyWrites(fl) === !reads) && TR.onlyWrites(undefined) === false && TR.onlyWrites(() => {}) === false);
}

head('hashing: the stamp, the states, and what the trace is allowed to vouch for');
{
  const stamp = '<!-- systole-build 0123456789abcdef commit abc123def456-dirty -->\n';
  const page = Buffer.concat([Buffer.from('<head>'), Buffer.from([0x92, 0x93]), Buffer.from('x'), Buffer.from(stamp), Buffer.from('</head>', 'latin1')]);
  const bare = Buffer.concat([Buffer.from('<head>'), Buffer.from([0x92, 0x93]), Buffer.from('x'), Buffer.from('</head>')]);
  ok('stripping the stamp gives back the unstamped bytes exactly, even a lone 0x92', SC.stripStamp(page).equals(bare));
  ok('and a document with no stamp comes back unchanged', SC.stripStamp(bare).equals(bare));
  const f = path.join(R, 'data', 'state.txt'); w('data/state.txt', 'one');
  const s1 = SC.stateOf(f, { modes: ['read'], strip: false });
  w('data/state.txt', 'two');
  ok('a file’s state follows its content', s1 !== SC.stateOf(f, { modes: ['read'], strip: false }) && /^f:/.test(s1));
  ok('an absent path is absent', SC.stateOf(path.join(R, 'data', 'never'), { modes: ['stat'], strip: false }) === 'absent');
  const d = path.join(R, 'data', 'sd'); w('data/sd/a', '1');
  const l1 = SC.stateOf(d, { modes: ['list'], strip: false }), t1 = SC.stateOf(d, { modes: ['tree'], strip: false });
  w('data/sd/a', '2');
  ok('a listing ignores content, and a tree does not', l1 === SC.stateOf(d, { modes: ['list'], strip: false }) && t1 !== SC.stateOf(d, { modes: ['tree'], strip: false }));
  const none = { records: [], bad: 0, missing: false }, selfRead = { records: [['read', path.join(R, 'tests', 'verify-x.js')]], bad: 0, missing: false };
  const never = () => false;
  ok('a trace that is missing, cut off, or never saw the suite read itself vouches for nothing',
     SC.whyNotRemembered({ records: [], bad: 0, missing: true }, 'verify-x', R, never) !== '' && SC.whyNotRemembered(Object.assign({}, selfRead, { bad: 1 }), 'verify-x', R, never) !== ''
     && SC.whyNotRemembered(none, 'verify-x', R, never) !== '');
  ok('one that saw it, and nothing odd, does', SC.whyNotRemembered(selfRead, 'verify-x', R, never) === '');
  ok('a flag the tracer wrote (a call it cannot follow) is a reason', /cannot follow|does not follow/.test(SC.whyNotRemembered({ records: [...selfRead.records, ['flag', 'fs.glob reads a tree the tracer does not follow']], bad: 0, missing: false }, 'verify-x', R, never)));
  ok('a process that is not node, and is not the browser, is a reason; node and the browser are not',
     SC.whyNotRemembered({ records: [...selfRead.records, ['spawn', 'git status', false]], bad: 0, missing: false }, 'verify-x', R, never) !== ''
     && SC.whyNotRemembered({ records: [...selfRead.records, ['spawn', 'node', true], ['spawn', '/opt/pw/chromium-1/chrome', false]], bad: 0, missing: false }, 'verify-x', R, cmd => cmd.startsWith('/opt/pw/')) === '');
}

fs.rmSync(TMP, { recursive: true, force: true });
for (const t of ['flaky', 'cp']) fs.rmSync(flagFile(t), { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
