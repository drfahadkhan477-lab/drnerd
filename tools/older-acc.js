'use strict';
/*
 * The rules tools/older-acc-import.js applies to an older ACC question bank,
 * as plain functions over LINE RECORDS — no PDF, no browser, no licensed text.
 *
 * WHY THIS IS A SEPARATE FILE. The importer reads PDFs through pdf.js in the
 * browser the suites use, so it requires tests/_engine.js. A suite that
 * requires a file that requires the engine is classed as needing a browser
 * (tests/_targets.js follows the require), and the rules here need none. So
 * the rules live here, tests/verify-olderacc-pure.js proves them on synthetic
 * lines, and the importer is the thin part that turns a PDF into lines.
 *
 * WHAT A LINE RECORD IS. One visual line of one page, as the importer builds
 * it from pdf.js text items: { page, y, x0, x1, size, font, bold, ink, text }.
 * y is the baseline in PDF user space (larger is higher on the page), size the
 * font size in points, font the font's own name with its subset prefix
 * removed, ink the line's sampled colour ("rgb~r,g,b", as tools/pdf-shape.js
 * reports it) or ''.
 *
 * THE LAYOUTS, from tools/pdf-shape.js run on the owner's laptop — a report of
 * shapes, fonts and colours, never words:
 *   heading   a "Question" heading line, then a numbered stem "9. A …",
 *             options "A. ", then "Answer" and "Key point" lines (SECOND.pdf)
 *   spaced    OCR-like: stem "9 . ", options "a . ", then a short line that is
 *             probably the answer (FIRST.pdf, one of its two layouts)
 *   large     stem "99. " set large (16 pt Calibri), options "a.  "
 *             (FIRST.pdf, the other)
 *   other     a question that parsed but matches none of the three
 * ANSWER KEYS, from the owner's first real run: FIRST.pdf keeps its answers in
 * key sections — an "ANSWERS"-type heading, then entries "12. a. rationale" —
 * which showed up as ~400 lines shaped "99.␣a." right after questions'
 * options. A key entry is its own kind of line: never a stem anchor, never
 * part of the explanation above it, and mapped back by number to the
 * questions the key follows (applyKey). Every stem anchor that does not
 * start a question is recorded with the rule that turned it down.
 * These are heuristics measured from a report, not from the text, so every
 * rule here is tolerant, and the importer reports per-layout counts, the
 * pages it could not parse, and the SHAPES of the lines where it looked for
 * an answer and found none — so the owner can say what failed without
 * reading a word of it out.
 *
 * NOTHING HERE RETURNS TEXT FOR PRINTING. formatReport() builds everything
 * the importer prints, from counts and page numbers; the suite hands it a
 * parse full of marker words and asserts none of them comes out.
 */
const crypto = require('crypto');
const { shingles } = require('./refs-merge.js');
const { stemKey } = require('../scripts/content-checks.js');

const CATEGORY = 'Older ACC bank';     // the chapter every imported question is filed under
const ID_PREFIX = 'OAB_';              // and the id prefix that marks it as ours
const DUP_THRESHOLD = 0.5;             // this much of a stem inside ONE existing stem is that question
const REVERSE_MIN = 8;                 // a bank stem needs this many shingles to count as inside a longer one
const TRAIL_PAGES = 2;                 // an explanation ends this many pages past its options at most — the last
                                       // question must not take the back matter with it

/* ── what kind of line is this ──────────────────────────────────────────── */
const HEAD_RE = /^question\s*(\d{1,4})?\s*[:.]?\s*$/i;
const ANS_RE = /^(?:the\s+)?(?:correct\s+)?(?:answer|ans)\b\.?\s*(?:is\b)?\s*[:.\-–]?\s*(.*)$/i;
const KEY_RE = /^(?:key\s*points?|explanation|rationale|discussion|commentary|educational\s+objective|learning\s+objective|take[\s-]*home(?:\s+message)?)\b\s*[:.\-–]?\s*(.*)$/i;
/* "9. A …", "9 . A …", "12) …", "Question 9: …" — but not "2.5 mg" or "10:30". */
const NUM_RE = /^(?:q(?:uestion)?\s*)?(\d{1,4})\s?[.):](?!\d)\s*(\S.*)$/i;
/* An ANSWER-KEY entry: a number, then one option letter set off by a point or
   bracket, then (maybe) the rationale — "12. a. Because …", "12) (c)",
   "7. Ans: b". Never a stem: a stem opens with a word, and "12. A 45-year-old"
   has no point after its A. The owner's first run showed these as the lines
   right after questions' options, shaped "99.␣a.", some 400 of them. */
const KEYENTRY_RE = /^(\d{1,4})\s?[.):]\s*(?:(?:[Aa]ns(?:wer)?|ANS(?:WER)?|[Kk]ey|KEY)\s*[:.\-–]?\s*\(?([A-Ha-h])\)?\.?|\(?([A-Ha-h])\s?[.)])(?=\s|$)\s*(.*)$/;
/* The heading over an answer-key section: "ANSWERS", "Answer key",
   "Answers and explanations", "EXPLANATIONS". Singular "Explanation" is not
   one — that heads the explanation under a single question. */
const KEYHEAD_RE = /^(?:answers(?:\s+(?:and|&)\s+explanations?)?|answers?\s+key|explanations|rationales)\s*:?$/i;
/* "A. …", "a . …", "(b) …" — but not "A.V. block", whose rest opens "V.". */
const OPT_RE = /^\(?([A-Ha-h])\s?[.)]\s*(.*)$/;

