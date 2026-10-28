#!/usr/bin/env node
/*
 * Every check that needs no licensed export — what `npm test` runs.
 *
 *   npm test                 the no-export suites: pure Node, then the browser
 *                            suites that build their own documents, then the
 *                            app's browser suites on a synthetic build, then
 *                            the split build made from it
 *   npm run test:pure        the pure-Node ones only, no browser needed
 *   npm run test:private     the whole registry against your own build
 *                            (scripts/verify.js; needs build/systole.html)
 *
 *   SYSTOLE_ENGINE=webkit npm test     the browser suites on WebKit
 *
 * WHY THIS EXISTS. `npm test` was scripts/verify.js, which starts by looking
 * for build/systole.html and exits 1 without it. On a fresh clone, in a
 * Codespace, or anywhere the export is not, the most obvious command in the
 * repository did nothing but fail — while CI was running thousands of checks
 * that need no export at all. Those are now what `npm test` means, and the
 * full run keeps its own name.
 *
 * THE LIST IS THE WORKFLOW'S, NOT A COPY OF IT. The suites are read from
 * .github/workflows/verify.yml: every `node tests/verify-*.js` step in the
 * `logic` job (pure), the `public-browser` job (browser), and the
 * `synthetic-browser` job, whose build commands (`node scripts/...` lines)
 * are run first and whose suites are each handed the target the step names.
 * A synthetic build that fails fails every suite waiting on it. Last come the
 * `split-build` job's commands, in order: they make the split build from the
 * synthetic one and check it through scripts/verify.js --pwa. So a suite
 * added to CI is in `npm test` the same day, and "passes locally" and "passes
 * in CI" name the same set. tests/verify-testpublic-pure.js holds the split
 * to what the workflow says.
 *
 * A RESULT REUSED IS NOT A RESULT MEASURED. A browser suite whose inputs are
 * identical to those of an earlier pass is not run again: scripts/suite-cache.js
 * keeps what each one read (scripts/trace-inputs.js watches it), the build it
 * was handed and what the files do not say (node, Playwright, the day), and a
 * pass is reused only if every one is unchanged. It is printed REUSED, never
 * PASS, and the last line says how many suites were measured now and how many
 * were reused. --fresh measures everything; --plan says what would happen and
 * runs nothing; CI, and SYSTOLE_NO_CACHE, turn the cache off. The pure suites
 * and the split build are always measured.
 *
 * NOTHING SKIPPED IS COUNTED AS PASSED. A suite file that is missing is a
 * failure, not a skip. `--pure` says in its last line how many browser suites
 * it did not run, and never prints "all green". Without `--pure`, a browser
 * that is not installed stops the run before anything starts, rather than
 * running the pure half and reporting it as the whole.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { childEnv } = require('./gitenv.js');   // a suite never inherits where git looks for a repository

const ROOT = path.join(__dirname, '..');

/* The body of one top-level job: from "  <job>:" to the next line indented
   exactly two spaces, or the end of the file. */
