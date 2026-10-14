'use strict';
/*
 * A browser suite's result, remembered, and the reasons it may be reused.
 *
 *   node scripts/test-public.js            reuses what it may, says what it did
 *   node scripts/test-public.js --plan     says what it would reuse and run, runs nothing
 *   node scripts/test-public.js --fresh    measures everything now
 *
 * WHY THIS EXISTS. Every session ran the whole browser run, twenty-odd
 * minutes in Chromium and as long again in WebKit, again and again: on a
 * master CI had already proved green, after changing one test, and from the
 * top after an environment hiccup at suite forty of sixty. Nearly all of that
 * re-measured something that had not changed.
 *
 * THE RULE, which is Go's test cache and Bazel's: a result may be reused only
 * if EVERYTHING the run depended on is the same, and a result is a pass or it
 * is nothing. "Everything" is the suite's file and each file it, the node
 * processes it starts and its browser read (scripts/trace-inputs.js watches
 * them do it, rather than guessing from the source), the build it was handed,
 * and a fingerprint of what the files do not say: node, Playwright and the
 * browser's revision, the lockfile, the engine, the day and the time zone, and
 * every environment variable the tests and scripts read. A file that was
 * ABSENT is an input too: a suite that asked whether a flag file existed gets
 * a different answer when it does.
 *
 * WHAT A REUSE IS NOT. It is not a measurement made now. scripts/test-public.js
 * prints it as REUSED, never as PASS, and its last line says how many suites
 * were measured now and how many were reused. AGENTS.md says the same of any
 * report: a result recorded earlier is kept apart from one observed now. The
 * pure suites are never reused (they are the guards, and they are fast), the
 * split build is never reused, and CI never reuses anything: with CI set the
 * cache is off, so what CI says is always a measurement. Nor is Firefox
 * traced: see TRACED_ENGINES.
 *
 * WHAT IT CANNOT KNOW, said out loud: a suite that is flaky may have passed by
 * luck, and its luck is remembered; a browser's behaviour that depends on the
 * machine (GPU, fonts, load) is not in the key; and a node_modules file edited
 * by hand is not seen, only the lockfile and the versions. --fresh is the answer
 * to all three, and what a release or a doubt should use.
 *
 * The cache lives in node_modules/.cache, like the reader assets', and goes
 * with node_modules: an `npm ci` starts it empty, which is also the right
 * thing, since it changes the lockfile's meaning of "installed".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { relativeIn, rootsOf, traceEnv } = require('./trace-inputs.js');
const { STAMP_RE } = require('./stamp.js');
const { replaceWhole } = require('./atomic.js');

const VERSION = 1;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const posix = p => p.split(path.sep).join('/');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

const cacheDir = root => path.join(root, 'node_modules', '.cache', 'systole-suite-results');

/* ── the fingerprint: what the files do not say ────────────────────────────── */

/* The environment a run depends on. Names are found in the SOURCE OF THE FILES
   THE RUN READ (process.env.NAME and process.env['NAME'] in each .js its trace
   lists, children's included), plus a few that node, Playwright and the
   browsers read themselves. Scanning the whole of tests/ and scripts/ instead
   made the key depend on variables no suite reads, such as npm_execpath, which
   npm sets and node does not: the same suite would miss when started by one and
   not the other. A value is hashed, never stored. Our own variables are not
   part of the answer. */