function lineKind(text) {
  const t = String(text || '').trim();
  if (!t) return { k: 'BLANK' };
  let m;
  if ((m = HEAD_RE.exec(t))) return { k: 'HEAD', n: m[1] ? +m[1] : null };
  if (KEYHEAD_RE.test(t)) return { k: 'KEYHEAD' };
  if ((m = KEYENTRY_RE.exec(t))) return { k: 'KEYENTRY', n: +m[1], L: (m[2] || m[3]).toLowerCase().charCodeAt(0) - 97, rest: m[4] || '' };
  if ((m = ANS_RE.exec(t))) return { k: 'ANS', rest: m[1] };
  if ((m = KEY_RE.exec(t))) return { k: 'KEY', rest: m[1] };
  if ((m = NUM_RE.exec(t))) return { k: 'NUM', n: +m[1], rest: m[2] };
  if ((m = OPT_RE.exec(t)) && !/^[A-Za-z]\./.test(m[2])) return { k: 'OPT', L: m[1].toLowerCase().charCodeAt(0) - 97, rest: m[2] };
  return { k: 'TEXT' };
}

/* Two options set on one line, "A. 5   B. 10": the importer keeps a gap wider
   than two character widths as three spaces, and only a run that long, then
   the NEXT letter, splits. */
function splitOptions(rest, L) {
  const out = [{ L, t: rest }];
  for (;;) {
    const last = out[out.length - 1];
    const want = String.fromCharCode(97 + last.L + 1);
    const re = new RegExp(`\\s{3,}\\(?([${want}${want.toUpperCase()}])\\s?[.)]\\s+`);
    const m = re.exec(last.t);
    if (!m) break;
    out.push({ L: last.L + 1, t: last.t.slice(m.index + m[0].length) });
    last.t = last.t.slice(0, m.index);
  }
  return out.map(o => ({ L: o.L, t: clean(o.t) }));
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const LETTER = 'ABCDEFGH';

/* ── where the answer is ────────────────────────────────────────────────── */
/* A line that is nothing but a letter, maybe dressed: "c", "(c)", "C.",
   "Ans: c", "Answer B", "Key: d". The short black line of the spaced layout. */
function shortAnswer(text, nOpts) {
  const t = clean(text);
  if (!t || t.length > 16) return -1;
  const m = /^(?:(?:correct\s+)?(?:ans(?:wer)?|key)\s*[:.\-–]?\s*)?\(?([A-Ha-h])\)?\.?$/i.exec(t);
  if (!m) return -1;
  const i = m[1].toLowerCase().charCodeAt(0) - 97;
  return i < nOpts ? i : -1;
}
/* What follows "Answer": "B", "B. …", "(c)", "Option D". */
function letterFrom(rest, nOpts) {
  const t = clean(rest);
  const m = /^(?:(?:option|choice)\s+)?\(?([A-Ha-h])\)?(?=$|[\s.):,;\-–])/i.exec(t);
  if (!m) return -1;
  /* A lower-case letter followed by a word is the article "a", not option A. */
  if (/^[a-h]\s+[a-z]{2,}/.test(t) && !/^[a-h][.)]/.test(t)) return -1;
  const i = m[1].toLowerCase().charCodeAt(0) - 97;
  return i < nOpts ? i : -1;
}
/* "The correct answer is B." / "The best answer is (c)." — the letter upper
   case, or in brackets, or named as an option; "the correct answer is a
   beta-blocker" is not option A. */
const SENT_ANSWER_IS = /(?:[Cc]orrect|[Bb]est|[Rr]ight)\s+(?:[Aa]nswer|[Cc]hoice|[Rr]esponse|[Oo]ption)\s*(?:is|IS|:|=)?\s*(?:(?:[Oo]ption|[Cc]hoice|[Aa]nswer)\s+([A-Ha-h])\b|\(([A-Ha-h])\)|([A-H])(?=$|[\s.):,;]))/;
/* "Option B is correct." / "(C) is the best answer." / "…. D is correct." —
   a bare letter only in brackets or at a sentence start, so "Vitamin B is
   the correct answer" is not option B. */
const SENT_IS_CORRECT = /(?:(?:[Oo]ption|[Cc]hoice|[Aa]nswer|[Rr]esponse)\s+\(?([A-Ha-h])\)?|(?:^|[.;:]\s+)([A-H])|\(([A-Ha-h])\))\s+is\s+(?:the\s+)?(?:correct|best|right)\b/;
function sentenceHit(text, nOpts) {
  const t = clean(text);
  for (const [re, how] of [[SENT_ANSWER_IS, 'sentence'], [SENT_IS_CORRECT, 'sentence-is-correct']]) {
    const m = re.exec(t);
    if (!m) continue;
    const i = (m[1] || m[2] || m[3]).toLowerCase().charCodeAt(0) - 97;
    if (i < nOpts) return { i, how };
  }
  return { i: -1, how: '' };
}
const sentenceAnswer = (text, nOpts) => sentenceHit(text, nOpts).i;
/* "Answer: amiodarone" — the option's own words, matched whole or as a prefix,
   and only when exactly one option matches. */
function answerByText(rest, options) {
  const n = norm(rest);
  if (n.length < 3) return -1;
  const hits = options.map((o, i) => [norm(o.t), i]).filter(([t]) => t.length >= 3 && (n === t || n.startsWith(t + ' ') || t === n)).map(([, i]) => i);
  return hits.length === 1 ? hits[0] : -1;
}
/* One option inked differently from every other, the others all alike. */
function inkAnswer(inks) {
  if (inks.length < 3 || inks.some(k => !k || k === '?' || k === 'none')) return -1;
  const count = {};
  for (const k of inks) count[k] = (count[k] || 0) + 1;
  const kinds = Object.keys(count);
  if (kinds.length !== 2) return -1;
  const odd = kinds.find(k => count[k] === 1);
  if (!odd || count[kinds.find(k => k !== odd)] !== inks.length - 1) return -1;
  return inks.indexOf(odd);
}

