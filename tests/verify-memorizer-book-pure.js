#!/usr/bin/env node
/*
 * Memorizer takes a whole textbook: its parts in order, its pages numbered
 * straight through, and its chapters found three independent ways.
 *
 *   node tests/verify-memorizer-book-pure.js
 *
 * Pure Node, on synthetic books written here — no page of anyone's book.
 * What is proven:
 *
 *   · PARTS IN ORDER, PAGES THROUGH. "…_501-1000" after "…_1-500" and
 *     before "…_1001_-_1500", whatever order they were chosen in; a book
 *     page is found in the right part, at the right page of that file.
 *   · "CHAPTER N" LINES, NOT FOOLED. Running headers repeat a chapter's
 *     number on every page, and a cross-reference names a chapter out of
 *     place: each chapter still starts at its opener.
 *   · THE SIZE THAT OPENS CHAPTERS. Not the part titles (too few), not the
 *     section headings (too many); the size between.
 *   · BOOKMARKS AT THE CHAPTER LEVEL, and only when they cover the book.
 *   · NO PAGE LOST. Chapters run from one start to the page before the next;
 *     pages before the first are kept as front matter; merging keeps them.
 *   · CUT AGAIN, ONE CUT AT A TIME. ui.js's recut, lifted from the file that
 *     ships and run on the real store, book, chunk and backup code: a second
 *     join tapped on the same screen, or Delete during a cut, is refused, and
 *     a join tapped after Delete does not bring the book back. Each case is
 *     measured by what a backup of the device would say.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'memorizer', 'src', 'book.js'));

/* A synthetic book: `spec` is a list of chapters { n, title, pages }. Each
   page has a running header "CHAPTER n Title" at the top (size 9), body
   lines (size 10), and — on the chapter's first page — the opener: "Chapter
   n" and the title at size 24, and section headings at size 14 every page. */
const L = (text, size, y) => ({ text, size, y, cells: [{ x: 72, text }] });
function makeBook(spec, opts = {}) {
  const pages = [];
  let pg = opts.front || 0;
  for (let i = 1; i <= pg; i++) pages.push({ page: i, lines: [L('Contents and front matter ' + i, 10, 100), L('More front text here for page ' + i, 10, 114)] });
  spec.forEach(ch => {
    for (let k = 0; k < ch.pages; k++) {
      pg++;
      const lines = [];
      if (k > 0 && !opts.noHeaders) lines.push(L(`CHAPTER ${ch.n} ${ch.title} ${pg}`, 9, 30));
      if (k === 0) { lines.push(L(opts.openerNoNumber ? ch.title : `Chapter ${ch.n}`, 24, 80)); if (!opts.openerNoNumber) lines.push(L(ch.title, 24, 110)); }
      lines.push(L(`Section heading ${ch.n}.${k}`, 16, 150));
      for (let b = 0; b < 8; b++) lines.push(L(`body words of chapter ${ch.n} page ${k} line ${b} with enough length.`, 10, 170 + b * 14));
      if (ch.xref && k === 1) lines.push(L(`Chapter ${ch.xref} covers this`, 10, 300));
      pages.push({ page: pg, lines });
    }
  });
  return pages;
}
const SPEC = [
  { n: 1, title: 'Heart Failure', pages: 6 },
  { n: 2, title: 'Valve Disease', pages: 5, xref: 4 },
  { n: 3, title: 'Arrhythmias', pages: 7 },
  { n: 4, title: 'Cardiomyopathy', pages: 6 },
];

