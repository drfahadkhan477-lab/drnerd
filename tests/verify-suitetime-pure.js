#!/usr/bin/env node
'use strict';
/*
 * How long a suite may run, and where its time went (scripts/suitetime.js).
 *
 *   node tests/verify-suitetime-pure.js
 *
 * The rules: a suite's ceiling is three times its recorded time, never under
 * 20 minutes, an hour when it has no record, and --suite-timeout overrides it
 * (0 = none). A suite past its ceiling is stopped, reported as having died, and
 * named with the section it was in. Section times come from the "── … ──"
 * headings, even when a chunk ends mid-line. The end-to-end check runs the real
 * runner with a ceiling too short for any suite to beat.
 *
 * And which suites the routine laptop run is: those tagged `laptop`, the ones
 * no CI job names, read from the workflow so the set keeps itself current.
 */
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { limitFor, sectionClock, slowest, watch, FLOOR_MS, UNKNOWN_MS } = require('../scripts/suitetime.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const ROOT = path.join(__dirname, '..');
const MIN = 60000;

(async () => {
  head('the ceiling');
  ok('a quick suite gets the 20-minute floor', limitFor(100) === FLOOR_MS && FLOOR_MS === 20 * MIN, String(limitFor(100)));
  ok('a slow suite gets three times its record', limitFor(2622) === 3 * 2622 * 1000, String(limitFor(2622)));
  ok('a suite with no record gets an hour', limitFor(undefined) === UNKNOWN_MS && UNKNOWN_MS === 60 * MIN);
  ok('--suite-timeout 5 is five minutes, whatever the record', limitFor(2622, '5') === 5 * MIN);
  ok('--suite-timeout 0 is no ceiling at all', limitFor(2622, '0') === null);
  let threw = '';
  try { limitFor(10, 'soon'); } catch (e) { threw = e.message; }
  ok('a non-number is refused, not read as zero', /minutes/.test(threw), threw);

  head('the section clock');
  {
    const c = sectionClock(1000);
    c.feed('\n── first sec', 1100);           // heading split across two chunks
    ok('a heading cut mid-line is not counted yet', c.current() === null, String(c.current()));
    c.feed('tion ──\n  PASS  a\n', 1200);
    ok('it is counted once the line completes', c.current() === 'first section', String(c.current()));
    c.feed('  PASS  b\n\n── second ──\n', 4200);
    c.feed('  PASS  c\n', 5000);
    const s = c.end(9200);
    ok('each section runs from its heading to the next', s.length === 2 && s[0].section === 'first section' && s[0].ms === 3000,
       JSON.stringify(s));
    ok('the last runs to the end of the suite', s[1] && s[1].section === 'second' && s[1].ms === 5000, JSON.stringify(s[1]));
    ok('a PASS line is not a heading', !s.some(x => /PASS/.test(x.section)));
  }
  {
    const rows = [{ name: 'a', sections: [{ section: 'x', ms: 5 }, { section: 'y', ms: 50 }] },
                  { name: 'b', sections: [{ section: 'z', ms: 20 }] }, { name: 'c' }];
    const top = slowest(rows, 2);
    ok('slowest() ranks across suites, longest first, and stops at n',
       top.length === 2 && top[0].suite === 'a' && top[0].section === 'y' && top[1].suite === 'b', JSON.stringify(top));
  }

  head('the watchdog stops a suite that will not finish');
  {
    const ch = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    let fired = false;
    const t = Date.now();
    watch(ch, 300, () => { fired = true; });
    /* Capped, so a watchdog that never kills fails this check instead of
       hanging the suite that tests it. */
    const code = await Promise.race([new Promise(r => ch.on('close', (c, sig) => r(sig || c))),
                                     new Promise(r => setTimeout(() => r('still running after 5 s'), 5000))]);
    try { ch.kill('SIGKILL'); } catch (_) {}
    ok('a child that never exits is stopped', fired && code !== 'still running after 5 s', `${Date.now() - t} ms, ${code}`);
  }
  {
    const ch = spawn(process.execPath, ['-e', '0']);
    let fired = false;
    const cancel = watch(ch, 2000, () => { fired = true; });
    await new Promise(r => ch.on('close', r));
    cancel();
    await new Promise(r => setTimeout(r, 2300));
    ok('a child that finishes in time is left alone, and its timer cancelled', !fired);
  }
  ok('no ceiling means no timer', typeof watch({}, null, () => {}) === 'function');

  head('the runner, end to end');
  {
    /* 0.0002 min is 12 ms: no suite gets as far as its first line in that, so
       the runner has to stop it and say so. */
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--only', 'cause-pure', '--suite-timeout', '0.0002'],
                        { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    ok('the stopped suite is reported as having died, not as passing', /did not report/.test(out) && r.status !== 0,
       `exit ${r.status}`);
    ok('and the runner says it stopped it, and after how long', /stopped by verify\.js after .* \(its limit: /.test(out));
    const r2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--only', 'cause-pure', '--suite-timeout', 'later'],
                         { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    ok('a bad --suite-timeout stops the run before any suite starts', r2.status === 2 && /wants minutes/.test(r2.stderr || ''),
       `exit ${r2.status}`);
  }

  head('the laptop run: what only a machine with the export can run');
  {
    const { ciSuites } = require('../scripts/test-public.js');
    const fixture = [
      'jobs:',
      '  logic:',
      '    steps:',
      '      - name: a (1 checks)',
      '        run: node tests/verify-alpha-pure.js',
      '  memorizer-browser:',
      '    steps:',
      '      - name: b (1 checks)',
      '        run: node tests/verify-memorizer-beta.js',
      '  synthetic-browser:',
      '    steps:',
      '      - name: c (1 checks)',
      '        run: node tests/verify-gamma.js build/synthetic/systole.html',
      '  full:',
      '    steps:',
      '      - run: node tests/verify-delta.js build/systole.html',
      '',
    ].join('\n');
    const set = ciSuites(fixture);
    ok('ciSuites() takes the logic, Memorizer and synthetic jobs, by registry name',
       ['alpha-pure', 'memorizer-beta', 'gamma'].every(n => set.has(n)), [...set].join(','));
    ok('and not the full job, which runs only on a machine with the export', !set.has('delta'));

    /* Against the real registry and workflow, with a different instrument: a
       plain search of verify.yml for the suite's file, not the job parser. */
    const yml = require('fs').readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
    const list = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--list'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
    const rows = [...list.matchAll(/^  ([a-z0-9-]+)\s+\[([a-z,]+)\]/gm)].map(m => ({ n: m[1], laptop: m[2].split(',').includes('laptop') }));
    const named = n => yml.includes(`tests/verify-${n}.js`);
    const wrong = rows.filter(r => r.laptop === named(r.n)).map(r => r.n);
    ok('--list tags `laptop` exactly the suites the workflow never names', rows.length > 100 && wrong.length === 0,
       `${rows.length} listed; wrong: ${wrong.join(', ') || 'none'}`);
    const lap = rows.filter(r => r.laptop).map(r => r.n);
    ok('and there are some: the quick laptop run is not empty', lap.length > 0, lap.join(', '));
    const t = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--tag', 'laptop', '--only', 'cause-pure'],
                        { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    ok('--tag laptop is accepted', !/is not a tag/.test((t.stderr || '') + (t.stdout || '')), `exit ${t.status}`);
  }

  head('a value given to --suite-timeout is not the build');
  {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--suite-timeout', '30', '--only', 'cause-pure'],
                        { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    ok('"--suite-timeout 30" leaves the target at the default build', /Verifying build[\/\\]systole\.html/.test(out) && !/Verifying 30\b/.test(out),
       (out.match(/Verifying \S+/) || ['no Verifying line'])[0]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
