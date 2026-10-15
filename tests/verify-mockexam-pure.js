#!/usr/bin/env node
/*
 * The mock exam's logic — src/core/mockexam.js: a timed block, no feedback until it is handed in.
 *
 *   node tests/verify-mockexam-pure.js
 *
 * Pure Node, over an invented bank of invented chapters. The module has no clock of its own and no
 * DOM, so every time in here is a number the test hands it, and every expected value is worked out
 * in the test from the fixture, not read back from the module.
 *
 * What is measured, rather than assumed:
 *   - a block is the size asked for (or what the bank has), never repeats a question, never
 *     takes a quarantined one, takes fresh questions before seen ones and does not show which is which;
 *   - a choice is recorded and can be taken back, and nothing is graded until the block ends;
 *   - the clock counts only while the app is on screen, never more than one gap's worth for a
 *     frozen page, and puts the time on the question that was showing;
 *   - an unanswered question is wrong for the score and "skipped" in the report, once, not twice;
 *   - what is kept of a block is refused unless its numbers agree with each other;
 *   - a block read back from storage keeps what is sound, drops what is not, and is null rather
 *     than wrong when it cannot be trusted.
 */
'use strict';
const M = require('../src/core/mockexam.js').MockExam;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* A small deterministic generator, so "the same seed gives the same block" can be asked. */
const seeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const CH = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
const pool = [];
for (const ch of CH) for (let i = 1; i <= 24; i++) pool.push({ id: `${ch.slice(0, 3).toUpperCase()}_${i}`, ch, ci: i % 4, o: [1, 2, 3, 4, 5] });
const byId = Object.fromEntries(pool.map(q => [q.id, q]));
const lookup = id => byId[id] ? { ch: byId[id].ch, ci: byId[id].ci } : null;
const uniq = a => new Set(a).size === a.length;

head('which questions: the size asked for, once each, from the pool');
{
  const b = M.build({ pool, size: 40, rng: seeded(1) });
  ok('a block of 40 has 40 questions', b.length === 40, String(b.length));
  ok('none twice', uniq(b));
  ok('every one is in the pool', b.every(id => byId[id]));
  const big = Array.from({ length: 600 }, (_, k) => ({ id: 'B' + k, ch: 'Z' }));
  ok('a block is never longer than 500 questions, whatever the bank holds', M.build({ pool: big, size: 600, rng: seeded(14) }).length === 500 && M.build({ pool: big, size: 9999 }).length === 500);
  ok('a block bigger than the bank is the whole bank', M.build({ pool, size: 500, rng: seeded(2) }).length === pool.length);
  ok('a size that is not a positive whole number is no block', [0, -5, NaN, '40', null, undefined].every(s => M.build({ pool, size: s }).length === 0));
  ok('an empty pool, or no pool, is no block and not an error', M.build({ pool: [], size: 20 }).length === 0 && M.build({ size: 20 }).length === 0 && M.build().length === 0);
  const ch = M.build({ pool, size: 100, chapter: 'Gamma', rng: seeded(3) });
  ok('one chapter gives only that chapter, and no more than it has', ch.length === 24 && ch.every(id => byId[id].ch === 'Gamma'), String(ch.length));
  ok('a chapter the bank does not have gives no block', M.build({ pool, size: 20, chapter: 'Nope' }).length === 0);
}

head('a quarantined question is never in a block, and a repeated id is one question');
{
  const bad = pool.map((q, i) => i % 5 === 0 ? Object.assign({}, q, { bad: true }) : q);
  const badIds = new Set(bad.filter(q => q.bad).map(q => q.id));
  const b = M.build({ pool: bad, size: 500, rng: seeded(4) });
  ok('with a fifth of the bank quarantined, the whole-bank block holds the other four fifths', b.length === pool.length - badIds.size && b.every(id => !badIds.has(id)), b.length + ' of ' + (pool.length - badIds.size));
  const dup = pool.slice(0, 10).concat(pool.slice(0, 10));
  ok('the same id twice in the pool is asked once', M.build({ pool: dup, size: 20, rng: seeded(5) }).length === 10);
  ok('an entry with no usable id is skipped, not asked', M.build({ pool: [null, {}, { id: 7 }, pool[0]], size: 5, rng: seeded(6) }).length === 1);
}

head('fresh questions before seen ones, and the block does not say which is which');
{
  const seenSet = new Set(pool.slice(0, 80).map(q => q.id));            // 80 seen, 40 fresh
  const seen = id => seenSet.has(id);
  const b20 = M.build({ pool, size: 20, seen, rng: seeded(7) });
  ok('twenty from a bank with forty fresh are all fresh', b20.every(id => !seenSet.has(id)), b20.filter(id => seenSet.has(id)).length + ' seen');
  const b60 = M.build({ pool, size: 60, seen, rng: seeded(8) });
  const fresh = b60.filter(id => !seenSet.has(id)).length;
  ok('sixty takes all forty fresh ones, then twenty seen', fresh === 40 && b60.length === 60, fresh + ' fresh');
  let freshFirst = 0;
  for (let s = 1; s <= 30; s++) {
    const b = M.build({ pool, size: 60, seen, rng: seeded(100 + s) });
    const lastFresh = Math.max(...b.map((id, i) => seenSet.has(id) ? -1 : i));
    const firstSeen = b.findIndex(id => seenSet.has(id));
    if (firstSeen > lastFresh) freshFirst++;                              // every fresh one before every seen one
  }
  ok('the fresh ones are not all lined up before the seen ones', freshFirst <= 1, freshFirst + ' of 30 blocks were fresh-then-seen');
}