const BASE_ENV = ['TZ', 'CI', 'LANG', 'LC_ALL', 'LANGUAGE', 'NODE_OPTIONS', 'NODE_PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'PWDEBUG', 'DEBUG', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
const NEVER = new Set(['SYSTOLE_TRACE_FILE', 'SYSTOLE_TRACE_ROOT']);
function envNamesOf(inputs, root) {
  const names = new Set(BASE_ENV);
  for (const [rel, spec] of Object.entries(inputs)) {
    if (!/\.(c|m)?js$/.test(rel) || !/^f:/.test(spec.s)) continue;
    let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
    for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)|process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g)) names.add(m[1] || m[2]);
    /* A read the scan cannot name, process.env[expression], could be any
       variable. That file stands for the ones that matter: every SYSTOLE_
       variable, held as a group so that one added is noticed as well as one
       changed, and each name in capitals that the file spells out as a string. */
    if (/process\.env\[\s*(?!['"])/.test(text)) {
      names.add('SYSTOLE_*');
      for (const m of text.matchAll(/['"]([A-Z][A-Z0-9_]{2,})['"]/g)) names.add(m[1]);
    }
  }
  for (const n of NEVER) names.delete(n);
  return [...names].sort();
}
/* "PREFIX*" is every variable that starts with PREFIX, hashed together. */
const envPart = (names, env) => Object.fromEntries(names.map(n => [n, n.endsWith('*')
  ? sha(Object.keys(env).filter(k => k.startsWith(n.slice(0, -1)) && !NEVER.has(k)).sort().map(k => k + '=' + env[k]).join('\0')).slice(0, 12)
  : env[n] === undefined ? '' : sha(String(env[n])).slice(0, 12)]));

/* The versions that decide how the browser behaves: Playwright's, and the
   revision of each build it would launch for this engine. */
function playwrightInfo(root, engine) {
  const dir = path.join(root, 'node_modules', 'playwright-core');
  const pkg = readJSON(path.join(dir, 'package.json')), list = readJSON(path.join(dir, 'browsers.json'));
  const builds = ((list && list.browsers) || []).filter(b => b.name === engine || b.name.startsWith(engine + '-') || b.name.startsWith(engine + '_'))
    .map(b => `${b.name}@${b.revision}${b.browserVersion ? '/' + b.browserVersion : ''}`).sort();
  return { playwright: pkg ? pkg.version : 'unknown', browser: builds.join(',') || 'unknown' };
}

/* The code that decides what a pass means: this file, the tracer, the runner
   that starts each suite, and the environment it gives them. A fix to how a
   state is hashed must not be answered by a pass recorded before the fix, so
   a change to any of them makes every earlier pass stale. Read from where the
   code is, not from the root being run: a copy of the project in a temporary
   folder is judged by the same code. */
const RUNNER_FILES = ['suite-cache.js', 'trace-inputs.js', 'test-public.js', 'gitenv.js', 'stamp.js', 'atomic.js'];
function runnerHash(dir = __dirname) {
  const h = crypto.createHash('sha256');
  for (const n of RUNNER_FILES) { h.update(n + '\0'); try { h.update(fs.readFileSync(path.join(dir, n))); } catch (_) { h.update('?'); } h.update('\0'); }
  return h.digest('hex').slice(0, 16);
}

const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* fingerprint({ root, engine, now, env, override }) → parts
   One name per thing that can change, so a miss can say which. What differs
   per suite, the environment, is held with each entry. */
function fingerprint({ root, engine, now = new Date(), env = process.env, override = {} }) {
  const lock = (() => { try { return sha(fs.readFileSync(path.join(root, 'package-lock.json'))).slice(0, 16); } catch (_) { return 'none'; } })();
  const pw = playwrightInfo(root, engine);
  let tz = env.TZ; try { tz = tz || Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { /* leave it */ }
  const parts = Object.assign({ node: process.version, platform: `${process.platform}-${process.arch}`, playwright: pw.playwright, browser: pw.browser,
    lockfile: lock, engine, date: localDate(now), tz: tz || '', runner: runnerHash() }, override);
  return parts;
}

/* ── the inputs: what the run read ─────────────────────────────────────────── */

/* A file's bytes with the build stamp taken out. The stamp names the commit and
   whether the tree was dirty, so it differs between two builds of the same
   app; a page cannot read it, and no browser suite looks (checked: none of
   them mentions it or runs git). Bytes, not a string, as scripts/stamp.js says. */
function stripStamp(buf) { return Buffer.from(buf.toString('latin1').replace(STAMP_RE, ''), 'latin1'); }

function listing(abs, recursive) {
  const out = [];
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of list) {
      const r = rel ? rel + '/' + e.name : e.name;
      out.push(r + (e.isDirectory() ? '/' : ''));
      if (recursive && e.isDirectory()) walk(path.join(d, e.name), r);
    }
  };
  walk(abs, '');
  return out.sort();
}

function treeHash(abs) {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of list.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { h.update('d ' + r + '\n'); walk(path.join(d, e.name), r); }
      else { h.update('f ' + r + ' '); try { h.update(sha(fs.readFileSync(path.join(d, e.name)))); } catch (_) { h.update('?'); } h.update('\n'); }
    }
  };
  walk(abs, '');
  return h.digest('hex');
}

/* stateOf(abs, spec) → a string that is the same while the thing is the same.
   spec: { modes: [..], strip } — what was done to it, and whether the stamp is
   to be ignored. */
function stateOf(abs, spec) {
  let st; try { st = fs.statSync(abs); } catch (_) { return 'absent'; }
  const modes = new Set(spec.modes);
  if (st.isDirectory()) {
    if (modes.has('tree')) return 't:' + treeHash(abs);
    if (modes.has('listr')) return 'dr:' + sha(JSON.stringify(listing(abs, true)));
    if (modes.has('list')) return 'd:' + sha(JSON.stringify(listing(abs, false)));
    return 'd';
  }
  if (!st.isFile()) return 'other';
  let buf; try { buf = fs.readFileSync(abs); } catch (_) { return 'unreadable'; }
  return 'f:' + sha(spec.strip ? stripStamp(buf) : buf);
}

function readTrace(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return { records: [], bad: 0, missing: true }; }
  const records = []; let bad = 0;
  for (const line of text.split('\n')) { if (!line) continue; try { records.push(JSON.parse(line)); } catch (_) { bad++; } }
  return { records, bad, missing: false };
}

