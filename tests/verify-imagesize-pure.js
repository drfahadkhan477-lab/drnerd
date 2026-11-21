#!/usr/bin/env node
/*
 * A figure's width and height, read from the first bytes of its own data — src/core/imagesize.js.
 *
 *   node tests/verify-imagesize-pure.js
 *
 * Pure Node. Each picture here is a header built byte by byte from its format's own layout, followed by bytes that
 * are not a picture at all, so a reader that decoded more than the header, or found a size anywhere but where the
 * format puts it, is caught. The expected sizes are the ones written into the headers.
 *
 * What is measured, rather than assumed:
 *   - a PNG's size from IHDR, a GIF's from its screen descriptor, a WebP's from each of its three headers (lossy,
 *     lossless, extended), a JPEG's from its first frame header, past other segments, fill bytes and a long EXIF
 *     block, in any of the frame types and none of the three markers that share their range;
 *   - nothing is said for what cannot be read: an AVIF, a URL that is not data:, a header cut short, a signature
 *     with the wrong chunk after it, a JPEG whose data starts before any frame header, a size of 0 or past MAX;
 *   - only the header is decoded: what follows it may be anything (for a JPEG, what follows the first bytes read,
 *     when its frame header is among them);
 *   - a size becomes an <img>'s width and height only when it is two whole positive numbers;
 *   - the page reads a picture's size once for each picture a key names, and again when the key names another,
 *     and the module is written into the page before the Markdown renderer that writes the size; the pearl's
 *     figure and Apex's strip write it through the page's refImgAttrs().
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const I = require('../src/core/imagesize.js').ImageSize;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };

const be16 = n => [n >> 8 & 255, n & 255];
const le16 = n => [n & 255, n >> 8 & 255];
const be32 = n => [n >>> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255];
const le24 = n => [n & 255, n >> 8 & 255, n >> 16 & 255];
const asc = s => [...s].map(c => c.charCodeAt(0));
/* Bytes that are no picture's, after every header: a reader that wandered into them would read nonsense. */
const TAIL = Array.from({ length: 400 }, (_, i) => (i * 37 + 11) & 255);
const url = (mime, bytes) => 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64');
const size = (mime, bytes) => safely(() => I.of(url(mime, bytes)));

