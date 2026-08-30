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
const BUDGET = 1200;          // chars of memory allowed into a prompt

const KINDS = ['fact', 'gap', 'preference', 'session'];
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

function add(text, kind) {
  const t = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const k = KINDS.indexOf(kind) > -1 ? kind : 'fact';
  const key = norm(t);
  const dupe = MEM.find(m => norm(m.text) === key);
  if (dupe) return dupe;                       // saying it twice is not two memories
  const rec = { id: newId(), text: t, kind: k, created: Date.now(), seq: ++seq };
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
      const line = `  • [${m.id}] ${m.text}`;
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
    'here has stopped being true, call the forget tool with the id in brackets:\n' +
    lines.join('\n');
}

root.Memory = { add, remove, clear, all, count, build, prune, replaceAll,
                MEM_KEY, MAX, KINDS };

})(typeof window !== 'undefined' ? window : this);
