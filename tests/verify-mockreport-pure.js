#!/usr/bin/env node
/*
 * The report a mock exam block ends on — src/app/mockreport.js.
 *
 *   node tests/verify-mockreport-pure.js
 *
 * Pure Node, over invented blocks. The module is given the page's state, two tables of the bank's chapters
 * and a kit, and returns markup; nothing in the first seven parts has a page. The kit it is handed there is
 * stand-ins that say what they were asked: e('x') is "E(x)", MockExam.fmtClock(9000) is "CLOCK(9000)", and
 * MockExam.grade() hands back the result this file wrote for the block, so what the report is expected to
 * say is worked out here from that result and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - with no block handed in: one line and the way back, and the block is never graded;
 *   - the score, its colour, its words and its ring, at 80 and 60 and either side of each;
 *   - the counts, and the three ways the time is said;
 *   - the flags, counted against the Flagged list as it is now; and the slowest questions;
 *   - a row for each chapter, the weakest first, with its own thresholds at 70 and 50;
 *   - the buttons, and that every action on the screen is one of three fixed ones, with no inline handler (E2);
 *   - that it reads two names of the state and six of the kit, and changes nothing it is given;
 *   - the page's one line: what it hands over is what the module asks for, the two actions are in the page's
 *     table, a tap through the real Actions reaches them, the functions are the
 *     page's, and that line over the real MockExam and the page's own helpers and mockLookup() grades a
 *     block made here and says what the arithmetic done here says.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/mockreport.js').MockReportScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

/* A graded block, as MockExam.grade() gives one. Each part of the report is asked about by changing one field. */
const graded = over => Object.assign({
  n: 10, answered: 9, correct: 7, wrong: 2, skipped: 1, flagged: 0, flaggedWrong: 0, pct: 70, pctAnswered: 78,
  usedMs: 125000, limitMs: 900000, expired: false, avgMs: 12500, items: [], byCh: [], slowest: [], review: { missed: [], all: [] },
}, over);
/* Stand-ins that say what they were asked. asked keeps every call, so one not made shows as its absence. */
function kitOf(asked) {
  return {
    MockExam: {
      grade: (rec, lookup) => { asked.push(['grade', rec, lookup]); return rec.result; },
      fmtClock: (ms, dir) => 'CLOCK(' + ms + (dir === undefined ? '' : ',' + dir) + ')',
      reviewIds: (g, which) => { asked.push(['reviewIds', g, which]); return g.review[which] || []; },
    },
    mockLookup: id => ({ ch: 'looked up ' + id, ci: 0 }),
    chIcon: ch => '[chapter icon ' + ch + ']',
    e: s => 'E(' + s + ')',
    icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
    semText: v => 'INK(' + v + ')',
  };
}
const COLORS = Object.freeze({ Rhythm: '#112233', Valves: '#445566' });
const SHORT = Object.freeze({ 'Heart Failure & more': 'HF' });
/* A module that throws says so in the markup, so the check that asked says FAIL and the run goes on. */
function draw(result, opts) {
  const o = opts || {}, asked = o.asked || [];
  const S = o.S || { mockLast: result === null ? null : { result }, flagged: new Set(o.flagged || []) };
  try { return String(M.screenHtml(S, o.colors || COLORS, o.short || SHORT, o.kit || kitOf(asked))); } catch (err) { return 'THREW ' + err.message; }
}