head('parts: in order, pages straight through');
{
  const names = ['Topol_1501.pdf', 'Topol_501-1000.pdf', 'Topol_1001_-_1500.pdf', 'Topol_1-500.pdf'];
  ok('ordered by the first number in each name', B.orderParts(names).map(i => names[i]).join() === 'Topol_1-500.pdf,Topol_501-1000.pdf,Topol_1001_-_1500.pdf,Topol_1501.pdf',
     B.orderParts(names).map(i => names[i]).join());
  ok('names with no number come after, by name', JSON.stringify(B.orderParts(['b.pdf', 'part 2.pdf', 'a.pdf'])) === '[1,2,0]');
  const parts = [{ fileId: 'p1', first: 1, last: 500 }, { fileId: 'p2', first: 501, last: 1000 }];
  ok('a book page is found in its part, at that file’s own page', JSON.stringify(B.locate(parts, 1)) === '{"fileId":"p1","page":1}' &&
     JSON.stringify(B.locate(parts, 500)) === '{"fileId":"p1","page":500}' && JSON.stringify(B.locate(parts, 501)) === '{"fileId":"p2","page":1}' &&
     JSON.stringify(B.locate(parts, 734)) === '{"fileId":"p2","page":234}');
  ok('and a page in no part is nowhere', B.locate(parts, 1001) === null && B.locate(parts, 0) === null);
}

head('"Chapter N" lines: openers found, headers and cross-references not fooling it');
{
  const pages = makeBook(SPEC);
  const got = B.numbered(pages);
  ok('one chapter per opener, numbered in order', got.map(c => c.n).join() === '1,2,3,4', JSON.stringify(got.map(c => [c.n, c.start])));
  ok('each starting at its opener, not a later running header', got.map(c => c.start).join() === '1,7,12,19', got.map(c => c.start).join());
  ok('titled from the line under "Chapter N"', got.map(c => c.title).join('|') === 'Heart Failure|Valve Disease|Arrhythmias|Cardiomyopathy', got.map(c => c.title).join('|'));
  /* Chapter 2 names chapter 4 on its second page, a short line of its own:
     a hit for 4 at page 8. The run 1, 2, 4 would leave out 3; the longest
     run is 1, 2, 3, 4 with 4 at its opener. */
  ok('a cross-reference to a later chapter does not start it early', got.find(c => c.n === 4).start === 19);
  /* A short line pointing back ("Chapter 1 revisited") on the last page:
     the last hit, and on no long run. */
  const back = makeBook(SPEC);
  back[back.length - 1].lines.push(L('Chapter 1 revisited', 10, 320));
  ok('a cross-reference back, on the last page, does not end the run', B.numbered(back).map(c => c.n + '@' + c.start).join() === '1@1,2@7,3@12,4@19',
     B.numbered(back).map(c => c.n + '@' + c.start).join());
  const hdrOnly = makeBook(SPEC, { openerNoNumber: true });
  const h = B.numbered(hdrOnly);
  ok('with numbers only in running headers, a chapter starts at its first header', h.map(c => c.start).join() === '2,8,13,20' && h.map(c => c.n).join() === '1,2,3,4',
     JSON.stringify(h.map(c => [c.n, c.start, c.title])));
  ok('and is titled by the header, its page number dropped', h[0].title === 'Heart Failure', h[0].title);
  /* The owner's first whole book: a chapter's display title, recognised
     from a scan, came back as "hy = rly" in the biggest type on its opener.
     It named the unit. A line that does not read as words is not a title. */
  const garbled = makeBook(SPEC);
  garbled[6].lines.unshift(L('hy = rly', 30, 40));
  const gt = B.numbered(garbled).find(c => c.n === 2);
  ok('a garbled line in the biggest type does not title the chapter: the real title does', gt && gt.title === 'Valve Disease', gt && gt.title);
  const onLine = makeBook(SPEC);
  onLine[6].lines[0] = L('Chapter 2 hy = rly', 24, 80);
  const ol = B.numbered(onLine).find(c => c.n === 2);
  ok('nor does one on the "Chapter N" line itself', ol && ol.title === 'Valve Disease', ol && ol.title);
  const long = [{ page: 1, lines: [L('Chapter 5 is where the reader will find the whole of the long discussion of this matter.', 10, 100)] }];
  ok(`a "Chapter N" line longer than ${B.NUMBERED_MAX_WORDS} words is running text`, B.numbered(long).length === 0);
}

