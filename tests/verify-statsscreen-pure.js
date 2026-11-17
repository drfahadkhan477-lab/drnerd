#!/usr/bin/env node
/*
 * The Progress screen — src/app/stats.js.
 *
 *   node tests/verify-statsscreen-pure.js
 *
 * Pure Node, over invented histories. The module is given the page's state, the log, the chapters, their
 * accents and a kit, and returns markup; nothing in the first eight parts has a page. The kit there is
 * stand-ins: Calib hands back figures this file wrote, MockExam.fmtClock(ms, dir) says "CLK(ms,dir)",
 * last30() and forecast7() hand back days this file wrote, storageLine() says "STORAGE", e('x') is "E(x)",
 * so what the screen is expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the head, the four tiles, and the card for figures kept on this device;
 *   - the last thirty days as a line and a heat map, and a ring for each chapter;
 *   - the reader's data: the buttons, the pending backup's confirmation, the Safari tab's warning;
 *   - predicted retention with its colour and the week ahead;
 *   - calibration: the bands, the pace, where the misses come from, and when nothing is said;
 *   - the mock blocks handed in: the last eight as bars, and the last in words;
 *   - that it reads four names of the state and eighteen of the kit, and changes nothing;
 *   - the page's line, the survey it starts after drawing, the handlers and elements the markup names,
 *     and that line over the page's own helpers and the real Calib, FSRS, ReviewQueue and MockExam.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/stats.js').StatsScreen;

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
const handlersOf = html => [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]);

/* Thirty days, oldest first. What was answered on each walks through every heat level's edge. */
const ANSWERED = [0, 1, 4, 5, 14, 15, 29, 30, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
const DAYS = ANSWERED.map((a, i) => ({ d: 'D' + i, a, c: Math.floor(a / 2) }));
const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const FC = WEEK.map((d, i) => ({ d, n: [0, 7, 14, 1, 0, 3, 2][i] }));
const CAL = { rated: 7, certainButWrong: 0.25, bands: [{ label: 'Guess<b>', n: 2, accuracy: null }, { label: 'Sure', n: 9, accuracy: 0.666 }] };
const SP = { n: 4, enough: true, correctMs: 4200, wrongMs: 12000, fragile: false };
const RS = { tagged: 3, enough: true, misses: 5, counts: [{ label: 'Gap', n: 1, share: 0.245 }, { label: 'Slip<i>', n: 3, share: 0.755 }, { label: 'Never', n: 0, share: 0 }] };
const calibOf = (cal, sp, rs) => ({ MIN_SAMPLES: 5, calibration: () => Object.assign({}, CAL, cal), speed: () => Object.assign({}, SP, sp), reasons: () => Object.assign({}, RS, rs) });
const CH = ['Alpha beta', 'Say "x"', 'Plain'];
const COLORS = { 'Alpha beta': '#112233', 'Say "x"': '#445566' };
const MAST = { 'Alpha beta': 0.666, 'Say "x"': 0, Plain: 1 };
const kitOf = over => Object.assign({
  Calib: calibOf(), MockExam: { fmtClock: (ms, dir) => 'CLK(' + ms + (dir ? ',' + dir : '') + ')' }, TOTAL_Q: 50, CH_SHORT: { 'Alpha beta': 'Al<b>' }, pendingBackupSave: null,
  last30: () => DAYS, forecast7: () => FC, avgRetention: () => 90, startedCount: () => 12, dueQuestions: () => ['a', 'b', 'c'], masteryFor: ch => MAST[ch],
  storageOK: () => true, storageLine: () => 'STORAGE', safariTabStorage: () => false, offlineCapable: () => false,
  chIcon: ch => '[ch ' + ch + ']', e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
}, over);
/* The record of every day, which is more than the thirty shown: 200 answered and 50 right, 180 of them long ago. */
const DAILY = { old1: { a: 100, c: 10 }, old2: { a: 80, c: 30 }, D29: { a: 20, c: 10 } };
const state = over => Object.assign({ daily: DAILY, reviewStreak: 12, srs: { a: { stability: 3 }, b: { stability: 9 }, c: { reps: 2 } }, mocks: [] }, over);
const LOG9 = Array.from({ length: 9 }, (_, k) => ({ q: 'q' + k }));
const draw = (sOver, kOver, log, chapters, colors) => run(() => M.screenHtml(state(sOver), log || LOG9, chapters || CH, colors || COLORS, kitOf(kOver)));

head('the head and the four tiles');
{
  const html = draw();
  ok('it says progress is saved on this device', html.includes('<div class="stats-title">Your Progress</div>') && html.includes('<div class="stats-sub">[icon check icon-sm] Saved locally on this device</div>'));
  ok('or that it cannot be, where the device will not save', draw({}, { storageOK: () => false }).includes('<div class="stats-sub">[icon alert icon-sm] Local storage unavailable — use Export</div>'));
  ok('the way home, by goHome()', html.includes('<button class="btn sb-back" onclick="goHome()">[icon arrow-left icon-sm] Home</button>'));
  const tiles = h => [...h.matchAll(/<div class="stat-tile"><div class="st-v">([^<]*)<\/div><div class="st-l">([^<]*)/g)].map(m => [m[1], m[2].trim()]);
  ok('the streak, every answer ever recorded, the accuracy over them, and how many are due now', J(tiles(html)) === J([['12', 'day streak [icon flame icon-sm]'], ['200', 'answered'], ['25%', 'accuracy'], ['3', 'due now']]), J(tiles(html)));
  const tileAt = (h, i) => (tiles(h)[i] || [])[0];
  ok('the accuracy is rounded', tileAt(draw({ daily: { x: { a: 3, c: 2 } } }), 2) === '67%', tileAt(draw({ daily: { x: { a: 3, c: 2 } } }), 2));
  const none = tiles(draw({ daily: {}, reviewStreak: undefined }, { dueQuestions: () => [] }));
  ok('with nothing answered: no streak, none answered, 0%, none due', J(none.map(t => t[0])) === J(['0', '0', '0%', '0']), J(none));
}

head('figures kept on this device');
{
  const html = draw({}, { offlineCapable: () => true });
  ok('no card where they cannot be kept', !draw().includes('off-card') && !draw().includes('offlineDownload'));
  ok('where they can, the card the page\'s survey fills in: found by its id, "checking…", an empty bar', html.includes('<div class="off-card" id="offlineCard">') && html.includes('<span class="off-val">checking…</span>') && html.includes('<div class="off-track"><span class="off-fill" style="width:0%"></span></div>'));
  ok('and the download, by offlineDownload()', html.includes('<button class="off-btn" onclick="offlineDownload()">Download the rest</button>'));
}

head('the panels, in their order');
{
  const html = draw({ mocks: [{ ts: 0, n: 20, correct: 10, ms: 60000 }, { ts: 86400000, n: 20, correct: 16, ms: 60000 }] });
  const at = ['<div class="stat-grid">', 'Predicted retention', 'Calibration ·', 'id="mockPanel"', 'Last 30 days', 'Chapter mastery ·', 'Your data'].map(t => html.indexOf(t));
  ok('the tiles, retention, calibration, the mock blocks, thirty days, mastery, the data', at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), at.join(' '));
  ok('each panel is this history\'s: the cards, the log and the blocks the screen was given', html.includes('across 2 scheduled cards.') && html.includes('Calibration · 7 rated') && html.includes('Mock exam blocks · 2</div>') && times(html, 'class="mk-bar') === 2, times(html, 'class="mk-bar') + ' bars');
  const bare = draw({ srs: {} }, { avgRetention: () => null, Calib: calibOf({ rated: 0 }, { n: 0 }, { tagged: 0 }) });
  ok('with no card scheduled, nothing rated and no block handed in, those three are not drawn, and the rest is', !bare.includes('Predicted retention') && !bare.includes('Calibration') && !bare.includes('mockPanel') && bare.includes('Last 30 days') && bare.includes('Your data'));
}

