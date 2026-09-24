#!/usr/bin/env node
/*
 * Memorizer's chunker: every word of the PDF is taught, once, in sections of a
 * teachable size, and a heading is never cut off from what it heads.
 *
 *   node tests/verify-memorizer-chunk-pure.js
 *
 * Pure Node, no browser, no build, no PDF. memorizer/src/chunk.js is shaped to
 * take lines rather than a PDF so that this can be true: every document here is
 * synthetic, generated from a seed, and every word in it is unique ("w00417"),
 * so coverage can be checked as exact sequence equality rather than as a word
 * count that a drop-one-duplicate-another bug would pass.
 *
 * THE THREE INVARIANTS (see chunk.js's header for why each matters):
 *   coverage · bounds · headings stay with their body
 * each held over two hundred random documents plus the shapes most likely to
 * break them: a heading every few words, a single sentence longer than a
 * cluster, headings landing exactly at the boundary.
 *
 * Also here, because nothing else scans memorizer/: the iPadOS 13.4 syntax
 * floor that tests/verify-ipad-pure.js holds src/ to.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'memorizer', 'src', 'chunk.js'));
const { CLUSTER_MIN: MIN, CLUSTER_MAX: MAX } = C;

/* mulberry32 — a seeded PRNG, so a failure names a seed that reproduces it. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* A document of blocks with globally unique words. opts shape the adversarial
   cases. Returns { blocks, words, headingEnds } where headingEnds are the
   global indices of each heading's last word that has body after it. */
function makeDoc(seed, opts = {}) {
  const r = rng(seed);
  let n = 0, page = 1;
  const word = () => 'w' + String(n++).padStart(5, '0');
  const blocks = [];
  const nBlocks = opts.blocks || 10 + Math.floor(r() * 40);
  for (let b = 0; b < nBlocks; b++) {
    if (r() < 0.15) page++;
    const isHeading = opts.headingEvery ? b % opts.headingEvery === 0 : r() < 0.2;
    if (opts.tables && !isHeading && r() < 0.2) {
      const cols = 2 + Math.floor(r() * 3), nRows = 3 + Math.floor(r() * 10);
      const rows = Array.from({ length: nRows }, () => Array.from({ length: cols }, () =>
        Array.from({ length: 1 + Math.floor(r() * 3) }, word).join(' ')));
      blocks.push({ text: rows.map(x => x.join(' ')).join(' '), page, heading: false, table: rows });
      continue;
    }
    if (isHeading) {
      const len = 1 + Math.floor(r() * 8);
      blocks.push({ text: Array.from({ length: len }, word).join(' '), page, heading: true });
    } else {
      const sentences = opts.giantSentence && b === 1 ? 1 : 1 + Math.floor(r() * 12);
      const parts = [];
      for (let s = 0; s < sentences; s++) {
        const len = opts.giantSentence && b === 1 ? opts.giantSentence : 3 + Math.floor(r() * (opts.longSentences ? 120 : 30));
        const ws = Array.from({ length: len }, word);
        ws[ws.length - 1] += '.';
        parts.push(ws.join(' '));
      }
      blocks.push({ text: parts.join(' '), page, heading: false });
    }
  }
  const words = [], kinds = [], rowOf = [];
  blocks.forEach((bl, bi) => {
    if (bl.table) bl.table.forEach((row, ri) => row.join(' ').split(/\s+/).filter(Boolean).forEach(w => { words.push(w); kinds.push(false); rowOf.push(bi + ':' + ri); }));
    else bl.text.split(/\s+/).forEach(w => { words.push(w); kinds.push(bl.heading); rowOf.push(null); });
  });
  const headingEnds = [];
  for (let i = 0; i < words.length - 1; i++) if (kinds[i] && !kinds[i + 1]) headingEnds.push(i);
  return { blocks, words, headingEnds, rowOf };
}

/* The invariants, as data rather than PASS lines, so one check can summarise
   hundreds of documents and still name the first seed that broke. */
function violations(doc, clusters) {
  const out = [];
  const got = [];
  const owner = [];
  clusters.forEach((c, ci) => c.text.split(/\s+/).filter(Boolean).forEach(w => { got.push(w); owner.push(ci); }));
  if (got.length !== doc.words.length || got.some((w, i) => w !== doc.words[i])) {
    const at = got.findIndex((w, i) => w !== doc.words[i]);
    out.push(`coverage: ${got.length} words out, ${doc.words.length} in, first difference at ${at}`);
  }
  clusters.forEach((c, i) => {
    if (c.words > MAX) out.push(`bounds: cluster ${i} has ${c.words} > ${MAX}`);
    if (i < clusters.length - 1 && c.words < MIN) out.push(`bounds: cluster ${i} of ${clusters.length} has ${c.words} < ${MIN}`);
    if (c.words !== c.text.split(/\s+/).filter(Boolean).length) out.push(`count: cluster ${i} says ${c.words} words`);
  });
  if (!out.some(v => v.startsWith('coverage'))) {
    /* A table row is never cut between two clusters. */
    const rowHome = {};
    (doc.rowOf || []).forEach((id, i) => {
      if (id == null) return;
      if (rowHome[id] == null) rowHome[id] = owner[i];
      else if (rowHome[id] !== owner[i]) out.push(`table: row ${id} is split between clusters ${rowHome[id]} and ${owner[i]}`);
    });
    doc.headingEnds.forEach(i => {
      if (owner[i] !== owner[i + 1]) out.push(`heading: word ${i} ends a heading in cluster ${owner[i]}, its body starts in ${owner[i + 1]}`);
    });
  }
  return out;
}

head('the documents are big enough to say something');
{
  const d = makeDoc(1, { blocks: 60 });
  const cs = C.clusterBlocks(d.blocks);
  /* Vacuity guard: a chunker returning one giant cluster, or none, passes
     coverage trivially in the first case and bounds trivially in the second. */
  ok('a 60-block document makes several clusters', cs.length >= 3, `${d.words.length} words → ${cs.length} clusters`);
  ok('and it has headings with body after them to hold to the heading rule', d.headingEnds.length >= 5, `${d.headingEnds.length}`);
}

head('the three invariants, over 200 random documents');
{
  const bad = [];
  let clusters = 0, words = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const d = makeDoc(seed);
    const cs = C.clusterBlocks(d.blocks);
    clusters += cs.length; words += d.words.length;
    const v = violations(d, cs);
    if (v.length) bad.push(`seed ${seed}: ${v[0]}`);
  }
  ok('every word taught exactly once, in order; every cluster in bounds; no heading stranded',
     bad.length === 0, bad.length ? `${bad.length} documents broke — ${bad[0]}` : `${words} words, ${clusters} clusters`);
}

