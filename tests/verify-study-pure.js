#!/usr/bin/env node
/*
 * The Study screen — src/app/study.js.
 *
 *   node tests/verify-study-pure.js
 *
 * Pure Node, over an invented bank. The module is given the page's state, two tables of chapters and a kit,
 * and returns markup; nothing in the first seven parts has a page. The kit there is stand-ins that answer
 * with what this file decides (masteryFor() says 0.25 of Rhythm, dueQuestions() gives three, ...) and helpers
 * that say what they were asked (e('x') is "E(x)"), so what the screen is expected to say is worked out here
 * and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - arc(): the fraction clamped to 0..1, as a percentage of a dash, and said as data;
 *   - examLeftText(): what the exam tile says, by the days left on the reader's calendar;
 *   - the chapter rings and tiles: one each, in order, as full as mastered, starting that chapter;
 *   - the review card in its three states, and the streak;
 *   - the plan card: the two rings, the pace, the three plans, the exam date and the days left;
 *   - the topic runs, missed, flagged and annotated cards, each only when there is something to show;
 *   - that it reads five names of the state and the names of the kit it is given, and changes nothing;
 *   - the page's lines: the runs worked out first into _runsShown, the kit, the actions its markup names (no
 *     inline handler, each in the page's table for its event as written), the page's own line over the real
 *     src/core modules and the page's own helpers on a bank made here, and every control it drew tapped and
 *     chosen from through the real src/core/actions.js.
 *
 * A day is built from the reader's own calendar (new Date(y, m, d)) and stepped with setDate, never by a count
 * of milliseconds; CI's logic job runs the pure suites a second time in New York.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/study.js').StudyScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const run = f => { try { return String(f()); } catch (err) { return 'THREW ' + err.message; } };
const g1 = (s, re) => (s.match(re) || [])[1];
const times = (html, text) => html.split(text).length - 1;

/* A bank of two chapters: Rhythm has three questions (one with a figure), Valves two. */
const CHAPTERS = Object.freeze(['Rhythm', 'Valves']);
const COLORS = Object.freeze({ Rhythm: '#112233' });
const POOL = Object.freeze([{ id: 'r1', ch: 'Rhythm', img: 1 }, { id: 'r2', ch: 'Rhythm', img: 0 }, { id: 'r3', ch: 'Rhythm', img: 0 }, { id: 'v1', ch: 'Valves', img: 0 }, { id: 'v2', ch: 'Valves', img: 0 }].map(Object.freeze));
const READY = { status: 'on-track', total: 10, seen: 4, retention: 0.8, text: 'You are on track.' };
function kitOf(over, asked) {
  const say = (name, v) => (...a) => { if (asked) asked.push([name].concat(a)); return typeof v === 'function' ? v(...a) : v; };
  return Object.assign({
    CH_SHORT: { Rhythm: 'Rh' }, CH_ICONS: { Rhythm: 'zap' }, POOL, TOTAL_Q: 5, NOTES: {}, INK: {}, QBYID: {}, _flagArm: false, _runsShown: [],
    dueQuestions: say('dueQuestions', [1, 2, 3]), startedCount: say('startedCount', 4), masteryFor: say('masteryFor', ch => (ch === 'Rhythm' ? 0.25 : 0)),
    planNow: say('planNow', { text: 'Ten minutes on "what" & is due' }), recentPerDay: say('recentPerDay', 12), examDaysLeft: say('examDaysLeft', null), flaggedQs: say('flaggedQs', []),
    todayISO: () => '2026-11-15', FSRS: { daysBetween: (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) },
    StudyPlan: { readiness: say('readiness', () => Object.assign({}, READY)) },
    FlagSet: { annotated: say('annotated', []), phrase: n => 'PHRASE(' + n + ')' },
    chIcon: ch => '[ch ' + ch + ']', chInk: c => 'INK(' + c + ')', e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
  }, over);
}
const state = over => Object.assign({ chStats: { Rhythm: { correct: 3, total: 4 } }, examDate: null, missed: new Set(), reviewStreak: 0, srs: {} }, over);
const draw = (over, sOver, asked) => run(() => M.screenHtml(state(sOver), CHAPTERS, COLORS, kitOf(over, asked)));
const card = (html, cls) => { const a = html.indexOf('feed-card ' + cls); if (a < 0) return ''; const b = html.indexOf('feed-card ', a + 10); return html.slice(a, b < 0 ? undefined : b); };
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);

