#!/usr/bin/env node
'use strict';
/*
 * tools/refs-merge.js decides which sections of a reference unit are added to
 * the notes: is each rule doing what it says, on notes built to test it?
 *
 *   node tests/verify-refsmerge-pure.js
 *
 * The real units are licensed and never read here, so the rules are proven on
 * synthetic notes, each written to land on exactly one rule: a copy of an
 * existing note, a lightly reworded copy, the same section repeated inside
 * the unit (a whole-unit file and a page-range file), a new section dense with
 * thresholds and guideline classes, a new narrative section, a "History"
 * section, and a fragment under the importer's floor. And what it writes must
 * split back into notes the way refs-patch splits them, figures intact.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../tools/refs-merge.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Filler that shares no five-word run with anything else here. */
const prose = (seed, n) => Array.from({ length: n }, (_, i) => `w${seed}x${i}`).join(' ');
const EXISTING_BODY = `The existing note describes a mechanism in plain words. ${prose('ex', 70)}`;
const HIGH = `Loop diuretics are first-line for congestion. An LVEF of 40% or less with NYHA class II symptoms is recommended for therapy (class I, level of evidence A). ` +
  `Treatment reduced mortality with a hazard ratio 0.80 and a 20% relative reduction in hospitalization; potassium above 5.0 mEq and creatinine greater than 2.5 mg/dL are contraindications. ` +
  `A systolic pressure below 90 mm Hg over 48 hours is contraindicated. ${prose('hi', 40)}`;
const NARRATIVE = `This section tells a long story about how the field developed and why people cared. ${prose('na', 90)}`;
const HISTORY = `Long ago physicians first described the condition, measuring 40% of things at 90 mm Hg over 48 hours with class I care. ${prose('hs', 60)}`;
const THIN = `A short fragment with 40% at 90 mm Hg.`;
const FIG = '![Fig 54.2 — a figure](<visuals/004_FIG.54.2_p003.jpg>)';
const HIGH_WITH_FIG = `${HIGH}\n\n${FIG}`;

const existingIndex = new Set();
for (const h of M.shingles(EXISTING_BODY)) existingIndex.add(h);

const unitFull = `---\ntitle: Heart failure unit\ntags: hf\nsource: a textbook\n---\n\n` +
  `## Copied note\n${EXISTING_BODY}\n\n` +
  `## Reworded note\n${EXISTING_BODY.replace('describes', 'explains').replace('plain', 'simple')} and one more clause here.\n\n` +
  `## Treatment thresholds\n${HIGH}\n\n` +
  `## How it came about\n${NARRATIVE}\n\n` +
  `## History of the disease\n${HISTORY}\n\n` +
  `## Stub\n${THIN}\n`;
const unitPages = `---\ntitle: Heart failure pages 1-2\n---\n\n## Treatment thresholds (pages)\n${HIGH_WITH_FIG}\n`;
const files = [{ name: 'full.md', raw: unitFull }, { name: 'pages_001_002.md', raw: unitPages }];

head('the importer\'s own splitting');
const parsed = M.parseNotes(unitFull, 'full');
ok('one note per "## " section, titled by the front matter', parsed.sections.length === 6 && parsed.title === 'Heart failure unit', `${parsed.sections.length} sections, "${parsed.title}"`);

head('each rule, on the note written for it');
const r = M.selectUnit(files, existingIndex, { minScore: 2 });
const whyOf = h => { const d = r.dropped.find(c => c.heading === h); return d ? d.why : (r.kept.find(c => c.heading === h) ? 'kept' : 'absent'); };
/* The copy and the reworded copy are also near-copies OF EACH OTHER, so the
   first pass (the unit's own repeats) folds one into the other before the
   second (the existing notes) sees it. Neither may be added; the reworded one,
   kept as the richer of the two, is the one that meets the notes. */
ok('a lightly reworded copy of an existing note is covered', whyOf('Reworded note') === 'covered', whyOf('Reworded note'));
ok('and the exact copy is not added either — folded into it as a repeat', !r.kept.some(c => c.heading === 'Copied note') && r.dropped.every(c => c.heading !== 'Copied note'),
   whyOf('Copied note'));
