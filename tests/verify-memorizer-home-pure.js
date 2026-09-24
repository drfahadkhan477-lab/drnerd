#!/usr/bin/env node
/*
 * Memorizer's home screen says true things: where you are, how much has
 * stuck, and a pearl that is your PDF's own sentence.
 *
 *   node tests/verify-memorizer-home-pure.js
 *
 * Pure Node. memorizer/src/home.js is driven with the real src/core/fsrs.js
 * and the real src/core/pearl.js, loaded the way the session suite loads
 * FSRS, on a fixed day. What is proven:
 *
 *   · PROGRESS COUNTS WHAT HAPPENED. Sections studied from each unit's
 *     session; cards "held" only when FSRS gives today's recall at 90% or
 *     more — a card never reviewed, or reviewed long ago, is not held.
 *   · THE RIGHT UNIT IS OFFERED. One under way beats one not begun; a
 *     mastered unit is offered only when nothing else is open.
 *   · THE PEARL IS THE PDF'S. Taken from the sections' prose only (never a
 *     heading, list item or table row), the same all day, moved by "Another",
 *     and credited to the heading it was printed under.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'memorizer', 'src', 'home.js'));
const load = rel => {
  const mod = {};
  new Function('module', 'exports', fs.readFileSync(path.join(ROOT, rel), 'utf8')).call(mod, { exports: mod }, mod);
  return mod;
};
const FSRS = load('src/core/fsrs.js').FSRS;
const Pearl = load('src/core/pearl.js').Pearl;
const DAY = '2026-03-10';

/* Synthetic prose, written for this suite. "greater than", never "above":
   pearl.js refuses a sentence containing "above" or "below" as pointing
   outside itself, and PROSE_A said "above" in the first version of this
   suite — so it was never a candidate, and the pearl checks passed on B. */
const PROSE_A = 'A left ventricular end-diastolic pressure greater than 18 mmHg should prompt a search for volume overload, whereas a normal pressure of 8 to 12 mmHg does not exclude a stiff ventricle.';
const PROSE_B = 'Vasodilators should be avoided in severe aortic stenosis because the fixed outflow cannot increase flow to compensate for a fall in systemic resistance.';
const PROSE_C = 'Nitrates must be withheld within 48 hours of a phosphodiesterase inhibitor, unlike beta-blockers, because the combination can cause profound hypotension.';
const LIST_LINE = 'Loop diuretics should be given at 40 mg twice daily in overload, unlike thiazides, which are weaker in renal failure and rarely enough alone.';
const doc = (id, addedAt, clusters) => ({ id, name: 'Unit ' + id, addedAt, pages: 3, clusters });
const cl = (index, title, segs, page) => ({ index, title, pageStart: page || 1, pageEnd: page || 1,
  segments: segs.map(s => Object.assign({ page: page || 1, heading: false }, typeof s === 'string' ? { text: s } : s)) });

head('greeting');
ok('morning, afternoon, evening, late — at their boundaries',
   H.greeting(5) === 'Good morning' && H.greeting(11) === 'Good morning' && H.greeting(12) === 'Good afternoon' &&
   H.greeting(16) === 'Good afternoon' && H.greeting(17) === 'Good evening' && H.greeting(21) === 'Good evening' &&
   H.greeting(22) === 'Studying late' && H.greeting(0) === 'Studying late' && H.greeting(4) === 'Studying late');