/* One option set in bold (most of its characters), every other not. */
function boldAnswer(fracs) {
  if (fracs.length < 3 || fracs.some(f => typeof f !== 'number')) return -1;
  const strong = fracs.map((f, i) => [f, i]).filter(([f]) => f >= 0.6);
  if (strong.length !== 1 || fracs.some((f, i) => i !== strong[0][1] && f > 0.3)) return -1;
  return strong[0][1];
}
/* How the options of an unanswered question differ, as a pattern and never
   words: ink groups by size ("3+1"), and how many are mostly bold. */
function emphasisPattern(options) {
  const g = {};
  for (const o of options) g[o.ink || '?'] = (g[o.ink || '?'] || 0) + 1;
  const bold = options.filter(o => typeof o.bf === 'number' && o.bf >= 0.6).length;
  return `ink ${Object.values(g).sort((a, b) => b - a).join('+')}, bold ${bold}/${options.length}`;
}

/* ── running headers and footers ────────────────────────────────────────── */
/* A line in the top or bottom tenth of a page whose text, digits folded, is
   on a quarter of the text pages or more — "ACCSAP", "9/9/2014", "Page 3".
   Folding the digits is what catches a page number: "3" and "417" are both
   "9", on every page. (A separate page-number pattern was here and measured
   nothing the fold does not — the suite stayed green with it removed.) */
function stripRunning(pages) {
  const band = (pg, l) => l.y > pg.y0 + pg.h * 0.9 || l.y < pg.y0 + pg.h * 0.1;
  const key = t => clean(t).toLowerCase().replace(/\d+/g, '9');
  const seen = new Map();
  const textPages = pages.filter(pg => pg.lines && pg.lines.length);
  for (const pg of textPages) {
    const ks = new Set(pg.lines.filter(l => band(pg, l)).map(l => key(l.text)));
    for (const k of ks) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const floor = Math.max(3, Math.ceil(textPages.length * 0.25));
  let dropped = 0;
  const out = pages.map(pg => {
    if (!pg.lines) return pg;
    const lines = pg.lines.filter(l => {
      if (!band(pg, l)) return true;
      const k = key(l.text);
      const run = (seen.get(k) || 0) >= floor;
      if (run) dropped++;
      return !run;
    });
    return { ...pg, lines };
  });
  return { pages: out, dropped };
}

/* ── questions out of a stream of lines ─────────────────────────────────── */
/* A stem anchor (a numbered line, or a "Question" heading) starts a question
   only if an option lettered A follows it before any other anchor, and B
   follows that. So a numbered reference list in an explanation, or "2. …" in
   the middle of a paragraph, is not a question: no options come after it
   before the real next stem does. */
/* Every anchor that does NOT start a question is recorded with the rule that
   turned it down, so a run on the real PDFs says why a page did not parse:
     anchor-before-A   another stem or heading came before any option
     key-before-A      an answer-key heading or entry came first
     not-A-first       the first option-like line was lettered B or later
     no-option         no option-like line within 80 lines
     A-without-B       option A, but no B after it
   and an option-A line no anchor ever reached is recorded as A-without-anchor,
   with the shape and font of the line above it — where a stem should end. */
const REASONS = ['anchor-before-A', 'key-before-A', 'not-A-first', 'no-option', 'A-without-B', 'A-without-anchor'];
function segment(lines) {
  const kinds = lines.map(l => l.kind || lineKind(l.text));
  const starts = [];
  const orphanHeads = [];
  const rejects = [];
  const reached = new Set();
  for (let a = 0; a < lines.length; a++) {
    const ka = kinds[a];
    if (ka.k !== 'NUM' && ka.k !== 'HEAD') continue;
    let stemAt = a, optAt = -1, why = 'no-option';
    if (ka.k === 'HEAD' && kinds[a + 1] && kinds[a + 1].k === 'NUM') stemAt = a + 1;
    for (let j = stemAt + 1; j < lines.length && j < a + 80; j++) {
      const k = kinds[j];
      if (k.k === 'HEAD' || k.k === 'NUM') { why = 'anchor-before-A'; break; }
      if (k.k === 'KEYHEAD' || k.k === 'KEYENTRY') { why = 'key-before-A'; break; }
      if (k.k === 'OPT') { if (k.L === 0) { optAt = j; reached.add(j); } else why = 'not-A-first'; break; }
    }
    let good = false;
    if (optAt > 0) {
      why = 'A-without-B';
      const first = splitOptions(kinds[optAt].rest, 0);
      if (first.length > 1) good = true;
      for (let j = optAt + 1; !good && j < lines.length && j < optAt + 40; j++) {
        const k = kinds[j];
        if (k.k === 'HEAD' || k.k === 'NUM' || k.k === 'ANS' || k.k === 'KEY' || k.k === 'KEYHEAD' || k.k === 'KEYENTRY') break;
        if (k.k === 'OPT') { good = k.L === 1; break; }
      }
    }
    if (good) { starts.push({ at: a, stemAt, optAt }); a = stemAt; continue; }
    rejects.push({ page: lines[a].page, optPage: optAt > 0 ? lines[optAt].page : null, reason: why });
    if (ka.k === 'HEAD') { orphanHeads.push(lines[a].page); a = stemAt; }
  }
  const inKey = keySpans(kinds, starts.map(s => s.at), lines);
  lines.forEach((l, i) => {
    if (kinds[i].k !== 'OPT' || kinds[i].L !== 0 || reached.has(i) || inKey[i]) return;
    const above = i > 0 ? lines[i - 1] : null;
    rejects.push({ page: l.page, optPage: l.page, reason: 'A-without-anchor', above: above ? `${shapeOf(above.text)} ${above.font || '?'}` : '(top)' });
  });
  const blocks = starts.map((s, i) => ({ ...s, end: i + 1 < starts.length ? starts[i + 1].at : lines.length }));
  return { kinds, blocks, orphanHeads, rejects, inKey };
}

/* Which lines sit inside an answer-key section: from a key heading or entry
   up to the next question start, stem-like line or "Question" heading — and
   no further than its page, so a key does not hide the next page's options
   (the next entry turns it back on). */
function keySpans(kinds, startIdx, lines) {
  const starts = new Set(startIdx), out = new Array(kinds.length).fill(false);
  let on = false;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i].k;
    if (i > 0 && lines[i].page !== lines[i - 1].page) on = false;
    if (k === 'KEYHEAD' || k === 'KEYENTRY') on = true;
    else if (starts.has(i) || k === 'HEAD' || k === 'NUM') on = false;
    out[i] = on;
  }
  return out;
}