head('the same seed gives the same block, and the inputs are left alone');
{
  const a = M.build({ pool, size: 30, rng: seeded(9) }), b = M.build({ pool, size: 30, rng: seeded(9) }), c = M.build({ pool, size: 30, rng: seeded(10) });
  ok('same seed, same block', same(a, b));
  ok('another seed, another block', !same(a, c));
  const before = JSON.stringify(pool);
  M.build({ pool, size: 30, seen: () => true, rng: seeded(11) });
  ok('the pool is not changed by building from it', JSON.stringify(pool) === before);
  const junk = [() => NaN, () => 1, () => -1, () => 7, () => undefined, () => Infinity];
  const sound = r => { try { const x = M.build({ pool, size: 25, rng: r }); return x.length === 25 && uniq(x) && x.every(id => byId[id]); } catch (e) { return false; } };
  ok('a generator that returns nonsense still gives a block of real, distinct questions', junk.every(sound), junk.map(sound).join());
}

head('starting a block');
{
  const ids = M.build({ pool, size: 20, rng: seeded(12) });
  const r = M.start({ ids, secPerQ: 90, chapter: 'Beta', now: 1000 });
  ok('it starts on the first question, nothing answered or flagged, clock at zero', r.i === 0 && r.far === 0 && same(r.sel, {}) && same(r.flag, {}) && r.elapsedMs === 0 && !r.done && !r.paused, JSON.stringify([r.i, r.far, r.elapsedMs]));
  ok('it keeps the questions in the order given, the chapter and the start time', same(r.ids, ids) && r.chapter === 'Beta' && r.startedAt === 1000);
  ok('a pace that is not a whole number of seconds from 0 to 600 becomes ninety', [45.5, -1, 601, 'x', NaN, undefined].every(p => M.start({ ids, secPerQ: p }).secPerQ === 90));
  ok('but no limit (0) and the three offered paces are kept', [0, 60, 90, 120].every(p => M.start({ ids, secPerQ: p }).secPerQ === p));
  ok('a chapter that is not a name is none', ['', 5, null, undefined, {}].every(c => M.start({ ids, chapter: c }).chapter === null));
  ok('ids that are not strings are dropped', same(M.start({ ids: ['a', 3, null, 'b'] }).ids, ['a', 'b']));
}

head('working the block: a choice can be changed, and nothing is graded');
{
  const r = M.start({ ids: ['Q1', 'Q2', 'Q3', 'Q4'], secPerQ: 0, now: 0 });
  ok('picking an option records it for the question on screen', M.select(r, 2, 5) === true && same(r.sel, { 0: 2 }));
  ok('picking another replaces it', M.select(r, 4, 5) === true && same(r.sel, { 0: 4 }));
  ok('picking the same one again takes it back', M.select(r, 4, 5) === true && same(r.sel, {}));
  ok('an option that is not there is refused and changes nothing', [-1, 5, 1.5, '1', null, NaN].every(i => M.select(r, i, 5) === false) && same(r.sel, {}));
  ok('with no option count, nothing can be chosen', M.select(r, 0) === false && M.select(r, 0, NaN) === false);
  M.select(r, 1, 5); M.go(r, 2); M.select(r, 3, 5);
  ok('a choice belongs to the question it was made on', same(r.sel, { 0: 1, 2: 3 }), JSON.stringify(r.sel));
  ok('flagging marks the question on screen, and again clears it', M.toggleFlag(r) && same(r.flag, { 2: 1 }) && M.toggleFlag(r) && same(r.flag, {}));
}

head('moving about the block');
{
  const r = M.start({ ids: ['A', 'B', 'C', 'D', 'E'], now: 0 });
  ok('going to the next question moves there', M.go(r, 1) && r.i === 1 && r.far === 1);
  ok('going to the question already on screen is no move', M.go(r, 1) === false);
  ok('before the first, past the last, or between numbers is refused', [-1, 5, 1.5, '2', NaN, null].every(j => M.go(r, j) === false) && r.i === 1);
  M.go(r, 4); M.go(r, 0);
  ok('the furthest question reached is kept when you go back', r.i === 0 && r.far === 4, r.i + '/' + r.far);
  const s0 = M.states(r);
  ok('the navigator has a cell per question and marks the current one', s0.cells.length === 5 && s0.cells.filter(c => c.current).length === 1 && s0.cells[0].current);
  M.select(r, 1, 5); M.go(r, 3); M.select(r, 0, 5); M.toggleFlag(r); M.go(r, 4); M.toggleFlag(r);
  const s = M.states(r);
  ok('it counts answered, unanswered and flagged from the block', s.answered === 2 && s.unanswered === 3 && s.flagged === 2 && s.n === 5, JSON.stringify([s.answered, s.unanswered, s.flagged]));
  ok('and each cell says which', same(s.cells.map(c => [c.answered, c.flagged]), [[true, false], [false, false], [false, false], [true, true], [false, true]]));
  ok('states of nothing is an empty navigator, not an error', same(M.states(null).cells, []) && M.states({}).n === 0);
}