head('running headers out of a chapter’s text');
{
  const pg = [{ page: 5, lines: [L('CHAPTER 2 Valve Disease 5', 9, 30), L('Chapter 2', 24, 80), L('Valve Disease', 24, 110),
    L('Chapter 2 describes the long history of this condition in far more detail than any short header ever would.', 10, 150), L('Body text.', 10, 170)] }];
  const kept = B.stripHeaders(pg)[0].lines.map(l => l.text);
  ok('headers and the opener’s number go; the title, prose and body stay', JSON.stringify(kept) ===
     JSON.stringify(['Valve Disease', 'Chapter 2 describes the long history of this condition in far more detail than any short header ever would.', 'Body text.']), JSON.stringify(kept));
  ok('and the pages given are not changed', pg[0].lines.length === 5);
  /* The owner's first whole book: a chapter's title on its "CHAPTER 17" line
     ran on to a second line at the same size. That second line was left
     behind, read as a heading, and titled the chapter's first section. */
  const wrap = [{ page: 7, lines: [L('CHAPTER 17 Tricuspid Valve Disease, Pulmonary Valve Disease, and', 20, 60), L('Drug-Induced Valve Disease', 20, 84),
    L('I. INTRODUCTION. The tricuspid valve has three leaflets.', 10, 130), L('More body text follows here.', 10, 144)] }];
  const kept2 = B.stripHeaders(wrap)[0].lines.map(l => l.text);
  ok('a chapter title that runs on to the next line goes with its "Chapter N" line', JSON.stringify(kept2) === JSON.stringify(['I. INTRODUCTION. The tricuspid valve has three leaflets.', 'More body text follows here.']), JSON.stringify(kept2));
  const wrapCh = B.numbered(wrap.concat([{ page: 20, lines: [L('CHAPTER 18 Heart Failure', 20, 60)] }, { page: 30, lines: [L('CHAPTER 19 Arrhythmias', 20, 60)] }]));
  ok('and the chapter is named by the whole title', wrapCh[0] && wrapCh[0].title === 'Tricuspid Valve Disease, Pulmonary Valve Disease, and Drug-Induced Valve Disease', wrapCh[0] && wrapCh[0].title);
  const notRun = B.stripHeaders([{ page: 3, lines: [L('CHAPTER 4 Heart Failure', 20, 60), L('Chronic Heart Failure', 20, 84), L('Body.', 10, 120)] }])[0].lines.map(l => l.text);
  const hdr = B.stripHeaders([{ page: 9, lines: [L('CHAPTER 17 Tricuspid, Pulmonary and', 9, 30), L('Body text of the page begins here.', 10, 60)] }])[0].lines.map(l => l.text);
  ok('nor does a small running header that stops on "and" take the body under it', JSON.stringify(hdr) === JSON.stringify(['Body text of the page begins here.']), JSON.stringify(hdr));
  ok('a title that ends whole does not take the next big line with it', JSON.stringify(notRun) === JSON.stringify(['Chronic Heart Failure', 'Body.']), JSON.stringify(notRun));
}

head('the size that opens chapters');
{
  const pages = makeBook(SPEC, { noHeaders: true });
  const got = B.bySize(pages);
  ok('the opener size, not the section-heading size', got.map(c => c.start).join() === '1,7,12,19', JSON.stringify(got.map(c => [c.start, c.title])));
  ok('titled by the biggest lines on the opener', got[1].title === 'Chapter 2 Valve Disease', got[1].title);
  /* Part titles: a bigger size on three of the openers. A size that opens
     parts qualifies too — spaced out, on enough pages — and the chapter
     size wins by opening more. */
  const withParts = makeBook(SPEC, { noHeaders: true });
  [0, 11, 18].forEach((i, k) => withParts[i].lines.unshift(L('PART ' + (k + 1), 36, 40)));
  ok('a size on fewer pages (part titles) is not the chapter size', B.bySize(withParts).map(c => c.start).join() === '1,7,12,19',
     B.bySize(withParts).map(c => c.start).join());
  /* An opener spread over two pages: big type on both. */
  const spread = makeBook(SPEC, { noHeaders: true });
  spread[1].lines.unshift(L('Learning objectives', 24, 60));
  ok('an opener over two pages is one chapter', B.bySize(spread).map(c => c.start).join() === '1,7,12,19', B.bySize(spread).map(c => c.start).join());
  const garbledSize = makeBook(SPEC, { noHeaders: true });
  garbledSize[6].lines.unshift(L('hy = rly', 24, 40));
  const gs = B.bySize(garbledSize);
  ok('nor, by size, is a garbled line part of the opener’s title', gs[1] && gs[1].title === 'Chapter 2 Valve Disease', gs[1] && gs[1].title);
  /* Section headings on every page: gaps of one page are sections. */
  const onlySections = makeBook(SPEC, { noHeaders: true }).map(p => ({ page: p.page, lines: p.lines.filter(l => l.size !== 24) }));
  ok(`a size on nearly every page (sections, under ${B.MIN_MEAN_PAGES} pages apart) is not either`, B.bySize(onlySections).length === 0,
     String(B.bySize(onlySections).length));
}