const treat = r.kept.filter(c => /^Treatment thresholds/.test(c.heading));
ok('the unit\'s own repeat collapses to one section', treat.length === 1 && r.tally.repeat === 2, `${treat.length} kept, ${r.tally.repeat} repeats (this and the copy above)`);
ok('and the copy kept is the one with the figure', treat[0] && treat[0].figures === 1 && treat[0].file === 'pages_001_002.md', treat[0] && treat[0].file);
ok('a new section dense with thresholds, classes and effect sizes is kept', !!treat[0] && treat[0].score >= 2, treat[0] && treat[0].score.toFixed(1));
ok('a new narrative section is dropped on its score', whyOf('How it came about') === 'lowScore', whyOf('How it came about'));
ok('a History section is dropped on its heading, whatever its numbers', whyOf('History of the disease') === 'lowHeading', whyOf('History of the disease'));
ok('a fragment under the importer\'s 40-word floor is dropped', whyOf('Stub') === 'thin', whyOf('Stub'));
ok('and the tally adds up to the sections read', Object.entries(r.tally).filter(([k]) => ['repeat', 'covered', 'thin', 'lowHeading', 'lowScore', 'kept'].includes(k)).reduce((n, [, v]) => n + v, 0) === r.tally.sections,
   JSON.stringify(r.tally));
ok('the cut moves with --min-score: at 0 the narrative is kept too', M.selectUnit(files, existingIndex, { minScore: 0 }).kept.some(c => c.heading === 'How it came about'));

head('what it writes is what the importer reads');
const out = M.renderSelected(r.kept);
const back = M.parseNotes(out, 'x');
ok('it splits back into the kept sections, one note each', back.sections.length === r.kept.length && back.sections.every((s, i) => s.heading === r.kept[i].heading), `${back.sections.length} of ${r.kept.length}`);
ok('under the source file\'s front matter', /^---\ntitle: Heart failure pages 1-2\n---/.test(out) || /^---\ntitle: Heart failure unit/.test(out), out.split('\n')[1]);
ok('with the figure link exactly as the unit wrote it, for add-unit to resolve', out.includes(FIG));
ok('and not a word altered', back.sections[0] && back.sections[0].body === r.kept[0].body.trim());

head('the existing notes it measures against');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refsmerge-'));
fs.writeFileSync(path.join(dir, 'mine.md'), `---\ntitle: Mine\n---\n\n## One\n${EXISTING_BODY}\n`);
fs.writeFileSync(path.join(dir, 'bw-heart-failure-selected.md'), `---\ntitle: Staged\n---\n\n## Two\n${HIGH}\n`);
const idx = M.indexNotes(dir, name => /^bw-/.test(name));
ok('the owner\'s notes are read', idx.notes === 1, `${idx.notes} note(s)`);
ok('and a unit this tool staged before is not, so a rerun is not measured against itself',
   M.containment(M.shingles(HIGH), idx.idx) === 0 && M.containment(M.shingles(EXISTING_BODY), idx.idx) === 1);

head('an atlas becomes one note per figure; a page becomes paragraph-sized notes');
const entry = (i, words) => `### FIG. 54.${i} — figure ${i}\n![Fig 54.${i}](<visuals/${String(i).padStart(3, '0')}_FIG.54.${i}_p00${i % 9}.jpg>)\n${prose('cap' + i, words)}`;
const atlasRaw = `---\ntitle: HF visual atlas\n---\n\n# Atlas\n\n## Figure Atlas\n\n` +
  Array.from({ length: 24 }, (_, i) => entry(i + 1, i === 23 ? 10 : i === 4 ? 260 : 60)).join('\n\n') + '\n';   // 5: a long caption, scoring under 2
const atlasParsed = M.parseNotes(atlasRaw, 'atlas');
ok('a file of "### " entries most carrying a figure is an atlas', M.isAtlas(atlasParsed) && M.atlasEntries(atlasParsed).length === 24, `${M.atlasEntries(atlasParsed).length} entries`);
ok('and an ordinary unit file is not', !M.isAtlas(M.parseNotes(unitFull, 'full')));
const owned = new Set(['002_FIG.54.2_p002.jpg']);
const ra = M.selectUnit([{ name: 'atlas.md', raw: atlasRaw }], new Set(), { minScore: 2, existingFigures: owned });
const figNotes = ra.kept.filter(c => c.kind === 'figure');
ok('each figure is its own note, headed by its entry', figNotes.length === 22 && figNotes[0].heading === 'FIG. 54.1 — figure 1' &&
   figNotes.filter(c => c.figures === 1).length === 21, `${figNotes.length} kept, first "${figNotes[0] && figNotes[0].heading}"`);
