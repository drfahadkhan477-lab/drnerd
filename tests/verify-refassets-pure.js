#!/usr/bin/env node
/*
 * Figures that arrived with an imported chapter, and the one way to lose them.
 *
 *   node tests/verify-refassets-pure.js
 *
 * Pure Node, no browser, no build. refassets.js reaches for IndexedDB and
 * already handles not having it — `indexedDB.open` throws a ReferenceError
 * here, the try/catch resolves null, and the module falls back to its memory
 * mirror. That fallback is a supported mode (private browsing, file://), so
 * testing through it is testing a real path rather than a stub.
 *
 * WHAT IS AT STAKE. These are not the shipped corpus. content/refs-images is
 * baked into REF_IMGS at build time and can always be rebuilt from source;
 * this store holds figures from chapters the fellow imported themselves, which
 * cannot. Losing one is losing something they cannot get back by rebuilding.
 *
 * Which makes sweep() the function worth testing hardest. It exists because
 * import is content-addressed and deletion is not, so a deleted chapter would
 * otherwise leave its figures behind for ever — but it decides what to delete
 * from the note bodies it is handed, and its only caller is
 *
 *     RefAssets.sweep(REF.map(r => r.body))
 *
 * An empty REF — mid-restore, or the note store failing while the asset store
 * did not — used to mean every imported figure was reclaimed. Indistinguishable
 * from "the fellow deleted every note", and irreversible in one direction.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'refassets.js'), 'utf8');
function fresh() {
  const root = {};
  new Function(SRC).call(root);
  return root.RefAssets;
}
const bytesOf = s => new Uint8Array(Buffer.from(s, 'utf8'));

head('it knows an image when it sees one');
{
  const R = fresh();
  ok('jpg, jpeg, png, webp, gif and avif are images',
     ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.gif', 'a.avif'].every(n => R.isImageName(n)));
  ok('a note is not', !R.isImageName('chapter.md') && !R.isImageName('notes.txt'));
  ok('a bare name with no extension is not', !R.isImageName('README'));
  ok('the extension is matched case-insensitively', R.mimeFor('SCAN.JPG') === 'image/jpeg');
  ok('and an unknown extension has no mime', R.mimeFor('x.tiff') === '');
}

head('the same bytes are the same figure');
{
  const R = fresh();
  const a = R.add(bytesOf('pretend this is a PNG'), 'fig1.png');
  const b = R.add(bytesOf('pretend this is a PNG'), 'fig1.png');
  ok('adding an image returns a refimg key', typeof a === 'string' && a.startsWith('u/'), String(a));
  ok('identical bytes give the same key — importing twice stores one copy', a === b, `${a} / ${b}`);
  ok('and the store holds one entry, not two', R.count() === 1, String(R.count()));
  const c = R.add(bytesOf('a different picture entirely'), 'fig2.png');
  ok('different bytes give a different key', c !== a, `${c}`);
  ok('the key carries the extension so the mime survives a reload', /\.png$/.test(a));
  ok('what comes back is a usable data URL', /^data:image\/png;base64,/.test(R.get(a)));
  ok('and a key nobody stored gives an empty string, not undefined', R.get('u/nope.png') === '');
  ok('has() agrees with get()', R.has(a) === true && R.has('u/nope.png') === false);
  ok('a non-image is refused outright', R.add(bytesOf('# a chapter'), 'chapter.md') === null);
}

head('sweep reclaims what no surviving note cites');
{
  const R = fresh();
  const keep = R.add(bytesOf('kept figure'), 'keep.png');
  const lose = R.add(bytesOf('orphaned figure'), 'lose.png');
  ok('two figures are stored', R.count() === 2);
  const n = R.sweep([`Some prose.\n\n![a caption](refimg://${keep})\n\nMore prose.`]);
  ok('the uncited one is reclaimed', n === 1, String(n));
  ok('the cited one survives', R.has(keep) === true);
  ok('and the orphan is gone', R.has(lose) === false);
}

head('and refuses to reclaim against nothing — the irreversible direction');
{
  /* THE BUG THIS CLOSES. The only caller passes REF.map(r => r.body). An empty
     REF means either "every note was deleted" or "the notes have not loaded
     yet", and from in here those are the same value. Treating the second as
     the first deletes every figure the fellow ever imported — their own
     chapters, which unlike the shipped corpus cannot be rebuilt from source.
     Doing nothing costs a delayed reclaim the next sweep performs anyway. */
  const R = fresh();
  const a = R.add(bytesOf('an imported figure'), 'a.png');
  const b = R.add(bytesOf('another imported figure'), 'b.png');
  ok('two imported figures are in the store', R.count() === 2);

  ok('sweeping against an empty note list reclaims nothing', R.sweep([]) === 0);
  ok('and the figures are still there', R.has(a) && R.has(b), String(R.count()));
  ok('sweeping against undefined reclaims nothing', R.sweep(undefined) === 0);
  ok('sweeping against a non-array reclaims nothing', R.sweep('not a list') === 0);
  ok('the store is untouched by all three', R.count() === 2, String(R.count()));

  /* But a real list with real notes still works — the guard must not have
     turned sweep into a no-op. */
  const n = R.sweep([`![x](refimg://${a})`]);
  ok('while a genuine list still reclaims the orphan', n === 1 && R.has(a) && !R.has(b), String(n));
}

head('the citation pattern matches what md() actually writes');
{
  const R = fresh();
  const k = R.add(bytesOf('figure bytes'), 'f.png');
  R.add(bytesOf('other bytes'), 'g.png');
  /* An empty caption, and a caption containing brackets — both legal Markdown
     and both produced by importers in the wild. */
  ok('an empty caption still counts as a citation',
     R.sweep([`![](refimg://${k})`]) === 1 && R.has(k));
  const R2 = fresh();
  const k2 = R2.add(bytesOf('figure bytes'), 'f.png');
  R2.add(bytesOf('other bytes'), 'g.png');
  ok('a caption with punctuation still counts',
     R2.sweep([`![Fig. 1 — LV, apical](refimg://${k2})`]) === 1 && R2.has(k2));
}

head('what it reports about itself');
{
  const R = fresh();
  R.add(bytesOf('x'.repeat(300)), 'a.png');
  ok('keys are listed', R.keys().length === 1 && R.keys()[0].startsWith('u/'));
  ok('count agrees with keys', R.count() === R.keys().length);
  ok('bytes is a plausible decoded size, not the base64 length',
     R.bytes() > 200 && R.bytes() < 500, String(R.bytes()));
  ok('an empty store reports zero', fresh().count() === 0 && fresh().bytes() === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
