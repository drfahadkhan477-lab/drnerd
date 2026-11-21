#!/usr/bin/env node
/*
 * The Sessions screen — src/app/sessions.js.
 *
 *   node tests/verify-sessions-pure.js
 *
 * Pure Node, over invented visits. The module is given the page's state, the chapters and a kit and returns
 * markup; nothing in the first six parts has a page. The kit there is stand-ins: MockExam.states() hands back
 * counts this file wrote, fmtClock(ms, dir) says "CLK(ms,dir)", remainingMs() "REM", mockStartText()
 * "START<now>", e('x') is "E(x)", so what the screen is expected to say is worked out here and never read back
 * from the module.
 *
 * What is measured, rather than assumed:
 *   - the screen: the way back to Labs, what it is for, the mock card and then the voice card;
 *   - the card: its id, and "live" while a block is open;
 *   - a block open: how far it is, time left or so far, resume, and discard asking for a second tap;
 *   - setting one up: the sizes and paces with the chosen one pressed, the chapter menu, the start button,
 *     the "set aside" note, and the last block's score as the way to its report when the report is its own;
 *   - the voice card, only where the browser can speak and listen;
 *   - that it reads three names of the state and ten of the kit, and changes nothing;
 *   - the page's lines, the handlers and ids the markup names, and those lines over the page's own helpers,
 *     its own setMockCfg() and the real MockExam.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/sessions.js').SessionsScreen;

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

const CH = ['A&a', 'B<x>'];
const ME = { PACES: [45, 75], states: () => ({ n: 9, answered: 4, flagged: 2 }), remainingMs: () => 'REM', fmtClock: (ms, dir) => 'CLK(' + ms + (dir ? ',' + dir : '') + ')' };
const kitOf = over => Object.assign({
  MockExam: ME, _mockCfg: { n: 40, sec: 75, ch: 'B<x>' }, _mockArm: false, _mockLost: false,
  mockSize: () => 40, mockSizes: () => [20, 40], mockStartText: () => 'START<now>', voiceAvailable: () => true,
  e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
}, over);
const state = over => Object.assign({ mock: null, mocks: [], mockLast: null }, over);
const BLOCK = { secPerQ: 90, elapsedMs: 5000 };
const inner = (sOver, kOver) => run(() => M.mockInnerHtml(state(sOver), CH, kitOf(kOver)));
const card = (sOver, kOver) => run(() => M.mockCardHtml(state(sOver), CH, kitOf(kOver)));
const screen = (sOver, kOver) => run(() => M.screenHtml(state(sOver), CH, kitOf(kOver)));
const voice = kOver => run(() => M.voiceCardHtml(kitOf(kOver)));
/* docs/ROADMAP.md, E2. Attribute names, read tag by tag with each value consumed whole, so text inside a value is never
   taken for a name; and the actions the markup names, in the order drawn. */
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);
/* A chip: its class, the setting it is drawn for (data-n or data-sec) and that value, whether it is pressed, then what
   its action hands setMockCfg(): the setting it names (data-cfg) and the value under that setting's own name, which is
   no value at all if the two names differ; and its label. */
const chips = (html, key) => [...html.matchAll(/<button class="(mock-pick[^"]*)" type="button" data-action="setMockCfg" data-cfg="([a-z]+)" data-([a-z]+)="([^"]*)" aria-pressed="([^"]*)">(.*?)<\/button>/g)]
  .map(m => [m[1], m[3], m[4], m[5], m[2], m[2] === m[3] ? m[4] : '(no data-' + m[2] + ')', m[6]]).filter(c => c[1] === key);

