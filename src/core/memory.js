/* ═══════════════════════════════════════════════════════════════════════════
   memory.js — what Apex knows about this fellow, kept across sessions.

   Profile (src/core/profile.js) already tells Apex how the fellow is *scoring*.
   It is derived: recomputed from S on every turn, storing nothing. This is the
   other half, and it is the opposite — durable, written, and about things no
   score can show:

     "Sitting the boards in October."
     "Keeps reading constrictive pericarditis as restrictive cardiomyopathy."
     "Wants the mechanism before the trial."

   Without it, every session opens with a tutor who has never met you. You say
   the exam is in October, it teaches accordingly, you close the tab, and it is
   gone. A tutor who has taught you for months should not need re-briefing.

   FOUR KINDS, because they decay differently.

     fact        something true about them        — exam date, training year
     gap         a confusion worth pressing on    — the two they keep swapping
     preference  how they want to be taught       — mechanism first, be blunt
     session     an auto-summary of one sitting   — written by the summariser

   Only 'session' grows without bound: one per finished quiz, forever. So when
   the cap is hit those go first, oldest before newest, and the three kinds the
   fellow actually shaped are kept. A memory store that evicts "I sit boards in
   October" to make room for "answered 12 questions on Tuesday" would be worse
   than no store at all.

   EVERY LINE CARRIES ITS ID. build() tags each memory [m3f2…] so the model can
   name one back in the forget tool. Without a handle, a memory that has gone
   stale — "I no longer mix those up" — can only be corrected by the fellow
   going and finding it, and a wrong memory is worse than a missing one.

   Depends on app globals (loadJSON, saveJSON) — embedded into the app, not
   standalone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const MEM_KEY = 'accsap12.mem';
const MAX = 80;               // beyond this, session summaries start to decay
/* Chars of memory LINES allowed into a prompt. The preamble build() wraps them
   in costs ~440 more, and tests/verify-memory.js has always asserted the whole
   block stays under 1600 — so the two numbers are related and were not. When
   provenance markers were added, the preamble grew and a full store came out at
   1641: over the bound, discovered by measuring rather than on the owner's
   laptop. 1100 leaves real headroom, and verify-memory-pure.js now asserts the
   worst case in bare Node so the next person to lengthen that preamble finds
   out in CI. */
const BUDGET = 1100;

const KINDS = ['fact', 'gap', 'preference', 'session'];
/* Which mechanism wrote it. Known for certain at each call site, so this is
   recorded rather than inferred — unlike `said`, which is a claim. */
const SOURCES = ['tool', 'summary'];
const HEADING = {
  fact:       'About them',
  gap:        'Where they keep going wrong',
  preference: 'How they want to be taught',
  session:    'From previous sessions',
};

let MEM = load();
/* Date.now() is not a tiebreak: a tool call and a session summary written in
   the same millisecond would sort arbitrarily, and "newest first" has to mean
   something both in the panel and in the prompt. seq breaks the tie in insert
   order and survives a reload by starting above whatever was loaded. */
let seq = MEM.reduce((n, m) => Math.max(n, m.seq || 0), 0);

function load() {
  const raw = (typeof loadJSON === 'function') ? loadJSON(MEM_KEY, []) : [];
  return Array.isArray(raw) ? raw.filter(m => m && typeof m.text === 'string') : [];
}
function order(a, b) {
  return (b.seq || 0) - (a.seq || 0) || (b.created || 0) - (a.created || 0);
}
function persist() {
  if (typeof saveJSON === 'function') saveJSON(MEM_KEY, MEM);
}

/* Compared for duplicates, not displayed: case, punctuation and spacing all
   differ between two models saying the same thing on two different days. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function newId() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/* Oldest session summaries go first, then oldest anything. Returns the number
   dropped, so a caller can say so if it wants to. */
function prune() {
  if (MEM.length <= MAX) return 0;
  const over = MEM.length - MAX;
  const ranked = MEM.slice().sort((a, b) =>
    (a.kind === 'session' ? 0 : 1) - (b.kind === 'session' ? 0 : 1) || -order(a, b));
  const doomed = new Set(ranked.slice(0, over).map(m => m.id));
  MEM = MEM.filter(m => !doomed.has(m.id));
  return over;
}

