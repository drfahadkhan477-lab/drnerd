#!/usr/bin/env node
/*
 * Behavioural checks for importing a chapter that brings its own figures.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-assets.js /path/to/patched.html
 *
 * The claim: import a Markdown chapter and its images, and the figures are
 * still there afterwards — on the page, in the model's context, and after a
 * reload. That failed silently before, which is the point of this suite. The
 * old importer read the text, discarded the images, and reported "Added 14
 * notes"; the notes looked complete and every figure in them rendered as
 * nothing. So these checks refuse to trust a success message: they assert on
 * the stored key, the rendered <img> src, and the bytes on the wire.
 *
 * The zip fixture is built here rather than committed, both because a binary
 * fixture in a repo is a thing nobody can review, and because building it in
 * the test is what proves the reader handles a real archive — including the
 * deflate path, which is the half most likely to be wrong.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-assets.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A 1x1 PNG, and a second one differing by a byte so the two hash apart. */
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAV+RSpwAAAABJRU5ErkJggg==', 'base64');

const CHAPTER = `---
title: Imported chapter
tags: imported, figures, test, atlas
source: Test fixture
---

## First section with a figure

This section has to be long enough that the importer keeps it, so here is a
paragraph of filler that reads like a real note about a real thing, with
enough words in it to clear the eighty-word floor the guide sets for a section
that anyone might later want to retrieve by searching for its contents rather
than by remembering exactly what it was called when it was written.

![A figure that came in the zip](visuals/001_fig.png)

More prose after the figure, again long enough to be a real section rather
than a stub, because a section that is too thin is dropped and then this test
would be measuring the wrong thing entirely.

## Second section, deeper path and a missing one

Another section with sufficient length to survive the importer's floor, which
exists so that retrieval has something to match against, and which this
paragraph is comfortably clearing by saying very little at some length.

![Deeper path](assets/images/002_fig.png)

![This one is not in the package at all](visuals/nope.png)

Trailing prose to keep the section above the word floor, padded out here with
a sentence that exists only to make the counting work out correctly.
`;

/* Minimal zip writer: one deflated entry, the rest stored, so the reader's
   both paths are exercised. A 4th, optional element per entry declares a
   FALSE uncompressed size in both headers instead of the real buf.length —
   for building a fixture that lies about its own size, the way a malicious
   or merely corrupt zip could. */