/* The parts of the markup a reader sees. */
const g1 = (s, re) => (s.match(re) || [])[1];
const times = (html, text) => html.split(text).length - 1;
/* docs/ROADMAP.md, E2: a button names an action, and a review button also the set to review. */
const attrOf = (tag, name) => (tag.match(new RegExp('\\s' + name + '="([^"]*)"')) || [])[1];
const handlersOf = html => [...html.matchAll(/<button\b([^>]*\bdata-action="[^"]*"[^>]*)>/g)].map(m => [attrOf(m[1], 'data-action'), attrOf(m[1], 'data-mode')].filter(Boolean).join(' '));
const buttonsOf = html => [...html.matchAll(/<button\b([^>]*\bdata-action="[^"]*"[^>]*)>([\s\S]*?)<\/button>/g)].map(m => [[attrOf(m[1], 'data-action'), attrOf(m[1], 'data-mode')].filter(Boolean).join(' '), m[2].trim()]);
/* Attribute names, read tag by tag with each value consumed whole, so text inside a value is never taken for a name. */
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const scoreOf = html => ({
  pct: g1(html, /class="score-pct" style="color:[^"]*">([^<]*)</), ink: g1(html, /class="score-pct" style="color:([^"]*)"/), label: g1(html, /class="score-label">([^<]*)</),
  said: g1(html, /role="img" aria-label="([^"]*)"/), msg: (g1(html, /class="score-msg">([^<]*)</) || '').trim(),
  stroke: g1(html, /stroke="([^"]*)" stroke-width="10"\s+stroke-dasharray/), dash: g1(html, /stroke-dasharray="([^"]*)"/), offset: g1(html, /stroke-dashoffset="([^"]*)"/),
});
const summaryOf = html => g1(html, /id="mockSummary">([^<]*)</);
const timeOf = html => g1(html, /id="mockTime">([^<]*)</);
const slowLines = html => [...html.matchAll(/<div class="mock-slow">([\s\S]*?)<\/div>/g)].map(m => m[1]);
const rowsOf = html => html.split('<div class="chp-row mock-chrow"').slice(1).map(s => ({
  ch: g1(s, /^ data-ch="([^"]*)"/), accent: g1(s, /style="--accent:([^"]*)"/), icon: g1(s, /class="chp-icon">([^<]*)</), name: g1(s, /class="chp-name">([^<]*)</),
  scale: g1(s, /transform:scaleX\(([^)]*)\)/), fill: g1(s, /scaleX\([^)]*\);background:([^"]*)"/), ink: g1(s, /class="chp-pct" style="color:([^"]*)"/),
  pct: g1(s, /class="chp-pct"[^>]*>([^<]*)</), count: g1(s, /class="chp-count">([^<]*)</) }));
const NONE = 'No block has been handed in yet.';
const BY_CH = '<div class="section-label">This block, by chapter</div>';
const QUIET = 'background:var(--card);border:1.5px solid var(--border);color:var(--muted)';

head('with no block handed in');
{
  const asked = [], html = draw(null, { asked }), gone = draw(null, { S: { flagged: new Set() } });
  ok('it says so, and offers the way back to Sessions and nothing else', html.includes('<p>' + NONE + '</p>') && J(buttonsOf(html)) === J([['goSessions', '[icon arrow-left icon-sm] Back to Sessions']]) && scoreOf(html).pct === undefined, J(buttonsOf(html)));
  ok('the same with no word of a block in the state at all', gone.includes(NONE) && buttonsOf(gone).length === 1, gone.slice(0, 80));
  ok('and nothing is graded', !html.startsWith('THREW') && asked.length === 0, asked.map(a => a[0]).join(' ') || 'nothing asked');
}

head('the score');
{
  const s = scoreOf(draw(graded({ pct: 70 })));
  ok('the percent is the one the grade gives, of the whole block, and the ring says it to a screen reader', s.pct === '70%' && s.said === 'Score 70 percent' && s.label === 'Mock block', J([s.pct, s.said, s.label]));
  const band = p => { const x = scoreOf(draw(graded({ pct: p }))); return [x.stroke, x.ink, x.msg].join(' | '); };
  const GREEN = 'var(--green) | INK(var(--green)) | [icon trophy icon-lg] Outstanding!', AMBER = 'var(--amber) | INK(var(--amber)) | [icon target icon-lg] Good Progress!', RED = 'var(--red) | INK(var(--red)) | [icon book icon-lg] Keep Studying!';
  ok('80 and over is green, a trophy and "Outstanding!", and the figures are in the ink of the colour', band(80) === GREEN && band(100) === GREEN, band(80));
  ok('60 to 79 is amber, a target and "Good Progress!"', band(79) === AMBER && band(60) === AMBER, band(79) + ' · ' + band(60));
  ok('under 60 is red, a book and "Keep Studying!"', band(59) === RED && band(0) === RED, band(59));
  const circ = 2 * Math.PI * 50, ring = p => { const x = scoreOf(draw(graded({ pct: p }))); return [Number(x.dash), Number(x.offset)]; };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok('the ring is drawn to the same percent: all of it at 100, none at 0, three tenths left at 70',
     near(ring(70)[0], circ) && near(ring(70)[1], circ * 0.3) && near(ring(100)[1], 0) && near(ring(0)[1], circ), J([ring(70), ring(100), ring(0)]));
  ok('under it: how many correct, wrong and not answered, of how many', summaryOf(draw(graded({ correct: 7, wrong: 2, skipped: 1, n: 10 }))) === '7 correct · 2 wrong · 1 not answered · of 10', summaryOf(draw(graded())));
}

head('the time');
{
  const t = over => timeOf(draw(graded(over)));
  ok('a block with a limit says how much of it was used, the limit as a countdown reads', t({ usedMs: 125000, limitMs: 900000, avgMs: null }) === 'E(CLOCK(125000) of CLOCK(900000,down))', t({ usedMs: 125000, limitMs: 900000, avgMs: null }));
  ok('a block that ran out says when, and not how much was used', t({ expired: true, usedMs: 900000, limitMs: 900000, avgMs: null }) === 'E(Time ran out at CLOCK(900000,down))', t({ expired: true, usedMs: 900000, limitMs: 900000, avgMs: null }));
  ok('a block with no limit says so', t({ usedMs: 125000, limitMs: null, avgMs: null }) === 'E(CLOCK(125000), no time limit)', t({ usedMs: 125000, limitMs: null, avgMs: null }));
  ok('then about how many seconds a question, to the nearest; and nothing of it for a block with no questions',
     t({ limitMs: null, avgMs: 12500 }) === 'E(CLOCK(125000), no time limit) · about 13 s a question' && t({ limitMs: null, avgMs: 12400 }).endsWith(' · about 12 s a question') && t({ limitMs: null, avgMs: 0 }).endsWith(' · about 0 s a question') && t({ limitMs: null, avgMs: null }) === 'E(CLOCK(125000), no time limit)',
     t({ limitMs: null, avgMs: 12500 }));
}

head('the flags, and the slowest');
{
  const items = [{ id: 'a', flagged: true }, { id: 'b', flagged: true }, { id: 'c', flagged: true }, { id: 'd', flagged: false }];
  const line = flagged => String(slowLines(draw(graded({ flagged: 3, flaggedWrong: 2, items }), { flagged }))[0]);
  /* d is in the list and was not flagged in the block; z is in the list and not in the block. Neither counts. */
  ok('flagged: how many, how many of those were not right, and how many are in the Flagged list now',
     line(['a', 'd', 'z']) === '<b>3 flagged</b> — 2 of them not right. In your Flagged list: 1 of 3.' && line(['a', 'b', 'c']).endsWith('In your Flagged list: 3 of 3.') && line([]).endsWith('In your Flagged list: 0 of 3.'), line(['a', 'd', 'z']));
  ok('with nothing flagged in the block there is no such line, whatever is in the list', slowLines(draw(graded({ flagged: 0, items }), { flagged: ['a', 'b'] })).length === 0);
  const slowest = [{ i: 2, ch: 'Heart Failure & more', ms: 9000 }, { i: 0, ch: 'Rhythm', ms: 7000 }, { i: 9, ch: 'Valves', ms: 500 }];
  const slow = slowLines(draw(graded({ slowest })));
  ok('the slowest: each by its number in the block, its chapter\'s short name through e() or its name where it has none, and its time',
     J(slow) === J(['<b>Slowest</b> Q3 (E(HF), CLOCK(9000)) · Q1 (E(Rhythm), CLOCK(7000)) · Q10 (E(Valves), CLOCK(500))']), J(slow));
  ok('with none timed there is no such line', slowLines(draw(graded({ slowest: [] }))).length === 0);
  const both = draw(graded({ flagged: 1, flaggedWrong: 0, items: items.slice(0, 1), slowest: slowest.slice(0, 1) }));
  ok('with both, the flags come first', slowLines(both).length === 2 && slowLines(both)[0].startsWith('<b>1 flagged</b>') && slowLines(both)[1].startsWith('<b>Slowest</b>'), J(slowLines(both)));
}

head('a row for each chapter');
{
  const byCh = [{ ch: 'Valves', n: 4, correct: 3 }, { ch: 'Rhythm', n: 3, correct: 1 }, { ch: 'Other', n: 2, correct: 2 }, { ch: 'Aorta', n: 6, correct: 2 }, { ch: 'Zebra', n: 3, correct: 1 }];
  const html = draw(graded({ byCh })), rows = rowsOf(html);
  ok('the weakest chapter first, and by name where two are level', J(rows.map(r => r.name)) === J(['E(Aorta)', 'E(Rhythm)', 'E(Zebra)', 'E(Valves)', 'E(Other)']), J(rows.map(r => r.name)));
  const valves = rows[3] || {}, other = rows[4] || {};
  ok('a row names its chapter through e(), in its words and as data, with the chapter\'s icon', valves.ch === 'E(Valves)' && valves.name === 'E(Valves)' && valves.icon === '[chapter icon Valves]', J([valves.ch, valves.name, valves.icon]));
  ok('its accent is the chapter\'s colour, or the teal for a chapter with none', valves.accent === '#445566' && other.accent === 'var(--teal)', valves.accent + ' · ' + other.accent);
  const twoOfThree = rowsOf(draw(graded({ byCh: [{ ch: 'Rhythm', n: 3, correct: 2 }] })))[0] || {};
  ok('it says how many of how many, the percent to the nearest (two of three is 67), and the bar is that long',
     valves.count === '3/4' && valves.pct === '75%' && valves.scale === '0.75' && (rows[0] || {}).pct === '33%' && (rows[0] || {}).count === '2/6' && twoOfThree.pct === '67%' && twoOfThree.scale === '0.67',
     J([valves.count, valves.pct, valves.scale, (rows[0] || {}).pct, twoOfThree.pct, twoOfThree.scale]));
  const tone = (correct, n) => { const r = rowsOf(draw(graded({ byCh: [{ ch: 'Rhythm', n, correct }] })))[0] || {}; return r.fill + ' ' + r.ink; };
  ok('70 and over is green, 50 to 69 amber, under 50 red: the bar in the colour, the figures in its ink',
     tone(7, 10) === 'var(--green) INK(var(--green))' && tone(69, 100) === 'var(--amber) INK(var(--amber))' && tone(5, 10) === 'var(--amber) INK(var(--amber))' && tone(49, 100) === 'var(--red) INK(var(--red))',
     [tone(7, 10), tone(69, 100), tone(5, 10), tone(49, 100)].join(' · '));
  ok('the rows are under one heading, and with no chapter there is no heading', times(html, BY_CH) === 1 && html.indexOf(BY_CH) < html.indexOf('mock-chrow') && times(draw(graded({ byCh: [] })), BY_CH) === 0 && rowsOf(draw(graded({ byCh: [] }))).length === 0);
}

head('the buttons');
{
  const some = draw(graded({ n: 10, review: { missed: ['a', 'b', 'c'] } })), none = draw(graded({ n: 10, review: { missed: [] } }));
  ok('with something to learn from: review those, by how many; review all, by how many; back to Sessions',
     J(buttonsOf(some)) === J([['mockReview missed', '[icon repeat icon-sm] Review the 3 to learn from'], ['mockReview all', 'Review all 10'], ['goSessions', '[icon arrow-left icon-sm] Back to Sessions']]), J(buttonsOf(some)));
  ok('with every answer right and nothing flagged, the first is not offered', J(buttonsOf(none).map(b => b[0])) === J(['mockReview all', 'goSessions']), J(buttonsOf(none).map(b => b[0])));
  ok('the two that are always there are the quiet ones', times(some, 'style="' + QUIET + '" data-action="mockReview" data-mode="all"') === 1 && times(some, 'style="' + QUIET + '" data-action="goSessions"') === 1);
  const hostile = draw(graded({ byCh: [{ ch: 'x\');alert(1);(\'', n: 2, correct: 1 }], slowest: [{ i: 0, ch: 'y");alert(2);("', ms: 5 }], review: { missed: ['z\');alert(3);(\''] } }));
  const allowed = ['mockReview missed', 'mockReview all', 'goSessions'];
  ok('nothing of a block is written into a button: every action on the screen is one of three fixed ones, and it carries no inline handler',
     !hostile.startsWith('THREW') && handlersOf(hostile).length === 3 && handlersOf(hostile).every(h => allowed.includes(h)) && inlineOf(some).length === 0 && inlineOf(none).length === 0, handlersOf(hostile).join(' | ') + ' · ' + (inlineOf(some).join(' ') || 'no on* attribute'));
}

head('it reads what it is given, and changes nothing');
const KIT_READS = new Set(), STATE_READS = new Set();
{
  const wrote = [], asked = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const full = () => graded({ flagged: 1, flaggedWrong: 1, items: [{ id: 'a', flagged: true }], slowest: [{ i: 0, ch: 'Rhythm', ms: 9000 }], byCh: [{ ch: 'Valves', n: 4, correct: 3 }, { ch: 'Rhythm', n: 3, correct: 1 }], review: { missed: ['a'] } });
  const result = full(), block = { result }, kit = kitOf(asked);
  const S = { mockLast: block, flagged: new Set(['a']), screen: 'mockreport', mock: null, mocks: [] };
  const html = draw(result, { S: watched(S, STATE_READS, 'S'), kit: watched(kit, KIT_READS, 'kit') });
  draw(null, { S: watched({ mockLast: null, flagged: new Set() }, STATE_READS, 'S'), kit: watched(kitOf([]), KIT_READS, 'kit') });
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads the block last handed in and the Flagged list, and nothing else', !html.startsWith('THREW') && names(STATE_READS) === 'flagged mockLast', names(STATE_READS));
  ok('of the kit it asks for six names', names(KIT_READS) === 'MockExam chIcon e icon mockLookup semText', names(KIT_READS));
  ok('it sets, deletes and defines nothing on either', !html.startsWith('THREW') && wrote.length === 0, wrote.join(', ') || 'nothing');
  const grades = asked.filter(a => a[0] === 'grade'), reviews = asked.filter(a => a[0] === 'reviewIds');
  ok('the block is graded once, with the page\'s mockLookup() itself', grades.length === 1 && grades[0][1] === block && grades[0][2] === kit.mockLookup, grades.length + ' grade(s)');
  ok('and what there is to learn from is asked of that grade, once', reviews.length === 1 && reviews[0][1] === result && reviews[0][2] === 'missed', reviews.map(a => a[2]).join(' '));
  /* Frozen all the way down: in a strict module a write throws, and draw() then says THREW. The chapters are
     given weakest last, so a module that put the grade's own list in order where it stood would throw. */
  const deep = o => { if (o && typeof o === 'object' && !(o instanceof Set)) { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const cold = deep(full()), warm = full();
  const frozen = draw(cold, { S: Object.freeze({ mockLast: Object.freeze({ result: cold }), flagged: new Set(['a']) }), kit: Object.freeze(kitOf([])) }), loose = draw(warm, { flagged: ['a'] });
  ok('given the state, the block, its grade and the kit frozen, it draws the same report', !frozen.startsWith('THREW') && frozen === loose && rowsOf(frozen).length === 2, frozen.slice(0, 80));
  const before = J(warm.byCh); draw(warm);
  ok('and the grade\'s list of chapters is as it was, in the order it was given', J(warm.byCh) === before && warm.byCh[0].ch === 'Valves');
}

head('the page hands the module what it has, and keeps what the buttons name');
{
  /* Read with its comments blanked: the page explains itself, and quotes what is looked for. Positions are
     kept, so code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/mockreport.js]@@';
  const LINE = 'function buildMockReport(){ return MockReportScreen.screenHtml(S,CH_COLORS,CH_SHORT,{MockExam,mockLookup,chIcon,e,icon,semText}); }';
  ok('buildMockReport() is one line: the state, the two tables of chapters, and the kit', count(LINE) === 1 && count('function buildMockReport(') === 1, `${count(LINE)} such line(s), ${count('function buildMockReport(')} declaration(s)`);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT), `${count(SLOT)} slot(s)`);
  const handed = String(g1(page, /function buildMockReport\(\)\{ return MockReportScreen\.screenHtml\(S,CH_COLORS,CH_SHORT,\{([^}]*)\}\); \}/));
  ok('the kit is the six names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 6 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  /* The block's set-up says "no time limit" too, so the report's is known with the comma it follows the time by. */
  const WORDS = [NONE, 'This block, by chapter', 'to learn from', 'In your Flagged list', 'Time ran out at', ', no time limit', 'Mock block', 'id="mockSummary"', 'id="mockTime"'];
  ok('and the report\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const some = draw(graded({ review: { missed: ['a'] } }));
  const handlers = [...new Set(handlersOf(some).map(h => h.split(' ')[0]))].sort();
  ok('its buttons name two actions', J(handlers) === J(['goSessions', 'mockReview']), handlers.join(' '));
  const TABLE = { goSessions: 'goSessions:()=>goSessions(),', mockReview: 'mockReview:el=>mockReview(el.dataset.mode),' };
  const table = (page.match(/const ACTIONS=\{([\s\S]*?)\n\};/) || [])[1] || '';
  ok('each is in the page\'s ACTIONS table once, calling the page\'s function of that name, and the listener is installed; mockReview passes the set from the button\'s data',
     handlers.length === 2 && handlers.every(n => table.split(TABLE[n]).length === 2) && count('Actions.install(document,ACTIONS);') === 1, handlers.map(n => n + ':' + (table.split(TABLE[n] || '\u0000').length - 1)).join(' '));
  /* A tap, as the page takes it: the real src/core/actions.js on a stand-in document, the page's own ACTIONS table over
     stand-ins that record their calls, and each button the module drew, with the attributes it drew, as the element. */
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const stubs = ['goHome', 'memForget', 'memForgetAll', 'setLab', 'startQuiz', 'askApexMisses', 'practiceAnnotated', 'goStudy', 'mockReview', 'goSessions'].map(n => `function ${n}(){ tcalls.push(${JSON.stringify(n)} + (arguments.length ? " " + [].slice.call(arguments).join(" ") : "")); }`).join('\n');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'actions.js'), 'utf8') + '\nvar S={chapter:null};\n' + stubs + '\n'
    + (page.match(/const ACTIONS=\{[\s\S]*?\n\};/) || ['const ACTIONS={};'])[0].replace(/^const /, 'var ') + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);', tctx);
  for (const m of some.matchAll(/<button\b([^>]*)>/g)) {
    const at = Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], x[2]])); if (!('data-action' in at)) continue;
    const el = { nodeType: 1, getAttribute: k => (k in at ? at[k] : null), dataset: { mode: at['data-mode'] }, closest: sel => (sel === '[data-action]' ? el : null) };
    tctx.listeners.filter(l => l[0] === 'click').forEach(l => l[1]({ target: el }));
  }
  ok('tapped through the real Actions and the page\'s table: review the missed, review all, and back to Sessions', J(tcalls) === J(['mockReview missed', 'mockReview all', 'goSessions']), J(tcalls));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));

  /* The page's own line, helpers and mockLookup(), with the real MockExam and this module where their slots
     stand, in a context that has nothing else. The block is made and answered here, and what the report
     should say of it is worked out here: four questions, two right, one wrong, one blank; then a fifth that
     the bank no longer has, which is neither right nor wrong. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const helpers = [whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function semText(v){', '\n'), whole('function chIcon(ch,cls){', '\n'),
    whole('const mockHas=id=>', '\n'), whole('const mockLookup=id=>', '\n')].join('\n');
  const ctx = {
    CH_ICONS: { Rhythm: 'zap' }, CH_COLORS: { Rhythm: '#6366F1' }, CH_SHORT: { 'Valves & more': 'Valves' },
    QBYID: { r1: { id: 'r1', ch: 'Rhythm', ci: 0 }, r2: { id: 'r2', ch: 'Rhythm', ci: 1 }, v1: { id: 'v1', ch: 'Valves & more', ci: 2 }, v2: { id: 'v2', ch: 'Valves & more', ci: 3 } },
    S: { mockLast: null, flagged: new Set() },
  };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(helpers + '\n' + read('src/core/mockexam.js') + '\n' + read('src/app/mockreport.js') + '\n' + LINE + '\n"loaded"');
  const none = String(ask('buildMockReport()'));
  ok('with no block handed in, the page\'s own line says so', loaded === 'loaded' && none.includes(NONE) && buttonsOf(none).length === 1, String(loaded).slice(0, 80) + ' · ' + none.slice(0, 60));

  /* r1 right, r2 wrong and flagged, v1 right, v2 left blank, and "gone" answered: 2 of 5 is 40%. */
  ask(`S.mockLast = { v: 1, ids: ['r1', 'r2', 'v1', 'v2', 'gone'], sel: { 0: 0, 1: 0, 2: 2, 4: 1 }, flag: { 1: true }, ms: { 0: 30000, 1: 61000, 2: 5000 }, secPerQ: 90, elapsedMs: 125000, expired: false, done: true }; S.flagged = new Set(['r2']);`);
  const html = String(ask('buildMockReport()')), s = scoreOf(html), rows = rowsOf(html);
  ok('a block answered here is graded by the real MockExam through the page\'s mockLookup(): two right of five is 40%, red, and a question the bank no longer has is not answered, not wrong',
     s.pct === '40%' && s.stroke === 'var(--red)' && s.ink === 'var(--red-ink)' && summaryOf(html) === '2 correct · 1 wrong · 2 not answered · of 5', J([s.pct, s.stroke, s.ink, summaryOf(html)]));
  ok('the time is the real clock\'s: two minutes five of the seven and a half the block allowed, about 25 s a question', timeOf(html) === '02:05 of 07:30 · about 25 s a question', timeOf(html));
  ok('a chapter each, the weakest first, a question the bank no longer has under "Other", and a name escaped by the page\'s e()',
     J(rows.map(r => [r.name, r.count, r.pct])) === J([['Other', '0/1', '0%'], ['Rhythm', '1/2', '50%'], ['Valves &amp; more', '1/2', '50%']]) && rows[1].accent === '#6366F1' && rows[2].accent === 'var(--teal)', J(rows.map(r => [r.name, r.count, r.pct])));
  ok('the icons are the page\'s: the chapter\'s own, a pin for a chapter with none, and the book for a red score',
     html.includes('<span class="chp-icon"><svg class="icon" aria-hidden="true"><use href="#i-zap"></use></svg></span>') && html.includes('<use href="#i-pin">') && html.includes('<svg class="icon icon-lg" aria-hidden="true"><use href="#i-book"></use></svg> Keep Studying!'));
  ok('the slowest are by number, short name and time, slowest first', J(slowLines(html).slice(-1)) === J(['<b>Slowest</b> Q2 (Rhythm, 01:01) · Q1 (Rhythm, 00:30) · Q3 (Valves, 00:05)']), J(slowLines(html).slice(-1)));
  const flagNow = () => slowLines(String(ask('buildMockReport()')))[0];
  const kept = flagNow(); ask('S.flagged.delete("r2")'); const dropped = flagNow();
  ok('the flag line follows the Flagged list as it is now: 1 of 1, and 0 of 1 once the flag is taken off',
     kept === '<b>1 flagged</b> — 1 of them not right. In your Flagged list: 1 of 1.' && dropped === '<b>1 flagged</b> — 1 of them not right. In your Flagged list: 0 of 1.', kept + ' · ' + dropped);
  ok('three wrong, blank or flagged are offered to learn from, and all five to review', J(buttonsOf(html).map(b => b[1].replace(/<svg[\s\S]*?<\/svg>\s*/, ''))) === J(['Review the 3 to learn from', 'Review all 5', 'Back to Sessions']), J(buttonsOf(html).map(b => b[1].replace(/<svg[\s\S]*?<\/svg>\s*/, ''))));
  ask('S.mockLast.expired = true; S.mockLast.elapsedMs = 450000;');
  ok('and a block that ran out says when', timeOf(String(ask('buildMockReport()'))) === 'Time ran out at 07:30 · about 90 s a question', timeOf(String(ask('buildMockReport()'))));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