head('the shapes most likely to break them');
{
  const cases = [
    ['a heading every second block', { headingEvery: 2, blocks: 120 }],
    ['a heading every block but one in three', { headingEvery: 3, blocks: 150 }],
    ['long sentences, so boundaries fall mid-sentence', { longSentences: true, blocks: 60 }],
    ['one sentence of 3000 words, longer than any cluster', { giantSentence: 3000, blocks: 8 }],
    ['one sentence of exactly MAX words', { giantSentence: MAX, blocks: 8 }],
    ['tables among the prose, rows never split', { tables: true, blocks: 60 }],
    ['tables right after headings', { tables: true, headingEvery: 2, blocks: 80 }],
  ];
  for (const [name, opts] of cases) {
    const bad = [];
    for (let seed = 1; seed <= 40; seed++) {
      const d = makeDoc(1000 + seed, opts);
      const v = violations(d, C.clusterBlocks(d.blocks));
      if (v.length) bad.push(`seed ${1000 + seed}: ${v[0]}`);
    }
    ok(name, bad.length === 0, bad[0] || '40 documents');
  }
  /* The two branches the random documents almost never reach, each built
     by hand. Both were found by the mutation run, not by reading: with the
     branch deleted, every check above stayed green. */
  const n = { i: 0 };
  const w = k => Array.from({ length: k }, () => 'x' + n.i++).join(' ');
  const sentenceOf = k => w(k) + '.';
  const ownerOf = cs => { const o = {}; cs.forEach((c, ci) => c.text.split(/\s+/).forEach(t => { o[t] = ci; })); return o; };

  /* 1. A heading pushes the cluster just past MIN, and the next sentence is
     too long to fit. Closing there would strand the heading, so the cluster
     must fill with the front of that sentence instead. */
  {
    const blocks = [];
    let total = 0;
    while (total + 30 <= MIN - 5) { blocks.push({ text: sentenceOf(30), page: 1, heading: false }); total += 30; }
    if (MIN - 5 - total) blocks.push({ text: sentenceOf(MIN - 5 - total), page: 1, heading: false });
    const hd = w(8);
    blocks.push({ text: hd, page: 1, heading: true });
    const body = sentenceOf(400);
    blocks.push({ text: body, page: 1, heading: false });
    const cs = C.clusterBlocks(blocks);
    const o = ownerOf(cs);
    const lastOfHeading = hd.split(' ').pop(), firstOfBody = body.split(' ')[0];
    ok('a heading just past MIN, then a sentence too long to fit: the heading keeps the start of its body',
       o[lastOfHeading] === o[firstOfBody], `heading in cluster ${o[lastOfHeading]}, body starts in ${o[firstOfBody]}`);
  }

  /* 2. With a MIN close to MAX, a heading can arrive while the cluster is
     still under MIN yet with no room for heading plus one word. It must open
     the next cluster: taken in, the cluster would sit at MAX with a heading
     last, and the fill that normally rescues that would have zero words to
     take. Unreachable at the default 600/900, hence the custom sizes. */
  {
    const opts = { min: 895, max: 900 };
    const blocks = [];
    let total = 0;
    while (total + 30 <= 890) { blocks.push({ text: sentenceOf(30), page: 1, heading: false }); total += 30; }
    if (890 - total) blocks.push({ text: sentenceOf(890 - total), page: 1, heading: false });
    const hd = w(10);
    blocks.push({ text: hd, page: 2, heading: true });
    const body = sentenceOf(40);
    blocks.push({ text: body, page: 2, heading: false });
    const cs = C.clusterBlocks(blocks, opts);
    const o = ownerOf(cs);
    ok('under MIN but with no room for a heading and a word of its body, the heading opens the next cluster',
       o[hd.split(' ').pop()] === o[body.split(' ')[0]] && cs.every(c => c.words > 0 && c.words <= opts.max),
       cs.map(c => c.words).join(' + '));
  }
}

head('what a cluster says about itself');
{
  const blocks = [
    { text: 'Heart failure', page: 3, heading: true },
    { text: Array.from({ length: 700 }, (_, i) => 'a' + i).join(' ') + '.', page: 3, heading: false },
    { text: Array.from({ length: 700 }, (_, i) => 'b' + i).join(' ') + '.', page: 4, heading: false },
  ];
  const cs = C.clusterBlocks(blocks);
  ok('a cluster that holds a heading is titled by it', cs[0].title === 'Heart failure', cs[0].title);
  ok('the next one, with none of its own, is titled as a continuation', cs[1] && cs[1].title === 'Heart failure (cont.)', cs[1] && cs[1].title);
  ok('its page range is the pages its words came from', cs[0].pageStart === 3 && cs[cs.length - 1].pageEnd === 4,
     cs.map(c => c.pageStart + '-' + c.pageEnd).join(', '));
  ok('its segments carry each page, so a prompt can mark [p.N]',
     cs.every(c => c.segments.every(s => typeof s.page === 'number')) && cs[0].segments[0].heading === true);
  ok('its gist is the start of its first sentence, not its heading', /^a0 a1/.test(cs[0].gist), cs[0].gist.slice(0, 20));
  const tail = C.clusterBlocks([
    { text: Array.from({ length: MIN + 50 }, (_, i) => 'c' + i).join(' ') + '.', page: 1, heading: false },
    { text: 'Short', page: 1, heading: true },
    { text: 'd0 d1 d2 d3 d4.', page: 1, heading: false },
  ]);
  ok('a short tail folds into the cluster before it when there is room', tail.length === 1, `${tail.length} clusters`);
  ok('an empty document makes no clusters, rather than one empty one', C.clusterBlocks([]).length === 0);
}

head('lines → blocks');
{
  const L = (text, size, y) => ({ text, size, y });
  /* Only the header and the page number recur. Everything else is on page 1
     alone: a body line repeated on most pages IS what a running header looks
     like, and the first version of this fixture had the rule eat it. */
  const letter = p => 'abcd'[p - 1];
  const pages = [1, 2, 3, 4].map(p => ({
    page: p,
    lines: [L('Cardiology Review \u00B7 Chapter 7', 9, 20)].concat(p === 1 ? [
      L('Valve disease', 18, 60),
      L('The aortic valve opens when LV pres-', 11, 80),
      L('sure exceeds aortic pressure.', 11, 94),
      L('A new paragraph begins after a gap.', 11, 140),
      L('A very large pull quote that goes on and on for many words and ends with a stop.', 18, 170),
    ] : [
      L('Prose that belongs to page ' + letter(p) + ' only.', 11, 60),
      L('And a second line of it, page ' + letter(p) + '.', 11, 74),
    ], [L(String(p), 9, 800)]),
  }));
  const { blocks } = C.blocksFromPages(pages);
  const texts = blocks.map(b => b.text);
  ok('a running header on every page is dropped', !texts.some(t => /Cardiology Review/.test(t)));
  ok('a bare page number is dropped', !texts.some(t => /^\d+$/.test(t)));
  ok('a word hyphenated across a line break is rejoined', texts.some(t => /LV pressure exceeds/.test(t)), texts.find(t => /LV/.test(t)));
  ok('a big short line is a heading', blocks.some(b => b.heading && b.text === 'Valve disease'));
  ok('a big line that is a sentence is body, not a heading', blocks.some(b => !b.heading && /pull quote/.test(b.text)));
  ok('a vertical gap starts a new paragraph',
     blocks.some(b => b.text === 'A new paragraph begins after a gap.'), texts.filter(t => /paragraph/.test(t)).join(' | '));
  ok('blocks keep their page', blocks.filter(b => b.heading)[0].page === 1);
  /* The header rule is a majority rule and must not eat a line that merely
     repeats twice in a long document. */
  /* The page-number rule on its own. Above, the running-line rule already
     removes "1".."4" — digits are normalised, so every page carries "#" — and
     the mutation run showed this rule could be deleted with nothing noticing.
     Two pages is below the running-line rule's minimum, so here it is alone. */
  const two = [1, 2].map(p => ({ page: p, lines: [L('Body text on page ' + 'ab'[p - 1] + '.', 11, 50), L(String(p + 40), 9, 800)] }));
  ok('a bare page number is dropped even where no running-line rule applies',
     !C.blocksFromPages(two).blocks.some(b => /^\d+$/.test(b.text)), C.blocksFromPages(two).blocks.map(b => b.text).join(' | '));
  /* Numbers normalise away, so a numeric body line reads the same on every
     page. What tells it from a header is that it is not at the same height
     each time. Found by the browser suite, whose first document of numbered
     words vanished entirely. */
  const table = [1, 2, 3, 4].map(p => ({ page: p, lines: [
    L('Running head', 9, 20),
    L('Dose ' + p + ' mg then ' + (p * 2) + ' mg.', 11, 100 + p * 37),
  ] }));
  const kept = C.blocksFromPages(table).blocks.filter(b => /^Dose/.test(b.text)).length;
  ok('a numeric line on every page, at a different height each time, is body — not a header', kept === 4, `${kept} of 4 kept`);
  const rare = [1, 2, 3, 4, 5, 6].map(p => ({ page: p, lines: [L(p <= 2 ? 'Twice only' : 'x' + p, 11, 50)] }));
  ok('a line on only two of six pages is kept', C.blocksFromPages(rare).blocks.some(b => b.text === 'Twice only'));
}

