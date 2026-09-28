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
ok('under the source file\'s title', /^---\ntitle: Heart failure (pages 1-2|unit)\n/.test(out), out.split('\n')[1]);
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
/* Decimals, doses and file names put dots inside sentences; none is an end. */
const dotted = Array.from({ length: 60 }, (_, i) => `An LVEF of 4${i}.5% on 2.5 mg, see ![f](<visuals/0${i}_FIG.5.${i}_p1.jpg>) and ${prose('dt' + i, 10)}.`).join(' ');
const dch = M.chunks({ heading: 'PDF Page 41', body: dotted });
ok('nor do dots inside a sentence — decimals, doses, figure file names', dch.length >= 3 && dch.map(c => c.body).join(' ').replace(/\s+/g, ' ') === dotted,
   `${dch.length} chunks, ${M.tokens(dch.map(c => c.body).join(' '))} of ${M.tokens(dotted)} tokens`);
ok('and no paragraph is lost or reworded on the way', ch.map(c => c.body).join('\n\n').replace(/!\[[^\]]*\]\([^)]*\)\s*/g, '').trim() === paras);

head('what check-refs will ask of every staged file');
/* check-refs' floors, read the way check-refs reads them. The constants are
   compared against check-refs' own source (comments blanked), so a floor
   moved there and not here fails this suite rather than the owner's run. */
const { blankComments } = require('./_source.js');
const crSrc = blankComments(fs.readFileSync(path.join(__dirname, '..', 'tools', 'check-refs.js'), 'utf8'));
const crBack = /const BACKREF = (\/.+\/[a-z]*);/.exec(crSrc);
ok('the "see above" pattern is check-refs\' own, character for character', !!crBack && crBack[1] === String(M.BACKREF), crBack ? crBack[1] : 'no BACKREF in check-refs');
ok('the ceiling is check-refs\' own', new RegExp(`words > ${M.MAX_WORDS}\\)`).test(crSrc), `MAX_WORDS ${M.MAX_WORDS}`);
ok('the tag count is check-refs\' own', new RegExp(`tags\\.length < ${M.MIN_TAGS}\\)`).test(crSrc), `MIN_TAGS ${M.MIN_TAGS}`);
const crFront = text => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text), front = fm ? fm[1] : '';
  const field = k => ((new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(front) || [, ''])[1] || '').trim();
  return { title: field('title'), source: field('source'), tags: field('tags').split(',').map(t => t.trim()).filter(Boolean) };
};
/* The pages file has a title and nothing else — the laptop run's three
   failing files were exactly this. */
const bare = M.renderSelected(M.selectUnit([files[1]], new Set(), { minScore: 2 }).kept, { unit: 'bw-heart-failure', kind: 'text' });
const bf = crFront(bare);
ok('a source file with only a title still gets a title, a source and four tags', !!bf.title && !!bf.source && bf.tags.length >= M.MIN_TAGS, JSON.stringify(bf));
ok('the title it had is kept', bf.title === 'Heart failure pages 1-2', bf.title);
const ff = crFront(M.renderSelected(M.selectUnit([files[0]], new Set(), { minScore: 2 }).kept, { unit: 'bw-heart-failure', kind: 'figure' }));
ok('and a source file\'s own source and tags are kept, not replaced', ff.tags.includes('hf') && ff.source === 'a textbook' && / — figures$/.test(ff.title), JSON.stringify(ff));

const BACK = ` As discussed above, the same applies here. `;
const backAtlas = atlasRaw.replace(prose('cap3', 60), prose('cap3', 60) + BACK);
const rb = M.selectUnit([{ name: 'atlas.md', raw: backAtlas }], new Set(), { minScore: 2 });
ok('a figure caption that points elsewhere ("as discussed above") is dropped', rb.dropped.some(c => c.heading === 'FIG. 54.3 — figure 3' && c.why === 'backref'),
   (rb.dropped.find(c => c.heading === 'FIG. 54.3 — figure 3') || {}).why || 'kept');
const backUnit = unitFull.replace(HIGH, HIGH + BACK);
const rt = M.selectUnit([{ name: 'full.md', raw: backUnit }], new Set(), { minScore: 2 });
ok('and so is a text section that does', rt.dropped.some(c => c.heading === 'Treatment thresholds' && c.why === 'backref'),
   (rt.dropped.find(c => c.heading === 'Treatment thresholds') || {}).why || 'kept');

