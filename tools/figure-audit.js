#!/usr/bin/env node
/*
 * Which questions talk about a picture they do not carry?
 *
 *   node tools/figure-audit.js build/systole.html
 *   node tools/figure-audit.js content/questions.json
 *   node tools/figure-audit.js content/questions.json --show      # + text window
 *
 * WHY THIS EXISTS. "Some MCQs were not displaying figures" — reported against
 * both builds, which is the fact that matters. The two builds carry figures by
 * completely different mechanisms: the single file embeds every figure as a
 * base64 data: URI with no network involved at all, while the split build
 * fetches content/figures/*.webp over HTTP through a service worker. A fault
 * in serving, caching, or offline availability can only reach one of them. A
 * fault that reaches BOTH is in the content or in the rendering, and nowhere
 * else.
 *
 * The content side is already gated three times over, and each gate is a hard
 * build failure rather than a warning:
 *
 *   · extract-content.js decodes every figure, checks the RIFF/WEBP magic
 *     bytes rather than trusting the mime string, writes it, reads it back and
 *     compares byte-for-byte — then exits 1 if any question's q.img count
 *     disagrees with the number of figures extracted for it.
 *   · verify-content.js fails the build if any question carries imgopt with no
 *     figure and no bad/flag notice, and proves that rule can fail by
 *     sabotaging a real question.
 *   · verify-pwa.js repeats the shape check against the split bank.
 *
 * So every question that DECLARES a figure has exactly that many valid ones,
 * in both builds. That is established, not assumed.
 *
 * THE GAP ALL THREE SHARE is that they reason about structure — q.img, q.figs,
 * q.imgopt — and a question is only ever compared against its own declaration.
 * None of them reads the question. A stem that says "the tracing shown below"
 * while carrying img: 0 is perfectly self-consistent: it declares no figure and
 * it ships no figure, so all three gates pass it, and the fellow gets a
 * question that refers to a picture that is not on the screen. From the other
 * side of the glass that is indistinguishable from a figure that failed to
 * load, and it would look identical in both builds — which is exactly the
 * report.
 *
 * imgopt catches only the narrow case where ACCSAP itself marked the OPTIONS as
 * pictures (COR_89's "Pattern A" through "Pattern E"). It says nothing about a
 * stem that points at a figure in ordinary prose.
 *
 * WHAT THIS IS NOT. It is not a validator and it does not gate the build. The
 * decision about any question it names is a cardiology judgement about the
 * licensed bank, and that belongs to the owner, not to a regex. Natural
 * language does not admit a clean rule: "the murmur shown here is best heard
 * at the apex" points at a figure, "figure-of-eight suture" and "as shown in
 * the trial above" do not, and no pattern separates those reliably. So this
 * reports candidates with the phrase that triggered them and lets a human look.
 *
 * ON LICENSED TEXT. It prints ids, chapters and the matched phrase only. The
 * surrounding sentence is behind --show, off by default, because this output
 * gets pasted into bug reports and transcripts.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RUN  = require.main === module;
const SRC  = process.argv[2];
const SHOW = process.argv.includes('--show');
if (RUN) {
  if (!SRC) {
    console.error('usage: node tools/figure-audit.js <build/systole.html | content/questions.json> [--show]');
    process.exit(2);
  }
  if (!fs.existsSync(SRC)) { console.error(`no such file: ${SRC}`); process.exit(2); }
}

/* ── load the bank from whichever build shape was handed over ───────────── */
function loadBank(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (path.extname(file).toLowerCase() === '.json') {
    return { bank: JSON.parse(raw), shape: 'split build (content/questions.json)' };
  }
  /* Same anchoring extract-content.js uses: `const NAME=<json>;` on its own
     line, so this cannot wander into the application code that follows. */
  const m = raw.match(/\nconst ALL_Q=(\[[\s\S]*?\]);\n/);
  if (!m) throw new Error(`could not find "const ALL_Q=" in ${file}`);
  return { bank: JSON.parse(m[1]), shape: 'single-file build' };
}

/* A question's figure count. img is the count the app's own rendering reads
   (buildQuiz, the per-chapter tally, TOTAL_IMG); figs is the filename array the
   split build adds, and is empty for the five imgopt questions that carry a
   real img count — see the note in verify-content.js. Either one counts. */
const figCount = q => (q.img || 0) || ((q.figs || []).length);