head('the last thirty days');
{
  const html = draw();
  const cells = [...html.matchAll(/<div class="heat-cell l(\d)" title="([^"]*)"><\/div>/g)].map(m => [+m[1], m[2]]);
  ok('a cell for each day, oldest first, saying what was answered and how many right', cells.length === 30 && cells[0][1] === 'D0: 0 answered, 0 correct' && cells[8][1] === 'D8: 60 answered, 30 correct' && cells[29][1] === 'D29: 2 answered, 1 correct', cells.length + ' · ' + cells[8]);
  ok('its shade by how many: none, under 5, under 15, under 30, more', J(cells.slice(0, 9).map(c => c[0])) === J([0, 1, 1, 2, 2, 3, 3, 4, 4]), J(cells.slice(0, 9).map(c => c[0])));
  const pts = h => (g1(h, /<polyline points="([^"]*)"/) || '').split(' ').map(p => p.split(',').map(Number));
  const p = pts(html);
  ok('a line through the thirty days, left to right across the whole width', p.length === 30 && p[0][0] === 0 && p[29][0] === 280 && p.every((q, i) => i === 0 || q[0] > p[i - 1][0]), p.length + ' points, ' + p[0] + ' … ' + p[29]);
  const y = i => (p[i] || [])[1];
  ok('as high as the day against the busiest: the busiest at the top, a day with none at the bottom, half way between', y(8) === 3 && y(0) === 51 && y(7) === 27, [y(8), y(0), y(7)].join(' '));
  const flat = pts(draw({}, { last30: () => DAYS.map(d => ({ d: d.d, a: 0, c: 0 })) }));
  ok('with nothing answered the line lies along the bottom', flat.length === 30 && flat.every(q => q[1] === 51), J(flat.slice(0, 2)));
  ok('and the key, less to more', html.includes('<div class="heat-key"><span>less</span>') && [0, 1, 2, 3, 4].every(l => html.includes('<i class="heat-cell l' + l + '"></i>')));
}

