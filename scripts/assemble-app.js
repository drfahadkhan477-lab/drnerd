#!/usr/bin/env node
/*
 * Build the app from app/systole.html, without the patch chain: step 2 of
 * retiring it (docs/BUILD.md, "Retiring the patch chain").
 *
 *   node scripts/assemble-app.js [source.html] [--out build/systole.assembled.html]
 *                                [--compare build/systole.html]
 *
 * app/systole.html is the chain's output with every payload replaced by a slot
 * token (scripts/app-slots.js, frozen by scripts/freeze-shell.js). This fills
 * each slot from where the chain itself gets it, not from a copy of the
 * chain's output:
 *
 *   ALL_Q        the export's bank, with keys-patch's answer-key corrections
 *                then flags-patch's content flags applied, written as those
 *                two steps write it (JSON.stringify of the whole bank)
 *   IMGS         the export's figures, verbatim: no step edits them
 *   REF_SEED     refs-patch's seed, built from content/refs
 *   REF_IMGS     ref-images-patch's figures, built from content/refs-images
 *   HEART_MESH   scripts/heart-bake.js over src/core/heart3d.js, as apex-patch does
 *   src, asset   the repository's files as they are now
 *
 * The functions are the chain's own, exported from those scripts, so there is
 * one copy of each rule. Then it stamps the result as build.js does
 * (scripts/stamp.js), after removing the stamp the frozen shell was cut with.
 *
 * --compare is the proof this path is the chain's: it strips both stamps and
 * compares bytes, and when they differ says WHICH part differs (each payload,
 * and the shell around them), never what the text is. Run it on the owner's
 * machine after `node scripts/build.js`, where both inputs exist.
 *
 * The export is read as UTF-8, as stage0-patch reads it, so any byte the
 * chain would replace is replaced the same way here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Slots = require('./app-slots.js');
const { applyKeyCorrections, ALL_Q_RE } = require('./keys-patch.js');
const { applyContentFlags } = require('./flags-patch.js');
const { buildRefSeed, REFS_DIR } = require('./refs-patch.js');
const { buildRefImages, IMAGES_DIR } = require('./ref-images-patch.js');
const { bake } = require('./heart-bake.js');
const { gitCommit, stampBuffer, STAMP_RE } = require('./stamp.js');

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
  if (process.env.SYSTOLE_SOURCE) return process.env.SYSTOLE_SOURCE;
  const dir = path.join(ROOT, 'source');
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.html')) : [];
  if (found.length === 1) return path.join(dir, found[0]);
  throw new Error(found.length ? `source/ holds ${found.length} exports; name one` : 'no export: pass its path, set SYSTOLE_SOURCE, or put it in source/');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const positional = args.find((a, i) => !a.startsWith('--') && !['--out', '--compare', '--shell'].includes(args[i - 1]));
  try {
    const source = findSource(positional);
    const shellFile = opt('--shell') || path.join(ROOT, 'app', 'systole.html');
    const out = opt('--out') || path.join(ROOT, 'build', 'systole.assembled.html');
    const r = assembleApp({ shell: fs.readFileSync(shellFile, 'utf8'), resolve: producers({ exportHtml: fs.readFileSync(source, 'utf8') }) });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, r.out);
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