/* ── what "points at a picture" looks like in this bank ─────────────────── */
/* Each pattern is deliberately anchored on a DEICTIC — a word that points at
   something on the page (below, above, shown, displayed, this/these) — rather
   than on the mere presence of a clinical noun. "An ECG was obtained" is
   history; "the ECG below" is a figure. That distinction is the whole design,
   and it is why plain \becg\b is absent from this list. */
const MODALITY = String.raw`(?:ecg|ekg|electrocardiogram|rhythm strip|tracing|telemetry|` +
                 String.raw`echocardiogram|echo|image|images|figure|figures|panel|panels|` +
                 String.raw`angiogram|angiography|cineangiogram|ventriculogram|radiograph|` +
                 String.raw`chest (?:x-ray|radiograph)|cxr|ct|cmr|mri|scan|` +
                 String.raw`pressure tracing|waveform|loop|photograph|photo|slide|` +
                 String.raw`monitor strip|recording)`;

/* Up to two modifier words between a deictic and the modality it points at.
   Each must look like a plain word and must not be one of the tokens that make
   the phrase a clause about the patient rather than a reference to a picture. */
const BRIDGE = String.raw`(?:(?!\b(?:patient|man|woman|male|female|study|trial|` +
               String.raw`registry|analysis|time|episode|admission|underwent|had|has|have|` +
               String.raw`received|will|was|were|is|are|showed|shows|revealed|reported|` +
               String.raw`requires|required|needs|should|would|could)\b)[a-z][a-z-]*\s+){0,2}`;

const PATTERNS = [
  { name: 'points below/above',
    re: new RegExp(String.raw`\b${MODALITY}\b[^.?!]{0,40}\b(?:below|above|shown|displayed|depicted|presented)\b`, 'i') },
  { name: 'shown/displayed first',
    re: new RegExp(String.raw`\b(?:shown|displayed|depicted|illustrated|pictured)\b[^.?!]{0,30}\b${MODALITY}\b`, 'i') },
  { name: 'names a figure',
    re: /\b(?:figure|fig\.?|image|panel|exhibit)\s*(?:\d+|[A-E]\b)/i },
  { name: 'this/these + modality',
    /* A deictic rarely sits flush against the noun — it is "this CORONARY
       angiogram", "these APICAL four-chamber images". So a short bridge of
       modifiers is allowed, but only of modifiers: without the stoplist, "this
       patient underwent coronary angiography" reads as two bridge words
       followed by a modality and gets flagged, which is a history, not a
       picture. The blocked words are the ones that turn a deictic phrase into
       a clause. */
    re: new RegExp(String.raw`\b(?:this|these|the following|the accompanying)\s+${BRIDGE}${MODALITY}\b`, 'i') },
  { name: 'asks what is seen',
    re: /\b(?:seen|visible|demonstrated|illustrated)\s+(?:in|on)\s+(?:the\s+)?(?:figure|image|panel|tracing|study)\b/i },
];

/* Phrases that match a pattern above and mean nothing of the sort. Checked
   first, on the matched window rather than the whole question, so one innocent
   idiom elsewhere in a long explanation cannot suppress a real finding. */
const INNOCENT = [
  /\bfigure[- ]of[- ]eight\b/i,
  /\bfigure it out\b/i,
  /\bin the figure legend of\b/i,     /* citing a paper, not showing one */
  /\bas (?:shown|demonstrated) (?:in|by) (?:the )?(?:trial|study|registry|analysis|meta-analysis)\b/i,
];

function scan(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const window = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (INNOCENT.some(r => r.test(window))) continue;
    return { pattern: p.name, phrase: m[0].replace(/\s+/g, ' ').trim(), index: m.index, window };
  }
  return null;
}

/* Exported so tests/verify-figaudit.js can prove the classifier both fires on
   a stem that points at a picture and stays quiet on one that only sounds like
   it does — against fixtures, never against the licensed bank. */
module.exports = { scan, figCount, loadBank, PATTERNS, INNOCENT };

/* Top-level return: legal in CommonJS, and it keeps the CLI body below at the
   indentation it reads best at rather than wrapping eighty lines in an if. */
if (!RUN) return;

const { bank, shape } = loadBank(SRC);