head('the clock counts only while the app is on screen');
{
  const r = M.start({ ids: ['A', 'B', 'C'], secPerQ: 60, now: 0 });
  M.tick(r, 1000, true);
  ok('the first tick has nothing to measure from and counts nothing', r.elapsedMs === 0);
  M.tick(r, 3500, true); M.tick(r, 4000, true);
  ok('then each tick adds the time since the last', r.elapsedMs === 3000, String(r.elapsedMs));
  ok('and puts it on the question on screen', r.ms[0] === 3000 && r.ms[1] === undefined);
  M.go(r, 1); M.tick(r, 6000, true);
  ok('after moving, the time goes to the new question', r.ms[1] === 2000 && r.ms[0] === 3000 && r.elapsedMs === 5000, JSON.stringify(r.ms));
  M.tick(r, 7000, false); M.tick(r, 9000, false);
  ok('while the app is hidden nothing is counted', r.elapsedMs === 5000, String(r.elapsedMs));
  M.tick(r, 9500, true);
  ok('and the first tick after it comes back does not make up for it', r.elapsedMs === 5000, String(r.elapsedMs));
  M.tick(r, 10500, true);
  ok('then it counts again', r.elapsedMs === 6000);
  M.hold(r); M.tick(r, 20000, true);
  ok('holding the clock (the page was hidden) means the next tick starts afresh', r.elapsedMs === 6000);
  M.resume(r, 30000); M.tick(r, 31000, true);
  ok('resuming it counts from the moment it resumed', r.elapsedMs === 7000, String(r.elapsedMs));
  M.tick(r, 31000 + 10 * 60000, true);
  ok('a gap of ten minutes between ticks counts as no more than ' + M.MAX_GAP_MS / 1000 + ' seconds', r.elapsedMs === 7000 + M.MAX_GAP_MS, String(r.elapsedMs));
  const t0 = r.elapsedMs; M.tick(r, 31000 + 10 * 60000 - 5000, true);
  ok('a clock that moves backwards counts nothing, not minus', r.elapsedMs === t0);
  const long = M.start({ ids: ['A', 'B'], secPerQ: 0, now: 0 });
  M.tick(long, 0, true); for (let k = 1; k <= 300; k++) M.tick(long, k * M.MAX_GAP_MS, true);
  ok('an hour is the most one question is charged, while the block goes on counting', long.ms[0] === 3600000 && long.elapsedMs === 300 * M.MAX_GAP_MS, long.ms[0] + ' / ' + long.elapsedMs);
}

head('pausing, and a block that is over');
{
  const r = M.start({ ids: ['A', 'B'], secPerQ: 0, now: 0 });
  M.tick(r, 0, true); M.tick(r, 2000, true);
  M.pause(r); M.tick(r, 8000, true); M.tick(r, 9000, true);
  ok('a paused block counts nothing', r.elapsedMs === 2000 && r.paused);
  ok('and refuses a choice, a flag and a move', M.select(r, 0, 5) === false && M.toggleFlag(r) === false && M.go(r, 1) === false && same(r.sel, {}) && same(r.flag, {}) && r.i === 0);
  M.unpause(r, 20000); M.tick(r, 21000, true);
  ok('unpausing counts from then, not from the pause', r.elapsedMs === 3000 && !r.paused, String(r.elapsedMs));
  M.finish(r, 22000, false);
  ok('a finished block is done, and not marked as out of time', r.done && r.expired === false && r.submittedAt === 22000);
  const e = r.elapsedMs; M.tick(r, 23000, true); M.tick(r, 24000, true);
  ok('it counts nothing more, and takes no more choices', r.elapsedMs === e && M.select(r, 0, 5) === false && M.go(r, 1) === false && M.toggleFlag(r) === false);
  const before = JSON.stringify(r); M.finish(r, 99999, true);
  ok('finishing twice changes nothing', JSON.stringify(r) === before);
}

head('the time limit');
{
  const r = M.start({ ids: M.build({ pool, size: 40, rng: seeded(13) }), secPerQ: 90, now: 0 });
  ok('forty questions at ninety seconds is an hour', M.limitMs(r) === 3600000);
  ok('an untimed block has no limit, no time left and never runs out', (() => { const u = M.start({ ids: ['A'], secPerQ: 0 }); u.elapsedMs = 1e12; return M.limitMs(u) === null && M.remainingMs(u) === null && M.expired(u) === false && M.urgency(u) === 'none'; })());
  r.elapsedMs = 1000;
  ok('the time left is the limit less the time used', M.remainingMs(r) === 3599000);
  r.elapsedMs = 3600000 - 1;
  ok('one millisecond short of the limit is not out of time', M.expired(r) === false && M.remainingMs(r) === 1);
  r.elapsedMs = 3600000;
  ok('at the limit it is, with nothing left', M.expired(r) === true && M.remainingMs(r) === 0);
  r.elapsedMs = 9e9;
  ok('past it the time left is zero, not negative', M.remainingMs(r) === 0);
  const u = (ms, n, sec) => { const x = M.start({ ids: Array.from({ length: n }, (_, k) => 'Q' + k), secPerQ: sec }); x.elapsedMs = ms; return M.urgency(x); };
  ok('plenty of time is ok; five minutes left is low; one minute is critical', u(0, 40, 90) === 'ok' && u(3600000 - 300000, 40, 90) === 'low' && u(3600000 - 60000, 40, 90) === 'critical' && u(3600000 - 300001, 40, 90) === 'ok');
  ok('a block of exactly five minutes is not low from the start either', u(0, 5, 60) === 'ok' && u(1, 5, 60) === 'ok');
  ok('a block shorter than five minutes is not low from the start, but is critical in its last minute', u(0, 3, 60) === 'ok' && u(120000, 3, 60) === 'critical' && u(119999, 3, 60) === 'ok');
}

