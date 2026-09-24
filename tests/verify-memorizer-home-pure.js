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
const S = require(path.join(ROOT, 'memorizer', 'src', 'session.js'));
/* A real session, driven through its reducer. `marks[i]` is null for a
   section never drilled, or [right, of] for its drill's first pass. */
const LESSON = { overview: 'o', points: [{ text: 'p', page: 1 }], numbers: [], mnemonics: [], analogies: [], flowchart: '' };
function studied(id, titles, marks) {
  let st = S.init(id, titles);
  marks.forEach((m, i) => {
    if (!m) return;
    st = S.next(st, { type: 'open', section: i });
    st = S.next(st, { type: 'taught', value: LESSON });
    st = S.next(st, { type: 'toMemorize', value: { cards: 0 } });
    st = S.next(st, { type: 'toDrill' });
    st = S.next(st, { type: 'quizReady', value: { questions: Array.from({ length: m[1] }, (_, k) => ({ question: id + i + 'q' + k, quote: '', options: ['a', 'b', 'c', 'd'], answer: 0, explain: '', page: 1 })) } });
    for (let k = 0; k < m[1]; k++) st = S.next(st, { type: 'answered', choice: k < m[0] ? 0 : 1 });
    while (st.phase === 'drill') st = S.next(st, { type: 'answered', choice: 0 });
  });
  return st;
}
const allDrilled = (id, titles) => studied(id, titles, titles.map(() => [1, 1]));
/* Every section drilled, then the exam taken — k of two right — and the
   unit's page returned to, as the app does. */
