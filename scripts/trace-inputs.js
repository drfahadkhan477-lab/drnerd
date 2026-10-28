'use strict';
/*
 * What a process, and the node processes it starts, read from this repository.
 *
 * Loaded by `node --require` (scripts/suite-cache.js sets that up for a suite
 * it is going to remember) and inert unless SYSTOLE_TRACE_FILE names a file.
 * Then each file a process opens, stats or lists under SYSTOLE_TRACE_ROOT is
 * appended to that file as a line of JSON, and so is each child process:
 *
 *   ["read", "/abs/path"]            a file opened or read, or copied from
 *   ["list", "/abs/path", "r"?]      a directory listed ("r" for a recursive listing)
 *   ["tree", "/abs/path"]            a directory copied whole
 *   ["stat", "/abs/path"]            a path asked about: exists, stat, access, realpath
 *   ["browser", "/abs/path"]         a file:// URL a page asked for (tests/_engine.js)
 *   ["spawn", "<command>", true|false]   a child process, and whether it is node
 *   ["flag", "<why this cannot be remembered>"]
 *
 * It is the half of the result cache that SEES. Go's test cache does the same
 * thing for the same reason: a result may be reused only if nothing the test
 * looked at has changed, and "what it looked at" is not something to guess
 * from the source. A suite that builds its page from src/core, reads a
 * fixture, or spawns a node script that reads docs/ is found out by watching
 * it do so.
 *
 * WHAT IT CANNOT SEE, and the cache accounts for in its key instead: the
 * environment (names found in the source, values hashed), the clock, the
 * browser binary, and files a browser opens by itself. That last one is the
 * "browser" line above, which tests/_engine.js writes for every file:// URL
 * Playwright reports a page requesting.
 *
 * Paths outside SYSTOLE_TRACE_ROOT, under node_modules/ or .git/, are not
 * written: they are not this repository's source, and Playwright's driver
 * alone would otherwise write thousands of lines for what the lockfile and
 * the browser revision already pin.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { fileURLToPath } = require('url');

const FILE = process.env.SYSTOLE_TRACE_FILE;
/* The root is a list, because one directory has more than one spelling: node
   reports a module by its real path, and a temp directory on macOS is a
   symlink (/var is /private/var). A root compared by one spelling would see
   every file as outside the repository, and remember nothing. */
const ROOTS = process.env.SYSTOLE_TRACE_ROOT ? process.env.SYSTOLE_TRACE_ROOT.split(path.delimiter).filter(Boolean).map(r => path.resolve(r)) : [];
const MARK = Symbol.for('systole.trace-inputs');

/* A path as a string, or null for a descriptor, a stream or anything else
   that is not a path. */
function toPath(p) {
  try {
    if (p instanceof URL) return fileURLToPath(p);
    if (Buffer.isBuffer(p)) return p.toString();
    return typeof p === 'string' ? p : null;
  } catch (_) { return null; }
}

/* The spellings of a root: as given, and as the file system names it. */
function rootsOf(root) {
  const list = [path.resolve(root)];
  try { const real = fs.realpathSync(root); if (!list.includes(real)) list.push(real); } catch (_) { /* a root that is not there has one spelling */ }
  return list;
}

/* The path of a file relative to the repository, or null if it is not this
   repository's source: outside every spelling of the root, the root itself, or
   under node_modules or .git. */
function relativeIn(abs, roots = ROOTS) {
  if (!abs) return null;
  for (const root of [].concat(roots)) {
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    return /^(node_modules|\.git)([\\/]|$)/.test(rel) ? null : rel;
  }
  return null;
}
const inRepo = (abs, roots = ROOTS) => relativeIn(abs, roots) !== null;

/* The value NODE_OPTIONS needs so that a node process loads this file, quoted
   the way node reads NODE_OPTIONS: a path with a space goes in double quotes,
   and inside them a backslash or a quote is escaped. */
