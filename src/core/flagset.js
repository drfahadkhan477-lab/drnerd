/* ═════════════════════════════════════════════
   flagset.js — the questions you flagged to come back to, and the questions you wrote on.

   The quiz tells you the answer and moves on. Sooner or later a fellow meets a question they want
   to see again that is neither wrong nor due: right by luck, or right for a reason they do not
   trust. The missed list cannot hold it and the schedule cannot be told. A flag is how they say
   so, and it stays until they take it off.

   And the pencil. A sticky note or a mark on a question is saved with it, but nothing listed
   them: to find the question with the note about sotalol you had to remember which question it
   was on. This holds the rules for both as plain data, so the screens only draw them:

     clean(raw) / valid(raw)             a saved list read back, and whether a backup's list is sound
     toggle(set, id) / addAll(set, ids)  flag or unflag one question; flag several, saying how many were new
     deck(set, byId)                     the flagged questions the bank still has, in the order flagged
     annotated(notes, ink, byId)         every question with a sticky note or a mark, newest note first
     find(rows, query)                   the rows whose note, chapter or stem hold every word typed
     highlight(text, query, esc)         the text with the words typed marked, escaped piece by piece
     phrase(n) / said(on, n)             what the card and the screen reader say

   THE RULES, because each is a way a flag quietly stops meaning anything:

     1. A flag is a question id and nothing else. It is not tied to a mode, a block or a day, so
        a flag set in a mock block, in a chapter, in a search's hits or on the review of a
        block is the same flag.
     2. A flag only ever goes on or off because the fellow said so (toggle) or because they
        flagged it inside a mock block (addAll, which never removes). Answering right does not
        clear it, as it clears the missed list: "right but unsure" is exactly what a flag holds.
     3. What is read from storage is untrusted. clean() keeps ids and drops everything else, once
        each; valid() says whether a backup's list is nothing but ids, so an import is refused
        whole by name, never half-used.
     4. A flag on a question the bank no longer has is kept (a reseed can bring it back) and is
        not counted, not dealt and not listed: deck() only ever returns questions that exist and
        are not quarantined. Ids are looked up as own properties, so a list naming "constructor"
        or "__proto__" finds nothing instead of a function.
     5. A question is annotated if it has a sticky note (even an empty one) or a stroke of ink,
        the same test as the badge on the quiz screen. The list never shows a question the bank
        does not have, and never a note's text as markup.

   No DOM, no clock, no storage: bare Node can test it. ES2015, and one thing past it: words() and
   highlight() use the `u` flag with \p{L} (ES2018, Safari 11.1). Safari 13.4 is the floor (README);
   tests/verify-ipad-pure.js scans for what it lacks.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const MAX_FLAGS = 5000;      // a bank is hundreds of questions; this only bounds what a hand-edited file may hold
const MAX_ID = 120;          // the longest id a bank may give a question (bankpack.js SAFE_ID); a longer string is not one

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const isId = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const count = v => (Number.isInteger(v) && v >= 0) ? v : 0;

/* A list read back from storage: ids, each once, in the order they were saved. Anything else in it,
   or a list that is not a list, is gone. */
function clean(raw) {
  const out = [], seen = new Set();
  if (!Array.isArray(raw)) return out;
  for (const id of raw) {
    if (!isId(id) || seen.has(id)) continue;
    seen.add(id); out.push(id);
    if (out.length >= MAX_FLAGS) break;
  }
  return out;
}

/* A backup's list is sound if it is absent or nothing but ids and not absurdly long. A list with the
   same id twice is sound (clean() makes it a set); one with a number in it is not. */
function valid(raw) {
  return raw == null || (Array.isArray(raw) && raw.length <= MAX_FLAGS && raw.every(isId));
}

/* Flag the question, or take the flag off it. Returns whether it is flagged now. */
function toggle(set, id) {
  if (!isId(id)) return set.has(id);
  if (set.has(id)) { set.delete(id); return false; }
  set.add(id); return true;
}

/* Flag several; never unflag. Returns how many were not flagged before. */
function addAll(set, ids) {
  let added = 0;
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!isId(id) || set.has(id)) continue;
    set.add(id); added++;
  }
  return added;
}

/* The flagged questions the bank has, as the bank holds them, oldest flag first. */
function deck(set, byId) {
  const out = [], b = obj(byId);
  set.forEach(id => { if (has(b, id) && b[id] && !b[id].bad) out.push(b[id]); });
  return out;
}

/* When a sticky note was made: its id is 'n' and the time in base 36 (addSticky). An id in any
   other shape has no time, and a note without one sorts after the notes that have. */
