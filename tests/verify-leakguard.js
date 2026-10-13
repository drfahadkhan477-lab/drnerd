#!/usr/bin/env node
/*
 * The leak guard refuses the licensed bank and lets the repository through.
 *
 *   node tests/verify-leakguard.js
 *
 * Pure Node, no browser, no build. The fixtures below are synthetic — the
 * point of a test for this guard is that it must never need a real export to
 * prove it would catch one.
 *
 * WHY BOTH HALVES MATTER, and the second one more. A guard that refuses
 * everything is as useless as no guard, and worse than no guard, because it
 * gets switched off. So the last block runs the guard over every file git
 * actually tracks — it said 211 here while the number was 240 — and asserts it
 * refuses none. No count on purpose now: it moves with every file added, and
 * an unguarded number in a comment is the thing AGENTS.md says not to write.
 * That is a check against reality rather than against fixtures, and it keeps
 * rule 4 honest: eight tracked source files contain `const ALL_Q=` on purpose,
 * being the patch scripts that search for it, and a marker-only rule would
 * have refused all eight.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const GUARD = path.join(__dirname, '..', 'scripts', 'leak-guard.js');
const ROOT = path.join(__dirname, '..');
/* Returns { code, out } — the guard exits 1 and names the rule when it refuses. */
function run(args) {
  try {
    const out = execFileSync(process.execPath, [GUARD, ...args],
      { encoding: 'utf8', cwd: ROOT });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leakguard-'));
const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };

head('it refuses the licensed bank, by every route in');
{
  /* 1. PATH — the ordinary case, and the one .gitignore already covers until
     somebody types git add -f. */
  let r = run(['content/questions.json']);
  ok('a path under content/ is refused', r.code === 1 && /PATH/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.slice(0, 60));
  r = run(['dist/app.js']);
  ok('and so is one under dist/', r.code === 1 && /PATH/.test(r.out));
  r = run(['tests/last-run.log']);
  ok('and the run log, whose output quotes question text', r.code === 1 && /PATH/.test(r.out));

  /* AND graphify-out/, WHICH CAN BE MADE OF THE CORPUS. `graphify` writes a
     knowledge graph there over whatever it indexed. Its walker respects
     .gitignore by default, so a default run over this repository skips
     content/, build/, dist/ and source/ — an earlier version of this comment
     said otherwise and was wrong. The exposure is the opt-out: `--no-gitignore`
     is one flag, and a .graphifyignore is read regardless of it and can
     re-include a path by itself. Either route puts node labels and excerpts of
     the licensed question text under a name that advertises none of it. Every
     rule in the guard used to look past it: not a licensed path, no verify header, the
     NAME regex does not match `graph.json`, and a graph of one subdirectory
     sits under rule 3's 1 MB cap and under the 200 KB floor rules 4 and 5
     need before they look. Proven before the rule existed — the guard printed
     "nothing licensed" and exited 0.

     The second assertion is why DERIVED carries a trailing slash. Without it
     the prefix test matches any name merely beginning "graphify", and a file
     called graphify-outline.md would be refused for no reason — a guard that
     over-refuses is the kind that gets switched off. Proven by setting DERIVED
     to ['graphify']: that assertion went red and the one above stayed green. */
  r = run(['graphify-out/graph.json']);
  ok('and a graphify graph, which is built from the corpus', r.code === 1 && /PATH/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.slice(0, 60));
  /* A real file, read from tmp: a path that is not there is now an error
     (exit 2), not a pass, so this used to pass for a reason it no longer can. */
  fs.writeFileSync(path.join(tmp, 'graphify-outline.md'), 'an outline\n');
  try { execFileSync(process.execPath, [GUARD, 'graphify-outline.md'], { cwd: tmp, stdio: 'pipe' }); r = { code: 0 }; }
  catch (e) { r = { code: e.status, out: String(e.stderr) }; }
  ok('but not a file that merely starts with the same letters', r.code === 0, r.out);

  /* 1b. LOG — THE SAME LOG UNDER ANOTHER NAME, which is how this rule came
     to exist. `node scripts/verify.js > 1.txt` is the obvious thing to type,
     and what it writes is byte-for-byte what last-run.log holds. One sat
     untracked in the owner's checkout for eight days: not in a licensed
     directory, not an ACCSAP filename, and a failing run's log is under both
     the 1 MB cap and the 200 KB floor the payload rules need before they
     will look at anything. Every rule in the file walked past it.

     The body here is the real header and nothing else — a fixture that
     quoted question text to prove a guard against quoting question text
     would be its own kind of joke. The header is what is recognised. */
  const LOGHEAD = '# systole verify \u2014 2026-09-11T07:45:02.389Z\n'
                + '# checkout  claude/x @ 99f7a13\n# engine    webkit\n';
  r = run([write('1.txt', LOGHEAD)]);
  ok('a verify log saved as 1.txt is refused', r.code === 1 && /LOG/.test(r.out),
     r.out.match(/LOG.*/)?.[0] || r.out.slice(0, 60));
  r = run([write('notes.md', LOGHEAD)]);
  ok('and under any other name, since the name is not what is read',
     r.code === 1 && /LOG/.test(r.out));
  /* BELOW EVERY SIZE FLOOR IN THE FILE, which is the point: rules 3, 4 and 5
     would all have declined to look. */
  ok('even though it is far too small for the payload rules to examine',
     LOGHEAD.length < 200 * 1024);
  /* AND IT IS THE HEADER, NOT THE WORD. A file that merely mentions the
     runner must not be refused, or the rule becomes a nuisance and gets
     turned off — which is what this file's header says about guards. */
  r = run([write('about-verify.md', 'Notes on systole verify and what it writes.\n')]);
  ok('while prose that merely mentions the runner is not refused', r.code === 0,
     r.out.trim().slice(0, 60));
  r = run([write('later-line.md', 'intro\n# systole verify \u2014 2026-01-01T00:00:00.000Z\n')]);
  ok('and the header only counts on the first line, where verify.js writes it',
     r.code === 0, r.out.trim().slice(0, 60));
  /* WHAT A REDIRECT ACTUALLY WRITES, not last-run.log's header typed by hand.
     verify.js used to write that header only into last-run.log: a run kept
     with `node scripts/verify.js > 1.txt` began with a blank line and
     "Verifying \u2026", and walked past this rule (the 2026-10-10 review). So the
     runner itself runs here, on one suite that needs no browser and writes
     nothing, and its stdout is the fixture: what `>` keeps. Then the same
     bytes as Windows PowerShell 5.1's `>` writes them (UTF-16LE, with a BOM),
     with the BOM `Out-File -Encoding utf8` adds, and after the lines
     `npm run verify > 1.txt` puts first. */
  const redirected = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--only', 'record-pure'],
    { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
  ok('(the runner\u2019s stdout is a real run of a suite)', /record-pure\s+\S+\s+\d+ passed/.test(redirected), redirected.split('\n').slice(0, 3).join(' | '));
  r = run([write('run.txt', redirected)]);
  ok('a run kept with `node scripts/verify.js > 1.txt` is refused', r.code === 1 && /LOG/.test(r.out), r.out.trim().slice(0, 80));
  r = run([write('run-ps.txt', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(redirected, 'utf16le')]))]);
  ok('and so is the same run as PowerShell\u2019s `>` writes it, UTF-16 with a BOM', r.code === 1 && /LOG/.test(r.out), r.out.trim().slice(0, 80));
  r = run([write('run-bom.txt', '\ufeff' + redirected)]);
  ok('and as UTF-8 with a BOM', r.code === 1 && /LOG/.test(r.out), r.out.trim().slice(0, 80));
  r = run([write('run-npm.txt', '\n> systole@1.0.0 verify\n> node scripts/verify.js\n\n' + redirected)]);
  ok('and after npm\u2019s own lines, as `npm run verify > 1.txt` keeps it', r.code === 1 && /LOG/.test(r.out), r.out.trim().slice(0, 80));

  /* 6. PACK — the owner's textbook, by way of Memorizer's study pack
     (memorizer/src/pack.js). Both fixtures are made here by pack.js itself,
     from a two-line synthetic unit, so what is recognised is what the app
     really writes and no book is involved. */
  const Pack = require(path.join(ROOT, 'memorizer', 'src', 'pack.js'));
  const unit = { id: 'u', name: 'Unit', clusters: [{ title: 'One', pageStart: 1, pageEnd: 1, segments: [{ text: 'A synthetic sentence.', page: 1 }] }] };
  r = run([write('prompt-for-claude.txt', Pack.prompt(unit))]);
  ok('a Memorizer prompt, which carries the book\u2019s text and the pack\u2019s shape, is refused', r.code === 1 && /PACK/.test(r.out), r.out.match(/PACK.*/)?.[0] || r.out.slice(0, 60));
  const reply = JSON.stringify({ format: Pack.FORMAT, version: Pack.VERSION, unit: 'Unit', sections: [Pack.EXAMPLE] }, null, 2);
  r = run([write('chapter-7.json', reply)]);
  ok('and so is the pack Claude writes back, under any name', r.code === 1 && /PACK/.test(r.out));
  r = run([write('reply.md', 'Here is reply 1.\n```json\n' + JSON.stringify({ format: Pack.FORMAT, sections: [] }) + '\n```\n')]);
  ok('in a code fence, compact, with prose around it', r.code === 1 && /PACK/.test(r.out));
  r = run([path.join(ROOT, 'memorizer', 'src', 'pack.js'), path.join(ROOT, 'tests', 'verify-memorizer-pack-pure.js')]);
  ok('while the code that names the format is not refused', r.code === 0, r.out.trim().slice(0, 80));
  r = run([write('pack-notes.md', 'Notes on the memorizer-pack format, and its "format" key.\n')]);
  ok('nor prose that mentions it', r.code === 0, r.out.trim().slice(0, 60));

  /* 2. NAME — the export dragged somewhere unignored. */
  r = run(['assets/ACCSAP_12_super_v12.html']);
  ok('an ACCSAP export is refused wherever it has been moved to',
     r.code === 1 && /NAME/.test(r.out));

  /* 3. SIZE — anything outsized, under a name nobody guessed. Not a figure:
     the bytes are not an image, and a real figure is far under the cap (3b). */
  const big = write('holiday-photo.bin', Buffer.alloc(1024 * 1024 + 1, 7));
  r = run([big]);
  ok('anything over 1 MB is refused', r.code === 1 && /SIZE/.test(r.out),
     r.out.match(/SIZE.*/)?.[0]?.trim().slice(0, 50));

  /* 3b. IMAGE — A REAL FIGURE, AT A REAL FIGURE'S SIZE. The guard's header
     gave "drags a figure into assets/" as the reason .gitignore is not enough,
     and no rule caught one: SIZE starts at 1 MB and the content rules read
     text (found by review). The fixture is a genuine PNG of noise, tens of
     KB, made here so no figure is involved; it is judged at the path someone
     would drop it at, under its own name, renamed, and as a PDF. */
  const zlib = require('zlib');
  const png = (() => {
    const w = 128, h = 96, rows = [];
    for (let y = 0; y < h; y++) rows.push(Buffer.concat([Buffer.alloc(1), require('crypto').randomBytes(w * 3)]));
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
      return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  })();
  ok('(the figure fixture is tens of KB, under every size rule)', png.length > 10 * 1024 && png.length < 200 * 1024, png.length + ' bytes');
  const inTmp = (rel, body, timeout) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), body);
    try { return { code: 0, out: execFileSync(process.execPath, [GUARD, rel], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }) }; }
    catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') + (e.signal ? ` (killed by ${e.signal})` : '') }; }
  };
  r = inTmp('assets/figure-3.png', png);
  ok('a figure dragged into assets/ is refused', r.code === 1 && /IMAGE\s+assets\/figure-3\.png/.test(r.out),
     r.out.match(/IMAGE.*/)?.[0] || r.out.trim().slice(0, 60));
  r = inTmp('assets/figure-3.bin', png);
  ok('and so is the same figure renamed, by its first bytes', r.code === 1 && /IMAGE/.test(r.out) && /a PNG/.test(r.out),
     r.out.match(/IMAGE.*|a PNG.*/)?.[0] || r.out.trim().slice(0, 60));
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
  r = inTmp('notes/chapter-7.pdf', pdf);
  ok('a split PDF far under 1 MB is refused', r.code === 1 && /IMAGE\s+notes\/chapter-7\.pdf/.test(r.out),
     r.out.match(/IMAGE.*/)?.[0] || r.out.trim().slice(0, 60));
  r = inTmp('notes/chapter-7.txt', pdf);
  ok('and renamed, by its first bytes', r.code === 1 && /a PDF/.test(r.out), r.out.match(/IMAGE.*|a PDF.*/)?.[0] || r.out.trim().slice(0, 60));
  /* An SVG is refused by its name, and renamed by its root element, since an
     SVG is text and has no magic bytes. */
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- drawn for the test -->\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n';
  r = inTmp('assets/diagram.svg', svg);
  ok('an SVG figure is refused by its extension', r.code === 1 && /IMAGE\s+assets\/diagram\.svg/.test(r.out),
     r.out.match(/IMAGE.*/)?.[0] || r.out.trim().slice(0, 60));
  r = inTmp('assets/diagram.txt', svg);
  ok('and renamed, by its root element past the prolog, comment and doctype', r.code === 1 && /an SVG/.test(r.out),
     r.out.match(/IMAGE.*|an SVG.*/)?.[0] || r.out.trim().slice(0, 60));
  r = inTmp('assets/diagram-2.txt', '<!DOCTYPE svg [ <!ENTITY red "#c00"> ]>\n<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&red;" width="1" height="1"/></svg>\n');
  ok('and past a doctype with an internal subset', r.code === 1 && /an SVG/.test(r.out), r.out.match(/IMAGE.*|an SVG.*/)?.[0] || r.out.trim().slice(0, 60));
  for (const subset of ['<!ENTITY label "]">', "<!ENTITY label ']'>", '<!-- ]> --> <!ENTITY label "[">']) {
    r = inTmp('assets/quoted-dtd.bin', '<!DOCTYPE svg [' + subset + ']><svg xmlns="http://www.w3.org/2000/svg"/>');
    ok('quoted brackets and DTD comments cannot hide an SVG root', r.code === 1 && /an SVG/.test(r.out));
  }
  r = inTmp('assets/prefixed.bin', '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:rect width="1" height="1"/></s:svg>');
  ok('a namespace-prefixed SVG renamed is refused', r.code === 1 && /an SVG/.test(r.out));
  for (const prefix of ['é', '\u{10000}', '\u200Cname']) {
    r = inTmp('assets/unicode-prefix.bin', `<${prefix}:svg xmlns:${prefix}="http://www.w3.org/2000/svg"/>`);
    ok('a non-ASCII XML namespace prefix cannot hide a renamed SVG', r.code === 1 && /an SVG/.test(r.out));
  }
  r = inTmp('notes/other-namespace.xml', '<s:svg xmlns:s="urn:unrelated"/>');
  ok('an unrelated namespace is not mistaken for an SVG', r.code === 0);
  r = inTmp('notes/quoted-namespace.xml', '<s:svg title=" xmlns:s=\'http://www.w3.org/2000/svg\'" xmlns:s="urn:unrelated"/>');
  ok('a namespace mentioned inside another attribute is not a declaration', r.code === 0);
  for (const namespace of ['http:&#x2f;&#x2f;www.w3.org/2000/svg', 'http:&#47;&#47;www.w3.org/2000/svg', '&svgNS;']) {
    r = inTmp('assets/referenced-namespace.bin', '<!DOCTYPE s:svg [<!ENTITY svgNS "http://www.w3.org/2000/svg">]>' +
      `<s:svg xmlns:s="${namespace}"/>`);
    ok('XML references in an SVG namespace cannot hide a renamed figure', r.code === 1 && /an SVG/.test(r.out));
  }
  r = inTmp('assets/default-namespace.bin', '<!DOCTYPE s:svg [<!ATTLIST s:svg xmlns:s CDATA "http://www.w3.org/2000/svg">]><s:svg/>');
  ok('a DTD-defaulted SVG namespace cannot hide a renamed figure', r.code === 1 && /an SVG/.test(r.out));
  /* A ] or > the doctype quotes, or holds in a comment, ends nothing (found
     by review, #241: an entity's quoted ] ended the subset there, and the
     SVG passed). */
  const quoted = [
    '<!DOCTYPE svg [<!ENTITY label "]">]>',
    '<!DOCTYPE svg [<!-- ] --><!ENTITY red "#c00">]>',
    '<!DOCTYPE svg SYSTEM "svg[1]>.dtd">',
  ].map((doctype, n) => inTmp(`assets/diagram-q${n}.txt`, doctype + '\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>\n'));
  const missed = quoted.filter(q => !(q.code === 1 && /an SVG/.test(q.out)));
  ok('and past a ] or > quoted in its doctype, or in a comment there', missed.length === 0,
     missed.map(q => q.out.trim().slice(0, 60)).join(' | ') || `${quoted.length} refused`);
  /* However far in the root is: the whole text is read, not its first 4 KB
     (found by review, #241: a 5 KB comment hid the root). */
  r = inTmp('assets/diagram-3.bin', '<!-- ' + 'licence text '.repeat(500) + '-->\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>\n');
  ok('and behind a comment longer than 4 KB', r.code === 1 && /an SVG/.test(r.out), r.out.match(/IMAGE.*|an SVG.*/)?.[0] || r.out.trim().slice(0, 60));
  /* A doctype that never closes, with "][" pairs the first SVG reading could
     split two ways each: exponential, so forty pairs took hours and would
     have hung the commit hook (found by CodeQL, #241). The guard is given
     ten seconds and is killed past them. */
  const started = Date.now();
  r = inTmp('notes/doctype.txt', '<!doctype[' + ']['.repeat(40) + '\n', 10000);
  ok('a doctype that never closes is judged at once, not after an exponential search', r.code === 0,
     `${Date.now() - started} ms` + (r.code === 0 ? '' : ': ' + r.out.trim().slice(-60)));
  /* The same for a subset of comments with no ]: read lazily inside the
     subset's loop, each comment could also stretch to the next one's close,
     two ways each. */
  const started2 = Date.now();
  r = inTmp('notes/doctype-2.txt', '<!DOCTYPE x [' + '<!-- a -->'.repeat(40) + '\n', 10000);
  ok('nor does a subset of comments that never closes', r.code === 0,
     `${Date.now() - started2} ms` + (r.code === 0 ? '' : ': ' + r.out.trim().slice(-60)));
  /* Every other format the extension rule names, renamed (found by review,
     #240: only PNG, JPEG, GIF, WebP and PDF were known by their bytes). Each
     fixture is a valid header for its format, made here. */
  const bmp = (() => {
    const row = 8, b = Buffer.alloc(14 + 40 + row * 2);           // 2 x 2, 24-bit, rows padded to 4
    b.write('BM', 0, 'latin1'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10);
    b.writeUInt32LE(40, 14); b.writeInt32LE(2, 18); b.writeInt32LE(2, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
    b.fill(0x7f, 54);
    return b;
  })();
  const bmff = brand => {
    const b = Buffer.alloc(28);
    b.writeUInt32BE(28, 0); b.write('ftyp', 4, 'latin1'); b.write(brand, 8, 'latin1'); b.write('mif1miaf' + brand, 16, 'latin1');
    return b;
  };
  const tiff = order => Buffer.concat([Buffer.from(order === 'II' ? [0x49, 0x49, 0x2A, 0x00, 8, 0, 0, 0] : [0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8]), Buffer.alloc(6)]);
  for (const [what, rel, body, says] of [
    ['a BMP', 'assets/scan-2.bin', bmp, /a BMP/],
    ['a little-endian TIFF', 'assets/scan-4.dat', tiff('II'), /a TIFF/],
    ['a big-endian TIFF', 'assets/scan-5.dat', tiff('MM'), /a TIFF/],
    ['an AVIF', 'assets/photo-1.bin', bmff('avif'), /an AVIF or HEIC image/],
    ['a HEIC', 'assets/photo-2.bin', bmff('heic'), /an AVIF or HEIC image/],
  ]) {
    r = inTmp(rel, body);
    ok(`${what} renamed is refused, by its first bytes`, r.code === 1 && says.test(r.out), r.out.match(/IMAGE.*/)?.[0] || r.out.trim().slice(0, 60));
  }
  /* And the look-alikes those must not catch: text that starts with BM, a
     page that contains an <svg> without being one, and markdown that opens
     with a comment. */
  r = inTmp('notes/bmi.txt', 'BMI by age, a table\n18 22.5\n');
  ok('a text file that starts with "BM" is fine', r.code === 0, r.out.trim().slice(0, 60));
  r = inTmp('notes/page.html', '<!doctype html>\n<html><body><svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg></body></html>\n');
  ok('a page holding an inline <svg> is fine', r.code === 0, r.out.trim().slice(0, 60));
  r = inTmp('notes/readme.md', '<!-- generated -->\n# Notes\n\n<svg> is how the figures are drawn.\n');
  ok('markdown that opens with a comment is fine', r.code === 0, r.out.trim().slice(0, 60));
  r = inTmp('memorizer/samples/notes.md', 'a page of a chapter\n');
  ok('anything under memorizer/samples/, where a book chapter is kept, is refused', r.code === 1 && /PATH\s+memorizer\/samples/.test(r.out),
     r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 60));
  /* And what must pass: the one binary the repository ships on purpose, by
     the list that names it, and a text file whose name only mentions one. */
  r = run(['assets/hero-heart/heart.webp']);
  ok('the binary the repository ships on purpose passes, by name', r.code === 0, r.out.trim().slice(0, 60));
  r = inTmp('assets/heart.webp', fs.readFileSync(path.join(ROOT, 'assets', 'hero-heart', 'heart.webp')));
  ok('but the same bytes at any other path are refused', r.code === 1 && /a WebP/.test(r.out), r.out.match(/IMAGE.*|a WebP.*/)?.[0] || r.out.trim().slice(0, 60));
  r = inTmp('png-notes.md', 'notes on the png encoder\n');
  ok('while a text file that only mentions an image format is fine', r.code === 0, r.out.trim().slice(0, 60));

  /* 4. PAYLOAD — the export renamed to something innocuous and trimmed below
     the size rule. This is the rule that earns its keep. */
  const renamed = write('notes-backup.txt',
    'const ALL_Q=[{"id":"X","q":"?"}' + ','.repeat(250 * 1024) + ']');
  r = run([renamed]);
  ok('the bank renamed and slimmed is still refused', r.code === 1 && /PAYLOAD/.test(r.out));

  /* 5. FIGURES — a figure dump under any name. */
  const figs = write('slides.json',
    'x'.repeat(201 * 1024) + Array(12).fill('data:image/webp;base64,AAAA').join(','));
  r = run([figs]);
  ok('a file full of base64 figures is refused', r.code === 1 && /FIGURES/.test(r.out));

  /* AND FIGURES HAS NO FLOOR OF ITS OWN, unlike PAYLOAD above it. The fixture
     above is padded past 201 KB to also clear PAYLOAD's floor, which proved
     FIGURES works — not that it works WITHOUT that floor. This one is the
     real case: eight images, no padding, nowhere near 200 KB, in a file whose
     name gives nothing away. Before FIGURES had its own check ahead of
     PAYLOAD_SNIFF_BYTES, this returned code 0 — "nothing licensed" — because
     `st.size <= SNIFF_BYTES` sent it home before either rule looked. */
  const smallFigs = write('notes.js',
    Array(8).fill('const x = "data:image/png;base64,' + 'A'.repeat(200) + '";').join('\n'));
  ok('the small fixture really is under the old shared floor',
     fs.statSync(smallFigs).size < 200 * 1024, fs.statSync(smallFigs).size + ' bytes');
  r = run([smallFigs]);
  ok('a small figure dump is refused too, not just a large one',
     r.code === 1 && /FIGURES/.test(r.out), r.out.match(/FIGURES.*/)?.[0] || r.out.trim().slice(0, 60));

  /* AND IT STILL TAKES EIGHT. A couple of screenshots pasted into a small
     note is not a figure dump, and must not become unreviewable because
     FIGURES lost its floor. */
  const fewFigs = write('two-shots.js',
    Array(2).fill('const x = "data:image/png;base64,' + 'A'.repeat(200) + '";').join('\n'));
  r = run([fewFigs]);
  ok('but two embedded images in a small file are still fine', r.code === 0, r.out.trim().slice(0, 60));

  /* And it says what to do, because a guard that refuses without a remedy is
     a guard somebody deletes. Run fresh rather than reusing `r`: reading the
     previous fixture's output meant this check reported on whatever ran last,
     and when FIGURES stopped firing it failed for a reason that had nothing to
     do with the remedy text. */
  const refused = run(['content/questions.json']);
  ok('the refusal explains the escape hatch',
     /ALLOW in/.test(refused.out) && /public/.test(refused.out));
}

