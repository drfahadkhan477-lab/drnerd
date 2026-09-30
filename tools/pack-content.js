#!/usr/bin/env node
'use strict';
/*
 * Pack content/ into the file the iPad imports, for the code-only deploy.
 *
 *   node tools/pack-content.js [content] [--out source/systole-content-v1.zip]
 *
 * scripts/build-pwa.js --no-content ships the app with no bank in it, so the
 * host serves code and nothing licensed. The bank reaches the iPad as this
 * zip instead: AirDrop it, or put it in Files, and pick it on the import
 * screen that build shows on first launch (src/core/bankstore.js keeps it in
 * the browser's own storage from then on).
 *
 * WHAT GOES IN: questions.json, figures/*, and manifest.json with
 * schemaVersion 1 added — the same three things build-pwa copies into dist/
 * today. The package is checked with the very function the page runs
 * (src/core/bankpack.js) before it is written, so a package that the iPad
 * would refuse is refused here, where there is a keyboard to fix it.
 *
 * WRITTEN UNDER source/ BY DEFAULT, which is gitignored and refused by
 * scripts/leak-guard.js: this zip is the licensed bank, and it stays on your
 * own devices. Prints counts only.
 */
const fs = require('fs');
const path = require('path');
const { zipOf } = require('../scripts/build-memorizer.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = path.resolve(oi > -1 && args[oi + 1] ? args[oi + 1] : path.join(ROOT, 'source', 'systole-content-v1.zip'));
const DIR = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') || path.join(ROOT, 'content'));

/* The page's own check, run here. bankpack.js attaches to `this` outside a
   browser; loading it by path keeps one definition. */
function bankPack() {
  const sandbox = {};
  new Function(fs.readFileSync(path.join(ROOT, 'src', 'core', 'bankpack.js'), 'utf8')).call(sandbox);
  return sandbox.BankPack;
}

/* extras: { 'refs-seed.json': Buffer, 'refs-images/hf.json': Buffer, … } —
   the reference notes' files, which build-pwa.js --no-content passes so the
   notes stay off the host too. Listed in the manifest; stored under extra/. */
function pack(dir, out, extras) {
  const read = f => { try { return fs.readFileSync(path.join(dir, f)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const q = read('questions.json'), m = read('manifest.json');
  if (!q || !m) throw new Error(`${dir} has no ${!q ? 'questions.json' : 'manifest.json'} — run scripts/extract-content.js first`);
  const manifest = JSON.parse(m.toString('utf8'));
  manifest.schemaVersion = bankPack().SCHEMA;
  delete manifest.source;      // the export's file name is a local path detail, not something to carry around
  const extraNames = Object.keys(extras || {}).sort();
  if (extraNames.length) manifest.extras = extraNames; else delete manifest.extras;
  const figs = fs.readdirSync(path.join(dir, 'figures')).filter(f => /\.(webp|png|jpg)$/.test(f)).sort();

  /* Staged in a folder zipOf can read from, so the zip is built by the same
     writer the Memorizer upload uses. */
  const stage = out + '.stage-' + process.pid;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'figures'), { recursive: true });
  try {
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(stage, 'questions.json'), q);
    for (const f of figs) fs.copyFileSync(path.join(dir, 'figures', f), path.join(stage, 'figures', f));
    for (const n of extraNames) {
      fs.mkdirSync(path.dirname(path.join(stage, 'extra', n)), { recursive: true });
      fs.writeFileSync(path.join(stage, 'extra', n), extras[n]);
    }
    const names = ['manifest.json', 'questions.json'].concat(figs.map(f => 'figures/' + f), extraNames.map(n => 'extra/' + n));
    const verdict = bankPack().validate(names.map(n => ({ name: n, bytes: new Uint8Array(fs.readFileSync(path.join(stage, n))) })));
    if (!verdict.ok) throw new Error(`the package would be refused on the iPad (${verdict.problemCount} problem(s)):\n  ` + verdict.problems.slice(0, 10).join('\n  '));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = out + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, zipOf(stage, names));
    fs.renameSync(tmp, out);
    return { questions: verdict.questions.length, figures: verdict.figures.length, extras: verdict.extras.length, bytes: fs.statSync(out).size };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

module.exports = { pack };

if (require.main === module) {
  try {
    const r = pack(DIR, OUT);
    console.log(`packed ${r.questions} questions and ${r.figures} figures → ${path.relative(process.cwd(), OUT)} (${(r.bytes / 1048576).toFixed(1)} MB)`);
    if (/^source([\\/]|$)/.test(path.relative(ROOT, OUT))) console.log('(source/ is gitignored — this is your licensed bank; keep it on your own devices)');
    console.log('On the iPad: open the app built with --no-content, and pick this file on its import screen.');
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