const PNG = (w, h, chunk = 'IHDR') => [0x89, ...asc('PNG\r\n\x1a\n'), ...be32(13), ...asc(chunk), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, ...TAIL];
const GIF = (w, h, v = '89a') => [...asc('GIF' + v), ...le16(w), ...le16(h), 0xf7, 0, 0, ...TAIL];
const RIFF = (kind, body) => [...asc('RIFF'), ...le24(1000), 0, ...asc('WEBP'), ...asc(kind), ...le24(body.length), 0, ...body, ...TAIL];
const VP8 = (w, h) => RIFF('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
const VP8L = (w, h) => { const v = (w - 1) | (h - 1) << 14; return RIFF('VP8L', [0x2f, v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255]); };
const VP8X = (w, h) => RIFF('VP8X', [0x10, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const seg = (m, payload) => [0xff, m, ...be16(payload.length + 2), ...payload];
const SOF = (m, w, h) => seg(m, [8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const JPEG = (...segs) => [0xff, 0xd8, ...[].concat(...segs), ...TAIL];
const APP0 = seg(0xe0, [...asc('JFIF\0'), 1, 2, 0, 0, 1, 0, 1, 0, 0]);
const DHT = seg(0xc4, Array(20).fill(1));

head('each format\'s size, from where the format puts it');
{
  ok('a PNG: the width and height in IHDR', J(size('image/png', PNG(913, 477))) === J({ w: 913, h: 477 }), J(size('image/png', PNG(913, 477))));
  ok('a tall one too, four bytes each, read big-endian', J(size('image/png', PNG(301, 1999))) === J({ w: 301, h: 1999 }));
  ok('a GIF, either version: the screen\'s width and height, little-endian', J(size('image/gif', GIF(640, 360))) === J({ w: 640, h: 360 }) && J(size('image/gif', GIF(5, 7, '87a'))) === J({ w: 5, h: 7 }));
  ok('a lossy WebP: the key frame\'s 14-bit sizes', J(size('image/webp', VP8(1200, 800))) === J({ w: 1200, h: 800 }), J(size('image/webp', VP8(1200, 800))));
  ok('its top two bits are a scale, not part of the size', J(size('image/webp', VP8(1200 | 0x4000, 800 | 0x8000))) === J({ w: 1200, h: 800 }));
  ok('a lossless WebP: 14 bits each, stored less one', J(size('image/webp', VP8L(913, 477))) === J({ w: 913, h: 477 }), J(size('image/webp', VP8L(913, 477))));
  ok('an extended WebP (alpha, animation): 24 bits each, stored less one', J(size('image/webp', VP8X(301, 1999))) === J({ w: 301, h: 1999 }), J(size('image/webp', VP8X(301, 1999))));
  ok('a JPEG: its first frame header, height before width', J(size('image/jpeg', JPEG(APP0, DHT, SOF(0xc0, 913, 477)))) === J({ w: 913, h: 477 }), J(size('image/jpeg', JPEG(APP0, DHT, SOF(0xc0, 913, 477)))));
  ok('a progressive one, and every other frame type', [0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].every(m => J(size('image/jpeg', JPEG(APP0, SOF(m, 640, 360)))) === J({ w: 640, h: 360 })));
  ok('the three markers that share their range are not frames: a table, the extension marker and arithmetic coding are passed over', [0xc4, 0xc8, 0xcc].every(m => J(size('image/jpeg', JPEG(seg(m, [...be16(1), ...be16(1), 9, 9]), SOF(0xc0, 640, 360)))) === J({ w: 640, h: 360 })));
  ok('past fill bytes and markers that carry no length', J(size('image/jpeg', JPEG([0xff, 0xff, 0xff], APP0, [0xff, 0x01], SOF(0xc2, 33, 44)))) === J({ w: 33, h: 44 }));
  const exif = seg(0xe1, [...asc('Exif\0\0'), ...Array(40000).fill(0x2a)]);
  ok('past an EXIF block of 40 KB', J(size('image/jpeg', JPEG(exif, SOF(0xc0, 4032, 3024)))) === J({ w: 4032, h: 3024 }), J(size('image/jpeg', JPEG(exif, SOF(0xc0, 4032, 3024)))));
  ok('the type is read whatever its case', J(safely(() => I.of(url('IMAGE/PNG', PNG(2, 3))))) === J({ w: 2, h: 3 }) && J(size('image/jpg', JPEG(SOF(0xc0, 2, 3)))) === J({ w: 2, h: 3 }));
}

head('nothing is said for what cannot be read');
{
  ok('an AVIF, a format this does not read', size('image/avif', [0, 0, 0, 0x20, ...asc('ftypavif'), ...TAIL]) === null);
  ok('a URL that is not data:, or no URL at all', safely(() => I.of('https://example.invalid/a.png')) === null && safely(() => I.of('refimg://a')) === null && safely(() => I.of('')) === null && safely(() => I.of(null)) === null && safely(() => I.of(undefined)) === null);
  ok('a data: URL that is not base64', safely(() => I.of('data:image/png,' + 'x'.repeat(40))) === null);
  ok('a header cut short', size('image/png', PNG(9, 9).slice(0, 20)) === null && size('image/gif', GIF(9, 9).slice(0, 8)) === null && size('image/webp', VP8X(9, 9).slice(0, 26)) === null
     && size('image/jpeg', [0xff, 0xd8, ...SOF(0xc0, 9, 9).slice(0, 6)]) === null);
  ok('a signature with the wrong chunk after it, or the wrong signature for the type', size('image/png', PNG(9, 9, 'gAMA')) === null && size('image/png', GIF(9, 9)) === null && size('image/gif', PNG(9, 9)) === null && size('image/jpeg', PNG(9, 9)) === null);
  ok('a WebP whose frame is not one of the three, or whose start code is wrong', size('image/webp', RIFF('ALPH', Array(16).fill(0))) === null
     && size('image/webp', RIFF('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2b, ...le16(9), ...le16(9)])) === null && size('image/webp', RIFF('VP8L', [0x2e, 0, 0, 0, 0])) === null);
  ok('a JPEG whose data begins, or which ends, before any frame header', size('image/jpeg', JPEG(APP0, seg(0xda, [1, 2, 3]), SOF(0xc0, 9, 9))) === null && size('image/jpeg', JPEG(APP0, [0xff, 0xd9], SOF(0xc0, 9, 9))) === null);
  ok('a JPEG whose segments are lost (no marker where one should be)', size('image/jpeg', [0xff, 0xd8, 0x12, 0x34, ...SOF(0xc0, 9, 9)]) === null);
  ok('a size of 0, or past MAX, is not believed', size('image/png', PNG(0, 10)) === null && size('image/png', PNG(10, 0)) === null && size('image/png', PNG(I.MAX + 1, 10)) === null
     && size('image/gif', GIF(10, 0)) === null && J(size('image/png', PNG(I.MAX, I.MAX))) === J({ w: I.MAX, h: I.MAX }), 'MAX ' + I.MAX);
  ok('a frame header further in than HEAD bytes is not reached', size('image/jpeg', JPEG(seg(0xe1, Array(65000).fill(0)), seg(0xe2, Array(3000).fill(0)), SOF(0xc0, 9, 9))) === null, 'HEAD ' + I.HEAD);
}

head('only the header is decoded');
{
  /* What follows the header here is not base64 at all: decoding it would throw, or say nothing. */
  const broken = (mime, bytes) => safely(() => I.of(url(mime, bytes).slice(0, 'data:;base64,'.length + mime.length + 120) + '%%%% not base64 %%%%'.repeat(50)));
  ok('a PNG, a GIF and a WebP are read from their first bytes alone', J(broken('image/png', PNG(913, 477))) === J({ w: 913, h: 477 }) && J(broken('image/gif', GIF(4, 5))) === J({ w: 4, h: 5 })
     && J(broken('image/webp', VP8X(6, 7))) === J({ w: 6, h: 7 }), J(broken('image/png', PNG(913, 477))));
  ok('and a JPEG from its first bytes, when its frame header is among them', J(broken('image/jpeg', JPEG(SOF(0xc0, 8, 9)))) === J({ w: 8, h: 9 }), J(broken('image/jpeg', JPEG(SOF(0xc0, 8, 9)))));
}

head('a size as an <img>\'s attributes');
{
  ok('two whole positive numbers become a width and a height', safely(() => I.attrs({ w: 913, h: 477 })) === ' width="913" height="477"', J(safely(() => I.attrs({ w: 913, h: 477 }))));
  /* What is written lands inside the markup as it is: nothing but two whole positive numbers is. */
  const odd = [null, undefined, {}, { w: 9 }, { w: 1.5, h: 2 }, { w: -3, h: 4 }, { w: 0, h: 4 }, { w: '9" onerror="alert(1)', h: 9 }, { w: '9', h: '9' }, 'big', 7];
  const written = odd.map(z => safely(() => I.attrs(z)));
  ok('anything else becomes nothing', written.every(t => t === ''), J(written.find(t => t !== '')));
}

head('the page reads a size once for each picture');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const from = page.indexOf('const REF_IMG_SIZE=new Map();'), to = page.indexOf('\n}', page.indexOf('function refImgSize(key,src){')) + 2;
  const reads = [];
  const ctx = { ImageSize: { of: src => { reads.push(src); return { w: src.length, h: 1 }; } } };
  vm.createContext(ctx);
  safely(() => vm.runInContext(page.slice(from, to).replace('const REF_IMG_SIZE', 'var REF_IMG_SIZE') + '\nthis.refImgSize=refImgSize;', ctx));
  const f = ctx.refImgSize || (() => null);
  const a1 = safely(() => f('k', 'data:aa')), a2 = safely(() => f('k', 'data:aa')), once = reads.length;
  ok('a key\'s picture is read once, however often its note is drawn', from >= 0 && J(a1) === J({ w: 7, h: 1 }) && J(a2) === J(a1) && once === 1, J(reads));
  const b = safely(() => f('k', 'data:bbbb'));
  ok('and read again when the key names another picture (a figure imported again under its name)', J(b) === J({ w: 9, h: 1 }) && reads.indexOf('data:bbbb') >= 0, J(reads));
  ok('a picture the module could not read is not asked again', safely(() => { ctx.ImageSize.of = src => { reads.push(src); return null; }; f('n', 'data:n'); f('n', 'data:n'); return reads.filter(r => r === 'data:n').length; }) === 1);
  const sizeSlot = page.indexOf('@@SLOT[src:src/core/imagesize.js]@@'), mdSlot = page.indexOf('@@SLOT[src:src/core/markdown.js]@@');
  ok('the module is written into the page once, before the Markdown renderer, and md() hands the renderer the page\'s reader',
     sizeSlot >= 0 && page.indexOf('@@SLOT[src:src/core/imagesize.js]@@', sizeSlot + 1) < 0 && sizeSlot < mdSlot
     && page.split('function md(t){ return Markdown.render(t,e,refImgSrc,refImgSize); }').length - 1 === 1, sizeSlot < 0 ? 'no slot' : 'slot at ' + sizeSlot);
  const n = t => page.split(t).length - 1;
  ok('refImgAttrs() is the page\'s reader as attributes, and the pearl\'s figure and Apex\'s strip are written with it',
     n('function refImgAttrs(key,src){ return ImageSize.attrs(refImgSize(key,src)); }') === 1 && n('function refImgAttrs(') === 1
     && n('alt="${e(cap||\'Figure from this note\')}"${refImgAttrs(p.figKey,src)} loading="lazy">') === 1 && n('apexFigsFor,refImgAttrs,') === 1
     && fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'apexpanel.js'), 'utf8').split('alt="${e(f.caption)}"${refImgAttrs(f.key,f.dataUrl)} loading="lazy">').length - 1 === 1,
     [n('function refImgAttrs(key,src){ return ImageSize.attrs(refImgSize(key,src)); }'), n('${refImgAttrs(p.figKey,src)}'), n('apexFigsFor,refImgAttrs,')].join(' '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
