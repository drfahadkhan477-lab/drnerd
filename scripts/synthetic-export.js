#!/usr/bin/env node
/*
 * A synthetic export: the shape of the ACCSAP 12 export, none of its content.
 *
 *   node scripts/synthetic-export.js [out.html] [--per-chapter N]
 *   node scripts/assemble-app.js out.html --refs <dir>/refs --ref-images <dir>/refs-images \
 *                                --out build/systole.html
 *
 * Beside out.html it writes refs/ and refs-images/: a synthetic reference
 * library, in the shape content/refs and content/refs-images have.
 *
 * WHY. The real app could only be built on the owner's machine, where the
 * licensed export is, so every browser suite that needs a build ran there or
 * not at all. scripts/assemble-app.js builds the app from app/systole.html and
 * whatever export it is given. Given this one, CI can build the real app (the
 * real code, every module, every patch's result) around invented questions and
 * run the browser suites on it.
 *
 * WHAT IS IN IT. Only the two lines assemble-app reads: `const ALL_Q=[…];` and
 * `const IMGS={…};`, in the field names the app reads (id, ch, n, s, o[{t}],
 * ci, ex, img). Every stem, option and commentary is invented placeholder
 * text. The chapters are the app's own CH_COLORS names. The ids that
 * keys-patch and flags-patch correct are included, keyed and shaped as their
 * CORRECTIONS and FLAGS record, because the assembler applies those
 * corrections and refuses a bank they do not fit. Those ids and letters are
 * already in this repository; nothing else about those questions is.
 *
 * THE REFERENCE LIBRARY. Without notes the app's REF is empty, and every suite
 * that reads a note (pearls, the Apex figure strip) fails on the empty library
 * rather than on the app. So this also writes one markdown file per chapter in
 * the format refs-patch parses (front matter, one note per `##` section), each
 * note carrying a sentence Pearl.harvest accepts and citing a refimg://
 * figure. Every note, which the real library does not do: verify-chatfigs
 * sends its question before it pins the note it reads, so what reaches the
 * model is whatever retrieval found, and only a library where every note has
 * a figure makes that reliably one with a figure. On the real library it is
 * one by the library's luck.
 *
 * Two properties of the real library are reproduced because suites test
 * against them: it is large (verify-pearl wants over 100 pearls), and every
 * source names the same book with "Heart" in its title (verify-pearl checks a
 * chapter word that matches the whole shelf is not used to aim).
 *
 * Deterministic: the same arguments give the same bytes, so a build made from
 * it is reproducible.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { CORRECTIONS } = require('./keys-patch.js');
const { FLAGS } = require('./flags-patch.js');

/* The app's chapters (CH_COLORS in app/systole.html), each with an id prefix.
   The real prefixes are used where the corrections already name them; the
   rest are invented and only need to be consistent, which content-checks
   holds them to. */
const CHAPTERS = [
  ['Arrhythmias', 'ARR'], ['Congenital Heart Disease', 'CON'], ['Coronary Artery Disease', 'COR'],
  ['Heart Failure & Cardiomyopathies', 'HEA'], ['Miscellaneous Topics', 'MIS'], ['Pericardial Disease', 'PER'],
  ['Pulmonary Circulation Disorders', 'PUL'], ['Systemic Disorders', 'SDX'],
  ['Systemic Hypertension & Hypotension', 'SYS'], ['Valvular Disease', 'VAL'], ['Vascular Disease', 'VAS'],
];
const LETTERS = 'ABCDE';