const examined = (id, titles, k) => {
  let s = S.next(allDrilled(id, titles), { type: 'toExam' });
  s = S.next(s, { type: 'examReady', value: { questions: [0, 1].map(j => ({ question: 'E' + j, quote: '', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', page: 1, cluster: 0 })) } });
  s = S.next(s, { type: 'examAnswered', choice: 0 });
  s = S.next(s, { type: 'examAnswered', choice: k > 1 ? 0 : 1 });
  return S.next(s, { type: 'toUnit' });
};

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
  ok('a unit with two sections drilled has studied two, whichever two', H.studiedOf(d1, studied('a', ['x', 'y', 'z', 'w'], [[1, 1], null, [0, 2], null])) === 2);
  ok('a section taught but not drilled is not studied', H.studiedOf(d1, S.next(S.next(S.init('a', ['x', 'y', 'z', 'w']), { type: 'open', section: 0 }), { type: 'taught', value: LESSON })) === 0);
  ok('a session from the old protocol counts none: it is not resumed', H.studiedOf(d1, { phase: 'done', cluster: 3 }) === 0);
  ok('a unit not begun has studied none', H.studiedOf(d1, null) === 0);
  /* Version 3 added the weak list; a version-2 session saved before it is
     the same drill protocol and must still count — the first version-3
     build checked for version 2 exactly, and every session read as new. */
  const v3 = studied('a', ['x', 'y', 'z', 'w'], [[1, 1], null, [0, 2], null]);
  const v2 = JSON.parse(JSON.stringify(v3)); v2.v = 2; delete v2.weak;
  ok('a version-2 and a version-3 session count the same', v3.v === 3 && H.studiedOf(d1, v2) === 2 && H.studiedOf(d1, v3) === 2 &&
     H.sectionPct(v2, 0) === H.sectionPct(v3, 0) && H.sectionPct(v3, 0) != null);

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

  const p = H.progress([d1, d2, d3], { a: studied('a', ['x', 'y', 'z', 'w'], [[1, 1], [1, 2], null, null]), b: allDrilled('b', ['x', 'y']) }, cards, DAY, FSRS);
  ok('sections are summed across units, studied from each one’s session', p.sections === 9 && p.studied === 4 && p.studiedPct === 44, JSON.stringify(p));
  ok('cards held out of all cards', p.cards === 4 && p.held === 1 && p.heldPct === 25);
  const none = H.progress([], {}, [], DAY, FSRS);
  ok('nothing yet is 0%, not NaN', none.studiedPct === 0 && none.heldPct === 0);
}

head('the unit offered to continue');
{
  const a = doc('a', 1, [cl(0, 'x', ['a'])]), b = doc('b', 2, [cl(0, 'x', ['a'])]), c = doc('c', 3, [cl(0, 'x', ['a'])]);
  const a2 = doc('a', 1, [cl(0, 'x', ['a']), cl(1, 'y', ['b'])]), b2 = doc('b', 2, [cl(0, 'x', ['a']), cl(1, 'y', ['b'])]), c2 = doc('c', 3, [cl(0, 'x', ['a'])]);
  const under = id => studied(id, ['x', 'y'], [[1, 1], null]);
  const mastered = id => examined(id, ['x', 'y'], 2);
  ok('one under way beats a newer one not begun', H.current([a2, b2, c2], { a: under('a') }).doc.id === 'a');
  ok('among those under way, the newest', H.current([a2, b2, c2], { a: under('a'), b: under('b') }).doc.id === 'b');
  ok('a session opened but never taught is not under way', H.current([a2, b2], { b: S.init('b', ['x', 'y']) }).started === false);
  ok('a mastered one is passed over for one not begun', H.current([a2, b2], { b: mastered('b') }).doc.id === 'a' && H.current([a2, b2], { b: mastered('b') }).started === false);
  ok('and offered only when nothing else is open', H.current([a2], { a: mastered('a') }).doc.id === 'a');
  ok('no units, nothing offered', H.current([], {}) === null);
}

head('jump back in, and what continue opens');
{
  const a = doc('a', 1, [cl(0, 'Preload', ['a']), cl(1, 'Afterload', ['b']), cl(2, 'Contractility', ['c'])]);
  const b = doc('b', 2, [cl(0, 'Stenosis', ['a'])]), c = doc('c', 3, [cl(0, 'Shunts', ['a'])]);
  const sa = studied('a', ['Preload', 'Afterload', 'Contractility'], [[1, 1], null, null]);
  const r = H.recent([a, b, c], { a: sa }, { a: 500, b: 100 }, 3);
  ok('the unit studied most recently first, then by when each was added', r.map(x => x.doc.id).join() === 'a,b,c', r.map(x => x.doc.id).join());
  ok('with its share of sections drilled, rounded', r[0].pct === 33 && r[1].pct === 0, r.map(x => x.pct).join());
  ok('and the section continue would open: the next one not drilled', r[0].next === 'Afterload' && r[1].next === 'Stenosis', r.map(x => x.next).join(' | '));
  ok('a unit with every section drilled offers its final exam', H.nextTitle(a, allDrilled('a', ['Preload', 'Afterload', 'Contractility'])) === 'Final exam');
  ok('and one whose exam is done gives its score, back on the unit’s page or not', H.nextTitle(a, examined('a', ['Preload', 'Afterload', 'Contractility'], 1)) === 'Final exam · 50%',
     H.nextTitle(a, examined('a', ['Preload', 'Afterload', 'Contractility'], 1)));
  ok('n at most', H.recent([a, b, c], {}, {}, 2).length === 2);
  const sp = studied('a', ['x', 'y', 'z'], [[3, 4], null, [1, 2]]);
  ok('a section\u2019s badge is its best drill score, and none before a drill', H.sectionPct(sp, 0) === 75 && H.sectionPct(sp, 1) === null && H.sectionPct(sp, 2) === 50);
  /* Drilled at 3/4, then again at 1/4: the badge keeps the better. */
  let rd = S.next(studied('r', ['x'], [[3, 4]]), { type: 'redrill' });
  for (let k = 0; k < 4; k++) rd = S.next(rd, { type: 'answered', choice: k < 1 ? 0 : 1 });
  while (rd.phase === 'drill') rd = S.next(rd, { type: 'answered', choice: 0 });
  ok('after a worse retake the badge still shows the best drill', rd.per[0].score === 0.25 && H.sectionPct(rd, 0) === 75, rd.per[0].score + ' / ' + H.sectionPct(rd, 0));
  /* Section 2 of 3 drilled, section 1 not: continue goes on from where you
     were (section 3), not back to the start. */
  const mid = studied('a', ['Preload', 'Afterload', 'Contractility'], [null, [1, 1], null]);
  ok('continue goes on from the section last studied, not from the start', H.nextTitle(a, mid) === 'Contractility', H.nextTitle(a, mid));
  ok('a unit\u2019s percentage is its sections drilled', H.unitPct(doc('z', 1, [cl(0, 'x', ['a']), cl(1, 'y', ['b']), cl(2, 'z', ['c'])]), sp) === 67);
}

head('the streak');
{
  ok('three days in a row ending today is three', H.streak(['2026-03-08', '2026-03-09', '2026-03-10'], '2026-03-10', FSRS) === 3);
  ok('ending yesterday still counts — today is not over', H.streak(['2026-03-08', '2026-03-09'], '2026-03-10', FSRS) === 2);
  ok('a gap breaks it', H.streak(['2026-03-06', '2026-03-08', '2026-03-09', '2026-03-10'], '2026-03-10', FSRS) === 3);
  ok('nothing since the day before yesterday is none', H.streak(['2026-03-07', '2026-03-08'], '2026-03-10', FSRS) === 0);
  ok('across a month\u2019s end', H.streak(['2026-02-27', '2026-02-28', '2026-03-01'], '2026-03-01', FSRS) === 3);
  ok('the order the days were saved in does not matter', H.streak(['2026-03-10', '2026-03-08', '2026-03-09'], '2026-03-10', FSRS) === 3);
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

head('weak spots: where the sessions say you are shakiest');
{
  const u = doc('u', 1, [cl(0, 'Preload', ['a']), cl(1, 'Afterload', ['b']), cl(2, 'Contractility', ['c']), cl(3, 'Untaught', ['d'])]);
  const v = doc('v', 2, [cl(0, 'Stenosis', ['e']), cl(1, 'Regurgitation', ['f'])]);
  /* Drill scores, first pass: 4/5 is exactly 80%, 79/100 is 79%. */
  const sessions = { u: studied('u', ['Preload', 'Afterload', 'Contractility', 'Untaught'], [[4, 5], [79, 100], [1, 20], null]),
                     v: studied('v', ['Stenosis', 'Regurgitation'], [[2, 5], [2, 5]]) };
  const cards = [{ docId: 'v', cluster: 1 }, { docId: 'v', cluster: 1 }, { docId: 'v', cluster: 0 }, { docId: 'u', cluster: 1 }, { docId: 'v', cluster: 3 }];
  const all = H.weakSpots([u, v], sessions, cards, S.mastery, 10);
  const names = all.map(w => w.title + ':' + w.pct + ':' + w.cards);
  ok('a section at 80% mastery is not weak; one at 79% is', !names.some(n => /^Preload:/.test(n)) && names.some(n => /^Afterload:79:/.test(n)), names.join(' | '));
  ok('a section not yet taught is never called weak', !names.some(n => /^Untaught/.test(n)));
  ok('weakest first, across units', names[0] === 'Contractility:5:0', names.join(' | '));
  ok('between two equally weak, the one with more cards waiting first', names[1] === 'Regurgitation:40:2' && names[2] === 'Stenosis:40:1', names.join(' | '));
  ok('its cards are counted from its own unit and section only', all.find(w => w.title === 'Afterload').cards === 1);
  ok('three at most on the home screen', H.weakSpots([u, v], sessions, cards, S.mastery, 3).length === 3);
  ok('a unit with no session has none', H.weakSpots([u], {}, cards, S.mastery, 3).length === 0);
}

head('words');
ok('one section, three sections', H.count(1, 'section') === '1 section' && H.count(3, 'section') === '3 sections' && H.count(0, 'page') === '0 pages');
ok('the hero trace is a still line across the whole band', /^M0 30 /.test(H.tracePath(600, 4)) && / L600 30$/.test(H.tracePath(600, 4)) &&
   (H.tracePath(600, 4).match(/l5 -30/g) || []).length === 4);

head('beside the pearl: its own section’s figure, or its table');
{
  const C = require(path.join(ROOT, 'memorizer', 'src', 'chunk.js'));
  const sec = (index, p0, p1, segs) => ({ index, title: 'S' + index, pageStart: p0, pageEnd: p1, text: segs.map(x => x.text || '').join(' '), segments: segs });
  const tbl = { page: 4, heading: false, text: '', table: [['LVEDP', '12', 'mmHg'], ['SV', '70', 'mL'], ['HR', '72', 'bpm'], ['EF', '60', '%'], ['CO', '5', 'L/min'], ['CI', '3', 'L/min/m2']], tableHeader: ['Measure', 'Normal', 'Unit'] };
  const doc = { id: 'd', hasFile: true, clusters: [sec(0, 1, 2, [{ page: 1, text: 'Preload rises.' }, { page: 2, text: 'More on preload.' }]), sec(1, 3, 4, [{ page: 3, text: 'Afterload.' }, tbl])],
    figures: [{ page: 1, box: [0, 0, 100, 100] }, { page: 2, box: [0, 0, 200, 100] }, { page: 3, box: [5, 5, 50, 50] }] };
  const v = H.pearlVisual(doc, { cluster: 0, page: 2 }, C);
  ok('the figure on the pearl’s own page, from its own section', v && v.kind === 'figure' && v.page === 2 && v.box[2] === 200, JSON.stringify(v));
  const v1 = H.pearlVisual(doc, { cluster: 0, page: 9 }, C);
  ok('else the section’s first figure', v1 && v1.kind === 'figure' && v1.page === 1, JSON.stringify(v1));
  const d2 = Object.assign({}, doc, { figures: [{ page: 1, box: [0, 0, 1, 1] }] });
  const v2 = H.pearlVisual(d2, { cluster: 1, page: 3 }, C);
  ok('with no figure of its own, not another section’s figure but its own table', v2 && v2.kind === 'table' && v2.page === 4 && (v2.header || []).join() === 'Measure,Normal,Unit', JSON.stringify(v2 && v2.kind));
  ok('a few rows of it, and how many more', v2.rows.length === H.PEARL_ROWS && v2.rows[0][0] === 'LVEDP' && v2.more === 1, v2.rows.length + ' +' + v2.more);
  const d3 = { id: 'e', hasFile: true, clusters: [sec(0, 1, 1, [{ page: 1, text: 'Only prose.' }])], figures: [] };
  ok('nothing at all when the section has neither', H.pearlVisual(d3, { cluster: 0, page: 1 }, C) === null);
  ok('and nothing for a pearl whose section is not in the unit', H.pearlVisual(doc, { cluster: 7, page: 1 }, C) === null && H.pearlVisual(null, {}, C) === null);
  const noFile = Object.assign({}, doc, { hasFile: false });
  ok('a unit whose PDF is not kept has no figure to draw: its table instead', H.pearlVisual(noFile, { cluster: 1, page: 3 }, C).kind === 'table');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