head('chapter mastery');
{
  const html = draw();
  ok('how many cards are started, of the bank', html.includes('<div class="panel-h">Chapter mastery · 12/50 cards started</div>'));
  const rings = [...html.matchAll(/<button class="mast" style="--accent:([^"]*)" onclick="startQuiz\(([^)]*)\)">[\s\S]*?stroke="([^"]*)" stroke-width="5"\s+stroke-dasharray="([^"]*)" stroke-dashoffset="([^"]*)"[\s\S]*?<span class="mast-ico">([^<]*)<\/span>\s*<span class="mast-pct">([^<]*)<\/span>\s*<span class="mast-name">(.*?)<\/span>\s*<\/button>/g)].map(m => m.slice(1));
  const C = 2 * Math.PI * 26;
  ok('a ring for each chapter, in the bank\'s order, in its accent or the teal', J(rings.map(r => [r[0], r[2]])) === J([['#112233', '#112233'], ['#445566', '#445566'], ['var(--teal)', 'var(--teal)']]), J(rings.map(r => [r[0], r[2]])));
  ok('each starts a quiz in its chapter, the name\'s quotes written as entities', J(rings.map(r => r[1])) === J(['&quot;Alpha beta&quot;', '&quot;Say \\&quot;x\\&quot;&quot;', '&quot;Plain&quot;']), J(rings.map(r => r[1])));
  ok('the ring is drawn as far round as the mastery: two thirds, none, all', rings.length === 3 && rings.every(r => +r[3] === C) && Math.abs(+rings[0][4] - C * (1 - 0.666)) < 1e-9 && +rings[1][4] === C && +rings[2][4] === 0, rings.map(r => (+r[4]).toFixed(2)).join(' '));
  ok('with the mastery rounded to a percentage', J(rings.map(r => r[6])) === J(['67%', '0%', '100%']), J(rings.map(r => r[6])));
  ok('the chapter\'s own icon, and its short name or its first word, through e()', J(rings.map(r => [r[5], r[7]])) === J([['[ch Alpha beta]', 'E(Al<b>)'], ['[ch Say "x"]', 'E(Say)'], ['[ch Plain]', 'E(Plain)']]), J(rings.map(r => [r[5], r[7]])));
  ok('with no chapters, no rings', draw({}, {}, LOG9, []).includes('<div class="mast-grid"></div>'));
}

head('the reader\'s data');
{
  const html = draw();
  const data = h => h.slice(h.indexOf('Your data'));
  ok('export, import and reset, each by its own handler', J(handlersOf(data(html))) === J(['exportMarkup()', 'importMarkup()', 'resetProgress()']), J(handlersOf(data(html))));
  const pending = draw({}, { pendingBackupSave: { at: 1, reviews: 2 } });
  ok('while a backup is written and not confirmed, the button that confirms it, between export and import', J(handlersOf(data(pending))) === J(['exportMarkup()', 'confirmBackupSaved()', 'importMarkup()', 'resetProgress()']) && pending.includes('<button class="btn sb-back" onclick="confirmBackupSaved()">I saved the backup file</button>'), J(handlersOf(data(pending))));
  const tab = draw({}, { safariTabStorage: () => true });
  ok('in a Safari tab, the warning that the data has seven days, found by its id; elsewhere none', tab.includes('<div class="notice" id="safariTabNote"><span>[icon alert]</span><span><b>Add Systole to your Home Screen to keep this.</b>') && tab.includes('seven days of use without a visit here') && !html.includes('safariTabNote'));
  ok('how many reviews are logged, and what the page says of its storage', html.includes('<div class="ref-hint">9 reviews logged · STORAGE<br>') && draw({}, {}, []).includes('<div class="ref-hint">0 reviews logged · STORAGE<br>'));
  ok('and that this is for study, not for decisions at the bedside', html.includes('<p class="app-disclaim">For board preparation and education only'));
}

