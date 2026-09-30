#!/usr/bin/env node
/*
 * Stage 1, step 1 — take the content out of the single file.
 *
 *   node scripts/extract-content.js <standalone.html> [outDir]
 *
 * The standalone build carries two payloads inline:
 *
 *     const ALL_Q = [ … ]     1.7 MB   the questions
 *     const IMGS  = { … }    25.2 MB   408 figures, as base64 data URLs
 *
 * base64 costs 4 bytes per 3, so those 25.2 MB are 18.0 MB of actual WebP
 * plus 7.2 MB of pure encoding overhead that the browser re-decodes on every
 * single launch, whether or not you ever open the question it belongs to.
 * That is the memory ceiling Stage 1 exists to lift, and it is why this runs
 * before anything else: every later step needs the content out here on disk.
 *
 * Writes, into content/ (gitignored — this is your licensed ACCSAP export and
 * it stays on your own devices):
 *
 *     content/questions.json      the bank, with figure FILENAMES in place of
 *                                 the base64, so it loads without them
 *     content/figures/*.webp      one file per figure, content-addressable by
 *                                 question id and index
 *     content/manifest.json       counts, bytes and a digest of the source,
 *                                 so a later build can tell whether the
 *                                 content it has matches the export it came from
 *
 * Everything it writes, it reads back and checks. An extraction that quietly
 * drops a figure is worse than one that fails, because you would not find out
 * until you hit that question in a exam-week review.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = process.argv[2];
const OUT_DIR = process.argv[3] || path.join(__dirname, '..', 'content');
if (!SRC) {
  console.error('usage: node scripts/extract-content.js <standalone.html> [outDir]');
  process.exit(1);
}

/* WRITTEN BESIDE, SWAPPED IN AT THE END. This used to empty content/figures
   first and write into it as it went, so an extraction that failed half way —
   a bad figure, a mismatch — left content/ half old and half new, and the last
   good bank gone. Now everything is written to a work folder beside it and
   the three things this script owns (questions.json, manifest.json,
   figures/) are moved into content/ only when every check has passed. On any
   problem the work folder is removed and content/ is exactly as it was.
   content/ holds other things too (refs-images/, the notes' figures), so it is
   never swapped whole. */
const WORK = OUT_DIR.replace(/[\\/]+$/, '') + '.tmp-' + process.pid;
const FIG_DIR = path.join(WORK, 'figures');

/* ── pull the two payloads out of the build ──────────────────────────────── */
function extractConst(html, name) {
  /* Both are emitted as a single line, `const NAME=<json>;`. Anchoring on the
     newline before and `;\n` after keeps this from wandering into the ~5000
     lines of application code that follow. */
  const re = new RegExp(`\\nconst ${name}=([\\[{][\\s\\S]*?[\\]}]);\\n`);
  const m = html.match(re);
  if (!m) throw new Error(`could not find "const ${name}=" in ${SRC}`);
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`"const ${name}=" did not parse as JSON: ${e.message}`);
  }
}

const html = fs.readFileSync(SRC, 'utf8');
const sourceDigest = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
const questions = extractConst(html, 'ALL_Q');
const imgs = extractConst(html, 'IMGS');

/* ── figures: decode, name, verify ───────────────────────────────────────── */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(FIG_DIR, { recursive: true });

const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
/* WebP is a RIFF container: "RIFF" ....  "WEBP". Checking the magic rather
   than trusting the mime type in the data URL, because the mime is just a
   string somebody wrote and the bytes are the thing that has to open. */
function looksLikeWebp(buf) {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF'
                         && buf.toString('ascii', 8, 12) === 'WEBP';
}
/* And the other two it accepts: the older ACC bank's figures are JPEG. A mime
   string is only a claim; the first bytes are the file. */
const MAGIC = {
  webp: looksLikeWebp,
  png: b => b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG',
  jpg: b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
};
/* Buffer.from(x, 'base64') is lenient: it skips characters outside the
   alphabet and ignores bad padding, so a damaged payload decodes to a
   different, shorter file without a word. Strict here: the alphabet, a length
   that is a multiple of four, and the round trip back to the same text. */
const strictBase64 = t => typeof t === 'string' && t.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(t);
/* A question id becomes a file name. Nothing that can climb out of figures/
   or name a second file: letters, digits, _ . - only, and never "..". */
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(id) && !id.includes('..');

const figuresByQ = {};
const seen = new Set();
let figCount = 0, figBytes = 0, base64Bytes = 0;
const problems = [];

for (const qid of Object.keys(imgs)) {
  const list = imgs[qid];
  figuresByQ[qid] = [];
  if (!safeId(qid)) { problems.push(`question id ${JSON.stringify(String(qid).slice(0, 40))} is not safe as a file name`); continue; }
  list.forEach((dataUrl, i) => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) { problems.push(`${qid}[${i}]: not a base64 data URL`); return; }
    const mime = m[1];
    const ext = EXT[mime];
    if (!ext) { problems.push(`${qid}[${i}]: unexpected mime ${mime}`); return; }

    if (!strictBase64(m[2])) { problems.push(`${qid}[${i}]: the base64 is malformed`); return; }
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) { problems.push(`${qid}[${i}]: decoded to zero bytes`); return; }
    if (buf.toString('base64') !== m[2]) { problems.push(`${qid}[${i}]: the base64 does not round-trip`); return; }
    if (!MAGIC[ext](buf)) {
      problems.push(`${qid}[${i}]: mime says ${mime} but the bytes are not a ${ext} file`);
      return;
    }

    const name = `${qid}_${i + 1}.${ext}`;
    if (seen.has(name)) { problems.push(`${qid}[${i}]: duplicate output name ${name}`); return; }
    seen.add(name);

    fs.writeFileSync(path.join(FIG_DIR, name), buf);
    /* Read it straight back. Writing and trusting is how you end up with a
       truncated figure you discover during revision. */
    const back = fs.readFileSync(path.join(FIG_DIR, name));
    if (!back.equals(buf)) { problems.push(`${qid}[${i}]: written file does not match decoded bytes`); return; }

    figuresByQ[qid].push(name);
    figCount++;
    figBytes += buf.length;
    base64Bytes += dataUrl.length;
  });
}