head('the screen');
{
  const html = screen();
  ok('the way back to Labs, by the goLabs action', html.includes('<button class="btn sb-back" type="button" data-action="goLabs">[icon arrow-left icon-sm] Labs</button>'));
  ok('what Sessions is for', html.includes('<span class="page-eyebrow">[icon alarm icon-sm] Sessions</span>') && html.includes('<h1 class="page-title">Practise under pressure</h1>') && html.includes('A timed block like the real exam, or ten questions answered out loud.'));
  ok('the page is found by its id', html.startsWith('<div class="sessions-page" id="sessionsPage">'));
  ok('the feed is the mock card and then the voice card, and nothing after them', html.endsWith('<div class="feed sessions-feed">' + card() + voice() + '</div></div>') && card().length > 100 && voice().length > 100, html.slice(-60));
  ok('where the browser cannot speak and listen, the feed is the mock card alone', screen({}, { voiceAvailable: () => false }).endsWith('<div class="feed sessions-feed">' + card() + '</div></div>'));
  ok('the mock card on the screen is this visit\'s: a block open shows as open', screen({ mock: BLOCK }, { _mockArm: true }).includes(card({ mock: BLOCK }, { _mockArm: true })) && screen({ mock: BLOCK }).includes('A block is open'));
}

head('the mock exam\'s card');
{
  ok('the card is found by its id, with its inside', card() === '<div class="feed-card mock-card" id="mockCard" role="group" aria-label="Mock exam">' + inner() + '</div>', card().slice(0, 90));
  ok('"live" while a block is open, and only then', card({ mock: BLOCK }).startsWith('<div class="feed-card mock-card live" id="mockCard"') && card({ mock: BLOCK }).endsWith(inner({ mock: BLOCK }) + '</div>'));
}

head('a block is open');
{
  const html = inner({ mock: BLOCK });
  ok('it says so, as in progress', html.includes('<span class="fc-badge">[icon alarm] MOCK EXAM</span><span class="pace-pill ok">In progress</span>') && html.includes('<div class="fc-title">A block is open</div>'));
  ok('how far: answered of all, the time left counting down, flagged', html.includes('<div class="fc-sub" id="mockLive">4 of 9 answered · CLK(REM,down) left · 2 flagged</div>'), g1(html, /id="mockLive">([^<]*)</));
  ok('an untimed block says the time so far, counting up', inner({ mock: { secPerQ: 0, elapsedMs: 5000 } }).includes('id="mockLive">4 of 9 answered · CLK(5000) so far · 2 flagged</div>'), g1(inner({ mock: { secPerQ: 0, elapsedMs: 5000 } }), /id="mockLive">([^<]*)</));
  ok('Resume, by the resumeMock action', html.includes('<button class="mock-go" id="mockResume" type="button" data-action="resumeMock">[icon play]<span>Resume the block</span></button>'));
  ok('Discard, by the discardMock action, not armed', html.includes('<button class="mock-quiet" id="mockDiscard" type="button" data-action="discardMock">Discard this block</button>'));
  ok('once tapped, it is armed and asks for a second tap', inner({ mock: BLOCK }, { _mockArm: true }).includes('<button class="mock-quiet arm" id="mockDiscard" type="button" data-action="discardMock">Tap again to discard it</button>'));
  const withHistory = inner({ mock: BLOCK, mocks: [{ ts: 5, correct: 13, n: 20 }], mockLast: { submittedAt: 5 } }, { _mockLost: true });
  ok('nothing to set up, no last block and no "set aside" while one is open: two actions, and no inline handler', J(actionsOf(withHistory)) === J(['resumeMock', 'discardMock']) && inlineOf(withHistory).length === 0 && !withHistory.includes('mock-pick') && !withHistory.includes('mockStart') && !withHistory.includes('Last block') && !withHistory.includes('set aside'), J(actionsOf(withHistory)));
}