head('predicted retention');
{
  const R = (sOver, kOver) => run(() => M.retentionHtml(state(sOver), kitOf(kOver)));
  const html = R();
  ok('nothing before a card is scheduled', R({}, { avgRetention: () => null }) === '');
  const col = r => g1(R({}, { avgRetention: () => r }), /<div class="retention-num" style="color:([^"]*)">/) + ' ' + g1(R({}, { avgRetention: () => r }), /<div class="retention-num"[^>]*>([^<]*)</);
  ok('the figure, green from 85, amber from 65, red below', J([90, 85, 84, 65, 64, 0].map(col)) === J(['var(--green-ink) 90%', 'var(--green-ink) 85%', 'var(--amber-ink) 84%', 'var(--amber-ink) 65%', 'var(--red-ink) 64%', 'var(--red-ink) 0%']), J([90, 85, 84, 65, 64, 0].map(col)));
  ok('across the cards the scheduler has scheduled, not every card the state holds', html.includes('across 2 scheduled cards.') && R({ srs: { a: { stability: 3 } } }).includes('across 1 scheduled card.'), g1(html, /across ([^.]*)\./));
  ok('the "s" follows every card the state holds, scheduled or not, as written: one scheduled of two reads "cards"', R({ srs: { a: { stability: 3 }, c: { reps: 2 } } }).includes('across 1 scheduled cards.'), g1(R({ srs: { a: { stability: 3 }, c: { reps: 2 } } }), /across ([^.]*)\./));
  const bars = [...html.matchAll(/<div class="fc-bar-wrap" title="([^"]*)">\s*<div class="fc-bar" style="height:(\d+)px"><\/div>\s*<span class="fc-n">(\d+)<\/span><span class="fc-dow">([^<]*)<\/span>/g)].map(m => m.slice(1));
  ok('a bar for each of the next seven days, saying the day and how many come due', J(bars.map(b => [b[0], b[2]])) === J(FC.map(d => ['E(' + d.d + '): ' + d.n + ' due', String(d.n)])), J(bars.map(b => b[0])));
  ok('as high as the day against the busiest, and never nothing: 4 for none, 32 for the busiest, 18 for half', J(bars.map(b => +b[1])) === J([4, 18, 32, 6, 4, 10, 8]), J(bars.map(b => +b[1])));
  /* The weekday's letter is the platform's, so it is asked of the platform here; what is held is which day gets it. */
  const letters = WEEK.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })[0]);
  ok('the first is "today", the others the first letter of their weekday, through e() (the platform gives the seven more than one letter, each a single one)',
     new Set(letters).size > 1 && letters.every(l => typeof l === 'string' && l.length === 1) && J(bars.map(b => b[3])) === J(['today'].concat(letters.slice(1).map(l => 'E(' + l + ')'))), letters.join('') + ' · ' + J(bars.map(b => b[3])));
  const quiet = [...R({}, { forecast7: () => FC.map(d => ({ d: d.d, n: 0 })) }).matchAll(/style="height:(\d+)px"/g)].map(m => +m[1]);
  ok('with nothing due all week every bar is the least', J(quiet) === J([4, 4, 4, 4, 4, 4, 4]), J(quiet));
}

head('calibration');
{
  const K = (cal, sp, rs, log) => run(() => M.calibHtml(log || LOG9, kitOf({ Calib: calibOf(cal, sp, rs) })));
  const html = K();
  ok('nothing while nothing is rated, timed or tagged', K({ rated: 0 }, { n: 0 }, { tagged: 0 }) === '');
  ok('drawn as soon as any one of the three is', [K({ rated: 1 }, { n: 0 }, { tagged: 0 }), K({ rated: 0 }, { n: 1 }, { tagged: 0 }), K({ rated: 0 }, { n: 0 }, { tagged: 1 })].every(h => h.startsWith('<div class="panel"><div class="panel-h">Calibration · ')));
  ok('the heading counts what was rated, not the log', html.startsWith('<div class="panel"><div class="panel-h">Calibration · 7 rated</div>'));
  ok('how often "Certain" was wrong', html.includes('<div class="cb-head">Certain, and wrong: <b>25%</b><span class="cb-sub">the gap you cannot feel from the inside</span></div>'));
  ok('or, before there is a figure, what will show it', K({ certainButWrong: null }).includes('<div class="cb-head cb-thin">Rate a few more answers and this will show how often "Certain" was wrong.</div>') && !K({ certainButWrong: null }).includes('Certain, and wrong'));
  const rows = h => [...h.matchAll(/<div class="cb-row"><span class="cb-lab">([^<]*(?:<[bi]>)?[^<]*)<\/span><span class="cb-track"><span class="cb-fill" style="width:(\d+)%"><\/span><\/span><span class="(cb-val[^"]*)">([^<]*)<\/span><\/div>/g)].map(m => m.slice(1));
  const paceAt = html.indexOf('<div class="panel-h cb-h2">Pace</div>'), missAt = html.indexOf('<div class="panel-h cb-h2">Where the misses come from</div>');
  const bands = rows(html.slice(0, paceAt)), reasons = rows(html.slice(missAt));
  ok('a band with too few answers: its label through e(), an empty bar, and how many more it needs', J(bands[0]) === J(['E(Guess<b>)', '0', 'cb-val cb-thin', 'E(needs 3 more)']), J(bands[0]));
  ok('a measured band: a bar as wide as its accuracy, rounded', J(bands[1]) === J(['E(Sure)', '67', 'cb-val', 'E(67%)']) && bands.length === 2, J(bands[1]));
  ok('the sections in order: certain and wrong, the bands, the pace, the misses', html.indexOf('cb-head') < html.indexOf('cb-row') && html.indexOf('cb-row') < paceAt && paceAt < missAt && paceAt > 0);
  const pace = h => g1(h, /<div class="panel-h cb-h2">Pace<\/div>([\s\S]*?)<div class="panel-h cb-h2">/);
  ok('the pace: how long a right answer took, and a wrong one', pace(html) === '<div class="cb-row2">Correct in <b>4.2s</b> · wrong in <b>12s</b></div>', pace(html));
  ok('under ten seconds to a tenth, from ten in whole seconds, and a dash where nothing was timed', pace(K({}, { correctMs: 9940, wrongMs: 10000 })).includes('<b>9.9s</b> · wrong in <b>10s</b>') && pace(K({}, { correctMs: null, wrongMs: 59600 })).includes('<b>—</b> · wrong in <b>60s</b>'), pace(K({}, { correctMs: 9940, wrongMs: 10000 })) + ' | ' + pace(K({}, { correctMs: null, wrongMs: 59600 })));
  ok('right but slower than wrong is said, and only then', pace(K({}, { fragile: true })).includes('<span class="cb-sub">right, but slower than your wrong answers') && !pace(html).includes('cb-sub'));
  ok('before enough are timed, that there are not enough', pace(K({}, { enough: false })) === '<div class="cb-thin">Not enough timed answers yet.</div>');
  ok('the misses by reason: only reasons with a miss, the commonest first, its label through e(), a bar as wide as its share', J(reasons) === J([['E(Slip<i>)', '76', 'cb-val', '76%'], ['E(Gap)', '25', 'cb-val', '25%']]), J(reasons));
  const few = h => h.slice(h.indexOf('Where the misses come from</div>') + 32);
  ok('before enough are tagged: to tag a few where there are misses, or that there are none', few(K({}, {}, { enough: false })) === '<div class="cb-thin">Tag a few misses and the pattern shows here.</div></div>' && few(K({}, {}, { enough: false, misses: 0 })) === '<div class="cb-thin">No misses recorded.</div></div>', few(K({}, {}, { enough: false })));
  const seen = []; run(() => M.calibHtml(LOG9, kitOf({ Calib: { MIN_SAMPLES: 5, calibration: l => (seen.push(l), CAL), speed: l => (seen.push(l), SP), reasons: l => (seen.push(l), RS) } })));
  ok('Calib is asked about the log it was handed, all three times', seen.length === 3 && seen.every(l => l === LOG9));
}