head('tables: found by their columns, kept whole');
{
  /* Lines as memorizer/src/pdf.js produces them: text, plus cells where the
     gaps between runs are wide. */
  const row = (y, cells) => ({ text: cells.map(c => c[1]).join(' '), size: 11, y, cells: cells.map(([x, text]) => ({ x, text })) });
  const tablePage = { page: 3, lines: [
    { text: 'Normal values are given below.', size: 11, y: 60 },
    row(80, [[72, 'Measure'], [220, 'Normal'], [360, 'Unit']]),
    row(94, [[72, 'LVEDP'], [220, '< 12'], [360, 'mmHg']]),
    row(108, [[72, 'Cardiac index'], [360, 'L/min/m2']]),
    row(122, [[73, 'Stroke volume'], [221, '60-100'], [359, 'mL']]),
    { text: 'The body resumes after the table.', size: 11, y: 150 },
  ] };
  const { blocks } = C.blocksFromPages([tablePage]);
  const t = blocks.find(b => b.table);
  ok('four aligned lines of cells become one table block', !!t && t.table.length === 4, t && JSON.stringify(t.table));
  ok('with the header as its first row', t && JSON.stringify(t.table[0]) === '["Measure","Normal","Unit"]');
  ok('a row with an empty cell keeps its other cells in their own columns',
     t && JSON.stringify(t.table[2]) === '["Cardiac index","","L/min/m2"]', t && JSON.stringify(t.table[2]));
  ok('cells a pixel or two off their column still land in it', t && JSON.stringify(t.table[3]) === '["Stroke volume","60-100","mL"]');
  ok('the prose before and after is not swallowed into it',
     blocks.some(b => !b.table && /Normal values/.test(b.text)) && blocks.some(b => !b.table && /resumes after/.test(b.text)));
  ok('its words are exactly its lines\u2019 words, in order',
     t && t.text === tablePage.lines.slice(1, 5).map(l => l.text).join(' '), t && t.text);
  const two = { page: 1, lines: [row(80, [[72, 'a'], [220, 'b']]), row(94, [[72, 'c'], [220, 'd']]), { text: 'Prose.', size: 11, y: 120 }] };
  ok(`fewer than ${C.TABLE_MIN_ROWS} rows is not a table`, !C.blocksFromPages([two]).blocks.some(b => b.table));
  const skew = { page: 1, lines: [row(80, [[72, 'a'], [220, 'b']]), row(94, [[140, 'c'], [300, 'd']]), row(108, [[10, 'e'], [400, 'f']])] };
  ok('lines whose columns do not line up are not a table', !C.blocksFromPages([skew]).blocks.some(b => b.table));

  const cs = C.clusterBlocks(blocks);
  const seg = cs[0].segments.find(g => g.table);
  ok('a cluster holding a table carries its rows, for drawing it', seg && seg.table.length === 4);
  /* A table too long for one cluster continues in the next, with its header
     shown again there — for display only, not counted twice. */
  const longRows = [['Drug', 'Dose']].concat(Array.from({ length: 120 }, (_, i) => ['drug' + i + ' name', 'dose' + i + ' mg daily']));
  const big = C.clusterBlocks([{ text: longRows.map(r => r.join(' ')).join(' '), page: 1, heading: false, table: longRows }]);
  const parts = big.map(c => c.segments.find(g => g.table)).filter(Boolean);
  ok('a table too long for one cluster is split between rows', big.length >= 2 && parts.length === big.length,
     `${big.length} clusters`);
  ok('and every part after the first shows the header again', parts.slice(1).every(g => JSON.stringify(g.tableHeader) === '["Drug","Dose"]'));
  /* The one case where a row is at risk: a heading taken in with the
     cluster nearly full, and its table's first row cannot fit. At the default
     250..450 it cannot happen — a heading arriving at or over MIN always
     opens a new cluster — so, as with the heading test above, it is reached
     with a MIN close to MAX. The first two versions of this fixture used the
     defaults and passed with both rules deleted; that is how this was found. */
  {
    const nn = { i: 0 };
    const ws = k => Array.from({ length: k }, () => 'p' + nn.i++).join(' ');
    const blks = [];
    let tot = 0;
    const O = { min: 440, max: 450 };
    while (tot + 30 <= 436) { blks.push({ text: ws(30) + '.', page: 1, heading: false }); tot += 30; }
    if (436 - tot) blks.push({ text: ws(436 - tot) + '.', page: 1, heading: false });
    blks.push({ text: 'Dose table', page: 1, heading: true });
    const trows = [['Drug name written here in full', 'Dose in milligrams per day', 'Route of giving it to them']].concat(Array.from({ length: 5 }, (_, i) => ['d' + i + ' x y z', 'e' + i + ' x y z', 'f' + i + ' x y z']));
    blks.push({ text: trows.map(r => r.join(' ')).join(' '), page: 1, heading: false, table: trows });
    const out = C.clusterBlocks(blks, O);
    const own = {};
    out.forEach((c, ci) => c.text.split(/\s+/).forEach(w => { (own[w] = own[w] || []).push(ci); }));
    const firstRow = trows[0].join(' ').split(' ');
    ok('a table row that does not fit moves whole to the next cluster, never cut',
       firstRow.every(w => own[w] && own[w][0] === own[firstRow[0]][0]), firstRow.map(w => w + ':' + own[w]).join(' '));
    ok('and the heading above it moves with it', own['Dose'] && own['Dose'][0] === own[firstRow[0]][0],
       `heading in ${own['Dose']}, table in ${own[firstRow[0]]}`);
  }
  ok('without counting the header\u2019s words twice', big.reduce((n, c) => n + c.words, 0) === longRows.reduce((n, r) => n + r.join(' ').split(' ').length, 0));
}