function stamp(id) {
  if (typeof id !== 'string' || !/^n[0-9a-z]{1,10}$/.test(id)) return 0;
  const t = parseInt(id.slice(1), 36);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/* The questions with a sticky note or a mark, newest note first, then by chapter and number. A row:
     { id, q, notes (how many stickies), text (what they say, one line), ink (any mark), at (when the newest was made),
       hay (lower-case: text, chapter, stem — what find() looks in) }
   notes is { questionId: [ { id, text, … } ] } and ink is { 'questionId:slot': [stroke, …] }, as the app keeps them. */
function annotated(notes, ink, byId) {
  const b = obj(byId), n = obj(notes), k = obj(ink), rows = new Map();
  const there = id => has(b, id) && b[id] && !b[id].bad;
  const row = id => {
    if (!rows.has(id)) rows.set(id, { id: id, q: b[id], notes: 0, parts: [], ink: false, at: 0 });
    return rows.get(id);
  };
  for (const id of Object.keys(n)) {
    if (!there(id) || !Array.isArray(n[id]) || !n[id].length) continue;
    const r = row(id);
    for (const s of n[id]) {
      r.notes++;
      const t = s && typeof s.text === 'string' ? s.text.replace(/\s+/g, ' ').trim() : '';
      if (t) r.parts.push(t);
      const at = s ? stamp(s.id) : 0;
      if (at > r.at) r.at = at;
    }
  }
  /* A slot never holds a colon ('q', 'e', 'f0'), so the question is everything before the last one. */
  for (const key of Object.keys(k)) {
    const c = key.lastIndexOf(':');
    if (c < 1 || !k[key] || !k[key].length) continue;
    const id = key.slice(0, c);
    if (there(id)) row(id).ink = true;
  }
  const out = [];
  rows.forEach(r => {
    const text = r.parts.join(' · ');
    out.push({ id: r.id, q: r.q, notes: r.notes, text: text, ink: r.ink, at: r.at,
      hay: (text + ' ' + String(r.q.ch || '') + ' ' + String(r.q.s || '')).toLowerCase() });
  });
  out.sort((a, c) => (c.at - a.at) || String(a.q.ch || '').localeCompare(String(c.q.ch || '')) || ((a.q.n || 0) - (c.q.n || 0)) || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
  return out;
}

/* The words of what was typed: letters and digits of any alphabet, lower-cased. */
function words(query) {
  return String(query == null ? '' : query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/* Rows that hold every word typed, anywhere in the word, in the order given. Nothing typed is every row. */
function find(rows, query) {
  const w = words(query), list = Array.isArray(rows) ? rows : [];
  if (!w.length) return list.slice();
  return list.filter(r => r && typeof r.hay === 'string' && w.every(x => r.hay.indexOf(x) >= 0));
}

/* The text with every word typed marked where it is found, escaped a piece at a time. The app's own hl() escapes first
   and then matches, so a note holding "&" or a quote had the "amp" of "&amp;" marked and the entity broken. A match is any
   stretch of the text that spells a word typed, in any case; where two words start together the longer one wins. esc turns
   text into text that is safe to put in a page; the <mark> tags are the only markup made here. */
function highlight(text, query, esc) {
  const t = String(text == null ? '' : text), w = words(query);
  if (!w.length) return esc(t);
  /* words() leaves letters and digits only, so a word is safe in a pattern as it is. Split on a pattern with a group, the
     text comes back as piece, match, piece, match, ..., piece: the odd ones are the words found. */
  const parts = t.split(new RegExp('(' + w.slice().sort((a, b) => b.length - a.length).join('|') + ')', 'iu'));
  let out = '';
  parts.forEach((p, i) => { out += i % 2 ? '<mark>' + esc(p) + '</mark>' : esc(p); });
  return out;
}

function phrase(n) {
  n = count(n);
  return n === 0 ? 'Nothing flagged' : n === 1 ? '1 question flagged' : n + ' questions flagged';
}

/* What a screen reader is told when the flag changes: what happened, then where that leaves the list. */
function said(on, n) {
  n = count(n);
  const left = n === 0 ? 'Your Flagged list is empty.'
    : n === 1 ? '1 question is in your Flagged list.' : n + ' questions are in your Flagged list.';
  return (on ? 'Flagged. ' : 'Flag removed. ') + left;
}

root.FlagSet = { MAX_FLAGS, MAX_ID, clean, valid, toggle, addAll, deck, annotated, find, words, highlight, phrase, said };

})(typeof window !== 'undefined' ? window : this);