head('arc(): a fraction of a circle');
{
  const frac = f => g1(M.arc('c', 60, 60, 52, f), /data-frac="([^"]*)"/), dash = f => g1(M.arc('c', 60, 60, 52, f), /stroke-dasharray="([^"]*)"/);
  ok('the fraction is a percentage of the dash, to a tenth, and said as data to four places', dash(0.4567) === '45.7 100' && frac(0.4567) === '0.4567', dash(0.4567) + ' · ' + frac(0.4567));
  ok('below nought is nought, above one is one, and what is not a number is nought', frac(-1) === '0.0000' && frac(3) === '1.0000' && frac('x') === '0.0000' && frac(undefined) === '0.0000', [frac(-1), frac(3), frac('x')].join(' '));
  ok('it is a circle of that class, centre and radius, started at the top', M.arc('pg-seen', 12, 13, 9, 0.5) === '<circle class="pg-seen" cx="12" cy="13" r="9" pathLength="100" stroke-dasharray="50.0 100" data-frac="0.5000" transform="rotate(-90 12 13)"/>', M.arc('pg-seen', 12, 13, 9, 0.5));
}

head('examLeftText(): the days to the exam, on the reader\'s calendar');
{
  const day = n => { const d = new Date(2026, 10, 15); d.setDate(d.getDate() + n); const p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const real = { FSRS: require('../src/core/fsrs.js').FSRS || globalThis.FSRS, todayISO: () => day(0) };
  const say = date => run(() => M.examLeftText({ examDate: date }, real));
  ok('no date says nothing', say(null) === '' && say('') === '', J(say(null)));
  ok('today, tomorrow, and a number of days', say(day(0)) === 'Your exam is today' && say(day(1)) === 'Your exam is tomorrow' && say(day(2)) === '2 days to your exam' && say(day(140)) === '140 days to your exam', [say(day(0)), say(day(1)), say(day(140))].join(' · '));
  ok('a day gone says the date has passed', say(day(-1)) === 'Your exam date has passed', say(day(-1)));
  /* Across the spring change in New York, 8 March 2026: a day short of 24 hours is still a day. */
  const spring = { FSRS: real.FSRS, todayISO: () => '2026-03-07' };
  ok('a week that holds a change of the clocks is still seven days', run(() => M.examLeftText({ examDate: '2026-03-14' }, spring)) === '7 days to your exam', run(() => M.examLeftText({ examDate: '2026-03-14' }, spring)));
}

head('the chapters: a ring and a tile each');
{
  const html = draw();
  const rings = [...html.matchAll(/<button class="story" data-action="startChapter" data-ch="([^"]*)"\s+style="--accent:([^"]*)" aria-label="([^"]*)">/g)].map(m => m.slice(1));
  ok('a ring for each chapter, in order, each starting that chapter, named through e(), named with how much is mastered',
     J(rings) === J([['E(Rhythm)', '#112233', 'E(Rhythm), 25 percent mastered'], ['E(Valves)', 'var(--teal)', 'E(Valves), 0 percent mastered']]), J(rings));
  const C = 2 * Math.PI * 27, offs = [...html.matchAll(/stroke-dasharray="([^"]*)" stroke-dashoffset="([^"]*)"/g)].map(m => [+m[1], +m[2]]);
  ok('each ring is drawn as full as the chapter is mastered', offs.length === 2 && Math.abs(offs[0][0] - C) < 1e-9 && Math.abs(offs[0][1] - C * 0.75) < 1e-9 && Math.abs(offs[1][1] - C) < 1e-9, J(offs));
  const labels = [...html.matchAll(/<span class="story-lbl">([^<]*)<\/span>/g)].map(m => m[1]);
  const third = draw({ masteryFor: () => 1 / 3 });
  ok('the percent mastered is rounded: a third is 33', third.includes('aria-label="E(Rhythm), 33 percent mastered"') && third.includes('data-w="33"'), g1(third, /aria-label="(E\(Rhythm\)[^"]*)"/));
  ok('a ring is labelled by the chapter\'s short name, or its first word, through e()', J(labels) === J(['E(Rh)', 'E(Valves)']), J(labels));
  const tiles = html.split('<button class="ch-tile"').slice(1).map(t => ({ go: g1(t, /^ data-action="startChapter" data-ch="([^"]*)"/), style: g1(t, /style="([^"]*)"/), name: g1(t, /class="ct-name">([^<]*)</), meta: g1(t, /class="ct-meta">([^<]*)</), w: g1(t, /data-w="([^"]*)"/), foot: g1(t, /class="ct-foot">([\s\S]*?)<\/span>/) }));
  ok('a tile for each chapter, starting it by its name through e(), its accent the chapter\'s colour or a lighter teal, its ink chInk()\'s',
     J(tiles.map(t => [t.go, t.style])) === J([['E(Rhythm)', '--accent:#112233;--ch-ink:INK(#112233)'], ['E(Valves)', '--accent:#5EEAD4;--ch-ink:INK(#5EEAD4)']]), J(tiles.map(t => t.style)));
  ok('it says how many questions and figures the chapter has', (tiles[0] || {}).meta === '3 Q · 1 figures' && (tiles[1] || {}).meta === '2 Q', J(tiles.map(t => t.meta)));
  ok('how many were right, or that it is begun or not, and how much is mastered', (tiles[0] || {}).foot === '75% correct<b>25%</b>' && (tiles[0] || {}).w === '25' && (tiles[1] || {}).foot === 'not started<b>0%</b>', J(tiles.map(t => t.foot)));
  const oneTile = draw({}, { chStats: { Rhythm: { correct: 1, total: 1 } } }).split('<button class="ch-tile"')[1] || '';
  ok('one answer, right, is "100% correct"', g1(oneTile, /class="ct-foot">([\s\S]*?)<\/span>/) === '100% correct<b>25%</b>', g1(oneTile, /class="ct-foot">([\s\S]*?)<\/span>/));
  const begun = draw({ masteryFor: () => 0.1 }, { chStats: {} }).split('<button class="ch-tile"')[2] || '';
  ok('a chapter with no answers but some mastery is "in progress"', g1(begun, /class="ct-foot">([\s\S]*?)<\/span>/) === 'in progress<b>10%</b>', g1(begun, /class="ct-foot">([\s\S]*?)<\/span>/));
}

head('the review queue');
{
  const rc = over => card(draw(over), 'review-card');
  const due = rc(), done = rc({ dueQuestions: () => [] }), fresh = rc({ dueQuestions: () => [], startedCount: () => 0 });
  ok('with cards due: live, "DUE NOW", how many, and "Review now"', due.startsWith('feed-card review-card live"') && due.includes('DUE NOW') && due.includes('3 cards ready') && due.includes('Review now'), due.slice(0, 60));
  ok('one card is "1 card ready"', rc({ dueQuestions: () => [1] }).includes('1 card ready'));
  ok('none due and some seen: "All caught up", "Begin"; none seen: "Start your review queue"', done.includes('All caught up') && done.includes('Begin') && !done.includes(' live') && fresh.includes('Start your review queue'), done.slice(0, 40));
  ok('it starts the review queue, by the startDue action', draw().includes('<button class="feed-card review-card live" data-action="startDue">'));
  ok('a streak is shown in days, and none when there is none', card(draw({}, { reviewStreak: 7 }), 'review-card').includes('<span class="fc-streak">7d [icon flame icon-sm]</span>') && !due.includes('fc-streak'));
}

head('the study plan');
{
  const asked = [], html = draw({}, { examDate: '2026-12-01' }, asked), pc = card(html, 'plan-card');
  const rd = asked.filter(a => a[0] === 'readiness');
  ok('readiness is asked once, of the bank, the cards, the chapters, the pace and the exam date', rd.length === 1 && rd[0][1].pool === POOL && rd[0][1].recentPerDay === 12 && rd[0][1].examDate === '2026-12-01' && 'srs' in rd[0][1] && 'chStats' in rd[0][1], J(rd.map(a => Object.keys(a[1]))));
  ok('the outer ring is how much of the bank was seen, the inner how much of it is remembered', g1(pc, /class="pg-seen"[^>]*data-frac="([^"]*)"/) === '0.4000' && g1(pc, /class="pg-recall"[^>]*data-frac="([^"]*)"/) === '0.8000');
  ok('the middle says the recall, and the gauge says both to a screen reader', g1(pc, /class="pg-mid"><b>([^<]*)<\/b><span>([^<]*)/) === '80%' && pc.includes('aria-label="Seen 40% of the bank, remembering about 80% of it today"'));
  const noRecall = card(draw({ StudyPlan: { readiness: () => Object.assign({}, READY, { retention: null }) } }), 'plan-card');
  const empty = card(draw({ StudyPlan: { readiness: () => Object.assign({}, READY, { total: 0, seen: 0, retention: null }) } }), 'plan-card');
  ok('with an empty bank nothing is seen, not all of it', g1(empty, /class="pg-seen"[^>]*data-frac="([^"]*)"/) === '0.0000' && g1(empty, /class="pg-mid"><b>([^<]*)<\/b>/) === '0%', g1(empty, /class="pg-mid"><b>([^<]*)<\/b>/));
  ok('with nothing remembered yet it says how much was seen instead', g1(noRecall, /class="pg-mid"><b>([^<]*)<\/b>/) === '40%' && noRecall.includes('<span>seen</span>') && noRecall.includes('aria-label="Seen 40% of the bank"') && !noRecall.includes('lg-recall'));
  const pace = s => g1(card(draw({ StudyPlan: { readiness: () => Object.assign({}, READY, { status: s }) } }), 'plan-card'), /(<span class="pace-pill[^>]*>[^<]*)/);
  ok('the pace: ahead, on track, behind, and none without data or an exam date', pace('ahead') === '<span class="pace-pill good" id="pacePill" data-status="ahead">Ahead' && pace('on-track').includes('ok') && pace('behind') === '<span class="pace-pill warn" id="pacePill" data-status="behind">Behind' && pace('no-data') === undefined && pace('no-exam') === undefined, [pace('ahead'), pace('behind')].join(' · '));
  ok('the plan for twenty minutes is said, through e()', g1(pc, /id="planSub">([^<]*)</) === 'E(Ten minutes on "what" & is due)' && asked.some(a => a[0] === 'planNow' && a[1] === 20));
  ok('readiness is said, through e(), and not when there is no data', g1(pc, /id="planReady">([^<]*)</) === 'E(You are on track.)' && !card(draw({ StudyPlan: { readiness: () => Object.assign({}, READY, { status: 'no-data' }) } }), 'plan-card').includes('planReady'));
  const chips = [...pc.matchAll(/data-plan="(\d+)" data-action="startPlan" aria-label="(\d+) minutes"[\s\S]*?data-frac="([^"]*)"/g)].map(m => m.slice(1));
  ok('three plans, of 10, 20 and 40 minutes, each the startPlan action with its minutes in data-plan, a ring as long as its share of 40', J(chips) === J([['10', '10', '0.2500'], ['20', '20', '0.5000'], ['40', '40', '1.0000']]), J(chips));
}

head('the exam date');
{
  const tile = (days, date) => card(draw({ examDaysLeft: () => days }, { examDate: date }), 'plan-card');
  const set = tile(12, '2026-11-27'), one = tile(1, '2026-11-16'), past = tile(-2, '2026-11-13'), none = tile(null, null);
  ok('the date box holds the date and is the setExamDate action', set.includes('<input type="date" id="examDate" value="2026-11-27" data-action="setExamDate">') && none.includes('<input type="date" id="examDate" value="" data-action="setExamDate">'));
  ok('with a date, a way to clear it', set.includes('<button class="exam-x" id="examClear" data-action="clearExamDate" aria-label="Clear the exam date" title="Clear">[icon x]</button>') && !none.includes('examClear'));
  ok('days ahead: the tile is set and counts them, "day" for one', set.includes('exam-tile set"') && set.includes('<b id="examDays">12</b><span>days</span>') && one.includes('<b id="examDays">1</b><span>day</span>'));
  ok('a date passed, or none: no count, and the tile is not set', !past.includes('examDays') && !past.includes('exam-tile set') && !none.includes('examDays'), past.slice(past.indexOf('exam-tile'), past.indexOf('exam-tile') + 20));
  ok('the words under the box are examLeftText()\'s, through e()', g1(tile(12, '2026-11-27'), /id="examLeft">([^<]*)</) === 'E(12 days to your exam)' && g1(none, /id="examLeft">([^<]*)</) === 'E()', g1(set, /id="examLeft">([^<]*)</));
}

head('topic runs, missed, flagged and annotated: only when there is something');
{
  const runs = [{ ch: 'Rhythm', shared: ['amiodarone', 'qt', 'torsade', 'extra'], ids: ['r1', 'r2', 'r3'] }, { ch: 'Odd <b>', shared: [], ids: ['x', 'y', 'z', 'w'] }];
  const rc = card(draw({ _runsShown: runs }), 'run-card');
  const btns = [...rc.matchAll(/<button class="run-btn" data-run="(\d+)" data-ch="([^"]*)" style="--ch:([^"]*)" data-action="startRun">/g)].map(m => m.slice(1));
  ok('a button for each run the page worked out, in order, each the startRun action with its own number in data-run', J(btns) === J([['0', 'E(Rhythm)', '#112233'], ['1', 'E(Odd <b>)', 'var(--teal)']]), J(btns));
  ok('it names the chapter short, and three of the words they share, through e()', rc.includes('<b>E(Rh)</b><span class="run-w"> — E(amiodarone · qt · torsade)</span>') && rc.includes('<b>E(Odd <b>)</b></span>'), g1(rc, /<span class="run-t">([\s\S]*?)<\/span>\s*<span class="run-side">/));
  ok('and a pip and the count for each question', times(rc, '<i></i>') === 7 && rc.includes('<span class="run-n">3 questions</span>') && rc.includes('<span class="run-n">4 questions</span>'));
  ok('with no runs there is no card', !draw().includes('run-card'));
  const miss = card(draw({}, { missed: new Set(['a', 'b']) }), 'miss-card');
  ok('missed: how many to reclaim, drilling them; none, no card', miss.startsWith('feed-card miss-card" data-action="retryMissed">') && miss.includes('2 to reclaim') && !draw().includes('miss-card'), miss.slice(0, 60));
  const fl = card(draw({ flaggedQs: () => [1, 2] }), 'flag-card'), armed = card(draw({ flaggedQs: () => [1, 2], _flagArm: true }), 'flag-card');
  ok('flagged: FlagSet\'s phrase, through e(), going through them by startFlagged', g1(fl, /id="flagCount">([^<]*)</) === 'E(PHRASE(2))' && fl.includes('<button class="flag-go" id="flagGo" type="button" data-action="startFlagged">') && !draw().includes('flag-card'));
  ok('"Clear all flags", and once tapped, "Tap again to clear all 2"', fl.includes('<button class="flag-quiet" id="flagClear" type="button" data-action="clearFlags">Clear all flags</button>') && armed.includes('<button class="flag-quiet arm" id="flagClear" type="button" data-action="clearFlags">Tap again to clear all 2</button>'));
  const asked = [], an = card(draw({ FlagSet: { annotated: (...a) => { asked.push(a); return [1, 2, 3]; }, phrase: String } }), 'anno-card'), one = card(draw({ FlagSet: { annotated: () => [1], phrase: String } }), 'anno-card');
  ok('annotated: FlagSet is asked of the notes, the ink and the bank; how many, opening them', an.includes('3 questions you wrote on') && one.includes('1 question you wrote on') && an.startsWith('feed-card anno-card" id="annoCard" type="button" data-action="goAnnotations">') && asked.length === 1 && asked[0].length === 3 && !draw().includes('anno-card'));
  const all = card(draw(), 'all-card');
  ok('shuffle the whole bank, by startAll, saying how many', all.startsWith('feed-card all-card" data-action="startAll">') && all.includes('Shuffle all 5'));
  ok('the head goes home, and says how many questions and chapters', draw().includes('<button class="study-back" data-action="goHome">[icon arrow-left icon-sm] Home</button>') && draw().includes('<p>5 questions across 2 chapters'));
  const order = ['review-card', 'plan-card', 'run-card', 'miss-card', 'flag-card', 'anno-card', 'all-card'].map(c => draw({ _runsShown: runs, flaggedQs: () => [1], FlagSet: { annotated: () => [1], phrase: String } }, { missed: new Set(['a']) }).indexOf('feed-card ' + c));
  ok('the cards come in one order', order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), J(order));
}

head('it reads what it is given, and changes nothing');
const KIT_READS = new Set(), S_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const S = state({ examDate: '2026-12-01', reviewStreak: 3, missed: new Set(['a']), screen: 'study', flagged: new Set(), practice: {} });
  const kit = kitOf({ _runsShown: [{ ch: 'Rhythm', shared: ['x'], ids: ['r1', 'r2', 'r3'] }], flaggedQs: () => [1], FlagSet: { annotated: () => [1], phrase: String } });
  const html = run(() => M.screenHtml(watched(S, S_READS, 'S'), CHAPTERS, COLORS, watched(kit, KIT_READS, 'kit')));
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads chStats, examDate, missed, reviewStreak and srs', !html.startsWith('THREW') && names(S_READS) === 'chStats examDate missed reviewStreak srs', names(S_READS));
  ok('of the kit, the names below and nothing else', names(KIT_READS) === 'CH_ICONS CH_SHORT FSRS FlagSet INK NOTES POOL QBYID StudyPlan TOTAL_Q _flagArm _runsShown chIcon chInk dueQuestions e examDaysLeft flaggedQs icon masteryFor planNow recentPerDay startedCount todayISO', names(KIT_READS));
  ok('it sets, deletes and defines nothing on either', !html.startsWith('THREW') && wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object' && !(o instanceof Set)) { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  /* Two runs, the longer first: a module that put them in order where they stood would move them. */
  const twoRuns = () => [{ ch: 'Rhythm', shared: ['x'], ids: ['r1', 'r2', 'r3', 'r4'] }, { ch: 'Valves', shared: ['y'], ids: ['v1', 'v2', 'v3'] }];
  const frozen = run(() => M.screenHtml(deep(state({ examDate: '2026-12-01' })), CHAPTERS, COLORS, deep(kitOf({ _runsShown: twoRuns() }))));
  const given = twoRuns(), loose = run(() => M.screenHtml(state({ examDate: '2026-12-01' }), CHAPTERS, COLORS, kitOf({ _runsShown: given })));
  ok('given the state, the bank, the runs and the kit frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && frozen.includes('run-card'), frozen.slice(0, 80));
  ok('and the runs it was given are as they were, in the order given', J(given) === J(twoRuns()));
}

head('the page works the runs out, hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/study.js]@@';
  const LINE = 'function buildStudy(){\n  _runsShown=topicRunsNow();\n  return StudyScreen.screenHtml(S,CHAPTERS,CH_COLORS,{CH_SHORT,CH_ICONS,POOL,TOTAL_Q,NOTES,INK,QBYID,_flagArm,_runsShown,\n    dueQuestions,startedCount,masteryFor,planNow,recentPerDay,examDaysLeft,flaggedQs,todayISO,StudyPlan,FlagSet,FSRS,chIcon,chInk,e,icon});\n}';
  ok('buildStudy() works out the topic runs into _runsShown, then asks the module once', count(LINE) === 1 && count('function buildStudy(') === 1, `${count(LINE)} such function(s)`);
  ok('the module is written into the page once, above it', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT), `${count(SLOT)} slot(s)`);
  const handed = String(g1(page, /StudyScreen\.screenHtml\(S,CHAPTERS,CH_COLORS,\{([^}]*)\}\);/)).replace(/\s+/g, '');
  ok('the kit is the names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 24 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('startRun() reads the runs from _runsShown, where the page put them', count('function startRun(i){\n  const r=_runsShown[i];') === 1);
  ok('arc() and examLeftText() are no longer the page\'s', count('function arc(') === 0 && count('function examLeftText(') === 0 && !/[^.\w$]arc\(/.test(page) && !/[^.\w$]examLeftText\(/.test(page));
  const WORDS = ['SPACED REPETITION', 'Same topic, back to back', 'to reclaim', 'Tap again to clear all', 'you wrote on', 'Shuffle all', 'Your exam is tomorrow', 'data-frac="${f.toFixed(4)}"'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = draw({ _runsShown: [{ ch: 'Rhythm', shared: [], ids: ['r1', 'r2', 'r3'] }], flaggedQs: () => [1], FlagSet: { annotated: () => [1], phrase: String } }, { missed: new Set(['a']), examDate: '2026-12-01' });
  const actions = [...new Set(actionsOf(all))].sort();
  ok('its markup names twelve actions and carries no inline handler', J(actions) === J(['clearExamDate', 'clearFlags', 'goAnnotations', 'goHome', 'retryMissed', 'setExamDate', 'startAll', 'startChapter', 'startDue', 'startFlagged', 'startPlan', 'startRun']) && inlineOf(all).length === 0,
     actions.join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));
  /* A tap is looked up in ACTIONS and a choice made in CHANGE_ACTIONS: each action is held to the table for its event. */
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const keyed = (t, n) => (tableOf(t).match(new RegExp('(^|\\s)' + n + ':', 'g')) || []).length;
  const ENTRY = { goHome: ['ACTIONS', 'goHome:()=>goHome(),'], retryMissed: ['ACTIONS', "retryMissed:()=>startQuiz(null,'missed'),"], startChapter: ['ACTIONS', 'startChapter:el=>startQuiz(el.dataset.ch),'],
    startDue: ['ACTIONS', "startDue:()=>startQuiz(null,'due'),"], startFlagged: ['ACTIONS', "startFlagged:()=>startQuiz(null,'flagged'),"], startAll: ['ACTIONS', 'startAll:()=>startQuiz(null),'],
    startPlan: ['ACTIONS', 'startPlan:el=>startPlan(Number(el.dataset.plan)),'], startRun: ['ACTIONS', 'startRun:el=>startRun(Number(el.dataset.run)),'], clearExamDate: ['ACTIONS', "clearExamDate:()=>setExamDate(''),"],
    clearFlags: ['ACTIONS', 'clearFlags:()=>clearFlags(),'], goAnnotations: ['ACTIONS', 'goAnnotations:()=>goAnnotations(),'], setExamDate: ['CHANGE_ACTIONS', 'setExamDate:el=>setExamDate(el.value),'] };
  const TABLES = ['ACTIONS', 'INPUT_ACTIONS', 'CHANGE_ACTIONS'];
  ok('each is in the page\'s table for its event once, as written, and in no other: the taps in ACTIONS, the exam date in CHANGE_ACTIONS',
     actions.length === 12 && actions.every(n => ENTRY[n] && TABLES.every(t => keyed(t, n) === (ENTRY[n][0] === t ? 1 : 0)) && tableOf(ENTRY[n][0]).split(ENTRY[n][1]).length === 2),
     actions.map(n => n + ':' + TABLES.map(t => keyed(t, n)).join('/') + (ENTRY[n] && tableOf(ENTRY[n][0]).split(ENTRY[n][1]).length === 2 ? '' : ' (not as written)')).join(' '));
  const CALLS = ['clearFlags', 'goAnnotations', 'goHome', 'setExamDate', 'startPlan', 'startQuiz', 'startRun'];
  ok('they call seven functions the page declares, once each, and the page listens for taps and for choices on the document',
     CALLS.every(n => count('function ' + n + '(') === 1) && count('Actions.install(document,ACTIONS);') === 1 && count("Actions.install(document,CHANGE_ACTIONS,'change');") === 1, CALLS.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  const ids = ['planCard', 'pacePill', 'planGauge', 'planSub', 'planReady', 'examDate', 'examClear', 'examLeft', 'examDays', 'runCard', 'flagCard', 'flagCount', 'flagGo', 'flagClear', 'annoCard'];
  const lookedUp = ids.filter(id => count("'#" + id + "'") + count("getElementById('" + id + "')") > 0);
  ok('every id the page looks up is drawn once', lookedUp.length > 0 && lookedUp.every(id => times(all, 'id="' + id + '"') === 1), lookedUp.map(id => id + ':' + times(all, 'id="' + id + '"')).join(' '));

  /* The page's own lines over the real src/core modules and the page's own helpers, with the clock at one moment. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = [['function icon(name, cls){', '\n}'], ['const ESC={', '\n'], ['const e=s=>', '\n'], ['function chInk(hex){', '\n}'], ['function chIcon(ch,cls){', '\n'], ['function isoLocal(d){', '\n'], ['function todayISO(){', '\n'],
    ['function dueQuestions(){', '\n'], ['function masteryFor(ch){', '\n'], ['function startedCount(){', '\n'], ['function planNow(minutes){', '\n}'], ["let _runsKey='',_runs=[],_runsShown=[];", '\n'], ['function topicRunsNow(){', '\n}'],
    ['function examDaysLeft(){', '\n'], ['function recentPerDay(){', '\n}'], ['const flaggedQs=()=>', '\n']].map(([a, b]) => whole(a, b)).join('\n');
  const NOW = new Date(2026, 10, 15, 9, 0).getTime();
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  /* Three Rhythm questions share two words the other two do not, so the real TopicRun makes one run of them. */
  const stem = (id, ch, s, img) => ({ id, ch, s, o: [{ t: 'x' }], ci: 0, img: img || 0 });
  const pool = [stem('a1', 'Rhythm', 'amiodarone torsade prolongation', 1), stem('a2', 'Rhythm', 'sotalol torsade prolongation'), stem('a3', 'Rhythm', 'dofetilide torsade prolongation'),
    stem('a4', 'Rhythm', 'flutter isthmus ablation'), stem('a5', 'Rhythm', 'pericarditis colchicine recurrence'), stem('v1', 'Valves & more', 'aortic stenosis')];
  const ctx = { Date: FixedDate, CHAPTERS: ['Rhythm', 'Valves & more'], CH_COLORS: { Rhythm: '#6366F1' }, CH_SHORT: { Rhythm: 'Rh' }, CH_ICONS: {}, TOTAL_Q: 6, NOTES: { v1: [{ id: 'n1', text: 'a note' }] }, INK: {}, _flagArm: false, themeIsDark: () => false,
    POOL: pool, QBYID: Object.fromEntries(pool.map(q => [q.id, q])),
    S: { srs: { a1: { stability: 10, difficulty: 5, last: '2026-11-10', due: '2026-11-14', reps: 2, lapses: 0, state: 2 } }, practice: {}, chStats: { Rhythm: { correct: 1, total: 2 } }, daily: {}, missed: new Set(['a2']), flagged: new Set(['v1']), examDate: '2026-11-25', reviewStreak: 0 } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  /* The page's own buildStudy(), as it stands in the page, not this file's copy of it. */
  const own = whole('function buildStudy(){', '\n}');
  const loaded = ask(['fsrs', 'reviewqueue', 'studyplan', 'topicrun', 'flagset', 'progressstats'].map(m => read('src/core/' + m + '.js')).join('\n') + '\n' + parts + '\n' + read('src/app/study.js') + '\n' + own + '\n"loaded"');
  const html = String(ask('buildStudy()'));
  ok('the page\'s own lines draw the screen over the real modules', loaded === 'loaded' && !html.startsWith('THREW') && html.includes('study-wrap'), String(loaded).slice(0, 80) + ' · ' + html.slice(0, 60));
  ok('one card is due (a1, due yesterday), one missed, one flagged and one written on', card(html, 'review-card').includes('1 card ready') && card(html, 'miss-card').includes('1 to reclaim') && g1(html, /id="flagCount">([^<]*)</) === '1 question flagged' && card(html, 'anno-card').includes('1 question you wrote on'), [g1(html, /<div class="fc-title">([^<]*)</), g1(html, /id="flagCount">([^<]*)</)].join(' · '));
  ok('the exam is ten days off on the reader\'s calendar, and the tile says so', g1(html, /id="examDays">([^<]*)</) === '10' && g1(html, /id="examLeft">([^<]*)</) === '10 days to your exam', g1(html, /id="examLeft">([^<]*)</));
  ok('the chapter\'s name is escaped by the page\'s e(), and a chapter with no colour takes the lighter teal on its tile', html.includes('<span class="ct-name">Valves &amp; more</span>') && html.includes('style="--accent:#5EEAD4;'));
  const drawnRuns = [...html.matchAll(/data-run="(\d+)"/g)].map(m => +m[1]);
  ok('the page worked out topic runs into _runsShown, and the screen drew those, one for each',
     ask('_runsShown.length') > 0 && J(drawnRuns) === J(ask('_runsShown.map((r,i)=>i)')) && J([...html.matchAll(/<span class="run-n">(\d+) questions/g)].map(m => +m[1])) === J(ask('_runsShown.map(r=>r.ids.length)')), J(ask('_runsShown.map(r=>r.ids)')));

  /* A tap and a choice, as the page takes them: the real src/core/actions.js listening on a stand-in document over the
     page's three tables, with a recording stand-in for each function they call, and as the element each control the
     page's own line drew, its attributes read back as a browser reads them (so a chapter's name is the name, not its
     escaped text). Every control is tapped, typed in and chosen from, in the order drawn. The date box holds a new date. */
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const tables = TABLES.map(t => (page.match(new RegExp('const ' + t + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + t + '={};'])[0].replace(/^const /, 'var ')).join('\n');
  const called = [...new Set([...tables.matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))].filter(n => n !== 'Number');
  vm.runInContext(read('src/core/actions.js') + '\nvar S={chapter:null,mock:{i:0}}, offlineJob={busy:false};\n'
    + called.map(n => `function ${n}(){ tcalls.push(${J(n)} + (arguments.length ? " " + JSON.stringify([].slice.call(arguments)) : "")); }`).join('\n') + '\n' + tables
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);\nActions.install(doc,INPUT_ACTIONS,"input");\nActions.install(doc,CHANGE_ACTIONS,"change");', tctx);
  const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const controls = h => [...h.matchAll(/<(button|select|input)\b([^>]*)>/g)].map(m => {
    const at = Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], unescape(x[2])]));
    const dataset = Object.fromEntries(Object.keys(at).filter(k => k.startsWith('data-')).map(k => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), at[k]]));
    const el = { nodeType: 1, value: m[1] === 'input' ? '2026-12-24' : '', dataset, getAttribute: k => (k in at ? at[k] : null), closest: sel => (sel === '[data-action]' && 'data-action' in at ? el : null) };
    return el; });
  const fire = (type, h) => { tcalls.length = 0; controls(h).forEach(el => tctx.listeners.filter(l => l[0] === type).forEach(l => l[1]({ type, target: el }))); return tcalls.slice(); };
  const runs = ask('_runsShown.length');
  const taps = fire('click', html);
  ok('tapped: home, each chapter\'s ring, the review, each plan with its minutes, the exam date cleared, each run by its number, the missed, the flagged, flags cleared, the notes, every question, and each chapter\'s tile',
     runs > 0 && J(taps) === J(['goHome', 'startQuiz ["Rhythm"]', 'startQuiz ["Valves & more"]', 'startQuiz [null,"due"]', 'startPlan [10]', 'startPlan [20]', 'startPlan [40]', 'setExamDate [""]']
       .concat(Array.from({ length: runs }, (_, i) => 'startRun [' + i + ']'), ['startQuiz [null,"missed"]', 'startQuiz [null,"flagged"]', 'clearFlags', 'goAnnotations', 'startQuiz [null]', 'startQuiz ["Rhythm"]', 'startQuiz ["Valves & more"]'])), J(taps));
  const chose = fire('change', html), keyedIn = fire('input', html);
  ok('chosen: the date box sets the date it holds, and nothing else answers a choice or a key', J(chose) === J(['setExamDate ["2026-12-24"]']) && J(keyedIn) === J([]), J(chose) + ' · ' + J(keyedIn));

}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
