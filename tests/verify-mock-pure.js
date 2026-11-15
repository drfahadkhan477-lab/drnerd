#!/usr/bin/env node
/*
 * A mock exam block's screen — src/app/mock.js.
 *
 *   node tests/verify-mock-pure.js
 *
 * Pure Node, over invented blocks. The module is given the page's state and a kit and returns markup; nothing
 * in the first five parts has a page. The kit there is stand-ins: MockExam.states() hands back cells this
 * file wrote, mockClockText() says "CLOCK", mockPaceText() "PACE", mockCellLabel() "CELL n", e('x') is "E(x)",
 * so what the screen is expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - no block, or no question: one line and the way back to Sessions;
 *   - paused: the clock stopped, time left or elapsed, the question hidden, and Resume;
 *   - the block: the clock, the place, pause, progress, answered and flagged, the pace; the question, its
 *     options with the chosen one pressed; back, flag, next or "Review and hand in"; the grid; the keys;
 *   - the summary: answered and the time, the blank and flagged as ways back, back to the block, hand in;
 *   - that it reads two names of the state and eight of the kit, and changes nothing;
 *   - the page's line, the handlers and ids the markup names, and that line over the page's own mock
 *     helpers and the real MockExam on a block made here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/mock.js').MockScreen;

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

/* A block of three: the second is on screen, the first answered and flagged, the third blank. */
const CELLS = [{ n: 1, answered: true, flagged: true, current: false }, { n: 2, answered: false, flagged: false, current: true }, { n: 3, answered: false, flagged: false, current: false }];
const block = over => Object.assign({ ids: ['a', 'b', 'c'], i: 1, sel: { 0: 1 }, flag: { 0: true }, secPerQ: 90, paused: false }, over);
const Q = { s: 'the stem', o: [{ l: 'A', t: 'one' }, { l: 'B', t: 'two' }] };
const kitOf = (over, cells) => Object.assign({
  MockExam: { states: () => ({ n: 3, answered: 1, flagged: 1, cells: cells || CELLS }), pace: () => ({ status: 'behind' }), urgency: () => 'URG' },
  mockQ: () => Q, mockClockText: () => 'CLOCK', mockPaceText: () => 'PACE', mockCellLabel: c => 'CELL ' + c.n,
  e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']', window: { innerWidth: 1194 },
}, over);
const draw = (bOver, kOver, view, cells) => run(() => M.screenHtml({ mock: bOver === null ? null : block(bOver), mockView: view || 'q' }, kitOf(kOver, cells)));
const handlersOf = html => [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]);
const GONE = '<div class="mock-wrap"><div class="mock-gone"><p>No block is open.</p>\n    <button class="btn btn-next" type="button" onclick="goSessions()">[icon arrow-left icon-sm] Back to Sessions</button></div></div>';

head('no block, or no question');
{
  ok('with no block open it says so, with the way back to Sessions', draw(null) === GONE, draw(null).slice(0, 80));
  ok('the same when the block has no question to show', draw({}, { mockQ: () => null }) === GONE);
}

head('paused');
{
  const html = draw({ paused: true });
  ok('it says so, and the question is hidden', html.includes('<h2>Paused</h2>') && !html.includes('the stem') && !html.includes('mock-opt'));
  ok('the clock is shown big, with its urgency, "left" for a timed block', html.includes('<div class="mock-clockbox big"><span class="mock-clock" id="mockClock" data-urgency="URG">CLOCK</span><span class="mock-clock-lab">left</span></div>'));
  ok('"elapsed" for an untimed one', draw({ paused: true, secPerQ: 0 }).includes('<span class="mock-clock-lab">elapsed</span>'));
  ok('Resume, by mockUnpause()', J(handlersOf(html)) === J(['mockUnpause()']) && html.includes('[icon play icon-sm] Resume'));
}