/* A figure: a real PNG the browser decodes, of the size the bank's figures
   are, and no one's figure. verify-figzoom reads every figure's header and
   wants them over 400px tall at the median; verify-selftest removes the
   viewer's max-height and needs figures taller than its 834px frame to
   overflow, as most of the bank's are. So heights run 480 to 1200px. Grey ground, one
   darker band whose place depends on the seed, so no two are the same bytes.
   Encoded here, with zlib, because the repository has no image library. */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return buf => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function figurePng(seed, w = 900, h = [480, 640, 820, 1000, 1200][seed % 5]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                       // 8-bit RGB
  const band = 40 + (seed * 37) % (h - 80);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const v = y >= band && y < band + 40 ? 90 : 225;
    raw.fill(v, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = png => 'data:image/png;base64,' + png.toString('base64');

/* Ordinary words a stem names, so that search has something to find: two
   suites search the bank for a term (verify-stage0 for "amyloidosis",
   verify-apex for "amyloid"). Each reference note names one too, which is
   what lets retrieval connect a question to a note at all: every other word
   in this library is in every document and scores nothing. The words are the
   field's vocabulary, not any question's text. */
const TOPICS = ['amyloidosis', 'pericarditis', 'endocarditis', 'aortic stenosis', 'atrial flutter',
                'myocarditis', 'coarctation', 'pulmonary embolism', 'sarcoidosis', 'syncope', 'vasculitis'];

function question(id, ch, n, ci, opts = {}) {
  return {
    id, ch, n,
    s: `Synthetic stem ${id}: an invented patient with ${TOPICS[n % TOPICS.length]} presents with an invented finding. Which invented next step is best?`,
    o: [...LETTERS].map(L => ({ l: L, t: `Synthetic option ${L} for ${id}` })),
    ci,
    ex: opts.ex !== undefined ? opts.ex : `Synthetic commentary for ${id}. Option ${LETTERS[ci]} is keyed as correct in this invented bank.`,
    img: opts.img || 0,
  };
}

/* Ids run PREFIX_1 upward, as the bank's do, so a suite naming ARR_2 finds a
   question. The ids keys-patch and flags-patch correct take the shape those
   steps expect, wherever they fall. Every other question has a figure. */
function syntheticBank(perChapter = 20) {
  const need = new Map();
  for (const c of CORRECTIONS) need.set(c.id, Object.assign(need.get(c.id) || {}, { was: c.was }));
  for (const f of FLAGS) need.set(f.id, Object.assign(need.get(f.id) || {}, { wantEx: f.wantEx, wantFigs: f.wantFigs }));
  const prefixCh = new Map(CHAPTERS.map(([ch, p]) => [p, ch]));
  for (const id of need.keys())
    if (!prefixCh.has(id.split('_')[0])) throw new Error(`synthetic-export: no chapter for the prefix of ${id}`);

  const bank = [], imgs = {};
  let seed = 0;
  const add = (id, ch, n) => {
    const want = need.get(id) || {};
    /* A flagged question carries the figures flags-patch records for it. */
    const img = want.wantFigs != null ? want.wantFigs : n % 2 === 0 ? 1 : 0;
    bank.push(question(id, ch, n, want.was ? LETTERS.indexOf(want.was) : (n - 1) % LETTERS.length,
                       { img, ex: want.wantEx }));
    if (img) imgs[id] = Array.from({ length: img }, () => dataUrl(figurePng(++seed)));
  };
  for (const [ch, p] of CHAPTERS) {
    let last = perChapter;
    for (const id of need.keys()) if (id.startsWith(p + '_')) last = Math.max(last, +id.split('_')[1]);
    for (let n = 1; n <= last; n++) if (n <= perChapter || need.has(`${p}_${n}`)) add(`${p}_${n}`, ch, n);
  }
  bank[0][MARK_KEY] = true;
  return { bank, imgs };
}

/* THE MARK. The first question carries "_synthetic":true, and keys-patch and
   flags-patch keep unknown fields, so the mark survives into the built app's
   ALL_Q. scripts/verify.js reads it and will not write tests/test-stats.json
   for a synthetic build: a record of suites run on invented questions, quoted
   in the docs as the app's numbers, would be prose about the wrong thing.
   The exact text cannot occur inside any string in a JSON bank, because
   JSON.stringify escapes every quote a string contains. */
const MARK_KEY = '_synthetic';
const MARK = JSON.stringify(MARK_KEY) + ':true';
function isSyntheticBuild(file) {
  try { return fs.readFileSync(file, 'utf8').includes(MARK); } catch (_) { return false; }
}

/* syntheticRefs(perChapter) → { files: [[name, text]], images: [[key, Buffer]] }
   One file per chapter, perChapter notes in each, every one of them over the
   forty-word floor refs-patch enforces. */
function syntheticRefs(perChapter = 10) {
  const files = [], images = [];
  for (const [ch, p] of CHAPTERS) {
    let md = `---\ntitle: Synthetic ${ch}\ntags: synthetic\nsource: The Synthetic Heart Library, invented text\n---\n`;
    for (let k = 1; k <= perChapter; k++) {
      const key = `synthetic-${p.toLowerCase()}-${k}.png`;
      md += `\n## Point ${k}\n\n`
         + `In ${TOPICS[k % TOPICS.length]}, invented agent ${p}${k} should be started within 24 hours of the invented finding, whereas invented agent ${p}${k + 1} should be avoided until the invented marker falls.`
         + ` The invented marker is measured twice, and the second reading decides the invented course of action in this synthetic note.\n`
         + `\n![Synthetic figure ${p}-${k}](refimg://${key})\n`
         + `\nThis paragraph is filler for the synthetic ${ch} library, written so the section clears the forty-word floor every seeded note is held to.\n`;
      images.push([key, figurePng(1000 + images.length)]);
    }
    files.push([`synthetic-${p.toLowerCase()}.md`, md]);
  }
  return { files, images };
}

function syntheticExport(perChapter) {
  const { bank, imgs } = syntheticBank(perChapter);
  return '<!doctype html><html><head><meta charset="utf-8"><title>synthetic export</title></head><body>\n' +
         `<script>\nconst ALL_Q=${JSON.stringify(bank)};\nconst IMGS=${JSON.stringify(imgs)};\n</script>\n</body></html>\n`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--per-chapter');
  const per = i >= 0 ? parseInt(args[i + 1], 10) : undefined;
  const out = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--per-chapter') || path.join(__dirname, '..', 'build', 'synthetic-export.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, syntheticExport(per));
  const { bank, imgs } = syntheticBank(per);
  console.log(`synthetic export → ${out}  (${bank.length} questions, ${Object.keys(imgs).length} with a figure, none real)`);
  const dir = path.dirname(out), refs = syntheticRefs();
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'refs-images'), { recursive: true });
  for (const [name, text] of refs.files) fs.writeFileSync(path.join(dir, 'refs', name), text);
  for (const [key, buf] of refs.images) fs.writeFileSync(path.join(dir, 'refs-images', key), buf);
  console.log(`synthetic refs   → ${path.join(dir, 'refs')}  (${refs.files.length} files, ${refs.images.length} figures)`);
}

module.exports = { syntheticBank, syntheticExport, syntheticRefs, figurePng, isSyntheticBuild, MARK, CHAPTERS };