head('the pace: where you are against an even pace, by the furthest question reached');
{
  const r = M.start({ ids: Array.from({ length: 40 }, (_, k) => 'Q' + k), secPerQ: 90, now: 0 });
  ok('at the start you are on pace', M.pace(r).status === 'on' && M.pace(r).expected === 1);
  r.elapsedMs = 5 * 60000;
  ok('five minutes in, still on the first question, you are well behind', M.pace(r).status === 'behind' && M.pace(r).expected === 4 && M.pace(r).diff === -3, JSON.stringify(M.pace(r)));
  r.far = 3;
  ok('on the question an even pace would be on, you are on pace', M.pace(r).status === 'on');
  r.far = 12; r.i = 0;
  ok('far ahead is ahead, and going back to question one does not make it behind', M.pace(r).status === 'ahead' && M.pace(r).diff === 13 - 4, JSON.stringify(M.pace(r)));
  r.elapsedMs = 1e12;
  ok('the pace never expects a question past the last', M.pace(r).expected === 40);
  const at = (ms, far) => { r.elapsedMs = ms; r.far = far; r.i = far; return M.pace(r); };
  ok('one question ahead or behind is still on pace; two is ahead or behind', at(0, 1).status === 'on' && at(0, 2).status === 'ahead' && at(360000, 3).status === 'on' && at(360000, 2).status === 'behind', JSON.stringify([at(0, 1).diff, at(0, 2).diff, at(360000, 3).diff, at(360000, 2).diff]));
  ok('an untimed block has no pace', M.pace(M.start({ ids: ['A', 'B'], secPerQ: 0 })) === null);
}

head('clock text');
{
  ok('zero is 00:00, and nonsense is too', M.fmtClock(0) === '00:00' && [NaN, -5, undefined, null, 'x'].every(v => M.fmtClock(v) === '00:00' && M.fmtClock(v, 'down') === '00:00'));
  ok('a countdown rounds up so it reads 00:01 until it is over', M.fmtClock(1, 'down') === '00:01' && M.fmtClock(1000, 'down') === '00:01' && M.fmtClock(1001, 'down') === '00:02' && M.fmtClock(59999, 'down') === '01:00');
  ok('a stopwatch rounds down so it reads 00:00 until a second has passed', M.fmtClock(999) === '00:00' && M.fmtClock(1000) === '00:01' && M.fmtClock(59999) === '00:59');
  ok('minutes and seconds, then hours', M.fmtClock(125000) === '02:05' && M.fmtClock(3599000) === '59:59' && M.fmtClock(3600000) === '1:00:00' && M.fmtClock(7384000) === '2:03:04');
}

head('handing in a block that ran out of time');
{
  const mk = () => M.start({ ids: ['A', 'B'], secPerQ: 60, now: 0 });           // limit 120 s
  const a = mk(); a.elapsedMs = 119000; a.last = 119000; M.finish(a, 119000 + 9000, true);
  ok('out of time: the seconds a late tick added past the limit are not charged', a.elapsedMs === 120000 && a.expired === true && a.done, String(a.elapsedMs));
  const b = mk(); b.elapsedMs = 30000; b.last = 30000; M.finish(b, 35000, false);
  ok('handed in early: the time is what it was, plus the last tick', b.elapsedMs === 35000 && b.expired === false, String(b.elapsedMs));
  const c = M.start({ ids: ['A'], secPerQ: 0 }); c.elapsedMs = 5e6; M.finish(c, 1, true);
  ok('an untimed block that is "ended" keeps its time (there is no limit to cap it at)', c.elapsedMs === 5e6);
}

