#!/usr/bin/env node
/*
 * A synthetic export: the shape of the ACCSAP 12 export, none of its content.
 *
 *   node scripts/synthetic-export.js [out.html] [--per-chapter N]
 *   node scripts/assemble-app.js out.html --out build/systole.html
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
 * Deterministic: the same arguments give the same bytes, so a build made from
 * it is reproducible.
 */
'use strict';
const fs = require('fs');
const path = require('path');
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

/* A 1x1 PNG: a real image the browser decodes, and no one's figure. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEFQGVT8bYqgAAAABJRU5ErkJggg==';

function question(id, ch, n, ci, opts = {}) {
  return {
    id, ch, n,
    s: `Synthetic stem ${id}: an invented patient presents with an invented finding. Which invented next step is best?`,
    o: [...LETTERS].map(L => ({ l: L, t: `Synthetic option ${L} for ${id}` })),
    ci,
    ex: opts.ex !== undefined ? opts.ex : `Synthetic commentary for ${id}. Option ${LETTERS[ci]} is keyed as correct in this invented bank.`,
    img: opts.img || 0,
  };
}

function syntheticBank(perChapter = 6) {
  const bank = [], imgs = {}, byId = new Map();
  const prefixCh = new Map(CHAPTERS.map(([ch, p]) => [p, ch]));
  for (const [ch, p] of CHAPTERS) {
    for (let k = 1; k <= perChapter; k++) {
      const id = `${p}_${900 + k}`;
      /* Every third question carries a figure, so the figure paths run. */
      const img = k % 3 === 0 ? 1 : 0;
      const q = question(id, ch, k, (k - 1) % LETTERS.length, { img });
      if (img) imgs[id] = [PNG];
      bank.push(q); byId.set(id, q);
    }
  }
  /* The corrected and flagged ids, shaped as keys-patch and flags-patch expect. */
  const need = new Map();
  for (const c of CORRECTIONS) need.set(c.id, Object.assign(need.get(c.id) || {}, { was: c.was }));
  for (const f of FLAGS) need.set(f.id, Object.assign(need.get(f.id) || {}, { wantEx: f.wantEx }));
  let n = perChapter;
  for (const [id, want] of need) {
    const ch = prefixCh.get(id.split('_')[0]);
    if (!ch) throw new Error(`synthetic-export: no chapter for the prefix of ${id}`);
    const q = question(id, ch, ++n, want.was ? LETTERS.indexOf(want.was) : 0,
                       want.wantEx !== undefined ? { ex: want.wantEx } : {});
    bank.push(q); byId.set(id, q);
  }
  return { bank, imgs };
}

function syntheticExport(perChapter) {
  const { bank, imgs } = syntheticBank(perChapter);
  return '<!doctype html><html><head><meta charset="utf-8"><title>synthetic export</title></head><body>\n' +
         `<script>\nconst ALL_Q=${JSON.stringify(bank)};\nconst IMGS=${JSON.stringify(imgs)};\n</script>\n</body></html>\n`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--per-chapter');
  const per = i >= 0 ? parseInt(args[i + 1], 10) : 6;
  const out = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--per-chapter') || path.join(__dirname, '..', 'build', 'synthetic-export.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, syntheticExport(per));
  const { bank, imgs } = syntheticBank(per);
  console.log(`synthetic export → ${out}  (${bank.length} questions, ${Object.keys(imgs).length} with a figure, none real)`);
}

module.exports = { syntheticBank, syntheticExport, CHAPTERS };
