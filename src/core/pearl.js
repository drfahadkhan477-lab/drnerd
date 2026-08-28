/* ═══════════════════════════════════════════════════════════════════════════
   pearl.js — one fact from your own notes, on the home screen.

   The hero is the first thing seen every morning and, below the wordmark, it
   was chrome: a question count, a percentage, and a rhythm label naming the
   trace behind it. Handsome, and it taught nothing. A board candidate opening
   a study app should read something worth knowing before they read a metric.

   WHERE THE PEARLS COME FROM. The 146 reference notes already on the shelf —
   Braunwald-sourced, written for this exam. Nothing is invented here and no
   second corpus is maintained: this only has to *find* the good sentence in
   prose that already exists.

   WHAT MAKES A SENTENCE A PEARL. Not every sentence in a note survives being
   pulled out of it. The ones that do are self-contained and carry a fact:

     · a bolded term, which is how these notes mark the thing being taught;
     · a number — a dose, a threshold, a cut-off, a trial year;
     · a trial name in capitals.

   And the ones that cannot survive are excluded by the same reasoning: a
   sentence opening with "This", "That", "It" or "These" refers to the
   paragraph it was lifted from, and reads as a non-sequitur alone.

   WEIGHTED TOWARD WHERE YOU ARE WEAK. The app already computes weak chapters
   for Apex's prompt, so a pearl can be aimed rather than merely random —
   without asking a model, a network call, or a second data source. The
   weighting is gentle: strongest chapters still appear, because a revision
   tool that only ever shows your failures is a tool people stop opening.

   Depends on app globals (REF, Profile, S) — embedded, not standalone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const MIN = 55, MAX = 210;          // characters: a sentence, not a clause or a paragraph
const LEADS = /^(this|that|these|those|it|they|he|she|there|such|both|either|neither|hence|so|then|thus|however|instead|again)\b/i;

/* Strip the note's markup back to the prose underneath. Figures go entirely —
   a caption is not a pearl — and emphasis markers go after being used as a
   signal for whether the sentence carries a taught term. */
function plain(body) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // figures
    .replace(/`[^`]*`/g, ' ')                        // code spans
    .replace(/^#{1,6}\s+.*$/gm, ' ')                 // headings
    /* Bullets and table rows are DROPPED, not unwrapped. A list item is
       written to be read under its stem — "A falling antihypertensive
       requirement…, which reflects declining stroke volume" is a noun phrase
       with no main verb, and it passes every structural test while reading as
       a non-sequitur on its own. Only prose sentences survive being quoted. */
    .replace(/^\s*([-*·+]|\d+\.)\s+.*$/gm, ' ')      // list items
    .replace(/^\s*\|.*$/gm, ' ')                     // table rows
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(text) {
  /* Split on sentence enders, but not on the decimal points and abbreviations
     these notes are full of — "0.5 mg", "vs.", "Fig. 54.1", "e.g." */
  return text
    .replace(/\b(vs|e\.g|i\.e|approx|Dr|Fig|No|cf)\.\s/gi, '$1<abbr> ')
    /* The lookahead has to step over emphasis markers and an opening quote:
       these notes bold the term being taught, so a sentence very often starts
       "**Finerenone** is…", and looking only for a capital left two sentences
       fused into one pearl that read as a non-sequitur. */
    .split(/(?<=[.!?])\s+(?=[*_"'“(]*[A-Z(])/)
    .map(s => s.replace(/<abbr>/g, '.').trim());
}

/* Does this sentence stand up on its own, away from its paragraph? */
function isPearl(raw) {
  const s = raw.trim();
  if (s.length < MIN || s.length > MAX) return false;
  if (LEADS.test(s)) return false;                   // refers to what came before
  if (!/[.!?]$/.test(s)) return false;               // a fragment, or a clipped tail
  if (/\b(above|below|as discussed|see the|earlier|the previous)\b/i.test(s)) return false;
  return true;
}

/* Higher is better. The first version scored capitals and digits, and promoted
   "Key transcription factors include GATA4, Nkx2.5, SRF, MEF2 and NFAT" to the
   top of the pile — every signal it looked for, and nothing anyone can use in
   an exam. A list of names is the shape that games a naive score, so it is
   named and penalised here rather than left to be outweighed.

   What actually makes a board pearl is a DECISION or a DISCRIMINATION: a
   threshold you act on, a rule with an exception, one thing told from another.
   That is what the weights below reward. */
const ENUM = /\b(include|includes|including|such as|for example|comprise|consist)\b/i;
const ACT  = /\b(should|must|never|always|only|first-line|contraindicat|indicated|requires?|avoid|before|within|at least|no longer|instead of|failure to)\b/i;
const DISC = /\b(distinguish\w*|differentiat\w*|unlike|whereas|rather than|versus|vs\.?|in contrast|but not|as opposed to|mistak\w+|misread)\b/i;
const UNIT = /\d\s?(mg|mcg|g|mmhg|ml|l\/min|%|hours?|hrs?|days?|weeks?|months?|years?|beats|bpm|mm|cm|msec|ms|meq|mmol)\b/i;
const TRIAL = /\b[A-Z][A-Z0-9-]{3,}\b/;

function score(raw) {
  let n = 0;
  if (/\*\*[^*]+\*\*/.test(raw)) n += 2;             // a term the note bolded
  if (UNIT.test(raw)) n += 4;                        // a real threshold, not just a digit
  else if (/\d/.test(raw)) n += 1;
  if (ACT.test(raw)) n += 3;                         // tells you what to do
  if (DISC.test(raw)) n += 3;                        // tells one thing from another
  if (TRIAL.test(raw)) n += 1;                       // PARADIGM, COAPT, STICH
  if (raw.length > 90 && raw.length < 175) n += 1;   // a statement, not a label

  /* An enumeration of proper nouns reads as a glossary entry pulled out of
     context. Commas are the tell: four or more in one sentence is a list. */
  if (ENUM.test(raw)) n -= 4;
  if ((raw.match(/,/g) || []).length >= 4) n -= 3;
  if (/\band\s+[A-Z]\w*\.\s*$/.test(raw)) n -= 2;    // "…, X and Y." — ends mid-list
  return n;
}

function clean(raw) {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    /* Splitting a sentence out of a paragraph can sever a bold span, leaving
       an opening ** with its partner in the next sentence. Balanced-pair
       removal cannot see those, so anything still standing goes here — these
       are markup characters, and none of them belongs in clinical prose. */
    .replace(/[*_`]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* One entry per note: its best sentence, and how good that sentence is. Notes
   with nothing quotable simply do not appear. */
