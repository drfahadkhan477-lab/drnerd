/* ═════════════════════════════════════════════
   confusable.js — look-alikes asked side by side, and chapters taken in turn (docs/ROADMAP.md, S6).

   A topic run (src/core/topicrun.js) asks several questions on one thing back to back: blocked practice,
   which helps a first understanding. Telling two similar diagnoses apart is learned the other way, by
   meeting them mixed, each next to the thing it is mistaken for. This file does that from what Apex has
   already written down: its `gap` memories (src/core/memory.js), "a confusion worth pressing on", such as

     "Keeps reading constrictive pericarditis as restrictive cardiomyopathy."

     sides(text)                 the two things a gap names, as two lists of terms, or null where it does
                                 not name two
     sets(memories, pool)        for each gap that names two things the bank has questions on: the memory's
                                 id and text, the questions on each side (a, b), and those on both
     partners(deck, sets, pool, o)
                                 for each question in the deck on one side of a set, a question on the other
                                 side that the deck does not hold, up to o.max of them
     arrange(deck, o)            the deck in an order where no two questions in a row share a chapter while
                                 another chapter has questions left, with each partner straight after the
                                 question it was found for

       memories   Memory.all(): [{ id, kind, text }]; only kind 'gap' is read
       pool       the questions a session may draw from: [{ id, ch, s, o, ci, bad }]
       deck       questions, in the order the caller dealt them

   HOW A GAP IS READ. The text is split once, at the first word that stands between two things in the way
   people write a confusion: "X as Y", "X vs Y", "X versus Y", "X against Y", "X for Y", "X with Y", "between
   X and Y", "X and Y". Each side keeps its distinctive words (topicrun.js's stoplist, and the verbs a
   confusion is written with: keeps, reading, confuses, mixes …). A question is on a side when its stem or
   keyed option holds every word of that side, each matched on its first seven letters, so "constriction"
   finds "constrictive", and an abbreviation in capitals matched as written. A gap that does not split, or whose sides share every word, names no pair and is
   left out: a guess at what it meant would deal questions on the strength of a misreading.

   WHAT IS NEVER DONE. A due card is never dropped or moved out of the deck (reviewqueue.js, rule 1);
   partners are added, at most o.max, and never a question marked bad or one already in the deck. Nothing
   given is changed. Every choice is in the order things were given, so the same input deals the same deck.

   Pure: no DOM, no clock, no storage, no randomness. The bank's text is read on the device and never leaves
   it. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const arr = v => Array.isArray(v) ? v : [];

/* topicrun.js's stoplist, and the words a confusion is written with, which say nothing about either side. */
const STOP = new Set(('the a an and or of to in on for with without from by at as is are was were be been being this that these those which who whom what when where why how ' +
  'most likely next best following patient patients year old man woman male female presents presented history shows show noted finding findings ' +
  'does did do not no yes all any each both other another above below after before during than then also into over under about more less ' +
  'would should could may might can will has have had option answer correct incorrect ' +
  'keeps keep kept reading reads read confuses confused confusing confusion mixes mixing mixed swaps swapping swapped mistakes mistaking mistaken ' +
  'calls calling thinks thinking treats treating picks picking chooses choosing still often always again tends gets getting lumps lumping ' +
  'telling tell apart distinguishing distinguish difference between versus against same thing things').split(/\s+/));

/* The words that stand between the two things, tried in this order; the first found splits the text. "between X
   and Y" is read before " and ", so the "between" is not left on the first side. "as" is matched in lower case only:
   "AS" is aortic stenosis. */
const SPLITS = [/\bbetween\b(.+?)\band\b(.+)/i, /(.+?)\b(?:vs\.?|versus)\s(.+)/i, /(.+?)\bagainst\b(.+)/i,
  /(.+?)\bas\b(.+)/, /(.+?)\bwith\b(.+)/i, /(.+?)\bfor\b(.+)/i, /(.+?)\band\b(.+)/i, /(.+?)\s\/\s(.+)/];

/* A word is kept as its first seven letters in lower case, a plural's last s dropped first; an abbreviation written in capitals (AS, HCM, LVH, MI) is
   kept as written, and matched only where a question writes it in capitals too, so "AS" never finds the word "as". */
const STEM = 7;
const ABBR = /^[A-Z][A-Z0-9]{1,5}$/;
function keyOf(tok) {
  if (ABBR.test(tok)) return tok;
  const w = tok.toLowerCase().replace(/(.{3}[^siu])s$/, '$1');   // murmurs, murmur; not pulsus, stenosis, aortitis
  return w.length > 3 && !/^\d+$/.test(w) ? w.slice(0, STEM) : null;
}
function words(text) {
  const out = [];
  for (const tok of String(text || '').split(/[^A-Za-z0-9]+/)) {
    if (!tok || (!ABBR.test(tok) && STOP.has(tok.toLowerCase()))) continue;
    const k = keyOf(tok);
    if (k && out.indexOf(k) < 0) out.push(k);
  }
  return out;
}