ok('a figure the owner\'s notes already cite is covered, by its file name', ra.dropped.some(c => c.heading === 'FIG. 54.2 — figure 2' && c.why === 'covered'));
/* The last entry's caption is 10 words: under the importer's floor. It must
   neither fail the build (a thin note) nor be lost (a dropped figure): it
   joins the figure before it, in one note that clears the floor. */
const joined = figNotes.find(c => c.body.includes('024_FIG.54.24'));
ok('a caption under the importer\'s floor joins the figure beside it — not lost, not thin',
   !!joined && joined.figures === 2 && joined.words >= 40 && /\(with 1 more figure\)$/.test(joined.heading) && !ra.dropped.some(c => /54\.24/.test(c.heading)),
   joined ? `"${joined.heading}", ${joined.figures} figures, ${joined.words} words` : 'figure 24 in no kept note');
const scansRaw = `---\ntitle: unit complete\n---\n\n` + Array.from({ length: 24 }, (_, i) => `## PDF Page ${i + 1}\n### Page image\n![p](<images/page_${i + 1}.jpg>)\n${prose('sc' + i, 80)}`).join('\n\n');
ok('a file of one "### " per page, each linking its page scan, is not an atlas', !M.isAtlas(M.parseNotes(scansRaw, 'complete')));
ok('figures are not cut on score: a caption is what it is', figNotes.some(c => c.score < 2));

const paras = Array.from({ length: 9 }, (_, i) => prose('pg' + i, 100)).join('\n\n');
const page = { heading: 'PDF Page 12', body: `![page](<pages/page_012.jpg>)\n\n${paras}\n\n![Fig 54.9](<visuals/009_FIG.54.9_p012.jpg>)` };
const ch = M.chunks(page);
const sizes = ch.map(c => M.words(c.body).length);
ok('a 900-word page becomes notes of 120 to 350 words', ch.length >= 3 && sizes.every(n => n >= 120 && n <= 350), sizes.join(', '));
ok('each headed by its page and its place', ch.every((c, i) => c.heading === `PDF Page 12 (${i + 1}/${ch.length})`), ch[0] && ch[0].heading);
ok('the whole-page scan is removed, the cropped figure kept', !ch.some(c => c.body.includes('pages/page_012.jpg')) && ch.some(c => c.body.includes('visuals/009_FIG.54.9_p012.jpg')));
const oneBlock = Array.from({ length: 60 }, (_, i) => `Sentence ${i} has ${prose('sn' + i, 12)} in it.`).join(' ');
const flat = M.chunks({ heading: 'PDF Page 40', body: oneBlock });
const flatSizes = flat.map(c => M.words(c.body).length);
ok('a page with no blank lines at all is still cut, at sentence ends', flat.length >= 3 && flatSizes.every(n => n >= 120 && n <= 350) && flat.every(c => /\.$/.test(c.body)),
   flatSizes.join(', '));
ok('and cutting at sentences loses and changes nothing', flat.map(c => c.body).join(' ') === oneBlock);
ok('and no paragraph is lost or reworded on the way', ch.map(c => c.body).join('\n\n').replace(/!\[[^\]]*\]\([^)]*\)\s*/g, '').trim() === paras);

head('finding the units wherever the zip was unpacked');
const zroot = fs.mkdtempSync(path.join(os.tmpdir(), 'refsmerge-units-'));
for (const d of ['some-zip/references/heart-failure/visuals', 'some-zip/references/heart-failure/pages', 'some-zip/references/ischemia/images', 'some-zip/__MACOSX/x'])
  fs.mkdirSync(path.join(zroot, d), { recursive: true });
for (const f of ['some-zip/references/heart-failure/a.md', 'some-zip/references/ischemia/b.md', 'some-zip/references/guide.md', 'some-zip/README.md'])
  fs.writeFileSync(path.join(zroot, f), '');
const found = M.unitFolders(zroot).map(u => u.unit);
ok('each folder of notes beside its figures is a unit, however deep', JSON.stringify(found) === JSON.stringify(['bw-heart-failure', 'bw-ischemia']), found.join(', '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
