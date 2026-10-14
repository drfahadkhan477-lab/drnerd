#!/usr/bin/env node
/*
 * Build the app: `npm run build -- path/to/export.html` runs this.
 *
 *   node scripts/assemble-app.js [source] [--out build/systole.assembled.html]
 *                                [--compare other-build.html]
 *                                [--refs content/refs] [--ref-images content/refs-images]
 *
 * The source is the export (an HTML file with a `const ALL_Q=` and a
 * `const IMGS=` line), or a bank in the content schema
 * (docs/CONTENT-SCHEMA.md): a folder holding manifest.json, questions.json
 * and figures/, or the package tools/pack-content.js writes. A bank is
 * checked first by src/core/bankpack.js, the function the iPad runs on an
 * import, so a bank the device would refuse is refused here.
 *
 * app/systole.html is the app with every payload replaced by a slot token
 * (scripts/app-slots.js). This fills each slot:
 *
 *   ALL_Q        the bank, with the answer-key corrections
 *                (scripts/answer-keys.js) then the content flags
 *                (scripts/content-flags.js) applied: JSON.stringify of the bank
 *   IMGS         the figures: the export's line verbatim, or a bank's figure
 *                files as data URLs
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
const { applyKeyCorrections, ensureKeyCorrections, ALL_Q_RE } = require('./answer-keys.js');
const { applyContentFlags } = require('./content-flags.js');
const { buildRefSeed, REFS_DIR } = require('./ref-seed.js');
const { buildRefImages, IMAGES_DIR } = require('./ref-images.js');
const { bake } = require('./heart-bake.js');
const { bakePearls } = require('./pearl-bake.js');
const { gitCommit, stampBuffer, STAMP_RE } = require('./stamp.js');
const { replaceWhole } = require('./atomic.js');

const ROOT = path.join(__dirname, '..');
const IMGS_RE = /\nconst IMGS=(\{[\s\S]*?\});\n/;

/* ── a bank as the source ────────────────────────────────────────────────────
   The page's own modules, loaded by path as extract-content.js and
   pack-content.js load them: they attach to `this` outside a browser. */
function pageModule(file, name) {
  const sandbox = {};
  new Function(fs.readFileSync(path.join(ROOT, 'src', 'core', file), 'utf8')).call(sandbox);
  return sandbox[name];
}

/* The files of a bank folder, in the shape ZipRead returns a package's. Only
   what the bank names is read: its two JSON files, each figure its questions
   name, each extra its manifest lists. A name that could climb out of its
   folder is never opened; bankpack.js reports it. */