head('the block');
{
  const html = draw();
  ok('the clock, as a timer that does not speak each second, with its urgency', html.includes('<span class="mock-clock" id="mockClock" role="timer" aria-live="off" data-urgency="URG">CLOCK</span><span class="mock-clock-lab">left</span>'));
  ok('the place, the pause and the progress', html.includes('<span class="q-counter">Question 2 of 3</span>') && html.includes('onclick="mockPause()" aria-label="Pause the block"') && html.includes('style="transform:scaleX(0.3333)"'));
  ok('how many are answered and flagged, and the pace through e(), with its status', html.includes('<span id="mockSub">1 answered · 1 flagged</span>') && html.includes('id="mockPace" data-status="behind">E(PACE)</span>'));
  const two = draw({}, { MockExam: { states: () => ({ n: 3, answered: 2, flagged: 0, cells: CELLS }), pace: () => ({ status: 'ahead' }), urgency: () => 'URG' } });
  ok('answered and flagged are each their own count', two.includes('<span id="mockSub">2 answered · 0 flagged</span>') && two.includes('data-status="ahead"'));
  ok('no pace status when there is no pace', draw({}, { MockExam: { states: () => ({ n: 3, answered: 1, flagged: 1, cells: CELLS }), pace: () => null, urgency: () => 'URG' } }).includes('id="mockPace" data-status="">'));
  ok('the question, through e(), numbered by its place', html.includes('Question 2</div>\n      E(the stem)'));
  const opts = [...html.matchAll(/<button class="(opt mock-opt[^"]*)" type="button" data-mi="(\d)"\s+onclick="mockPick\((\d)\)" aria-pressed="([^"]*)"[^>]*>\s*<span class="opt-letter">([^<]*)<\/span><span class="opt-text">([^<]*)</g)].map(m => m.slice(1));
  ok('an option for each, by index, letter and words through e(), none chosen here', J(opts) === J([['opt mock-opt', '0', '0', 'false', 'E(A)', 'E(one)'], ['opt mock-opt', '1', '1', 'false', 'E(B)', 'E(two)']]), J(opts));
  const picked = [...draw({ i: 0 }).matchAll(/class="(opt mock-opt[^"]*)"[^>]*aria-pressed="([^"]*)"/g)].map(m => [m[1], m[2]]);
  ok('the chosen option is picked and pressed', J(picked) === J([['opt mock-opt', 'false'], ['opt mock-opt picked', 'true']]), J(picked));
  ok('a figure\'s panels are marked, and the question\'s notice through e()', draw({}, { mockQ: () => Object.assign({}, Q, { imgopt: true, flag: 'N<x>' }) }).includes('class="opt mock-opt img-opt"') && draw({}, { mockQ: () => Object.assign({}, Q, { flag: 'N<x>' }) }).includes('<span>E(N<x>)</span>'));
  ok('back is disabled on the first question only', /onclick="mockPrev\(\)" aria-label="Previous question" disabled>/.test(draw({ i: 0 })) && !/aria-label="Previous question" disabled/.test(html));
  ok('the flag is a toggle, pressed when this question is flagged', draw({ i: 0 }).includes('class="btn mock-flag on" id="mockFlagBtn" type="button" onclick="mockFlag()" aria-pressed="true"') && html.includes('class="btn mock-flag" id="mockFlagBtn" type="button" onclick="mockFlag()" aria-pressed="false"'));
  ok('"Next", and on the last question "Review and hand in"', html.includes('onclick="mockNext()">Next [icon arrow-right') && draw({ i: 2 }).includes('onclick="mockNext()">Review and hand in [icon arrow-right'));
  const cells = [...html.matchAll(/<button class="(mock-cell[^"]*)" type="button"\s+data-mc="(\d+)" onclick="mockGo\((\d+)\)" aria-label="([^"]*)"( aria-current="true")?>(\d+)<\/button>/g)].map(m => m.slice(1));
  ok('a cell for each question, marked answered, flagged and current, each going to it, named for a screen reader',
     J(cells) === J([['mock-cell done flag', '0', '0', 'CELL 1', undefined, '1'], ['mock-cell cur', '1', '1', 'CELL 2', ' aria-current="true"', '2'], ['mock-cell', '2', '2', 'CELL 3', undefined, '3']]), J(cells));
  ok('"End block", by mockEnd()', html.includes('onclick="mockEnd()">[icon check icon-sm]<span>End block</span>'));
  ok('a wide screen is told the keys; a screen under 768 is not', html.includes('Press <kbd>A</kbd>–<kbd>E</kbd> to answer') && !draw({}, { window: { innerWidth: 767 } }).includes('kb-hint') && draw({}, { window: { innerWidth: 768 } }).includes('kb-hint'));
}