/* inputsOf(trace, root, args, runStart) → { inputs, touched }
   Folds the trace into one entry per path: how it was touched, and its state
   now (after the run: a file the suite wrote and then read is as the run left
   it, which is what the next lookup will find unless someone changes it). */
const SKEW = 2000;
function inputsOf(trace, root, args, runStart = Infinity) {
  const want = new Map();
  const roots = rootsOf(root);
  const add = (rel, mode, browserOnly) => {
    const e = want.get(rel) || { modes: new Set(), node: false, browser: false };
    e.modes.add(mode); if (browserOnly) e.browser = true; else e.node = true; want.set(rel, e);
  };
  for (const [op, p, extra] of trace.records) {
    if (!p || op === 'spawn' || op === 'flag') continue;
    const rel0 = relativeIn(path.resolve(p), roots);
    if (rel0 === null) continue;
    const rel = posix(rel0);
    if (op === 'browser') add(rel, 'read', true);
    else if (op === 'list') add(rel, extra === 'r' ? 'listr' : 'list');
    else add(rel, op);
  }
  /* The build a suite is handed: a file in its arguments. A browser loads it,
     so it is held by its content less the stamp. */
  for (const a of args) {
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    const abs = path.resolve(root, a);
    let st; try { st = fs.statSync(abs); } catch (_) { continue; }
    const rel = relativeIn(abs, roots);
    if (st.isFile() && rel !== null) add(posix(rel), 'read', true);
  }
  const inputs = {}, touched = [];
  for (const [rel, e] of [...want].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    /* An input modified while the run was going: the run read one thing and
       the entry would hold another, so a pass over the first would be reused
       for the second. Refused, whoever touched it. A write during the run
       carries a time between its start and now, so a file stamped later than
       that (an archive made on a machine with a faster clock) was not written
       during it; SKEW is for clocks that disagree by a little. */
    try { const m = fs.statSync(path.join(root, rel)).mtimeMs; if (m >= runStart && m <= Date.now() + SKEW) touched.push(rel); } catch (_) { /* absent: no mtime */ }
    /* The stamp may be ignored only if nothing but a browser looked at the file;
       node reading it could have measured its length. */
    const spec = { modes: [...e.modes].sort(), strip: e.browser && !e.node };
    inputs[rel] = { m: spec.modes, strip: spec.strip, s: stateOf(path.join(root, rel), spec) };
  }
  return { inputs, touched };
}

/* ── what may be remembered ────────────────────────────────────────────────── */

/* Why a run cannot be remembered, or '' if it can. The suite's own file must
   be in the trace: a tracer that saw nothing (it failed to load, or the suite
   ran somewhere it was not started with it) has not vouched for anything. */
function whyNotRemembered(trace, name, root, allowSpawn) {
  if (trace.missing) return 'the tracer wrote nothing';
  if (trace.bad) return 'the trace is cut off (a process died mid-write)';
  const self = posix(path.join('tests', name + '.js'));
  const roots = rootsOf(root);
  const saw = trace.records.some(r => (r[0] === 'read' || r[0] === 'stat') && r[1] && relativeIn(path.resolve(r[1]), roots) !== null && posix(relativeIn(path.resolve(r[1]), roots)) === self);
  if (!saw) return 'the tracer did not see the suite read itself';
  const flag = trace.records.find(r => r[0] === 'flag');
  if (flag) return flag[1];
  const spawned = trace.records.find(r => r[0] === 'spawn' && r[2] !== true && !allowSpawn(r[1]));
  if (spawned) return `it starts ${String(spawned[1]).split(/[\\/]/).pop().split(' ')[0]}, which the cache does not follow`;
  return '';
}

/* The commands a browser run starts that are not node: the browser Playwright
   installed, under its own directory. Anything else is not followed. */