head('the score: unanswered is wrong for the score and skipped in the report');
{
  const ids = ['ALP_1', 'ALP_2', 'ALP_3', 'BET_1', 'BET_2', 'BET_3', 'GAM_1', 'GAM_2', 'GAM_3', 'GAM_4'];
  const r = M.start({ ids, secPerQ: 90, now: 0 });
  const ci = id => byId[id].ci;
  const sel = {};                                           // 4 right, 3 wrong, 3 skipped
  [0, 3, 6, 9].forEach(k => { sel[k] = ci(ids[k]); });      // right: ALP_1, BET_1, GAM_1, GAM_4
  [1, 4, 7].forEach(k => { sel[k] = (ci(ids[k]) + 1) % 5; }); // wrong: ALP_2, BET_2, GAM_2
  r.sel = sel;                                              // skipped: ALP_3, BET_3, GAM_3
  r.flag = { 0: 1, 1: 1, 2: 1 };                            // a right, a wrong, a skipped one flagged
  r.ms = { 0: 40000, 1: 90000, 2: 90000, 3: 10000, 4: 20000, 5: 0, 6: 5000, 7: 7000, 8: 3000, 9: 70000 };
  r.elapsedMs = 330000; r.expired = false;
  const g = M.grade(r, lookup);
  ok('4 right, 3 wrong, 3 skipped, of 10', g.correct === 4 && g.wrong === 3 && g.skipped === 3 && g.n === 10 && g.answered === 7, JSON.stringify([g.correct, g.wrong, g.skipped]));
  ok('the score counts what was left blank as wrong: 4 of 10 is 40%, not 4 of 7', g.pct === 40 && g.pctAnswered === 57, g.pct + '/' + g.pctAnswered);
  ok('and a blank is one line in the report (skipped), not two (not also wrong)', g.wrong + g.skipped === 6 && g.correct + g.wrong + g.skipped === g.n);
  ok('flagged: three, and the two not right are the ones it calls flagged-and-not-right', g.flagged === 3 && g.flaggedWrong === 2);
  const by = Object.fromEntries(g.byCh.map(c => [c.ch, c]));
  ok('by chapter: Alpha 1 of 3, Beta 1 of 3, Gamma 2 of 4', by.Alpha.correct === 1 && by.Alpha.n === 3 && by.Beta.correct === 1 && by.Beta.n === 3 && by.Gamma.correct === 2 && by.Gamma.n === 4, JSON.stringify(g.byCh));
  ok('and the chapter rows account for every question and every right answer', g.byCh.reduce((a, c) => a + c.n, 0) === 10 && g.byCh.reduce((a, c) => a + c.correct, 0) === 4 && g.byCh.every(c => c.correct + c.wrong + c.skipped === c.n));
  ok('each item says what happened, in block order', same(g.items.map(x => x.state), ['correct', 'wrong', 'skipped', 'correct', 'wrong', 'skipped', 'correct', 'wrong', 'skipped', 'correct']) && g.items.every((x, k) => x.id === ids[k] && x.i === k));
  ok('an item holds the choice, the key and the flag', g.items[1].sel === sel[1] && g.items[1].ci === ci('ALP_2') && g.items[1].flagged === true && g.items[2].sel === null && g.items[3].flagged === false);
  ok('the time used and the limit are carried, and the average is the time over the questions', g.usedMs === 330000 && g.limitMs === 900000 && g.avgMs === 33000 && g.expired === false);
  ok('the slowest are the three longest, longest first, with ties by question number', same(g.slowest.map(x => x.i), [1, 2, 9]) && g.slowest[0].ms === 90000, JSON.stringify(g.slowest.map(x => [x.i, x.ms])));
  ok('a question that took no time is not among the slowest', g.slowest.every(x => x.ms > 0) && M.grade(Object.assign({}, r, { ms: {} }), lookup).slowest.length === 0);
  const missed = M.reviewIds(g, 'missed'), all = M.reviewIds(g, 'all');
  ok('the review set is wrong, skipped and flagged, in block order', same(missed, ['ALP_1', 'ALP_2', 'ALP_3', 'BET_2', 'BET_3', 'GAM_2', 'GAM_3']), missed.join());
  ok('"all" is every question in order; anything else is none', same(all, ids) && same(M.reviewIds(g, 'nope'), []) && same(M.reviewIds(null, 'all'), []));
}

head('a question the bank no longer has is not graded, and bad input gives zeros not NaN');
{
  const r = M.start({ ids: ['ALP_1', 'GONE_1'], secPerQ: 0 }); r.sel = { 0: byId.ALP_1.ci, 1: 2 };
  const g = M.grade(r, lookup);
  ok('the answer to a question that is gone is neither right nor wrong', g.correct === 1 && g.wrong === 0 && g.skipped === 1 && g.answered === 1, JSON.stringify([g.correct, g.wrong, g.skipped]));
  ok('and it is filed under "Other", not lost from the chapter rows', g.byCh.reduce((a, c) => a + c.n, 0) === 2 && g.byCh.some(c => c.ch === 'Other'));
  const nameless = M.grade(r, id => ({ ch: '', ci: byId.ALP_1.ci }));
  ok('a question with an empty chapter name is filed under "Other" too, so the block can still be kept', nameless.byCh.every(c => c.ch === 'Other') && M.validEntry(M.summary(nameless, r, 5)) === true, JSON.stringify(nameless.byCh.map(c => c.ch)));
  const finite = z => ['n', 'answered', 'correct', 'wrong', 'skipped', 'flagged', 'flaggedWrong', 'pct', 'usedMs'].every(k => Number.isFinite(z[k]))
    && (z.avgMs === null || Number.isFinite(z.avgMs)) && (z.pctAnswered === null || Number.isFinite(z.pctAnswered));
  ok('grading nothing, junk, or a block with no lookup never throws and gives finite numbers, never NaN', [M.grade(null, lookup), M.grade({}, lookup), M.grade({ ids: [] }, lookup), M.grade({ ids: 'x', sel: 5 }, lookup), M.grade(r), M.grade(r, () => null)].every(finite));
  ok('with no question known, every question is skipped and none is right', (() => { const z = M.grade(r); return z.n === 2 && z.correct === 0 && z.wrong === 0 && z.skipped === 2; })());
  ok('a block of nothing has no percentage rather than 0 of 0', M.grade({ ids: [] }, lookup).pctAnswered === null && M.grade({ ids: [] }, lookup).avgMs === null);
}

