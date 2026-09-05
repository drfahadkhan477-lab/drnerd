#!/usr/bin/env node
/*
 * Run every behavioural suite against a build.
 *
 *   node scripts/verify.js [build/systole.html] [options]
 *
 *   --only <a,b>   run just these suites (names as in tests/verify-<name>.js)
 *   --skip <a,b>   run everything except these
 *   --bail         stop at the first failing suite
 *   --pwa          also build, serve and test the Stage 1 split build
 *   --engine <e>   chromium (default), webkit or firefox
 *   --list         print the suites and what each covers, then exit
 *
 * WHY THIS EXISTS. There are eighteen suites and roughly 418 checks, and they
 * were only ever runnable by remembering both the file name and that Playwright
 * lives in the global node_modules. One command now runs the lot and prints a
 * table, so "is the build good?" has an answer rather than a procedure.
 *
 * They run one at a time on purpose. Most of them drive a real WebGL context —
 * the heart is a live renderer, not a fixture — and several measure timing or
 * animation. Running them concurrently would have them competing for the GPU
 * and for CPU time, and the failures that produced would be about the harness
 * rather than the app, which is the least useful kind of red.
 *
 * verify-pwa needs more than a file path — it tests the Stage 1 split build over
 * HTTP, so it has to be built, served and torn down. `--pwa` does all three.
 *
 * It is worth the trouble, and this review proved why: the split shell had
 * silently grown from 566 KB to 1.7 MB because a megabyte of base64 heart scan
 * was being inlined into it. verify-pwa asserts the shell stays under 800 KB
 * and would have caught it the day it happened — but nothing ran it, so nobody
 * knew. A check that exists and is never run is not a check.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* Every suite, with the claim it exists to defend. Order is roughly the order
   the features were built, so a regression reads as a story. */
const SUITES = [
  ['stage0',       'the single-file build is stable and works offline'],
  ['keys',         'the answer keys agree with the commentary that explains them'],
  ['apex',         'the tutor, its tools, and the 3D heart it sits beside'],
  ['stage2',       'FSRS-5 scheduling replaces SM-2'],
  ['stage3',       'Apex can read figures and remembers who it teaches'],
  ['polish',       'Pencil feel, the hero heart, the rhythm library'],
  ['splash',       'the pre-paint loading screen, on a throttled CPU'],
  ['braunwald',    'grounded mode answers only from your references'],
  ['leads',        'the 12-lead morphology falls out of one dipole'],
  ['physio',       'the cardiac cycle is computed, not drawn, and keeps its own clock'],
  ['theme',        'eight palettes, two axes, unthemed semantics'],
  ['home',         'the welcome bar, the progress bar, three layouts'],
  ['splash-heart', 'the crystal heart paints before the app parses'],
  ['crisp',        'every canvas backs itself at high device-pixel density'],
  ['type',         'one modular type scale and one spacing scale, still held'],
  ['references',   'the worked reference notes obey the guide, and are retrievable'],
  ['gemini',       'a free provider with real vision, wired to its own wire shape'],
  ['memory',       'Apex still knows you next time, and you can see what it kept'],
  ['assets',       'an imported chapter brings its figures, and keeps them'],
  ['chatfigs',     'the figure Apex is reasoning from is one you can see'],
  ['pearl',        'the home screen opens with something worth knowing'],
  ['worker',       'the Gemini key lives on the edge, and the site still serves'],
  ['fsrs',         'the scheduler cannot make forgetting a reward'],
  ['boundary',     'a retrieved note is material to teach from, never an instruction'],
  ['chat',         'the panel keeps what you typed, and sends a window not an archive'],
  ['store',        'the big stores live in a database, and nothing is ever in neither place'],
  ['mistral',      'a free provider with real vision and honest capability discovery'],
  ['quiznav',      'going back never re-grades a question or re-schedules a card'],
  ['homeprog',     'the progress card counts up in step with the bar it sits beside'],
  ['chapters',     'the chapter grid staggers in, and its bar fills instead of arriving drawn'],
  ['failsafe',     'render() throwing shows a real screen, never a blank or frozen one'],
  ['content',      'a question broken in a way the fellow cannot see is never shipped silently'],
  ['backup',       'a restored backup appears now, not only after the next launch'],
  ['tokens',       'the semantic colour names alias the legacy hue names, not just resemble them'],
  /* The three below need no browser and no build — they load a src/ module
     the way verify-fsrs does and assert properties over it. That is what lets
     CI run them: CI has the repository but never the licensed export, so a
     suite that needs build/systole.html cannot protect anything there. */
  ['physio-pure',  'valves open on real pressure crossings, and isovolumetric means isovolumetric'],
  ['leads-pure',   "Einthoven and Goldberger hold exactly — every lead is one dipole, projected"],
  ['zip',          'an imported archive cannot spend more memory than the device has'],
  ['calib-pure',   'the calibration arithmetic says nothing rather than something wrong'],
  ['calibrate',    'confidence is an option not a gate, and a tagged miss updates one row'],
  ['figzoom-pure', 'the point under your fingers does not move, over any number of pinches'],
  ['figzoom',      'a figure can be examined, and still has four ways out'],
  ['engine',       'the browser engine is a flag, not thirty-four hardcoded copies of one'],
  ['schema',       'an older copy of the app cannot silently eat a newer one’s saved data'],
  ['stats',        'the check counts in the README, BUILD.md and CI are the counts the tests produced'],
  ['selftest',     'the on-device self-test reports honestly, and can actually fail'],
  ['layout',       'every screen fits, at every frame a real device produces'],
  /* Build-side, not app-side. It drives the figure review sheet rather than
     the app, because a crop decided by a person is only worth an hour of
     tapping if the box it records is the box that gets applied. It needs
     python3 with Pillow, the same dependency tools/figure-review.py has. */
  ['figreview',    'the review sheet records the box in original pixels, not preview pixels'],
  /* Retrieval quality as a number rather than an impression. It exists because
     the adoption plan gated a MiniSearch swap on "measurably better recall"
     and nothing could measure either side. */
  ['retrieval',    'the library still finds the right note, and prose queries stay its best case'],
];

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, fb) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : fb; };
const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