/* WHERE A MEMORY CAME FROM, and whether the fellow actually said it.

   Both writers here are the model: the `remember` tool, and the summariser
   that writes one line per finished quiz. Nothing recorded which, and nothing
   recorded the difference that matters more — between

     "Sitting the boards in October."        the fellow said this
     "Keeps reading constrictive as restrictive."   Apex concluded this

   Stored identically, build() rendered them identically, and the model read
   both back as established fact. An inference presented as something they told
   you is how a tutor ends up confidently teaching around a weakness the fellow
   never had.

   `src` is MECHANICALLY KNOWN at the call site and is never guessed: 'tool' or
   'summary'. `said` is the model's claim that these were the fellow's own
   words, and it DEFAULTS TO FALSE — an unmarked memory is treated as Apex's
   conclusion, because the safe default for "did they really say that?" is no.

   Old records carry neither. They are left alone rather than backfilled, the
   same rule logReview follows for `ef`: a record written before the field
   existed is honestly empty, and inventing a provenance for it would be the
   only thing here worse than not having one. */
function add(text, kind, meta) {
  const t = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const k = KINDS.indexOf(kind) > -1 ? kind : 'fact';
  const m = meta || {};
  const src = SOURCES.indexOf(m.src) > -1 ? m.src : 'tool';
  const said = m.said === true;
  const key = norm(t);
  const dupe = MEM.find(mm => norm(mm.text) === key);
  if (dupe) {
    /* Saying it twice is not two memories — but the fellow confirming
       something Apex had merely inferred IS new information, and it only ever
       moves one way. Inference never overwrites a statement. */
    if (said && !dupe.said) { dupe.said = true; persist(); }
    return dupe;
  }
  const rec = { id: newId(), text: t, kind: k, src, said, created: Date.now(), seq: ++seq };
  MEM.push(rec);
  prune();
  persist();
  return rec;
}

function remove(id) {
  const before = MEM.length;
  MEM = MEM.filter(m => m.id !== id);
  if (MEM.length === before) return false;
  persist();
  return true;
}

function clear() { MEM = []; persist(); }
function all() { return MEM.slice().sort(order); }
function count() { return MEM.length; }

/* Replaces the whole store — used by the backup import, which must be able to
   restore an empty store as readily as a full one. */
function replaceAll(list) {
  MEM = Array.isArray(list) ? list.filter(m => m && typeof m.text === 'string') : [];
  seq = MEM.reduce((n, m) => Math.max(n, m.seq || 0), 0);
  prune();
  persist();
}

/* The block handed to the model. Empty store means empty string, same rule
   Profile follows: a fresh install must not be told, at length, that it knows
   nothing about someone. */
function build() {
  if (!MEM.length) return '';
  const newest = all();
  const lines = [];
  let used = 0;
  for (const kind of KINDS) {
    const group = newest.filter(m => m.kind === kind);
    if (!group.length) continue;
    const head = `${HEADING[kind]}:`;
    const rows = [];
    for (const m of group) {
      /* The marker is the whole point of recording provenance: a memory the
         fellow stated and one Apex concluded must not read the same to the
         model. Absent is "they said it" — the unmarked case is the strongest
         one, so the tags carry the doubt rather than the confidence. */
      /* Short, because it repeats on every line and every character comes out
         of BUDGET — a forty-character explanation on each of twenty memories
         would spend a third of the block restating the same caveat. It is
         explained once in the header instead. */
      const tag = m.said === true ? ''
                : m.src === undefined ? ' (unrecorded)'
                : ' (inferred)';
      const line = `  • [${m.id}]${tag} ${m.text}`;
      if (used + line.length > BUDGET) break;
      used += line.length;
      rows.push(line);
    }
    if (rows.length) lines.push(head + '\n' + rows.join('\n'));
    if (used >= BUDGET) break;
  }
  if (!lines.length) return '';
  return '\n\nWHAT YOU ALREADY KNOW ABOUT THIS FELLOW (kept from earlier sessions — ' +
    'teach in a way that fits it, and do not recite it back to them). If something ' +
    'here has stopped being true, call the forget tool with the id in brackets. ' +
    'Unmarked means they told you. (inferred) means you concluded it — check it ' +
    'rather than assert it, and if they confirm it call remember again with said ' +
    'true. (unrecorded) predates the distinction and could be either:\n' +
    lines.join('\n');
}

root.Memory = { add, remove, clear, all, count, build, prune, replaceAll,
                MEM_KEY, MAX, KINDS };

})(typeof window !== 'undefined' ? window : this);