/* ── answer keys ────────────────────────────────────────────────────────── */
/* Each entry of an answer-key section, with its rationale: the lines after it
   up to the next entry, key heading, stem-like line, "Question" heading or
   question start. `block` is the last question started before it. */
function keyEntries(lines, kinds, blocks) {
  const startAt = blocks.map(b => b.at), isStart = new Set(startAt);
  const out = [];
  let bi = -1;
  for (let i = 0; i < lines.length; i++) {
    while (bi + 1 < startAt.length && startAt[bi + 1] <= i) bi++;
    const k = kinds[i];
    if (k.k !== 'KEYENTRY') continue;
    const parts = [k.rest];
    for (let j = i + 1; j < lines.length && j < i + 40; j++) {
      if (isStart.has(j) || ['KEYENTRY', 'KEYHEAD', 'HEAD', 'NUM'].includes(kinds[j].k)) break;
      parts.push(lines[j].text);
    }
    out.push({ n: k.n, L: k.L, page: lines[i].page, block: bi, rationale: clean(parts.filter(Boolean).reduce((a, x) => (a ? joinWrapped(a, x) : x), '')) });
  }
  return out;
}

/* Maps key entries to questions. Entries after the same question form a RUN;
   a run answers the questions since the previous run (numbers restart per
   chapter, so the scope is what the key follows, never the whole book). In
   that scope the k-th entry numbered n goes to the k-th question numbered n
   — which covers a key page after each question page and a key section after
   each chapter or at the end alike. If the scope holds a different number of
   questions numbered n than the run has entries, every entry for n is
   AMBIGUOUS and none is used. A key never overrides an answer the question's
   own page states: it is compared, agreeing or disagreeing, and counted. */
function applyKey(questions, entries) {
  const t = { entries: entries.length, runs: 0, keyed: 0, agree: 0, disagree: 0, unmatched: 0, ambiguous: 0, pastOptions: 0,
              unmatchedPages: [], ambiguousPages: [] };
  const runs = [];
  for (const e of entries) {
    const r = runs[runs.length - 1];
    if (r && r.block === e.block) r.list.push(e); else runs.push({ block: e.block, list: [e] });
  }
  t.runs = runs.length;
  let last = -1;
  for (const r of runs) {
    const scope = r.block < 0 ? [] : questions.slice(last + 1, r.block + 1);
    last = Math.max(last, r.block);
    const byN = new Map(), inRun = new Map(), seen = new Map();
    for (const q of scope) if (q.n != null) { if (!byN.has(q.n)) byN.set(q.n, []); byN.get(q.n).push(q); }
    for (const e of r.list) inRun.set(e.n, (inRun.get(e.n) || 0) + 1);
    for (const e of r.list) {
      const o = seen.get(e.n) || 0;
      seen.set(e.n, o + 1);
      const cands = byN.get(e.n) || [];
      if (!cands.length) { t.unmatched++; t.unmatchedPages.push(e.page); continue; }
      if (cands.length !== inRun.get(e.n)) { t.ambiguous++; t.ambiguousPages.push(e.page); continue; }
      const q = cands[o];
      if (e.L >= q.options.length) { t.pastOptions++; continue; }
      if (q.ci >= 0) { if (q.ci === e.L) t.agree++; else t.disagree++; continue; }
      q.ci = e.L; q.answerBy = 'key'; q.noAnswerShapes = []; q.emphasis = '';
      if (e.rationale) q.ex = q.ex.concat([e.rationale]);
      t.keyed++;
    }
  }
  return t;
}

function layoutOf(lines, kinds, b) {
  if (kinds[b.at].k === 'HEAD') return 'heading';
  const stem = lines[b.stemAt], opt = lines[b.optAt];
  if (/^\d{1,4}\s[.)]/.test(clean(stem.text)) || /^\(?[A-Ha-h]\s[.)]/.test(clean(opt.text))) return 'spaced';
  if ((stem.size || 0) >= 14 || /calibri/i.test(stem.font || '')) return 'large';
  return 'other';
}

/* A line carries on the option above it when it sits right under it on the
   same page, is plain text, is not itself an answer, and is indented past the
   letter or set in the option's own font. */
function continues(prev, line, kind, nOpts) {
  if (kind.k !== 'TEXT' || line.page !== prev.page) return false;
  if (shortAnswer(line.text, nOpts) >= 0) return false;
  const gap = prev.y - line.y;
  if (!(gap > 0 && gap <= (prev.size || 10) * 1.6)) return false;
  return line.x0 > prev.x0 + (prev.size || 10) * 0.5 || (!!prev.font && line.font === prev.font);
}