head('and it lets through what it must');
{
  /* The marker alone is not a leak: these are the patch scripts that search
     for it. If this ever fails, rule 4 has lost its size condition. */
  const mentions = write('like-a-patch-script.js',
    "/* looks for */ const RE = /const ALL_Q=\\[/; module.exports = RE;\n");
  let r = run([mentions]);
  ok('a small script that merely mentions the marker is fine', r.code === 0, r.out.trim().slice(0, 70));

  const ordinary = write('ordinary.js', 'module.exports = 1;\n');
  r = run([ordinary]);
  ok('an ordinary source file is fine', r.code === 0);

  /* A file just under each threshold, to show the bounds are bounds. */
  const justUnder = write('just-under.bin', Buffer.alloc(1024 * 1024 - 1, 7));
  r = run([justUnder]);
  ok('a file one byte under the size cap is fine', r.code === 0);
}

head('and it does not refuse this repository');
{
  /* The check against reality. 200-odd real files, including the eight that
     contain the payload marker on purpose. */
  const r = run(['--all-tracked']);
  ok('every tracked file passes', r.code === 0, r.out.trim().slice(0, 70));
  const n = +(r.out.match(/(\d+) file\(s\) checked/) || [, 0])[1];
  ok('and it actually looked at them — not an empty list', n > 100, `${n} files`);
}

