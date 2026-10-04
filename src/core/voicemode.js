/* ═════════════════════════════════════════════
   voicemode.js — a question session you can do with your hands full.

   The parts of a spoken session that are NOT the speaker and the microphone,
   which are the device's: what to read out, how to understand what was said,
   and what happens next. All pure, so each can be held by a test; the screen
   that eventually wraps it only has to speak and listen.

     speakable(q)          the question as a list of things to say, in order
     parseAnswer(text, n)  "bee", "I'll go with C", "repeat that", "skip" → a decision
     step(state, event, ctx)  the conversation: the next state and what to DO

   The hard part is the second. Speech recognition does not hear letters, it hears
   words: "C" arrives as "see" or "sea", "D" as "dee", "B" as "be" or "bee", and an
   "A" arrives as "a", which is also the commonest word in English. So a letter
   is believed only where it can be meant as one (alone, in a short utterance, or
   after a word like "option" or "answer"), more than one different letter is
   ambiguous, and anything else asks again instead of guessing: a wrong guess is
   scored against you as a wrong answer, which it would not have been.

   No content leaves the device here; this builds strings and decisions.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const arr = v => Array.isArray(v) ? v : [];
const LETTERS = 'ABCDEFGH';

/* Markup out, whitespace collapsed: what a speaker should be handed. */
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, ' and ').replace(/&lt;/g, ' less than ').replace(/&gt;/g, ' greater than ')
    .replace(/[*`#>]/g, ' ').replace(/(^|\s)_+|_+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();   // _ only as emphasis, at a word's edge
}

/* No lookbehind: it is a parse-time SyntaxError on iPadOS Safari below 16.4 and
   takes the whole script block with it. Capture the ender, re-attach it, and
   split on a NUL that prose cannot contain (the same move src/core/pearl.js makes). */
function sentences(text) {
  return clean(text).replace(/([.!?])\s+(?=[A-Z(])/g, '$1\u0000').split('\u0000').map(s => s.trim()).filter(Boolean);
}

/* speakable(q) → { parts: [string], optionCount }. The stem, then each option as
   "Option A. <text>", so a listener can hold the choices by their letters. */
function speakable(q) {
  q = q || {};
  const parts = [];
  const stem = clean(q.s);
  if (stem) parts.push(...sentences(stem));
  const opts = arr(q.o);
  opts.forEach((o, i) => {
    const t = clean(o && o.t);
    if (t) parts.push(`Option ${LETTERS[i]}. ${t}.`.replace(/\.\.$/, '.'));
  });
  return { parts, optionCount: opts.length };
}

/* ── understanding what was said ─────────────────────────────────────── */
const HEARD = {
  a: ['a', 'ay', 'eh', 'alpha'], b: ['b', 'be', 'bee', 'bravo'], c: ['c', 'see', 'sea', 'charlie'],
  d: ['d', 'dee', 'delta'], e: ['e', 'ee', 'echo'], f: ['f', 'eff', 'foxtrot'],
};
const WORD2LETTER = {};
Object.keys(HEARD).forEach(l => HEARD[l].forEach(w => { WORD2LETTER[w] = l; }));
const NUMBER = { one: 0, two: 1, to: 1, too: 1, three: 2, four: 3, for: 3, five: 4, six: 5 };
const TRIGGER = new Set(['option', 'letter', 'answer', 'choose', 'pick', 'select', 'is', 'its', "it's", 'go', 'with', 'say', 'number', 'final']);
const COMMANDS = [
  ['repeat', /\b(repeat|say (that )?again|once more|read (it|that|the question) again|come again|pardon|what was that)\b/],
  ['stop',   /\b(stop|quit|end( the)? session|finish|exit|that'?s enough|i'?m done)\b/],
  ['explain',/\b(explain|explanation|why|tell me more)\b/],
  ['skip',   /\b(skip|pass|next question|move on|i (do not|don'?t) know|dunno|no idea)\b/],
  ['next',   /\b(next|continue|go on|carry on|okay next|ready)\b/],
];

/* parseAnswer(transcript, optionCount) →
     { type: 'answer', index }  |  { type: 'command', command }  |  { type: 'unclear', reason } */
function parseAnswer(transcript, n) {
  const text = String(transcript == null ? '' : transcript).toLowerCase().replace(/[.,!?;:"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { type: 'unclear', reason: 'silence' };
  const count = Number.isInteger(n) && n > 0 ? Math.min(n, LETTERS.length) : 5;
  const tokens = text.split(' ');

  /* an explicit command wins unless a letter is clearly being chosen */
  const hasTrigger = tokens.some(t => TRIGGER.has(t));
  const letters = [];
  tokens.forEach((t, i) => {
    const l = WORD2LETTER[t];
    if (!l) return;
    /* "a", "be", "see" and the rest are ordinary words as well as letters. They
       count only when they are the whole phrase, or come last right after a
       word like "option" or "answer is": "it is a heart failure" is not option A. */
    const plainWord = ['a', 'be', 'see', 'sea', 'ee', 'eh', 'ay'].includes(t);
    if (plainWord && !(tokens.length <= 2 || (i === tokens.length - 1 && i > 0 && TRIGGER.has(tokens[i - 1])))) return;
    letters.push(l);
  });
  tokens.forEach((t, i) => {
    if (NUMBER[t] === undefined) return;
    if (tokens.length <= 2 || (i > 0 && ['option', 'number', 'answer'].includes(tokens[i - 1]))) letters.push(LETTERS[NUMBER[t]].toLowerCase());
  });
  const distinct = [...new Set(letters)];
  /* "both a and b", "either c or d": two choices were named, whatever happened to the first. */
  if (distinct.length >= 1 && (/\b(both|either|between)\b/.test(text) || /\b(a|b|c|d|e|f|be|bee|see|dee)\s+(and|or)\s+\S/.test(text)))
    return { type: 'unclear', reason: 'ambiguous' };

  if (distinct.length === 1 && (tokens.length <= 6 || hasTrigger)) {
    const index = LETTERS.toLowerCase().indexOf(distinct[0]);
    if (index >= count) return { type: 'unclear', reason: 'out-of-range' };
    return { type: 'answer', index };
  }
  if (distinct.length > 1) {
    for (const [cmd, re] of COMMANDS) if (re.test(text)) return { type: 'command', command: cmd };
    return { type: 'unclear', reason: 'ambiguous' };
  }
  for (const [cmd, re] of COMMANDS) if (re.test(text)) return { type: 'command', command: cmd };
  return { type: 'unclear', reason: 'no-answer' };
}

/* ── the conversation ────────────────────────────────────────────────── */

function init(count) {
  return { phase: count > 0 ? 'asking' : 'done', i: 0, count: Math.max(0, count | 0), tries: 0, answered: 0, correct: 0, skipped: 0, results: [] };
}

function firstSentences(ex, n) {
  return sentences(ex).slice(0, n).join(' ');
}

function feedbackText(q, index) {
  const keyed = arr(q.o)[q.ci];
  const right = index === q.ci;
  const key = keyed ? `${LETTERS[q.ci]}. ${clean(keyed.t)}` : LETTERS[q.ci];
  const why = firstSentences(q.ex, 2);
  return (right ? 'Correct. ' : `Not quite. The answer is ${key}. `) + (why ? why : '');
}

/* step(state, event, ctx) → { state, effects }
   events: { type:'questionRead' } | { type:'heard', transcript } | { type:'silence' } | { type:'feedbackRead' }
   ctx:    { q }  the question the state is on.
   effects the screen performs, in order:
     { type:'ask', i }  { type:'speak', text }  { type:'listen' }  { type:'record', i, id, choice, correct }  { type:'done', summary } */
function step(state, event, ctx) {
  const s = Object.assign({}, state, { results: state.results.slice() });
  const q = (ctx && ctx.q) || {};
  const fx = [];
  const finish = () => {
    s.phase = 'done';
    fx.push({ type: 'done', summary: `Finished. ${s.correct} of ${s.answered} correct${s.skipped ? `, ${s.skipped} skipped` : ''}.` });
    return { state: s, effects: fx };
  };
  const advance = () => {
    s.i += 1; s.tries = 0;
    if (s.i >= s.count) return finish();
    s.phase = 'asking'; fx.push({ type: 'ask', i: s.i });
    return { state: s, effects: fx };
  };
  if (s.phase === 'done') return { state: s, effects: [] };

  if (event.type === 'start') { return s.phase === 'asking' ? { state: s, effects: [{ type: 'ask', i: 0 }] } : { state: s, effects: [] }; }

  if (s.phase === 'asking' && event.type === 'questionRead') {
    s.phase = 'listening'; fx.push({ type: 'listen' });
    return { state: s, effects: fx };
  }

  if (s.phase === 'listening') {
    if (event.type === 'silence' || event.type === 'heard') {
      const heard = event.type === 'heard' ? parseAnswer(event.transcript, arr(q.o).length) : { type: 'unclear', reason: 'silence' };
      if (heard.type === 'answer') {
        const correct = heard.index === q.ci;
        s.answered += 1; if (correct) s.correct += 1;
        s.results.push({ id: q.id, choice: heard.index, correct });
        s.phase = 'feedback';
        fx.push({ type: 'record', i: s.i, id: q.id, choice: heard.index, correct });
        fx.push({ type: 'speak', text: feedbackText(q, heard.index) });
        return { state: s, effects: fx };
      }
      if (heard.type === 'command') {
        if (heard.command === 'stop') return finish();
        if (heard.command === 'repeat') { s.phase = 'asking'; s.tries = 0; fx.push({ type: 'ask', i: s.i }); return { state: s, effects: fx }; }
        if (heard.command === 'skip' || heard.command === 'next') {
          s.skipped += 1; s.results.push({ id: q.id, choice: null, correct: false, skipped: true });
          fx.push({ type: 'speak', text: 'Skipping.' });
          return advance();
        }
        if (heard.command === 'explain') {
          fx.push({ type: 'speak', text: firstSentences(q.ex, 3) || 'There is no explanation for this one.' }, { type: 'listen' });
          return { state: s, effects: fx };
        }
      }
      /* unclear: ask again rather than guess; give up after three */
      s.tries += 1;
      if (s.tries >= 3) {
        s.skipped += 1; s.results.push({ id: q.id, choice: null, correct: false, skipped: true });
        fx.push({ type: 'speak', text: 'I did not catch an answer, so I will move on.' });
        return advance();
      }
      const why = heard.reason === 'ambiguous' ? 'I heard more than one letter.' : heard.reason === 'out-of-range' ? 'That is not one of the options.' : 'I did not catch that.';
      fx.push({ type: 'speak', text: `${why} Say a letter from A to ${LETTERS[Math.max(0, arr(q.o).length - 1)]}, or say repeat.` }, { type: 'listen' });
      return { state: s, effects: fx };
    }
  }

  if (s.phase === 'feedback' && event.type === 'feedbackRead') return advance();
  return { state: s, effects: [] };
}

root.VoiceMode = { speakable, parseAnswer, init, step, feedbackText, clean };

})(typeof window !== 'undefined' ? window : this);