head('progress counts what happened');
{
  const d1 = doc('a', 1, [cl(0, 'x', ['a']), cl(1, 'y', ['b']), cl(2, 'z', ['c']), cl(3, 'w', ['d'])]);
  const d2 = doc('b', 2, [cl(0, 'x', ['a']), cl(1, 'y', ['b'])]);
  const d3 = doc('c', 3, [cl(0, 'x', ['a']), cl(1, 'y', ['b']), cl(2, 'z', ['c'])]);
  ok('a unit on its third section has studied two', H.studiedOf(d1, { phase: 'recall', cluster: 2 }) === 2);
  ok('a unit at the gauntlet, or done, has studied all of them', H.studiedOf(d1, { phase: 'gauntlet', cluster: 3 }) === 4 && H.studiedOf(d1, { phase: 'done', cluster: 3 }) === 4);
  ok('a unit not begun has studied none', H.studiedOf(d1, null) === 0);

  const good = FSRS.update(null, 3, DAY);             /* reviewed today: recall is 100% */
  const old = FSRS.update(null, 3, '2025-01-01');      /* reviewed fourteen months ago */
  const cards = [{ id: 1, srs: good }, { id: 2, srs: old }, { id: 3, srs: null }, { id: 4 }];
  ok('a card reviewed today is held', H.isHeld(cards[0], DAY, FSRS));
  ok('one reviewed long ago is not — FSRS puts its recall well under 90%', !H.isHeld(cards[1], DAY, FSRS),
     (FSRS.retrievability(old.stability, FSRS.daysBetween(old.last, DAY)) * 100).toFixed(0) + '%');
  ok('and one never reviewed is not held either: it has no history to predict from', !H.isHeld(cards[2], DAY, FSRS) && !H.isHeld(cards[3], DAY, FSRS));
  /* At the boundary: a stability of 10 days crosses 90% at 10 days. */
  const edge = { srs: { stability: 10, last: '2026-02-28', difficulty: 5 } };
  const r = FSRS.retrievability(10, FSRS.daysBetween('2026-02-28', DAY));
  ok('held means 90% or more, measured by FSRS itself', H.isHeld(edge, DAY, FSRS) === (r >= 0.9) && Math.abs(r - 0.9) < 0.01, (r * 100).toFixed(1) + '%');
  /* A day either side, so a threshold moved at all is seen: the check
     above alone passed with the threshold at 50%. */
  const day = (d) => ({ srs: { stability: 10, last: d, difficulty: 5 } });
  const r9 = FSRS.retrievability(10, 9), r11 = FSRS.retrievability(10, 11);
  ok('a day before recall falls to 90% it is held, a day after it is not', H.isHeld(day('2026-03-01'), DAY, FSRS) && !H.isHeld(day('2026-02-27'), DAY, FSRS) &&
     r9 > 0.9 && r11 < 0.9 && r11 > 0.88, `${(r9 * 100).toFixed(1)}% / ${(r11 * 100).toFixed(1)}%`);

  const p = H.progress([d1, d2, d3], { a: { phase: 'recall', cluster: 2 }, b: { phase: 'done', cluster: 1 } }, cards, DAY, FSRS);
  ok('sections are summed across units, studied from each one’s session', p.sections === 9 && p.studied === 4 && p.studiedPct === 44, JSON.stringify(p));
  ok('cards held out of all cards', p.cards === 4 && p.held === 1 && p.heldPct === 25);
  const none = H.progress([], {}, [], DAY, FSRS);
  ok('nothing yet is 0%, not NaN', none.studiedPct === 0 && none.heldPct === 0);
}

head('the unit offered to continue');
{
  const a = doc('a', 1, [cl(0, 'x', ['a'])]), b = doc('b', 2, [cl(0, 'x', ['a'])]), c = doc('c', 3, [cl(0, 'x', ['a'])]);
  ok('one under way beats a newer one not begun', H.current([a, b, c], { a: { phase: 'recall', cluster: 0 } }).doc.id === 'a');
  ok('among those under way, the newest', H.current([a, b, c], { a: { phase: 'recall', cluster: 0 }, b: { phase: 'encode', cluster: 0 } }).doc.id === 'b');
  ok('a mastered one is passed over for one not begun', H.current([a, b], { b: { phase: 'done' } }).doc.id === 'a' && H.current([a, b], { b: { phase: 'done' } }).started === false);
  ok('and offered only when nothing else is open', H.current([a], { a: { phase: 'done' } }).doc.id === 'a');
  ok('no units, nothing offered', H.current([], {}) === null);
}