head('lists: found by their shape, bullets or not');
{
  const L = (text, x, y) => ({ text, size: 11, y, cells: [{ x, text }] });
  /* Table 17.1 of the owner's PDF, as its lines arrived: bullets drawn as
     graphics (so no glyph), sub-headings set left of the items. */
  const page = { page: 2, lines: [
    L('A. Etiology. Table 17.1 lists the causes of TS.', 72, 60),
    L('Congenital', 80, 80),
    L('Tricuspid atresia', 90, 94),
    L('Atypical Ebstein anomaly (more likely to cause TR)', 90, 108),
    L('Acquired', 80, 122),
    L('Rheumatic', 90, 136),
    L('Infective endocarditis', 90, 150),
    L('Malignancy (eg, myxoma and metastases)\u2014Usually cause', 90, 164),
    L('functional TS', 92, 178),
    L('Whipple disease', 90, 192),
    L('1. Rheumatic heart disease (RHD) is the most common cause of TS, accounting for more than ninety percent of cases.', 72, 220),
  ] };
  const bl = C.blocksFromPages([page]).blocks;
  const items = bl.filter(b => b.item);
  ok('a bullet-less list is found by its shape', items.length === 8, items.map(b => (b.sub ? '[' + b.text + ']' : b.text)).join(' | '));
  ok('lines set left of the items are its sub-headings', items.filter(b => b.sub).map(b => b.text).join() === 'Congenital,Acquired');
  ok('a wrapped item is rejoined', items.some(b => b.text === 'Malignancy (eg, myxoma and metastases)\u2014Usually cause functional TS'));
  ok('the prose before and after is not taken into it', !items.some(b => /Etiology|most common/.test(b.text)));
  ok('all its items share a list id', new Set(items.map(b => b.list)).size === 1);
  const glyphs = { page: 1, lines: [L('\u2022 Dyspnoea', 90, 80), L('\u2022 Oedema', 90, 94), L('\u2022 Fatigue', 90, 108)] };
  const gb = C.blocksFromPages([glyphs]).blocks;
  ok('a bulleted list of three is found, and the bullet glyph dropped', gb.length === 3 && gb.every(b => b.item) && gb[0].text === 'Dyspnoea', gb.map(b => b.text).join(' | '));
  const prose = { page: 1, lines: [L('The tricuspid valve apparatus is generally considered to consist', 72, 80),
    L('of three leaflets along with the annulus and the chordae tendineae', 72, 94), L('Short line.', 72, 108), L('Another', 72, 122)] };
  ok('ordinary prose is not a list', !C.blocksFromPages([prose]).blocks.some(b => b.item));
  const two = { page: 1, lines: [L('\u2022 One thing', 90, 80), L('\u2022 Another thing', 90, 94), L('Then the prose resumes here and goes on for a good many words.', 72, 108)] };
  ok('two bullets are not yet a list', !C.blocksFromPages([two]).blocks.some(b => b.item));
  const cs = C.clusterBlocks(bl);
  const segs = cs[0].segments.filter(g => g.item);
  ok('a cluster\u2019s segments say which are list items, and which sub-headings', segs.length === 8 && segs.filter(g => g.sub).length === 2);
}

head('two columns written line by line are read column by column');
{
  /* How pdf.js hands back a page whose PDF writes both columns on each line:
     one line per height, two far-apart cells. Measured with the real
     pdf.js; the browser suite repeats it end to end. */
  const two = (y, l, r) => ({ text: l + ' ' + r, size: 10, y, cells: [{ x: 72, text: l }, { x: 320, text: r }] });
  const one = (y, x, t, size = 10) => ({ text: t, size, y, cells: [{ x, text: t }] });
  const page = { page: 1, lines: [
    one(40, 72, 'Two Column Heading', 18),
    two(70, 'Left column starts here and', 'Right column starts here and'),
    two(84, 'the left sentence ends now.', 'the right sentence ends now.'),
    two(98, 'Another left sentence runs on', 'Another right sentence runs on'),
    two(112, 'and stops at this point.', 'and it stops at this point.'),
    one(126, 72, 'The left column is longer.'),
    one(140, 320, 'So is the right, lower down.'),
  ] };
  const bl = C.blocksFromPages([page]).blocks;
  ok('it is not taken for a table', !bl.some(b => b.table), bl.map(b => (b.table ? 'T:' : b.heading ? 'H:' : 'P:') + b.text.slice(0, 30)).join(' | '));
  const text = bl.map(b => b.text).join(' ');
  ok('the left column is read whole, then the right',
     /^Two Column Heading Left column starts here and the left sentence ends now\. Another left sentence runs on and stops at this point\. The left column is longer\. Right column starts here/.test(text), text);
  ok('a line with only a right-hand cell goes to the right column', /right sentence runs on and it stops at this point\. So is the right, lower down\.$/.test(text), text.slice(-80));
  const after = { page: 1, lines: page.lines.concat([one(190, 72, 'A closing paragraph across the page, after a gap.')]) };
  const afterText = C.blocksFromPages([after]).blocks.map(b => b.text).join(' ');
  ok('the region ends at a larger gap: what follows stays after both columns', /lower down\. A closing paragraph across the page, after a gap\.$/.test(afterText), afterText.slice(-90));
  /* A note at the top of the page, set at the right column's x, above the
     heading: it is before the columns and must stay there. */
  const noted = { page: 1, lines: [one(20, 320, 'Page note set at the right.')].concat(page.lines) };
  const notedText = C.blocksFromPages([noted]).blocks.map(b => b.text).join(' ');
  ok('what comes before the columns stays before them', /^Page note set at the right\. Two Column Heading Left column/.test(notedText), notedText.slice(0, 80));
  const inWords = page.lines.map(l => l.text).join(' ').split(/\s+/).sort();
  ok('every word is kept, only reordered', JSON.stringify(text.split(/\s+/).sort()) === JSON.stringify(inWords));
  /* A two-column table of short cells is still a table. */
  const tbl = { page: 1, lines: [two(60, 'Drug', 'Dose'), two(74, 'Digoxin', '0.125 mg'), two(88, 'Furosemide', '40 mg'), two(102, 'Bisoprolol', '5 mg')] };
  ok('a two-column table of short cells is still a table', C.blocksFromPages([tbl]).blocks.some(b => b.table && b.table.length === 4));
  /* A literal two, not COLUMN_MIN_ROWS - 1: a fixture sized by the constant
     it tests moves with it, and passes whatever the constant says. */
  const few = page.lines.slice(0, 3);
  ok('two lines of paired prose are left as they are — three make columns', C.columnsOf(few) === few && C.columnsOf(page.lines.slice(0, 4)) !== page.lines.slice(0, 4));
  const skew = [two(70, 'one two three four', 'five six seven eight'), two(84, 'one two three four', 'five six seven eight'),
    two(98, 'one two three four', 'five six seven eight')].map((l, i) => Object.assign(l, { cells: [l.cells[0], { x: 200 + i * 60, text: l.cells[1].text }] }));
  ok('pairs whose second cells do not line up are not columns', C.columnsOf(skew) === skew);
}

