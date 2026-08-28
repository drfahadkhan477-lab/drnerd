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

const VALUED = ['--only', '--skip'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const TARGET = path.resolve(positional[0] || path.join(ROOT, 'build', 'systole.html'));

if (!fs.existsSync(TARGET)) {
  console.error(`\nNo build at ${TARGET}\n\n  Build one first:  node scripts/build.js\n`);
  process.exit(1);
}

const only = list(opt('--only')), skip = list(opt('--skip'));
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
console.log(`  ${chosen.length} suite${chosen.length === 1 ? '' : 's'}, one at a time\n`);

const results = [];
const t0 = Date.now();

for (const [name, claim] of chosen) {
  process.stdout.write(`  ${name.padEnd(14)} `);
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', `verify-${name}.js`), TARGET], {
    encoding: 'utf8', maxBuffer: 1 << 26,
    env: { ...process.env, NODE_PATH: nodePath },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = m ? +m[1] : 0, failed = m ? +m[2] : null;
  const secs = ((Date.now() - t) / 1000).toFixed(0);
  const okRun = r.status === 0 && failed === 0;

  results.push({ name, claim, passed, failed, secs, ok: okRun, out });
  if (failed === null) console.log(`did not report  (${secs}s)`);
  else console.log(`${okRun ? '✓' : '✗'} ${String(passed).padStart(3)} passed${failed ? `, ${failed} FAILED` : ''}   ${secs}s`);

  if (!okRun) {
    /* Print only the failing lines: the full transcript of seventeen suites is
       thousands of lines, and the failures are what you came for. */
    for (const ln of out.split('\n')) if (/^\s*FAIL\s/.test(ln) || /^\s*(Error|TypeError|ReferenceError)/.test(ln)) console.log(`      ${ln.trim()}`);
    if (flag('--bail')) { console.log('\n  --bail: stopping here.\n'); break; }
  }
}

const total = results.reduce((n, r) => n + r.passed, 0);
const bad = results.filter(r => !r.ok);
console.log(`\n  ${total} checks across ${results.length} suites in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (bad.length) {
  console.log(`\n  ${bad.length} suite${bad.length === 1 ? '' : 's'} failing: ${bad.map(r => r.name).join(', ')}\n`);
  process.exit(1);
}
console.log(`  all green\n`);

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
                      { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, NODE_PATH: nodePath } });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of out.split('\n')) if (/^\s*(PASS|FAIL)\s/.test(ln)) console.log(ln);
  done();
  if (!m || +m[2] > 0 || r.status !== 0) {
    console.log(`\n  pwa FAILED\n`);
    process.exit(1);
  }
  console.log(`\n  pwa: ${m[1]} checks, all green\n`);
}