function parseBlock(lines, kinds, b) {
  const ka = kinds[b.at], ks = kinds[b.stemAt];
  const n = ks.k === 'NUM' ? ks.n : ka.n;
  const stemParts = [ks.k === 'NUM' ? ks.rest : ''];
  for (let j = b.stemAt + 1; j < b.optAt; j++) stemParts.push(lines[j].text);
  const options = [];
  let j = b.optAt, lastLine = null;
  while (j < b.end) {
    const k = kinds[j];
    const want = options.length;
    if (k.k === 'OPT' && k.L === want) {
      const split = splitOptions(k.rest, k.L);
      for (const o of split) options.push({ t: o.t, ink: lines[j].ink || '', bf: lines[j].bf });
      lastLine = lines[j]; j++; continue;
    }
    if (options.length && lastLine && continues(lastLine, lines[j], k, 8)) {
      const o = options[options.length - 1];
      o.t = joinWrapped(o.t, lines[j].text);
      lastLine = lines[j]; j++; continue;
    }
    break;
  }
  /* What follows the options, up to the next question — or up to a
     "Question" heading that started none, which is never explanation. */
  const trail = [];
  const lastPage = lines[b.optAt].page + TRAIL_PAGES;
  const STOP = new Set(['HEAD', 'KEYHEAD', 'KEYENTRY']);   // an answer-key section is nobody's explanation
  for (; j < b.end && !STOP.has(kinds[j].k) && lines[j].page <= lastPage; j++) trail.push(j);

  /* The answer, in the order of how directly the page states it. */
  let ci = -1, by = '';
  const nOpts = options.length;
  for (let t = 0; t < trail.length && ci < 0; t++) {
    const k = kinds[trail[t]];
    if (k.k !== 'ANS') continue;
    ci = letterFrom(k.rest, nOpts);
    if (ci >= 0) by = 'answer-line';
    else { ci = answerByText(k.rest, options); if (ci >= 0) by = 'answer-text'; }
    for (let u = t + 1; ci < 0 && u < Math.min(trail.length, t + 4); u++) {
      const txt = lines[trail[u]].text;
      ci = letterFrom(txt, nOpts); if (ci >= 0) { by = 'answer-line'; break; }
      ci = sentenceHit(txt, nOpts).i; if (ci >= 0) { by = 'answer-line'; break; }
      ci = answerByText(txt, options); if (ci >= 0) { by = 'answer-text'; break; }
    }
  }
  let shortAt = -1;
  for (let t = 0; t < Math.min(trail.length, 3) && ci < 0; t++) {
    const s = shortAnswer(lines[trail[t]].text, nOpts);
    if (s >= 0) { ci = s; by = 'short-line'; shortAt = trail[t]; }
  }
  if (ci < 0) {
    const hit = sentenceHit(trail.map(i => lines[i].text).join(' '), nOpts);
    ci = hit.i;
    if (ci >= 0) by = hit.how;
  }
  if (ci < 0) {
    ci = inkAnswer(options.map(o => o.ink));
    if (ci >= 0) by = 'ink';
  }
  if (ci < 0) {
    ci = boldAnswer(options.map(o => o.bf));
    if (ci >= 0) by = 'bold';
  }

  /* The explanation: every trailing line but a bare answer letter, a new
     paragraph at each heading and at each gap wider than a line and a half. */
  const paras = [];
  let cur = '', prev = null, closeAfter = false;
  for (const i of trail) {
    if (i === shortAt) continue;
    const l = lines[i], k = kinds[i];
    const breakHere = closeAfter || k.k === 'KEY' || k.k === 'ANS' || !prev || prev.page !== l.page || (prev.y - l.y) > (prev.size || 10) * 1.9;
    if (breakHere && cur) { paras.push(clean(cur)); cur = ''; }
    cur = cur ? joinWrapped(cur, l.text) : l.text;
    /* An answer line, and a heading standing alone, are paragraphs of their own. */
    closeAfter = k.k === 'ANS' || (k.k === 'KEY' && !clean(k.rest));
    prev = l;
  }
  if (cur) paras.push(clean(cur));

  const noAnswerShapes = ci >= 0 ? [] : trail.slice(0, 2).map(i => ({ shape: shapeOf(lines[i].text), ink: lines[i].ink || '', bold: !!lines[i].bold }));
  return {
    n: n == null ? null : n,
    stem: clean(stemParts.reduce((a, s) => (a ? joinWrapped(a, s) : s), '')),
    options: options.map(o => ({ t: clean(o.t), ink: o.ink, bf: o.bf })),
    ci, answerBy: by,
    ex: paras.filter(Boolean),
    layout: layoutOf(lines, kinds, b),
    page: lines[b.at].page,
    pos: { page: lines[b.at].page, top: lines[b.at].y + (lines[b.at].size || 10) },
    noAnswerShapes,
    emphasis: ci >= 0 ? '' : emphasisPattern(options),
    stemFont: lines[b.stemAt].font || '?',
    at: b.at,
  };
}

/* "hyper-" then "tension" is one word; "beta-" then "Blocker" stays hyphenated. */
function joinWrapped(a, b) {
  const x = String(a).replace(/\s+$/, ''), y = String(b).replace(/^\s+/, '');
  if (/[a-z]-$/.test(x) && /^[a-z]/.test(y)) return x.slice(0, -1) + y;
  return x + ' ' + y;
}

/* Letters to A/a, digits to 9, space to ␣: the start of a line as a shape. */
const shapeOf = t => clean(t).slice(0, 6).replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9')
  .replace(/[^\x20-\x7e]/g, '·').replace(/ /g, '␣');