/* Sizes chosen against the ceiling: entry 2 is 700 words (the 611-word
   FIG.59.9 of the laptop run, and then some); entry 4 is 590, so the 10-word
   caption before it cannot join it; entries 5-6 are 10 words each after
   another 580 — the last-of-all join must find a note with room. */
const sizes2 = [60, 700, 10, 590, 10, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 580, 10, 10];
const bigAtlas = `---\ntitle: HF visual atlas\n---\n\n## Figure Atlas\n\n` + sizes2.map((n, i) => entry(i + 1, n)).join('\n\n') + '\n';
const rg = M.selectUnit([{ name: 'atlas.md', raw: bigAtlas }], new Set(), { minScore: 2 });
const rendered = M.parseNotes(M.renderSelected(rg.kept, { unit: 'bw-heart-failure', kind: 'figure' }), 'x').sections;
const fat = rendered.map(s => M.tokens(s.body)).filter(n => n > M.MAX_WORDS);
ok(`no note written is over check-refs' ${M.MAX_WORDS} words, counted its way`, fat.length === 0 && rendered.length > 0, fat.join(', ') || `${rendered.length} notes, largest ${Math.max(...rendered.map(s => M.tokens(s.body)))}`);
const big = rg.kept.filter(c => c.body.includes('002_FIG.54.2'));
ok('an entry over the ceiling is cut, its figure in the first piece', big.length >= 1 && /\(1\/\d\)/.test(big[0].heading) && rg.kept.some(c => /FIG\. 54\.2 — figure 2 \(2\/\d\)/.test(c.heading)),
   big.map(c => c.heading).join(' | ') || 'figure 2 in no kept note');
const figsOut = rg.kept.reduce((n, c) => n + c.figures, 0);
ok('and no figure is lost to the ceiling', figsOut === sizes2.length && !rg.dropped.length, `${figsOut} of ${sizes2.length} figures kept, ${rg.dropped.length} dropped`);
ok('nor any note left thin by it', rendered.every(s => M.tokens(s.body) >= M.MIN_WORDS), rendered.map(s => M.tokens(s.body)).filter(n => n < M.MIN_WORDS).join(', ') || 'none');

head('a title someone could search by');
/* The owner's full run: R@1 from a note's own title 50%, because the titles
   were "<unit> — PDF Page 162 (2/3)" and "<unit> — FIG.59.9 — PDF page 162",
   hundreds of them a digit apart. Measured here the way it failed: how many
   pairs of titles share most of their words. */
const pageUnit = `---\ntitle: HF pages\n---\n\n` + Array.from({ length: 6 }, (_, p) =>
  `## PDF Page ${160 + p}\n` + Array.from({ length: 60 }, (_, i) => `Topic${p}n${i} ${prose('pp' + p + 's' + i, 11)}.`).join(' ')).join('\n\n') + '\n';
const figUnit = `---\ntitle: HF atlas\n---\n\n## Figure Atlas\n\n` + Array.from({ length: 22 }, (_, i) =>
  `### FIG.59.${i + 1} — PDF page ${150 + i}\n![Fig 59.${i + 1}](<visuals/${String(i + 1).padStart(3, '0')}_FIG.59.${i + 1}_p${150 + i}.jpg>)\n` +
  `Figure 59.${i + 1} ${prose('fc' + i, i === 21 ? 8 : 50)}`).join('\n\n') + '\n';
const tk = t => t.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
const clash = hs => { let n = 0; for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
  const a = new Set(tk(hs[i])), b = tk(hs[j]); if (b.filter(x => a.has(x)).length * 2 >= Math.max(a.size, b.length)) n++; } return n; };
const pageKept = M.selectUnit([{ name: 'pages.md', raw: pageUnit }], new Set(), { minScore: 0 }).kept;
const pageHeads = M.parseNotes(M.renderSelected(pageKept, { unit: 'bw-heart-failure' }), 'x').sections.map(x => x.heading);
ok('page chunks are titled by what they say, not by a page number', pageHeads.length >= 12 && clash(pageHeads) === 0 && !pageHeads.some(h => /^PDF Page/i.test(h)),
   `${pageHeads.length} titles, ${clash(pageHeads)} pairs mostly alike; e.g. "${pageHeads[1]}"`);
ok('and keep their page, last', pageHeads.every(h => /\(p\. 16\d\)$/.test(h)), pageHeads.find(h => !/\(p\. 16\d\)$/.test(h)) || 'all');
/* The shape of the real miss (--why: 181 of 203 were Braunwald notes beaten
   by Braunwald notes, no near-copies, no shared titles): passages that open
   on the same common words and differ in what they are about. */