/* ── questions: swap the base64 for filenames ────────────────────────────── */
let declaredFigures = 0, mismatched = 0;
const out = questions.map(q => {
  const figs = figuresByQ[q.id] || [];
  declaredFigures += (q.img || 0);
  /* q.img is the count the app already carries; if it and the extracted
     figures disagree, one of the two is wrong and both are used for display. */
  if ((q.img || 0) !== figs.length) {
    mismatched++;
    problems.push(`${q.id}: q.img says ${q.img || 0} figure(s), extraction found ${figs.length}`);
  }
  return { ...q, figs };
});

fs.writeFileSync(path.join(WORK, 'questions.json'), JSON.stringify(out));

/* Which commit did the extracting. sourceDigest already says which BUILD the
   content came from — that is what build-pwa.js compares against — but a
   digest is not something anyone can look up. This is, and it costs nothing:
   it is not hashed into sourceDigest, so it cannot move a cache key or make
   two identical extractions compare unequal. A tarball with no .git is a
   legitimate place to build from, so a missing git is 'unknown', not a
   failure; a dirty tree is marked, because a commit id over uncommitted
   changes is a claim the repository cannot honour. */
const commit = (() => {
  try {
    const at = require('child_process').execFileSync(
      'git', ['rev-parse', '--short=12', 'HEAD'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^[0-9a-f]{7,40}$/.test(at)) return 'unknown';
    const dirty = require('child_process').execFileSync(
      'git', ['status', '--porcelain'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    return dirty ? at + '-dirty' : at;
  } catch (_) { return 'unknown'; }
})();

const manifest = {
  /* SOURCE_DATE_EPOCH, where set, so two extractions of one export compare
     byte for byte (the reproducible-builds convention); the clock otherwise. */
  generated: new Date(process.env.SOURCE_DATE_EPOCH ? +process.env.SOURCE_DATE_EPOCH * 1000 : Date.now()).toISOString(),
  source: path.basename(SRC),
  sourceDigest,
  commit,
  questions: out.length,
  questionsWithFigures: Object.keys(figuresByQ).filter(k => figuresByQ[k].length).length,
  figures: figCount,
  figureBytes: figBytes,
  base64Bytes,
  chapters: [...new Set(out.map(q => q.ch))].sort(),
};
fs.writeFileSync(path.join(WORK, 'manifest.json'), JSON.stringify(manifest, null, 2));

/* ── report ──────────────────────────────────────────────────────────────── */
const qJsonBytes = fs.statSync(path.join(WORK, 'questions.json')).size;
const mb = b => (b / 1048576).toFixed(2) + ' MB';
console.log(`Extracted from ${path.basename(SRC)}  (sha256:${sourceDigest})\n`);
console.log(`  questions            ${out.length}`);
console.log(`  chapters             ${manifest.chapters.length}`);
console.log(`  figures              ${figCount}  across ${manifest.questionsWithFigures} questions`);
console.log(`  q.img declared       ${declaredFigures}${mismatched ? `  (${mismatched} question(s) disagree)` : '  — matches'}`);
console.log('');
console.log(`  questions.json       ${mb(qJsonBytes)}`);
console.log(`  figures on disk      ${mb(figBytes)}`);
console.log(`  was, inline base64   ${mb(base64Bytes)}   → ${mb(base64Bytes - figBytes)} of encoding overhead dropped`);
console.log('');
console.log(`  written to           ${OUT_DIR}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.slice(0, 25).forEach(p => console.error('  ✗ ' + p));
  if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`);
  fs.rmSync(WORK, { recursive: true, force: true });
  console.error(`\nNothing in ${OUT_DIR} was changed.`);
  process.exit(1);
}
/* Every check passed: move the three into place. figures/ goes aside first and
   is removed only after the new one is in, so there is no moment with none. */
fs.mkdirSync(OUT_DIR, { recursive: true });
const oldFigs = path.join(OUT_DIR, 'figures.old-' + process.pid);
if (fs.existsSync(path.join(OUT_DIR, 'figures'))) fs.renameSync(path.join(OUT_DIR, 'figures'), oldFigs);
fs.renameSync(FIG_DIR, path.join(OUT_DIR, 'figures'));
for (const f of ['questions.json', 'manifest.json']) fs.renameSync(path.join(WORK, f), path.join(OUT_DIR, f));
fs.rmSync(oldFigs, { recursive: true, force: true });
fs.rmSync(WORK, { recursive: true, force: true });
console.log('\nAll figures decoded, written and read back byte-identical.');
