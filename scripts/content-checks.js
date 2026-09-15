'use strict';
/*
 * Structural defects in the question bank, as pure functions over a parsed bank.
 *
 * Required by tests/verify-content.js, which applies them to the real bank as a
 * gate, and by tests/verify-contentrules.js, which proves each rule fires and
 * each stays quiet — against synthetic banks, in bare Node, with no build.
 *
 * ── WHAT THIS GATES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────
 *
 * The audit that asked for this (§34) listed three kinds of question QA, and
 * conflating them is how the useful part never gets built:
 *
 *   structural   an answer index past the end of the options; two questions
 *                sharing an id; a question that declares three figures and
 *                carries one. Machine-decidable, and this is that.
 *   educational  an ambiguous stem, an explanation that contradicts its own
 *                key, a superseded recommendation. No tool decides these. A
 *                cardiologist reads them.
 *   statistical  difficulty and discrimination, from months of real answers.
 *
 * ── THE RULE IS NOT "NO DEFECTS" ─────────────────────────────────────────
 *
 * The bank is a licensed export. A defect in it cannot be fixed by editing
 * this repository, so a gate demanding a clean bank would block every build on
 * something nobody can repair — and would be switched off within a week.
 *
 * flags-patch.js already settled this: COR_89's answer panels are simply not in
 * the source PDF, so the question carries a `flag` that the app SHOWS to the
 * fellow. The defect is disclosed rather than hidden. So the rule here is the
 * same one, generalised: a structural defect must be disclosed. Any question
 * that is broken AND carries neither `bad` nor `flag` fails the build, and the
 * remedy is to add it to FLAGS — which puts a notice in front of the fellow
 * instead of leaving them to wonder why an item made no sense at 1am.
 *
 * That is also why this exists at all: COR_89 and COR_85 were each found by
 * hand, one at a time, and nothing would have caught a third.
 */

/* ── which field holds the stem ───────────────────────────────────────────
   Inferred, not assumed. The stem lives in ACCSAP's own export and its key is
   not written down anywhere in this repository — tools/figure-audit.js guesses
   `q.q || q.stem || q.text`, and if all three were wrong it would scan empty
   strings and report a clean bank, which is the most dangerous output a
   checker can produce: an answer that looks like evidence and is silence.

   So: take the key whose values are long strings on most questions, excluding
   the ones already known to be something else. Returns null when there is no
   such field, and every caller is expected to treat null as "I could not read
   the questions" rather than as "the questions are fine". */
const NOT_STEM = new Set(['id', 'ch', 'ex', 'com', 'bad', 'flag', 'figs']);

function stemKey(bank) {
  if (!Array.isArray(bank) || !bank.length) return null;
  const sample = bank.slice(0, 200);
  const score = new Map();
  for (const q of sample) {
    if (!q || typeof q !== 'object') continue;
    for (const [k, v] of Object.entries(q)) {
      if (NOT_STEM.has(k) || typeof v !== 'string' || v.length < 40) continue;
      score.set(k, (score.get(k) || 0) + 1);
    }
  }
  let best = null, bestN = 0;
  for (const [k, n] of score) if (n > bestN) { best = k; bestN = n; }
  /* A field that only shows up on a handful of questions is not the stem. */
  return bestN >= sample.length * 0.5 ? best : null;
}

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/* ── the rules ───────────────────────────────────────────────────────────── */
/* Each returns findings, never throws, and never reads a field it has not
   established exists — a bank from a future export may legitimately lack one,
   and "this field is absent" is a different finding from "this field is wrong". */
function check(bank) {
  const out = [];
  if (!Array.isArray(bank)) return [{ id: '(bank)', rule: 'BANK', detail: 'not an array' }];
  const add = (q, rule, detail) => out.push({ id: (q && q.id) || '(no id)', ch: q && q.ch, rule, detail });

  const stem = stemKey(bank);
  const seenId = new Map();
  const seenStem = new Map();
  /* id prefixes map to chapters — VAL_48, COR_89, HEA_3. Built from the bank
     rather than hardcoded, then used to spot the odd one out. */
  const prefixCh = new Map();
  for (const q of bank) {
    if (!q || !q.id) continue;
    const p = String(q.id).split('_')[0];
    if (!p || !q.ch) continue;
    if (!prefixCh.has(p)) prefixCh.set(p, new Map());
    const m = prefixCh.get(p);
    m.set(q.ch, (m.get(q.ch) || 0) + 1);
  }
  const majority = new Map();
  for (const [p, m] of prefixCh) {
    let top = null, n = 0;
    for (const [ch, c] of m) if (c > n) { top = ch; n = c; }
    majority.set(p, top);
  }

  for (const q of bank) {
    if (!q || typeof q !== 'object') { out.push({ id: '(entry)', rule: 'SHAPE', detail: 'not an object' }); continue; }

    if (!q.id) add(q, 'ID', 'has no id');
    else if (seenId.has(q.id)) add(q, 'DUPLICATE_ID', `shares an id with another question`);
    else seenId.set(q.id, q);

    if (!Array.isArray(q.o)) add(q, 'OPTIONS', 'has no options array');
    else if (q.o.length < 2) add(q, 'OPTIONS', `has ${q.o.length} option(s)`);
    else if (q.o.some(o => !String(o == null ? '' : o).trim())) add(q, 'OPTIONS', 'has a blank option');

    if (!Number.isInteger(q.ci)) add(q, 'ANSWER', `answer index is ${JSON.stringify(q.ci)}, not an integer`);
    else if (Array.isArray(q.o) && (q.ci < 0 || q.ci >= q.o.length))
      add(q, 'ANSWER', `answer index ${q.ci} is outside ${q.o.length} option(s)`);

    if (!q.ch) add(q, 'CHAPTER', 'has no chapter');
    else if (q.id) {
      const p = String(q.id).split('_')[0];
      const want = majority.get(p);
      if (want && want !== q.ch) add(q, 'CHAPTER', `id prefix "${p}" is "${want}" elsewhere, this one says "${q.ch}"`);
    }

    /* figs is the split build's filename array and is absent in the single
       file, so this compares the two ONLY when both are present. */
    if (Array.isArray(q.figs) && q.figs.length && (q.img || 0) && q.figs.length !== q.img)
      add(q, 'FIGURES', `declares ${q.img} figure(s), carries ${q.figs.length}`);

    if (stem) {
      const s = norm(q[stem]);
      if (!s) add(q, 'STEM', 'has no question text');
      else if (seenStem.has(s)) add(q, 'DUPLICATE_STEM', `word-for-word identical to ${seenStem.get(s)}`);
      else seenStem.set(s, q.id);
    }
  }
  return out;
}

/* Defects the fellow is never told about. This is what gates the build; a
   disclosed defect is a known limitation of the export, not a regression. */
const undisclosed = (bank, byId) => {
  const map = byId || new Map(bank.filter(q => q && q.id).map(q => [q.id, q]));
  return check(bank).filter(f => {
    const q = map.get(f.id);
    return !(q && (q.bad || q.flag));
  });
};

module.exports = { check, undisclosed, stemKey };