head('outline headings: found by their number, not their font');
{
  const L = (text, y, size = 11) => ({ text, size, y, cells: [{ x: 72, text }] });
  /* The owner's first PDF set every sub-heading at body size, run into its
     paragraph: "A. Etiology. Table 17.1 lists …". */
  const page = { page: 4, lines: [
    L('Tricuspid Stenosis', 40, 18),
    L('A. Etiology. Table 17.1 lists the causes of TS and how often each is seen.', 60),
    L('Rheumatic disease accounts for nearly all of them in adults.', 74),
    L('B. Pathophysiology', 100),
    L('The gradient across the valve rises with flow and with heart rate.', 114),
    L('17.2 Clinical features', 140),
    L('Fatigue and oedema dominate, as described by Braunwald and', 154),
    L('C. Libby. Later work showed the same pattern in children.', 168),
    L('1. Rheumatic heart disease (RHD) is the most common cause of TS in adults.', 190),
    L('2. Carcinoid syndrome', 204),
    L('It is rarer, and it thickens both right-sided valves.', 218),
  ] };
  const bl = C.blocksFromPages([page]).blocks;
  const heads = bl.filter(b => b.heading);
  ok('a run-in heading is split from its paragraph', bl.some(b => b.heading && b.minor && b.text === 'A. Etiology.') &&
     bl.some(b => !b.heading && /^Table 17\.1 lists the causes/.test(b.text)), heads.map(b => b.text).join(' | '));
  ok('a lettered heading on a line of its own is a heading', heads.some(b => b.minor && b.text === 'B. Pathophysiology'));
  ok('so is a dotted section number', heads.some(b => b.minor && b.text === '17.2 Clinical features'));
  ok('a size-set heading is not an outline heading', heads.some(b => !b.minor && b.text === 'Tricuspid Stenosis'));
  ok('an initial at the start of a wrapped line, mid-sentence, is not a heading', !heads.some(b => /Libby/.test(b.text)) &&
     bl.some(b => /Braunwald and C\. Libby\. Later work/.test(b.text)));
  ok('a numbered paragraph, or a lone numbered item, is not a heading', !heads.some(b => /^\d\./.test(b.text)), heads.map(b => b.text).join(' | '));
  const inWords = page.lines.map(l => l.text).join(' ').split(/\s+/);
  const outWords = bl.map(b => b.text).join(' ').split(/\s+/);
  ok('every word of the page is still there, in order', JSON.stringify(inWords) === JSON.stringify(outWords),
     `${outWords.length} of ${inWords.length}`);
  const big = { page: 1, lines: [L('17.2 Tricuspid Stenosis', 40, 18), L('Body text here, long enough to be prose.', 60)] };
  ok('a numbered heading in a big font is a size-set heading', C.blocksFromPages([big]).blocks.some(b => b.heading && !b.minor && b.text === '17.2 Tricuspid Stenosis'));
  const n = { i: 0 };
  const para = k => ({ text: Array.from({ length: k }, () => 'q' + n.i++).join(' ') + '.', page: 1, heading: false });
  const cs = C.clusterBlocks([
    { text: 'Tricuspid Stenosis', page: 1, heading: true },
    { text: 'A. Etiology.', page: 1, heading: true, minor: true }, para(300),
    { text: 'B. Pathophysiology', page: 1, heading: true, minor: true }, para(300), para(300),
    { text: 'Tricuspid Regurgitation', page: 2, heading: true },
    { text: 'A. Etiology.', page: 2, heading: true, minor: true }, para(300),
  ]);
  const titles = cs.map(c => c.title);
  ok('a section opening at an outline heading is titled under the heading above it',
     titles[1] === 'Tricuspid Stenosis: Pathophysiology', titles.join(' | '));
  ok('its continuation says so', titles[2] === 'Tricuspid Stenosis: Pathophysiology (cont.)', titles.join(' | '));
  ok('and the next size-set heading takes over', titles[3] === 'Tricuspid Regurgitation', titles.join(' | '));
  const two = C.clusterBlocks([
    { text: 'Tricuspid Stenosis', page: 1, heading: true }, para(300),
    { text: 'A. Etiology.', page: 1, heading: true, minor: true }, para(300),
    { text: 'Tricuspid Regurgitation', page: 2, heading: true }, para(300),
    { text: 'A. Etiology.', page: 2, heading: true, minor: true }, para(300),
  ]).map(c => c.title);
  ok('so two "Etiology" sections are told apart', two[1] === 'Tricuspid Stenosis: Etiology' && two[3] === 'Tricuspid Regurgitation: Etiology', two.join(' | '));
  const alone = C.clusterBlocks([{ text: 'C. Management', page: 1, heading: true, minor: true }, para(40)]);
  ok('an outline heading with nothing above it is titled by its label alone', alone[0].title === 'Management', alone[0].title);
}

head('the pdf.js adapter: cells and figure boxes');
{
  /* memorizer/src/pdf.js is the one file that talks to pdf.js, and these two
     functions of it are pure: they take what pdf.js returns and decide. */
  const Pdf = require(path.join(ROOT, 'memorizer', 'src', 'pdf.js'));
  const item = (str, x, y, size, width) => ({ str, transform: [size, 0, 0, size, x, y], width });
  const lines = Pdf.linesOf([
    item('Measure', 72, 700, 11, 40), item('Normal', 220, 700, 11, 34), item('Unit', 360, 700, 11, 22),
    item('A sentence of', 72, 680, 11, 66), item('prose here.', 142, 680, 11, 50),
  ], 792);
  ok('runs on one line far apart become separate cells', lines[0].cells.length === 3 &&
     JSON.stringify(lines[0].cells.map(c => c.text)) === '["Measure","Normal","Unit"]', JSON.stringify(lines[0].cells));
  ok('runs close together stay one cell, so prose is one cell', lines[1].cells.length === 1 && lines[1].cells[0].text === 'A sentence of prose here.',
     JSON.stringify(lines[1].cells));
  ok('and the line text is unchanged by it', lines[0].text === 'Measure Normal Unit' && lines[1].text === 'A sentence of prose here.');
  ok('cells keep their x, for lining up columns', lines[0].cells[1].x === 220);

  const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 85, paintInlineImageXObject: 86 };
  const view = [0, 0, 612, 792];
  const ops = (list) => ({ fnArray: list.map(x => x[0]), argsArray: list.map(x => x[1] || null) });
  const one = Pdf.figureBoxes(ops([[10], [12, [200, 0, 0, 100, 72, 400]], [85, ['img1']], [11]]), OPS, view);
  ok('a picture drawn at 200×100 from (72, 400) is found there', JSON.stringify(one) === '[[72,400,272,500]]', JSON.stringify(one));
  const nested = Pdf.figureBoxes(ops([[12, [1, 0, 0, 1, 50, 50]], [10], [12, [300, 0, 0, 150, 0, 0]], [86, ['x']], [11], [85, ['tiny']]]), OPS, view);
  ok('transforms compose, and restore undoes one', nested.length === 1 && JSON.stringify(nested[0]) === '[50,50,350,200]', JSON.stringify(nested));
  const small = Pdf.figureBoxes(ops([[12, [20, 0, 0, 20, 10, 10]], [85, ['logo']]]), OPS, view);
  ok('a tiny picture (a logo, a bullet) is not a figure', small.length === 0, JSON.stringify(small));
}

head('text from a real PDF: spaces where the page has them, and nowhere else');
{
  const Pdf = require(path.join(ROOT, 'memorizer', 'src', 'pdf.js'));
  const item = (str, x, y, size, width) => ({ str, transform: [size, 0, 0, size, x, y], width });
  const line = items => Pdf.linesOf(items, 792)[0].text;
  /* The owner's first real PDF came out as "C H A P T E R 1 7 T r i c u s p i d"
     and "regur gitation": runs were joined with a space regardless of the gap. */
  const tracked = [];
  let x = 72;
  /* Tracked wide: a 2.5pt gap between letters is over the plain threshold
     (0.15 × 11pt), so only the line's own letter gap tells letters from words. */
  'CHAPTER'.split('').forEach(ch => { tracked.push(item(ch, x, 700, 11, 7)); x += 9.5; });
  x += 8;
  '17'.split('').forEach(ch => { tracked.push(item(ch, x, 700, 11, 7)); x += 9.5; });
  ok('a letter-spaced heading reads as words, not letters', line(tracked) === 'CHAPTER 17', line(tracked));
  ok('a kerned capital joins its word ("T" + "ricuspid")', line([item('T', 72, 700, 11, 6), item('ricuspid', 77.6, 700, 11, 40)]) === 'Tricuspid');
  ok('a word stored in two pieces is one word ("regur" + "gitation")', line([item('regur', 72, 700, 11, 26), item('gitation', 98.3, 700, 11, 38)]) === 'regurgitation');
  ok('a real space between words is kept', line([item('valve', 72, 700, 11, 26), item('disease', 101, 700, 11, 36)]) === 'valve disease');
  ok('and a run that carries its own space gets no second one', line([item('valve ', 72, 700, 11, 29), item('disease', 101, 700, 11, 36)]) === 'valve disease');
}