function browserSpawnAllowed(root, engine) {
  let dir = null;
  try {
    const exe = require(require.resolve('playwright', { paths: [root] }))[engine].executablePath();
    let d = path.dirname(exe);
    while (d !== path.dirname(d) && !/^(chromium|chromium_headless_shell|chromium-headless-shell|webkit|firefox|ffmpeg|winldd)[-_]\d+$/i.test(path.basename(d))) d = path.dirname(d);
    if (d !== path.dirname(d)) dir = path.dirname(d);
  } catch (_) { dir = null; }
  return cmd => !!dir && path.resolve(String(cmd).split(' ')[0]).startsWith(dir + path.sep);
}

/* ── the cache a run uses ──────────────────────────────────────────────────── */

/* How many earlier passes of one suite are kept. More than one so that an edit
   and its undo, which is how a defect is injected and then restored, finds the
   pass that was there before the edit instead of measuring again. */
const SLOTS = 4;

/* open({ root, engine, dir, fresh, plan, now, override, allowSpawn }) → cache
   A run asks decide() before each browser suite, prepare() to be handed a
   trace, and store() after it. */
function open(o) {
  const root = o.root, engine = o.engine;
  const dir = o.dir || cacheDir(root);
  const env = o.env || process.env;
  const fp = fingerprint({ root, engine, now: o.now ? o.now() : new Date(), env, override: o.override });
  const allowSpawn = o.allowSpawn || browserSpawnAllowed(root, engine);
  const keyOf = (name, args) => sha(JSON.stringify([VERSION, name, args, engine]));
  const fileOf = (name, args) => path.join(dir, keyOf(name, args) + '.json');
  const notRemembered = [];

  /* A file's state, hashed once per run: fifty-odd suites are handed the same
     5 MB build, each with several kept passes. Keyed by path, size and mtime,
     and never for a tree or a recursive listing, where a change deep inside
     does not move the directory's mtime. One run's cache only: a later run asks
     the disk again. */
  const memo = new Map();
  const seen = (abs, spec) => {
    if (spec.modes.includes('tree') || spec.modes.includes('listr')) return stateOf(abs, spec);
    let st; try { st = fs.statSync(abs); } catch (_) { return 'absent'; }
    const k = [abs, spec.modes.join(), spec.strip ? 1 : 0, st.mtimeMs, st.size, st.isDirectory() ? 'd' : 'f'].join('\0');
    if (!memo.has(k)) memo.set(k, stateOf(abs, spec));
    return memo.get(k);
  };

  /* The passes kept for a suite, newest first. A file that is not ours, or from
     another version, or cut off, holds none. */
  const slotsOf = file => {
    const e = readJSON(file);
    return e && e.v === VERSION && Array.isArray(e.slots) ? e.slots.filter(s => s && s.fp && s.inputs && s.result) : [];
  };

  /* check(slot) → { reuse: true } or { reuse: false, why }: whether everything
     the pass depended on is as it was, and if not, the first thing that is not. */
  const check = slot => {
    for (const k of new Set([...Object.keys(slot.fp), ...Object.keys(fp)])) {
      if (slot.fp[k] === fp[k]) continue;
      return { reuse: false, why: k === 'date' ? `the date changed (${slot.fp[k]} → ${fp[k]})` : k === 'runner' ? 'the code of the result cache or the runner changed' : `${k} ${slot.fp[k]} → ${fp[k]}` };
    }
    const nowEnv = envPart(Object.keys(slot.env || {}), env);
    for (const [n, h] of Object.entries(slot.env || {})) if (nowEnv[n] !== h) return { reuse: false, why: `${n} changed` };
    for (const [rel, spec] of Object.entries(slot.inputs)) {
      const now = seen(path.join(root, rel), { modes: spec.m, strip: spec.strip });
      if (now === spec.s) continue;
      return { reuse: false, why: spec.s === 'absent' ? `${rel} appeared` : now === 'absent' ? `${rel} is gone`
        : /^(d|dr):/.test(spec.s) ? `${rel}/ has a file added, removed or renamed` : `${rel} changed` };
    }
    return { reuse: true };
  };

  /* decide(name, args) → { reuse: true, entry } or { reuse: false, why }. Any
     kept pass whose inputs are all unchanged will do; if none does, the reason
     given is the newest one's, which is the change just made. */
  const decide = (name, args) => {
    if (o.fresh) return { reuse: false, why: 'asked for fresh' };
    const slots = slotsOf(fileOf(name, args));
    if (!slots.length) return { reuse: false, why: 'no earlier pass of it with these arguments' };
    let first = null;
    for (const s of slots) { const r = check(s); if (r.reuse) return { reuse: true, entry: s }; first = first || r; }
    return first;
  };

  const prepare = name => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-trace-'));
    return { name, tmp, file: path.join(tmp, 'trace.jsonl') };
  };
  const discard = prep => { try { fs.rmSync(prep.tmp, { recursive: true, force: true }); } catch (_) { /* a temp dir */ } };
  const traceFor = (base, prep) => traceEnv(base, prep.file, rootsOf(root));

  const write = (file, name, args, slots) => {
    if (!slots.length) { try { fs.rmSync(file, { force: true }); } catch (_) { /* nothing there */ } return; }
    fs.mkdirSync(dir, { recursive: true });
    replaceWhole(file, JSON.stringify({ v: VERSION, suite: name, args, engine, slots: slots.slice(0, SLOTS) }));
  };

  /* store(name, args, prep, result) → { stored, why }
     Only a pass is kept, and only one the tracer can vouch for. A run that is
     not kept removes any kept pass that still holds for the inputs it just ran
     on: a result that says something else about the same inputs must not be
     reused. Passes for other inputs are not touched. */
  const store = (name, args, prep, result) => {
    const file = fileOf(name, args);
    const forget = (why, report) => {
      try { write(file, name, args, slotsOf(file).filter(s => !check(s).reuse)); } catch (_) { /* a stale file stays, and decide() will check it */ }
      if (report) notRemembered.push({ name, why });
      return { stored: false, why };
    };
    if (!result || result.status !== 'pass') return forget('it did not pass', false);
    const trace = readTrace(prep.file);
    const why = whyNotRemembered(trace, name, root, allowSpawn);
    if (why) return forget(why, true);
    const { inputs, touched } = inputsOf(trace, root, args, result.startedAt);
    if (touched.length) return forget(`${touched[0]} changed while it ran`, true);
    const slot = { fp, env: envPart(envNamesOf(inputs, root), env), inputs,
      result: { seconds: result.seconds, at: (o.now ? o.now() : new Date()).toISOString(), commit: o.commit || '' } };
    const same = s => JSON.stringify([s.fp, s.env, s.inputs]) === JSON.stringify([slot.fp, slot.env, slot.inputs]);
    try { write(file, name, args, [slot, ...slotsOf(file).filter(s => !same(s))]); }
    catch (e) { return forget('the cache could not be written (' + e.code + ')', true); }
    return { stored: true, why: '' };
  };

  return { dir, fp, decide, prepare, discard, env: traceFor, store, notRemembered, plan: !!o.plan, fresh: !!o.fresh };
}