head('the mock blocks handed in');
{
  const P = mocks => run(() => M.mockHtml({ mocks }, kitOf()));
  const DAY = 86400000, T0 = new Date(2026, 9, 1, 12).getTime();
  const block = (k, n, correct, ms, limit) => Object.assign({ ts: T0 + k * DAY, n, correct, ms }, limit == null ? {} : { limit });
  /* Eleven handed in; the last eight are shown. Scores walk through the colours' edges and the least bar. */
  const ALL = [block(0, 20, 20, 1), block(1, 20, 20, 1), block(2, 20, 20, 1), block(3, 20, 16, 600000, 1800000), block(4, 20, 15, 600000), block(5, 20, 12, 600000), block(6, 20, 11, 600000),
    block(7, 3, 1, 600000), block(8, 40, 0, 600000), block(9, 200, 5, 600000), block(10, 40, 30, 2460000, 3600000)];
  const html = P(ALL);
  const date = k => new Date(T0 + k * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  ok('nothing before a block is handed in', P([]) === '');
  ok('the panel, found by its id, counts every block handed in', html.startsWith('<div class="panel" id="mockPanel"><div class="panel-h">Mock exam blocks · 11</div>'));
  const bars = [...html.matchAll(/<div class="mk-bar ([gar])" role="listitem" data-pct="(\d+)" title="([^"]*)"><b>(\d+)%<\/b>\s*<span class="mk-col"><i style="height:(\d+)%"><\/i><\/span><span class="mk-d">([^<]*)<\/span><em>(\d+) q<\/em><\/div>/g)].map(m => m.slice(1));
  ok('a bar for each of the last eight, oldest first, with its score rounded', J(bars.map(b => +b[1])) === J([80, 75, 60, 55, 33, 0, 3, 75]) && bars.every(b => b[1] === b[3]), J(bars.map(b => b[1])));
  ok('green from 80, amber from 60, red below', bars.map(b => b[0]).join('') === 'gaarrrra', bars.map(b => b[0]).join(''));
  ok('as high as its score, and never under 4, so a block with none right can still be seen', J(bars.map(b => +b[4])) === J([80, 75, 60, 55, 33, 4, 4, 75]), J(bars.map(b => +b[4])));
  ok('its day, through e(), and how many questions it had', J(bars.map(b => [b[5], +b[6]])) === J([3, 4, 5, 6, 7, 8, 9, 10].map((k, i) => ['E(' + date(k) + ')', [20, 20, 20, 20, 3, 40, 200, 40][i]])), J(bars.map(b => [b[5], b[6]])));
  ok('its title: the day, how many right of how many, the score, and the time taken of the time allowed, counted down', bars[0][2] === 'E(' + date(3) + '): 16 of 20, 80%, E(CLK(600000) of CLK(1800000,down))', bars[0][2]);
  ok('or the time taken alone, where the block had no limit', bars[1][2] === 'E(' + date(4) + '): 15 of 20, 75%, E(CLK(600000))', bars[1][2]);
  ok('and the last block in words: its score, its time through e(), and the seconds a question, rounded', html.includes('<div class="ref-hint">Last: 75%, 30 of 40 in E(CLK(2460000)), about 62 s a question. A question left blank counts as wrong, as it does in the real exam.</div></div>'), g1(html, /<div class="ref-hint">([^<]*)</));
  ok('with one block handed in, one bar', P([block(0, 20, 10, 600000)]).split('class="mk-bar').length - 1 === 1 && P([block(0, 20, 10, 600000)]).includes('Mock exam blocks · 1</div>'));
}

head('it reads what it is given and changes nothing');
const KIT_READS = new Set(), S_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const none = () => new Set();
  const MOCKS = () => [{ ts: 9, n: 20, correct: 10, ms: 600000 }, { ts: 5, n: 20, correct: 15, ms: 600000, limit: 1800000 }];
  const visits = [{}, { mocks: watched(MOCKS(), none(), 'mocks'), srs: watched({ a: { stability: 3 }, c: { reps: 2 } }, none(), 'srs'), daily: watched(Object.assign({}, DAILY), none(), 'daily') }];
  const outs = visits.map(v => run(() => M.screenHtml(watched(state(Object.assign({ screen: 'stats', missed: {}, lastBackup: 5 }, v)), S_READS, 'S'), watched(LOG9.slice(), none(), 'LOG'), watched(CH.slice(), none(), 'CHAPTERS'), watched(Object.assign({}, COLORS), none(), 'CH_COLORS'),
    watched(kitOf({ offlineCapable: () => true, safariTabStorage: () => true, pendingBackupSave: watched({ at: 1, reviews: 2 }, none(), 'pendingBackupSave'), CH_SHORT: watched({ 'Alpha beta': 'Al' }, none(), 'CH_SHORT') }), KIT_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads the days, the streak, the cards and the blocks, and nothing else', !outs.some(o => o.startsWith('THREW')) && names(S_READS) === 'daily mocks reviewStreak srs', names(S_READS) + ' · ' + outs.map(o => o.slice(0, 30)).join(' | '));
  ok('of the kit, eighteen names', names(KIT_READS) === 'CH_SHORT Calib MockExam TOTAL_Q avgRetention chIcon dueQuestions e forecast7 icon last30 masteryFor offlineCapable pendingBackupSave safariTabStorage startedCount storageLine storageOK', names(KIT_READS));
  ok('it sets, deletes and defines nothing on the state, the days, the cards, the blocks, the log, the chapters or the kit', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.screenHtml(deep(state({ mocks: MOCKS() })), deep(LOG9.slice()), deep(CH.slice()), deep(Object.assign({}, COLORS)), deep(kitOf({ last30: () => deep(DAYS.map(d => Object.assign({}, d))), forecast7: () => deep(FC.map(d => Object.assign({}, d))), Calib: { MIN_SAMPLES: 5, calibration: () => deep(JSON.parse(J(CAL))), speed: () => deep(Object.assign({}, SP)), reasons: () => deep(JSON.parse(J(RS))) } }))));
  ok('given everything frozen, what Calib and the page\'s days hand back included, it draws the same screen', !frozen.startsWith('THREW') && frozen === draw({ mocks: MOCKS() }) && frozen.includes('id="mockPanel"') && frozen.includes('E(Slip<i>)'), frozen.slice(0, 60));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/stats.js]@@';
  const CALL = '  return StatsScreen.screenHtml(S,LOG,CHAPTERS,CH_COLORS,{Calib,MockExam,TOTAL_Q,CH_SHORT,pendingBackupSave,last30,forecast7,avgRetention,\n    startedCount,dueQuestions,masteryFor,storageOK,storageLine,safariTabStorage,offlineCapable,chIcon,e,icon});\n}';
  const SURVEY = "  if(typeof offlineCapable==='function'&&offlineCapable()&&!offlineJob.busy){\n    setTimeout(function(){ offlineSurvey(); },0);\n  }\n";
  const fn = (() => { const a = page.indexOf('function buildStats(){'); return a < 0 ? '' : page.slice(a, page.indexOf('\n}', a) + 2); })();
  /* The comment in it is blanked to empty lines; with those dropped, the function is these lines and nothing else. */
  ok('buildStats() starts the survey, then returns the module\'s screen: the state, the log, the chapters, their accents and the kit', count('function buildStats(') === 1 && fn.split('\n').filter(l => l.trim()).join('\n') + '\n' === 'function buildStats(){\n' + SURVEY + CALL + '\n', fn.replace(/\s+/g, ' ').slice(0, 120));
  ok('the module is written into the page once, above it', count(SLOT) === 1 && page.indexOf('function buildStats(){') > page.indexOf(SLOT));
  const handed = String(g1(page, /StatsScreen\.screenHtml\(S,LOG,CHAPTERS,CH_COLORS,\{([^}]*)\}\);/)).replace(/\s+/g, '');
  ok('the kit is the eighteen names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 18 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  const GONE = ['calibPanel', 'retentionTile', 'mockPanel', 'pct', 'secs'];
  ok('calibPanel(), retentionTile(), mockPanel(), pct() and secs() are no longer the page\'s, and nothing in it calls them', GONE.every(n => count('function ' + n + '(') === 0 && !new RegExp('[^.\\w$]' + n + '\\(').test(page)), GONE.map(n => n + ':' + count('function ' + n + '(') + '/' + new RegExp('[^.\\w$]' + n + '\\(').test(page)).join(' '));
  const KEPT = ['last30', 'forecast7', 'avgRetention', 'startedCount', 'dueQuestions', 'masteryFor', 'storageOK', 'storageLine', 'safariTabStorage', 'offlineCapable', 'chIcon'];
  ok('the eleven functions it is handed are each still the page\'s, once', KEPT.every(n => count('function ' + n + '(') === 1), KEPT.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  const WORDS = ['Your Progress', 'Predicted retention', 'Calibration ·', 'Certain, and wrong', 'Mock exam blocks ·', 'Chapter mastery ·', 'reviews logged', 'Last 30 days', 'day streak'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = draw({ mocks: [{ ts: 0, n: 20, correct: 10, ms: 60000 }] }, { offlineCapable: () => true, safariTabStorage: () => true, pendingBackupSave: { at: 1, reviews: 2 } });
  const handlers = [...new Set(handlersOf(all).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its markup names seven handlers', J(handlers) === J(['confirmBackupSaved', 'exportMarkup', 'goHome', 'importMarkup', 'offlineDownload', 'resetProgress', 'startQuiz']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  const LOOKS = ["document.getElementById('offlineCard')", "card.querySelector('.off-fill')", "card.querySelector('.off-val')", "card.querySelector('.off-btn')"];
  ok('the survey fills in the card by the id and the three classes the module draws', LOOKS.every(t => count(t) === 1) && ['id="offlineCard"', 'class="off-fill"', 'class="off-val"', 'class="off-btn"'].every(t => times(all, t) === 1), LOOKS.map(t => count(t)).join(' '));

  /* The page's own line and helpers, its icon() and e(), and the real Calib, FSRS, ReviewQueue and MockExam, the clock
     held at one moment: four questions in two chapters, one card scheduled and certain, one kept from before the
     scheduler and reviewed once, one question practised. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = ['calib', 'fsrs', 'reviewqueue', 'mockexam'].map(m => read('src/core/' + m + '.js')).concat([whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function chIcon(ch,cls){', '\n'),
    whole('function isoLocal(d){', '\n'), whole('function todayISO(){', '\n'), whole('function addDays(iso,n){', '\n'), whole('function dueQuestions(){', '\n'), whole('let pendingBackupSave=null;', '\n'),
    whole('function safariTabStorage(){', '\n}'), whole('function storageLine(){', '\n}'), whole('function storageOK(){', '\n}'), whole('function masteryFor(ch){', '\n}'), whole('function avgRetention(){', '\n}'),
    whole('function forecast7(){', '\n}'), whole('function startedCount(){', '\n}'), whole('function last30(){', '\n}'), whole('function offlineCapable(){', '\n}'), read('src/app/stats.js'), whole('function buildStats(){', '\n}')]).join('\n');
  const NOW = new Date(2026, 10, 16, 9, 0).getTime();
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  const timers = [], flags = { installed: false }; let surveys = 0;
  const ctx = { Date: FixedDate, setTimeout: (f, ms) => { timers.push([f, ms]); }, offlineSurvey: () => { surveys++; }, offlineJob: { busy: false }, SPLIT_BUILD: true, caches: {}, IMGS: {},
    localStorage: { setItem() {}, removeItem() {} }, navigator: { vendor: 'Apple Computer, Inc.' }, document: { documentElement: { classList: { contains: c => c === 'installed' && flags.installed } } },
    CHAPTERS: ['Valves & more', 'Rhythm'], CH_COLORS: { Rhythm: '#102030' }, CH_SHORT: {}, CH_ICONS: {}, TOTAL_Q: 4, PERSISTED: true,
    POOL: [{ id: 'v1', ch: 'Valves & more' }, { id: 'v2', ch: 'Valves & more' }, { id: 'r1', ch: 'Rhythm' }, { id: 'r2', ch: 'Rhythm' }],
    LOG: Array.from({ length: 28 }, (_, k) => ({ m: 'practice', q: 'x' + k, ok: k < 14 ? 0 : 1, cf: 3, ms: k < 14 ? 5000 : 4000, why: k < 14 ? 'misread' : null })),
    S: { srs: { v1: { stability: 1e9, difficulty: 5, last: '2026-11-16', due: '2026-11-16', reps: 3, lapses: 0 }, r2: { reps: 1, due: '2026-11-20' } }, practice: { r1: { c: 2, a: 2 } }, daily: { '2026-11-16': { a: 10, c: 7 }, '2026-10-01': { a: 10, c: 3 } }, reviewStreak: 4,
      lastBackup: NOW - 3 * 86400000, mocks: [{ ts: NOW, n: 20, correct: 15, ms: 1200000, limit: 1800000 }] } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const html = String(ask('buildStats()'));
  const tiles = [...html.matchAll(/<div class="stat-tile"><div class="st-v">([^<]*)</g)].map(m => m[1]);
  ok('the page\'s own line draws the screen: a streak of 4, twenty answered over all the days, half right, one due', loaded === 'loaded' && J(tiles) === J(['4', '20', '50%', '1']), String(loaded).slice(0, 60) + ' · ' + J(tiles));
  ok('in a split build with a cache it draws the card for the figures, sets one timer for after the paint, and the survey starts only when that runs', html.includes('id="offlineCard"') && timers.length === 1 && timers[0][1] === 0 && surveys === 0 && (timers[0][0](), surveys === 1), timers.length + ' timers, ' + surveys + ' surveys');
  ask('offlineJob.busy=true'); ask('buildStats()');
  ok('no survey is started while a download is running', timers.length === 1, timers.length + ' timers');
  ask('offlineJob.busy=false; SPLIT_BUILD=false');
  ok('and outside a split build there is no card and no survey', !String(ask('buildStats()')).includes('offlineCard') && timers.length === 1 && (ask('SPLIT_BUILD=true'), String(ask('buildStats()')).includes('id="offlineCard"')) && timers.length === 2, timers.length + ' timers');
  const cellDays = [...html.matchAll(/<div class="heat-cell l\d" title="(\d{4}-\d\d-\d\d): /g)].map(m => m[1]);
  ok('thirty cells, from twenty-nine days back to today, which is the last; the day six weeks back is not among them', cellDays.length === 30 && cellDays[0] === '2026-10-18' && cellDays[29] === '2026-11-16' && /title="2026-11-16: 10 answered, 7 correct"><\/div><\/div>/.test(html) && !html.includes('2026-10-01'), cellDays.length + ' cells, ' + cellDays[0] + ' … ' + cellDays[29]);
  ok('the real scheduler: the one scheduled card is certain to be recalled, so 100%, in green, the card from before it left out; one due today, one in four days', /<div class="retention-num" style="color:var\(--green-ink\)">100%<\/div>/.test(html) && html.includes('across 1 scheduled card') && /title="2026-11-16: 1 due">\s*<div class="fc-bar" style="height:32px">/.test(html) && html.includes('title="2026-11-20: 1 due"') && html.includes('title="2026-11-17: 0 due"'), g1(html, /<div class="retention-num"[^>]*>([^<]*)</));
  ok('the real Calib over the log: twenty-eight rated, and "Certain" wrong half the time', html.includes('Calibration · 28 rated') && html.includes('Certain, and wrong: <b>50%</b>'), g1(html, /Certain, and wrong: <b>([^<]*)</));
  ok('the real MockExam\'s clock: fifteen of twenty in twenty minutes of thirty, a minute a question', /title="[^"]*: 15 of 20, 75%, 20:00 of 30:00"/.test(html) && html.includes('Last: 75%, 15 of 20 in 20:00, about 60 s a question.'), g1(html, /class="ref-hint">(Last:[^<]*)</));
  const pcts = [...html.matchAll(/<span class="mast-pct">([^<]*)<\/span>\s*<span class="mast-name">([^<]*)</g)].map(m => [m[1], m[2]]);
  ok('mastery as the page computes it: one of two cards certain is 50%; one practised twice and one reviewed once before the scheduler is 39%; three of the four started; names through the page\'s e()', J(pcts) === J([['50%', 'Valves'], ['39%', 'Rhythm']]) && html.includes('onclick="startQuiz(&quot;Valves & more&quot;)"') && html.includes('3/4 cards started'), J(pcts) + ' · ' + g1(html, /Chapter mastery · ([^<]*)</));
  ok('the storage as the page says it, and the Safari tab\'s warning for a tab that is not installed', html.includes('28 reviews logged · storage granted eviction protection (not permanent — keep exporting backups) · last backup 3d ago<br>') && html.includes('id="safariTabNote"') && html.includes('Saved locally on this device'), g1(html, /class="ref-hint">(\d+ reviews[^<]*)</));
  flags.installed = true;
  ok('installed to the Home Screen, the same browser is not warned', !String(ask('buildStats()')).includes('safariTabNote'));
  ask('pendingBackupSave={at:1,reviews:2}');
  ok('and once the page holds a backup to confirm, the next drawing asks for it', !html.includes('confirmBackupSaved') && String(ask('buildStats()')).includes('onclick="confirmBackupSaved()"'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