/* The whole of one PDF: pages in, questions and the counts out. */
function parseDocument(pages) {
  const { pages: kept, dropped } = stripRunning(pages);
  const lines = [];
  for (const pg of kept) for (const l of (pg.lines || [])) lines.push({ ...l, page: pg.p });
  const { kinds, blocks, orphanHeads, rejects } = segment(lines);
  const parsed = blocks.map(b => parseBlock(lines, kinds, b));
  const key = applyKey(parsed, keyEntries(lines, kinds, blocks));
  const questions = parsed.filter(q => q.options.length >= 2);

  const used = new Set();
  for (const b of blocks) { used.add(lines[b.at].page); used.add(lines[b.optAt].page); }
  const firstPage = blocks.length ? lines[blocks[0].at].page : Infinity;
  const questionish = new Set();
  lines.forEach((l, i) => { if (kinds[i].k === 'HEAD' || (kinds[i].k === 'OPT' && kinds[i].L === 0)) questionish.add(l.page); });
  const inKey = keySpans(kinds, blocks.map(b => b.at), lines);
  lines.forEach((l, i) => { if (inKey[i] && kinds[i].k === 'OPT') questionish.delete(l.page); });
  const unparsed = [...questionish].filter(p => !used.has(p)).sort((a, b) => a - b);
  const textPages = kept.filter(pg => pg.lines && pg.lines.length).map(pg => pg.p);
  /* Why: every rejection by rule, and each unparsed page under the rules
     that turned down an anchor or option on it. */
  const rejectsByReason = {}, unparsedByReason = {}, aboveOrphanA = {};
  for (const r of rejects) {
    rejectsByReason[r.reason] = (rejectsByReason[r.reason] || 0) + 1;
    if (r.above) aboveOrphanA[r.above] = (aboveOrphanA[r.above] || 0) + 1;
  }
  for (const p of unparsed) {
    const rs = new Set(rejects.filter(r => r.page === p || r.optPage === p).map(r => r.reason));
    if (!rs.size) rs.add('unexplained');
    for (const r of rs) (unparsedByReason[r] = unparsedByReason[r] || []).push(p);
  }
  let headingsAtTop = 0;
  for (const pg of kept) for (const l of (pg.lines || [])) if (HEAD_RE.test(clean(l.text)) && l.y > pg.y0 + pg.h * 0.88) headingsAtTop++;
  return {
    questions,
    stats: {
      pages: pages.length,
      textPages: textPages.length,
      noTextPages: pages.filter(pg => pg.noText).map(pg => pg.p),
      runningLinesDropped: dropped,
      unparsedPages: unparsed,
      beforeFirstQuestion: textPages.filter(p => p < firstPage).length,
      orphanHeadings: orphanHeads,
      key, rejectsByReason, unparsedByReason, aboveOrphanA, headingsAtTop,
    },
  };
}

/* ── figures ────────────────────────────────────────────────────────────── */
/* Each figure goes to the question whose start is the last one at or above
   it in reading order — pages in order, top to bottom. A figure above the
   first question on its page belongs to the question carried over from the
   page before; one above the first question of the document, to nobody. */
function attachImages(questions, images) {
  const before = (a, b) => a.page < b.page || (a.page === b.page && a.top >= b.top);
  let unassigned = 0;
  for (const q of questions) q.images = q.images || [];
  for (const im of images) {
    let owner = null;
    for (const q of questions) { if (before(q.pos, im)) owner = q; else break; }
    if (owner) owner.images.push(im); else unassigned++;
  }
  return { unassigned };
}

/* ── is it already in the bank ──────────────────────────────────────────── */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function norm(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&(#39|[a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] || ' ')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/[’‘`]/g, "'").replace(/[–—]/g, '-')
    .toLowerCase().replace(/^\s*(?:q(?:uestion)?\s*)?\d{1,4}\s?[.)](?!\d)\s*/, '')
    .replace(/\s+/g, ' ').trim();
}
const stemShingles = s => shingles(norm(s));

/* An inverted index, shingle → the questions holding it, so each candidate is
   measured against its single best match rather than against the pooled
   shingles of the whole bank — pooled, "a 65-year-old man with a history of"
   from forty different vignettes would add up to a duplicate of none of them. */
function buildIndex() { return { inv: new Map(), size: new Map() }; }
function addToIndex(idx, id, sh) {
  idx.size.set(id, sh.size);
  for (const h of sh) { let l = idx.inv.get(h); if (!l) idx.inv.set(h, l = []); l.push(id); }
}
function bestOverlap(sh, idx) {
  if (!sh.size) return { score: 0, id: null };
  const hits = new Map();
  for (const h of sh) for (const id of (idx.inv.get(h) || [])) hits.set(id, (hits.get(id) || 0) + 1);
  let best = { score: 0, id: null };
  for (const [id, c] of hits) {
    const b = idx.size.get(id);
    const score = Math.max(c / sh.size, b >= REVERSE_MIN ? c / b : 0);
    if (score > best.score) best = { score, id };
  }
  return best;
}

/* What this importer put in a bank: its chapter AND its id prefix, both — an
   export question whose id merely happens to start the same way is not ours. */
const isOurs = q => !!q && q.ch === CATEGORY && String(q.id || '').startsWith(ID_PREFIX);

/* The stems of the bank as it stands, less anything this importer put there. */
function bankStems(bank) {
  const theirs = (bank || []).filter(q => q && !isOurs(q));
  const key = stemKey(theirs);
  if (!key) throw new Error('could not tell which field of the bank holds the question stem — refusing to call anything new');
  return { key, stems: theirs.map(q => ({ id: q.id, stem: q[key] })) };
}

function dedupe(candidates, stems, { threshold = DUP_THRESHOLD } = {}) {
  const bankIdx = buildIndex(), selfIdx = buildIndex();
  for (const s of stems) addToIndex(bankIdx, s.id, stemShingles(s.stem));
  const kept = [], hist = { bank: new Array(10).fill(0), self: new Array(10).fill(0) };
  let dupBank = 0, dupSelf = 0;
  const bucket = x => Math.min(9, Math.floor(x * 10));
  candidates.forEach((c, i) => {
    const sh = stemShingles(c.stem);
    const b = bestOverlap(sh, bankIdx);
    hist.bank[bucket(b.score)]++;
    if (b.score >= threshold) { dupBank++; return; }
    const s = bestOverlap(sh, selfIdx);
    hist.self[bucket(s.score)]++;
    if (s.score >= threshold) { dupSelf++; return; }
    addToIndex(selfIdx, 'c' + i, sh);
    kept.push(c);
  });
  return { kept, dupBank, dupSelf, hist };
}

