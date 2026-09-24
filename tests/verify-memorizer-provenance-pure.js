#!/usr/bin/env node
/*
 * Memorizer knows where a unit came from and says how well it was read.
 *
 *   node tests/verify-memorizer-provenance-pure.js
 *
 * Pure Node: memorizer/src/provenance.js with Node's own Web Crypto. What is
 * proven:
 *
 *   · THE FINGERPRINT IS A REAL SHA-256 of what was imported — checked
 *     against the published test vectors, not against itself — and the same
 *     bytes give the same print whether handed in as an ArrayBuffer or a
 *     Uint8Array. Without Web Crypto the fallback is labelled FNV-1a, never
 *     SHA-256, and still tells different inputs apart.
 *   · A DUPLICATE IS THE SAME BYTES in a standalone unit: a book's chapter
 *     carrying the same print is not one, and no print matches nothing.
 *   · THE REPORT COUNTS WHAT HAPPENED: pages read from the PDF's own text,
 *     by text recognition, and not at all, each named; a book chapter
 *     counts only its own pages; the verdict follows those counts, and
 *     figures not yet looked for are said to be so, not counted as zero.
 */
'use strict';
const path = require('path');
const { webcrypto } = require('crypto');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const P = require(path.join(__dirname, '..', 'memorizer', 'src', 'provenance.js'));

