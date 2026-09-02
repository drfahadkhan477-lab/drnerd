#!/usr/bin/env node
/*
 * ZipRead's limits, in bare Node — no browser, no build, no licensed export.
 *
 *   node tests/verify-zip.js
 *
 * src/core/zipread.js is pure logic over an ArrayBuffer, and Node has had
 * DecompressionStream since 18, so this suite runs anywhere the repository
 * does. That matters beyond convenience: CI cannot build the app, so a suite
 * that needs the built file cannot protect anything there. This one can.
 *
 * WHAT IS BEING PROTECTED. zipread already refuses an entry whose declared or
 * actual inflated size passes MAX_INFLATED, and it reads sizes from the
 * central directory rather than the local header precisely because a local
 * header is allowed to lie. What it did NOT bound was the archive as a whole:
 * every entry is accumulated into an array and returned at once, so an
 * archive of many entries, each individually legal, is still an
 * out-of-memory on an iPad. These checks are about that aggregate.
 *
 * The limits are passed in rather than read from the module's constants. The
 * property under test is "the cap is enforced", not "the cap is 256 MB" —
 * pinning the number here would make the test a copy of the source.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const mod = {};
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'zipread.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const Z = mod.ZipRead;

/* A minimal ZIP writer — STORED entries only, which is all these checks need
   and keeps the fixture readable. Deflate is exercised by the real imports. */
function makeZip(entries) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, size } of entries) {
    const nameB = enc.encode(name);
    const data = new Uint8Array(size).fill(0x41);
    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 0, true);
    lv.setUint32(18, size, true); lv.setUint32(22, size, true);
    lv.setUint16(26, nameB.length, true); lv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 0, true);
    cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, nameB.length, true); cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true); cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    locals.push(lh, data); centrals.push(ch);
    offset += lh.length + data.length;
  }
  const cenSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

(async () => {
  head('the writer produces something zipread can actually read');
  const plain = await Z.read(makeZip([
    { name: 'a.bin', size: 10 }, { name: 'b.bin', size: 20 }, { name: 'c.bin', size: 30 },
  ]));
  ok('three stored entries round-trip', plain.files.length === 3, `${plain.files.length} files`);
  ok('and their bytes are the right length',
     plain.files.map(f => f.bytes.length).join(',') === '10,20,30',
     plain.files.map(f => f.bytes.length).join(','));
  ok('nothing was skipped', plain.skipped.length === 0, plain.skipped.join(','));

  head('an entry count cap bounds how many entries are taken');
  const many = makeZip(Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.bin`, size: 16 })));
  const capped = await Z.read(many, { maxEntries: 3 });
  ok('only the first N entries are loaded', capped.files.length === 3, `${capped.files.length} files`);
  ok('the rest are reported as skipped, not silently dropped',
     capped.skipped.length === 5, `${capped.skipped.length} skipped`);
  ok('and the caller can see which ones', capped.skipped.includes('f7.bin'), capped.skipped.join(','));

  head('a total-size cap bounds the whole archive, not just each entry');
  /* The gap this closes: four 100-byte entries each pass a per-entry check of
     any sane size, and together still exceed a budget the device has. */
  const bulky = makeZip(Array.from({ length: 4 }, (_, i) => ({ name: `g${i}.bin`, size: 100 })));
  const budgeted = await Z.read(bulky, { maxTotal: 250 });
  const loaded = budgeted.files.reduce((n, f) => n + f.bytes.length, 0);
  ok('the accumulated bytes stay within the budget', loaded <= 250, `${loaded} bytes`);
  ok('entries past the budget are skipped', budgeted.skipped.length > 0, budgeted.skipped.join(','));
  ok('and something was still loaded — it degrades, it does not refuse everything',
     budgeted.files.length > 0, `${budgeted.files.length} files`);

  head('a single oversized entry cannot spend the whole budget');
  const one = makeZip([{ name: 'big.bin', size: 500 }, { name: 'small.bin', size: 10 }]);
  const spent = await Z.read(one, { maxTotal: 100 });
  ok('the oversized entry is refused', !spent.files.some(f => f.name === 'big.bin'),
     spent.files.map(f => f.name).join(','));
  ok('and the small one that fits still loads', spent.files.some(f => f.name === 'small.bin'),
     spent.files.map(f => f.name).join(','));

  head('defaults are permissive — the caps are a ceiling, not a policy change');
  const normal = await Z.read(makeZip([{ name: 'x.bin', size: 4096 }]));
  ok('an ordinary archive is unaffected by the new limits', normal.files.length === 1 && normal.skipped.length === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