head('what is kept of a finished block');
{
  const ids = ['ALP_1', 'ALP_2', 'BET_1', 'BET_2']; const r = M.start({ ids, secPerQ: 60, chapter: null, now: 5 });
  r.sel = { 0: byId.ALP_1.ci, 1: (byId.ALP_2.ci + 1) % 5, 2: byId.BET_1.ci }; r.elapsedMs = 150000;
  const g = M.grade(r, lookup), s = M.summary(g, r, 777);
  ok('the summary is the numbers and the chapters, nothing of the questions', same(Object.keys(s).sort(), ['answered', 'by', 'ch', 'correct', 'limit', 'ms', 'n', 'ts']) && s.n === 4 && s.answered === 3 && s.correct === 2 && s.ms === 150000 && s.limit === 240000 && s.ts === 777 && s.ch === null);
  ok('by chapter it holds right and total', same(s.by, { Alpha: [1, 2], Beta: [1, 2] }), JSON.stringify(s.by));
  ok('and what the module makes, the module accepts', M.validEntry(s) === true);
  const bad = (patch) => M.validEntry(Object.assign({}, s, patch));
  ok('it refuses a time that is not a time', [bad({ ts: 0 }), bad({ ts: NaN }), bad({ ts: '5' }), bad({ ms: -1 }), bad({ ms: NaN })].every(v => v === false));
  ok('it refuses counts that cannot be', [bad({ n: 0 }), bad({ n: 2.5 }), bad({ answered: 5 }), bad({ correct: 4 }), bad({ correct: -1 })].every(v => v === false));
  ok('and more right than answered, even when the chapters agree with the right count', bad({ answered: 1 }) === false && bad({ answered: 2 }) === true);
  ok('it refuses a limit that is not nothing or a positive time, and a chapter that is not a name', [bad({ limit: 0 }), bad({ limit: -3 }), bad({ limit: '60' }), bad({ ch: 7 }), bad({ ch: '' })].every(v => v === false) && bad({ limit: null }) === true && bad({ ch: 'Alpha' }) === true);
  ok('it refuses chapters that do not add up to the block', [bad({ by: { Alpha: [1, 2] } }), bad({ by: { Alpha: [1, 2], Beta: [2, 2] } }), bad({ by: { Alpha: [3, 2], Beta: [0, 2] } }), bad({ by: {} }), bad({ by: null }), bad({ by: [] })].every(v => v === false));
  ok('and chapters that have the right count but not the block\'s size', bad({ by: { Alpha: [1, 2], Beta: [1, 1] } }) === false);
  ok('and a chapter with more right than questions, even when the sums come out', bad({ by: { Alpha: [2, 0], Beta: [0, 4] } }) === false);
  ok('and chapters that are a list, however well the pairs add up', bad({ by: [[1, 2], [1, 2]] }) === false);
  ok('and chapter rows that are not [right, total] pairs', [bad({ by: { Alpha: [1, 2, 3], Beta: [1, 2] } }), bad({ by: { Alpha: 'x', Beta: [1, 2] } }), bad({ by: { '': [1, 2], Beta: [1, 2] } }), bad({ by: { Alpha: [1.5, 2], Beta: [0.5, 2] } })].every(v => v === false));
  ok('it refuses what is not an entry at all', [null, undefined, 5, 'x', [], {}].every(v => M.validEntry(v) === false));
  const list = Array.from({ length: 40 }, (_, k) => Object.assign({}, s, { ts: 1000 + k }));
  const kept = M.cleanHistory(list);
  ok('the history keeps the newest thirty, in order', kept.length === M.HISTORY_CAP && kept[0].ts === 1010 && kept[29].ts === 1039);
  ok('and drops entries that are not sound, keeping the rest in order', same(M.cleanHistory([list[0], { ts: 1 }, null, list[1]]).map(e => e.ts), [1000, 1001]) && same(M.cleanHistory('x'), []) && same(M.cleanHistory(null), []));
  const pushed = M.pushHistory(kept, Object.assign({}, s, { ts: 5000 }));
  ok('adding a block puts it last and keeps the cap', pushed.length === M.HISTORY_CAP && pushed[29].ts === 5000 && pushed[0].ts === 1011);
  const lastTs = a => a.length ? (a[a.length - 1] || {}).ts : undefined;
  ok('adding something that is not a block adds nothing', M.pushHistory(kept, { ts: 1 }).length === 30 && lastTs(M.pushHistory(kept, null)) === 1039 && lastTs(M.pushHistory(kept, { ts: 1 })) === 1039 && M.pushHistory(null, s).length === 1);
  ok('the original list is not changed by adding to it', kept.length === M.HISTORY_CAP && kept[29].ts === 1039);
  {
    /* A bank can name a chapter anything. The history refuses a name over 120 characters, and a block it refuses is a
       block that was counted into the progress record and is nowhere in the history. */
    const long = 'Chapter '.repeat(40);
    const rl = M.start({ ids: ['ALP_1', 'BET_1'], secPerQ: 60, chapter: null, now: 5 });
    rl.sel = { 0: byId.ALP_1.ci }; rl.elapsedMs = 90000;
    const gl = M.grade(rl, id => ({ ch: long, ci: byId[id].ci })), sl = M.summary(gl, rl, 888);
    ok('a chapter name longer than the history allows is cut to 120 in the report', gl.byCh.length === 1 && gl.byCh[0].ch === long.slice(0, 120) && gl.items.every(x => x.ch.length === 120), String(gl.byCh[0] && gl.byCh[0].ch.length));
    ok('so the block still reaches the history, with its chapter', M.validEntry(sl) === true && M.pushHistory([], sl).length === 1 && same(sl.by, { [long.slice(0, 120)]: [1, 2] }), JSON.stringify(Object.keys(sl.by).map(k => k.length)));
  }
}

