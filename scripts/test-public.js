#!/usr/bin/env node
/*
 * Every check that needs no licensed export — what `npm test` runs.
 *
 *   npm test                 the no-export suites: pure Node, then the browser
 *                            suites that build their own documents, then the
 *                            app's browser suites on a synthetic build
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
 * `logic` job (pure), the `memorizer-browser` job (browser), and the
 * `synthetic-browser` job, whose build commands (`node scripts/...` lines)
 * are run first and whose suites are each handed the target the step names.
 * A synthetic build that fails fails every suite waiting on it. So a suite
 * added to CI is in `npm test` the same day, and "passes locally" and "passes
 * in CI" name the same set. tests/verify-testpublic-pure.js holds the split
 * to what the workflow says.
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

function suitesFromWorkflow(yml) {
  const logic = jobBody(yml, 'logic'), browser = jobBody(yml, 'memorizer-browser');
  if (logic === null || browser === null)
    throw new Error(`the workflow has no ${logic === null ? 'logic' : 'memorizer-browser'} job — nothing to take the suite list from`);
  return { pure: invoked(logic), browser: invoked(browser), synthetic: syntheticJob(jobBody(yml, 'synthetic-browser')) };
}

/* opts: { root, yml, pure, engine, executablePath, log } — the seams the
   suite drives. Returns { code, ran, failed, notRun }. */
/* WHERE GIT LOOKS FOR A REPOSITORY IS NOT INHERITED. Git exports GIT_DIR to
   the hooks of a linked worktree (and only there), and the pre-push hook runs
   this. Several suites build throwaway repositories in a temp directory and
   run git there by cwd; with GIT_DIR in their environment every one of those
   commands went to the real repository instead. Pushing from a worktree once
   moved its branch onto sixteen fixture commits and set core.bare on the
   whole clone. A suite finds this repository by its cwd, like a person does. */
const REPO_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX'];
function childEnv(extra) {
  const env = Object.assign({}, process.env, extra);
  for (const k of REPO_ENV) delete env[k];
  return env;
}

function run(opts) {
  const o = opts || {};
  const root = o.root || ROOT;
  const log = o.log || (s => console.log(s));
  const yml = o.yml != null ? o.yml : fs.readFileSync(path.join(root, '.github', 'workflows', 'verify.yml'), 'utf8');
  const { pure, browser, synthetic } = suitesFromWorkflow(yml);
  const synNames = synthetic.suites.map(x => x.name);
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
      return { code: 1, ran: [], failed: [], notRun: pure.concat(browser, synNames) };
    }
  }

  const list = (o.pure ? pure : pure.concat(browser)).map(name => ({ name, args: [] }));
  const ran = [], failed = [];
  const runOne = ({ name, args, refused }) => {
    const file = path.join(root, 'tests', name + '.js');
    const t0 = Date.now();
    let status;
    if (refused) status = refused;
    else if (!fs.existsSync(file)) status = 'missing';
    else {
      const r = spawnSync(process.execPath, [file].concat(args), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv({ SYSTOLE_ENGINE: engine }), maxBuffer: 64 * 1048576 });
      status = r.status === 0 ? 'pass' : (r.status === null ? `killed (${r.signal})` : `exit ${r.status}`);
      if (status !== 'pass') {
        const out = (String(r.stdout || '') + String(r.stderr || '')).split('\n').filter(l => /FAIL|Error|error/.test(l)).slice(0, 8);
        if (out.length) log(out.map(l => '      ' + l).join('\n'));
      }
    }
    ran.push(name);
    if (status !== 'pass') failed.push(name);
    log(`  ${status === 'pass' ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${status === 'pass' ? '' : status + '  '}${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
    synthetic.suites.forEach(x => runOne({ name: x.name, args: [x.target], refused: broke }));
  }

  const notRun = o.pure ? browser.concat(synNames) : [];
  log('');
  if (failed.length) log(`  ${failed.length} of ${ran.length} suites failed: ${failed.join(', ')}`);
  else if (notRun.length) log(`  ${ran.length} pure suites passed. ${notRun.length} browser suites NOT run: ${notRun.join(', ')}`);
  else log(`  all ${ran.length} no-export suites passed (${pure.length} pure, ${browser.length + synNames.length} in ${engine}, ${synNames.length} of them on a synthetic build).`);
  log('  The suites that drive a real build need your export: npm run test:private');
  return { code: failed.length ? 1 : 0, ran, failed, notRun };
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
  try { process.exit(run({ pure: process.argv.includes('--pure') }).code); }
  catch (e) { console.error('\n  ' + e.message + '\n'); process.exit(1); }
}
