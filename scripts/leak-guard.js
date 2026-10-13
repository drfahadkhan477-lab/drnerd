#!/usr/bin/env node
/*
 * Refuse to commit the licensed question bank.
 *
 *   node scripts/leak-guard.js                 # whatever is staged
 *   node scripts/leak-guard.js <path>...       # specific files
 *   node scripts/leak-guard.js --all-tracked   # everything git already has
 *   node scripts/leak-guard.js --push [remote] # every commit a push sends (pre-push stdin)
 *   node scripts/leak-guard.js --range <revs>  # every commit in a rev-list range (CI)
 *
 * Exit 0: nothing licensed. 1: something refused, named. 2: it could not look
 * (git did not answer, a named file could not be read), so it certifies
 * nothing. The staged and --all-tracked routes judge the blobs in git's index,
 * which is what a commit takes; named paths are read from disk; --push and
 * --range judge every blob the commits add, in any of them, so a file added
 * and deleted again is still caught (historyEntries below).
 *
 * WHY .gitignore IS NOT ENOUGH, which is the whole point. content/, build/,
 * dist/ and source/ are ignored, and that holds right up until someone types
 * `git add -f`, or renames an export to something that does not match a
 * pattern, or drags a figure into assets/ because that is where images live.
 * .gitignore is a default, not a boundary; nothing in this repository has
 * been a boundary.
 *
 * What is at stake is not a mess in the history. It is 638 questions and 408
 * figures belonging to the American College of Cardiology, in a public
 * repository, published under the owner's name — and git history is not
 * something you can quietly take back.
 *
 * SEVEN RULES, in the order they fire. Each names what it is for, because a
 * guard that refuses without saying why gets disabled the first time it is
 * inconvenient:
 *
 *   1. PATH      anything under content/, build/, dist/ or source/, plus
 *                tests/last-run.log, whose output quotes question text, plus
 *                graphify-out/, which is not the corpus but is built from it,
 *                plus memorizer/samples/, where the chapters Memorizer is
 *                tried on are kept.
 *   1b. LOG      the same log SAVED UNDER ANOTHER NAME, recognised by the
 *                header scripts/verify.js writes rather than by its filename.
 *                `verify.js > 1.txt` produces identical content and rule 1
 *                only knows the one path.
 *   2. NAME      an ACCSAP export by its filename, wherever it has been moved.
 *   3. SIZE      anything over 1 MB. The largest file this repository legiti-
 *                mately tracks is app/systole.html, and CI runs --all-tracked,
 *                so the day anything tracked crosses the limit is a red check
 *                rather than a surprise. (This said 168 KB, lottie.min.js,
 *                until app/ was frozen; no number here, so it cannot go stale.)
 *   3b. IMAGE    an image or a PDF, by its extension or by its first bytes
 *                (an SVG by its root element), at any size, unless
 *                KNOWN_BINARIES lists its exact path. A
 *                real figure is tens of KB and a split PDF can be too: both
 *                walk under rule 3, and neither carries the text the content
 *                rules read.
 *   4. PAYLOAD   `const ALL_Q=[` or `const IMGS={` in a file over 200 KB. The
 *                marker ALONE is not enough and must not be: eight tracked
 *                source files contain it on purpose — the patch scripts that
 *                search for it, and the tests that assert they found it. Size
 *                is what separates a script that mentions the bank from the
 *                bank. This is the rule that catches a renamed export.
 *   5. FIGURES   eight or more base64 image payloads in one file, AT ANY SIZE
 *                — a figure dump whatever it has been called. Unlike PAYLOAD,
 *                this has no floor: eight embedded images is not something a
 *                small file produces by coincidence, so there is nothing here
 *                for a floor to protect against. A figure dump small enough
 *                to sit under PAYLOAD's 200 KB floor still has to clear this
 *                one.
 *   6. PACK      a Memorizer study pack, or the prompt that asks Claude for
 *                one — not the question bank, the owner's own textbook, which
 *                the prompt carries page by page. Recognised by content, at
 *                any size: see PACKJSON below.
 *
 * THE ESCAPE HATCH IS TYPED, ONCE, PER PATH. Same bargain as PENDING_RECORD in
 * scripts/verify.js: a blanket --force would be used the first time rule 3
 * fired on something innocent and never removed. ALLOW below is a list a
 * person edits with a reason attached.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

/* A failure to look is not a pass. Enumerating files or reading one the
   guard was asked about exits 2, never 0 with "0 file(s) checked". */