/* The engines whose page loads from disk this cache can see. Playwright reports
   a page's file:// requests in these two (tests/_engine.js launch() writes them
   down), and tests/verify-suitecache.js holds each engine to it on every run. In
   Firefox it reports none (measured: Firefox 155 under Playwright 1.63, not
   even to the page's own request event), so a suite that loads a page from the
   repository in Firefox depends on files nothing here would see, and for
   Firefox there is no cache. */
const TRACED_ENGINES = ['chromium', 'webkit'];

/* Why there is to be no cache, or '' : CI measures, SYSTOLE_NO_CACHE says so,
   and an engine that does not report what its pages load cannot be traced.
   --fresh measures and still records. */
const disabledBy = (env = process.env, engine = '') => (env.CI ? 'CI is set' : env.SYSTOLE_NO_CACHE ? 'SYSTOLE_NO_CACHE is set'
  : engine && !TRACED_ENGINES.includes(engine) ? `${engine} does not report the files a page loads from disk, so what its pages depend on cannot be seen` : '');

/* The cache the command line asks for. Where there is to be none it is still
   an object, one that remembers nothing and says why (`off`), so that every
   mode of the runner, --plan included, reports it instead of going quiet. */
function fromEnv({ root, engine, fresh, plan, env = process.env, commit = '' }) {
  const off = disabledBy(env, engine);
  if (off) return { off, plan: !!plan, fresh: false, decide: () => ({ reuse: false, why: off }), prepare: () => null, discard() {}, env: base => base, store: () => ({ stored: false, why: off }), notRemembered: [] };
  return open({ root, engine, fresh: fresh || !!env.SYSTOLE_FRESH, plan, commit, env });
}

module.exports = { VERSION, SLOTS, RUNNER_FILES, TRACED_ENGINES, open, fromEnv, disabledBy, cacheDir, fingerprint, runnerHash, envNamesOf, stateOf, stripStamp, inputsOf, readTrace, whyNotRemembered, browserSpawnAllowed };