const COMMON = 'In patients with chronic heart failure and reduced ejection fraction the clinical course depends on';
const shared = Array.from({ length: 8 }, (_, k) => `## PDF Page ${200 + k}\n${COMMON} several factors. ` +
  `Therapy${k}drug is given and therapy${k}drug is titrated, with monitor${k}level checked; therapy${k}drug again. ` +
  `${COMMON} renal function, blood pressure and potassium, which are measured in every clinic visit and again after each dose change of any agent.`).join('\n\n');
const sk = M.selectUnit([{ name: 'p.md', raw: `---\ntitle: t\n---\n\n${shared}\n` }], new Set(), { minScore: 0 }).kept;
const sh2 = M.parseNotes(M.renderSelected(sk, { unit: 'bw-x' }), 'x').sections.map(x => x.heading);
ok('titled by what sets a passage apart, not the opening its neighbours share', sh2.length === 8 && clash(sh2) === 0 && sh2.every((h, k) => h.includes(`Therapy${k}drug`) || h.includes(`therapy${k}drug`)),
   `${sh2.length} titles, ${clash(sh2)} pairs mostly alike; e.g. "${sh2[0]}"`);
/* The owner's --why after that: in 156 of 165 misses the winner held every
   term of the missed title — a shorter note from the same file repeating
   the passage's rarest words (a caption, also printed in the page text). */
const cap = 'Sacubitrilzz valsartanzz angioedemazz paradigmzz neprilysinzz';
const pair = [{ kind: 'text', heading: 'PDF Page 9 (1/2)', body: `${cap} ${prose('lg', 90)} renalqq kaliumqq with ${cap}.` },
              { kind: 'figure', heading: 'FIG.9.1 — PDF page 9', body: `![f](<visuals/001_FIG.9.1_p9.jpg>)\n${cap} ${cap}` }]
  .concat(Array.from({ length: 6 }, (_, i) => ({ kind: 'text', heading: `PDF Page ${20 + i}`, body: prose('ot' + i, 80) })));
M.keyTerms(pair);
const capWords = new Set(cap.toLowerCase().split(' '));
ok('the longer passage is titled by terms the shorter note repeating it does not have',
   pair[0].terms.length >= 2 && pair[0].terms.every(t => !capWords.has(t.toLowerCase())), pair[0].terms.join(', '));
ok('and a hyphenated or dotted term is never a title term', (() => { const x = [{ kind: 'text', heading: 'PDF Page 1', body: 'NT-proBNP NT-proBNP 2.5mg alphaone betaone' },
   ...Array.from({ length: 4 }, (_, i) => ({ kind: 'text', heading: 'PDF Page 2', body: prose('hy' + i, 20) }))]; M.keyTerms(x); return x[0].terms.every(t => /^[a-z][a-z0-9]*$/i.test(t)); })());
ok('a source titled only by its file name reads as words', /^---\ntitle: Braunwald 13th HF full\n/.test(M.renderSelected(
   M.selectUnit([{ name: 'Braunwald_13th_HF_full.md', raw: unitFull.replace(/^---\ntitle: [^\n]*\n/, '---\n') }], new Set(), { minScore: 2 }).kept, { unit: 'bw-x' })));
const figKept = M.selectUnit([{ name: 'atlas.md', raw: figUnit }], new Set(), { minScore: 2 }).kept;
const figHeads = M.parseNotes(M.renderSelected(figKept, { unit: 'bw-heart-failure', kind: 'figure' }), 'x').sections.map(x => x.heading);
ok('a figure keeps its number and gains its caption\'s words', figHeads.length === 21 && clash(figHeads) === 0 && figHeads.every(h => /^Fig\. 59\.\d+ — \S+/.test(h)),
   `${figHeads.length} titles, ${clash(figHeads)} pairs mostly alike; e.g. "${figHeads[0]}"`);
ok('with its page, and the figures it carries', /\(p\. 170\) \(with 1 more figure\)$/.test(figHeads[figHeads.length - 1]), figHeads[figHeads.length - 1]);
ok('a real section heading is kept as it was', M.noteTitle({ kind: 'text', heading: 'Treatment thresholds', body: HIGH }) === 'Treatment thresholds');
const twice = M.parseNotes(M.renderSelected([pageKept[0], { ...pageKept[0] }], { unit: 'bw-x' }), 'x').sections.map(x => x.heading);
ok('and no two notes in a file share a title', twice.length === 2 && twice[0] !== twice[1], twice.join(' | '));

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