head('figures: pictures, not highlighted text');
{
  const Pdf = require(path.join(ROOT, 'memorizer', 'src', 'pdf.js'));
  const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 85, paintInlineImageXObject: 86, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
  const view = [0, 0, 612, 792];
  const ops = list => ({ fnArray: list.map(x => x[0]), argsArray: list.map(x => x[1] || null) });
  const img = (a, b, c, d) => [[10], [12, [c - a, 0, 0, d - b, a, b]], [85, ['i']], [11]];
  /* A form XObject's own matrix moves everything painted inside it. */
  const inForm = Pdf.figureBoxes(ops([[74, [[1, 0, 0, 1, 100, 200], [0, 0, 1, 1]]]].concat(img(0, 0, 200, 120), [[75]])), OPS, view, []);
  ok('a picture inside a form is placed by the form\u2019s matrix', JSON.stringify(inForm) === '[[100,200,300,320]]', JSON.stringify(inForm));
  const textBox = (x0, y0, x1, y1, step) => { const out = []; for (let y = y0; y < y1; y += step) out.push([x0, y, x1, y + 10]); return out; };
  const underText = Pdf.figureBoxes(ops(img(72, 400, 400, 520)), OPS, view, textBox(72, 400, 400, 520, 13));
  ok('an image under a column of text (a highlight, a shaded box) is not a figure', underText.length === 0, JSON.stringify(underText));
  const labelled = Pdf.figureBoxes(ops(img(72, 400, 400, 620)), OPS, view, [[80, 410, 140, 420], [300, 600, 360, 610]]);
  ok('a picture with a couple of labels on it still is', labelled.length === 1, JSON.stringify(labelled));
  /* Tall enough and big enough to pass the size rule, so only its shape rejects it. */
  ok('a strip (a coloured bar) is not a figure', Pdf.figureBoxes(ops(img(20, 400, 590, 440)), OPS, view, []).length === 0);
  ok('a page-sized image (a scan, a background) is not a figure', Pdf.figureBoxes(ops(img(0, 0, 612, 792)), OPS, view, []).length === 0);
  const tiles = Pdf.figureBoxes(ops(img(72, 400, 200, 500).concat(img(200, 400, 330, 500), img(72, 500, 330, 580))), OPS, view, []);
  ok('touching tiles of one picture are one figure', tiles.length === 1 && JSON.stringify(tiles[0]) === '[72,400,330,580]', JSON.stringify(tiles));
  ok('two separate pictures stay two', Pdf.figureBoxes(ops(img(72, 100, 250, 250).concat(img(320, 500, 540, 700))), OPS, view, []).length === 2);
  const tb = Pdf.textBoxesOf([{ str: 'Hello', width: 30, transform: [10, 0, 0, 10, 72, 700] }, { str: ' ', width: 3, transform: [10, 0, 0, 10, 102, 700] }]);
  ok('text boxes come from runs with text, in PDF units', tb.length === 1 && tb[0][0] === 72 && tb[0][2] === 102 && tb[0][1] < 700 && tb[0][3] > 700);
}