function jobBody(yml, job) {
  const start = yml.indexOf(`\n  ${job}:\n`);
  if (start < 0) return null;
  const rest = yml.slice(start + job.length + 5);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\s*\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

const invoked = body => [...(body || '').matchAll(/^\s*run:\s*node\s+tests\/(verify-[a-z0-9-]+)\.js\s*$/gm)].map(m => m[1]);

/* The synthetic-browser job: the commands that build its target, in order,
   and each suite with the target its step hands it. A job that is absent
   gives none of either; verify-testpublic-pure holds the real workflow's
   list to every suite it runs, so a renamed job cannot drop out unseen. */
function syntheticJob(body) {
  const build = [...(body || '').matchAll(/^\s+node\s+(scripts\/[a-z0-9-]+\.js)((?:[ \t]+\S+)*)[ \t]*$/gm)]
    .map(m => [m[1]].concat(m[2].trim().split(/\s+/).filter(Boolean)));
  const suites = [...(body || '').matchAll(/^\s*run:\s*node\s+tests\/(verify-[a-z0-9-]+)\.js\s+(\S+)\s*$/gm)]
    .map(m => ({ name: m[1], target: m[2] }));
  return { build, suites };
}

/* The split-build job: every `node scripts/...` command in it, in order,
   whether a step runs one or a block runs several. It names no tests/ file:
   its last command is scripts/verify.js --pwa --only pwa, which serves the
   split build and runs the suites about it. A job that is absent gives no
   commands; verify-testpublic-pure holds the real workflow to having them,
   so a renamed job cannot drop out of `npm test` unseen. */
function splitJob(body) {
  return [...(body || '').matchAll(/^\s+(?:run:[ \t]+)?node\s+(scripts\/[a-z0-9-]+\.js)((?:[ \t]+\S+)*)[ \t]*$/gm)]
    .map(m => [m[1]].concat(m[2].trim().split(/\s+/).filter(Boolean)));
}

function suitesFromWorkflow(yml) {
  const logic = jobBody(yml, 'logic'), browser = jobBody(yml, 'public-browser');
  if (logic === null || browser === null)
    throw new Error(`the workflow has no ${logic === null ? 'logic' : 'public-browser'} job — nothing to take the suite list from`);
  return { pure: invoked(logic), browser: invoked(browser), synthetic: syntheticJob(jobBody(yml, 'synthetic-browser')),
           split: splitJob(jobBody(yml, 'split-build')) };
}

/* opts: { root, yml, pure, engine, executablePath, log } — the seams the
   suite drives. Returns { code, ran, failed, notRun }. */
function run(opts) {
  const o = opts || {};
  const root = o.root || ROOT;
  const log = o.log || (s => console.log(s));
  const yml = o.yml != null ? o.yml : fs.readFileSync(path.join(root, '.github', 'workflows', 'verify.yml'), 'utf8');
  const { pure, browser, synthetic, split } = suitesFromWorkflow(yml);
  const synNames = synthetic.suites.map(x => x.name);
  /* The split build is reported as one item, under its job's name. */
  const splitNames = split.length ? ['split-build'] : [];
  if (!pure.length) throw new Error('the logic job invokes no suites — refusing to report a run of nothing');

  const { ENGINES, DEFAULT_ENGINE } = require(path.join(ROOT, 'tests', '_engine.js'));
  const engine = (o.engine || process.env.SYSTOLE_ENGINE || DEFAULT_ENGINE).trim().toLowerCase();
  if (!ENGINES.includes(engine)) throw new Error(`SYSTOLE_ENGINE ${JSON.stringify(engine)} is not an engine. Use one of: ${ENGINES.join(', ')}.`);
  if (!o.pure) {
    let exe = null;
    try { exe = o.executablePath !== undefined ? o.executablePath : require('playwright')[engine].executablePath(); }
    catch (e) { exe = null; }
    if (!exe || !fs.existsSync(exe)) {
      log(`\n  ${browser.length + synNames.length} browser suites need ${engine}, and playwright has no ${engine} installed.`);
      log(`  install    npm ci && npx playwright install ${engine}`);
      log(`  or run     npm run test:pure      (the ${pure.length} pure suites, and says what it left out)\n`);
      return { code: 1, ran: [], failed: [], notRun: pure.concat(browser, synNames, splitNames) };
    }
  }

  const list = (o.pure ? pure : pure.concat(browser)).map(name => ({ name, args: [], remember: !o.pure && browser.includes(name) }));
  const ran = [], failed = [], reused = [];
  let saved = 0;
  /* The result cache (scripts/suite-cache.js), for the browser suites only:
     asked for by the command line, never by this function, so a run made
     with no `cache` option is the run it always was. */
  const cache = (typeof o.cache === 'function' ? o.cache({ root, engine }) : o.cache) || null;
  const planning = !!(cache && cache.plan);
  if (cache && cache.off) log(`  result cache: off (${cache.off}); every browser suite is measured.`);
  const when = e => String(e.result.at || '').slice(0, 16).replace('T', ' ') + 'Z';
  /* A cache that fails must fail open, to measuring: nothing it does wrong may
     stop a suite from running or a run from finishing. */
  const asked = (name, args) => { try { return cache.decide(name, args); } catch (e) { return { reuse: false, why: `the cache could not be read (${e.code || e.message})` }; } };
  const cannot = (name, what, e) => { if (cache.notRemembered) cache.notRemembered.push({ name, why: `the cache could not ${what} (${e.code || e.message})` }); };
  const runOne = ({ name, args, refused, remember }) => {
    const file = path.join(root, 'tests', name + '.js');
    const eligible = !!(cache && remember && !refused), keep = eligible && !cache.off;
    if (planning) {
      if (!eligible || !fs.existsSync(file)) return;
      const d = keep ? asked(name, args) : { reuse: false, why: cache.off };
      if (d.reuse) { reused.push(name); saved += d.entry.result.seconds || 0; }
      log(`  ${d.reuse ? 'REUSE' : 'RUN  '}  ${name.padEnd(38)} ${d.reuse ? 'inputs identical to the pass of ' + when(d.entry) : d.why}`);
      return;
    }
    if (keep && fs.existsSync(file)) {
      const d = asked(name, args);
      if (d.reuse) {
        const secs = d.entry.result.seconds || 0;
        reused.push(name); saved += secs;
        log(`  REUSED  ${name.padEnd(38)} inputs identical to the pass of ${when(d.entry)}  (${secs.toFixed(1)}s not spent)`);
        return;
      }
    }
    const t0 = Date.now();
    let status, prep = null;
    if (refused) status = refused;
    else if (!fs.existsSync(file)) status = 'missing';
    else {
      if (keep) { try { prep = cache.prepare(name); } catch (e) { prep = null; cannot(name, 'prepare a trace', e); } }
      const base = childEnv({ SYSTOLE_ENGINE: engine });
      const r = spawnSync(process.execPath, [file].concat(args), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
        env: prep ? cache.env(base, prep) : base, maxBuffer: 64 * 1048576 });
      status = r.status === 0 ? 'pass' : (r.status === null ? `killed (${r.signal})` : `exit ${r.status}`);
      if (status !== 'pass') {
        /* Diagnostics belong ahead of successful assertions that happen to
           mention an error. A locator timeout need not contain "Error". */
        const lines = String(r.stdout || '').split('\n').filter(l => l.trim());
        let out = String(r.stderr || '').split('\n').filter(l => l.trim()).slice(-8)
          .concat(lines.filter(l => /^\s*FAIL\b/.test(l)).slice(0, 8));
        if (!out.length) out = lines.slice(-8);
        if (r.error) out.unshift(r.error.message);
        if (out.length) log(out.map(l => '      ' + l).join('\n'));
      }
    }
    ran.push(name);
    if (status !== 'pass') failed.push(name);
    const seconds = (Date.now() - t0) / 1000;
    /* A pass is remembered if the cache can vouch for it; anything else is
       forgotten, so a stale pass cannot outlive a failure. */
    if (prep) {
      try { cache.store(name, args, prep, { status, seconds, startedAt: t0 }); } catch (e) { cannot(name, 'keep it', e); }
      cache.discard(prep);
    }
    log(`  ${status === 'pass' ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${status === 'pass' ? '' : status + '  '}${seconds.toFixed(1)}s`);
  };
  list.forEach(runOne);

  /* The synthetic build first, then its suites. A build step that fails is
     not a reason to skip them quietly: each is run as a failure that says why. */
  if (!o.pure && synthetic.suites.length) {
    let broke = null;
    for (const [script, ...args] of synthetic.build) {
      log(`  build  node ${script} ${args.join(' ')}`);
      const r = spawnSync(process.execPath, [path.join(root, script)].concat(args), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv(), maxBuffer: 64 * 1048576 });
      if (r.status !== 0) { broke = `synthetic build failed at ${script}`; log('      ' + String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n      ')); break; }
    }
    synthetic.suites.forEach(x => runOne({ name: x.name, args: [x.target], refused: broke, remember: true }));
  }

  /* Then the split build, made and checked by the split-build job's own
     commands, in order, in this run's engine. The first command that fails
     stops the rest and fails the run under the job's name, with its last
     lines: a split build that was never made has nothing to check. It is
     always measured: it takes about a minute, and it rebuilds what it checks. */
  if (!o.pure && split.length && !planning) {
    const t0 = Date.now();
    let status = 'pass';
    for (const [script, ...args] of split) {
      log(`  split  node ${script} ${args.join(' ')}`);
      const r = spawnSync(process.execPath, [path.join(root, script)].concat(args), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv({ SYSTOLE_ENGINE: engine }), maxBuffer: 64 * 1048576 });
      if (r.status !== 0) {
        status = `failed at ${script}`;
        log('      ' + String(r.stderr || '').concat(String(r.stdout || '')).trim().split('\n').slice(-8).join('\n      '));
        break;
      }
    }
    ran.push('split-build');
    if (status !== 'pass') failed.push('split-build');
    log(`  ${status === 'pass' ? 'PASS' : 'FAIL'}  ${'split-build'.padEnd(40)} ${status === 'pass' ? '' : status + '  '}${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  if (planning) {
    const asked = browser.length + synNames.length;
    log('');
    log(`  plan: of ${asked} browser suites, ${reused.length} would be REUSED${reused.length ? ` (about ${(saved / 60).toFixed(1)} min of browser time not spent)` : ''} and ${asked - reused.length} would run. The ${pure.length} pure suites${split.length ? ' and the split build' : ''} always run.`);
    log('  Nothing was run. npm test does this, then runs what it listed.');
    return { code: 0, ran: [], failed: [], notRun: [], reused, planned: true };
  }

  const notRun = o.pure ? browser.concat(synNames, splitNames) : [];
  const measured = ran.length - splitNames.filter(n => ran.includes(n)).length;
  log('');
  const kept = cache && cache.notRemembered ? cache.notRemembered.filter(x => x.why !== 'it did not pass') : [];
  if (failed.length) log(`  ${failed.length} of ${ran.length} suites failed: ${failed.join(', ')}` + (reused.length ? `  (${reused.length} others were REUSED, not measured now)` : ''));
  else if (notRun.length) log(`  ${ran.length} pure suites passed. ${notRun.length} browser suites NOT run: ${notRun.join(', ')}`);
  else if (reused.length)
    log(`  all ${measured + reused.length} no-export suites passed: ${measured} measured now, ${reused.length} REUSED from earlier passes whose inputs are identical` +
        ` (${(saved / 60).toFixed(1)} min of browser time not spent; npm run test:fresh measures them all)` +
        (splitNames.length ? ', and the split build made from it was measured now.' : '.'));
  else log(`  all ${ran.length - splitNames.length} no-export suites passed (${pure.length} pure, ${browser.length + synNames.length} in ${engine}, ${synNames.length} of them on a synthetic build)` +
           (splitNames.length ? ', and the split build made from it.' : '.'));
  if (kept.length) log(`  not remembered, so measured every run: ${kept.map(x => `${x.name} (${x.why})`).join('; ')}`);
  log('  The suites that drive a real build need your export: npm run test:private');
  return { code: failed.length ? 1 : 0, ran, failed, notRun, reused };
}

/* Every suite CI runs anywhere, by registry name ("keys", not "verify-keys").
   scripts/verify.js tags the rest `laptop`: the ones only a machine with the
   export can run, which is what the owner's quick laptop run is. Read from the
   workflow, so a suite added to CI leaves that set the same day. */
function ciSuites(yml) {
  const w = suitesFromWorkflow(yml);
  return new Set([...w.pure, ...w.browser, ...w.synthetic.suites.map(x => x.name)].map(n => n.replace(/^verify-/, '')));
}

module.exports = { suitesFromWorkflow, run, jobBody, ciSuites };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/test-public.js [--pure] [--fresh] [--plan] [--help]

  --pure       Run only suites that need no browser or private export
  --fresh      Measure every browser suite now, ignoring remembered passes
               (they are remembered again afterwards; SYSTOLE_FRESH=1 is the same)
  --plan       Say which browser suites would be reused and which would run,
               and why. Runs no suite (it does make the synthetic build)
  --help, -h   Show help without starting tests

A browser suite whose inputs are identical to an earlier pass is REUSED, not
measured again, and the last line says how many. The cache is off when CI or
SYSTOLE_NO_CACHE is set.

Set SYSTOLE_ENGINE to chromium, webkit or firefox to choose the browser.
`);
    process.exit(0);
  }
  const unexpected = args.find(arg => !['--pure', '--fresh', '--plan'].includes(arg));
  if (unexpected !== undefined) {
    console.error(`Unexpected argument: ${unexpected}\nUse --help to see public test options.`);
    process.exit(2);
  }
  if (args.includes('--plan') && args.includes('--pure')) {
    console.error('--plan says what the browser suites would do, and --pure runs none of them.');
    process.exit(2);
  }
  const SC = () => require('./suite-cache.js');
  const cache = args.includes('--pure') ? null
    : ({ root, engine }) => SC().fromEnv({ root, engine, fresh: args.includes('--fresh'), plan: args.includes('--plan'), commit: require('./stamp.js').gitCommit(root) });
  try { process.exit(run({ pure: args.includes('--pure'), cache }).code); }
  catch (e) { console.error('\n  ' + e.message + '\n'); process.exit(1); }
}
