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
  const words = [], kinds = [];
  blocks.forEach(bl => bl.text.split(/\s+/).forEach(w => { words.push(w); kinds.push(bl.heading); }));
  const headingEnds = [];
  for (let i = 0; i < words.length - 1; i++) if (kinds[i] && !kinds[i + 1]) headingEnds.push(i);
  return { blocks, words, headingEnds };
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
    { text: Array.from({ length: 650 }, (_, i) => 'c' + i).join(' ') + '.', page: 1, heading: false },
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
