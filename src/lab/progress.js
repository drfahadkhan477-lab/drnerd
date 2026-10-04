/* ═════════════════════════════════════════════
   progress.js — what the Lab remembers about you, and nothing else.

   One small record in the browser's own storage: a spaced-repetition card per item
   you have been asked (heart sounds, tracings and strips share the engine in
   drill.js), the last few items shown, and a tally per day for the streak. It holds
   no content, only ids, so it is as safe to keep as it is to lose.

   Storage can be missing, full, blocked (a private window) or hold something that is
   not ours; the Lab must open either way, so every read is tolerant and every write
   reports whether it worked instead of throwing.

   Pure: the storage object is handed in (anything with getItem / setItem), the date
   is handed in.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const FSRS = root.FSRS || (typeof require === 'function' ? require('../core/fsrs.js').FSRS : null);
const Drill = root.Drill || (typeof require === 'function' ? require('./drill.js').Drill : null);

const KEY = 'systole-lab-v1';
const KEEP_RECENT = 12;
const KEEP_DAYS = 400;

const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !!FSRS.isoToLocalDate(s);

function empty() { return { v: 1, cards: {}, recent: [], days: {} }; }

/* A card is kept only if it is something the scheduler can use. */
function usableCard(c) {
  c = obj(c);
  return Number.isFinite(c.stability) && c.stability > 0 && typeof c.due === 'string' && typeof c.last === 'string' && isDay(c.due) && isDay(c.last);
}

/* sanitise(anything) → a state that is always well-formed; whatever cannot be used is dropped. */
function sanitise(raw) {
  const r = obj(raw), out = empty();
  const cards = obj(r.cards);
  for (const id of Object.keys(cards)) if (usableCard(cards[id])) out.cards[id] = cards[id];
  if (Array.isArray(r.recent)) out.recent = r.recent.filter(x => typeof x === 'string').slice(-KEEP_RECENT);
  const days = obj(r.days);
  for (const d of Object.keys(days)) {
    const e = obj(days[d]);
    if (isDay(d) && Number.isInteger(e.n) && Number.isInteger(e.c) && e.n > 0 && e.c >= 0 && e.c <= e.n) out.days[d] = { n: e.n, c: e.c };
  }
  return out;
}

function load(storage) {
  try {
    const raw = storage && storage.getItem(KEY);
    if (!raw) return empty();
    return sanitise(JSON.parse(raw));
  } catch (_) { return empty(); }
}

/* save(storage, state) → true if it was kept. */
function save(storage, state) {
  try { storage.setItem(KEY, JSON.stringify(sanitise(state))); return true; } catch (_) { return false; }
}

/* record(state, { id, correct, today }) → a new state; the old one is left alone. */
function record(state, o) {
  o = obj(o);
  const s = sanitise(state);
  if (typeof o.id !== 'string' || !o.id) return s;
  const today = isDay(o.today) ? o.today : FSRS.todayISO();
  s.cards[o.id] = Drill.grade({ card: s.cards[o.id] || null, correct: !!o.correct, today });
  s.recent = s.recent.concat(o.id).slice(-KEEP_RECENT);
  const d = s.days[today] || { n: 0, c: 0 };
  s.days[today] = { n: d.n + 1, c: d.c + (o.correct ? 1 : 0) };
  const keep = Object.keys(s.days).sort().slice(-KEEP_DAYS);
  Object.keys(s.days).forEach(k => { if (!keep.includes(k)) delete s.days[k]; });
  return s;
}

/* Consecutive days with at least one answer, ending today or, if nothing yet today, yesterday:
   a streak is not lost by opening the app in the morning. */
function streak(state, today) {
  const days = sanitise(state).days;
  let day = isDay(today) ? today : FSRS.todayISO();
  const step = d => { const t = FSRS.isoToLocalDate(d); t.setDate(t.getDate() - 1); return FSRS.localDateToISO(t); };
  if (!days[day]) day = step(day);
  let n = 0;
  while (days[day]) { n++; day = step(day); }
  return n;
}

/* summary(state, items, today) → what the home screen shows. */
function summary(state, items, today) {
  const s = sanitise(state);
  today = isDay(today) ? today : FSRS.todayISO();
  const list = Array.isArray(items) ? items.filter(i => i && typeof i.id === 'string') : [];
  const seen = list.filter(i => s.cards[i.id]).length;
  const due = list.filter(i => s.cards[i.id] && s.cards[i.id].due <= today).length;
  let n = 0, c = 0;
  for (const d of Object.values(s.days)) { n += d.n; c += d.c; }
  const t = s.days[today] || { n: 0, c: 0 };
  return { total: list.length, seen, unseen: list.length - seen, due, answered: n, accuracy: n ? c / n : null, today: t.n, streak: streak(s, today) };
}

root.LabProgress = { KEY, empty, sanitise, load, save, record, streak, summary };

})(typeof window !== 'undefined' ? window : this);