function cannot(what, e) {
  console.error(`leak-guard: could not ${what}: ${(e && e.message || String(e)).split('\n')[0]}`);
  console.error('leak-guard: nothing was certified. Fix the cause and run it again.');
  process.exit(2);
}

const MAX_BYTES          = 1024 * 1024;
const PAYLOAD_SNIFF_BYTES = 200 * 1024;
/* PAYLOAD only ever runs on files BETWEEN this floor and the size cap, so the
   most it can read is 1 MB and reading it whole costs nothing. The first
   version read a 64 KB head instead, on the reasoning that a marker would be
   near the top — and the test caught that it need not be. An export whose
   `const ALL_Q=` sits after the embedded fonts, which in the real build it
   does, sailed through. The head window was protecting against reading a
   40 MB export, and rule 3 already refuses that before these rules are
   reached.

   FIGURES has no floor of its own (see rule 5 above) and reads whatever SIZE
   already let through — this constant names PAYLOAD's floor specifically,
   not a shared one, because it no longer is one. */

const DIRS  = ['content/', 'build/', 'dist/', 'source/'];
/* RULE 1, SECOND HALF: A DIRECTORY THAT IS NOT THE CORPUS BUT IS MADE OF IT.
 *
 * graphify-out/ is where `graphify` writes a knowledge graph — graph.json, a
 * GRAPH_REPORT.md and a graph.html — over whatever folder it was pointed at.
 *
 * IT DOES NOT REACH THE CORPUS BY DEFAULT, and the first version of this
 * comment claimed it did. graphify's own walker takes `gitignore=True` by
 * default, and content/, build/, dist/ and source/ are every one of them
 * gitignored, so a default run skips all four. Measured, not read: detect()
 * over a fixture with a gitignored content/ returned 1 file and listed
 * content/ under `ignored`; the same call with gitignore=False returned 2 and
 * indexed content/secret.py.
 *
 * What this rule is for is the opt-out, which is one flag wide. `--no-gitignore`
 * turns the walker loose on the ignored directories, and a .graphifyignore is
 * loaded regardless of it and can re-include a path on its own. Either route
 * puts node labels and excerpts of the licensed question text into graph.json,
 * under a directory name that says nothing about it — and every other rule in
 * this file looks straight past that file.
 *
 * Rule 3 is not the backstop it appears to be. It is a cap, not a floor: a
 * graph over the full bank would exceed 1 MB and be refused, but a graph of one
 * subdirectory sits under the cap and is waved through. Below it, rule 4's
 * markers (`const ALL_Q=[`, `const IMGS={`) are JavaScript and absent from a
 * JSON graph, and rule 5 wants eight base64 images a graph does not embed —
 * and both need 200 KB before they look at all. So a small graph.json walked
 * past all five.
 * Verified before this list existed: `node scripts/leak-guard.js
 * graphify-out/graph.json` printed "nothing licensed" and exited 0.
 *
 * Kept separate from DIRS so the refusal says what is true of it. These are
 * not licensed content; they are built from it, and a guard that mislabels
 * what it caught is the kind that gets argued with. */
const DERIVED = ['graphify-out/'];
const FILES = ['tests/last-run.log'];
/* RULE 1, THIRD HALF: NOT THE CORPUS, AND STILL NOT OURS. memorizer/samples/
   is gitignored as the place to keep the PDFs Memorizer is tried on — a
   chapter of somebody's book. Kept apart from DIRS so the refusal says that,
   not "licensed content". */
