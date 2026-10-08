#!/usr/bin/env node
/*
 * Build the app: `npm run build -- path/to/export.html` runs this.
 *
 *   node scripts/assemble-app.js [source.html] [--out build/systole.assembled.html]
 *                                [--compare other-build.html]
 *                                [--refs content/refs] [--ref-images content/refs-images]
 *
 * app/systole.html is the app with every payload replaced by a slot token
 * (scripts/app-slots.js). This fills each slot:
 *
 *   ALL_Q        the export's bank, with the answer-key corrections
 *                (scripts/answer-keys.js) then the content flags
 *                (scripts/content-flags.js) applied: JSON.stringify of the bank
 *   IMGS         the export's figures, verbatim
 *   REF_SEED     the reference notes, built from content/refs (scripts/ref-seed.js)
 *   REF_IMGS     their figures, from content/refs-images (scripts/ref-images.js)
 *   HEART_MESH   scripts/heart-bake.js over src/core/heart3d.js
 *   src, asset   the repository's files as they are now
 *
 * Then it stamps the result (scripts/stamp.js), after removing the stamp the
 * frozen shell was cut with.
 *
 * --compare strips both stamps and compares bytes with another build, and when
 * they differ says WHICH part differs (each payload, and the shell around
 * them), never what the text is. It was the proof that this path built what
 * the retired patch chain built; it still answers "what changed between these
 * two builds" without printing licensed text.
 *
 * The export is read as UTF-8, so a byte that is not valid UTF-8 becomes
 * U+FFFD here exactly as it did in the patch chain.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Slots = require('./app-slots.js');
const { applyKeyCorrections, ALL_Q_RE } = require('./answer-keys.js');
const { applyContentFlags } = require('./content-flags.js');
const { buildRefSeed, REFS_DIR } = require('./ref-seed.js');
const { buildRefImages, IMAGES_DIR } = require('./ref-images.js');
const { bake } = require('./heart-bake.js');
const { gitCommit, stampBuffer, STAMP_RE } = require('./stamp.js');
const { replaceWhole } = require('./atomic.js');

const ROOT = path.join(__dirname, '..');
const IMGS_RE = /\nconst IMGS=(\{[\s\S]*?\});\n/;

/* producers({ exportHtml, refsDir, imagesDir, root }) → resolve(kind, name)
   Each value is computed once, on first use. */
function producers({ exportHtml, refsDir = REFS_DIR, imagesDir = IMAGES_DIR, root = ROOT }) {
  const repo = Slots.repoResolver(null, root);
  const made = new Map();
  const once = (key, fn) => { if (!made.has(key)) made.set(key, fn()); return made.get(key); };
  const PAYLOAD = {
    ALL_Q: () => {
      const m = ALL_Q_RE.exec(exportHtml);
      if (!m) throw new Error('the export has no "const ALL_Q=" line');
      const bank = JSON.parse(m[1]);
      applyKeyCorrections(bank);
      applyContentFlags(bank);
      return JSON.stringify(bank);
    },
    IMGS: () => {
      const m = IMGS_RE.exec(exportHtml);
      if (!m) throw new Error('the export has no "const IMGS=" line');
      return m[1];
    },
    REF_SEED: () => buildRefSeed(refsDir).seed,
    REF_IMGS: () => buildRefImages(refsDir, imagesDir).json,
    HEART_MESH: () => bake(fs.readFileSync(path.join(root, 'src', 'core', 'heart3d.js'), 'utf8')).b64,
  };
  return (kind, name) => {
    if (kind !== 'payload') return repo(kind, name);
    if (!PAYLOAD[name]) return undefined;
    return once(name, PAYLOAD[name]);
  };
}

/* The shell without the stamp it was frozen with. One stamp at most. */
function unstampShell(shell) {
  const n = (shell.match(STAMP_RE) || []).length;
  if (n > 1) throw new Error(`the shell carries ${n} build stamps; a frozen build has one`);
  return shell.replace(STAMP_RE, '');
}