head('surviving a closed page');
{
  const ids = ['ALP_1', 'ALP_2', 'BET_1', 'GAM_1', 'GAM_2'];
  const r = M.start({ ids, secPerQ: 90, chapter: 'Alpha', now: 4242 });
  M.tick(r, 0, true); M.select(r, 2, 5); M.tick(r, 4000, true); M.go(r, 3); M.select(r, 4, 5); M.toggleFlag(r); M.tick(r, 9000, true); M.go(r, 1);
  const env = { has: id => !!byId[id], nOpts: () => 5 };
  const text = JSON.stringify(M.serialize(r));
  const back = M.restore(JSON.parse(text), env);
  ok('what was serialised comes back: the choices, flags, times, place and clock', back && same(back.ids, r.ids) && same(back.sel, r.sel) && same(back.flag, r.flag) && same(back.ms, r.ms) && back.i === 1 && back.far === 3 && back.elapsedMs === 9000 && back.secPerQ === 90 && back.chapter === 'Alpha' && back.startedAt === 4242, JSON.stringify(back && [back.i, back.far, back.elapsedMs]));
  ok('it comes back with the clock stopped: the first tick counts nothing, not the time it was closed', back.last === null && (M.tick(back, 5e9, true), back.elapsedMs === 9000));
  ok('and not paused, not done', back.paused === false && back.done === false);
  ok('what is stored holds nothing it should not: no clock reading, no grade', !('last' in M.serialize(r)) && !('score' in M.serialize(r)) && M.serialize(null) === null);
  const live = M.start({ ids, now: 1 }); live.paused = true; live.done = false;
  ok('a pause is not remembered across a close', M.restore(M.serialize(live), env).paused === false);
}

head('the block last handed in comes back whole, so its report can be shown again');
{
  const ids = ['ALP_1', 'ALP_2', 'BET_1', 'GAM_1'];
  const env = { has: id => !!byId[id], nOpts: () => 5 };
  const r = M.start({ ids, secPerQ: 60, now: 9000 });
  M.tick(r, 0, true); M.select(r, byId.ALP_1.ci, 5); M.tick(r, 8000, true); M.go(r, 2); M.select(r, (byId.BET_1.ci + 1) % 5, 5); M.toggleFlag(r); M.tick(r, 14000, true);
  M.finish(r, 15000, true);
  const before = M.grade(r, lookup);
  const back = M.restoreDone(JSON.parse(JSON.stringify(M.serialize(r))), env), bk = back || {};
  ok('a finished block restores as finished, with when and how it ended', back && back.done === true && back.submittedAt === 15000 && back.expired === true && back.startedAt === 9000, JSON.stringify(back && [back.done, back.submittedAt, back.expired]));
  ok('and it grades to exactly what it graded to before the page closed', same(M.grade(back, lookup), before));
  ok('a block that is still going is not a handed-in block, and a handed-in one is not a block still going', M.restoreDone(M.serialize(M.start({ ids, now: 1 })), env) === null && M.restore(M.serialize(r), env) === null);
  ok('the block handed in is read even though it is the one the store remembers as last', M.restoreDone(M.serialize(r), Object.assign({ lastStartedAt: 9000 }, env)) !== null);
  ok('it follows the same rules as a block in progress: a question the bank lost, or ids that are not names, make it nothing', M.restoreDone(M.serialize(r), { has: id => id !== 'BET_1', nOpts: () => 5 }) === null && M.restoreDone(Object.assign(M.serialize(r), { ids: [1, 2] }), { has: () => true, nOpts: () => 5 }) === null);
  const bad = M.restoreDone(Object.assign(M.serialize(r), { submittedAt: 'x', expired: 'yes' }), env);
  ok('a hand-in time that is not a time is none, and "expired" is only ever true or false', !!bad && bad.submittedAt === null && bad.expired === false);
  ok('and what comes back is not running: no clock reading, not paused', bk.last === null && bk.paused === false);
}