function requireOption(file) {
  return /[\s"\\]/.test(file) ? `--require="${file.replace(/[\\"]/g, '\\$&')}"` : `--require=${file}`;
}

/* The environment a child needs to be traced: the file and the root, and node
   told to load this module first. */
function traceEnv(env, file, root, modulePath = __filename) {
  const opt = requireOption(modulePath);
  const has = String(env.NODE_OPTIONS || '').includes(opt);
  return Object.assign({}, env, { SYSTOLE_TRACE_FILE: file, SYSTOLE_TRACE_ROOT: [].concat(root).join(path.delimiter),
    NODE_OPTIONS: has ? env.NODE_OPTIONS : (env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : '') + opt });
}

/* Whether a command is node: the executable running this, or a file called
   node. A shell line is node only if it is nothing but that command and its
   arguments, because a pipe, a list or a substitution can start something else. */
function isNode(cmd) {
  const c = String(cmd || '').trim();
  const exe = process.execPath;
  if (c === exe) return true;
  if (/\s/.test(c) && /[|&;<>()\`$]/.test(c.replace(/"[^"]*"|'[^']*'/g, ''))) return false;
  if (c.startsWith(exe + ' ') || c.startsWith('"' + exe + '"')) return true;
  const first = c.replace(/^["']/, '').split(/[\s"']/)[0];
  const base = path.basename(first).toLowerCase();
  return base === 'node' || base === 'node.exe';
}

function append(line) { try { fs.appendFileSync(FILE, JSON.stringify(line) + '\n'); } catch (_) { /* a trace that cannot be written is found out by the cache: it sees no lines */ } }

/* One line per (operation, path): a suite that stats a file ten thousand
   times writes it once. */
const seen = new Set();
function note(op, p, extra) {
  const abs = toPath(p);
  if (!abs) return;
  const resolved = path.resolve(abs);
  if (!inRepo(resolved)) return;
  const k = op + '\0' + resolved + '\0' + (extra || '');
  if (seen.has(k)) return;
  seen.add(k);
  append(extra ? [op, resolved, extra] : [op, resolved]);
}

/* A file:// request a page made, for tests/_engine.js to call. It writes the
   same file whether or not the hooks below are installed: the suite itself is
   usually not started with --require. */
function noteBrowserRequest(url) {
  if (!FILE || !ROOTS.length || typeof url !== 'string' || !url.startsWith('file:')) return;
  let p; try { p = fileURLToPath(url); } catch (_) { return; }
  note('browser', p);
}

/* What it watches, by what the call does to the path it is given first. One
   table: the proof suite (tests/verify-suitecache-pure.js) holds each name in it
   to a record, and holds every function node exposes on fs to either a name in
   it or a reason it is not an input. */
const WATCH = {
  read: { fs: ['readFileSync', 'readFile', 'createReadStream', 'copyFileSync', 'copyFile', 'openAsBlob'], promises: ['readFile', 'copyFile'] },
  tree: { fs: ['cpSync', 'cp'], promises: ['cp'] },
  list: { fs: ['readdirSync', 'readdir', 'opendirSync', 'opendir'], promises: ['readdir', 'opendir'] },
  stat: { fs: ['statSync', 'lstatSync', 'stat', 'lstat', 'existsSync', 'exists', 'accessSync', 'access', 'realpathSync', 'realpath', 'readlinkSync', 'readlink'],
          promises: ['stat', 'lstat', 'access', 'realpath', 'readlink'] },
  /* open reads unless it is opened to write */
  open: { fs: ['openSync', 'open'], promises: ['open'] },
  /* calls this tracer does not follow: a hole in what it sees is said, not left */
  flag: { fs: ['globSync', 'glob', 'watch', 'watchFile'], promises: ['glob', 'watch'] },
};
const WATCHED = {
  fs: [].concat(...Object.values(WATCH).map(w => w.fs)).sort(),
  promises: [].concat(...Object.values(WATCH).map(w => w.promises)).sort(),
};

/* A flag that opens a file to write it and not to read what is in it: "w", "a"
   and their variants, or a numeric flag with a write bit and no read-write bit.
   "r+" and O_RDWR read. */
function onlyWrites(flag) {
  if (typeof flag === 'string') return /^[wa]/.test(flag);
  if (typeof flag !== 'number') return false;
  const c = fs.constants;
  return (flag & ((c.O_WRONLY || 1) | (c.O_CREAT || 64) | (c.O_APPEND || 1024))) !== 0 && (flag & (c.O_RDWR || 2)) === 0;
}

/* The wrapper has to be the function it wraps in every way the code calling it
   can tell: its name and length, and the properties node hangs on it, such as
   fs.realpathSync.native and the util.promisify.custom of exec, execFile and
   fs.exists. An instrument that changes what the code under test does measures
   something else (this once dropped realpathSync.native, and made
   promisify(exec) resolve a string where it resolves {stdout, stderr}). */
function mimic(orig, wrapper) {
  for (const k of Reflect.ownKeys(orig)) {
    if (k === 'prototype' || k === 'arguments' || k === 'caller') continue;
    try { Object.defineProperty(wrapper, k, Object.getOwnPropertyDescriptor(orig, k)); } catch (_) { /* a property the wrapper cannot take is left alone */ }
  }
  return wrapper;
}

function install() {
  if (!FILE || globalThis[MARK]) return;
  globalThis[MARK] = true;
  const recursive = a => (a[1] && typeof a[1] === 'object' && a[1].recursive ? 'r' : undefined);
  const put = (obj, name, make) => { const orig = obj[name]; if (typeof orig === 'function') obj[name] = mimic(orig, make(orig)); };

  for (const [op, w] of Object.entries(WATCH)) {
    for (const [obj, names] of [[fs, w.fs], [fs.promises, w.promises]]) {
      if (!obj) continue;
      for (const n of names) {
        if (op === 'flag') put(obj, n, orig => function (...a) { append(['flag', 'fs.' + n + ' is not followed by the tracer']); return orig.apply(this, a); });
        else if (op === 'open') put(obj, n, orig => function (...a) { if (!onlyWrites(a[1])) note('read', a[0]); return orig.apply(this, a); });
        else put(obj, n, orig => function (...a) { note(op, a[0], op === 'list' ? recursive(a) : undefined); return orig.apply(this, a); });
      }
    }
  }

  /* Child processes: node ones are traced too (the environment goes with
     them, including into a call that supplies its own env), and anything else
     is written down for the cache to judge. */
  const parentEnv = () => process.env;
  for (const n of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    put(cp, n, orig => function (...a) {
      const node = n === 'fork' || isNode(a[0]);
      append(['spawn', n === 'fork' ? 'node' : String(a[0]), node]);
      if (node) {
        const at = a.findIndex((x, i) => i > 0 && x && typeof x === 'object' && !Array.isArray(x) && !Buffer.isBuffer(x));
        const env = traceEnv(at > 0 && a[at].env ? a[at].env : parentEnv(), FILE, ROOTS);
        if (at > 0) a[at] = Object.assign({}, a[at], { env });
        else if (typeof a[a.length - 1] === 'function') a.splice(a.length - 1, 0, { env });
        else a.push({ env });
      }
      return orig.apply(this, a);
    });
  }
}

install();

module.exports = { inRepo, relativeIn, rootsOf, requireOption, traceEnv, isNode, noteBrowserRequest, toPath, onlyWrites, WATCH, WATCHED };
