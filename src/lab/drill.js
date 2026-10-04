/* ═════════════════════════════════════════════
   drill.js — endless practice with spaced repetition, for anything with an id.

   Heart sounds, pressure tracings and (later) ECG strips are all the same
   exercise: here is one, which is it? This is the engine behind that, kept apart
   from what is being drilled so the same rules serve every Lab screen:

     next(...)     which item to show: what is due, the most forgotten first;
                   then what you have never seen; then, so it never runs dry,
                   the weakest thing you do know. Never the one you just had.
     options(...)  the answer and its distractors, with the look-alikes first:
                   constriction is offered against tamponade, not against a normal trace.
     grade(...)    the next spaced-repetition card, from the app's own scheduler.

   The look-alikes matter more than the count. A drill whose wrong answers are
   obviously wrong teaches nothing; the skill being practised IS telling the
   near-miss apart, so each item says what it is confused with.

   Cards are the app's own (src/core/fsrs.js), so a Lab card and a question card
   age the same way. Pure: the random choices come from a seed.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const FSRS = root.FSRS || (typeof require === 'function' ? require('../core/fsrs.js').FSRS : null);

const obj = v => (v && typeof v === 'object') ? v : {};
const arr = v => Array.isArray(v) ? v : [];

function rng32(seed) {
  let a = (Number.isFinite(seed) ? seed : 1) >>> 0 || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/* How well a card is remembered today, in [0, 1]; a card with no usable date counts as forgotten. */
function recall(card, today) {
  try {
    const c = obj(card);
    if (typeof c.last !== 'string' || !FSRS.isoToLocalDate(c.last)) return 0;
    const r = FSRS.retrievability(c.stability, FSRS.daysBetween(c.last, today));
    return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
  } catch (_) { return 0; }
}

/* next({ items, cards, today, seed, recent }) → { item, reason } | null */
function next(o) {
  o = obj(o);
  const items = arr(o.items).filter(i => i && typeof i.id === 'string');
  if (!items.length) return null;
  const cards = obj(o.cards);
  const today = typeof o.today === 'string' ? o.today : FSRS.todayISO();
  const rand = rng32(o.seed);
  const recent = new Set(arr(o.recent).slice(-3));
  /* never the one just shown, unless it is all there is */
  const pool = items.length > 1 ? items.filter(i => !recent.has(i.id)) : items;
  const usable = pool.length ? pool : items.filter(i => i.id !== arr(o.recent).slice(-1)[0]).concat(items).slice(0, 1);

  const due = usable.filter(i => cards[i.id] && typeof cards[i.id].due === 'string' && cards[i.id].due <= today)
    .map(i => ({ i, r: recall(cards[i.id], today) }))
    .sort((a, b) => a.r - b.r || (a.i.id < b.i.id ? -1 : 1));
  if (due.length) return { item: due[0].i, reason: 'due' };

  const fresh = usable.filter(i => !cards[i.id]);
  if (fresh.length) return { item: shuffle(fresh, rand)[0], reason: 'new' };

  /* nothing due and nothing new: the one you are closest to forgetting */
  const weakest = usable.map(i => ({ i, r: recall(cards[i.id], today) })).sort((a, b) => a.r - b.r || (a.i.id < b.i.id ? -1 : 1));
  return { item: weakest[0].i, reason: 'review-ahead' };
}

/* options({ item, items, n, seed }) → [item ids], the answer among them once, in a seeded order.
   Distractors: what this item is confused with, then the others from the same site, then any. */
function options(o) {
  o = obj(o);
  const item = obj(o.item);
  const items = arr(o.items).filter(i => i && typeof i.id === 'string');
  const n = Math.max(2, Math.min(8, Number.isInteger(o.n) ? o.n : 4));
  if (typeof item.id !== 'string') return [];
  const rand = rng32(o.seed);
  const chosen = [item.id];
  const add = id => { if (chosen.length < n && id !== item.id && !chosen.includes(id) && items.some(i => i.id === id)) chosen.push(id); };
  arr(item.confusableWith).forEach(add);
  shuffle(items.filter(i => i.site && i.site === item.site).map(i => i.id), rand).forEach(add);
  shuffle(items.map(i => i.id), rand).forEach(add);
  return shuffle(chosen, rand);
}

/* grade({ card, correct, today }) → the next card: "good" if right, "again" if wrong. */
function grade(o) {
  o = obj(o);
  const today = typeof o.today === 'string' ? o.today : FSRS.todayISO();
  return FSRS.update(o.card || null, o.correct ? 3 : 1, today);
}

root.Drill = { next, options, grade, recall };

})(typeof window !== 'undefined' ? window : this);