(async () => {
  head('the fingerprint is SHA-256 of exactly what was imported');
  /* FIPS 180-2 test vectors. */
  const abc = await P.fingerprint('abc', webcrypto.subtle);
  ok('"abc" gives the published SHA-256', abc === 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', abc);
  const empty = await P.fingerprint('', webcrypto.subtle);
  ok('and the empty input gives its published digest', empty === 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', empty);
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 0, 255]);
  const a = await P.fingerprint(bytes.buffer, webcrypto.subtle), b = await P.fingerprint(bytes, webcrypto.subtle);
  ok('the same bytes print the same, as an ArrayBuffer or a Uint8Array', a === b && /^sha256:[0-9a-f]{64}$/.test(a), a);
  const c = await P.fingerprint(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 0, 254]), webcrypto.subtle);
  ok('and one byte different prints differently', c !== a);
  const g = await P.fingerprint('abc');
  ok('with no crypto handed in, the platform’s own is found and used', g === abc, g);

  head('without Web Crypto, the fallback says what it is');
  const f1 = await P.fingerprint('abc', null), f2 = await P.fingerprint('abd', null);
  ok('it is labelled FNV-1a, never passed off as SHA-256', /^fnv1a64:[0-9a-f]{16}$/.test(f1), f1);
  ok('and still tells different inputs apart', f1 !== f2, `${f1} ${f2}`);
  ok('the 32-bit half is the published FNV-1a of "a"', P.fnv(new TextEncoder().encode('a')).slice(0, 8) === 'e40c292c', P.fnv(new TextEncoder().encode('a')));
  const broken = { digest: () => Promise.reject(new Error('no')) };
  ok('a digest that refuses falls back rather than failing the import', /^fnv1a64:/.test(await P.fingerprint('abc', broken)));
  ok('the short form names the method and shows twelve digits', P.shortPrint(abc) === 'SHA-256 ba7816bf8f01' && P.shortPrint(f1) === 'FNV-1a ' + f1.slice(8, 20) && P.shortPrint('') === '',
     `${P.shortPrint(abc)} | ${P.shortPrint(f1)}`);

  head('a duplicate is the same bytes, in a unit of its own');
  const docs = [{ id: 'ch', bookId: 'b1', fingerprint: abc }, { id: 'u1', fingerprint: abc }, { id: 'u2', fingerprint: f1 }];
  ok('the standalone unit with the same print is found', (P.duplicateOf(docs, abc) || {}).id === 'u1');
  ok('a book’s chapter with the same print is not a duplicate', P.duplicateOf([docs[0]], abc) === null);
  ok('no print matches nothing, even a unit with none', P.duplicateOf([{ id: 'x', fingerprint: '' }], '') === null && P.duplicateOf(docs, 'sha256:00') === null);

  head('the import report counts what happened');
  const seg = (extra) => Object.assign({ text: 'x' }, extra);
  const pdf = { source: 'pdf', pages: 20, scanned: [7], ocr: [3, 4], ocrError: '', figures: [{}, {}],
    clusters: [{ words: 100, pageStart: 1, pageEnd: 5, segments: [seg({ table: [['a']] }), seg({ table: [['b']], tableHeader: ['h'] })] },
               { words: 50, pageStart: 6, pageEnd: 20, segments: [seg({ table: [['c']] })] }] };
  const r = P.report(pdf);
  ok('pages from the PDF’s own text are the rest: 20 − 2 recognised − 1 unread', r.textLayer === 17 && r.pages === 20, JSON.stringify(r.lines[0]));
  ok('recognised pages are named, and flagged to check', JSON.stringify(r.ocr) === '[3,4]' && r.lines.some(l => l.kind === 'check' && /\(3, 4\)/.test(l.text)));
  ok('unread pages are named, and said to be in no section', JSON.stringify(r.noText) === '[7]' && r.lines.some(l => l.kind === 'bad' && /\(7\): not in any section/.test(l.text)));
  ok('a table continued onto a second page is one table, not two', r.tables === 2, String(r.tables));
  ok('sections, words and figures are counted', r.sections === 2 && r.words === 150 && r.figures === 2);
  ok('one unread page in twenty is "to check", not "poor"', r.verdict === 'check' && r.label === 'Read, with pages to check', r.verdict);
  ok('three in twenty is poor', P.report(Object.assign({}, pdf, { scanned: [1, 2, 3] })).verdict === 'poor');
  ok('recognised pages alone make it "to check"', P.report(Object.assign({}, pdf, { scanned: [] })).verdict === 'check');
  const clean = P.report(Object.assign({}, pdf, { scanned: [], ocr: [] }));
  ok('and none of either reads cleanly, every page from the PDF’s text', clean.verdict === 'good' && clean.textLayer === 20 && clean.lines[0].kind === 'ok', clean.lines[0].text);
  ok('the reader’s failure is quoted with the unread pages', /text reader could not run \(offline\)/.test(P.report(Object.assign({}, pdf, { ocrError: 'offline' })).lines.map(l => l.text).join(' ')));
  const ch = P.report({ source: 'pdf', bookId: 'b', pageStart: 101, pageEnd: 110, pages: 10, scanned: [5, 105], ocr: [2, 108, 200], figures: null, clusters: [] });
  ok('a book chapter counts only its own pages', ch.pages === 10 && JSON.stringify(ch.noText) === '[105]' && JSON.stringify(ch.ocr) === '[108]' && ch.textLayer === 8, JSON.stringify(ch));
  ok('and figures not looked for yet are said to be so, not counted as none', ch.figures === null && /figures found when first opened/.test(ch.lines[ch.lines.length - 1].text));
  ok('a unit stored before its source was recorded is read as the PDF it was', P.report({ pages: 3, clusters: [] }).textLayer === 3 &&
     /^3 of 3 pages read from the PDF/.test(P.report({ pages: 3, clusters: [] }).lines[0].text), P.report({ pages: 3, clusters: [] }).lines[0].text);
  ok('pasted text needed nothing recognised', P.report({ source: 'text', pages: 2, clusters: [] }).verdict === 'good');
  ok('photos are all text recognition, and flagged to check', P.report({ source: 'photo', pages: 3, clusters: [] }).verdict === 'check');
  ok('long page lists are cut, with the total', P.pageList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) === '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12… (14 in all)');

  head('a section knows which of its pages were recognised');
  ok('only the pages inside the section', JSON.stringify(P.ocrPagesIn(pdf, pdf.clusters[0])) === '[3,4]' && P.ocrPagesIn(pdf, pdf.clusters[1]).length === 0);
  ok('and nothing for a unit with no record of recognition', P.ocrPagesIn({}, pdf.clusters[0]).length === 0 && P.ocrPagesIn(null, null).length === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