const SAFE_FIG = /^[A-Za-z0-9_.-]{1,160}\.(webp|png|jpg)$/;
const SAFE_EXTRA = /^(refs-seed\.json|refs-images\/[A-Za-z0-9_-]+(\.[0-9]+)?\.json)$/;
function bankFolderFiles(dir) {
  const read = rel => { try { return new Uint8Array(fs.readFileSync(path.join(dir, rel))); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const json = bytes => { try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (_) { return null; } };
  const files = [];
  const add = (name, rel) => { const bytes = read(rel); if (bytes) files.push({ name, bytes }); return bytes; };
  const manifest = add('manifest.json', 'manifest.json');
  const questions = add('questions.json', 'questions.json');
  const named = new Set();
  const qs = questions && json(questions);
  if (Array.isArray(qs)) for (const q of qs) for (const f of (q && Array.isArray(q.figs) ? q.figs : []))
    if (typeof f === 'string' && SAFE_FIG.test(f) && !f.includes('..')) named.add(f);
  for (const f of named) add('figures/' + f, path.join('figures', f));
  const m = manifest && json(manifest);
  for (const x of (m && Array.isArray(m.extras) ? m.extras : []))
    if (typeof x === 'string' && SAFE_EXTRA.test(x)) add('extra/' + x, path.join('extra', ...x.split('/')));
  return files;
}

/* readBank(p) → { manifest, questions, figures: Map(name → { bytes, type }) }
   p is a bank folder or a package zip. Refused, naming ids, files and counts
   and never a word of a question, when bankpack.js would refuse it, or when a
   question's img disagrees with the figures it names: extract-content.js
   refuses that in the single file, so the build would stop there instead. */
async function readBank(p) {
  let files;
  if (fs.statSync(p).isDirectory()) files = bankFolderFiles(p);
  else {
    const buf = fs.readFileSync(p);
    files = (await pageModule('zipread.js', 'ZipRead').read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).files;
  }
  const v = pageModule('bankpack.js', 'BankPack').validate(files);
  const problems = v.ok ? [] : v.problems.slice();
  if (v.ok) for (const q of v.questions)
    if (q.img != null && q.img !== (q.figs || []).length) problems.push(`${q.id}: img says ${q.img} figure(s), figs names ${(q.figs || []).length}`);
  if (problems.length) {
    const n = v.ok ? problems.length : v.problemCount;
    throw new Error(`${path.basename(p)} is not a bank this build can use (${n} problem(s)):\n  ` + problems.slice(0, 10).join('\n  '));
  }
  return { manifest: v.manifest, questions: v.questions, figures: new Map(v.figures.map(f => [f.name, { bytes: Buffer.from(f.bytes), type: f.type }])) };
}

/* The bank as the single file carries it, which is the export's shape. Each
   change fills in what the schema leaves optional and the app reads, and
   leaves a field the bank already gives exactly as it is:
     figs  names files the single file does not have: its figures travel in
           IMGS, so the field goes, as the export's bank never had it;
     img   the count the app reads before it shows a figure at all, so a
           question that names figures without saying how many gets the
           number it names;
     o     the app reads an option's letter and text as {l, t}; the schema
           also allows a plain string, which becomes {l, t}, and an option
           with no letter gets the one its place gives it;
     n     the item number the app shows beside the chapter, counted within
           the chapter in the bank's order. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function singleFileBank(questions) {
  const inChapter = new Map();
  return questions.map(q => {
    const { figs, ...rest } = JSON.parse(JSON.stringify(q));
    if (rest.img == null && Array.isArray(figs) && figs.length) rest.img = figs.length;
    if (Array.isArray(rest.o)) rest.o = rest.o.map((o, i) =>
      typeof o === 'string' ? { l: LETTERS[i], t: o } : o && typeof o === 'object' && o.l == null ? { l: LETTERS[i], ...o } : o);
    const n = (inChapter.get(rest.ch) || 0) + 1;
    inChapter.set(rest.ch, n);
    if (rest.n == null) rest.n = n;
    return rest;
  });
}

/* producers({ exportHtml | bank, refsDir, imagesDir, root }) → resolve(kind, name)
   Each value is computed once, on first use. bank is readBank()'s. */
function producers({ exportHtml, bank, refsDir = REFS_DIR, imagesDir = IMAGES_DIR, root = ROOT }) {
  const repo = Slots.repoResolver(null, root);
  const made = new Map();
  const once = (key, fn) => { if (!made.has(key)) made.set(key, fn()); return made.get(key); };
  const PAYLOAD = {
    ALL_Q: () => {
      /* A bank may have been through a build already (extract-content.js
         writes one from a built app), so its keys are corrected only if they
         are not; the export never has, and its corrections are asserted. */
      if (bank) {
        const qs = singleFileBank(bank.questions);
        ensureKeyCorrections(qs);
        applyContentFlags(qs);
        return JSON.stringify(qs);
      }
      const m = ALL_Q_RE.exec(exportHtml);
      if (!m) throw new Error('the export has no "const ALL_Q=" line');
      const qs = JSON.parse(m[1]);
      applyKeyCorrections(qs);
      applyContentFlags(qs);
      return JSON.stringify(qs);
    },
    IMGS: () => {
      if (bank) {
        const imgs = {};
        for (const q of bank.questions) if (Array.isArray(q.figs) && q.figs.length)
          imgs[q.id] = q.figs.map(f => { const fig = bank.figures.get(f); return `data:${fig.type};base64,${fig.bytes.toString('base64')}`; });
        return JSON.stringify(imgs);
      }
      const m = IMGS_RE.exec(exportHtml);
      if (!m) throw new Error('the export has no "const IMGS=" line');
      return m[1];
    },
    REF_SEED: () => buildRefSeed(refsDir).seed,
    /* The seeded notes' pearls, found here rather than at launch (scripts/pearl-bake.js). */
    REF_PEARLS: () => bakePearls(once('REF_SEED', PAYLOAD.REF_SEED)),
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
    : 'no export. It is the licensed question bank and is deliberately not in this repository: pass its path, set SYSTOLE_SRC, or put it in source/. A bank folder or package in the content schema (docs/CONTENT-SCHEMA.md) builds too: pass its path.');
}

/* A folder or a .zip is a bank; anything else is read as the export. */
const isBankSource = p => /\.zip$/i.test(p) || (fs.existsSync(p) && fs.statSync(p).isDirectory());

if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const positional = args.find((a, i) => !a.startsWith('--') && !['--out', '--compare', '--shell', '--refs', '--ref-images'].includes(args[i - 1]));
  try {
    const source = findSource(positional);
    const shellFile = opt('--shell') || path.join(ROOT, 'app', 'systole.html');
    const out = opt('--out') || path.join(ROOT, 'build', 'systole.assembled.html');
    const bank = isBankSource(source) ? await readBank(source) : null;
    const r = assembleApp({ shell: fs.readFileSync(shellFile, 'utf8'), resolve: producers({
      exportHtml: bank ? null : fs.readFileSync(source, 'utf8'), bank,
      refsDir: opt('--refs') ? path.resolve(opt('--refs')) : undefined,
      imagesDir: opt('--ref-images') ? path.resolve(opt('--ref-images')) : undefined,
    }) });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    /* Whole or not at all: a write that fails part-way (a full disk) must not
       leave a broken app where the previous working one was. */
    replaceWhole(out, r.out);
    console.log(`assembled → ${path.relative(ROOT, out)}  (${(r.out.length / 1e6).toFixed(2)} MB, build ${r.digest})` +
      (bank ? `\n  from the bank in ${path.relative(ROOT, source) || '.'}: ${bank.questions.length} questions, ${bank.figures.size} figures` : ''));
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
})();

module.exports = { producers, assembleApp, compareToChain, unstampShell, readBank, singleFileBank, isBankSource };