head('bookmarks: the chapter level, when they cover the book');
{
  const total = 1500;
  const parts = [0, 1, 2].map(i => ({ title: 'Part ' + (i + 1), page: 1 + i * 500, depth: 0 }));
  const chapters = Array.from({ length: 100 }, (_, i) => ({ title: 'Topic ' + (i + 1), page: 1 + i * 15, depth: 1 }));
  const sections = chapters.flatMap(c => [0, 5, 10].map(o => ({ title: c.title + ' section', page: c.page + o, depth: 2 })));
  const got = B.fromOutline(parts.concat(chapters, sections), total);
  ok(`the level that looks like chapters: not parts (over ${B.MAX_MEAN_PAGES} pages each), not sections`, got.length === 100 && got[0].title === 'Topic 1', String(got.length));
  const named = Array.from({ length: 20 }, (_, i) => ({ title: 'Section ' + i, page: 1 + i * 5, depth: 0 }))
    .concat(Array.from({ length: 10 }, (_, i) => ({ title: 'Chapter ' + (i + 1) + ' Something', page: 1 + i * 10, depth: 1 })));
  ok('a level whose titles say "Chapter N" wins', B.fromOutline(named, 100).length === 10 && /^Chapter 1 /.test(B.fromOutline(named, 100)[0].title));
  ok('no bookmarks, no chapters', B.fromOutline([], 100).length === 0);
  /* Bookmarks kept for the first part only. */
  const partial = chapters.slice(0, 20);
  const cands = B.candidates(makeBook(SPEC), partial, total);
  ok(`bookmarks covering under ${Math.round(B.MIN_COVERAGE * 100)}% of the book are not used`, !B.usable(cands.outline, total) && B.pick(cands, total) !== 'outline');
  ok('while bookmarks covering it are', B.usable(B.chaptersOf(got, total), total));
}

head('chapters: every page in exactly one, the best method chosen');
{
  const pages = makeBook(SPEC, { front: 3 });
  const total = pages.length;
  const cands = B.candidates(pages, [], total);
  const pick = B.pick(cands, total);
  ok('with no bookmarks, the "Chapter N" lines are used', pick === 'numbered', pick);
  const ch = cands[pick];
  ok('the pages before chapter 1 are kept, as front matter', ch[0].front === true && ch[0].pageStart === 1 && ch[0].pageEnd === 3, JSON.stringify(ch[0]));
  const covered = [];
  ch.forEach(c => { for (let p = c.pageStart; p <= c.pageEnd; p++) covered.push(p); });
  ok('every page is in exactly one chapter, in order', JSON.stringify(covered) === JSON.stringify(Array.from({ length: total }, (_, i) => i + 1)),
     ch.map(c => c.pageStart + '-' + c.pageEnd).join(' '));
  ok('the last chapter runs to the last page', ch[ch.length - 1].pageEnd === total);
  const m = B.merge(ch, 2);
  ok('merging a chapter into the one before keeps its pages, and renumbers', m.length === ch.length - 1 && m[1].pageEnd === ch[2].pageEnd &&
     m.map(c => c.n).join() === Array.from({ length: m.length }, (_, i) => i + 1).join());
  ok('and does not change the chapters it was given', ch.length === 5 && ch[1].pageEnd === 9);
  const flat = [{ page: 1, lines: [L('just body text here, nothing more.', 10, 100)] }];
  const lone = Array.from({ length: 45 }, (_, i) => ({ page: i + 1, lines: flat[0].lines }));
  const c2 = B.candidates(lone, [], 45);
  ok(`with nothing found, every ${B.FALLBACK_PAGES} pages`, B.pick(c2, 45) === 'pages' && c2.pages.map(c => c.pageStart + '-' + c.pageEnd).join() === '1-20,21-40,41-45',
     c2.pages.map(c => c.pageStart + '-' + c.pageEnd).join());
  ok('bookmarks are preferred when they are usable', B.pick({ outline: B.chaptersOf([{ title: 'a', start: 1 }, { title: 'b', start: 10 }, { title: 'c', start: 20 }], 30), numbered: cands.numbered, size: [], pages: [] }, 30) === 'outline');
}