const OWN = ['memorizer/samples/'];
/* RULE 1b, AND IT IS HERE BECAUSE OF A FILE CALLED tests/1.txt.
 *
 * `node scripts/verify.js > 1.txt` is the obvious thing to type when you want
 * to keep a run, and what it writes carries the failing suites' output, as
 * tests/last-run.log does — and suite output quotes question text. FILES above blocks that
 * log BY NAME, so the identical content under any other name walked past
 * every rule in this file: not in a licensed directory, not an ACCSAP
 * filename, and a failing run's log is comfortably under both the 1 MB cap
 * and the 200 KB sniff floor that rules 4 and 5 need before they will look.
 *
 * A real one sat untracked in the owner's checkout for eight days. Nothing
 * was committed; nothing stops it being, which is the same distinction this
 * file's header draws about .gitignore — a default is not a boundary.
 *
 * So the log is recognised by what it SAYS rather than what it is called.
 * scripts/verify.js prints this header as the first line of every run on
 * stdout, and opens tests/last-run.log with it, so there is one spelling of
 * it and the guard moves when the runner does. (Until the master review of
 * 2026-10-10 only the log carried it, and a redirected run walked past.) */
const LOGHEAD = /^#\s*systole verify\s+—/;
/* RULE 6: THE OWNER'S TEXTBOOK, BY WAY OF MEMORIZER.
 *
 * memorizer/src/pack.js writes a prompt that carries a chapter of the
 * owner's book, page by page, for them to paste into their own Claude chat,
 * and imports the JSON pack Claude writes back. Both live on the device
 * (IndexedDB) and the app never writes either to disk. But a reply saved to
 * a file to paste in later, or a prompt kept for next time, is the book in a
 * file, in a public repository — and like a verify log, it is small enough
 * to walk under every size rule here.
 *
 * So it is recognised by what it says: the pack's format marker AS JSON
 * WRITES IT, with the key quoted — which the prompt carries too, in the
 * shape it asks Claude for. The source files that name the format, pack.js
 * and its tests, build it as a JavaScript string and do not contain it.
 * (A second test, for the prompt's first line, was written and taken out:
 * with it removed the suite stayed green, because every prompt already
 * carries the marker. It measured nothing this one does not.) */