/* assembleApp({ shell, resolve, commit }) → { unstamped, out, digest } (Buffers) */
function assembleApp({ shell, resolve, commit = gitCommit() }) {
  const html = Slots.assemble(unstampShell(shell), resolve);
  const unstamped = Buffer.from(html, 'utf8');
  const { out, digest } = stampBuffer(unstamped, commit);
  return { unstamped, out, digest };
}

/* compareToChain(chainBuf, assembledUnstamped, sources) → { same, parts }
   parts: [{ part, same }] for the shell and each payload. Names only. */
function compareToChain(chainBuf, assembledUnstamped, sources = Slots.repoSources(ROOT)) {
  const chain = Buffer.from(chainBuf.toString('utf8').replace(STAMP_RE, ''), 'utf8');
  if (chain.equals(assembledUnstamped)) return { same: true, parts: [] };
  const a = Slots.cut(chain.toString('utf8'), sources), b = Slots.cut(assembledUnstamped.toString('utf8'), sources);
  const parts = [{ part: 'shell', same: a.shell === b.shell }];
  for (const name of new Set([...Object.keys(a.payloads), ...Object.keys(b.payloads)]))
    parts.push({ part: name, same: a.payloads[name] === b.payloads[name] });
  return { same: false, parts };
}

function findSource(arg) {
  if (arg) return arg;
  /* SYSTOLE_SRC, the variable the patch chain read: the first owner run of
     this script was refused for a machine set up under that name. */
  if (process.env.SYSTOLE_SRC) return path.resolve(process.env.SYSTOLE_SRC);
  const dir = path.join(ROOT, 'source');
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.html')) : [];
  if (found.length === 1) return path.join(dir, found[0]);
  /* "deliberately not in this repository" is what CI's build-guard job looks
     for: the refusal must say why there is no export, not only where to put one. */
  throw new Error(found.length ? `source/ holds ${found.length} exports; name one`
    : 'no export. It is the licensed question bank and is deliberately not in this repository: pass its path, set SYSTOLE_SRC, or put it in source/');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const positional = args.find((a, i) => !a.startsWith('--') && !['--out', '--compare', '--shell', '--refs', '--ref-images'].includes(args[i - 1]));
  try {
    const source = findSource(positional);
    const shellFile = opt('--shell') || path.join(ROOT, 'app', 'systole.html');
    const out = opt('--out') || path.join(ROOT, 'build', 'systole.assembled.html');
    const r = assembleApp({ shell: fs.readFileSync(shellFile, 'utf8'), resolve: producers({
      exportHtml: fs.readFileSync(source, 'utf8'),
      refsDir: opt('--refs') ? path.resolve(opt('--refs')) : undefined,
      imagesDir: opt('--ref-images') ? path.resolve(opt('--ref-images')) : undefined,
    }) });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    /* Whole or not at all: a write that fails part-way (a full disk) must not
       leave a broken app where the previous working one was. */
    replaceWhole(out, r.out);
    console.log(`assembled → ${path.relative(ROOT, out)}  (${(r.out.length / 1e6).toFixed(2)} MB, build ${r.digest})`);
    const cmp = opt('--compare');
    if (cmp) {
      const c = compareToChain(fs.readFileSync(cmp), r.unstamped);
      if (c.same) { console.log(`compare: byte-identical to ${path.relative(ROOT, cmp)} (stamps aside)`); process.exit(0); }
      console.log(`compare: DIFFERENT from ${path.relative(ROOT, cmp)}`);
      c.parts.forEach(p => console.log(`  ${p.same ? 'same     ' : 'DIFFERS  '}${p.part}`));
      process.exit(1);
    }
  } catch (e) {
    console.error('assemble-app: ' + e.message);
    process.exit(2);
  }
}

module.exports = { producers, assembleApp, compareToChain, unstampShell };
