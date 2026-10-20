#!/usr/bin/env node
/*
 * The constraints of the device this app is actually for, checked without one.
 *
 *   node tests/verify-ipad-pure.js
 *
 * Pure Node, no browser, no build. Every check here is a fact about the text
 * of the source, which is the only reason they can run in CI at all.
 *
 * WHY THIS FILE EXISTS. Systole is used on an iPad. The suite runs on
 * Chromium. Everything in between — a syntax Safari cannot parse, a property
 * Safari needs a prefix for — is invisible to it, and both of the rules below
 * are here because the project has already been bitten and wrote the episode
 * down beside the fix:
 *
 *   · pearl.js: "One unsupported character silently took out everything on an
 *     older tablet, and nothing in the suite would have said so, because the
 *     suite runs on Chromium."
 *   · pearlcard-patch.js: "three were written with the unprefixed property
 *     alone and simply do not blur on an iPad — the navigation bar, the figure
 *     lightbox and the Rhythm Lab readout."
 *
 * Both were fixed. Neither was made impossible to reintroduce in a way CI
 * could see, which is what this is.
 *
 * READS THE COMMENT-BLANKED SOURCE. Defensively rather than because anything
 * trips today — checked, not assumed: no comment in src/ contains a literal
 * `(?<=`, so blanking changes no result here and removing it was proven to
 * change none either. It stays because the hazard is structural: the files
 * this scans explain at length why they avoid the thing being scanned for,
 * and the first comment to quote the syntax rather than describe it would
 * otherwise be reported as a violation. Cheap now, correct later.
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

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const blanked = p => blankComments(fs.readFileSync(p, 'utf8'));

/* Everything under src/ but the Worker is parsed by Safari: assemble-app
   fills each module into its slot in the shell byte for byte (one slot per
   module, which verify-app-slots-pure holds), and build-pwa inlines the two
   bank modules into the split build. The patch chain that once rewrote src/
   text on the way in, so that this scan read text the app did not ship, is
   deleted. src/lab is scanned with the rest; a file scanned that does not
   ship can only add a hit, never hide one. */
const SRC_FILES = walk(path.join(ROOT, 'src'));

/* AND THE SHELL, which is most of what Safari parses. app/systole.html holds
   the app logic between the src/ slots, and app/css/*.css is every stylesheet
   the app has, assembled into its one <style>. The patch chain is gone, so
   both are plain source: the file text is the shipped text, less the slots
   assemble-app fills (src/, scanned here anyway, and payloads, which are
   data). The shell is read blanked like everything else; the blanker is not
   an HTML lexer, so a `//` or `/*` in markup can blank text that is not a
   comment. That can only hide a hit, never invent one, and the sentinels
   below catch it hiding a stretch of script that holds one. */
const SHELL = path.join(ROOT, 'app', 'systole.html');
const CSS_FILES = fs.readdirSync(path.join(ROOT, 'app', 'css'))
  .filter(n => n.endsWith('.css')).map(n => path.join(ROOT, 'app', 'css', n));
const SHELL_SENTINELS = ['function icon(', 'async function exportMarkup(', 'async function openSelfTest('];

head('the scan has something to scan');
{
  /* Vacuity guard. Every check below is "count the hits and expect zero",
     which is also what a walk over an empty list returns — the failure mode
     this project produces more than any other. */
  ok('src/ files were found', SRC_FILES.length > 5, `${SRC_FILES.length} files`);
  ok('and every one of them is a file with code in it',
     SRC_FILES.every(f => blanked(f).trim().length > 40));
  ok('and blanking leaves the code behind',
     /function\s|const\s/.test(blanked(path.join(ROOT, 'src', 'core', 'pearl.js'))));
  const shell = blanked(SHELL);
  const lost = SHELL_SENTINELS.filter(t => shell.indexOf(t) < 0);
  ok('the shell is read, and blanking leaves its script from first function to last',
     lost.length === 0, lost.length ? 'blanked away: ' + lost.join(', ') : `${SHELL_SENTINELS.length} sentinels`);
  ok('app/css has the stylesheets', CSS_FILES.length > 5, `${CSS_FILES.length} files`);
}