/* ── in the bank's own shape ────────────────────────────────────────────── */
const HTMLISH = /<\/?(?:p|br|b|i|strong|em|ul|ol|li|div|span|sup|sub)\b[^>]*>/i;
function inferShape(bank) {
  const qs = (bank || []).filter(q => q && !isOurs(q));
  const { key } = bankStems(qs);
  const withO = qs.filter(q => Array.isArray(q.o) && q.o.length);
  const objs = withO.filter(q => q.o[0] && typeof q.o[0] === 'object').length;
  const optObjects = objs > withO.length / 2;
  const keyCount = {};
  if (optObjects) for (const q of withO) for (const k of Object.keys(q.o[0] || {})) keyCount[k] = (keyCount[k] || 0) + 1;
  const optKeys = Object.keys(keyCount).filter(k => keyCount[k] > withO.length / 2);
  const optNumeric = {};
  for (const k of optKeys) optNumeric[k] = withO.filter(q => typeof (q.o[0] || {})[k] === 'number').length > withO.length / 2;
  /* The option's words are whichever key holds the longest strings — read,
     not assumed to be `t`. */
  let optTextKey = 't', longest = -1;
  for (const k of optKeys) {
    const v = withO.map(q => (q.o[0] || {})[k]).filter(x => typeof x === 'string');
    const avg = v.length > withO.length / 2 ? v.reduce((n, x) => n + x.length, 0) / v.length : -1;
    if (avg > longest) { longest = avg; optTextKey = k; }
  }
  /* Fields most of the bank's questions carry, so the importer can name any
     it does not fill. Names only. */
  const fieldCount = {};
  for (const q of qs) for (const k of Object.keys(q)) fieldCount[k] = (fieldCount[k] || 0) + 1;
  const commonKeys = Object.keys(fieldCount).filter(k => fieldCount[k] > qs.length / 2);
  const frac = f => { const v = qs.map(f).filter(x => typeof x === 'string' && x); return v.length ? v.filter(x => HTMLISH.test(x)).length / v.length : 0; };
  return { stemKey: key, optObjects, optKeys, optNumeric, optTextKey, commonKeys, exHtml: frac(q => q.ex) >= 0.2, stemHtml: frac(q => q[key]) >= 0.2, hasN: qs.filter(q => q.n != null).length > qs.length / 2 };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const idFor = stem => ID_PREFIX + crypto.createHash('sha1').update(norm(stem)).digest('hex').slice(0, 10);

function toBankQuestion(q, shape, { from = '', figs = [] } = {}) {
  const o = q.options.map(opt => {
    if (!shape.optObjects) return opt.t;
    const out = {};
    for (const k of shape.optKeys) out[k] = shape.optNumeric[k] ? 0 : '';
    out[shape.optTextKey || 't'] = opt.t;
    return out;
  });
  const ex = shape.exHtml ? q.ex.map(p => `<p>${esc(p)}</p>`).join('') : q.ex.join('\n\n');
  const out = { id: idFor(q.stem), ch: CATEGORY };
  if (shape.hasN) out.n = q.n;
  out[shape.stemKey] = shape.stemHtml ? esc(q.stem) : q.stem;
  out.o = o;
  out.ci = q.ci;
  out.ex = ex;
  out.img = figs.length;
  out.figs = figs;
  out.from = from;
  return out;
}

/* ── into a single-file build ───────────────────────────────────────────── */
/* Replaces whatever this importer merged before (chapter and id prefix both),
   so running it twice leaves one copy. Refuses a staged question that would
   take an id the export already uses, or that is not a whole question. The
   single-file bank carries figures in IMGS, not as `figs`, so figs becomes
   img and the data URLs go to IMGS under the same id. */
function mergeBank(bank, imgs, staged, figData) {
  const kept = bank.filter(q => !isOurs(q));
  const gone = new Set(bank.filter(isOurs).map(q => q.id));
  const removed = gone.size;
  const outImgs = {};
  for (const [k, v] of Object.entries(imgs || {})) if (!gone.has(k)) outImgs[k] = v;
  const taken = new Set(kept.map(q => q.id));
  const seen = new Set();
  let figures = 0;
  for (const s of staged) {
    if (!s || !String(s.id || '').startsWith(ID_PREFIX) || s.ch !== CATEGORY) throw new Error(`staged question ${s && s.id} is not filed as this importer's (${ID_PREFIX}, "${CATEGORY}")`);
    if (seen.has(s.id)) throw new Error(`staged question ${s.id} appears twice in the staging`);
    if (taken.has(s.id)) throw new Error(`staged question ${s.id} would take an id already in the bank`);
    if (!Array.isArray(s.o) || s.o.length < 2 || !Number.isInteger(s.ci) || s.ci < 0 || s.ci >= s.o.length)
      throw new Error(`staged question ${s.id} is not a whole question (options or answer)`);
    seen.add(s.id);
    const q = { ...s };
    delete q.figs;
    const data = (figData && figData[s.id]) || [];
    if (data.length !== (s.figs || []).length) throw new Error(`staged question ${s.id} lists ${(s.figs || []).length} figure(s), ${data.length} found`);
    q.img = data.length;
    if (data.length) outImgs[s.id] = data;
    figures += data.length;
    kept.push(q);
  }
  return { bank: kept, imgs: outImgs, removed, added: staged.length, figures };
}

/* ── the report: counts and page numbers, never text ────────────────────── */
function ranges(nums) {
  const a = [...new Set(nums)].sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${a[i]}-${a[j]}` : String(a[i]));
    i = j;
  }
  return out.join(', ') || 'none';
}
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join('  ') || 'none';

/* One file's tally, from its parse. Every value is a number, a layout name,
   a page number or a line shape. */
function tallyFile(name, parsed) {
  const t = { name, layouts: {}, answerBy: {}, noAnswerPages: [], noAnswerShapes: {}, emphasis: {}, parsed: parsed.questions.length, ...parsed.stats };
  for (const q of parsed.questions) {
    const L = t.layouts[q.layout] || (t.layouts[q.layout] = { parsed: 0, noAnswer: 0, fonts: {} });
    L.parsed++;
    L.fonts[q.stemFont || '?'] = (L.fonts[q.stemFont || '?'] || 0) + 1;
    if (q.ci < 0) {
      L.noAnswer++; t.noAnswerPages.push(q.page);
      if (q.emphasis) t.emphasis[q.emphasis] = (t.emphasis[q.emphasis] || 0) + 1;
      for (const s of q.noAnswerShapes) { const k = `${s.shape} ${s.ink || '-'}${s.bold ? ' bold' : ''}`; t.noAnswerShapes[k] = (t.noAnswerShapes[k] || 0) + 1; }
    } else t.answerBy[q.answerBy] = (t.answerBy[q.answerBy] || 0) + 1;
  }
  return t;
}

function formatReport(files, totals) {
  const out = [];
  for (const t of files) {
    out.push('', `${t.name}`);
    out.push(`  pages ${t.pages}   with a text layer ${t.textPages}   without one (skipped) ${t.noTextPages.length}${t.noTextPages.length ? ` — pages ${ranges(t.noTextPages)}` : ''}`);
    out.push(`  running header/footer lines dropped ${t.runningLinesDropped}   text pages before the first question ${t.beforeFirstQuestion}`);
    out.push(`  questions parsed ${t.parsed}`);
    for (const [k, L] of Object.entries(t.layouts)) out.push(`    layout ${k.padEnd(8)} parsed ${String(L.parsed).padStart(4)}   missing an answer ${L.noAnswer}   stem fonts ${top(L.fonts || {}, 3)}`);
    out.push(`  answer found by: ${top(t.answerBy, 8)}`);
    out.push(`  missing an answer ${t.noAnswerPages.length}${t.noAnswerPages.length ? ` — pages ${ranges(t.noAnswerPages)}` : ''}`);
    if (t.noAnswerPages.length) out.push(`    the first lines after their options, as shapes: ${top(t.noAnswerShapes, 8)}`);
    if (t.noAnswerPages.length) out.push(`    how their options differ: ${top(t.emphasis || {}, 6)}`);
    const K = t.key || {};
    out.push(`  answer key: entries ${K.entries || 0} in ${K.runs || 0} runs   keyed ${K.keyed || 0}   agreeing with the page ${K.agree || 0}   disagreeing ${K.disagree || 0}` +
             `   unmatched ${K.unmatched || 0}   ambiguous ${K.ambiguous || 0}   letter past the options ${K.pastOptions || 0}`);
    if (K.unmatched) out.push(`    unmatched entries on pages ${ranges(K.unmatchedPages)}`);
    if (K.ambiguous) out.push(`    ambiguous entries on pages ${ranges(K.ambiguousPages)}`);
    out.push(`  anchors turned down, by rule: ${top(t.rejectsByReason || {}, 8)}`);
    out.push(`  pages that look like questions but did not parse: ${ranges(t.unparsedPages)}`);
    for (const [r, ps] of Object.entries(t.unparsedByReason || {}).sort((a, b) => b[1].length - a[1].length))
      out.push(`    ${r.padEnd(16)} ${String(ps.length).padStart(4)} pages — ${ranges(ps)}`);
    if (Object.keys(t.aboveOrphanA || {}).length) out.push(`    the line above an option A no stem reached, as shape and font: ${top(t.aboveOrphanA, 6)}`);
    if (t.headingsAtTop) out.push(`  "Question" headings in the top eighth of a page: ${t.headingsAtTop}`);
    if (t.orphanHeadings.length) out.push(`  "Question" headings with no question parsed under them: ${t.orphanHeadings.length} — pages ${ranges(t.orphanHeadings)}`);
    out.push(`  figures: ${t.figures || 0} kept, ${t.tiny || 0} too small to be one, ${t.pageSized || 0} page-sized (a scan, not a figure), ${t.unassigned || 0} above the first question`);
  }
  if (totals) {
    out.push('', 'all files');
    out.push(`  parsed ${totals.parsed}   missing an answer (not staged) ${totals.noAnswer}   already in the bank ${totals.dupBank}   repeated within these PDFs ${totals.dupSelf}` +
             `   key disagrees with its own commentary (not staged) ${(totals.proseDisagrees || []).length}   ADDED ${totals.added}`);
    if ((totals.proseDisagrees || []).length) out.push(`    key against commentary, disagreeing: ${totals.proseDisagrees.join(', ')}`);
    out.push(`  added figures ${totals.figures}`);
    out.push(`  best overlap with the bank, by tenths (0.0-0.1 … 0.9-1.0): ${totals.hist.bank.join(' ')}`);
    out.push(`  best overlap with an earlier import, by tenths: ${totals.hist.self.join(' ')}`);
    out.push(`  duplicate threshold ${totals.threshold}   bank stems compared ${totals.bankStems} (field "${totals.stemKey}")`);
  }
  return out.join('\n');
}

module.exports = {
  CATEGORY, ID_PREFIX, DUP_THRESHOLD, REVERSE_MIN, TRAIL_PAGES,
  lineKind, splitOptions, shortAnswer, letterFrom, sentenceAnswer, sentenceHit, answerByText, inkAnswer, boldAnswer, emphasisPattern,
  keySpans, keyEntries, applyKey, REASONS,
  stripRunning, segment, parseBlock, parseDocument, attachImages, joinWrapped, shapeOf,
  norm, stemShingles, buildIndex, addToIndex, bestOverlap, isOurs, bankStems, dedupe,
  inferShape, toBankQuestion, idFor, mergeBank, ranges, tallyFile, formatReport,
};