ok('edition numbers cannot reorder trailing page ranges', JSON.stringify(B.orderParts(['Braunwald12_1-500.pdf', 'Braunwald12_1001-1500.pdf', 'Braunwald12_501-1000.pdf'])) === '[0,2,1]');
ok('explicit part numbers take precedence over dates and editions', JSON.stringify(B.orderParts(['Text2026 part 10.pdf', 'Text2026 part 2.pdf', 'Text2026 part 1.pdf'])) === '[2,1,0]');
ok('part preview identifies filename range gaps and overlaps', B.partWarnings(['Book12_1-500.pdf', 'Book12_600-1000.pdf', 'Book12_900-1500.pdf']).length === 2);
ok('contiguous ranges produce no warnings', B.partWarnings(['Book12_1-500.pdf', 'Book12_501-1000.pdf']).length === 0);

/* ── cut again ─────────────────────────────────────────────────────────────
   ui.js's applyChapters, bookPages, recut and removeBook, lifted from the
   comment-blanked ui.js between anchors that each occur once, and run on the
   real chunk.js, book.js, store.js (in memory), provenance.js and backup.js,
   in the page's order.
   Only the screen is stood in for: render() draws nothing, refresh() reads
   the books back as ui.js's does, and `gate` can hold it, as a slow redraw
   would. The book is made by applyChapters itself, as an import makes it. */