const PACKJSON = /"format"\s*:\s*"memorizer-pack"/;
const NAME  = /ACCSAP|_super_v\d|question-bank|questions\.json$/i;
const PAYLOAD = /const\s+(ALL_Q\s*=\s*\[|IMGS\s*=\s*\{)/;
const B64IMG  = /data:image\/(?:webp|jpeg|png|gif);base64,/g;
const B64_MANY = 8;

/* RULE 3b: A FIGURE, OR A SPLIT PDF, AT THE SIZE THEY REALLY ARE.
   The header has always said .gitignore is not enough because someone
   "drags a figure into assets/", and nothing here caught one: a real figure
   is tens of KB, rule 3 starts at 1 MB, and the content rules read text a
   picture does not have (found by review). So an image or a PDF is refused
   wherever it is and whatever it weighs, by extension and, for a renamed one,
   by its first bytes — unless it is one of the binaries this repository
   ships on purpose, each named here with what it is. Narrower than ALLOW:
   a path listed here is exempt from this rule and no other. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|heic|svg|pdf)$/i;
const KNOWN_BINARIES = [
  'assets/hero-heart/heart.webp',   // the home screen's heart, drawn for this app
];
/* Every format IMAGE_EXT names is recognised renamed too, by its first bytes
   or, for an SVG, by its root element. This listed only PNG, JPEG, GIF, WebP
   and PDF, so a BMP, a TIFF, an AVIF or HEIC, or an SVG renamed to .bin
   passed as "nothing licensed" (found by review, #240). */
const BMFF_STILL = new Set(['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
function imageMagic(b, size) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'a PNG';
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'a JPEG';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'a GIF';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'a WebP';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'a PDF';
  /* "BM" alone would match a text file that starts with those letters, so
     the header must also give the file's own length, and its reserved bytes
     must be zero, which no text has. */
  if (b.length >= 10 && b[0] === 0x42 && b[1] === 0x4D && b.readUInt32LE(2) === size && b.readUInt32LE(6) === 0) return 'a BMP';
  const four = b.subarray(0, 4).toString('latin1');
  if (['II*\0', 'MM\0*', 'II+\0', 'MM\0+'].includes(four)) return 'a TIFF';
  /* An ISO media file holding a still image, by any brand of its ftyp box. A
     video's brands are not listed. */
  if (ftypBrands(b).some(brand => BMFF_STILL.has(brand))) return 'an AVIF or HEIC image';
  return null;
}
/* The brands of an ftyp box at the start of the file: the major brand, then
   the compatible brands after the minor version, up to the box's own length.
   An AVIF may name a generic major brand (iso8, say) and list avif only among
   its compatible brands, and reading the major brand alone let that file
   through (found by review, #246). The major brand is read whatever the size
   field says, as it was before; a 64-bit size (1) and a box running to the end
   of the file (0) are read as ISO BMFF defines them. */
function ftypBrands(b) {
  if (b.length < 12 || b.subarray(4, 8).toString('latin1') !== 'ftyp') return [];
  let size = b.readUInt32BE(0), at = 8;
  if (size === 1 && b.length >= 16) { size = Number(b.readBigUInt64BE(8)); at = 16; }
  const end = size === 0 ? b.length : Math.min(size, b.length), brands = [];
  if (b.length >= at + 4) brands.push(b.subarray(at, at + 4).toString('latin1'));
  for (let i = at + 8; i + 4 <= end; i += 4) brands.push(b.subarray(i, i + 4).toString('latin1'));
  return brands;
}
/* Read the XML prolog once, honoring quotes and comments inside a DTD.
   A bracket inside an entity value must not end the subset. No backtracking
   regex is used: malformed doctypes also take one bounded pass. */
function isSvg(text) {
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at++;
    if (text.startsWith('<?', at) || text.startsWith('<!--', at)) {
      const comment = text.startsWith('<!--', at), end = comment ? '-->' : '?>';
      const next = text.indexOf(end, at + (comment ? 4 : 2));
      if (next < 0) return false;
      at = next + end.length;
    } else if (/^<!DOCTYPE\b/i.test(text.slice(at, at + 10))) {
      let quote = '', depth = 0, closed = false;
      for (at += 9; at < text.length; at++) {
        const c = text[at];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (text.startsWith('<!--', at) || text.startsWith('<?', at)) {
          const comment = text.startsWith('<!--', at), end = comment ? '-->' : '?>';
          const next = text.indexOf(end, at + (comment ? 4 : 2));
          if (next < 0) return false;
          at = next + end.length - 1;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth = Math.max(0, depth - 1);
        else if (c === '>' && depth === 0) { at++; closed = true; break; }
      }
      if (!closed) return false;
    } else break;
  }
  // XML names include non-ASCII and astral characters. Tokenize conservatively;
  // the namespace declaration below decides whether this root denotes SVG.
  const root = text.slice(at).match(/^<(?:([^:\s<>/]+):)?svg(?=[\s/>])/i);
  if (!root) return false;
  if (!root[1]) return true;
  // A prefixed root must bind its prefix to the SVG namespace.
  let end = at + root[0].length, quote = '';
  for (; end < text.length; end++) {
    const c = text[end];
    if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') break;
  }
  // Read attributes once, without matching a namespace inside another value.
  let pos = at + root[0].length;
  while (pos < end) {
    while (pos < end && /\s/.test(text[pos])) pos++;
    const start = pos;
    while (pos < end && !/[\s=/>]/.test(text[pos])) pos++;
    const name = text.slice(start, pos);
    if (!name) { pos++; continue; }
    while (pos < end && /\s/.test(text[pos])) pos++;
    if (text[pos] !== '=') continue;
    pos++;
    while (pos < end && /\s/.test(text[pos])) pos++;
    const delimiter = text[pos++];
    if (delimiter !== '"' && delimiter !== "'") continue;
    const next = text.indexOf(delimiter, pos);
    if (next < 0 || next > end) return false;
    const value = text.slice(pos, next);
    pos = next + 1;
    // References can spell SVG's URI or depend on a DTD entity. Refuse them
    // conservatively; never expand a DTD or load external entities in a hook.
    if (name === `xmlns:${root[1]}`) return value === 'http://www.w3.org/2000/svg' || value.includes('&');
  }
  // A DTD can default the namespace declaration, including from an external
  // subset. Without an explicit unrelated namespace, refuse this SVG-shaped
  // root conservatively rather than resolve a DTD in a licensing hook.
  return true;
}

/* Paths a person has decided are fine, with the reason. Nothing is here yet;
   when something is, it should say why on the same line. */
const ALLOW = [
  // 'tests/fixtures/big-thing.json',   // synthetic, contains no licensed text
];

/* SUBMODULE POINTERS (mode 160000) are a commit id, not content, so they are
   never opened — but they are still held to the path rules. They used to be
   skipped outright, because content/refs-repo was a sanctioned submodule of
   the owner's private notes. That repository is gone and the exception with
   it (CLAUDE.md), so a pointer under content/, source/, build/ or dist/ is
   refused like a file there: it would link a licensed corpus from this public
   repository. Collected here, checked by path only below. */
const gitlinks = [];

/* WHAT GIT WILL COMMIT, NOT WHAT IS ON DISK. The staged and --all-tracked
   routes return { file, blob }: the path and the object id the index holds
   for it. Content rules read that blob. They used to read the working copy,
   so a file staged at 5 MB and then overwritten on disk with "{}" passed while
   git committed the 5 MB, and a staged file deleted from disk was skipped. */
function staged() {
  /* --raw, not --name-only, to see each entry's mode and new blob. -z output:
     ":old new sha sha status" NUL path NUL. Disable rename detection so a
     destination is always checked as an addition; include type changes too. */
  let out;
  try {
    out = execFileSync('git', ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', '--diff-filter=ACMT'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0');
  } catch (e) { cannot('ask git what is staged', e); }
  const files = [];
  for (let i = 0; i + 1 < out.length; i += 2) {
    if (!out[i + 1]) continue;
    const [, mode, , blob] = out[i].split(' ');
    if (mode === '160000') gitlinks.push({ file: out[i + 1] }); else files.push({ file: out[i + 1], blob });
  }
  return files;
}
function tracked() {
  let lines;
  try {
    lines = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch (e) { cannot('ask git what is tracked', e); }
  /* "mode hash stage<tab>path": submodule pointers to one list, files to the other. */
  const files = [];
  for (const line of lines) {
    const tab = line.indexOf('\t'), [mode, blob] = line.slice(0, tab).split(' '), file = line.slice(tab + 1);
    if (mode === '160000') gitlinks.push({ file }); else files.push({ file, blob });
  }
  return files;
}

/* WHAT A PUSH SENDS IS EVERY COMMIT, NOT THE LAST ONE. The pre-commit hook
   sees a commit only when `git commit` makes it: a merge, a rebase, a cherry-
   pick, `git am` and a commit made before the hooks were on never run it.
   The pre-push hook then ran the pure suites, whose leak check is
   --all-tracked: the checked-out tree. So a licensed file added in one commit
   and deleted in the next passed both hooks and CI, and stayed in the
   history the push published; so did any branch pushed while another was
   checked out. Reproduced with the hooks on: content/leak.json added, then
   removed, then pushed, and the 89 pure suites passed.

   So these routes judge every blob each commit adds or changes, against each
   parent (-m: a merge brings in what its other side added), with --root for
   a first commit. Each entry keeps the commit it came in, for the refusal. */
function historyEntries(commits) {
  if (!commits.length) return [];
  let out;
  try {
    out = execFileSync('git', ['diff-tree', '--stdin', '-r', '--root', '-m', '--raw', '--no-abbrev', '--no-renames', '-z', '--diff-filter=ACMT'],
      { input: commits.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }).split('\0');
  } catch (e) { cannot('ask git what those commits add', e); }
  /* -z output: a commit id, then ":old new sha sha status" NUL path NUL for
     each change in it. */
  const files = [], seen = new Set();
  let commit = '';
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    if (out[i][0] !== ':') { commit = out[i].split(' ')[0].slice(0, 12); continue; }
    const [, mode, , blob] = out[i].split(' '), file = out[++i];
    if (seen.has(mode + blob + '\0' + file)) continue;
    seen.add(mode + blob + '\0' + file);
    if (mode === '160000') gitlinks.push({ file, commit }); else files.push({ file, blob, commit });
  }
  return files;
}
function revList(revs) {
  try {
    return execFileSync('git', ['rev-list', ...revs], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n').filter(Boolean);
  } catch (e) { cannot('list the commits to check', e); }
}
/* The commits a push sends, from the lines git hands the pre-push hook on
   stdin: "<local ref> <local sha> <remote ref> <remote sha>". Everything the
   pushed tips reach that the remote's own tip, or this remote's tracking
   refs, do not. A deletion sends nothing. A remote tip this clone has never
   fetched cannot be excluded, so more is checked, never less. */
function pushed(remote) {
  let spec;
  try { spec = fs.readFileSync(0, 'utf8'); } catch (e) { cannot('read the refs git is pushing', e); }
  const ZERO = /^0+$/, tips = [], not = [];
  for (const line of spec.split('\n').map(l => l.trim()).filter(Boolean)) {
    const f = line.split(/\s+/);
    if (f.length !== 4 || !/^[0-9a-f]{40,64}$/.test(f[1]) || !/^[0-9a-f]{40,64}$/.test(f[3]))
      cannot('read the refs git is pushing', new Error(`not a pre-push line: ${line.slice(0, 80)}`));
    if (ZERO.test(f[1])) continue;
    tips.push(f[1]);
    if (!ZERO.test(f[3]) && spawnSync('git', ['cat-file', '-e', f[3] + '^{commit}']).status === 0) not.push(f[3]);
  }
  if (!tips.length) return [];
  /* A remote's name, not a URL: a push to a bare URL has no tracking refs. */
  const mine = remote && /^[A-Za-z0-9._-]+$/.test(remote) ? ['--remotes=' + remote] : [];
  return revList([...tips, '--not', ...not, ...mine]);
}

/* Sizes of every blob in one call, then the contents of those small enough
   for a content rule to need, in a second. One git process each, not one per
   file: --all-tracked covers the whole repository. */
function catBatch(ids, check) {
  if (!ids.length) return Buffer.alloc(0);
  try {
    return execFileSync('git', ['cat-file', check ? '--batch-check' : '--batch'],
      { input: ids.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
  } catch (e) { cannot('read the staged contents from git', e); }
}
function blobSources(entries) {
  const ids = [...new Set(entries.map(e => e.blob))];
  const size = new Map();
  for (const line of catBatch(ids, true).toString('utf8').split('\n').filter(Boolean)) {
    const [id, type, n] = line.split(' ');
    if (type !== 'blob') cannot(`read object ${id}`, new Error(line));
    size.set(id, Number(n));
  }
  /* MAX_BYTES and over is refused on size alone, so its bytes are never read. */
  const want = ids.filter(id => size.get(id) <= MAX_BYTES);
  const body = new Map(), buf = catBatch(want, false);
  let at = 0;
  for (const id of want) {
    const nl = buf.indexOf(10, at);
    const [got, , n] = buf.slice(at, nl).toString('utf8').split(' ');
    if (got !== id || Number(n) !== size.get(id)) cannot(`read object ${id}`, new Error('git cat-file answered out of order'));
    body.set(id, buf.slice(nl + 1, nl + 1 + Number(n)));
    at = nl + 1 + Number(n) + 1;
  }
  return entries.map(e => ({ file: e.file, commit: e.commit, src: {
    size: size.get(e.blob),
    head: n => body.has(e.blob) ? body.get(e.blob).slice(0, n) : Buffer.alloc(0),
    text: () => decode(body.get(e.blob)),
  } }));
}

/* A file named on the command line is read from disk: that is what was asked
   about. One that cannot be read is an error, not a pass. */
function diskSource(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { cannot(`read ${file}`, e); }
  if (!st.isFile()) return null;
  return {
    size: st.size,
    head: n => {
      const fd = fs.openSync(file, 'r');
      try { const b = Buffer.alloc(Math.min(n, st.size)); fs.readSync(fd, b, 0, b.length, 0); return b; }
      finally { fs.closeSync(fd); }
    },
    text: () => decode(fs.readFileSync(file)),
  };
}

/* TEXT AS ITS WRITER ENCODED IT. Windows PowerShell 5.1's `>` writes UTF-16LE
   with a byte-order mark, and `Out-File -Encoding utf8` writes UTF-8 with one;
   read as plain UTF-8 the first is noise and the second does not start with
   what it says, so every text rule below looked straight past them. */
function decode(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return Buffer.from(buf.subarray(2, buf.length - (buf.length % 2))).swap16().toString('utf16le');
  return buf.toString('utf8');
}

function inspect(file, src) {
  const p = file.split(path.sep).join('/');
  if (ALLOW.includes(p)) return null;

  if (DIRS.some(d => p.startsWith(d)))
    return { rule: 'PATH', why: `${p.split('/')[0]}/ is licensed content and is never committed` };
  if (DERIVED.some(d => p.startsWith(d)))
    return { rule: 'PATH', why: `${p.split('/')[0]}/ is built from the licensed corpus and is never committed` };
  if (OWN.some(d => p.startsWith(d)))
    return { rule: 'PATH', why: `${OWN.find(d => p.startsWith(d))} holds study material from someone's book, which is not this repository's to publish` };
  if (FILES.includes(p))
    return { rule: 'PATH', why: 'its output quotes question text' };
  if (NAME.test(path.basename(p)))
    return { rule: 'NAME', why: 'the filename is an ACCSAP export, wherever it has been moved to' };

  const st = src === undefined ? diskSource(file) : src;
  if (!st) return null;

  /* BEFORE THE SIZE RULES, and deliberately. Rules 3, 4 and 5 all have floors
     — 1 MB, then 200 KB — and a verify log is usually under both of them, so
     a check that waited for them would never run on the file it is for. One
     line is enough to recognise it and costs nothing on anything else. */
  if (st.size > 0) {
    let head;
    /* The first line that is not blank and not npm's own echo of the script
       (`npm run verify > 1.txt` starts with "> systole@… verify" lines). A
       file that only mentions the header further down is not a log. */
    try { head = decode(st.head(600)).split(/\r?\n/).find(l => l.trim() && !/^> /.test(l)) || ''; } catch (e) { cannot(`read ${file}`, e); }
    if (LOGHEAD.test(head))
      return { rule: 'LOG', why: 'a verify run log under another name — suite output quotes question text' };
  }

  if (st.size > MAX_BYTES)
    return { rule: 'SIZE', why: `${(st.size / 1048576).toFixed(1)} MB — nothing here legitimately exceeds 1 MB` };
  if (st.size === 0) return null;

  let text;
  const readText = () => {
    if (text === undefined) { try { text = st.text(); } catch (e) { cannot(`read ${file}`, e); } }
    return text;
  };
  if (!KNOWN_BINARIES.includes(p)) {
    let kind;
    /* 256 bytes: every signature above, and an ftyp box with up to sixty
       compatible brands. It read 12, the major brand and no further. */
    try { kind = imageMagic(st.head(256), st.size); } catch (e) { cannot(`read ${file}`, e); }
    /* An SVG's root can sit behind a prolog or a comment of any length, so it
       is looked for in the whole text, which the rules below read anyway. This
       read the first 4 KB, and an SVG behind a 5 KB comment passed (found by
       review, #241). */
    if (!kind && isSvg(readText())) kind = 'an SVG';
    if (kind || IMAGE_EXT.test(p))
      return { rule: 'IMAGE', why: `${kind || 'an image or PDF by its name'} — a figure or a split PDF is refused at any size; list a deliberate one in KNOWN_BINARIES` };
  }
  readText();

  /* FIGURES first, and unconditionally: it has no floor (rule 5's comment
     says why), so it runs on every file rule 3 let through, not just the
     ones over PAYLOAD_SNIFF_BYTES. A small figure dump used to clear every
     rule in this file; this is the fix. */
  if (PACKJSON.test(text))
    return { rule: 'PACK', why: 'a Memorizer study pack, or the prompt for one — both carry your book' };
  if ((text.match(B64IMG) || []).length >= B64_MANY)
    return { rule: 'FIGURES', why: 'it is a figure dump, whatever it has been called' };
  if (st.size > PAYLOAD_SNIFF_BYTES && PAYLOAD.test(text))
    return { rule: 'PAYLOAD', why: 'it carries the question bank, not a reference to it' };
  return null;
}

const argv = process.argv.slice(2);
/* --range takes everything after it, in rev-list's own syntax (A..B, or a tip
   and --not ...); --push takes the remote's name git passes the hook. */
const rangeAt = argv.indexOf('--range'), pushAt = argv.indexOf('--push');
let commits = null;
if (rangeAt >= 0) {
  const revs = argv.slice(rangeAt + 1).filter(a => a !== '--quiet');
  if (!revs.length) cannot('check a range', new Error('--range names no commits'));
  commits = revList(revs);
} else if (pushAt >= 0) {
  const remote = argv[pushAt + 1] && !argv[pushAt + 1].startsWith('--') ? argv[pushAt + 1] : '';
  commits = pushed(remote);
}
const named = commits ? [] : argv.filter(a => !a.startsWith('--'));
const files = commits ? blobSources(historyEntries(commits))
            : argv.includes('--all-tracked') ? blobSources(tracked())
            : named.length ? named.map(file => ({ file }))
            : blobSources(staged());

const hits = [];
for (const { file, commit, src } of files) { const h = inspect(file, src); if (h) hits.push({ file, commit, ...h }); }
for (const g of gitlinks) {
  const p = g.file.split(path.sep).join('/');
  if (ALLOW.includes(p)) continue;
  if (DIRS.some(d => p.startsWith(d)) || DERIVED.some(d => p.startsWith(d)))
    hits.push({ file: g.file, commit: g.commit, rule: 'PATH', why: `a submodule under ${p.split('/')[0]}/ links licensed content from this public repository` });
}

if (!hits.length) {
  if (!argv.includes('--quiet')) console.log(`leak-guard: ${files.length} file(s) checked, nothing licensed` + (commits ? ` (in ${commits.length} commit(s))` : ''));
  process.exit(0);
}
console.error(`\nleak-guard: refusing ${hits.length} file(s)\n`);
for (const h of hits) console.error(`  ${h.rule.padEnd(8)} ${h.file}${h.commit ? `  (in ${h.commit})` : ''}\n           ${h.why}`);
if (commits) console.error(`
Deleting it in a later commit does not take it out of what the push sends:
every commit named above must be rewritten (git rebase -i) before pushing.`);
console.error(`
This repository is public and the question bank is not yours to publish.
git history is not something you can quietly take back.

If one of these is genuinely safe, add its exact path to ALLOW in
scripts/leak-guard.js with a comment saying why — deliberately one line of
typing per path, so it cannot become a habit.
`);
process.exit(1);
