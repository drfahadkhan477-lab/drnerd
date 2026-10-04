/* ═════════════════════════════════════════════
   topicrun.js — three to five questions on one topic, back to back.

   Board questions are taught as isolated facts and examined as isolated facts,
   but understanding one thing from several angles in a row is how it sticks:
   the diagnosis, then the next test, then the management. This groups questions
   that are ABOUT THE SAME THING and offers them as a run, starting from the one
   you most need.

   What this is not: an evolving patient. A case that develops (the same man,
   now in the ward, now in clinic) has to be authored; the bank has no storyline
   to recover, and pretending otherwise would invent one. A topic run says only
   what it can know: these questions share these terms.

   How: within each chapter, every question becomes a vector of its distinctive
   words (stem and keyed option; TF-IDF over that chapter, so a word that every
   question in the chapter uses counts for nothing). A run is a seed question plus
   the questions most similar to it, above a floor, never reusing a question across
   runs. Seeds are the ones that need work: missed, then due, then the rest.

   Pure: no DOM, no app globals. The text of the bank is read on the device and
   never leaves it; the output is ids and the shared words.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const obj = v => (v && typeof v === 'object') ? v : {};
const arr = v => Array.isArray(v) ? v : [];

const STOP = new Set(('the a an and or of to in on for with without from by at as is are was were be been being this that these those which who whom what when where why how ' +
  'most likely next best following patient patients year old man woman male female presents presented history shows show noted finding findings ' +
  'does did do not no yes all any each both other another following above below after before during than then also into over under about more less ' +
  'would should could may might can will has have had been which option answer correct incorrect').split(/\s+/));

function terms(q) {
  const keyed = arr(q.o)[Number.isInteger(q.ci) ? q.ci : -1];
  const text = String(q.s || '') + ' ' + String(keyed && keyed.t || '');
  const out = [];
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.push(w);
  return out;
}

/* Vectors for one chapter: tf-idf, L2-normalised, as Map(term → weight). */
function vectorise(qs) {
  const docs = qs.map(q => {
    const tf = new Map();
    for (const t of terms(q)) tf.set(t, (tf.get(t) || 0) + 1);
    return tf;
  });
  const df = new Map();
  for (const tf of docs) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = qs.length;
  return docs.map(tf => {
    const v = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const idf = Math.log((1 + n) / (1 + df.get(t))) ;
      const w = (1 + Math.log(c)) * idf;
      if (w > 0) { v.set(t, w); norm += w * w; }
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
}
const cosine = (a, b) => { let s = 0; for (const [t, w] of a) { const x = b.get(t); if (x) s += w * x; } return s; };

/* runs({ pool, missed, due, size, minSimilarity, max })
   → [{ ch, ids, seed, shared: [terms every question in the run uses] }] */
function runs(o) {
  o = obj(o);
  const pool = arr(o.pool).filter(q => q && typeof q.id === 'string' && typeof q.ch === 'string');
  const missed = new Set(o.missed instanceof Set ? [...o.missed] : arr(o.missed));
  const due = new Set(o.due instanceof Set ? [...o.due] : arr(o.due));
  const size = Math.max(2, Math.min(8, Number.isInteger(o.size) ? o.size : 4));
  const floor = Number.isFinite(o.minSimilarity) ? o.minSimilarity : 0.12;
  const max = Number.isInteger(o.max) ? o.max : Infinity;

  const byCh = new Map();
  for (const q of pool) { if (!byCh.has(q.ch)) byCh.set(q.ch, []); byCh.get(q.ch).push(q); }
  const result = [];
  for (const ch of [...byCh.keys()].sort()) {
    const qs = byCh.get(ch);
    if (qs.length < 2) continue;
    const vec = vectorise(qs);
    const taken = new Set();
    /* seeds: missed first, then due, then the rest, each in bank order */
    const rank = i => missed.has(qs[i].id) ? 0 : due.has(qs[i].id) ? 1 : 2;
    const order = qs.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
    for (const s of order) {
      if (taken.has(s) || !vec[s].size) continue;
      const near = [];
      for (let j = 0; j < qs.length; j++) {
        if (j === s || taken.has(j)) continue;
        const sim = cosine(vec[s], vec[j]);
        if (sim >= floor) near.push({ j, sim });
      }
      near.sort((a, b) => b.sim - a.sim || a.j - b.j);
      const picked = near.slice(0, size - 1);
      if (picked.length < 2) continue;         // a run of two is a pair, not a run
      const members = [s, ...picked.map(p => p.j)];
      members.forEach(m => taken.add(m));
      const shared = [...vec[s].keys()].filter(t => members.every(m => vec[m].has(t)));
      result.push({ ch, seed: qs[s].id, ids: members.map(m => qs[m].id), shared: shared.sort() });
    }
  }
  /* the runs that start from what you most need first, then the biggest topics */
  const need = r => missed.has(r.seed) ? 0 : due.has(r.seed) ? 1 : 2;
  result.sort((a, b) => need(a) - need(b) || b.ids.length - a.ids.length || (a.seed < b.seed ? -1 : 1));
  return result.slice(0, max);
}

root.TopicRun = { runs, terms, vectorise, cosine };

})(typeof window !== 'undefined' ? window : this);