head('a stored block that cannot be trusted is no block');
{
  const ids = ['ALP_1', 'ALP_2', 'BET_1'];
  const good = () => JSON.parse(JSON.stringify(M.serialize(Object.assign(M.start({ ids, secPerQ: 60, now: 77 }), { sel: { 0: 1 } }))));
  const env = { has: id => !!byId[id], nOpts: () => 5 };
  const R = (patch, e) => M.restore(Object.assign(good(), patch), e || env);
  ok('a sound record restores', R({}) !== null);
  ok('another version is not read', R({ v: 2 }) === null && R({ v: undefined }) === null);
  ok('a finished block is not carried on', R({ done: true }) === null);
  ok('no questions, or something other than a list of names, is no block', [R({ ids: [] }), R({ ids: 'ALP_1' }), R({ ids: [1, 2] }), R({ ids: null }), R({ ids: {} })].every(v => v === null));
  ok('names that are not strings are no block, even where the bank would know any name', R({ ids: [1, 2] }, { has: () => true, nOpts: () => 5 }) === null && R({ ids: ['ALP_1', 2] }, { has: () => true, nOpts: () => 5 }) === null);
  ok('the same question twice is no block', R({ ids: ['ALP_1', 'ALP_1'] }) === null);
  ok('a question the bank no longer has makes it no block, since it could not be graded', R({ ids: ['ALP_1', 'GONE'] }) === null);
  ok('more questions than a block can have is no block', R({ ids: Array.from({ length: 501 }, (_, k) => 'Q' + k) }, { has: () => true, nOpts: () => 5 }) === null);
  ok('the block already handed in is not carried on (a page closed between handing in and clearing)', R({}, Object.assign({ lastStartedAt: 77 }, env)) === null && R({}, Object.assign({ lastStartedAt: 78 }, env)) !== null);
  ok('junk in place of a record is null and does not throw', [null, undefined, 5, 'x', [], {}, true].every(v => M.restore(v, env) === null));
}

head('a stored block with something wrong in it keeps the rest');
{
  const ids = ['ALP_1', 'ALP_2', 'BET_1', 'BET_2'];
  const env = { has: id => !!byId[id], nOpts: () => 4 };
  const base = () => JSON.parse(JSON.stringify(M.serialize(Object.assign(M.start({ ids, secPerQ: 90, now: 5 }), { i: 2, far: 3, sel: { 0: 1, 1: 3 }, flag: { 2: 1 }, ms: { 0: 1000, 1: 2000 }, elapsedMs: 3500 }))));
  const R = patch => M.restore(Object.assign(base(), patch), env);
  const a = R({ sel: { 0: 1, 1: 4, 2: -1, 3: 'b' } });
  ok('a choice past the options, below zero, or not a number is dropped, and the sound one beside it kept', same(a.sel, { 0: 1 }), JSON.stringify(a.sel));
  const k = R({ sel: { 0: 1, 9: 1, x: 1, '1.5': 2, '-1': 1, '': 2, ' 1 ': 2, '0x1': 2, '1e0': 2 } });
  ok('a choice on a question that is not there, or under a key that is not a question number as the app writes one, is dropped', same(k.sel, { 0: 1 }), JSON.stringify(k.sel));
  const f = R({ flag: { 0: 1, 1: 2, 2: true, 3: 1, 7: 1 } });
  ok('a flag is kept only as 1, on a question that is there', same(f.flag, { 0: 1, 3: 1 }), JSON.stringify(f.flag));
  const m = R({ ms: { 0: 1000, 1: -5, 2: 'x', 3: 1e12, 4: 100 } });
  ok('a time that is negative, not a number, or an hour and more is dropped', same(m.ms, { 0: 1000 }), JSON.stringify(m.ms));
  ok('a place off the end becomes the start, and the furthest reached is never behind the place', R({ i: 99 }).i === 0 && R({ i: -1 }).i === 0 && R({ i: 1.5 }).i === 0 && R({ i: 2, far: 1 }).far === 2 && R({ i: 1, far: 99 }).far === 1);
  ok('a clock reading that is not a time falls back to the sum of the times on the questions', R({ elapsedMs: NaN }).elapsedMs === 3000 && R({ elapsedMs: -9 }).elapsedMs === 3000 && R({ elapsedMs: 'x' }).elapsedMs === 3000 && R({ elapsedMs: 3500 }).elapsedMs === 3500);
  ok('a pace that is not one becomes ninety, and no limit stays no limit', R({ secPerQ: 'x' }).secPerQ === 90 && R({ secPerQ: 1e6 }).secPerQ === 90 && R({ secPerQ: 0 }).secPerQ === 0);
  ok('a chapter that is not a name is none', R({ chapter: 5 }).chapter === null && R({ chapter: 'Beta' }).chapter === 'Beta');
  const p = R({ sel: JSON.parse('{"__proto__":{"polluted":1},"0":2}') });
  ok('a key like __proto__ is ignored and pollutes nothing', same(p.sel, { 0: 2 }) && ({}).polluted === undefined && !Object.prototype.hasOwnProperty.call(p.sel, '__proto__'));
  const junked = R({ elapsedMs: NaN, i: NaN, far: NaN, secPerQ: NaN, startedAt: 'x' });
  ok('whatever was junk, every number that comes back is a number', ['i', 'far', 'secPerQ', 'startedAt', 'elapsedMs'].every(f => Number.isFinite(junked[f])), JSON.stringify(junked));
  const w = R({ startedAt: 'x' });
  ok('a start time that is not a time is zero', w.startedAt === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