/* WHICH FIELD HOLDS THE STEM, established rather than guessed. This read
   `q.q || q.stem || q.text` — three guesses at a key that lives in ACCSAP's
   own export and is written down nowhere in this repository. If all three were
   wrong, every scan below would run against an empty string and this tool
   would print "No question refers to a picture it does not carry" — silence
   dressed as evidence, and the most dangerous output a checker can produce.
   It now refuses to report rather than report on nothing. */
const { stemKey } = require('../scripts/content-checks.js');
const STEM_KEY = stemKey(bank);
if (!STEM_KEY) {
  console.error('Could not find the field holding the question text in this bank.');
  console.error('Refusing to report: every check below would have examined an empty');
  console.error('string and come back clean, which would mean nothing at all.');
  process.exit(2);
}

/* ── the audit ──────────────────────────────────────────────────────────── */
const integrity = [];   /* should be empty; the build gates on it already */
const orphans   = [];   /* the population this tool exists to find */

for (const q of bank) {
  const n = figCount(q);

  /* Re-checked here rather than trusted, because this tool is also what gets
     run when someone suspects the gates themselves. */
  if (Array.isArray(q.figs) && q.figs.length && (q.img || 0) && q.figs.length !== q.img) {
    integrity.push(`${q.id}: q.img says ${q.img}, figs array has ${q.figs.length}`);
  }
  if (n > 0) continue;

  /* The stem is what the fellow is looking at when the figure should be there.
     The explanation is checked too but reported separately — commentary that
     refers to a figure the question never showed is a smaller problem than a
     stem that does. */
  const stem = q[STEM_KEY] || '';
  const hit  = scan(stem);
  if (hit) {
    orphans.push({ q, where: 'stem', ...hit });
    continue;
  }
  const exHit = scan(q.ex || '');
  if (exHit) orphans.push({ q, where: 'commentary', ...exHit });
}

/* ── report ─────────────────────────────────────────────────────────────── */
const withFigs = bank.filter(q => figCount(q) > 0);
const total    = withFigs.reduce((n, q) => n + figCount(q), 0);

console.log(`Figure audit — ${shape}`);
console.log(`  ${path.basename(SRC)}\n`);
console.log(`  questions              ${bank.length}`);
console.log(`  carry a figure         ${withFigs.length}  (${total} figures)`);
console.log(`  declare none           ${bank.length - withFigs.length}`);

if (integrity.length) {
  console.log(`\n  ${integrity.length} question(s) disagree with themselves about how many figures they have:`);
  integrity.forEach(p => console.log('    ✗ ' + p));
} else {
  console.log(`  count integrity        every declared figure is present`);
}

if (!orphans.length) {
  console.log(`\nNo question refers to a picture it does not carry.`);
  console.log(`If figures are still missing on screen, the content is not the cause —`);
  console.log(`the fault is in rendering, and the next step is to watch a figure that`);
  console.log(`should be there fail to appear.`);
  process.exit(0);
}

const stemOrphans = orphans.filter(o => o.where === 'stem');
console.log(`\n${orphans.length} question(s) refer to a picture while carrying no figure`);
console.log(`  ${stemOrphans.length} in the stem — what the fellow reads before answering`);
console.log(`  ${orphans.length - stemOrphans.length} in the commentary only\n`);

const byCh = new Map();
for (const o of orphans) {
  const ch = o.q.ch || '(no chapter)';
  if (!byCh.has(ch)) byCh.set(ch, []);
  byCh.get(ch).push(o);
}
for (const ch of [...byCh.keys()].sort()) {
  const rows = byCh.get(ch);
  console.log(`  ${ch}  (${rows.length})`);
  for (const o of rows.sort((a, b) => a.q.id.localeCompare(b.q.id))) {
    const noted = o.q.bad || o.q.flag ? '  [already flagged in-app]' : '';
    console.log(`    ${o.q.id.padEnd(10)} ${o.where.padEnd(10)} “${o.phrase}”${noted}`);
    if (SHOW) console.log(`               …${o.window.replace(/\s+/g, ' ').trim()}…`);
  }
  console.log('');
}

console.log(`Each one is a judgement call, not a defect — read it and decide.`);
console.log(`A question that ACCSAP itself never shipped a figure for wants the same`);
console.log(`in-app notice COR_89 carries (see the FLAGS list in scripts/flags-patch.js);`);
console.log(`one whose figure was lost on the way in is a build problem worth chasing.`);
if (!SHOW) console.log(`\nRe-run with --show to see the sentence around each match.`);
