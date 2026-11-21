/* ═════════════════════════════════════════════
   imagesize.js — a figure's width and height, read from the first bytes of its own data.

   A note's figure is drawn as <img loading="lazy"> from a data: URL (the build's REF_IMGS, or one imported
   to the device, src/core/refassets.js). With no width or height on it, the browser gives the picture no
   room until it has decoded it, so every card with a figure grew as its figure arrived: three cards of
   345 px became 418 while the library was being scrolled, and a tap that landed then went to whatever had
   moved under the finger (tests/verify-reflist.js). The size is in the picture's header, a few bytes in,
   so it is read there and written on the <img>; the browser keeps the room from the start.

     of(src)    { w, h } for a data: URL of a PNG, GIF, JPEG or WebP whose header says its size;
                null for anything else (an AVIF, a URL that is not data:, a header cut short or
                contradicting itself), and the <img> is written without a size, as before
     attrs(z)   ' width="w" height="h"' for a size of two whole positive numbers, '' for anything else

   Only the header is decoded: a few dozen bytes, or for a JPEG 64, and four times as many again each time its
   first frame header is not yet reached (an EXIF block can put it tens of kilobytes in); never more
   than HEAD bytes. A width or height of 0 or over
   MAX is not believed.

   Pure: no DOM, no clock, no storage. The global atob, which every browser has and Node has from 16; Node's
   Buffer only where there is none, and Buffer skips what is not base64 where atob refuses it. ES2015; Safari 13.4
   is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const HEAD = 65536, MAX = 30000;

/* The first n bytes of a base64 payload, as an array of byte values. */
function bytes(b64, n){
  const want = Math.min(b64.length, Math.ceil(n / 3) * 4) & ~3;
  const part = b64.slice(0, want);
  if (typeof atob === 'function') {
    let bin; try { bin = atob(part); } catch (_) { return null; }
    const out = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (typeof Buffer !== 'undefined') return Array.from(Buffer.from(part, 'base64'));
  return null;
}
const u16be = (b, i) => b[i] << 8 | b[i + 1];
const u16le = (b, i) => b[i] | b[i + 1] << 8;
const u24le = (b, i) => b[i] | b[i + 1] << 8 | b[i + 2] << 16;
const u32be = (b, i) => (b[i] << 24 >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const ascii = (b, i, s) => { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };
const size = (w, h) => (w > 0 && h > 0 && w <= MAX && h <= MAX) ? { w, h } : null;

function png(b){
  /* The signature, then IHDR first, as the format requires: its width and height, four bytes each. */
  if (b.length < 24 || !ascii(b, 0, '\x89PNG\r\n\x1a\n') || !ascii(b, 12, 'IHDR')) return null;
  return size(u32be(b, 16), u32be(b, 20));
}
function gif(b){
  if (b.length < 10 || !(ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return null;
  return size(u16le(b, 6), u16le(b, 8));
}
function webp(b){
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
  if (ascii(b, 12, 'VP8 ')) {                       /* lossy: a key frame's start code, then 14-bit sizes */
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return size(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (ascii(b, 12, 'VP8L')) {                       /* lossless: a signature byte, then 14 bits each, less one */
    if (b[20] !== 0x2f) return null;
    const v = b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24 >>> 0;
    return size((v & 0x3fff) + 1, (v >>> 14 & 0x3fff) + 1);
  }
  if (ascii(b, 12, 'VP8X')) return size(u24le(b, 24) + 1, u24le(b, 27) + 1);   /* extended: 24 bits each, less one */
  return null;
}
/* JPEG display dimensions follow the orientation of the primary EXIF image.
   TIFF offsets in APP1 are relative to the byte-order marker and must stay
   inside the segment. Orientations 5–8 exchange the two axes. */
function exifOrientation(b, start, end){
  if (start + 14 > end || !ascii(b, start, 'Exif\0\0')) return 0;
  const tiff = start + 6;
  const little = ascii(b, tiff, 'II');
  if (!little && !ascii(b, tiff, 'MM')) return 0;
  const u16 = little ? u16le : u16be;
  if (u16(b, tiff + 2) !== 42) return 0;
  const offset = little ? u16le(b, tiff + 4) + u16le(b, tiff + 6) * 65536 : u32be(b, tiff + 4);
  const ifd = tiff + offset;
  if (offset < 8 || ifd + 2 > end) return 0;
  const count = u16(b, ifd);
  if (ifd + 2 + 12 * count > end) return 0;
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + 12 * k;
    if (u16(b, entry) !== 0x0112 || u16(b, entry + 2) !== 3 ||
        u16(b, entry + (little ? 4 : 6)) !== 1 ||
        u16(b, entry + (little ? 6 : 4)) !== 0) continue;
    const value = u16(b, entry + 8);
    if (value >= 1 && value <= 8) return value;
  }
  return 0;
}

/* undefined, rather than null, where the bytes ran out before a frame header: more may find it. */
function jpeg(b){
  if (b.length < 4) return undefined;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2, orientation = 0;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;                 /* lost the segments: say nothing rather than guess */
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }              /* fill bytes */
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }   /* no length */
    if (m === 0xd9 || m === 0xda) return null;      /* the image ended, or its data began, before a frame header */
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    /* A frame header: every SOFn but DHT (C4), JPG (C8) and DAC (CC). Height, then width. */
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 8 >= b.length) return undefined;
      const w = u16be(b, i + 7), h = u16be(b, i + 5);
      return orientation >= 5 ? size(h, w) : size(w, h);
    }
    const end = i + 2 + len;
    if (end > b.length) return undefined;
    if (m === 0xe1 && !orientation) orientation = exifOrientation(b, i + 4, end);
    i = end;
  }
  return undefined;
}
const READ = { 'image/png': [png, 24], 'image/gif': [gif, 10], 'image/webp': [webp, 30], 'image/jpeg': [jpeg, HEAD], 'image/jpg': [jpeg, HEAD] };

function of(src){
  const m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(typeof src === 'string' ? src.slice(0, 64) : '');
  if (!m) return null;
  const read = READ[m[1].toLowerCase()];
  if (!read) return null;
  const body = src.slice(m[0].length);
  /* A JPEG's frame header is usually within its first few hundred bytes, but an EXIF block can put it tens of
     kilobytes in: 64 bytes are read, then four times as many each time they run out, never past HEAD. */
  for (let n = Math.min(read[1], 64); ; n = Math.min(n * 4, read[1])) {
    const b = bytes(body.slice(0, Math.ceil(n / 3) * 4), n);
    if (!b) return null;
    const z = read[0](b);
    if (z !== undefined) return z;
    if (n >= read[1] || b.length < n) return null;
  }
}

/* A size as the attributes of an <img>, or nothing: only two whole positive numbers are written, because they land
   inside the markup as they are. */
function attrs(z){
  return z && Number.isInteger(z.w) && Number.isInteger(z.h) && z.w > 0 && z.h > 0 ? ' width="' + z.w + '" height="' + z.h + '"' : '';
}

root.ImageSize = { of, attrs, HEAD, MAX };

})(typeof window !== 'undefined' ? window : this);