head('the pearl is the PDF’s own sentence');
{
  const d = doc('p', 1, [
    cl(0, 'Preload', [{ text: 'Preload', heading: true }, 'Short line.', PROSE_A,
      { text: 'Afterload and the valve', heading: true }, PROSE_B], 2),
    cl(1, 'Drugs', [{ text: LIST_LINE, item: true }, { text: PROSE_C, table: [['a']] }, 'It is short.'], 3)]);
  const notes = H.notesOf(d);
  ok('a section becomes one note of its prose', notes.length === 2 && notes[0].body.indexOf(PROSE_A) !== -1 && notes[0].body.indexOf(PROSE_B) !== -1);
  ok('headings, list items and table rows are not in it', notes[0].body.indexOf('Afterload and the valve') === -1 &&
     notes[1].body.indexOf(LIST_LINE) === -1 && notes[1].body.indexOf(PROSE_C) === -1, JSON.stringify(notes[1].body));

  const pk = H.pearlOf([d], Pearl, DAY, 0);
  ok('a pearl is found', !!pk && !!pk.pearl, pk ? pk.pearl.text : 'none');
  const words = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const src = words(PROSE_A + ' ' + PROSE_B);
  ok('every word of it is in the section', pk && words(pk.pearl.text).every(w => src.indexOf(w) !== -1));
  ok('and it is never a list item or a table row, even the best-scoring', pk && [LIST_LINE, PROSE_C].every(t => pk.pearl.text.indexOf(t.slice(0, 30)) === -1));
  ok('its steps are Pearl.steps of it', pk && JSON.stringify(pk.steps) === JSON.stringify(Pearl.steps(pk.pearl.text)));
  ok('the same all day', JSON.stringify(H.pearlOf([d], Pearl, DAY, 0)) === JSON.stringify(pk));

  /* Two units, so there is more than one pearl to choose among. */
  const e = doc('q', 2, [cl(0, 'Valves', [PROSE_C], 1), cl(1, 'Pressure', [PROSE_A], 2)]);
  const d2 = doc('r', 3, [cl(0, 'Stenosis', [PROSE_B], 1)]);
  const picks = [0, 1, 2, 3].map(k => H.pearlOf([e, d2], Pearl, DAY, k).pearl.id);
  ok('“Another” always moves to a different one', picks.every((id, i) => i === 0 || id !== picks[i - 1]), picks.join(' → '));
  const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
  const byDay = new Set(days.map(x => H.pearlOf([e, d2], Pearl, x, 0).pearl.id));
  ok('and the day changes which one opens', byDay.size >= 2, [...byDay].join(', '));

  const where = H.pearlOf([doc('s', 1, [cl(0, 'Preload', [{ text: 'Preload', heading: true }, 'Short line.',
    { text: 'Afterload and the valve', heading: true, page: 4 }, { text: PROSE_B, page: 4 }], 3)])], Pearl, DAY, 0).pearl;
  ok('credited to the heading it was printed under, not the section’s first', where.heading === 'Afterload and the valve', where.heading);
  ok('and to the page it was printed on', where.page === 4, String(where.page));
  ok('a unit with no sentence worth a pearl has none, rather than a poor one', H.pearlOf([doc('t', 1, [cl(0, 'x', ['It is short.', 'So is this.'])])], Pearl, DAY, 0) === null);
}

head('the numbers in a pearl are marked');
{
  const runs = H.marks('Above 18 mmHg, or 8 to 12, in 40% of patients over 3 days.');
  const marked = runs.filter(r => r.num).map(r => r.text.trim());
  ok('each figure, with its unit', marked.join('|') === '18 mmHg|8|12|40%|3 days', marked.join('|'));
  ok('and the text between is left as it was', runs.map(r => r.text).join('') === 'Above 18 mmHg, or 8 to 12, in 40% of patients over 3 days.');
  ok('a sentence with no number has nothing marked', !H.marks('Preload rises with volume.').some(r => r.num));
}

head('words');
ok('one section, three sections', H.count(1, 'section') === '1 section' && H.count(3, 'section') === '3 sections' && H.count(0, 'page') === '0 pages');
ok('the hero trace is a still line across the whole band', /^M0 30 /.test(H.tracePath(600, 4)) && / L600 30$/.test(H.tracePath(600, 4)) &&
   (H.tracePath(600, 4).match(/l5 -30/g) || []).length === 4);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