head('figures drawn as lines, not pictures');
{
  const Pdf = require(path.join(ROOT, 'memorizer', 'src', 'pdf.js'));
  /* pdf.js 3.11's own numbers for these operators (src/shared/util.js OPS). */
  const OPS = { save: 10, restore: 11, transform: 12, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19,
                stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24,
                endPath: 28, clip: 29, paintImageXObject: 85, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, constructPath: 91 };
  const view = [0, 0, 612, 792];
  const ops = list => ({ fnArray: list.map(x => x[0]), argsArray: list.map(x => x[1] || null) });
  /* A painted path as pdf.js lists it: [ops, their numbers, the bounds pdf.js
     kept — [minX, maxX, minY, maxY], from moveTo, lineTo and rectangle only]. */
  const line = (x0, y0, x1, y1, paint = 20) => [[91, [[13, 14], [x0, y0, x1, y1], [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]]], [paint]];
  const bar = (x, y, w, h) => [[91, [[19], [x, y, w, h], [x, x + w, y, y + h]]], [22]];
  /* A bar chart: two axes and eight bars, from (100,300) to (400,500). */
  const chart = [].concat(line(100, 300, 400, 300), line(100, 300, 100, 500),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => bar(110 + i * 36, 300, 24, 40 + i * 20)));
  const found = Pdf.figureBoxes(ops(chart), OPS, view, []);
  ok('a chart drawn as lines and bars is a figure, boxed where it was drawn', JSON.stringify(found) === '[[100,300,400,500]]', JSON.stringify(found));
  ok(`fewer than ${Pdf.VECTOR_MIN_PATHS} paths — a frame, a box round a callout — is not`,
     Pdf.figureBoxes(ops([].concat(line(100, 300, 400, 300), line(100, 300, 100, 500), bar(120, 300, 200, 150))), OPS, view, []).length === 0);
  /* Painted axes, and eight bars that are only clipping paths: counted, the
     bars would join the axes and make ten paths — a figure. */
  const clipped = Pdf.figureBoxes(ops([].concat(line(100, 300, 400, 300), line(100, 300, 100, 500),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => [[91, [[19], [110 + i * 36, 300, 24, 100], [110 + i * 36, 134 + i * 36, 300, 400]]], [29], [28]]))), OPS, view, []);
  ok('clipping paths draw nothing, and are not counted', clipped.length === 0, JSON.stringify(clipped));
  const moved = Pdf.figureBoxes(ops([[10], [12, [1, 0, 0, 1, 50, -100]]].concat(chart, [[11]])), OPS, view, []);
  ok('a drawing is placed by the transform in force', JSON.stringify(moved) === '[[150,200,450,400]]', JSON.stringify(moved));
  const framed = Pdf.figureBoxes(ops([[91, [[19], [20, 20, 572, 752], [20, 592, 20, 772]]], [20]].concat(chart)), OPS, view, []);
  ok('a border round the whole page is not merged into what it frames', JSON.stringify(framed) === '[[100,300,400,500]]', JSON.stringify(framed));
  const textBox = (x0, y0, x1, y1, step) => { const out = []; for (let y = y0; y < y1; y += step) out.push([x0, y, x1, y + 10]); return out; };
  ok('ruled lines under a column of text (a table, a form) are not a figure',
     Pdf.figureBoxes(ops(chart), OPS, view, textBox(100, 300, 400, 500, 13)).length === 0);
  const withPic = Pdf.figureBoxes(ops([[10], [12, [200, 0, 0, 150, 150, 320]], [85, ['i']], [11]].concat(chart)), OPS, view, []);
  ok('axes drawn over a picture are part of it: one figure', JSON.stringify(withPic) === '[[100,300,400,500]]', JSON.stringify(withPic));
  /* A pie chart drawn in curves alone: a circle of four Béziers round
     (300,400), radius 100, and five wedges — centre, a line out, an arc
     back — whose edges stop short of the circle's top, left and bottom.
     pdf.js's own bounds give the circle as the one point it starts from, so
     only the curves' points can reach 200, 300 and 500; every control point
     of a circle drawn this way lies on its bounding square, so the square is
     exactly what should come back. */
  const K = 55.23;
  const circle = [[91, [[13, 15, 15, 15, 15], [400, 400, 400, 400 + K, 300 + K, 500, 300, 500, 300 - K, 500, 200, 400 + K, 200, 400,
    200, 400 - K, 300 - K, 300, 300, 300, 300 + K, 300, 400, 400 - K, 400, 400], [400, 400, 400, 400]]], [20]];
  const pts = [30, 100, 170, 250, 320, 390].map(a => [+(300 + 100 * Math.cos(a * Math.PI / 180)).toFixed(1), +(400 + 100 * Math.sin(a * Math.PI / 180)).toFixed(1)]);
  const wedges = [0, 1, 2, 3, 4].map(i => [[91, [[13, 14, 15, 18], [300, 400, pts[i][0], pts[i][1], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 1][0], pts[i + 1][1]],
    [Math.min(300, pts[i][0]), Math.max(300, pts[i][0]), Math.min(400, pts[i][1]), Math.max(400, pts[i][1])]]], [22]]);
  const pie = Pdf.figureBoxes(ops([].concat(circle, ...wedges)), OPS, view, []);
  /* A ruled table: a frame, two column rules and four row rules round
     (100,520)-(400,720), with sparse text — three short rows of two cells,
     far under the text-cover limit. linesOf's lines: y DOWN a 792 page, so
     a row with its baseline at 690 has y 102 — well outside 520..720 if
     anyone forgets to flip it. */
  const ruled = [].concat(line(100, 520, 400, 520), line(100, 720, 400, 720), line(100, 520, 100, 720), line(400, 520, 400, 720),
    line(200, 520, 200, 720), line(300, 520, 300, 720), ...[560, 600, 640, 680].map(y => line(100, y, 400, y)));
  const cellsAt = (baseline, xs) => ({ text: xs.map(() => 'v').join(' '), y: 792 - baseline, size: 10, cells: xs.map(x => ({ x, text: 'v' })) });
  const tableLines = [cellsAt(690, [110, 210]), cellsAt(650, [110, 210]), cellsAt(610, [110, 310])];
  const sparse = tableLines.map(l => [l.cells[0].x, 792 - l.y - 2, l.cells[0].x + 10, 792 - l.y + 8]);
  ok('the sparse table is under the text-cover limit, so only its rows can tell it from a chart',
     Pdf.figureBoxes(ops(ruled), OPS, view, sparse).length === 1);
  ok(`a ruled table — ${Pdf.TABLE_ROWS} or more lines of cells inside the lines — is not a figure`,
     Pdf.figureBoxes(ops(ruled), OPS, view, sparse, tableLines).length === 0);
  /* Inside the chart's box: a row of tick labels just over its axis, a
     two-part legend near its top — two lines of cells, not three — and
     three y-axis labels. */
  const ticks = [cellsAt(305, [100, 160, 220, 280, 340, 400]), cellsAt(480, [300, 360]),
    /* and the y axis's labels: one cell each, so not rows of columns */
    cellsAt(350, [104]), cellsAt(400, [104]), cellsAt(450, [104])];
  ok('a chart with a row of tick labels and a two-part legend still is',
     JSON.stringify(Pdf.figureBoxes(ops(chart), OPS, view, [], ticks)) === '[[100,300,400,500]]', JSON.stringify(Pdf.figureBoxes(ops(chart), OPS, view, [], ticks)));
  ok('rows of cells elsewhere on the page do not count against it',
     Pdf.figureBoxes(ops(ruled), OPS, view, sparse, tableLines.map(l => Object.assign({}, l, { y: l.y + 400 }))).length === 1);
  ok('a pie chart drawn only in curves is found, boxed by its circle', JSON.stringify(pie) === '[[200,300,400,500]]', JSON.stringify(pie));
  /* A curve's box is the curve's own, checked against the curve itself —
     sampled at 2001 points — not against the formula that computes it. */
  const bez = (p0, p1, p2, p3) => { const out = []; for (let k = 0; k <= 2000; k++) { const t = k / 2000, u = 1 - t;
    out.push([0, 1].map(j => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j])); } return out; };
  const boxOf = ptsList => [Math.min(...ptsList.map(p => p[0])), Math.min(...ptsList.map(p => p[1])), Math.max(...ptsList.map(p => p[0])), Math.max(...ptsList.map(p => p[1]))];
  const near = (a, b) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 0.05);
  /* A wave: controls at y 90 and -60, the curve itself peaks far lower. */
  const wave = Pdf.pathBounds([13, 15], [0, 0, 30, 90, 70, -60, 100, 0], OPS);
  const waveTrue = boxOf(bez([0, 0], [30, 90], [70, -60], [100, 0]));
  ok('a curve’s box is the curve, not the hull of its control points', near(wave, waveTrue) && wave[3] < 60,
     JSON.stringify(wave) + ' want ' + JSON.stringify(waveTrue.map(v => +v.toFixed(2))));
  /* "v": the current point is the first control; "y": the end point is the second. */
  /* The same two points given to "v" and to "y" make different curves —
     read one as the other and the box moves. */
  const vForm = Pdf.pathBounds([13, 16], [0, 0, 20, 80, 100, -10], OPS);
  const yForm = Pdf.pathBounds([13, 17], [0, 0, 20, 80, 100, -10], OPS);
  const vTrue = boxOf(bez([0, 0], [0, 0], [20, 80], [100, -10])), yTrue = boxOf(bez([0, 0], [20, 80], [100, -10], [100, -10]));
  ok('the fixture can tell "v" from "y"', !near(vTrue, yTrue), JSON.stringify(vTrue) + ' / ' + JSON.stringify(yTrue));
  ok('a "v" curve takes the point it starts from as its first control', near(vForm, vTrue), JSON.stringify(vForm));
  ok('a "y" curve takes its end point as its second control', near(yForm, yTrue), JSON.stringify(yForm));
  /* Two curves in a row: a straight run to (100,0), then a loop back that
     swings out past x 100 only because it starts there — started from the
     path's first point instead, it would stay inside. */
  const two = Pdf.pathBounds([13, 15, 15], [0, 0, 0, 0, 100, 0, 100, 0, 150, 100, -50, 100, 50, 0], OPS);
  const twoTrue = boxOf(bez([0, 0], [0, 0], [100, 0], [100, 0]).concat(bez([100, 0], [150, 100], [-50, 100], [50, 0])));
  ok('each curve starts where the one before it ended', near(two, twoTrue), JSON.stringify(two) + ' want ' + JSON.stringify(twoTrue));
  /* After closePath the pen is back at the subpath's start, (0,0), so the
     next curve starts there — not at (50,50) where the line ended. */
  const closed = Pdf.pathBounds([13, 14, 18, 15], [0, 0, 50, 50, -40, 0, -40, 0, 0, 0], OPS);
  ok('after closePath a curve starts from where the subpath began', near(closed, [-30, 0, 50, 50]), JSON.stringify(closed));
  ok('a rectangle\u2019s box is both its corners, whichever way its size runs',
     JSON.stringify(Pdf.pathBounds([19], [10, 20, 30, -5], OPS)) === '[10,15,40,20]', JSON.stringify(Pdf.pathBounds([19], [10, 20, 30, -5], OPS)));
  ok('a path with an operator it does not know is left out, not guessed at', Pdf.pathBounds([13, 99], [0, 0, 5], OPS) === null);
}