head('the pre-commit route: what is staged');
{
  /* Every case above names its files. The hook names none, so the guard asks
     git what is staged, and that path had no test. A submodule pointer is a
     commit id, not content, so it is never opened — but since the systole-refs
     submodule was removed (its repository deleted), a pointer under content/
     is refused like a file there: it would link a licensed corpus from this
     public repository. It used to be allowed, and this test required that. A
     throwaway repository, so nothing here touches this one's index. */
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'leakguard-git-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
                                     { cwd: repo, encoding: 'utf8' });
  const inRepo = () => {
    try { return { code: 0, out: execFileSync(process.execPath, [GUARD], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'notes.md'), 'ordinary\n');
  git('add', 'notes.md');
  let r = inRepo();
  /* Not an empty list read as clean: the ordinary file was checked, so git
     was asked and answered. */
  ok('an ordinary staged file is checked and passes', r.code === 0 && /\b1 file\(s\) checked/.test(r.out), r.out.trim().slice(0, 60));
  git('update-index', '--add', '--cacheinfo', '160000,' + '1'.repeat(40) + ',content/refs-repo');
  r = inRepo();
  ok('a staged submodule pointer under content/ is refused', r.code === 1 && /PATH\s+content\/refs-repo/.test(r.out),
     r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 60));
  /* The --all-tracked route (CI's) must agree with the hook's. */
  git('commit', '-q', '-m', 'x', '--no-verify');
  let all;
  try { all = { code: 0, out: execFileSync(process.execPath, [GUARD, '--all-tracked'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { all = { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  ok('and --all-tracked refuses the same pointer once it is committed', all.code === 1 && /content\/refs-repo/.test(all.out),
     all.out.match(/PATH.*/)?.[0] || all.out.trim().slice(0, 60));
  git('rm', '-q', '--cached', 'content/refs-repo');
  git('update-index', '--add', '--cacheinfo', '160000,' + '2'.repeat(40) + ',vendor/lib');
  r = inRepo();
  ok('a submodule outside the licensed folders still passes', r.code === 0, r.out.trim().slice(0, 60));
  git('rm', '-q', '--cached', 'vendor/lib');

  /* WHAT IS STAGED IS WHAT IS COMMITTED. Content rules read the index's blob,
     not the working copy: a reviewer staged an oversized file, overwrote it on
     disk with "{}", and the guard passed what git would have committed. */
  const at = n => path.join(repo, n);
  fs.writeFileSync(at('big.txt'), Buffer.alloc(1024 * 1024 + 1, 0x61));
  git('add', 'big.txt');
  fs.writeFileSync(at('big.txt'), '{}');
  r = inRepo();
  ok('a file staged oversized and shrunk on disk afterwards is refused for what is staged', r.code === 1 && /SIZE\s+big\.txt/.test(r.out),
     r.out.match(/SIZE.*|could not.*/)?.[0] || r.out.trim().slice(0, 60));
  git('rm', '-q', '-f', '--cached', 'big.txt');
  const dump = Array.from({ length: 8 }, (_, i) => `"f${i}": "data:image/png;base64,AAAA"`).join(',\n');
  fs.writeFileSync(at('slides.json'), '{' + dump + '}');
  git('add', 'slides.json');
  fs.unlinkSync(at('slides.json'));
  r = inRepo();
  ok('a figure dump staged and then deleted from disk is still refused', r.code === 1 && /FIGURES\s+slides\.json/.test(r.out),
     r.out.match(/FIGURES.*|could not.*/)?.[0] || r.out.trim().slice(0, 60));
  git('rm', '-q', '--cached', 'slides.json');
  fs.writeFileSync(at('plain.json'), '{"a": 1}');
  git('add', 'plain.json');
  fs.writeFileSync(at('plain.json'), '{' + dump + '}');
  r = inRepo();
  ok('and a clean staged file is not refused for what is only on disk', r.code === 0, r.out.trim().slice(0, 80));
  git('rm', '-q', '-f', '--cached', 'plain.json');

  fs.writeFileSync(at('move.json'), '{}'); git('add', 'move.json'); git('commit', '-q', '-m', 'rename fixture', '--no-verify');
  fs.mkdirSync(at('content'), { recursive: true });
  git('mv', 'move.json', 'content/move.json');
  ok('the fixture is a Git-detected rename', /R100/.test(git('diff', '--cached', '--name-status')));
  r = inRepo();
  ok('a staged rename into a forbidden destination is refused', r.code === 1 && /PATH\s+content\/move\.json/.test(r.out));
  git('reset', '--hard', '-q', 'HEAD');
  git('mv', 'move.json', 'ordinary-moved.json');
  r = inRepo();
  ok('an ordinary rename is actually checked and passes', r.code === 0 && /1 file\(s\) checked/.test(r.out));
  git('reset', '--hard', '-q', 'HEAD');

  /* A FAILURE TO LOOK IS NOT A PASS. Git that cannot answer used to give an
     empty list, and "0 file(s) checked, nothing licensed", exit 0. */
  const broken = args => {
    try { execFileSync(process.execPath, [GUARD, ...args], { cwd: repo, env: { ...process.env, GIT_DIR: at('no-such-git-dir') }, stdio: 'pipe' }); return { code: 0, out: '' }; }
    catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
  };
  const b1 = broken([]), b2 = broken(['--all-tracked']);
  ok('when git cannot say what is staged, the guard exits 2 and certifies nothing', b1.code === 2 && !/nothing licensed/.test(b1.out), `exit ${b1.code}`);
  ok('and the same when it cannot say what is tracked', b2.code === 2 && !/nothing licensed/.test(b2.out), `exit ${b2.code}`);
  let miss;
  try { execFileSync(process.execPath, [GUARD, 'no-such-file.md'], { cwd: repo, stdio: 'pipe' }); miss = 0; } catch (e) { miss = e.status; }
  ok('a named file that cannot be read is an error, not a pass', miss === 2, `exit ${miss}`);
  fs.rmSync(repo, { recursive: true, force: true });
}

head('the pre-push route: every commit the push sends');
{
  /* The pre-commit hook sees a commit only when `git commit` makes it, and
     the pre-push hook used to judge the checked-out tree. A licensed file
     added in one commit and deleted in the next passed both and was pushed.
     A throwaway repository and a bare remote; hooks off for the fixture's own
     commands, so only the hook under test below ever runs. */
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'leakguard-push-'));
  const repo = path.join(work, 'repo'), remote = path.join(work, 'remote.git'), noHooks = path.join(work, 'no-hooks');
  fs.mkdirSync(repo); fs.mkdirSync(noHooks);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=' + noHooks, ...a],
                                     { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const guard = (args, input) => {
    try { return { code: 0, out: execFileSync(process.execPath, [GUARD, ...args], { cwd: repo, encoding: 'utf8', input: input || '', stdio: ['pipe', 'pipe', 'pipe'] }) }; }
    catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  const put = (name, body) => { fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true }); fs.writeFileSync(path.join(repo, name), body); };
  const ZERO = '0'.repeat(40);
  /* The line git writes to the hook for one ref. */
  const line = (ref, local, remoteSha) => `refs/heads/${ref} ${local} refs/heads/${ref} ${remoteSha}\n`;

  execFileSync('git', ['init', '-q', '--bare', remote]);
  git('init', '-q', '-b', 'master');
  git('remote', 'add', 'origin', remote);
  put('notes.md', 'ordinary\n'); git('add', 'notes.md'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('push', '-q', 'origin', 'master');

  put('content/leak.json', '{"stem": "x"}'); git('add', '-f', 'content/leak.json'); git('commit', '-q', '-m', 'add');
  const added = git('rev-parse', '--short=12', 'HEAD');
  git('rm', '-q', 'content/leak.json'); git('commit', '-q', '-m', 'remove it again');
  const tip = git('rev-parse', 'HEAD');
  let r = guard(['--all-tracked']);
  ok('(the checked-out tree is clean, so the route the pre-push check used to read passes it)', r.code === 0 && /checked, nothing licensed/.test(r.out), r.out.trim().slice(0, 70));
  r = guard(['--push', 'origin'], line('master', tip, base));
  ok('a file added in one commit and deleted in the next is refused, naming the commit it came in',
     r.code === 1 && new RegExp(`PATH\\s+content/leak\\.json\\s+\\(in ${added}\\)`).test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 70));
  r = guard(['--range', `${base}..${tip}`]);
  ok('and --range, the route CI takes, refuses the same history', r.code === 1 && /PATH\s+content\/leak\.json/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 70));
  git('reset', '-q', '--hard', base);

  const dump = Array.from({ length: 8 }, (_, i) => `"f${i}": "data:image/png;base64,AAAA"`).join(',\n');
  git('checkout', '-q', '-b', 'side');
  put('slides.json', '{' + dump + '}'); git('add', 'slides.json'); git('commit', '-q', '-m', 'figures');
  const side = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'master');
  r = guard(['--push', 'origin'], line('side', side, ZERO));
  ok('a new branch that is not checked out is judged by what it sends', r.code === 1 && /FIGURES\s+slides\.json/.test(r.out), r.out.match(/FIGURES.*/)?.[0] || r.out.trim().slice(0, 70));

  /* Only what is new to this remote: a new branch off master is judged on
     its own commit, not on master's, which the remote already holds. */
  git('checkout', '-q', '-b', 'own', base);
  put('own.md', 'ordinary\n'); git('add', 'own.md'); git('commit', '-q', '-m', 'own');
  r = guard(['--push', 'origin'], line('own', git('rev-parse', 'HEAD'), ZERO));
  ok('a new branch is judged on its own commits, not on what the remote already holds', r.code === 0 && /\(in 1 commit\(s\)\)/.test(r.out), r.out.trim().slice(0, 80));
  /* A remote tip this clone never fetched cannot be excluded: the push is
     still judged, on more, rather than refused for it. */
  r = guard(['--push', 'origin'], line('master', tip, 'f'.repeat(40)));
  ok('a remote tip this clone has never fetched widens the check rather than stopping it', r.code === 1 && /PATH\s+content\/leak\.json/.test(r.out), r.out.match(/PATH.*|could not.*/)?.[0] || r.out.trim().slice(0, 70));
  /* A first commit has no parent to be read against (--root). */
  git('checkout', '-q', '--orphan', 'fresh');
  git('rm', '-q', '-r', '--cached', '.');
  put('content/root.json', '{}'); git('add', '-f', 'content/root.json'); git('commit', '-q', '-m', 'root');
  r = guard(['--push', 'origin'], line('fresh', git('rev-parse', 'HEAD'), ZERO));
  ok('a first commit, with no parent, is read too', r.code === 1 && /PATH\s+content\/root\.json/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 70));
  git('checkout', '-q', '-f', 'master');
  put('more.md', 'ordinary too\n'); git('add', 'more.md'); git('commit', '-q', '-m', 'clean');
  const clean = git('rev-parse', 'HEAD');
  r = guard(['--push', 'origin'], line('master', clean, base));
  ok('a clean push is read, not waved through: its one new file, in its one commit', r.code === 0 && /\b1 file\(s\) checked, nothing licensed \(in 1 commit\(s\)\)/.test(r.out), r.out.trim().slice(0, 80));
  r = guard(['--push', 'origin'], `(delete) ${ZERO} refs/heads/side ${side}\n`);
  ok('a push that only deletes sends nothing, and is let through', r.code === 0 && /\b0 file\(s\) checked, nothing licensed \(in 0 commit\(s\)\)/.test(r.out), r.out.trim().slice(0, 80));

  /* A merge whose other side is already on the remote: only the merge commit
     is new, and what it adds itself shows only against each parent. */
  git('checkout', '-q', '-b', 'other', base);
  put('other.md', 'from the other side\n'); git('add', 'other.md'); git('commit', '-q', '-m', 'other');
  git('push', '-q', 'origin', 'other');
  git('checkout', '-q', 'master');
  git('merge', '-q', '--no-ff', '--no-commit', 'other');
  put('content/evil.json', '{}'); git('add', '-f', 'content/evil.json'); git('commit', '-q', '-m', 'merge other');
  const merge = git('rev-parse', 'HEAD'), mshort = git('rev-parse', '--short=12', 'HEAD');
  r = guard(['--push', 'origin'], line('master', merge, base));
  ok('a merge is read against each parent, so what it brings in itself is refused',
     r.code === 1 && new RegExp(`PATH\\s+content/evil\\.json\\s+\\(in ${mshort}\\)`).test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 70));

  git('reset', '-q', '--hard', base);
  git('update-index', '--add', '--cacheinfo', '160000,' + '1'.repeat(40) + ',content/refs-repo'); git('commit', '-q', '-m', 'pointer');
  r = guard(['--push', 'origin'], line('master', git('rev-parse', 'HEAD'), base));
  ok('a submodule pointer under content/ in a pushed commit is refused', r.code === 1 && /PATH\s+content\/refs-repo/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.trim().slice(0, 70));
  git('reset', '-q', '--hard', base);

  r = guard(['--range', 'no-such-revision..HEAD']);
  ok('when git cannot list the commits, it exits 2 and certifies nothing', r.code === 2 && !/nothing licensed/.test(r.out), `exit ${r.code}`);
  r = guard(['--push', 'origin'], 'not a line git writes\n');
  ok('and a pre-push line it cannot read is an error, not a pass', r.code === 2 && !/nothing licensed/.test(r.out), `exit ${r.code}`);

  /* THE HOOK ITSELF, run by git from a real push: a copy of .githooks/
     pre-push with the guard beside it, as they sit in this repository. The
     suites it runs next are stood in for by a script that says it ran, so
     a push that gets past the guard shows it. */
  fs.mkdirSync(path.join(repo, '.githooks')); fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(path.join(ROOT, '.githooks', 'pre-push'), path.join(repo, '.githooks', 'pre-push'));
  fs.chmodSync(path.join(repo, '.githooks', 'pre-push'), 0o755);
  fs.copyFileSync(GUARD, path.join(repo, 'scripts', 'leak-guard.js'));
  fs.writeFileSync(path.join(repo, 'scripts', 'test-public.js'), "console.log('stand-in suites ran');\n");
  const push = (...a) => {
    try { return { code: 0, out: execFileSync('git', ['-c', 'core.hooksPath=.githooks', 'push', ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  const onRemote = ref => execFileSync('git', ['ls-remote', remote, 'refs/heads/' + ref], { encoding: 'utf8' }).trim().length > 0;
  git('checkout', '-q', '-b', 'leaky', base);
  put('content/hook.json', '{}'); git('add', '-f', 'content/hook.json'); git('commit', '-q', '-m', 'add');
  git('rm', '-q', 'content/hook.json'); git('commit', '-q', '-m', 'remove it again');
  r = push('origin', 'leaky');
  ok('the pre-push hook refuses such a push, and the remote never receives it',
     r.code !== 0 && /content\/hook\.json/.test(r.out) && !/stand-in suites ran/.test(r.out) && !onRemote('leaky'),
     r.out.match(/PATH.*/)?.[0] || r.out.trim().split('\n').slice(-1)[0]);
  git('checkout', '-q', '-b', 'tidy', base);
  put('tidy.md', 'ordinary\n'); git('add', 'tidy.md'); git('commit', '-q', '-m', 'tidy');
  r = push('origin', 'tidy');
  ok('and lets a clean one through to the suites and the remote', r.code === 0 && /stand-in suites ran/.test(r.out) && onRemote('tidy'),
     r.out.trim().split('\n').slice(-1)[0]);
  fs.rmSync(work, { recursive: true, force: true });
}

head('the knowledge graph cannot read what leak-guard refuses');
{
  /* graphify reads .gitignore and then .graphifyignore — and under
     `--no-gitignore` it reads .graphifyignore ALONE. So .gitignore listing
     the corpus protects the default run and nothing else; the flag that
     would walk the licensed export into a graph is precisely the case where
     only this file counts.

     Derived from leak-guard's OWN lists rather than retyped, so a directory
     added to the guard is a directory this file must name, and the two
     cannot drift apart. */
  const GUARD_SRC = fs.readFileSync(GUARD, 'utf8');
  const listOf = name => {
    const m = new RegExp('const ' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(GUARD_SRC);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
  };
  const required = [].concat(listOf('DIRS') || [], listOf('DERIVED') || [], listOf('FILES') || []);
  /* Vacuity guard: an empty required list would make "all present" true. */
  ok('leak-guard\'s path lists were found and are not empty',
     required.length >= 5 && required.includes('content/'), required.join(' '));
  const giPath = path.join(ROOT, '.graphifyignore');
  const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  ok('.graphifyignore exists', gi.length > 0);
  /* Lines that are live patterns, with comments and blanks dropped the way
     graphify's own parser drops them. */
  const live = gi.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const missing = required.filter(p => !live.includes(p));
  ok('it names every path leak-guard refuses, so --no-gitignore stays safe',
     missing.length === 0, missing.join(', ') || `${required.length} paths`);
  /* And it re-includes none of them. A `!content/` line would undo the entry
     above it by last-match-wins — the one way this file could make things
     worse than having no file at all. */
  const reincluded = live.filter(l => l.startsWith('!') &&
    required.some(p => l.slice(1).replace(/^\//, '').startsWith(p.replace(/\/$/, ''))));
  ok('and none of them is re-included by a negation', reincluded.length === 0,
     reincluded.join(', ') || 'none');
}

head('the hook is wired the way the README says');
{
  const hook = path.join(ROOT, '.githooks', 'pre-commit');
  ok('the pre-commit hook exists', fs.existsSync(hook));
  const src = fs.readFileSync(hook, 'utf8');
  ok('it calls the guard', /leak-guard\.js/.test(src));
  ok('and it says how to turn it on, since cloning does not',
     /core\.hooksPath/.test(src));
  /* ASKS GIT, NOT THE FILESYSTEM. This read fs.statSync(hook).mode & 0o111,
     which is the Unix executable bit — a thing NTFS does not have. Node reports
     0o666 for every file on Windows, so the check could not pass there however
     correct the repository was, and it failed every run on the owner's laptop.

     It was also asking the wrong question on Linux. What makes a hook
     executable in someone else's clone is the mode GIT RECORDS (100755), not
     the mode this checkout happens to have — a Windows checkout has no bit and
     the Unix clone made from the same commit still does. So the property that
     travels is the one in the index, and it is the same answer on every
     platform. */
  const mode = (() => {
    try {
      return execFileSync('git', ['ls-files', '-s', '.githooks/pre-commit'],
                          { cwd: ROOT, encoding: 'utf8' }).trim().split(/\s+/)[0];
    } catch (_) { return ''; }
  })();
  ok('git records it as executable, so a fresh clone can run it',
     mode === '100755', mode || 'git could not be asked');
  /* The pre-push hook: what it runs, read without its comments, which name
     the guard before the code does. */
  const pushHook = fs.readFileSync(path.join(ROOT, '.githooks', 'pre-push'), 'utf8')
    .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const guardAt = pushHook.search(/node scripts\/leak-guard\.js --push "\$1"/), suitesAt = pushHook.indexOf('scripts/test-public.js');
  ok('the pre-push hook hands the guard the refs git sends it, before the suites run',
     guardAt >= 0 && suitesAt > guardAt, `guard at ${guardAt}, suites at ${suitesAt}`);
  const pushMode = (() => {
    try {
      return execFileSync('git', ['ls-files', '-s', '.githooks/pre-push'], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\s+/)[0];
    } catch (_) { return ''; }
  })();
  ok('and git records it as executable too', pushMode === '100755', pushMode || 'git could not be asked');
  /* And CI reads every commit a pull request adds, from a checkout that has
     them. The logic job, without its comments. */
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
  const logicJob = yml.slice(yml.indexOf('\n  logic:'), yml.indexOf('\n  memorizer-browser:')).split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  ok('CI\u2019s logic job reads every commit a pull request adds, from a checkout that has them',
     /node scripts\/leak-guard\.js --range HEAD\^1\.\.HEAD\^2/.test(logicJob) && /fetch-depth:\s*0\b/.test(logicJob),
     `range ${/--range HEAD\^1/.test(logicJob)}, fetch-depth 0 ${/fetch-depth:\s*0\b/.test(logicJob)}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
