#!/usr/bin/env node
/*
 * Run every behavioural suite against a build.
 *
 *   node scripts/verify.js [build/systole.html] [options]
 *
 *   --only <a,b>   run just these suites (names as in tests/verify-<name>.js)
 *   --skip <a,b>   run everything except these
 *   --bail         stop at the first failing suite
 *   --list         print the suites and what each covers, then exit
 *
 * WHY THIS EXISTS. There are fifteen suites and roughly 350 checks, and they
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
 * verify-pwa is not in this list: it tests the Stage 1 split build over HTTP,
 * which needs scripts/build-pwa.js and scripts/serve.js rather than the single
 * file. It is run separately, and --list says so.
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
  ['apex',         'the tutor, its tools, and the 3D heart it sits beside'],
  ['stage2',       'FSRS-5 scheduling replaces SM-2'],
  ['stage3',       'Apex can read figures and remembers who it teaches'],
  ['polish',       'Pencil feel, the hero heart, the rhythm library'],
  ['splash',       'the pre-paint loading screen, on a throttled CPU'],
  ['ink',          'the engraved drawing style'],
  ['braunwald',    'grounded mode answers only from your references'],
  ['leads',        'the 12-lead morphology falls out of one dipole'],
  ['scan',         'the photoreal heart beats on the same cardiac clock'],
  ['physio',       'the cardiac cycle is computed, not drawn'],
  ['theme',        'eight palettes, two axes, unthemed semantics'],
  ['home',         'the welcome bar, the progress bar, three layouts'],
  ['splash-heart', 'the crystal heart paints before the app parses'],
  ['crisp',        'every canvas backs itself at high device-pixel density'],
];

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, fb) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : fb; };
const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

if (flag('--list')) {
  console.log('\nSuites, and what each defends:\n');
  for (const [name, claim] of SUITES) console.log(`  ${name.padEnd(14)} ${claim}`);
  console.log(`\n  pwa            the Stage 1 split build over HTTP — run separately:`);
  console.log(`                 node scripts/build-pwa.js <build.html> && node scripts/serve.js 8080 dist`);
  console.log(`                 node tests/verify-pwa.js http://localhost:8080\n`);
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
    /* Print only the failing lines: the full transcript of fifteen suites is
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