head('figures: captions, and the sections that name them');
{
  const Pdf = require(path.join(ROOT, 'memorizer', 'src', 'pdf.js'));
  const H = 792;
  /* linesOf()'s lines: y down the page, the first cell's x. */
  const L = (text, y, size = 11, x = 72) => ({ text, y, size, cells: [{ x, text }] });
  /* A picture from (72,400) to (400,620) in PDF units: y 172..392 down the page. */
  const box = [72, 400, 400, 620];
  const lines = [
    L('Body text above the figure ends here.', 150),
    L('Figure 17.3 Continuous-wave Doppler across the', 408, 9),
    L('tricuspid valve in severe stenosis.', 419, 9),
    /* at ordinary leading after the caption: only its size says it is body */
    L('The body resumes here after the caption.', 431),
  ];
  const cap = Pdf.captionFor(box, lines, H);
  ok('the caption under a picture is found, with its number', cap && cap.number === '17.3' && cap.label === 'Figure 17.3', JSON.stringify(cap));
  ok('and the line that continues it', cap && cap.text === 'Figure 17.3 Continuous-wave Doppler across the tricuspid valve in severe stenosis.', cap && cap.text);
  const gapped = [L('Figure 2 Pressure tracings.', 408, 9), L('Unrelated small print further down.', 440, 9)];
  ok('a line after a gap is not part of it', Pdf.captionFor(box, gapped, H).text === 'Figure 2 Pressure tracings.', Pdf.captionFor(box, gapped, H).text);
  ok('a caption over the picture is found when there is none under it',
     (Pdf.captionFor(box, [L('FIG. 4B Pressure tracings', 160, 9)], H) || {}).label === 'Figure 4B');
  ok('a caption-shaped line far from the picture is not its caption',
     Pdf.captionFor(box, [L('Figure 9 shows the same in children.', 520)], H) === null);
  /* Two pictures side by side, each captioned under itself. */
  const right = [440, 400, 590, 620];
  const pair = [L('Figure 5 Left panel.', 408, 9, 72), L('Figure 6 Right panel.', 408, 9, 440)];
  ok('side by side, each picture takes the caption under it, not its neighbour’s',
     Pdf.captionFor(box, pair, H).number === '5' && Pdf.captionFor(right, pair, H).number === '6');
  /* A stack: the caption just over the lower picture belongs to the upper one. */
  /* upper: y 92..272 down the page; lower: 312..492. Figure 7's caption is
     28 under the upper picture and 12 over the lower; Figure 8's is 48 under
     the lower — farther than 7's is over it. */
  const upper = [72, 520, 400, 700], lower = [72, 300, 400, 480];
  const stack = [L('Figure 7 Upper.', 300, 9), L('Figure 8 Lower.', 540, 9)];
  const num = b => (Pdf.captionFor(b, stack, H) || {}).number;
  ok('in a stack, the caption just over a picture is the one under the picture before it',
     num(upper) === '7' && num(lower) === '8', num(upper) + ' / ' + num(lower));

  ok('references are read as the text writes them', JSON.stringify(C.figureRefs('as shown (Fig. 17.3) and Figures 4, 5 and 6A; see figure 2–1')) === '["17.3","4","5","6a","2.1"]',
     JSON.stringify(C.figureRefs('as shown (Fig. 17.3) and Figures 4, 5 and 6A; see figure 2–1')));
  const A = { page: 2, number: '17.3' }, B = { page: 2 }, Cf = { page: 3, number: '17-4' }, D = { page: 3, number: '9' }, E = { page: 6, number: '5' };
  const cl = (index, pageStart, pageEnd, text) => ({ index, pageStart, pageEnd, text });
  const got = C.assignFigures([
    cl(0, 1, 2, 'The gradient (Fig. 17.3) rises with flow, and figure 17.4 shows why.'),
    cl(1, 2, 3, 'Nothing here names a figure.'),
    cl(2, 4, 4, 'Panel B of Fig. 5B shows the jet.'),
  ], [A, B, Cf, D, E]);
  ok('a section gets the figures it names, in the order it names them, then the rest of its pages’',
     got[0].length === 3 && got[0][0] === A && got[0][1] === Cf && got[0][2] === B, JSON.stringify(got[0]));
  ok('a numbered figure another section names is not shown on a section that merely shares its page',
     got[1].indexOf(A) === -1 && got[1].indexOf(Cf) === -1, JSON.stringify(got[1]));
  ok('an unnumbered figure, and one no section names, still go by page', got[1].indexOf(B) !== -1 && got[1].indexOf(D) !== -1, JSON.stringify(got[1]));
  ok('a figure printed off the section’s pages is shown where it is named, panel letter or not', got[2].length === 1 && got[2][0] === E, JSON.stringify(got[2]));
  const many = Array.from({ length: 9 }, () => ({ page: 1 }));
  ok(`no section shows more than ${C.FIGURES_PER_SECTION}`, C.assignFigures([cl(0, 1, 1, 'x')], many)[0].length === C.FIGURES_PER_SECTION);
}

head('scanned pages are named, not skipped silently');
{
  ok('pages with almost no text are reported by number', JSON.stringify(C.scannedPages([120, 0, 3, 88])) === '[2,3]',
     JSON.stringify(C.scannedPages([120, 0, 3, 88])));
  ok('and a document of real text reports none', C.scannedPages([50, 60]).length === 0);
}

head('memorizer/ parses on the device it is for');
{
  /* The same floor tests/verify-ipad-pure.js holds src/ to — iPadOS 13.4 —
     over the files it does not scan. These are the ones a new file most
     plausibly reaches for without noticing. Read from the comment-blanked
     source: the headers explain what they avoid, in the syntax they avoid. */
  const dir = path.join(ROOT, 'memorizer', 'src');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));
  ok('memorizer/src has files to scan', files.length >= 6, `${files.length}`);
  const RULES = [
    ['a regex lookbehind (Safari 16.4)', /\(\?<[=!]/],
    ['logical assignment ||= &&= ??= (Safari 14)', /(?:\|\||&&|\?\?)=[^=]/],
    ['Array.prototype.at (Safari 15.4)', /\.at\(\s*-?\d/],
    ['structuredClone (Safari 15.4)', /\bstructuredClone\s*\(/],
    ['a private class member #x (Safari 14.1/15)', /(?:^|[\s;{(])#[A-Za-z_]\w*\s*[=(;]/m],
    ['Blob.arrayBuffer() without a FileReader fallback (Safari 14)', /\.arrayBuffer\(\)/, src => !/FileReader/.test(src)],
  ];
  for (const [name, re, extra] of RULES) {
    const hits = files.filter(f => {
      const src = blankComments(fs.readFileSync(f, 'utf8'));
      return re.test(src) && (!extra || extra(src));
    }).map(f => path.basename(f));
    ok('no ' + name, hits.length === 0, hits.join(', ') || 'none');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