head('setting a block up');
{
  const html = inner();
  ok('with none open it says what a block is', html.includes('<div class="fc-title">A timed block, no feedback until you hand it in</div>') && !html.includes('In progress') && !html.includes('mockResume'));
  ok('a chip for each size on offer, the one a block would be pressed', J(chips(html, 'n')) === J([['mock-pick', 'n', '20', 'false', 'n', '20', '<b>20</b><span>questions</span>'], ['mock-pick on', 'n', '40', 'true', 'n', '40', '<b>40</b><span>questions</span>']]), J(chips(html, 'n')));
  const asked = chips(inner({}, { _mockCfg: { n: 40, sec: 75, ch: '' }, mockSize: () => 20 }), 'n').map(c => c[2] + ':' + c[3]);
  ok('pressed is what mockSize() says a block would be, not the size last asked for', J(asked) === J(['20:true', '40:false']), J(asked));
  ok('the sizes are the ones mockSizes() offers', J(chips(inner({}, { mockSizes: () => [7], mockSize: () => 7 }), 'n').map(c => c[2] + ':' + c[3])) === J(['7:true']));
  ok('a chip for each pace and then "no limit", the chosen pace pressed', J(chips(html, 'sec')) === J([['mock-pick', 'sec', '45', 'false', 'sec', '45', '<b>45</b><span>sec each</span>'], ['mock-pick on', 'sec', '75', 'true', 'sec', '75', '<b>75</b><span>sec each</span>'], ['mock-pick', 'sec', '0', 'false', 'sec', '0', '<b>No</b><span>limit</span>']]), J(chips(html, 'sec')));
  ok('"no limit" pressed when no limit is chosen', J(chips(inner({}, { _mockCfg: { n: 40, sec: 0, ch: '' } }), 'sec').map(c => c[2] + ':' + c[3])) === J(['45:false', '75:false', '0:true']));
  const menu = g1(html, /(<select id="mockCh"[\s\S]*?<\/select>)/);
  ok('the chapter menu: all chapters, then each through e(), the chosen one selected, by the mockChapter action', menu === '<select id="mockCh" data-action="mockChapter">\n      <option value="">All chapters</option><option value="E(A&a)">E(A&a)</option><option value="E(B<x>)" selected>E(B<x>)</option></select>', menu);
  ok('with no chapter chosen none is selected', !inner({}, { _mockCfg: { n: 40, sec: 75, ch: '' } }).includes(' selected'));
  ok('the start button says what mockStartText() says, through e(), by the startMock action', html.includes('<button class="mock-go" id="mockStart" type="button" data-action="startMock">[icon alarm]<span>E(START<now>)</span></button>'));
  ok('that the clock runs only on screen', html.includes('<div class="mock-note">The clock runs only while Systole is on screen. Search, Echo and Apex are off while you are in the block.</div>'));
  ok('"set aside" only when a block was lost', inner({}, { _mockLost: true }).includes('<div class="mock-note lost">The block that was open could not be carried on, so it was set aside.</div>') && !html.includes('mock-note lost'));
  ok('with no block handed in, no last block', !html.includes('Last block') && !html.includes('openMockReport'));
  const HIST = [{ ts: 1, correct: 20, n: 20 }, { ts: 5, correct: 13, n: 20 }];
  const own = inner({ mocks: HIST, mockLast: { submittedAt: 5 } });
  ok('the last block\'s score, as the way to its report when the report kept is that block\'s', own.endsWith('<button class="mock-quiet" type="button" data-action="openMockReport">Last block: 65% · see the report</button>'), own.slice(-110));
  ok('with no report, or another block\'s, the score alone and the button off', [null, { submittedAt: 1 }, {}].every(l => inner({ mocks: HIST, mockLast: l }).endsWith('<button class="mock-quiet" type="button" data-action="openMockReport" disabled>Last block: 65%</button>')), inner({ mocks: HIST, mockLast: { submittedAt: 1 } }).slice(-110));
  ok('the score is rounded', inner({ mocks: [{ ts: 5, correct: 1, n: 3 }] }).includes('Last block: 33%</button>'));
  ok('the actions of a set-up: the chips, the menu, start and the report, and no inline handler', J([...new Set(actionsOf(own))]) === J(['setMockCfg', 'mockChapter', 'startMock', 'openMockReport']) && inlineOf(own).length === 0, J([...new Set(actionsOf(own))]) + ' · ' + (inlineOf(own).join(' ') || 'no on* attribute'));
}