function zip(entries) {
  const files = [], cen = [];
  let offset = 0;
  for (const [name, buf, deflate, declaredSize] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = deflate ? zlib.deflateRawSync(buf) : buf;
    const crc = zlib.crc32 ? zlib.crc32(buf) : require('zlib').crc32(buf);
    const uncompSize = declaredSize === undefined ? buf.length : declaredSize;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    files.push(local, nameBuf, data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(uncompSize, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    cen.push(c, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const central = Buffer.concat(cen);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, eocd]);
}

(async () => {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  const zipPath = path.join(DIR, 'Braunwald_chapter.zip');
  fs.writeFileSync(zipPath, zip([
    ['pkg/chapter.md', Buffer.from(CHAPTER, 'utf8'), true],      // deflated
    ['pkg/visuals/001_fig.png', PNG_A, false],                   // stored
    ['pkg/assets/images/002_fig.png', PNG_B, true],              // deflated
    ['__MACOSX/pkg/._chapter.md', Buffer.from('junk'), false],   // must be ignored
  ]));

  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const mist = [];
  await page.route('**/v1/chat/completions', route => {
    try { mist.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
      body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: '' } }] }) + '\n\ndata: [DONE]\n\n' });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });
  await page.waitForTimeout(900);

  head('the zip reader');
  const zipRead = await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const { files, skipped } = await ZipRead.read(bytes.buffer);
    const md = files.find(f => /chapter\.md$/.test(f.name));
    const stored = files.find(f => /001_fig\.png$/.test(f.name));
    const defl = files.find(f => /002_fig\.png$/.test(f.name));
    return { n: files.length, skipped: skipped.length,
             mdText: md ? new TextDecoder().decode(md.bytes).slice(0, 40) : '',
             storedLen: stored ? stored.bytes.length : -1,
             deflLen: defl ? defl.bytes.length : -1,
             pngMagic: stored ? [...stored.bytes.slice(1, 4)].map(c => String.fromCharCode(c)).join('') : '' };
  }, fs.readFileSync(zipPath).toString('base64'));
  ok('every entry is read', zipRead.n === 4, zipRead.n + ' entries');
  ok('nothing was skipped as unreadable', zipRead.skipped === 0);
  ok('a deflated text entry decompresses to its original bytes', /^---\ntitle: Imported chapter/.test(zipRead.mdText), zipRead.mdText.slice(0, 24));
  ok('a stored binary entry survives byte-for-byte', zipRead.storedLen === PNG_A.length, `${zipRead.storedLen} vs ${PNG_A.length}`);
  ok('a deflated binary entry inflates to its original length', zipRead.deflLen === PNG_B.length, `${zipRead.deflLen} vs ${PNG_B.length}`);
  ok('and is really a PNG, not shifted by a header', zipRead.pngMagic === 'PNG', zipRead.pngMagic);

  head('a zip bomb is skipped, not allowed to exhaust memory');
  /* An all-zero buffer compresses to almost nothing with deflate, which is
     exactly the shape of a real bomb: tiny on the wire, enormous once
     inflated. BOMB_SIZE sits comfortably over zipread.js's own 256 MB cap so
     both entries below are genuinely over the line, not close to it. */
  {
    const BOMB_SIZE = 280 * 1024 * 1024;
    const bombBuf = Buffer.alloc(BOMB_SIZE);
    const bombZipPath = path.join(DIR, 'bomb.zip');
    fs.writeFileSync(bombZipPath, zip([
      ['ok.txt', Buffer.from('a perfectly normal file', 'utf8'), true],
      // Honestly declares its real, huge size — the cheap early-skip path.
      ['bomb-honest.bin', bombBuf, true],
      // Declares a tiny size in both headers while the payload still
      // inflates to BOMB_SIZE — the header cannot be trusted, so this has
      // to be caught while the stream is actually being read, not before.
      ['bomb-lying.bin', bombBuf, true, 1000],
    ]));

    const t0 = Date.now();
    const bombRead = await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const { files, skipped } = await ZipRead.read(bytes.buffer);
      return { fileNames: files.map(f => f.name), skipped };
    }, fs.readFileSync(bombZipPath).toString('base64'));
    const elapsedMs = Date.now() - t0;

    ok('the ordinary file in the same archive still reads fine', bombRead.fileNames.includes('ok.txt'), bombRead.fileNames.join(','));
    ok('the honestly-huge entry is skipped, not returned', !bombRead.fileNames.includes('bomb-honest.bin'));
    ok('and the honestly-huge entry is reported skipped rather than silently dropped', bombRead.skipped.includes('bomb-honest.bin'), bombRead.skipped.join(','));
    ok('the entry with a false, tiny declared size is ALSO skipped — the header is not trusted', !bombRead.fileNames.includes('bomb-lying.bin'));
    ok('and it too is reported, not silently dropped', bombRead.skipped.includes('bomb-lying.bin'), bombRead.skipped.join(','));
    ok('neither bomb froze the page — this returned in well under the test timeout', elapsedMs < 30000, `${elapsedMs}ms`);
  }

  head('importing the zip');
  const imported = await page.evaluate(async ({ b64, name }) => {
    REF.length = 0; invalidateIndex();
    for (const k of RefAssets.keys()) await RefAssets.drop(k);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'application/zip' });
    /* Drive the real importer by handing its file input a real File, rather
       than re-implementing what it does. */
    const orig = document.createElement;
    let input = null;
    document.createElement = function (tag) {
      const el = orig.call(document, tag);
      if (tag === 'input') { input = el; el.click = () => {}; }
      return el;
    };
    refImportText();
    document.createElement = orig;
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    await input.onchange();
    await new Promise(r => setTimeout(r, 300));
    return { notes: REF.length, assets: RefAssets.count(),
             bodies: REF.map(r => r.body),
             toast: (document.getElementById('toast') || {}).textContent || '' };
  }, { b64: fs.readFileSync(zipPath).toString('base64'), name: 'Braunwald_chapter.zip' });

  ok('the chapter became notes', imported.notes === 2, imported.notes + ' notes');
  ok('the __MACOSX shadow was ignored, not imported as a note', imported.notes === 2);
  ok('both images that exist were stored', imported.assets === 2, imported.assets + ' assets');
  const joined = imported.bodies.join('\n');
  ok('a same-folder image reference was rewritten to a refimg key',
     /!\[A figure that came in the zip\]\(refimg:\/\/u\/[a-z0-9-]+\.png\)/.test(joined),
     (joined.match(/refimg:\/\/[^)]*/g) || []).join(' '));
  ok('a deeper path was resolved too', (joined.match(/refimg:\/\/u\//g) || []).length === 2);
  ok('an image that is genuinely absent is left visible, not silently deleted',
     /!\[This one is not in the package at all\]\(visuals\/nope\.png\)/.test(joined));

  head('the import says what actually happened');
  ok('it reports the figures it linked', /2 figures linked/.test(imported.toast), imported.toast);
  ok('it reports the one it could not find', /1 image not found/.test(imported.toast), imported.toast);

  head('the figure renders');
  const rendered = await page.evaluate(() => {
    const withFig = REF.find(r => /refimg:\/\/u\//.test(r.body));
    const d = document.createElement('div');
    d.innerHTML = md(withFig.body);
    const img = d.querySelector('figure.ref-fig img');
    return { has: !!img, src: img ? img.getAttribute('src').slice(0, 22) : '',
             cap: (d.querySelector('figcaption') || {}).textContent || '' };
  });
  ok('an imported citation becomes a real <figure>', rendered.has);
  ok('its src is the stored image, not a dead relative path',
     /^data:image\/png;base64/.test(rendered.src), rendered.src);
  ok('the caption survives the rewrite', /came in the zip/.test(rendered.cap), rendered.cap);

  head('it survives a reload — IndexedDB, not memory');
  await page.reload({ waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof RefAssets !== 'undefined', { timeout: 150000 });
  /* WAIT FOR WHAT IS ABOUT TO BE ASSERTED, not for something weaker. This
     waited for count() > 0 and then asserted count() === 2, so on a loaded
     machine it sampled the moment after the first asset had been rehydrated
     from IndexedDB and before the second — reporting "1 assets" on a store
     that holds two. The check below it then failed as a consequence, because
     RefAssets.keys() destructures a k2 that is not there yet. Both passed
     standalone every time, which is the signature of a wait that does not
     cover its own assertion. */
  await page.waitForFunction(() => RefAssets.count() === 2, { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => ({ n: RefAssets.count(), bytes: RefAssets.bytes() }));
  ok('the images are still in the store after a reload', after.n === 2, after.n + ' assets');
  ok('and report a plausible size', after.bytes > 0, after.bytes + ' bytes');

  head('an imported figure reaches the model, like a built-in one');
  const wire = await page.evaluate(async () => {
    const key = RefAssets.keys()[0];
    REF.length = 0; invalidateIndex();
    const r = refAdd('Imported — figure note',
      'Body text that mentions amyloidosis and cardiac imaging at some length.\n\n' +
      '![An imported figure](refimg://' + key + ')', 'amyloid, imaging', 'Test');
    invalidateIndex();
    AI.provider = 'mistral';
    AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
    AI_GROUNDED = true;
    lastHits = [{ kind: 'r', id: r.id, title: r.title }];
    const imgs = refImagesForHits(lastHits);
    AI_GROUNDED = false;
    return { n: imgs.length, url: (imgs[0] || {}).dataUrl ? imgs[0].dataUrl.slice(0, 22) : '' };
  });
  ok('refImagesForHits finds an imported figure', wire.n === 1, wire.n + ' image(s)');
  ok('and hands over its real bytes', /^data:image\/png;base64/.test(wire.url), wire.url);

  head('housekeeping');
  const swept = await page.evaluate(async () => {
    /* Two assets on the shelf; two notes, each citing one. Deleting one note
       must release exactly its own figure and leave the other alone — a sweep
       that took both would quietly destroy a figure still on screen. */
    REF.length = 0; invalidateIndex();
    const [k1, k2] = RefAssets.keys();
    const a = refAdd('Keeps its figure', 'Body about amyloid.\n\n![one](refimg://' + k1 + ')', '', '');
    refAdd('Loses its figure', 'Body about ischaemia.\n\n![two](refimg://' + k2 + ')', '', '');
    const before = RefAssets.count();

    refDelete(REF.find(r => r.title === 'Loses its figure').id);
    await new Promise(r => setTimeout(r, 250));
    const mid = RefAssets.count();
    const survivorStillThere = RefAssets.has(k1);

    refDelete(a.id);
    await new Promise(r => setTimeout(r, 250));
    return { before, mid, survivorStillThere, after: RefAssets.count() };
  });
  ok('deleting one note releases only the figure it cited',
     swept.before === 2 && swept.mid === 1, `${swept.before} → ${swept.mid}`);
  ok('a figure another note still cites is not swept with it', swept.survivorStillThere);
  ok('and when the last citation goes, so does the figure', swept.after === 0, String(swept.after));

  head('regression');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