function harvest(notes) {
  const out = [];
  for (const r of (notes || [])) {
    let best = null, bestScore = -1;
    for (const s of sentences(plain(r.body))) {
      if (!isPearl(s)) continue;
      const sc = score(s);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (best && bestScore >= 5) {
      /* The note's own first figure, so a pearl can be shown with the diagram
         that explains it rather than as a line of text on its own. */
      const fig = /!\[([^\]]*)\]\(refimg:\/\/([^)\s]+)\)/.exec(r.body || '');
      out.push({ id: r.id, title: r.title || '', text: clean(best), score: bestScore,
                 chapter: (r.title || '').split('—')[0].trim(), source: r.source || '',
                 figKey: fig ? fig[2] : '', figCap: fig ? fig[1] : '' });
    }
  }
  return out;
}

/* Weak-chapter weighting, done on words rather than on an exact chapter match:
   note titles ("HFrEF guideline-directed therapy — Devices") and question-bank
   chapters ("Heart Failure & Cardiomyopathies") name the same territory and
   almost never the same string. */
function weakWords(limit) {
  try {
    if (typeof Profile === 'undefined') return [];
    const words = [];
    for (const w of Profile.weakChapters(6, limit || 3)) {
      for (const t of String(w.ch).toLowerCase().split(/[^a-z]+/)) {
        if (t.length > 4) words.push(t);
      }
    }
    return words;
  } catch (_) { return []; }
}

function weightOf(p, words) {
  if (!words.length) return 1;
  const hay = (p.title + ' ' + p.source).toLowerCase();
  return words.some(w => hay.includes(w)) ? 3 : 1;
}

/* Weighted pick, with the previous pearl excluded so "next" always moves. */
function pick(pearls, prevId, rand) {
  const r = rand || Math.random;
  const list = pearls.filter(p => p.id !== prevId || pearls.length === 1);
  if (!list.length) return null;
  const words = weakWords(3);
  const weights = list.map(p => weightOf(p, words) * (1 + p.score / 10));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = r() * total;
  for (let i = 0; i < list.length; i++) {
    t -= weights[i];
    if (t <= 0) return list[i];
  }
  return list[list.length - 1];
}

root.Pearl = { harvest, pick, isPearl, score, sentences, plain, clean, weakWords };

})(typeof window !== 'undefined' ? window : this);