head('the voice card');
{
  const html = voice();
  ok('nothing where the browser cannot speak and listen', voice({ voiceAvailable: () => false }) === '');
  ok('the card, found by its id', html.startsWith('<div class="feed-card voice-card" id="voiceCard" role="group" aria-label="Voice session">') && html.includes('<span class="fc-badge">[icon mic] VOICE</span>') && html.includes('Ten questions, read aloud. Needs the microphone.'));
  const bars = [...html.matchAll(/<i style="--k:(\d+)"><\/i>/g)].map(m => +m[1]);
  ok('twenty-eight bars, each numbered for its place in the wave', J(bars) === J(Array.from({ length: 28 }, (_, k) => k)), bars.length + ' bars, last ' + bars[bars.length - 1]);
  ok('the words to say', html.includes('Say <kbd>A</kbd>–<kbd>E</kbd> <kbd>repeat</kbd> <kbd>skip</kbd> <kbd>explain</kbd> <kbd>stop</kbd>'));
  ok('Start, by the startVoice action, and no other, and no inline handler', html.includes('<button class="voice-go" id="voiceStart" data-action="startVoice">[icon mic]<span>Start a voice session</span></button>') && J(actionsOf(html)) === J(['startVoice']) && inlineOf(html).length === 0);
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
  const visits = [{}, { mock: watched(Object.assign({}, BLOCK), new Set(), 'block') }, { mocks: watched([{ ts: 9, correct: 20, n: 20 }, { ts: 5, correct: 13, n: 20 }], new Set(), 'mocks'), mockLast: watched({ submittedAt: 5 }, new Set(), 'mockLast') }];
  const outs = visits.map(v => run(() => M.screenHtml(watched(state(Object.assign({ screen: 'sessions', mockView: 'q' }, v)), S_READS, 'S'), watched(CH.slice(), new Set(), 'CHAPTERS'), watched(kitOf({ _mockCfg: watched({ n: 40, sec: 75, ch: '' }, new Set(), '_mockCfg') }), KIT_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads the block, the blocks handed in and the last report, and nothing else', !outs.some(o => o.startsWith('THREW')) && names(S_READS) === 'mock mockLast mocks', names(S_READS) + ' · ' + outs.map(o => o.slice(0, 30)).join(' | '));
  ok('of the kit, ten names', names(KIT_READS) === 'MockExam _mockArm _mockCfg _mockLost e icon mockSize mockSizes mockStartText voiceAvailable', names(KIT_READS));
  ok('it sets, deletes and defines nothing on the state, the block, the history, the settings or the kit', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.screenHtml(deep(state({ mocks: [{ ts: 9, correct: 20, n: 20 }, { ts: 5, correct: 13, n: 20 }], mockLast: { submittedAt: 5 } })), deep(CH.slice()), deep(kitOf())));
  ok('given everything frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === screen({ mocks: [{ ts: 9, correct: 20, n: 20 }, { ts: 5, correct: 13, n: 20 }], mockLast: { submittedAt: 5 } }) && frozen.includes('Last block: 65% · see the report'), frozen.slice(0, 60));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/sessions.js]@@';
  const KIT = 'const sessionsKit=()=>({MockExam,_mockCfg,_mockArm,_mockLost,mockSize,mockSizes,mockStartText,voiceAvailable,e,icon});';
  const LINE = 'function buildSessions(){ return SessionsScreen.screenHtml(S,CHAPTERS,sessionsKit()); }';
  const INNER = 'function mockCardInner(){ return SessionsScreen.mockInnerHtml(S,CHAPTERS,sessionsKit()); }';
  ok('buildSessions() is one line: the state, the chapters and the kit', count(LINE) === 1 && count('function buildSessions(') === 1);
  ok('mockCardInner() is one line over the same three', count(INNER) === 1 && count('function mockCardInner(') === 1);
  ok('the module is written into the page once, above buildSessions()', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT));
  ok('the kit is made at each drawing, never kept: a function, called by both lines and by nothing else', count(KIT) === 1 && count('sessionsKit') === 3 && count('sessionsKit()') === 2, count('sessionsKit') + ' ' + count('sessionsKit()'));
  const handed = String(g1(page, /const sessionsKit=\(\)=>\(\{([^}]*)\}\);/));
  ok('the kit is the ten names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 10 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('mockCard() and voiceCardHtml() are no longer the page\'s, and nothing in it calls them', count('function mockCard(') === 0 && count('function voiceCardHtml(') === 0 && !/[^.\w$]mockCard\(/.test(page) && !/[^.\w$]voiceCardHtml\(/.test(page));
  ok('mockSize(), mockSizes(), mockStartText() and voiceAvailable() still are', ['function mockSize(', 'function mockSizes(', 'function mockStartText(', 'function voiceAvailable('].every(t => count(t) === 1));
  const WORDS = ['Practise under pressure', 'A block is open', 'Tap again to discard it', 'Hands full? Answer out loud', 'Start a voice session', 'Last block:'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = screen() + screen({ mock: BLOCK }) + screen({ mocks: [{ ts: 5, correct: 13, n: 20 }], mockLast: { submittedAt: 5 } });
  const actions = [...new Set(actionsOf(all))].sort();
  ok('its markup names eight actions and carries no inline handler', J(actions) === J(['discardMock', 'goLabs', 'mockChapter', 'openMockReport', 'resumeMock', 'setMockCfg', 'startMock', 'startVoice']) && inlineOf(all).length === 0, actions.join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));
  /* A tap is looked up in ACTIONS and a choice made in CHANGE_ACTIONS: each action is held to the table for its event. */
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const keyed = (t, n) => (tableOf(t).match(new RegExp('(^|\\s)' + n + ':', 'g')) || []).length;
  const ENTRY = { goLabs: ['ACTIONS', 'goLabs:()=>goLabs(),'], setMockCfg: ['ACTIONS', 'setMockCfg:el=>setMockCfg(el.dataset.cfg,el.dataset[el.dataset.cfg]),'], startMock: ['ACTIONS', 'startMock:()=>startMock(),'],
    resumeMock: ['ACTIONS', 'resumeMock:()=>resumeMock(),'], discardMock: ['ACTIONS', 'discardMock:()=>discardMock(),'], openMockReport: ['ACTIONS', 'openMockReport:()=>openMockReport(),'],
    startVoice: ['ACTIONS', 'startVoice:()=>startVoice(),'], mockChapter: ['CHANGE_ACTIONS', 'mockChapter:el=>setMockCfg(\'ch\',el.value),'] };
  const TABLES = ['ACTIONS', 'INPUT_ACTIONS', 'CHANGE_ACTIONS'];
  ok('each is in the page\'s table for its event once, as written, and in no other: the taps in ACTIONS, the chapter in CHANGE_ACTIONS',
     actions.length === 8 && actions.every(n => ENTRY[n] && TABLES.every(t => keyed(t, n) === (ENTRY[n][0] === t ? 1 : 0)) && tableOf(ENTRY[n][0]).split(ENTRY[n][1]).length === 2),
     actions.map(n => n + ':' + TABLES.map(t => keyed(t, n)).join('/') + (ENTRY[n] && tableOf(ENTRY[n][0]).split(ENTRY[n][1]).length === 2 ? '' : ' (not as written)')).join(' '));
  const CALLS = ['discardMock', 'goLabs', 'openMockReport', 'resumeMock', 'setMockCfg', 'startMock', 'startVoice'];
  ok('they call seven functions the page declares, once each, and the page listens for taps and for choices on the document',
     CALLS.every(n => count('function ' + n + '(') === 1) && count('Actions.install(document,ACTIONS);') === 1 && count("Actions.install(document,CHANGE_ACTIONS,'change');") === 1, CALLS.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  ok('setMockCfg() finds the card by the id the module draws, and draws its inside again with mockCardInner()', count("const card=document.getElementById('mockCard');") === 1 && count('const html=mockCardInner(); if(card.innerHTML!==html) card.innerHTML=html;') === 1 && times(screen(), 'id="mockCard"') === 1);
  const FOCUS = "card.querySelector(k==='n'?'[data-n].on':k==='sec'?'[data-sec].on':'#mockCh')";
  ok('and puts the keyboard back on the pressed chip or the menu, which the module draws as it looks for them', count(FOCUS) === 1 && /class="mock-pick on"[^>]* data-n="40"/.test(inner()) && /class="mock-pick on"[^>]* data-sec="75"/.test(inner()) && times(inner(), 'id="mockCh"') === 1);
  ok('discardMock() puts the keyboard on the armed button by the id the module draws', count("focusEl('#mockDiscard')") === 1 && times(inner({ mock: BLOCK }), 'id="mockDiscard"') === 1);

  /* The page's own lines, settings, helpers and setMockCfg(), its icon() and e(), and the real MockExam, over a pool
     made here: forty-five questions, thirty in one chapter and fifteen in the other. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = [read('src/core/mockexam.js'), whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('const VOICE_SR=()=>', '\n'), whole('function voiceAvailable(){', '\n'),
    whole('let _mockLost=false;', '\n'), whole('let _mockCfg={n:40,', '\n'), whole('function mockAvail(){', '\n'), whole('function mockSizes(){', '\n'), whole('function mockSize(){', '\n'), whole('function mockStartText(){', '\n}'),
    whole('function setMockCfg(k,v){', '\n}'), read('src/app/sessions.js'), whole('const sessionsKit=()=>', '\n'), whole('function mockCardInner(){', '\n'), whole('function buildSessions(){', '\n')].join('\n');
  const cardEl = { innerHTML: '', contains: () => false };
  const ctx = { CHAPTERS: ['Valves & more', 'Rhythm'], POOL: Array.from({ length: 45 }, (_, k) => ({ id: 'q' + k, ch: k < 30 ? 'Valves & more' : 'Rhythm' })),
    document: { activeElement: null, getElementById: id => (id === 'mockCard' ? cardEl : null) }, S: { mock: null, mocks: [], mockLast: null } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const html = String(ask('buildSessions()'));
  const pressed = (h, key) => chips(h, key).map(c => c[2] + ':' + c[3]).join(' ');
  ok('the page\'s own line draws the screen: of forty-five questions, blocks of 20 or 40, 40 and the default pace pressed', loaded === 'loaded' && pressed(html, 'n') === '20:false 40:true' && pressed(html, 'sec') === '60:false 90:true 120:false 0:false', String(loaded).slice(0, 60) + ' · ' + pressed(html, 'n') + ' · ' + pressed(html, 'sec'));
  ok('the start button is the page\'s text over the real clock, and the chapters go through the page\'s e()', html.includes('<span>Start a 40-question block · 1:00:00 on the clock</span>') && html.includes('<option value="Valves &amp; more">Valves &amp; more</option>'), g1(html, /id="mockStart"[^>]*>.*?<span>([^<]*)</));
  ask('webkitSpeechRecognition=function(){};');
  const listensOnly = String(ask('buildSessions()'));
  ask('webkitSpeechRecognition=undefined;speechSynthesis={};SpeechSynthesisUtterance=function(){};');
  const speaksOnly = String(ask('buildSessions()'));
  ask('webkitSpeechRecognition=function(){};');
  ok('no voice card in a browser with no speech, nor in one that only listens or only speaks; one where it does both', [html, listensOnly, speaksOnly].every(h => !h.includes('id="voiceCard"') && h.includes('id="mockCard"')) && String(ask('buildSessions()')).includes('id="voiceCard"'));
  ask("setMockCfg('ch','Rhythm'); setMockCfg('sec','0');");
  ok('the page\'s setMockCfg() draws the card\'s inside again from what it has just written: fifteen in the chapter, no limit', cardEl.innerHTML === String(ask('mockCardInner()')) && pressed(cardEl.innerHTML, 'n') === '15:true' && pressed(cardEl.innerHTML, 'sec') === '60:false 90:false 120:false 0:true' && cardEl.innerHTML.includes('<option value="Rhythm" selected>Rhythm</option>') && cardEl.innerHTML.includes('<span>Start a 15-question block · no time limit</span>'),
     pressed(cardEl.innerHTML, 'n') + ' · ' + pressed(cardEl.innerHTML, 'sec') + ' · ' + g1(cardEl.innerHTML, /id="mockStart"[^>]*>.*?<span>([^<]*)</));
  ask('S.mock={v:1,ids:["a","b"],i:0,far:0,sel:{0:1},flag:{1:true},ms:{},secPerQ:90,chapter:null,startedAt:0,elapsedMs:30000,paused:false,done:false,submittedAt:null,expired:false,last:null}');
  const open = String(ask('buildSessions()'));
  ok('a block open, over the real states and clock: one of two answered, 2:30 left, one flagged', g1(open, /id="mockLive">([^<]*)</) === '1 of 2 answered · 02:30 left · 1 flagged' && open.includes('mock-card live'), g1(open, /id="mockLive">([^<]*)</));
  ask('_mockArm=true');
  ok('and once the page arms the discard, the next drawing asks for the second tap', String(ask('buildSessions()')).includes('id="mockDiscard" type="button" data-action="discardMock">Tap again to discard it</button>') && open.includes('>Discard this block</button>'));
  ask('S.mock=null; _mockLost=true; S.mocks=[{ts:9,correct:1,n:2}]; S.mockLast={submittedAt:9}');
  const after = String(ask('mockCardInner()'));
  ok('a block set aside and the last one handed in are said as the page holds them', after.includes('mock-note lost') && after.endsWith('Last block: 50% · see the report</button>'), after.slice(-70));

  /* A tap, a key and a choice, as the page takes them: the real src/core/actions.js listening on a stand-in document over
     the page's three tables, with a recording stand-in for each function they call, and as the element each control the
     page's own line drew, its attributes read back as a browser reads them. Every control is tapped, typed in and chosen
     from, in the order drawn: the screen set up, with the last block's report on offer and the voice card, and then with
     a block open. The chapter menu holds the chapter chosen. */
  ask("_mockLost=false; _mockCfg.n=40; _mockCfg.sec=90; _mockCfg.ch=''; S.mock=null");
  const setUp = String(ask('buildSessions()'));
  ask('S.mock={v:1,ids:["a","b"],i:0,far:0,sel:{},flag:{},ms:{},secPerQ:90,chapter:null,startedAt:0,elapsedMs:0,paused:false,done:false,submittedAt:null,expired:false,last:null}; _mockArm=false');
  const busy = String(ask('buildSessions()'));
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const tables = TABLES.map(t => (page.match(new RegExp('const ' + t + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + t + '={};'])[0].replace(/^const /, 'var ')).join('\n');
  const called = [...new Set([...tables.matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
  vm.runInContext(read('src/core/actions.js') + '\nvar S={chapter:null}, offlineJob={busy:false};\n'
    + called.map(n => `function ${n}(){ tcalls.push(${J(n)} + (arguments.length ? " " + JSON.stringify([].slice.call(arguments)) : "")); }`).join('\n') + '\n' + tables
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);\nActions.install(doc,INPUT_ACTIONS,"input");\nActions.install(doc,CHANGE_ACTIONS,"change");', tctx);
  const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const controls = h => [...h.matchAll(/<(button|select|input)\b([^>]*)>/g)].map(m => {
    const at = Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], unescape(x[2])]));
    const dataset = Object.fromEntries(Object.keys(at).filter(k => k.startsWith('data-')).map(k => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), at[k]]));
    const el = { nodeType: 1, value: m[1] === 'select' ? 'Rhythm' : '', dataset, getAttribute: k => (k in at ? at[k] : null), closest: sel => (sel === '[data-action]' && 'data-action' in at ? el : null) };
    return el; });
  const fire = (type, h) => { tcalls.length = 0; controls(h).forEach(el => tctx.listeners.filter(l => l[0] === type).forEach(l => l[1]({ type, target: el }))); return tcalls.slice(); };
  const tapsSetUp = fire('click', setUp);
  ok('tapped, set up: Labs, each size and each pace chip setting its own value, Start, the last report, the voice session, each its own function',
     J(tapsSetUp) === J(['goLabs', 'setMockCfg ["n","20"]', 'setMockCfg ["n","40"]', 'setMockCfg ["sec","60"]', 'setMockCfg ["sec","90"]', 'setMockCfg ["sec","120"]', 'setMockCfg ["sec","0"]', 'startMock', 'openMockReport', 'startVoice']), J(tapsSetUp));
  const chose = fire('change', setUp), keyed2 = fire('input', setUp);
  ok('chosen from: the chapter menu sets the chapter chosen, and nothing else answers a choice or a key', J(chose) === J(['setMockCfg ["ch","Rhythm"]']) && J(keyed2) === J([]), J(chose) + ' · ' + J(keyed2));
  const tapsBusy = fire('click', busy);
  ok('tapped, with a block open: Labs, Resume, Discard and the voice session', J(tapsBusy) === J(['goLabs', 'resumeMock', 'discardMock', 'startVoice']), J(tapsBusy));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