function sides(text) {
  const t = String(text == null ? '' : text);
  for (const re of SPLITS) {
    const m = t.match(re);
    if (!m) continue;
    const a = words(m[1]), b = words(m[2]);
    if (!a.length || !b.length) continue;
    /* A side whose every word the other side also has would find every question the other finds: one thing said
       twice ("between type 1 and type 2 MI" reads as "type" against "type MI"), not two things. */
    if (a.every(w => b.indexOf(w) > -1) || b.every(w => a.indexOf(w) > -1)) return null;
    return { a, b };
  }
  return null;
}

/* The stems a question is read from: its stem and its keyed option, as topicrun.js reads it. */
function stems(q) {
  const keyed = arr(q.o)[Number.isInteger(q.ci) ? q.ci : -1];
  const out = new Set();
  for (const tok of (String(q.s || '') + ' ' + String(keyed && keyed.t || '')).split(/[^A-Za-z0-9]+/)) {
    const k = tok && keyOf(tok);
    if (k) out.add(k);
  }
  return out;
}
const holds = (st, side) => side.every(w => st.has(w));

function usable(pool) {
  const seen = new Set();
  return arr(pool).filter(q => q && typeof q.id === 'string' && !q.bad && !seen.has(q.id) && seen.add(q.id));
}

function sets(memories, pool) {
  const gaps = [];
  for (const m of arr(memories)) {
    if (!m || m.kind !== 'gap' || typeof m.text !== 'string') continue;
    const sd = sides(m.text);
    if (sd) gaps.push({ m, sd });
  }
  /* The bank is read only where some gap names two things: most reviews have none to look for. */
  if (!gaps.length) return [];
  const qs = usable(pool).map(q => ({ id: q.id, st: stems(q) }));
  const out = [];
  for (const { m, sd } of gaps) {
    const a = [], b = [], both = [];
    for (const q of qs) {
      const inA = holds(q.st, sd.a), inB = holds(q.st, sd.b);
      if (inA && inB) both.push(q.id); else if (inA) a.push(q.id); else if (inB) b.push(q.id);
    }
    if (a.length && b.length) out.push({ id: m.id, text: m.text, terms: sd, a, b, both });
  }
  return out;
}

/* partners(deck, sets, pool, { max, prefer })
   → [{ after: id in the deck, id: the partner's id, set: the memory's id }]
   For each question of the deck in order, the first set it is on a side of whose other side the deck holds nothing,
   and that still has a question there no partner has taken. prefer(id) → a number, lower first, chooses among the other
   side's questions (a card already seen before one never met, say); ties go to the bank's order. */
function partners(deck, setList, pool, o) {
  const opt = o || {};
  const max = Number.isInteger(opt.max) && opt.max > 0 ? opt.max : 0;
  const rank = typeof opt.prefer === 'function' ? opt.prefer : () => 0;
  const ok = new Map(usable(pool).map((q, i) => [q.id, i]));
  const inDeck = new Set(arr(deck).map(q => q && q.id));
  const held = new Set(inDeck);
  const out = [];
  if (!max) return out;
  for (const q of arr(deck)) {
    if (out.length >= max) break;
    if (!q || typeof q.id !== 'string') continue;
    for (const s of arr(setList)) {
      const other = s.a.indexOf(q.id) > -1 ? s.b : s.b.indexOf(q.id) > -1 ? s.a : null;
      /* A deck that already holds the other side meets the pair without help. */
      if (!other || other.some(id => inDeck.has(id))) continue;
      const pick = other.filter(id => ok.has(id) && !held.has(id))
        .sort((x, y) => (rank(x) - rank(y)) || (ok.get(x) - ok.get(y)))[0];
      if (pick === undefined) continue;
      held.add(pick);
      out.push({ after: q.id, id: pick, set: s.id });
      break;
    }
  }
  return out;
}

/* arrange(deck, { partners: [{ after, id }], byId: { id → question } })
   The deck's questions, and each partner straight after the question it was found for, as one unit of two. Units
   are then taken one at a time: the first unit, in the order given, whose first question's chapter is not the
   chapter of the question asked just before it, from the chapter with the most units left; where every unit left
   is in that chapter, the first of them. */
function arrange(deck, o) {
  const opt = o || {};
  const byId = opt.byId || {};
  const list = arr(deck).filter(q => q && typeof q.id === 'string');
  const after = new Map();
  for (const p of arr(opt.partners)) if (p && byId[p.id] && !after.has(p.after)) after.set(p.after, byId[p.id]);
  const units = list.map(q => after.has(q.id) ? [q, after.get(q.id)] : [q]);
  const left = new Map();
  for (const u of units) left.set(u[0].ch, (left.get(u[0].ch) || 0) + 1);
  const out = [];
  const used = new Uint8Array(units.length);
  for (let n = 0; n < units.length; n++) {
    const last = out.length ? out[out.length - 1].ch : undefined;
    let best = -1;
    for (let i = 0; i < units.length; i++) {
      if (used[i] || units[i][0].ch === last) continue;
      if (best < 0 || left.get(units[i][0].ch) > left.get(units[best][0].ch)) best = i;
    }
    if (best < 0) for (let i = 0; i < units.length; i++) if (!used[i]) { best = i; break; }
    used[best] = 1;
    left.set(units[best][0].ch, left.get(units[best][0].ch) - 1);
    for (const q of units[best]) out.push(q);
  }
  return out;
}

root.Confusable = { sides, sets, partners, arrange, words };

})(typeof window !== 'undefined' ? window : this);