async function recuts() {
  head('a book cut again: one cut at a time, from the book as stored');
  const fs = require('fs'), vm = require('vm');
  const { blankComments } = require('./_source');
  const SRC = path.join(ROOT, 'memorizer', 'src');
  const uiSrc = blankComments(fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8'));
  const lift = (from, to) => {
    const a = uiSrc.indexOf(from), z = uiSrc.indexOf(to);
    if (a < 0 || z < a || uiSrc.indexOf(from, a + 1) >= 0 || uiSrc.indexOf(to, z + 1) >= 0) throw new Error('ui.js anchors not each found once: ' + from + ' … ' + to);
    return uiSrc.slice(a, z);
  };
  const code = lift('function applyChapters(', 'function previewBook(') + lift('function recut(', 'function openDoc(');
  const pages = makeBook([{ n: 1, title: 'Heart Failure', pages: 6 }, { n: 2, title: 'Valve Disease', pages: 5 }, { n: 3, title: 'Arrhythmias', pages: 7 }]);
  const total = pages.length;
  async function made() {
    const w = { console, setTimeout, Promise, TextEncoder, Uint8Array, ArrayBuffer, crypto: require('crypto').webcrypto,
      btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary') };
    w.window = w; vm.createContext(w);
    for (const f of ['chunk.js', 'book.js', 'store.js', 'provenance.js', 'backup.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), w, { filename: f });
    vm.runInContext(`var Store = MemStore, Book = MemBook, Chunk = MemChunk, root = window, gate = null, ui = { importing: '', error: '', books: [] };
      root.confirm = function () { return true; };
      function render() {} function docsChanged() {} function leave() {} function actionFailed(e) { ui.error = String(e); }
      function refresh() { return (gate || Promise.resolve()).then(function () { return Store.all('books'); }).then(function (b) { ui.books = b; }); }
      ` + code, w, { filename: 'ui.js (lifted)' });
    const book = { id: 'b1', name: 'Book', addedAt: 1, pages: total, parts: [{ fileId: 'b1:f0', name: 'book.pdf', first: 1, last: total }], scanned: [], ocr: [], ocrError: '', outline: [] };
    await w.MemStore.batch([{ store: 'files', value: { id: 'b1:f0', bytes: new Uint8Array([37, 80, 68, 70]).buffer } }, { store: 'bookpages', value: { id: 'b1:0', pages } }]);
    const c = w.MemBook.candidates(pages, [], total);
    book.method = w.MemBook.pick(c, total); book.found = {};
    await w.applyChapters(book, c[book.method], pages);
    await w.refresh();
    return w;
  }
  /* What a backup of the device would say, and why: a chapter naming a unit
     that is gone, a unit of the book that no chapter names. */
  async function state(w) {
    const [books, docs, files] = await Promise.all(['books', 'docs', 'files'].map(s => w.MemStore.all(s)));
    const b = books.find(x => x.id === 'b1'), ids = docs.map(d => d.id);
    let backup = 'restores';
    try { await w.MemBackup.inspect(await w.MemBackup.exportText()); } catch (e) { backup = 'refused: ' + e.message; }
    return { book: !!b, cut: b ? b.chapters.map(c => c.pageStart + '-' + c.pageEnd).join() : '',
      missing: b ? b.chapters.filter(c => c.docId && ids.indexOf(c.docId) < 0).length : 0,
      unlisted: docs.filter(d => !(b && b.chapters.some(c => c.docId === d.id))).length, units: docs.length, files: files.length, backup };
  }
  const whole = s => s.missing === 0 && s.unlisted === 0 && s.backup === 'restores';
  {
    const w = await made(), s0 = await state(w);
    ok('precondition: the book as imported, three chapters, each with its unit, and it restores', s0.cut === '1-6,7-11,12-18' && s0.units === 3 && whole(s0), JSON.stringify(s0));
    let b = w.ui.books[0]; await w.recut(b, w.MemBook.merge(b.chapters, 1));
    b = w.ui.books[0]; await w.recut(b, w.MemBook.merge(b.chapters, 1));
    const s = await state(w);
    ok('two joins, each tapped on the screen the last one left, are both made, and the book restores', s.cut === '1-18' && whole(s), JSON.stringify(s));
  }
  {
    const w = await made(), b = w.ui.books[0];
    await Promise.all([w.recut(b, w.MemBook.merge(b.chapters, 1)), w.recut(b, w.MemBook.merge(b.chapters, 2))]);
    const s = await state(w);
    ok('a second join tapped on the same screen while the first runs is refused: the first cut stands, and the book restores', s.cut === '1-11,12-18' && whole(s), JSON.stringify(s));
  }
  {
    const w = await made(), b = w.ui.books[0];
    let open; w.gate = new Promise(r => { open = r; });
    const first = w.recut(b, w.MemBook.merge(b.chapters, 1));
    let written = false;
    for (let i = 0; i < 200 && !written; i++) { written = (await w.MemStore.get('books', 'b1')).chapters.length === 2; if (!written) await new Promise(r => setImmediate(r)); }
    const second = w.recut(b, w.MemBook.merge(b.chapters, 2));
    open(); await Promise.all([first, second]);
    const s = await state(w);
    ok('so is one tapped after the first cut is written but before the screen is redrawn', written && s.cut === '1-11,12-18' && whole(s), 'written first: ' + written + ' ' + JSON.stringify(s));
  }
  {
    const w = await made(), b = w.ui.books[0];
    await Promise.all([w.recut(b, w.MemBook.merge(b.chapters, 1)), w.removeBook(b)]);
    const s = await state(w);
    ok('Delete tapped while a cut runs is refused: the cut is made, the book keeps its units and its PDF, and restores', s.book && s.cut === '1-11,12-18' && s.files === 1 && whole(s), JSON.stringify(s));
  }
  {
    const w = await made(), b = w.ui.books[0];
    await Promise.all([w.removeBook(b), w.recut(b, w.MemBook.merge(b.chapters, 1))]);
    const s = await state(w);
    ok('a join tapped after Delete, before its screen leaves, does not bring the book back', !s.book && s.units === 0 && s.files === 0 && s.backup === 'restores', JSON.stringify(s));
  }
}

recuts().catch(e => ok('the cut-again checks ran to the end', false, e && e.stack)).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