if (flag('--list')) {
  console.log('\nSuites, and what each defends:\n');
  for (const [name, claim] of SUITES) console.log(`  ${name.padEnd(14)} ${claim}`);
  console.log(`\n  pwa            the Stage 1 split build over HTTP — needs a server, so:`);
  console.log(`                 node scripts/verify.js --pwa\n`);
  process.exit(0);
}

const VALUED = ['--only', '--skip', '--engine'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const TARGET = path.resolve(positional[0] || path.join(ROOT, 'build', 'systole.html'));

if (!fs.existsSync(TARGET)) {
  console.error(`\nNo build at ${TARGET}\n\n  Build one first:  node scripts/build.js\n`);
  process.exit(1);
}

const only = list(opt('--only')), skip = list(opt('--skip'));

/* The engine, resolved once here and handed to every suite through the
   environment. Validated before a single browser starts: a typo discovered on
   suite thirty-four, forty minutes in, is a worse way to learn you meant
   "webkit" than a refusal on the first line. */
const { ENGINES, DEFAULT_ENGINE } = require(path.join(ROOT, 'tests', '_engine.js'));
const ENGINE = (opt('--engine', DEFAULT_ENGINE) || '').trim().toLowerCase();
if (!ENGINES.includes(ENGINE)) {
  console.error(`\n  --engine ${JSON.stringify(ENGINE)} is not an engine. Use one of: ${ENGINES.join(', ')}.\n`);
  process.exit(1);
}
const chosen = SUITES
  .filter(([n]) => (!only.length || only.includes(n)) && !skip.includes(n))
  .filter(([n]) => {
    const f = path.join(ROOT, 'tests', `verify-${n}.js`);
    if (fs.existsSync(f)) return true;
    console.error(`  (skipping ${n}: tests/verify-${n}.js not found)`);
    return false;
  });

if (!chosen.length) { console.error('No suites selected.'); process.exit(1); }

/* Playwright is installed globally in this environment; the suites require it
   by bare name, so NODE_PATH has to point at the global root. Resolved once
   here rather than asked of every caller's shell. */
let nodePath = process.env.NODE_PATH || '';
try {
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  if (globalRoot && !nodePath.split(path.delimiter).includes(globalRoot)) {
    nodePath = nodePath ? `${nodePath}${path.delimiter}${globalRoot}` : globalRoot;
  }
} catch (_) { /* a local node_modules will do just as well */ }

console.log(`\nVerifying ${path.relative(process.cwd(), TARGET)}`);
console.log(`  ${chosen.length} suite${chosen.length === 1 ? '' : 's'}, one at a time, on ${ENGINE}\n`);

const results = [];
const t0 = Date.now();

for (const [name, claim] of chosen) {
  process.stdout.write(`  ${name.padEnd(14)} `);
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', `verify-${name}.js`), TARGET], {
    encoding: 'utf8', maxBuffer: 1 << 26,
    env: { ...process.env, NODE_PATH: nodePath, SYSTOLE_ENGINE: ENGINE },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = m ? +m[1] : 0, failed = m ? +m[2] : null;
  const secs = ((Date.now() - t) / 1000).toFixed(0);
  const okRun = r.status === 0 && failed === 0;

  results.push({ name, claim, passed, failed, checks: passed + (failed || 0), secs, ok: okRun, out });
  if (failed === null) console.log(`did not report  (${secs}s)`);
  else console.log(`${okRun ? '✓' : '✗'} ${String(passed).padStart(3)} passed${failed ? `, ${failed} FAILED` : ''}   ${secs}s`);

  if (!okRun) {
    /* Print only the failing lines: the full transcript of seventeen suites is
       thousands of lines, and the failures are what you came for. */
    for (const ln of out.split('\n')) if (/^\s*FAIL\s/.test(ln) || /^\s*(Error|TypeError|ReferenceError)/.test(ln)) console.log(`      ${ln.trim()}`);
    if (flag('--bail')) { console.log('\n  --bail: stopping here.\n'); break; }
  }
}

/* ── the counts, written down rather than remembered ──────────────────────────
   README.md, docs/BUILD.md and .github/workflows/verify.yml all quote how many
   checks exist and how many CI runs. Those numbers were maintained by hand, in
   three files, and they drifted — the CI header currently claims both "the
   other 1052" and "those 1210 checks" for the same quantity, because a total
   moved and only some of the sentences moved with it. tests/verify-stats.js
   reads this file and holds the prose to it, which is only possible if the
   file is generated. So: generated here, never edited.

   Written ONLY from a complete run on the default engine. A --only run knows
   the count of two suites, a --skip run is missing some, and a --engine webkit
   run measures a different browser; any of those overwriting this file would
   put a confidently wrong number into three documents at once, which is worse
   than the hand-editing it replaces. */
function writeStats(pwaCount) {
  if (only.length || skip.length) return;
  if (ENGINE !== DEFAULT_ENGINE) return;
  if (chosen.length !== SUITES.length) return;
  const file = path.join(ROOT, 'tests', 'test-stats.json');
  /* --pwa is a separate opt-in, so a run without it has nothing to say about
     the split build. Carrying the previous value forward is the honest move:
     the alternative is deleting a true number because this run did not measure
     it. */
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const suites = {};
  /* Checks EXECUTED, not checks passed. On a green run these are the same
     number. They differ only in the one case that can still reach this
     function — verify-stats failing because the record is stale — and there,
     counting passes would record a smaller total than the same suite produces
     once it goes green, so the docs would be updated to a number the next run
     immediately contradicts. The record would never settle. */
  for (const r of results) suites[r.name] = r.checks;
  const stats = {
    _generated: 'by scripts/verify.js on a full green run — do not hand-edit',
    engine: ENGINE,
    suiteCount: results.length,
    total: results.reduce((n, r) => n + r.checks, 0),
    pwa: pwaCount === undefined ? (prev.pwa === undefined ? null : prev.pwa) : pwaCount,
    suites,
  };
  fs.writeFileSync(file, JSON.stringify(stats, null, 2) + '\n');
  console.log(`  counts written to ${path.relative(process.cwd(), file)}\n`);
}

/* Written before the pass/fail gate, and deliberately NOT blocked by the one
   suite whose whole job is to notice that this file is out of date. Gating it
   on green would deadlock: add a suite, verify-stats fails because the record
   does not mention it, the run is red, the record is never rewritten, and the
   only way out is to know to pass --skip stats. So a run where verify-stats is
   the only casualty still rewrites the record — and still exits non-zero,
   because the prose in three documents may now disagree with it and that needs
   a person. Run it again after fixing those and it goes green. */
const blockers = results.filter(r => !r.ok && r.name !== 'stats');

const total = results.reduce((n, r) => n + r.checks, 0);
const bad = results.filter(r => !r.ok);
console.log(`\n  ${total} checks across ${results.length} suites in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (!blockers.length && !flag('--pwa')) writeStats();
if (bad.length) {
  console.log(`\n  ${bad.length} suite${bad.length === 1 ? '' : 's'} failing: ${bad.map(r => r.name).join(', ')}\n`);
  /* A stats-only failure means the record is out of date, which is the one
     failure that must NOT stop the run: --pwa has not happened yet, and the
     split build's count is part of what needs rewriting. Exiting here left the
     record unwritten and the only way out was to know to pass --skip stats —
     the deadlock this whole arrangement exists to avoid, reintroduced two
     lines below where it was solved. */
  if (blockers.length) process.exit(1);
  console.log('  (only the counts record is stale — continuing so it can be rewritten)\n');
} else console.log(`  all green\n`);

/* ── the split build ──────────────────────────────────────────────────────────
   Built, served on a free port, tested, torn down. Kept out of the loop above
   because it is the only suite that needs a running server, and mixing a
   server's lifetime into a loop over file-path suites is how a stray node
   process outlives its run. */
if (flag('--pwa')) {
  const { spawn } = require('child_process');
  const PORT = 8137;
  console.log('── the Stage 1 split build, over HTTP ──\n');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-pwa.js'), TARGET], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout + b.stderr); process.exit(1); }
  console.log((b.stdout.match(/shell total.*/) || ['  (built)'])[0].trim());

  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.js'), String(PORT), path.join(ROOT, 'dist')],
                    { stdio: 'ignore', detached: false });
  const done = () => { try { srv.kill(); } catch (_) {} };
  process.on('exit', done); process.on('SIGINT', () => { done(); process.exit(130); });

  /* Give the listener a moment, then run. */
  const wait = spawnSync(process.execPath, ['-e',
    `const t=Date.now();(function p(){require('http').get('http://localhost:${PORT}/',r=>{r.destroy();process.exit(0)})
     .on('error',()=>{if(Date.now()-t>15000)process.exit(1);setTimeout(p,200)})})()`], { encoding: 'utf8' });
  if (wait.status !== 0) { console.error('  the static server never came up'); done(); process.exit(1); }

  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'verify-pwa.js'), `http://localhost:${PORT}`],
                      { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, NODE_PATH: nodePath, SYSTOLE_ENGINE: ENGINE } });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of out.split('\n')) if (/^\s*(PASS|FAIL)\s/.test(ln)) console.log(ln);
  done();
  if (!m || +m[2] > 0 || r.status !== 0) {
    console.log(`\n  pwa FAILED\n`);
    process.exit(1);
  }
  console.log(`\n  pwa: ${m[1]} checks, all green\n`);

  /* The Worker Pages actually runs, against the directory just built. Here
     rather than in the suite list because it needs dist/ to exist and to be
     fresh — verify-pwa serves that directory with a plain static server and
     never touches _worker.js, which in advanced mode owns every request to the
     project. A deployment went down once while that path had no test at all. */
  const wk = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'verify-pages.js'),
                                          path.join(ROOT, 'dist')], { encoding: 'utf8' });
  const wout = (wk.stdout || '') + (wk.stderr || '');
  const wm = wout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of wout.split('\n')) if (/^\s*FAIL\s/.test(ln)) console.log(ln);
  if (!wm || +wm[2] > 0 || wk.status !== 0) {
    console.log(`\n  pages FAILED\n`);
    process.exit(1);
  }
  console.log(`  pages: ${wm[1]} checks on the Worker, all green\n`);

  if (!blockers.length) writeStats(+m[1] + +wm[1]);
}

/* Deferred to here so a stale record still gets rewritten above, but never
   reports as a pass: the prose in three documents may now disagree with the
   record, and that needs a person. */
if (bad.length) process.exit(1);
