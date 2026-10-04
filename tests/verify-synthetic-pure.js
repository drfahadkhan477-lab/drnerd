#!/usr/bin/env node
/*
 * The synthetic export builds the real app, and is marked as synthetic.
 *
 *   node tests/verify-synthetic-pure.js
 *
 * Pure Node. scripts/synthetic-export.js is what lets CI build the app at all:
 * an export in the real one's shape with invented questions, figures and
 * reference notes, which scripts/assemble-app.js fills app/systole.html from.
 * The browser suites CI runs on that build are only as good as the fixture, so
 * this holds the fixture to what those suites rely on:
 *
 *   - the same arguments give the same bytes;
 *   - the bank is in the fields the app reads, under the app's own chapters,
 *     with ids numbered as the bank's are, and every text invented;
 *   - every figure is a PNG that decodes, of a realistic size and number;
 *   - the reference library seeds through refs-patch and yields pearls;
 *   - it assembles into the app, with keys-patch's corrections applied;
 *   - the build carries the mark, and scripts/verify.js reads the mark and
 *     will not write tests/test-stats.json for it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { blankComments } = require('./_source.js');

const ROOT = path.join(__dirname, '..');
const Syn = require('../scripts/synthetic-export.js');
const { CORRECTIONS, ALL_Q_RE } = require('../scripts/keys-patch.js');
const { FLAGS } = require('../scripts/flags-patch.js');
const { buildRefSeed } = require('../scripts/refs-patch.js');
const { buildRefImages } = require('../scripts/ref-images-patch.js');
const { producers, assembleApp } = require('../scripts/assemble-app.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Decode a PNG far enough to say it is one: signature, every chunk's CRC, and
   IDAT inflating to exactly the bytes its header promises. Returns {w, h} or
   the reason it is not a PNG. */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return buf => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { why: 'no PNG signature' };
  let o = 8, w = 0, h = 0, depth = 0, type = -1; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (CRC(buf.subarray(o + 4, o + 8 + len)) !== buf.readUInt32BE(o + 8 + len)) return { why: `bad CRC on ${kind}` };
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; }
    if (kind === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  if (depth !== 8 || type !== 2) return { why: `not 8-bit RGB (depth ${depth}, type ${type})` };
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return { why: 'IDAT does not inflate' }; }
  if (raw.length !== (w * 3 + 1) * h) return { why: `IDAT holds ${raw.length} bytes, header promises ${(w * 3 + 1) * h}` };
  return { w, h };
}
const fromDataUrl = u => Buffer.from(String(u).replace(/^data:image\/png;base64,/, ''), 'base64');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-pure-'));
try {
  /* ── 1 ── */
  head('the same arguments give the same bytes');
  ok('the export is deterministic', Syn.syntheticExport() === Syn.syntheticExport());
  const r1 = Syn.syntheticRefs(), r2 = Syn.syntheticRefs();
  ok('the reference library is deterministic',
     JSON.stringify(r1.files) === JSON.stringify(r2.files)
       && r1.images.every(([k, b], i) => k === r2.images[i][0] && b.equals(r2.images[i][1])));

  /* ── 2 ── */
  head('the bank is in the shape the app reads, and invented');
  const { bank, imgs } = Syn.syntheticBank();
  const shell = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
  const chColors = Object.keys(JSON.parse(/const CH_COLORS=(\{[^}]*\});/.exec(shell)[1]));
  const LET = 'ABCDE';
  const badShape = bank.filter(q => !(typeof q.id === 'string' && typeof q.ch === 'string' && Number.isInteger(q.n)
    && typeof q.s === 'string' && Array.isArray(q.o) && q.o.length === 5 && q.o.every(o => typeof o.t === 'string')
    && Number.isInteger(q.ci) && q.ci >= 0 && q.ci < q.o.length && typeof q.ex === 'string' && Number.isInteger(q.img)));
  ok('every question has the fields the app reads', badShape.length === 0, badShape.map(q => q.id).join(', ') || `${bank.length} questions`);
  const offChapter = [...new Set(bank.map(q => q.ch))].filter(c => !chColors.includes(c));
  ok('every chapter is one of the app\'s own (CH_COLORS)', offChapter.length === 0 && chColors.length > 0, offChapter.join(', ') || chColors.length + ' chapters');
  ok('and every one of the app\'s chapters has questions', chColors.every(c => bank.some(q => q.ch === c)));
  const ids = bank.map(q => q.id);
  ok('ids are unique', new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} repeated`);
  const misnumbered = bank.filter(q => q.id !== `${q.id.split('_')[0]}_${q.n}`);
  ok('ids are PREFIX_n with n the question\'s number, as the bank\'s are', misnumbered.length === 0, misnumbered.map(q => q.id).join(', '));
  const prefixes = [...new Set(ids.map(i => i.split('_')[0]))];
  ok('every chapter is numbered from 1', prefixes.every(p => ids.includes(p + '_1') && ids.includes(p + '_2')), prefixes.join(' '));
  const missing = [...CORRECTIONS.map(c => c.id), ...FLAGS.map(f => f.id)].filter(id => !ids.includes(id));
  ok('every id keys-patch and flags-patch correct is present', missing.length === 0, missing.join(', '));
  const flaggedEx = new Set(FLAGS.filter(f => f.wantEx !== undefined).map(f => f.id));
  const real = bank.filter(q => !/^Synthetic stem /.test(q.s) || q.o.some(o => !/^Synthetic option /.test(o.t))
    || (!flaggedEx.has(q.id) && !/^Synthetic commentary /.test(q.ex)));
  ok('every stem, option and commentary is placeholder text', real.length === 0, real.map(q => q.id).join(', ') || 'all invented');

  /* ── 3 ── */
  head('every figure is a PNG that decodes, in the number and size the bank has');
  const figs = [];
  const broken = [];
  for (const [id, list] of Object.entries(imgs)) for (const u of list) {
    const d = decodePng(fromDataUrl(u));
    if (d.why) broken.push(`${id}: ${d.why}`); else figs.push(d);
  }
  ok('every figure decodes', broken.length === 0 && figs.length > 0, broken.slice(0, 3).join('; ') || `${figs.length} figures`);
  const countOff = bank.filter(q => (imgs[q.id] || []).length !== q.img);
  ok('every question carries the figures its img field declares', countOff.length === 0, countOff.map(q => q.id).join(', '));
  /* verify-figzoom reads every figure's header and wants over 100, with a
     median height over 400px; these are its numbers, held here so a smaller
     fixture fails at the fixture rather than as a figzoom regression. */
  const medianH = figs.map(f => f.h).sort((a, b) => a - b)[Math.floor(figs.length / 2)];
  ok('over 100 figures, median height over 400px (what verify-figzoom reads)', figs.length > 100 && medianH > 400,
     `${figs.length} figures, median ${medianH}px`);
  const flaggedFigs = FLAGS.filter(f => f.wantFigs != null).filter(f => { const q = bank.find(x => x.id === f.id); return !q || q.img !== f.wantFigs; });
  ok('a flagged question carries the figures flags-patch records', flaggedFigs.length === 0, flaggedFigs.map(f => f.id).join(', '));

  /* ── 4 ── */
  head('the reference library seeds, and yields pearls');
  const refs = path.join(TMP, 'refs'), refImgs = path.join(TMP, 'refs-images');
  fs.mkdirSync(refs); fs.mkdirSync(refImgs);
  for (const [n, t] of r1.files) fs.writeFileSync(path.join(refs, n), t);
  for (const [k, b] of r1.images) fs.writeFileSync(path.join(refImgs, k), b);
  let seed = null, refImages = null;
  try { seed = buildRefSeed(refs); } catch (e) { ok('refs-patch seeds the library', false, e.message.split('\n')[0]); }
  if (seed) ok('refs-patch seeds the library', seed.notes.length >= 100, seed.notes.length + ' notes');
  ok('every source names the one book, "Heart" in its title (what verify-pearl tests aiming against)',
     !!seed && seed.notes.every(n => /\bHeart\b/.test(n.source)));
  try { refImages = buildRefImages(refs, refImgs); } catch (e) { ok('ref-images-patch finds every cited figure', false, e.message.split('\n')[0]); }
  if (refImages) {
    const bad = Object.entries(JSON.parse(refImages.json)).filter(([, u]) => decodePng(fromDataUrl(u)).why);
    ok('ref-images-patch finds every cited figure, and each decodes', refImages.keys.size > 0 && bad.length === 0,
       bad.map(([k]) => k).join(', ') || refImages.keys.size + ' figures');
  }
  global.window = {};
  require('../src/core/pearl.js');
  const pearls = seed ? window.Pearl.harvest(seed.notes.map((n, i) => ({ id: 'r' + i, ...n }))) : [];
  ok('Pearl.harvest yields over 100, over 5 with a figure (what verify-pearl reads)',
     pearls.length > 100 && pearls.filter(p => p.figKey).length > 5,
     `${pearls.length} pearls, ${pearls.filter(p => p.figKey).length} with a figure`);

  /* ── 5 ── */
  head('it assembles into the app');
  const exportHtml = Syn.syntheticExport();
  let built = null;
  try {
    built = assembleApp({ shell, commit: 'synthetic-pure',
      resolve: producers({ exportHtml, refsDir: refs, imagesDir: refImgs }) });
  } catch (e) { ok('assemble-app builds the app from it', false, e.message.split('\n')[0]); }
  if (built) {
    const html = built.out.toString('utf8');
    ok('assemble-app builds the app from it', !/@@SLOT\[/.test(html), (built.out.length / 1e6).toFixed(2) + ' MB');
    const m = ALL_Q_RE.exec(html);
    const out = m ? JSON.parse(m[1]) : [];
    const unkeyed = CORRECTIONS.filter(c => { const q = out.find(x => x.id === c.id); return !q || LET[q.ci] !== c.now; });
    ok('keys-patch\'s corrections are applied in the built bank', !!m && unkeyed.length === 0,
       unkeyed.map(c => c.id).join(', ') || CORRECTIONS.length + ' corrected');

    /* ── 6 ── */
    head('the build is marked, and verify.js will not record it');
    const file = path.join(TMP, 'systole.html');
    fs.writeFileSync(file, built.out);
    const unmarked = path.join(TMP, 'unmarked.html');
    fs.writeFileSync(unmarked, html.split(Syn.MARK).join('"_x":true'));
    ok('the built app carries the mark', Syn.isSyntheticBuild(file));
    ok('and a build without it is not taken for synthetic', !Syn.isSyntheticBuild(unmarked));
    ok('nor is a file that is not there', !Syn.isSyntheticBuild(path.join(TMP, 'absent.html')));
    const said = f => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), f, '--only', 'study-file-check'],
                                { cwd: ROOT, encoding: 'utf8' }).stdout || '';
    ok('verify.js says it will not write the record for the marked build', /synthetic build: tests\/test-stats\.json will not be written/.test(said(file)));
    ok('and does not say so for the unmarked one', !/synthetic build/.test(said(unmarked)));
    /* writeStats itself only runs at the end of a full run, which this suite
       cannot afford, so the return is held by reading it: the comment-blanked
       body of writeStats must return on SYNTHETIC before anything is written. */
    const v = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8'));
    const body = (/function writeStats\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(v) || [])[1] || '';
    const ret = body.indexOf('if (SYNTHETIC) return;'), write = body.indexOf('writeFileSync');
    ok('writeStats returns on a synthetic build before it writes', ret >= 0 && write > ret,
       ret < 0 ? 'no return on SYNTHETIC in writeStats' : '');
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