head('the summary before handing in');
{
  const html = draw({}, {}, 'end');
  ok('it asks, and says how many are answered and the time left', html.includes('<h2 tabindex="-1">Hand in this block?</h2>') && html.includes('1 of 3 answered · <span class="mock-clock sm" id="mockClock" data-urgency="URG">CLOCK</span> left'));
  ok('for an untimed block, the time so far, with no urgency', draw({ secPerQ: 0 }, {}, 'end').includes('<span class="mock-clock sm" id="mockClock" data-urgency="none">CLOCK</span> so far'));
  const blank = [...(g1(html, /<b>2 not answered<\/b> — counted as wrong\s*<div class="mock-chips">([\s\S]*?)<\/div>/) || '').matchAll(/onclick="mockGo\((\d+)\)" aria-label="Go to question (\d+)">(\d+)</g)].map(m => m.slice(1));
  ok('the questions not answered, counted as wrong, each a way back to it', J(blank) === J([['1', '2', '2'], ['2', '3', '3']]), J(blank));
  ok('the flagged, to look at again, each a way back', html.includes('<b>1 flagged</b> — to look at again') && html.includes('<button class="mock-chip flag" type="button" onclick="mockGo(0)" aria-label="Go to question 1">1</button>'));
  const all = draw({}, {}, 'end', CELLS.map(c => Object.assign({}, c, { answered: true, flagged: false })));
  ok('with every question answered and none flagged, it says so, and lists none', all.includes('<div class="mock-end-sec ok">Every question has an answer.</div>') && !all.includes('not answered</b>') && !all.includes('flagged</b>'));
  ok('back to the block, at the question it was on, and "Hand in"', html.includes('onclick="mockGo(S.mock.i)">[icon arrow-left icon-sm] Back to the block</button>') && html.includes('onclick="mockSubmit()">Hand in [icon check icon-sm]</button>'));
  ok('the summary is what endHtml() draws for the same block', html === run(() => M.endHtml({ mock: block(), mockView: 'end' }, kitOf())));
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
  const outs = [['q', {}], ['q', { paused: true }], ['end', {}]].map(([v, b]) => run(() => M.screenHtml(watched({ mock: watched(block(b), new Set(), 'block'), mockView: v, screen: 'mock', mocks: [] }, S_READS, 'S'), watched(kitOf(), KIT_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads the block and which view, and nothing else', !outs.some(o => o.startsWith('THREW')) && names(S_READS) === 'mock mockView', names(S_READS));
  ok('of the kit, eight names', names(KIT_READS) === 'MockExam e icon mockCellLabel mockClockText mockPaceText mockQ window', names(KIT_READS));
  ok('it sets, deletes and defines nothing on the state, the block or the kit', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.screenHtml(deep({ mock: block(), mockView: 'q' }), deep(kitOf())));
  ok('given the block and the kit frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === draw(), frozen.slice(0, 60));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/mock.js]@@';
  const LINE = 'function buildMock(){ return MockScreen.screenHtml(S,{MockExam,mockQ,mockClockText,mockPaceText,mockCellLabel,e,icon,window}); }';
  ok('buildMock() is one line: the state and the kit', count(LINE) === 1 && count('function buildMock(') === 1);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT));
  const handed = String(g1(page, /MockScreen\.screenHtml\(S,\{([^}]*)\}\); \}/));
  ok('the kit is the eight names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 8 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('buildMockEnd() is no longer the page\'s; the four mock helpers the ticker and keys use are', count('function buildMockEnd(') === 0 && !/[^.\w$]buildMockEnd\(/.test(page) && ['function mockQ(', 'function mockClockText(', 'function mockPaceText(', 'function mockCellLabel('].every(t => count(t) === 1));
  const WORDS = ['No block is open.', 'Hand in this block?', 'Every question has an answer.', 'Review and hand in', 'The clock is stopped and the question is hidden.'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = draw() + draw({ paused: true }) + draw({}, {}, 'end') + draw(null);
  const handlers = [...new Set(handlersOf(all).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its markup names ten handlers', J(handlers) === J(['goSessions', 'mockEnd', 'mockFlag', 'mockGo', 'mockNext', 'mockPause', 'mockPick', 'mockPrev', 'mockSubmit', 'mockUnpause']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  const ids = ['mockClock', 'mockPace', 'mockSub', 'mockProg', 'mockFlagBtn'];
  ok('the five elements the ticker and the keys repaint are each looked up by the page, and drawn once, by those ids',
     ids.every(id => count("getElementById('" + id + "')") === 1 && times(draw(), 'id="' + id + '"') === 1), ids.map(id => id + ':' + count("getElementById('" + id + "')") + '/' + times(draw(), 'id="' + id + '"')).join(' '));
  ok('and the grid\'s cells by the class and the data they find them by', count("document.querySelectorAll('.mock-cell')") >= 1 && count('el.dataset.mc') >= 1 && times(draw(), '<button class="mock-cell') === 3 && times(draw(), 'data-mc="') === 3);

  /* The page's own line and mock helpers, its icon() and e(), and the real MockExam, on a block made here. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = [read('src/core/mockexam.js'), whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function mockQ(){', '\n'), whole('function mockClockText(r){', '\n'),
    whole('function mockPaceText(r){', '\n}'), whole('function mockCellLabel(c){', '\n'), read('src/app/mock.js'), whole('function buildMock(){', '\n')].join('\n');
  const ctx = { innerWidth: 1194, QBYID: { a: { id: 'a', s: 'A <b>stem</b>', o: [{ l: 'A', t: 'One' }, { l: 'B', t: 'Two & three' }] }, b: { id: 'b', s: 'Second', o: [{ l: 'A', t: 'x' }, { l: 'B', t: 'y' }] } },
    S: { mockView: 'q', mock: { v: 1, ids: ['a', 'b'], i: 0, far: 0, sel: { 0: 1 }, flag: {}, ms: {}, secPerQ: 90, chapter: null, startedAt: 0, elapsedMs: 30000, paused: false, done: false, submittedAt: null, expired: false, last: null } } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const html = String(ask('buildMock()'));
  ok('the page\'s own line draws the block, its words escaped by the page\'s e()', loaded === 'loaded' && html.includes('A &lt;b&gt;stem&lt;/b&gt;') && html.includes('<span class="opt-text">Two &amp; three</span>'), String(loaded).slice(0, 60) + ' · ' + html.slice(0, 60));
  ok('the clock is the real one: two questions at 90 s, thirty seconds in, 2:30 left', g1(html, /id="mockClock"[^>]*>([^<]*)</) === '02:30', g1(html, /id="mockClock"[^>]*>([^<]*)</));
  ok('the grid is the real states: the first answered and current, the second not', html.includes('<button class="mock-cell done cur" type="button"') && html.includes('aria-label="Question 1, answered, current" aria-current="true">1</button>') && html.includes('aria-label="Question 2, not answered">2</button>'));
  ask('S.mockView = "end"');
  const end = String(ask('buildMock()'));
  ok('the summary over the real states: one of two answered, the second not, as a way back to it', end.includes('1 of 2 answered') && end.includes('<b>1 not answered</b>') && end.includes('onclick="mockGo(1)" aria-label="Go to question 2">2</button>'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
