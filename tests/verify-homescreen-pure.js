#!/usr/bin/env node
/*
 * The home screen's pages — src/app/home.js. So far the Labs page; the Brain page and the Home page are still
 * the page's own functions.
 *
 *   node tests/verify-homescreen-pure.js
 *
 * Pure Node, over invented apps. The module is given the page's state, the chapters, how many cards are due and
 * a kit, and returns markup; nothing in the first four parts has a page. The kit there is stand-ins: icon('x')
 * is "[icon x]", the notes are an array this file made, Memory.count() a number this file chose, so what the
 * page is expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the Labs page: what it is, a card for each of the four labs, and the six study tools;
 *   - what Sessions, Chapters, Notes and Memory say of the app as it stands, and without notes or memory;
 *   - that it reads one name of the state and four of the kit, and changes nothing;
 *   - the page's line, the handlers the markup names, and that line over the page's own icon(), with and
 *     without the notes and Apex's memory.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/home.js').HomeScreen;

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

const CH = ['One', 'Two', 'Three'];
const kitOf = over => Object.assign({ REF: [{}, {}, {}, {}], Memory: { count: () => 6 }, TOTAL_Q: 50, icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']' }, over);
const labs = (sOver, dueN, kOver, chapters) => run(() => M.labsHtml(Object.assign({ mock: null }, sOver), chapters || CH, dueN === undefined ? 7 : dueN, kitOf(kOver)));
/* A card of the Labs grid: its class, its handler, its id if it has one, the icon beside its name, its name and what it says. */
const cards = html => [...html.matchAll(/<button class="lab-card ([a-z-]+)"(?: id="([^"]*)")? onclick="([^"]*)">([\s\S]*?)<\/button>/g)].map(m => {
  const inner = m[4]; return { cls: m[1], id: m[2], go: m[3], icon: g1(inner, /<span class="lab-ic" aria-hidden="true">([^<]*)<\/span>/), name: g1(inner, /<span class="lab-txt"><b>([^<]*)<\/b>/), says: g1(inner, /<span class="lab-txt"><b>[^<]*<\/b><i>([^<]*)<\/i>/), open: /<span class="lab-go" aria-hidden="true">Open \[icon arrow-right icon-sm\]<\/span>/.test(inner) };
});
/* A door of the study tools: whether it is the wide one, its handler, its icon, its name and what it says. */
const doors = html => [...html.matchAll(/<button class="(door(?: door-wide)?)" onclick="([^"]*)">\s*<span class="door-ic">([^<]*)<\/span>\s*<span class="door-txt"><b>([^<]*)<\/b><i>([^<]*)<\/i><\/span>/g)].map(m => m.slice(1));

head('the Labs page');
{
  const html = labs();
  ok('what Labs is', html.startsWith('<header class="page-head"><span class="page-eyebrow">[icon activity icon-sm] Labs</span>') && html.includes('<h1 class="page-title">Hear it, see it, read it</h1>') && html.includes('<p class="page-sub">Traces drawn live, echo views to explore, and sounds and strips to practise on.</p></header>'));
  const c = cards(html);
  ok('a card for each lab, in order: the Rhythm Lab, Echo Studio, the Practice Lab, Sessions', J(c.map(x => [x.cls, x.name])) === J([['lab-rhythm', 'Rhythm Lab'], ['lab-echo', 'Echo Studio'], ['lab-practice', 'Practice Lab'], ['lab-sessions', 'Sessions']]), J(c.map(x => [x.cls, x.name])));
  ok('each a way in to its own lab, and no other', J(c.map(x => x.go)) === J(['goLab()', 'goEcho()', 'goPractice()', 'goSessions()']), J(c.map(x => x.go)));
  ok('each with its own icon, and "Open"', J(c.map(x => x.icon)) === J(['[icon activity]', '[icon waveform]', '[icon heart-pulse]', '[icon alarm]']) && c.every(x => x.open), J(c.map(x => x.icon)));
  ok('what the first three are for', J(c.slice(0, 3).map(x => x.says)) === J(['Every trace, drawn live', 'Views, findings and the arithmetic', 'Sounds, tracings, strips']), J(c.slice(0, 3).map(x => x.says)));
  /* From where the grid opens to the tools' heading: one div opened and closed, so the cards are inside it. */
  const grid = html.slice(html.indexOf('<div class="labs-grid">'), html.indexOf('<h3 class="page-h3">Study tools</h3>'));
  ok('the grid holds the four cards, nothing else is a card, and none is outside it', c.length === 4 && times(html, 'class="lab-card') === 4 && cards(grid).length === 4 && times(grid, '<div') === 1 && times(grid, '</div>') === 1, cards(grid).length + ' cards in a grid of ' + times(grid, '<div') + ' div');
  ok('Sessions is found by its id, and says what it holds', c.length === 4 && c[3].id === 'labSessions' && c.slice(0, 3).every(x => x.id === undefined) && c[3].says === 'Timed mock exam · voice drill', J(c[3] || null));
  ok('or, with a mock block open, that one is, to resume', (cards(labs({ mock: { ids: ['a'] } }))[3] || {}).says === 'A mock block is open · resume it', (cards(labs({ mock: { ids: ['a'] } }))[3] || {}).says);
}

head('the study tools');
{
  const html = labs();
  const d = doors(html);
  /* From where the row opens to the page's end: one div opened and closed, so the doors are inside it. */
  const row = html.slice(html.indexOf('<div class="door-row lab-doors">'));
  ok('under their heading, after the labs, and all in their row, which ends the page', html.indexOf('<h3 class="page-h3">Study tools</h3>') > html.indexOf('lab-sessions') && html.indexOf('<div class="door-row lab-doors">') > html.indexOf('Study tools') && html.endsWith('</button>\n    </div>') && doors(row).length === 6 && times(row, '<div') === 1 && times(row, '</div>') === 1, doors(row).length + ' doors in a row of ' + times(row, '<div') + ' div');
  ok('six doors and no seventh button, in order: Chapters, the wide one, then Search, Progress, Notes, Memory, Annotations', times(html, '<button class="door') === 6 && J(d.map(x => [x[0], x[3]])) === J([['door door-wide', 'Chapters'], ['door', 'Search'], ['door', 'Progress'], ['door', 'Notes'], ['door', 'Memory'], ['door', 'Annotations']]), J(d.map(x => [x[0], x[3]])));
  ok('each opens its own tool, and no other', J(d.map(x => x[1])) === J(['goStudy()', 'openSearch()', 'goStats()', 'goRefs()', 'goMemory()', 'goAnnotations()']), J(d.map(x => x[1])));
  ok('each with its own icon', J(d.map(x => x[2])) === J(['[icon book]', '[icon search]', '[icon trending-up]', '[icon folder]', '[icon pin]', '[icon highlighter]']), J(d.map(x => x[2])));
  ok('Chapters says how many chapters and how many cards are due', d.length === 6 && d[0][4] === '3 chapters · 7 due for review', (d[0] || [])[4]);
  ok('or, with none due, how many questions the bank has', (doors(labs({}, 0))[0] || [])[4] === '3 chapters · 50 questions' && (doors(labs({}, 0, { TOTAL_Q: 9 }, ['Only']))[0] || [])[4] === '1 chapters · 9 questions', (doors(labs({}, 0))[0] || [])[4]);
  ok('Search, Progress and Annotations say what they are', J([d[1], d[2], d[5]].map(x => (x || [])[4])) === J(['the whole bank', 'chapter by chapter', 'flags and notes']));
  const notes = (ref) => (doors(labs({}, 7, { REF: ref }))[3] || [])[4];
  ok('Notes says how many references there are', notes([{}, {}, {}, {}]) === '4 references' && notes([{}]) === '1 references', notes([{}, {}, {}, {}]));
  ok('or "your references" with none, and where the app has no notes at all', notes([]) === 'your references' && notes(undefined) === 'your references', notes([]) + ' | ' + notes(undefined));
  const memory = mem => (doors(labs({}, 7, { Memory: mem }))[4] || [])[4];
  ok('Memory says how many things Apex knows', memory({ count: () => 6 }) === '6 things Apex knows', memory({ count: () => 6 }));
  ok('or "what Apex knows" with none, and where its memory is not loaded', memory({ count: () => 0 }) === 'what Apex knows' && memory(undefined) === 'what Apex knows', memory({ count: () => 0 }) + ' | ' + memory(undefined));
  ok('the notes\' count and the memory\'s are each their own', (doors(labs({}, 7, { REF: [{}, {}], Memory: { count: () => 9 } })) || []).slice(3, 5).map(x => x[4]).join(' | ') === '2 references | 9 things Apex knows');
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
  const outs = [null, { ids: ['a'] }].map(mock => run(() => M.labsHtml(watched({ screen: 'home', mock: mock && watched(mock, none(), 'block'), mocks: [], homeLayout: 'signal' }, S_READS, 'S'), watched(CH.slice(), none(), 'CHAPTERS'), 7,
    watched(kitOf({ REF: watched([{}, {}], none(), 'REF'), Memory: watched({ count: () => 6 }, none(), 'Memory') }), KIT_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('of the state it reads whether a block is open, and nothing else', !outs.some(o => o.startsWith('THREW')) && names(S_READS) === 'mock', names(S_READS) + ' · ' + outs.map(o => o.slice(0, 30)).join(' | '));
  ok('of the kit, four names', names(KIT_READS) === 'Memory REF TOTAL_Q icon', names(KIT_READS));
  ok('it sets, deletes and defines nothing on the state, the block, the chapters, the notes, the memory or the kit', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.labsHtml(deep({ mock: { ids: ['a'] } }), deep(CH.slice()), 7, deep(kitOf())));
  ok('given everything frozen, it draws the same page', !frozen.startsWith('THREW') && frozen === labs({ mock: { ids: ['a'] } }) && frozen.includes('A mock block is open'), frozen.slice(0, 60));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/home.js]@@';
  const LINE = "function buildLabs(dueN){ return HomeScreen.labsHtml(S,CHAPTERS,dueN,{REF:typeof REF!=='undefined'?REF:undefined,Memory:typeof Memory!=='undefined'?Memory:undefined,TOTAL_Q,icon}); }";
  ok('buildLabs() is one line: the state, the chapters, how many are due, and the kit, the notes and the memory asked for before they are read', count(LINE) === 1 && count('function buildLabs(') === 1);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT));
  const handed = String(g1(page, /HomeScreen\.labsHtml\(S,CHAPTERS,dueN,\{([^}]*)\}\); \}/)).split(',').map(x => x.split(':')[0]);
  ok('the kit is the four names the module was seen to ask for', KIT_READS.size === 4 && handed.slice().sort().join(' ') === [...KIT_READS].sort().join(' '), handed.join(','));
  ok('buildHome() still draws the Labs page with it, handing on the count of cards due', count('<div class="home-page-in">${buildLabs(dueN)}</div></section>') === 1 && (page.match(/[^.\w$]buildLabs\(/g) || []).length === 2, String((page.match(/[^.\w$]buildLabs\(/g) || []).length));
  const WORDS = ['Hear it, see it, read it', 'Study tools', 'Views, findings and the arithmetic', 'Every trace, drawn live', 'Sounds, tracings, strips', 'things Apex knows', 'A mock block is open · resume it'];
  ok('and the Labs page\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = labs() + labs({ mock: { ids: ['a'] } }, 0);
  const handlers = [...new Set(handlersOf(all).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its markup names ten handlers', J(handlers) === J(['goAnnotations', 'goEcho', 'goLab', 'goMemory', 'goPractice', 'goRefs', 'goSessions', 'goStats', 'goStudy', 'openSearch']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));

  /* The page's own line and its icon(), over an app made here: first with neither notes nor memory declared at all,
     as the page asks before it reads either, then with both. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = [whole('function icon(name, cls){', '\n}'), read('src/app/home.js'), whole('function buildLabs(dueN){', '\n')].join('\n');
  const ctx = { CHAPTERS: ['A', 'B'], TOTAL_Q: 40, S: { mock: null } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const bare = String(ask('buildLabs(3)'));
  /* With the page's icons a door holds an svg, so what each says is read from its text alone. */
  const says = h => [...h.matchAll(/<span class="door-txt"><b>([^<]*)<\/b><i>([^<]*)<\/i>/g)].map(m => m[2]);
  ok('the page\'s own line draws the Labs page in an app with no notes and no memory, without reading either', loaded === 'loaded' && J(says(bare)) === J(['2 chapters · 3 due for review', 'the whole bank', 'chapter by chapter', 'your references', 'what Apex knows', 'flags and notes']), String(loaded).slice(0, 60) + ' · ' + J(says(bare)));
  ok('with the page\'s own icons: eighteen of them and the two traces drawn on the cards, twenty svgs', times(bare, 'class="lab-card') === 4 && times(bare, '<svg') === 20 && !bare.includes('[icon') && !bare.includes('undefined'), times(bare, 'class="lab-card') + ' cards, ' + times(bare, '<svg') + ' svgs');
  ask('REF=[{},{},{}]; Memory={count:()=>2}; S.mock={ids:["a"]}');
  const full = String(ask('buildLabs(0)'));
  ok('and once the app has notes, a memory and a block open, the next drawing says so', full.includes('<i>3 references</i>') && full.includes('<i>2 things Apex knows</i>') && full.includes('<i>A mock block is open · resume it</i>') && full.includes('<i>2 chapters · 40 questions</i>'), g1(full, /<b>Notes<\/b><i>([^<]*)</) + ' | ' + g1(full, /<b>Memory<\/b><i>([^<]*)</));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
