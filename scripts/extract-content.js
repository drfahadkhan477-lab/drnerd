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

const FIG_DIR = path.join(OUT_DIR, 'figures');

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
fs.mkdirSync(FIG_DIR, { recursive: true });
for (const f of fs.readdirSync(FIG_DIR)) fs.unlinkSync(path.join(FIG_DIR, f));

const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
/* WebP is a RIFF container: "RIFF" ....  "WEBP". Checking the magic rather
   than trusting the mime type in the data URL, because the mime is just a
   string somebody wrote and the bytes are the thing that has to open. */
function looksLikeWebp(buf) {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF'
                         && buf.toString('ascii', 8, 12) === 'WEBP';
}

const figuresByQ = {};
const seen = new Set();
let figCount = 0, figBytes = 0, base64Bytes = 0;
const problems = [];

for (const qid of Object.keys(imgs)) {
  const list = imgs[qid];
  figuresByQ[qid] = [];
  list.forEach((dataUrl, i) => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) { problems.push(`${qid}[${i}]: not a base64 data URL`); return; }
    const mime = m[1];
    const ext = EXT[mime];
    if (!ext) { problems.push(`${qid}[${i}]: unexpected mime ${mime}`); return; }

    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) { problems.push(`${qid}[${i}]: decoded to zero bytes`); return; }
    if (ext === 'webp' && !looksLikeWebp(buf)) {
      problems.push(`${qid}[${i}]: mime says webp but the bytes are not a RIFF/WEBP container`);
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

fs.writeFileSync(path.join(OUT_DIR, 'questions.json'), JSON.stringify(out));

const manifest = {
  generated: new Date().toISOString(),
  source: path.basename(SRC),
  sourceDigest,
  questions: out.length,
  questionsWithFigures: Object.keys(figuresByQ).filter(k => figuresByQ[k].length).length,
  figures: figCount,
  figureBytes: figBytes,
  base64Bytes,
  chapters: [...new Set(out.map(q => q.ch))].sort(),
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

/* ── report ──────────────────────────────────────────────────────────────── */
const qJsonBytes = fs.statSync(path.join(OUT_DIR, 'questions.json')).size;
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
  process.exit(1);
}
console.log('\nAll figures decoded, written and read back byte-identical.');
