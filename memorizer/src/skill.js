/* ═══════════════════════════════════════════════════════════════════════════
   skill.js — the Supreme Memorizer skill, compiled into the app.

   The owner's own Claude skill (supreme-memorizer, v3.0) is the protocol this
   app was built to run. A Claude skill is instructions a model reads; this
   app runs in a browser, often with no model at all, so the skill is carried
   two ways:

     · AS RULES THE CODE FOLLOWS, for every coach — the error taxonomy (every
       miss is R, E, C or N, and the type decides the fix), the graduation
       rule (two correct retrievals in separate, non-adjacent rounds), the
       re-teach rule (a second miss switches hook TYPE, not volume), and the
       closing deliverable. session.js and coach.js read them from here.
       On a multiple-choice drill the type is read from what happened, not
       guessed: a wrong option picked is C (it is what the fact was confused
       with), "not sure" is N, missed then right on the retry is R, missed
       twice is E.
     · AS THE SYSTEM PROMPT, for Claude — systemText() below, sent as its own
       block after the grounding rule and marked for prompt caching, so the
       protocol is paid for once per few minutes rather than on every step.

   WHY NOT A CLAUDE "AGENT SKILL" ON THE API. Agent Skills load inside a
   code-execution container on Anthropic's side and are built for work that
   produces files. Every step here is a schema-checked JSON reply the
   student is waiting on; a container per step would add seconds and cost,
   and the structured-output guarantee the grader depends on. Compiling the
   skill keeps both.

   WHAT IS NOT CARRIED OVER, and why: the skill's "draw on Braunwald" source
   rule (this app teaches only from the uploaded PDF — the grounding rule in
   prompts.js wins wherever the two disagree); its free-recall and
   explain-aloud passes (the owner replaced them with multiple choice); its
   navy/gold palette (the app has its own themes); its sprint clock and
   break prompts, and its self-growing known-mnemonics file (not built yet).

   PURE.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var VERSION = 'supreme-memorizer 3.0';

/* The error taxonomy (skill §9). The fix is what the app does next. */
var ERRORS = {
  R: { name: 'Retrieval', means: 'You had part of it: the memory is there, pulling it cold failed.',
       fix: 'More retrieval, not a new hook: it comes back later this session and on your review schedule.' },
  E: { name: 'Encoding', means: 'The hook did not make a memory. Nothing stuck the first time.',
       fix: 'A different kind of hook, not the same one louder.' },
  C: { name: 'Confusion', means: 'You picked a different item from this material.',
       fix: 'Learn the difference: the two side by side.' },
  N: { name: 'Never encountered', means: 'You were not sure at all.',
       fix: 'A short re-teach from the page, then back into the questions.' },
};
var TYPES = ['R', 'E', 'C', 'N'];

/* Hook types the built-in coach can make without inventing anything —
   every one is built from the PDF's own words. Claude may use any of the
   skill's (acrostic, story, spatial image, analogy, contrast). */
var HOOKS = {
  letters: 'First letters',
  sentence: 'The sentence itself',
  chain: 'The chain it sits in',
  row: 'Its row in the table',
  contrast: 'Side by side',
  teach: 'Re-read from the page',
};

/* Two correct retrievals, in rounds at least two apart, since the last
   miss. A miss wipes the count: "one correct answer after a miss = still
   on the list" (skill §9). */
function graduated(item) {
  var h = (item && item.hits) || [];
  for (var i = 0; i < h.length; i++) for (var j = i + 1; j < h.length; j++) if (Math.abs(h[j] - h[i]) >= 2) return true;
  return false;
}

/* A one-line weak list, as the skill shows it after each round (§9):
   "Weak: preload (Type R · 2 misses), …". */