head('nothing in src/ or the shell ships a regex lookbehind');
{
  /* A lookbehind is a parse-time SyntaxError on iPadOS Safari below 16.4 — not
     a caught exception but a dead <script> block, and in this app that block
     holds the rhythm registry, the scheduler and most of the rest. One
     character costs an older tablet the application.

     verify-apex already asserts this against the BUILT BUNDLE, which is
     stronger — it covers whatever the chain emits, including the ACCSAP base.
     It also needs a build and a browser, so it runs on one machine, when
     someone remembers. This is the same rule where it can run on every push,
     over the files whose every character is embedded verbatim: src/ and the
     shell. Narrower and immediate; that one stays broader and occasional. */
  const hits = [];
  for (const f of [...SRC_FILES, SHELL]) {
    const m = blanked(f).match(/\(\?<[=!]/g);
    if (m) hits.push(`${rel(f)} ×${m.length}`);
  }
  ok('no lookbehind assertion in any src/ module or the shell', hits.length === 0, hits.join(', '));
}

head('every glass surface blurs on an iPad');
{
  /* iPadOS Safari shipped backdrop-filter behind -webkit- until Safari 18, and
     three of this app's glass surfaces once carried the plain property alone
     and simply did not blur on the one device this is for.

     THIS RULE WAS TAKEN OUT OF HERE ONCE, for a reason that no longer holds:
     the CSS lived in patch scripts, and a patch's find string is the
     unprefixed BEFORE, so a scan of the source reported the fix as the
     defect. The patch chain is deleted; app/css/*.css and the shell are the
     CSS that ships, with no before-state. verify-apex still asserts the same
     over the built bundle, which also covers whatever a src/ module writes.

     Paired by value and count rather than by proximity, as verify-apex does:
     a new unprefixed rule written beside a correct one sits inside any
     proximity window and reads as fine. Inline style strings in the shell's
     script count too, so the shell is read with the stylesheets. */
  const norm = v => v.trim().replace(/\s+/g, ' ').toLowerCase();
  const webkit = new Map(), plain = new Map(), where = new Map();
  for (const f of [...CSS_FILES, SHELL]) {
    const src = blanked(f);
    for (const [re, into] of [[/-webkit-backdrop-filter\s*:\s*([^;}\n"'`]+)/g, webkit],
                              [/(?:^|[^-\w])backdrop-filter\s*:\s*([^;}\n"'`]+)/g, plain]]) {
      let m;
      while ((m = re.exec(src))) {
        const k = norm(m[1]);
        into.set(k, (into.get(k) || 0) + 1);
        if (into === plain && !where.has(k))
          where.set(k, `${rel(f)}:${src.slice(0, m.index + m[0].indexOf('backdrop')).split('\n').length}`);
      }
    }
  }
  const bare = [];
  for (const [val, n] of plain) {
    const have = webkit.get(val) || 0;
    if (have < n) bare.push(`${val.slice(0, 28)}: ${n} plain, ${have} prefixed (first at ${where.get(val)})`);
  }
  /* Vacuity guard: this is a zero-count, and a source with no glass at all
     would satisfy it for ever. */
  ok('the stylesheets have glass surfaces to check', plain.size > 0, `${plain.size} distinct values`);
  ok('each is declared as often with -webkit- as without', bare.length === 0, bare.join(' | '));
}

/* ── the floor, written down once and held to ───────────────────────────────
   THE PROJECT NEVER SAID WHICH iPadOS IT SUPPORTS. It defends against a
   lookbehind because that is a SyntaxError "below Safari 16.4", which fixes
   the ceiling of the problem and leaves the floor unstated — so whether `?.`
   (13.1) or crypto.randomUUID (15.4) was allowed had to be re-decided, by
   feel, every time it came up.

   IT IS NOT A PREFERENCE, IT IS ALREADY DECIDED. The shipped app uses optional
   chaining and ?? in six patch replacements — heartreuse, heroart, polish,
   calibrate, gemini and mistral — and both landed in Safari 13.1, which is
   iPadOS 13.4. Nothing can lower the floor below that without those going
   first. So 13.4 is not chosen here; it is read off the code and written down.

   WHAT THIS CHECKS IS THE CEILING ON NEW WORK. Everything below shipped AFTER
   Safari 13.4, so any of it appearing in src/ or the shell would raise the
   floor silently.
   Each one is the kind of thing that gets reached for without thinking —
   .at(-1) instead of [len-1], structuredClone instead of a JSON round trip —
   and none of them announces that it has just dropped support for a tablet.

   FEATURE-GUARDED USE IS NOT A FLOOR, and the app already does this properly:
   ResizeObserver is behind `typeof ResizeObserver!=='undefined'` with a resize
   listener as the fallback, and startViewTransition is guarded in the shell.
   Neither is in the list below, so neither is flagged. A listed construct is
   flagged guarded or not, and the fix is the older spelling. */
const FLOOR = '13.4';
const ABOVE_FLOOR = [
  ['Array.prototype.at', /\.at\(\s*-?\d/, 'Safari 15.4'],
  ['Object.hasOwn', /\bObject\.hasOwn\s*\(/, 'Safari 15.4'],
  ['Array.prototype.findLast', /\.findLast(?:Index)?\s*\(/, 'Safari 15.4'],
  ['structuredClone', /\bstructuredClone\s*\(/, 'Safari 15.4'],
  ['crypto.randomUUID', /\bcrypto\.randomUUID\b/, 'Safari 15.4'],
  ['logical assignment (||= &&= ??=)', /(?:\|\||&&|\?\?)=[^=]/, 'Safari 14'],
  ['Promise.any', /\bPromise\.any\s*\(/, 'Safari 14'],
  ['Intl.RelativeTimeFormat', /\bIntl\.RelativeTimeFormat\b/, 'Safari 14'],
  ['AbortSignal.timeout', /\bAbortSignal\.timeout\b/, 'Safari 16'],
  ['Array.prototype.group', /\.group(?:By)?\s*\(/, 'Safari 17.4'],
];

/* WHAT SAFARI ACTUALLY PARSES, which is not all of src/. src/worker/apex.js
   is the Cloudflare Worker that holds the Gemini key: build-pwa.js writes it
   out as _worker.js at the root of the upload, where Cloudflare runs it, and
   it is never embedded into the HTML the iPad loads. Holding it to Safari's
   floor would be holding server code to a browser's limits — it uses
   AbortSignal.timeout quite legitimately.

   THE EXCLUSION IS ASSERTED, NOT ASSUMED, below: if that file ever starts
   being embedded into the bundle, the check that says it is not will fail
   before this list silently stops covering it. */
const SAFARI_FILES = SRC_FILES.filter(f => !/[\\/]worker[\\/]/.test(f));

head('the worker is server code, and is excluded on that basis');
{
  ok('src/ has a worker to exclude', SRC_FILES.length - SAFARI_FILES.length === 1,
     `${SRC_FILES.length - SAFARI_FILES.length} excluded`);
  const pwa = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8');
  ok('build-pwa writes it out as its own file, not into the bundle',
     /_worker\.js/.test(pwa) && /'worker',\s*'apex\.js'/.test(pwa));
  ok('and no patch step embeds it into the app',
     fs.readdirSync(path.join(ROOT, 'scripts'))
       .filter(n => /-patch\.js$/.test(n))
       .every(n => !/worker[\\/]apex/.test(fs.readFileSync(path.join(ROOT, 'scripts', n), 'utf8'))));
  ok('so what Safari parses is the rest', SAFARI_FILES.length > 5, `${SAFARI_FILES.length} files`);
}

head(`no script Safari parses needs a Safari newer than the floor (iPadOS ${FLOOR})`);
{
  /* Script only: src/ less the worker, and the shell. The list is of script
     constructs, so the stylesheets are not scanned against it, and a CSS
     feature newer than the floor is not something this check would see. */
  const hits = [];
  for (const f of [...SAFARI_FILES, SHELL]) {
    const src = blanked(f);
    for (const [name, re, since] of ABOVE_FLOOR) {
      const g = new RegExp(re.source, 'g');
      const n = (src.match(g) || []).length;
      if (n) hits.push(`${rel(f)}: ${name} ×${n} (${since})`);
    }
  }
  ok('no construct that arrived after the floor', hits.length === 0, hits.join('; ') || 'none');
  /* Vacuity guard, and a real one: the list above is only worth anything if
     its patterns match the thing they name. A typo'd regex matches nothing and
     the check passes forever. */
  const fixture = 'a.at(-1); Object.hasOwn(o,"k"); structuredClone(x); ' +
                  'crypto.randomUUID(); let z; z ||= 1; Promise.any([]); ' +
                  'new Intl.RelativeTimeFormat(); AbortSignal.timeout(1); ' +
                  'xs.findLast(f); xs.groupBy(f);';
  const matched = ABOVE_FLOOR.filter(([, re]) => re.test(fixture));
  ok('and every pattern in the list can actually match',
     matched.length === ABOVE_FLOOR.length,
     `${matched.length} of ${ABOVE_FLOOR.length}` +
     (matched.length === ABOVE_FLOOR.length ? ''
       : ' — missed: ' + ABOVE_FLOOR.filter(x => !matched.includes(x)).map(x => x[0]).join(', ')));
}

head('and a file is read through the fallbacks, because the list cannot tell a Blob from a Response');
{
  /* Blob.arrayBuffer(), Blob.text() and Blob.stream() came in Safari 14. A Response has the first two from Safari 10 and spells them the same,
     so the list above cannot name the spelling without flagging every fetch (memorizer/src/ocr.js says as much). The sites are counted
     instead: in the shell each is the line in blobBytes() or blobText() that uses the method only where it exists, and anywhere else it is a
     Response. A site that is neither fails here until somebody says which it is, which for a file the picker hands over means those two
     helpers. The import that uses them is run on a page made to lack the methods in tests/verify-assets.js.

     THE GENERATED LOADER IS BROWSER CODE TOO. scripts/build-pwa.js holds the page that opens a code-only deploy as a template literal, and its
     import screen reads the package the user picks before the app can open at all; a Blob call there fails on the floor with the app still
     closed. It is read here as it is, and its one Blob read is packageBytes(). (Its comments are text to the blanker, so they are written without
     the call syntax.) The screen is run on a page made to lack the method in tests/verify-bankstore.js. */
  const SITE = /\.(?:arrayBuffer|text|stream)\s*\(\s*\)/;
  const GUARDED = /typeof\s+(\w+)\.(arrayBuffer|text)\s*===\s*'function'\s*\)\s*return\s+\1\.\2\(\)/;
  const RESPONSES = [/\(await fetchOk\([^)\n]*\)\)\.arrayBuffer\(\)/,          // src/core/heart3d.js
                     /\br\.ok\s*\?\s*r\.arrayBuffer\(\)/,                      // scripts/build-pwa.js, the heart mesh
                     /\bcodeResponse\.text\(\)/];                               // scripts/build-pwa.js, the app's code
  const response = l => RESPONSES.some(re => re.test(l));
  const at = f => blanked(f).split('\n').map((line, i) => ({ at: `${rel(f)}:${i + 1}`, line })).filter(s => SITE.test(s.line));
  const show = a => a.map(s => `${s.at}: ${s.line.trim().slice(0, 70)}`).join('; ');
  const shell = at(SHELL), loader = at(path.join(ROOT, 'scripts', 'build-pwa.js')), elsewhere = SAFARI_FILES.flatMap(at);
  ok('the shell reads a Blob only in blobBytes() and blobText(), where the method is used only if it exists',
     shell.length === 2 && shell.every(s => GUARDED.test(s.line)), show(shell) || 'no site');
  ok('the generated loader reads the package only in packageBytes(), where the method is used only if it exists, and calls the others on a Response',
     loader.filter(s => GUARDED.test(s.line)).length === 1 && loader.every(s => GUARDED.test(s.line) || response(s.line)), show(loader) || 'no site');
  ok('and nothing else Safari parses calls them on anything but a Response',
     elsewhere.every(s => response(s.line)), show(elsewhere.filter(s => !response(s.line))) || `${elsewhere.length} Response`);
  const fixture = ['const t = await file.text();', 'new Uint8Array(await f.arrayBuffer())', 'var zip = await ZipRead.read(await file.arrayBuffer());',
                   'const bin = await (await fetchOk(src.bin)).arrayBuffer();', 'return r.ok ? r.arrayBuffer() : null;',
                   "if(typeof file.arrayBuffer === 'function') return file.arrayBuffer();", "if(typeof f.text==='function') return f.text();"];
  const verdict = fixture.map(l => SITE.test(l) && (GUARDED.test(l) || response(l)));
  ok('and the patterns tell them apart: a Blob\'s call is refused, a Response\'s and the fallback\'s are not',
     verdict.join() === 'false,false,false,true,true,true,true', verdict.join());
}

head('and a viewport height Safari before 15.4 does not know always has one it does before it');
{
  /* dvh, svh and lvh came in Safari 15.4. A browser that does not know a unit drops the declaration that uses it, whole, so a height set only in
     dvh is no height there. In portrait the page sets html and body to overflow:hidden and gives #shell its height in dvh; without the height the
     shell grows to its content, the body clips it, and nothing scrolls: measured with the unit made unknown to the engine, the home screen of an
     iPad 11" in portrait ended at 1553 px on a 1194 px screen, with no way to reach the rest. The way out is the one base.css already takes for
     the body: the same property in vh first, which the older Safari reads and the newer one overrides.

     WHAT IS HELD IS THE ORDER AND THE PROPERTY. An earlier declaration of the same property in the same block, whose value holds no such unit.
     After the dvh it would override it in a Safari that knows it; on another property it is not a fallback; in another rule it is a cascade that
     the next edit to either rule can break. A custom property holding the unit is not a declaration that can fall back at all: it parses, and
     the declaration that uses it fails later, past every earlier one. None is in use; the reader finds one if it is added. */
  const NEW_UNIT = /(?:\d|\.)[dsl]v(?:h|w|i|b|min|max)\b/i;
  const lineOf = (text, i) => text.slice(0, i).split('\n').length;
  function newUnitsWithoutFallback(css) {
    const blank = blankComments(css).replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));
    const bad = []; let used = 0, b;
    const block = /\{([^{}]*)\}/g;
    while ((b = block.exec(blank))) {
      const body = b[1], decls = []; let depth = 0, start = 0;
      for (let i = 0; i <= body.length; i++) {
        const c = body[i];
        if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
        if ((c === ';' && depth === 0) || i === body.length) { decls.push({ text: body.slice(start, i), at: b.index + 1 + start }); start = i + 1; }
      }
      const known = [];
      for (const d of decls) {
        const m = /^\s*([-\w]+)\s*:([\s\S]*)$/.exec(d.text);
        if (!m) continue;
        const prop = m[1].toLowerCase();
        if (!NEW_UNIT.test(m[2])) { known.push(prop); continue; }
        used++;
        if (prop.startsWith('--') || !known.includes(prop))
          bad.push(`${prop}:${m[2].trim().replace(/\s+/g, ' ').slice(0, 40)} at line ${lineOf(blank, d.at + d.text.search(/\S/))}`);
      }
    }
    return { bad, used };
  }
  const bad = css => newUnitsWithoutFallback(css).bad.length;
  ok('the reader finds a height in dvh with nothing before it', bad('.a{height:100dvh}') === 1);
  ok('and not one with the same property in vh before it, in a calc or not', bad('.a{height:100vh;height:100dvh}') === 0 && bad('.a{min-height:calc(100vh - 4px);min-height:calc(100dvh - 4px)}') === 0);
  ok('but a vh after it is no fallback: a browser that knows dvh then uses the vh', bad('.a{height:100dvh;height:100vh}') === 1);
  ok('nor is a vh on another property', bad('.a{min-height:100vh;height:100dvh}') === 1);
  ok('nor a vh in another rule', bad('.a{height:100vh}.a{height:100dvh}') === 1);
  ok('svh and lvh are as new as dvh, and so are the width, inline, block and min and max forms',
     bad('.a{height:100svh}.b{height:100lvh}') === 2 && bad('.a{width:100dvw}.b{width:100svi}.c{height:100lvb}.d{width:50dvmin}.e{width:50svmax}') === 5);
  ok('a rule inside @media is read like any other', bad('@media (min-width:700px){.a{height:100dvh}}') === 1 && bad('@media (min-width:700px){.a{height:100vh;height:100dvh}}') === 0);
  ok('a custom property holding the unit is found even after one that does not, because it cannot fall back', bad(':root{--h:100dvh}') === 1 && bad(':root{--h:100vh;--h:100dvh}') === 1);
  ok('a unit in a comment or a string is not a declaration, and vh, % and px are not new',
     bad('/* height:100dvh */ .a{content:"height:100dvh"}') === 0 && bad('.a{height:100vh;width:50%;top:4px}') === 0);
  ok('and a semicolon inside parentheses does not end a declaration, so a fallback written inside a url() is none',
     bad('.a{background:url(data:image/png;height:100vh);height:100dvh}') === 1 && bad('.a{background:url(data:image/png;base64,AAAA);height:100vh;height:100dvh}') === 0);

  const FAMILIES = [['the Systole app', CSS_FILES],
                    ['the Memorizer', [path.join(ROOT, 'memorizer', 'app.css')]],
                    ['the Lab page', [path.join(ROOT, 'lab', 'app.css')]]];
  let used = 0;
  for (const [name, files] of FAMILIES) {
    const read = files.map(f => ({ f, ...newUnitsWithoutFallback(fs.readFileSync(f, 'utf8')) }));
    used += read.reduce((n, r) => n + r.used, 0);
    const lost = read.flatMap(r => r.bad.map(x => `${rel(r.f)}: ${x}`));
    ok(`${name}: every viewport height Safari before 15.4 does not know has one it does before it`, lost.length === 0,
       lost.slice(0, 3).join(' | ') || `${read.reduce((n, r) => n + r.used, 0)} declarations in ${files.length} file(s)`);
  }
  ok('and there are such declarations to check, so the scan is not reading nothing', used > 0, `${used} declarations`);
  const inline = [...SAFARI_FILES, SHELL].filter(f => NEW_UNIT.test(blanked(f))).map(rel);
  ok('none is written in the shell\'s markup or script or in a src/ module, where a style attribute cannot carry a fallback', inline.length === 0, inline.join(', ') || 'none');
}

head('and the floor is written down where somebody will find it');
{
  /* Prose follows the record here too. A floor that lives only in this file is
     a floor nobody reading the README knows about, and a floor in the README
     alone is one that drifts. */
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const m = readme.match(/\*\*iPadOS (\d+\.\d+) or newer\.\*\*/);
  ok('README states a minimum iPadOS', !!m, m ? m[1] : 'no such sentence');
  ok('and it is the same floor this file checks against',
     !!m && m[1] === FLOOR, m ? `README ${m[1]} vs ${FLOOR}` : '—');
  /* \s+ RATHER THAN A SPACE. The first version matched /optional chaining/ and
     went red on a README that says exactly that — markdown hard-wraps, the
     phrase straddles a line break, and the check was testing the column width
     of a paragraph rather than its content. */
  ok('and it says why, rather than only what',
     /optional\s+chaining/.test(readme) && /<script>/.test(readme));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
