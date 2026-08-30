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

/* A PEARL IS A COMPLETE THOUGHT, NOT A SHORT ONE. The first version capped a
   pearl at 210 characters and required it to be exactly one sentence, on the
   theory that one sentence is what you can hold. In use that was wrong twice
   over: it threw away the sentence that gave a rule its exception, and it let
   through 60-character clauses that were true but taught nothing. Length was
   never the thing that made a pearl memorable — Pearl.steps() is, by breaking
   whatever arrives at its own joints.

   So the floor rises to something that has to contain a real claim, the
   ceiling rises to a short paragraph, and a pearl may now be a RUN of up to
   three consecutive sentences where they form one statement. */
const MIN = 90, MAX = 700;
const MAX_RUN = 3;                  // sentences; beyond this it is a paragraph, not a pearl
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
    /* PARAGRAPH BREAKS SURVIVE, where they used to be collapsed with every
       other run of whitespace. Now that a pearl can be several sentences, the
       boundary matters: two sentences either side of a blank line are two
       different points, and joining them makes the non-sequitur this module
       exists to avoid. Runs of spaces still collapse. */
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* The note as paragraphs of sentences. A run may never cross a blank line. */
function paragraphs(body) {
  return plain(body).split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
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

const BACKREF = /\b(above|below|as discussed|see the|earlier|the previous)\b/i;

/* A PEARL HAS TO BE A SENTENCE, NOT A LABEL. These notes use a bolded phrase
   followed by a qualifier as a pseudo-bullet written as a paragraph:

     "**A falling antihypertensive requirement over time** in a previously
      hypertensive patient, which reflects declining stroke volume rather
      than improving hypertension."

   That is a noun phrase with no main verb. It is true, it is well written, and
   quoted on its own it reads as a non-sequitur — the module already drops real
   markdown bullets for exactly this reason, and this one escapes because it is
   punctuated as a paragraph. So the test is structural rather than typographic:
   strip any trailing subordinate clause and require a finite verb in what is
   left. The example above reduces to "A falling antihypertensive requirement
   over time in a previously hypertensive patient" and is refused. */
const FINITE = new RegExp('\\b(is|are|was|were|be|been|being|has|have|had|does|do|did|can|could|'
  + 'should|shall|must|may|might|will|would|remain|remains|become|becomes|cause|causes|reduce|reduces|'
  + 'increase|increases|require|requires|predict|predicts|occur|occurs|present|presents|reflect|reflects|'
  + 'show|shows|suggest|suggests|prevent|prevents|improve|improves|worsen|worsens|carry|carries|confer|'
  + 'confers|need|needs|mean|means|make|makes|give|gives|leave|leaves|add|adds|fall|falls|rise|rises|'
  + 'begin|begins|start|starts|stop|stops|follow|follows|depend|depends|differ|differs|exceed|exceeds|'
  + 'produce|produces|drive|drives|explain|explains|support|supports|favour|favours|favor|favors)\\b', 'i');
function hasMainVerb(raw) {
  const main = String(raw).replace(/,\s*(which|who|whom|whose|where|whereas|although|though|because|while)\b[\s\S]*$/i, '');
  return FINITE.test(main);
}

/* Is this ONE sentence usable as part of a pearl? Length is not judged here —
   a run is judged as a whole — and neither is the opening pronoun, because
   "This is why…" is perfectly good as the second sentence of a statement and
   only fails as the first. */
function usable(raw) {
  const s = raw.trim();
  if (!s) return false;
  if (!/[.!?]$/.test(s)) return false;               // a fragment, or a clipped tail
  if (BACKREF.test(s)) return false;                 // points outside the pearl
  return true;
}

/* Does this stand up on its own, away from its paragraph? Kept as the single
   exported predicate, and it now accepts a run as readily as a sentence. */
function isPearl(raw) {
  /* JUDGED ON WHAT IS DISPLAYED, not on the markup it came from. clean() strips
     the bold markers, and these notes write a lead-in as "**R1 — epicardial
     conduit arteries.** Normally there is…" — with the full stop INSIDE the
     bold span. In the raw text that is one sentence; cleaned, it is two. Both
     the length and the sentence boundaries therefore have to be measured after
     cleaning, or the module is deciding about a string nobody will ever read. */
  const s = clean(String(raw || '')).trim();
  if (s.length < MIN || s.length > MAX) return false;
  if (LEADS.test(s)) return false;                   // the FIRST sentence may not
  const parts = sentences(s);
  if (parts.length > MAX_RUN + 1) return false;      // +1: cleaning can split a lead-in
  if (!parts.every(usable)) return false;
  /* A main clause has to arrive early, but not necessarily in the first
     sentence: "R1 — epicardial conduit arteries." is a label, and the statement
     it labels is the sentence after it. Requiring the verb in sentence one
     would throw away that whole shape, which is a good one. Two sentences is
     the grace, and the verbless fragment this test exists to catch is a single
     sentence, so it is still refused. */
  return hasMainVerb(parts.slice(0, 2).join(' '));
}

/* Every run of one to MAX_RUN consecutive sentences within one paragraph.
   Longest first, so an equal score prefers the fuller statement — which is the
   whole point of the change. */
function runs(sents) {
  const out = [];
  for (let n = Math.min(MAX_RUN, sents.length); n >= 1; n--) {
    for (let i = 0; i + n <= sents.length; i++) out.push(sents.slice(i, i + n).join(' '));
  }
  return out;
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
  /* Retuned for the new range. The old bonus peaked at 90-175 characters,
     which after the ceiling moved would have gone on quietly preferring the
     shortest thing that qualified — the exact complaint this is fixing. A
     complete statement in these notes runs about 150-450 characters. */
  if (raw.length >= 150 && raw.length <= 450) n += 2;
  else if (raw.length > 450) n += 1;
  /* A rule and its qualification in one breath is the shape of a real pearl,
     and it is almost always two sentences rather than one. */
  if (ACT.test(raw) && DISC.test(raw)) n += 2;

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
    for (const para of paragraphs(r.body)) {
      const sents = sentences(para);
      for (const run of runs(sents)) {
        if (!isPearl(run)) continue;
        const sc = score(run);
        /* Strictly greater, and runs() yields longest first — so among equals
           the fuller statement is the one that was seen first and kept. */
        if (sc > bestScore) { bestScore = sc; best = run; }
      }
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

/* ═══ One sentence, broken at its own joints ═══════════════════════════════
   A pearl is one sentence, and one sentence is a wall. Broken where it
   already bends — at a colon, at a semicolon, at the connective that
   introduces a consequence or a caveat — it becomes a short ladder, and a
   ladder is what gets memorised. "Clinical restenosis is a different process:
   intimal hyperplasia, generally developing within the first 6–9 months,
   presenting as recurrent angina rather than an acute event" is four facts
   wearing the costume of one; numbered, it is four things to remember.

   Nothing is invented and nothing is reordered. Every step is a span of the
   original sentence, in sequence.

   THE EM-DASH IS THE ONE AMBIGUOUS JOINT. A single one is a real break —
   "…risk becomes roughly linear — so the first six months are where
   prevention earns its benefit". A PAIR is a parenthesis: "Oral beta-blockers
   should be started within the first 24 hours — a Class I recommendation — in
   patients without contraindications." Cutting inside that leaves a fragment
   and an aside pretending to be steps, so the cut is only made when there is
   exactly one dash to make it at.

   THE LABEL IS LIFTED, NOT DUPLICATED. A step opening "so …" is tagged SO and
   loses the word, because printing it in both places reads as a stutter. Only
   connectives whose removal is grammatically inert are lifted — "so", "but",
   "or", "and", "after which". "Because", "if", "unless" and "which" carry
   meaning inside the clause and are left exactly where the author put them. */

const CONNECTIVES =
  'so|but|which|because|since|whereas|although|though|yet|unless|provided|or|and|with|without|' +
  'after which|then|if|when|while|resulting|leading|presenting|showing|developing|meaning|' +
  'performed|given|producing|causing|followed|' +
  /* a purpose clause followed by its instruction — "To avoid X, use Y" */
  'use|give|start|consider|check|avoid|treat|prefer|repeat|stop';

/* Lifted into the step's label. Deliberately short: every entry here is a word
   the sentence still reads correctly without. */
const LIFT = [
  [/^(?:so|therefore|thus|hence)\b[,]?\s+/i,   'so'],
  [/^(?:but|however|yet)\b[,]?\s+/i,           'but'],
  [/^(?:after which|then)\b[,]?\s+/i,          'then'],
  [/^or\b\s+/i,                                'or'],
  [/^and\b\s+/i,                               ''],
];

const MIN_STEP = 16;   // shorter than this is an aside, not a step
const WEAK_MIN = 30;   // "…, or X" needs to be a clause, not the tail of a list
const MAX_STEPS = 5;   // more than five is a list again

function steps(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  const dashes = (t.match(/\s[—–]\s/g) || []).length;
  /* Captured, not consumed: a piece that turns out not to be a step has to be
     put back the way it was found, and that needs the separator it was cut at. */
  const cut = new RegExp(
    '(:\\s+' +
    '|;\\s+' +
    (dashes === 1 ? '|\\s[—–]\\s' : '') +
    '|,\\s+(?=(?:' + CONNECTIVES + ')\\b))', 'i');

  const raw = t.split(cut);
  const pieces = [{ sep: '', text: (raw[0] || '').trim() }];
  for (let i = 1; i < raw.length; i += 2) {
    const body = (raw[i + 1] || '').trim();
    if (body) pieces.push({ sep: raw[i], text: body });
  }

  const join = (a, b) => a.text + (/^\s*[,;:]/.test(b.sep) ? b.sep.replace(/\s+$/, ' ') : ' — ') + b.text;

  /* Three ways a piece is not a step of its own:
       · it is too short to stand up — an apposition, "…, 42% versus 31%";
       · it is the tail of a list rather than a new clause — "…, or refractory
         angina" closes "haemodynamic instability, cardiogenic shock, or
         refractory angina", and cutting there leaves the list beheaded;
       · the FIRST piece is short, which the others' rule cannot fix because
         there is nothing behind it to fold into.
     The first two fold backwards, the third forwards, and all three keep the
     separator they were cut at, so the sentence survives being rejoined. */
  const weak = p => /^(?:or|and)\b/i.test(p.text);
  const merged = [];
  for (const p of pieces) {
    const tooShort = p.text.length < MIN_STEP;
    const listTail = weak(p) && p.text.length < WEAK_MIN;
    if (merged.length && (tooShort || listTail)) {
      merged[merged.length - 1] = { sep: merged[merged.length - 1].sep,
                                    text: join(merged[merged.length - 1], p) };
    } else merged.push(p);
  }
  while (merged.length > 1 && merged[0].text.length < MIN_STEP) {
    const head = merged.shift();
    merged[0] = { sep: head.sep, text: join(head, merged[0]) };
  }
  while (merged.length > MAX_STEPS) {
    const tail = merged.pop();
    merged[merged.length - 1] = { sep: merged[merged.length - 1].sep,
                                  text: join(merged[merged.length - 1], tail) };
  }
  if (merged.length < 2) return [{ lead: '', text: t.replace(/\s*\.$/, '') }];

  return merged.map((piece, i) => {
    let body = piece.text, lead = '';
    if (i > 0) {
      for (const [re, label] of LIFT) {
        if (re.test(body)) { body = body.replace(re, ''); lead = label; break; }
      }
    }
    /* A step opens a line of its own, so it is given a capital — except where
       the first word is cased the way the notes cased it: a gene, a trial name,
       a drug whose lower-case initial is the term. */
    if (body && /^[a-z]/.test(body) && !/^[a-z]+[A-Z0-9]/.test(body)) {
      body = body.charAt(0).toUpperCase() + body.slice(1);
    }
    /* No step ends in a full stop. Only the last one would have had one, and a
       ladder where the final rung alone is punctuated looks like an error. */
    return { lead, text: body.replace(/[,;:]\s*$/, '').replace(/\s*\.$/, '') };
  }).filter(s => s.text);
}

root.Pearl = { harvest, pick, isPearl, usable, hasMainVerb, score, sentences, paragraphs, plain, clean,
               weakWords, steps, runs, MIN, MAX, MAX_RUN };

})(typeof window !== 'undefined' ? window : this);