function weakLine(items, max) {
  var open = (items || []).filter(function (w) { return !graduated(w); });
  if (!open.length) return '';
  open.sort(function (a, b) { return b.misses - a.misses || a.order - b.order; });
  var shown = open.slice(0, max || 3).map(function (w) {
    var t = w.types[w.types.length - 1];
    return w.label + ' (Type ' + t + (t === 'C' && w.confusedWith ? ' — with ' + w.confusedWith : '') +
      ' · ' + w.misses + (w.misses === 1 ? ' miss' : ' misses') + ')';
  });
  return 'Weak: ' + shown.join(', ') + (open.length > shown.length ? ' and ' + (open.length - shown.length) + ' more' : '');
}

/* The protocol, for Claude. Written as rules the model applies, in the
   order a step needs them. Long enough to be cached on its own (Opus 5
   caches a prefix of 512 tokens or more). */
function systemText() {
  return [
    'COACHING PROTOCOL: Supreme Memorizer (' + VERSION + '). You are a sharp, warm, no-nonsense memory coach. ' +
    'The goal is time-to-mastery: the student must recall each fact, tell it apart from its neighbours, and reason with it. ' +
    'Where anything below disagrees with the grounding rule above, the grounding rule wins: teach only from the excerpt.',
    '',
    'PRINCIPLES YOU APPLY (as decisions, not decoration):',
    '- Testing effect: every lesson is followed at once by retrieval; the student answers before seeing any answer.',
    '- Desirable difficulty: questions make the student think — which is most likely, what happens next, all EXCEPT — not recognise a phrase.',
    '- Encoding variability: when a hook failed, a different TYPE of hook, not the same hook louder.',
    '- Dual coding: for a process, pathway, sequence or structure, a diagram alongside the words.',
    '- Schema anchoring: at most one anchor per new idea, and only to something in the excerpt.',
    '- Interleaving: earlier sections come back mixed with new ones; that is handled by the app, not by you.',
    '',
    'LESSONS AND HOOKS:',
    '- One testable fact per key point. If it needs two sentences, it is two points.',
    '- One hook per list or fact, instantly visualisable; never two competing hooks for the same fact.',
    '- Hook types: acrostic, story, spatial image, analogy, contrast. Never the same hook structure for two adjacent lists.',
    '- A hook is built only from the excerpt’s words and facts; an analogy may use everyday images but carries no fact of its own.',
    '',
    'MULTIPLE-CHOICE QUESTIONS (the drill and the exam):',
    '- Every wrong option is a confusion a student really makes with THIS material: the neighbouring cause, the other ' +
    'valve or drug or value in the same excerpt, the reverse mechanism. The app treats the option a student picks as ' +
    'what they confused the fact with, and shows the two side by side — so each wrong option must be a real item or ' +
    'claim that the excerpt shows to be wrong here, never filler.',
    '- The explanation says why the right option is right in the excerpt’s words, with its page.',
    '- No "all of the above", no "none of the above", no trick wording. Score honestly: close is not correct.',
    '',
    'THE ERROR TYPES THE APP ASSIGNS (so your questions make them meaningful):',
    '- C (confusion): picked a wrong option — fixed by contrasting the two.',
    '- N (never encountered): answered "not sure" — fixed by a short re-teach from the page.',
    '- R (retrieval): missed, then right when asked again — the memory is there; fixed by more retrieval.',
    '- E (encoding): missed twice — nothing stuck; fixed by a new hook of a different type.',
    '',
    'THE FINAL EXAM (the hostile examiner):',
    '- Genuinely challenging, not artificially gentle: comparisons between sections, edge cases, the easy-to-confuse detail.',
    '- Lean on the sections where the student is weakest.',
    '- Every question still answerable from the material given.',
  ].join('\n');
}

var MemSkill = { VERSION: VERSION, ERRORS: ERRORS, TYPES: TYPES, HOOKS: HOOKS,
  graduated: graduated, weakLine: weakLine, systemText: systemText };
root.MemSkill = MemSkill;
if (typeof module !== 'undefined' && module.exports) module.exports = MemSkill;
})(typeof window !== 'undefined' ? window : this);
