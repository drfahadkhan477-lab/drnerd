#!/usr/bin/env node
/*
 * The topic search's screen — src/app/search.js.
 *
 *   node tests/verify-search-pure.js
 *
 * Pure Node, over invented questions. The module is given the search's state, the page's, two tables of the
 * bank's chapters and a kit, and returns markup; nothing in the first six parts has a page. The kit it is
 * handed there is stand-ins that say what they were asked (e('x') is "E(x)", clip('x', 9) is "CLIP(x,9)"),
 * so what the screen is expected to say is worked out here and never read back from the module. hl() and
 * snippet() are held with the page's own e() and clip(), because what they do is what they make of text.
 *
 * Not asserted: what hl() does with the letters after a word typed. It finds a word with up to four more
 * letters and then writes the word typed alone, so "valve" shows "aortic valves" as "aortic valve". That is
 * as it was before the screen moved, and is not written into a check here.
 *
 * What is measured, rather than assumed:
 *   - hl(): the text escaped first, words of three letters or more marked where they start a word, in any
 *     case, and nothing typed that a pattern would read as more than letters;
 *   - snippet(): the start of the question with no word in it, else about 70 letters before the first
 *     word found, in the stem or the commentary, cut at a word;
 *   - before anything is typed: the topics, the one typed marked, and the hint with the bank's numbers;
 *   - once something is typed: the count, the chapter, nothing matched, and a row for each match;
 *   - the chapter choice, Quiz these N, Clear, and every action on the screen, with no inline handler;
 *   - that it reads three names of the search, two of the page's state and seven of the kit, and
 *     changes nothing it is given;
 *   - the page's one line: what it hands over is what the module asks for, each action is in the page's table for
 *     its event and calls the page's function, and that line over the page's own helpers draws a search the suite
 *     makes, marks what was typed, and, tapped, typed in and chosen from through the real src/core/actions.js,
 *     calls each function with what its control carries.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/search.js').SearchScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const run = f => { try { return String(f()); } catch (err) { return 'THREW ' + err.message; } };

/* The page's own helpers, read out of the page with its comments blanked, for hl() and snippet() and for
   the last part. */
const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
const page = blankComments(raw);
const count = text => page.split(text).length - 1;
const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
const helpers = [whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function clip(s,n){', '\n'), whole('function chInk(hex){', '\n}')].join('\n');
const real = {}; real.window = real; real.themeIsDark = () => false; vm.createContext(real);
try { vm.runInContext(helpers, real); } catch (err) { real.loadError = err.message; }
const PAGE_KIT = { e: s => vm.runInContext('e', real)(s), clip: (s, n) => vm.runInContext('clip', real)(s, n) };
const hl = (t, q) => run(() => M.hl(PAGE_KIT, t, q));
const snip = (q, w) => run(() => M.snippet(PAGE_KIT, q, w));

/* Stand-ins that say what they were asked. None writes a tag, so the words between tags can be read whole. */
const KIT = Object.freeze({
  TOPIC_SUGGEST: Object.freeze(['aortic valve', 'long QT', 'it\'s "x"']), BANK_BY: 'ACC ', TOTAL_Q: 1200,
  chInk: c => 'INK(' + c + ')', clip: (s, n) => 'CLIP(' + s + ',' + n + ')', e: s => 'E(' + s + ')',
  icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
});
const CHAPTERS = Object.freeze(['Arrhythmias', 'Valves']);
const COLORS = Object.freeze({ Arrhythmias: '#112233' });
const question = (id, over) => Object.assign({ id, ch: 'Arrhythmias', n: 12, s: 'stem of ' + id, ex: 'commentary', o: [{ t: 'wrong' }, { t: 'right answer' }], ci: 1, img: 0 }, over);
const draw = (SQ, opts) => { const o = opts || {}; return run(() => M.screenHtml(SQ, o.S || { flagged: new Set(o.flagged || []), missed: new Set(o.missed || []) }, o.chapters || CHAPTERS, o.colors || COLORS, o.kit || KIT)); };
const sq = (q, hits, ch) => ({ q, ch: ch || '', hits: (hits || []).map(x => ({ q: x, score: 1 })), ran: true });

/* The parts of the markup a reader sees. */
const g1 = (s, re) => (s.match(re) || [])[1];
const times = (html, text) => html.split(text).length - 1;
const rowsOf = html => html.split('<button class="hit"').slice(1).map(s => {
  s = s.slice(0, s.indexOf('</button>'));
  return { go: g1(s, /^ data-action="jumpTo" data-qid="([^"]*)"/), edge: g1(s, /border-left-color:([^"]*)"/), tint: g1(s, /class="hit-ch" style="background:([^;]*);/), ink: g1(s, /class="hit-ch" style="[^"]*;color:([^"]*)"/),
    chip: g1(s, /class="hit-ch"[^>]*>([^<]*)</), flags: [...s.matchAll(/<span class="hit-flag[^"]*">([^<]*)<\/span>/g)].map(m => m[1]), fig: g1(s, /<span class="hit-fig">([^<]*)<\/span>/),
    stem: g1(s, /<div class="hit-stem">([\s\S]*?)<\/div>/), ans: g1(s, /<div class="hit-ans">([\s\S]*?)<\/div>/) };
});
/* docs/ROADMAP.md, E2. Attribute names, read tag by tag with each value consumed whole, so text inside a value is never
   taken for a name. */
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);
const ACTION_NAMES = ['goHome', 'jumpTo', 'quizFromSearch', 'searchChapter', 'searchClear', 'searchGo', 'searchInput'];
const labelOf = html => g1(html, /<div class="section-label">([^<]*)<\/div>/);

head('hl(): the words typed, marked in text escaped first');
{
  ok('a word typed is marked where it stands, in the case it was written in', hl('Aortic stenosis', 'aortic') === '<mark>Aortic</mark> stenosis', hl('Aortic stenosis', 'aortic'));
  /* A word typed is found with up to four letters after it, and those letters are then dropped (below). Only a
     word typed whole is held here. */
  ok('a word that is longer than the one typed by more than four letters is not marked', hl('cardiac amyloidosis', 'amyl') === 'cardiac amyloidosis', hl('cardiac amyloidosis', 'amyl'));
  ok('every word of three letters or more is marked, every place it is', hl('QTc and QT and the qtc', 'qtc the') === '<mark>QTc</mark> and QT and <mark>the</mark> <mark>qtc</mark>', hl('QTc and QT and the qtc', 'qtc the'));
  ok('a word of fewer than three letters is not looked for', hl('QT is long', 'qt is') === 'QT is long', hl('QT is long', 'qt is'));
  ok('the text is escaped by the page\'s e() first, and only <mark> is markup', hl('<b>aortic</b> & "x"', 'aortic') === '&lt;b&gt;<mark>aortic</mark>&lt;/b&gt; &amp; &quot;x&quot;', hl('<b>aortic</b> & "x"', 'aortic'));
  ok('nothing typed, or nothing to look for, is the text escaped', hl('a < b', '') === 'a &lt; b' && hl('a < b', null) === 'a &lt; b' && hl('a < b', '!!') === 'a &lt; b', hl('a < b', ''));
  ok('what a pattern would read as more than letters is split away: nothing throws and nothing else is marked', hl('a.b.c (abc) a+b', 'a.b (abc) .*+') === 'a.b.c (<mark>abc</mark>) a+b', hl('a.b.c (abc) a+b', 'a.b (abc) .*+'));
  ok('a word is marked only where it starts a word', hl('preaortic aortic', 'aortic') === 'preaortic <mark>aortic</mark>', hl('preaortic aortic', 'aortic'));
}

head('snippet(): where in a question the word typed is');
{
  const q = { s: 'A man of sixty with exertional chest pain on climbing stairs, and a soft second heart sound at the base.', ex: 'Severe aortic stenosis is the cause; ' + 'x '.repeat(200) };
  ok('with no word typed found, it is the stem cut at 180 by the page\'s clip()', snip(q, 'zebra') === vm.runInContext('clip', real)(q.s, 180) && snip(q, '') === q.s, snip(q, 'zebra'));
  const at = snip(q, 'aortic');
  ok('found in the commentary: it starts about seventy letters before the word, with "…", and goes on to "…"', at.startsWith('…') && at.endsWith('…') && at.includes('Severe aortic stenosis') && !at.includes('A man of'), at.slice(0, 80));
  const near = snip(q, 'sixty');
  ok('found near the start: it starts at the start, with no "…" before it', near.startsWith('A man of sixty') && near.endsWith('…'), near.slice(0, 60));
  const long = snip({ s: 'w '.repeat(150) + 'target ' + 'word '.repeat(100), ex: '' }, 'target');
  ok('it is at most 230 letters of the question and its commentary, cut at a word', long.length <= 232 && long.startsWith('…w ') && long.includes(' target word') && /word…$/.test(long) && long.indexOf('target') >= 70 && long.indexOf('target') <= 72, long.length + ' ' + long.indexOf('target'));
  const far = { s: 'x '.repeat(50) + 'alpha ' + 'y '.repeat(150) + 'beta ' + 'z '.repeat(50), ex: '' };
  ok('it looks for the words typed in the order typed and takes the first of them found, wherever the others are',
     snip(far, 'beta alpha').includes('beta') && !snip(far, 'beta alpha').includes('alpha') && snip(far, 'gamma alpha beta').includes('alpha') && !snip(far, 'gamma alpha beta').includes('beta'), snip(far, 'beta alpha').slice(60, 90));
  const caps = snip({ s: 'x '.repeat(60) + 'Aortic stenosis', ex: '' }, 'AORTIC');
  ok('a word is found in any case', caps.startsWith('…') && caps.includes('Aortic stenosis'), caps.slice(-30));
}

head('before anything is typed');
{
  const html = draw(sq('', []));
  /* The stand-in e() escapes nothing, so the third topic's quotes stand as they are; the topic is read up to the end of
     the tag. Its round trip through the page's own e() is held below. */
  const chips = [...html.matchAll(/<button class="chip( hot)?" data-action="searchGo" data-topic="(.*?)">([^<]*)<\/button>/g)].map(m => [!!m[1], m[2], m[3]]);
  ok('a chip for each topic, through e(), each naming searchGo and carrying itself', J(chips) === J([[false, 'E(aortic valve)', 'E(aortic valve)'], [false, 'E(long QT)', 'E(long QT)'], [false, 'E(it\'s "x")', 'E(it\'s "x")']]), J(chips));
  ok('they are headed "Try a topic", and no count is given', labelOf(html) === 'Try a topic' && !/ match/.test(html));
  ok('the hint says what the search looks in, whose commentary through e(), and how many questions',
     html.includes('<div class="sb-hint">Searches every stem, answer option and the full E(ACC )commentary across all 1200 questions. Runs entirely offline — no API key needed.</div>'), g1(html, /<div class="sb-hint">([^<]*)</));
  ok('no row, no "Quiz these", no Clear and no "nothing matched"', !html.startsWith('THREW') && rowsOf(html).length === 0 && !html.includes('quizFromSearch') && !html.includes('sb-x') && !html.includes('sb-none'));
}

head('once something is typed');
{
  const one = draw(sq('long QT', [question('a')]));
  ok('the chip for what is typed is marked, and the topics are no longer offered', !one.includes('class="chips sug"') && times(draw({ q: 'long QT', ch: '', hits: [] }), 'chip hot') === 0, labelOf(one));
  const hot = run(() => M.screenHtml({ q: '', ch: '', hits: [] }, { flagged: new Set(), missed: new Set() }, CHAPTERS, COLORS, Object.assign({}, KIT, { TOPIC_SUGGEST: [''] })));
  /* Only a topic that is nothing can be marked, since the topics are drawn only while nothing is typed: the
     page's own topics never are. This holds the comparison the markup makes, not something a reader sees. */
  ok('a chip is marked when it is exactly what is typed', times(hot, 'class="chip hot"') === 1, hot.slice(0, 60));
  ok('"1 match", "3 matches", "0 matches"', labelOf(one) === '1 match' && labelOf(draw(sq('x', [question('a'), question('b'), question('c')]))) === '3 matches' && labelOf(draw(sq('x', []))) === '0 matches', labelOf(one));
  ok('with a chapter chosen, in which, through e()', labelOf(draw(sq('x', [question('a')], 'Valves'))) === '1 match in E(Valves)', labelOf(draw(sq('x', [question('a')], 'Valves'))));
  const none = draw(sq('zz<i>', []));
  ok('with nothing found, it says nothing matched what was typed, through e(), and what to try',
     none.includes('<div class="sb-none">Nothing matched <b>E(zz<i>)</b>.<br><span>Try a broader term, or a synonym — the index matches words, not meaning.</span></div>') && !one.includes('sb-none'), g1(none, /<div class="sb-none">([\s\S]*?)<\/div>/));
}

head('a row for each match');
{
  const hits = [question('a', { s: 'stem', o: [{ t: 'one' }, { t: 'two' }, { t: 'the right one' }], ci: 2 }), question('b', { ch: 'Valves', n: 4, img: 2 }), question('c')];
  const rows = rowsOf(draw(sq('word', hits), { flagged: ['a', 'c'], missed: ['b', 'c'] }));
  ok('a row for each, in the order found, each naming jumpTo and carrying its question\'s id through e()', J(rows.map(r => r.go)) === J(['E(a)', 'E(b)', 'E(c)']), J(rows.map(r => r.go)));
  const [a, b, c] = rows.concat([{}, {}, {}]);
  ok('its edge is the chapter\'s colour, its chip that colour at a tint in chInk()\'s ink; a chapter with none takes the teal',
     a.edge === '#112233' && a.tint === '#1122331F' && a.ink === 'INK(#112233)' && b.edge === 'var(--teal)' && b.ink === 'INK(var(--teal))', [a.edge, a.tint, a.ink, b.edge, b.ink].join(' · '));
  ok('the chip names the chapter, through e(), and the question\'s number', a.chip === 'E(Arrhythmias) · 12' && b.chip === 'E(Valves) · 4', a.chip + ' · ' + b.chip);
  ok('"previously missed" before "flagged", each only where it is so', J([a.flags, b.flags, c.flags]) === J([['flagged'], ['previously missed'], ['previously missed', 'flagged']]), J([a.flags, b.flags, c.flags]));
  ok('a question with figures says how many, and one with none says nothing', b.fig === '[icon image icon-sm] 2' && a.fig === undefined, b.fig + ' · ' + a.fig);
  /* With the stand-ins, hl() is the page's e() over what snippet() and clip() made: the stand-in clip()
     writes CLIP(...), and the stand-in e() writes E(...), so the order is on the page. */
  ok('the stem is the snippet where the word typed is, through e(), with the word marked', a.stem === 'E(CLIP(stem,180))', a.stem);
  ok('the answer is the right option cut at 110, through e(), after a tick', a.ans === '[icon check icon-sm] E(CLIP(the right one,110))', a.ans);
  const marked = rowsOf(draw(sq('right', hits), { kit: Object.assign({}, KIT, { e: s => String(s), clip: s => s }) }))[0] || {};
  ok('and what is typed is marked in both', marked.ans === '[icon check icon-sm] the <mark>right</mark> one' && marked.stem === 'stem', marked.ans + ' · ' + marked.stem);
}

head('the controls, and every action on the screen');
{
  const html = draw(sq('word', [question('a'), question('b')], 'Valves'));
  const select = g1(html, /(<select id="sCh"[^>]*>)/);
  const opts = [...html.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map(m => [m[1], !!m[2], m[3]]);
  ok('the chapter choice has a name, names searchChapter, and lists every chapter after "All chapters", through e()',
     select === '<select id="sCh" aria-label="Chapter" data-action="searchChapter">' && J(opts) === J([['', false, 'All chapters'], ['E(Arrhythmias)', false, 'E(Arrhythmias)'], ['E(Valves)', true, 'E(Valves)']]), J(opts));
  ok('with all chapters, none of them is selected', !draw(sq('word', [])).includes(' selected'));
  ok('"Quiz these N" with matches, by the quizFromSearch action', html.includes('<button class="btn btn-next sb-quiz" data-action="quizFromSearch">Quiz these 2 [icon arrow-right icon-sm]</button>') && !draw(sq('word', [])).includes('quizFromSearch'));
  ok('Clear only when something is typed, by the searchClear action', html.includes('<button class="sb-x" data-action="searchClear" aria-label="Clear">[icon x icon-sm]</button>') && !draw(sq('', [])).includes('sb-x'));
  const box = g1(html, /(<input id="sQ"[^>]*>)/) || '';
  ok('the box holds what is typed, through e(), names searchInput, and corrects nothing',
     box.includes(' type="search"') && box.includes(' value="E(word)"') && box.includes(' data-action="searchInput"') && box.includes(' autocomplete="off"') && box.includes(' autocapitalize="off"') && box.includes(' spellcheck="false"'), box);
  ok('Home goes home, by the goHome action', html.includes('<button class="btn sb-back" data-action="goHome">[icon arrow-left icon-sm] Home</button>'));
  const all = draw(sq('word', [question('a')], 'Valves')) + draw(sq('', []));
  ok('the screen, with something typed and with nothing, names seven actions and carries no inline handler',
     J([...new Set(actionsOf(all))].sort()) === J(ACTION_NAMES) && inlineOf(all).length === 0, [...new Set(actionsOf(all))].sort().join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));
}

head('it reads what it is given, and changes nothing');
const KIT_READS = new Set(), SQ_READS = new Set(), S_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const state = () => sq('word', [question('a', { img: 1 }), question('b')], 'Valves');
  const S = { flagged: new Set(['a']), missed: new Set(['b']), screen: 'search', mock: null };
  const html = run(() => M.screenHtml(watched(state(), SQ_READS, 'SQ'), watched(S, S_READS, 'S'), CHAPTERS, COLORS, watched(Object.assign({}, KIT), KIT_READS, 'kit')));
  run(() => M.screenHtml(watched(sq('', []), SQ_READS, 'SQ'), watched(S, S_READS, 'S'), CHAPTERS, COLORS, watched(Object.assign({}, KIT), KIT_READS, 'kit')));
  const names = s => [...s].sort().join(' ');
  ok('of the search it reads what is typed, the chapter and the matches, and not whether it ran', !html.startsWith('THREW') && names(SQ_READS) === 'ch hits q', names(SQ_READS));
  ok('of the page\'s state, the flagged and the missed', names(S_READS) === 'flagged missed', names(S_READS));
  ok('of the kit, seven names', names(KIT_READS) === 'BANK_BY TOPIC_SUGGEST TOTAL_Q chInk clip e icon', names(KIT_READS));
  ok('it sets, deletes and defines nothing on any of them', !html.startsWith('THREW') && wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object' && !(o instanceof Set)) { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.screenHtml(deep(state()), Object.freeze({ flagged: new Set(['a']), missed: new Set(['b']) }), CHAPTERS, COLORS, KIT));
  const loose = draw(state(), { flagged: ['a'], missed: ['b'] });
  ok('given the search, its matches, the questions and the kit frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && rowsOf(frozen).length === 2, frozen.slice(0, 80));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const SLOT = '@@SLOT[src:src/app/search.js]@@';
  const LINE = 'function buildSearch(){ return SearchScreen.screenHtml(SQ,S,CHAPTERS,CH_COLORS,{TOPIC_SUGGEST,BANK_BY,TOTAL_Q,chInk,clip,e,icon}); }';
  ok('buildSearch() is one line: the search, the page\'s state, the two tables of chapters and the kit', count(LINE) === 1 && count('function buildSearch(') === 1, `${count(LINE)} such line(s), ${count('function buildSearch(')} declaration(s)`);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT), `${count(SLOT)} slot(s)`);
  const handed = String(g1(page, /function buildSearch\(\)\{ return SearchScreen\.screenHtml\(SQ,S,CHAPTERS,CH_COLORS,\{([^}]*)\}\); \}/));
  ok('the kit is the seven names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 7 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('hl() and snippet() are no longer the page\'s, and nothing in it calls them', count('function hl(') === 0 && count('function snippet(') === 0 && !/[^.\w$]hl\(/.test(page) && !/[^.\w$]snippet\(/.test(page), [count('function hl('), count('function snippet(')].join(' '));
  /* The mock block's set-up offers "All chapters" too, so the search's choice is known by its id. */
  const WORDS = ['Try a topic', 'Searches every stem', 'Try a broader term', 'Quiz these ', 'id="sCh"'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  /* docs/ROADMAP.md, E2. A tap is looked up in ACTIONS, a key typed in INPUT_ACTIONS and a choice made in
     CHANGE_ACTIONS, so each action is held to the one table for its event, as the page writes it. */
  const TABLES = { ACTIONS: 'click', INPUT_ACTIONS: 'input', CHANGE_ACTIONS: 'change' };
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const ENTRY = { goHome: ['ACTIONS', 'goHome:()=>goHome(),'], searchGo: ['ACTIONS', 'searchGo:el=>searchGo(el.dataset.topic),'], searchClear: ['ACTIONS', 'searchClear:()=>searchGo(\'\'),'],
    jumpTo: ['ACTIONS', 'jumpTo:el=>jumpTo(el.dataset.qid),'], quizFromSearch: ['ACTIONS', 'quizFromSearch:()=>quizFromSearch(),'],
    searchInput: ['INPUT_ACTIONS', 'searchInput:el=>searchInput(el.value),'], searchChapter: ['CHANGE_ACTIONS', 'searchChapter:el=>searchChapter(el.value),'] };
  const keyed = (t, n) => (tableOf(t).match(new RegExp('(^|\\s)' + n + ':', 'g')) || []).length;
  ok('each of the seven actions is in the page\'s table for its event once and in no other: the taps in ACTIONS, the box in INPUT_ACTIONS, the chapter in CHANGE_ACTIONS',
     ACTION_NAMES.every(n => ENTRY[n] && Object.keys(TABLES).every(t => keyed(t, n) === (ENTRY[n][0] === t ? 1 : 0)) && tableOf(ENTRY[n][0]).split(ENTRY[n][1]).length === 2),
     ACTION_NAMES.map(n => n + ':' + Object.keys(TABLES).map(t => keyed(t, n)).join('/') + (ENTRY[n] && tableOf(ENTRY[n][0]).split(ENTRY[n][1]).length === 2 ? '' : ' (not as written)')).join(' '));
  const FUNCS = ['goHome', 'searchGo', 'jumpTo', 'quizFromSearch', 'searchInput', 'searchChapter'];
  const INSTALL = { ACTIONS: 'Actions.install(document,ACTIONS);', INPUT_ACTIONS: "Actions.install(document,INPUT_ACTIONS,'input');", CHANGE_ACTIONS: "Actions.install(document,CHANGE_ACTIONS,'change');" };
  const ACT_SLOT = page.indexOf('@@SLOT[src:src/core/actions.js]@@');
  ok('they call six functions the page declares, once each, and the page listens on the document over each table for its event, below the listener\'s module',
     FUNCS.every(n => count('function ' + n + '(') === 1) && Object.keys(TABLES).every(t => count(INSTALL[t]) === 1 && count('const ' + t + '={') === 1 && ACT_SLOT >= 0 && ACT_SLOT < page.indexOf('const ' + t + '={') && page.indexOf('const ' + t + '={') < page.indexOf(INSTALL[t])),
     FUNCS.map(n => n + ':' + count('function ' + n + '(')).join(' ') + ' · ' + Object.keys(TABLES).map(t => t + ':' + count(INSTALL[t])).join(' '));
  ok('the box the markup draws is the one the page looks for, by its id, after typing and on opening', count('document.getElementById(\'sQ\')') >= 3, count('document.getElementById(\'sQ\')') + ' look-ups');

  /* The page's own line and helpers, with this module where its slot stands, in a context that has nothing
     else. The search is made here, as runSearch() leaves it. */
  const ctx = { CH_COLORS: { Arrhythmias: '#6366F1' }, CHAPTERS: ['Arrhythmias', 'Valves & more'], TOPIC_SUGGEST: ['aortic valve'], BANK_BY: 'ACC ', TOTAL_Q: 3, themeIsDark: () => false,
    S: { flagged: new Set(['v1']), missed: new Set() }, SQ: { q: '', ch: '', hits: [], ran: true } };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(helpers + '\n' + fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'search.js'), 'utf8') + '\n' + LINE + '\n"loaded"');
  const empty = String(ask('buildSearch()'));
  ok('with nothing typed, the page\'s own line offers the topics and says what is searched, of how many',
     loaded === 'loaded' && empty.includes('>aortic valve</button>') && empty.includes('the full ACC commentary across all 3 questions'), String(loaded).slice(0, 80));
  ask(`SQ.q = 'Aortic'; SQ.hits = [{ q: { id: 'v1', ch: 'Valves & more', n: 7, s: 'Severe <b>aortic</b> stenosis & syncope', ex: 'x', o: [{ t: 'TAVR' }, { t: 'Aortic valve replacement' }], ci: 1, img: 0 }, score: 1 }];`);
  const html = String(ask('buildSearch()')), row = rowsOf(html)[0] || {};
  ok('with one match: "1 match", its row going to it, flagged, its chapter escaped by the page\'s e() and in the teal\'s ink',
     labelOf(html) === '1 match' && row.go === 'v1' && J(row.flags) === J(['flagged']) && row.chip === 'Valves &amp; more · 7' && row.ink === 'var(--teal-ink)', J([labelOf(html), row.go, row.chip, row.ink]));
  ok('the stem and the answer are escaped by the page\'s e(), with the word typed marked in each, whatever its case',
     row.stem === 'Severe &lt;b&gt;<mark>aortic</mark>&lt;/b&gt; stenosis &amp; syncope —…' && row.ans === '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-check"></use></svg> <mark>Aortic</mark> valve replacement', row.stem + ' · ' + row.ans);

  /* A tap, a key and a choice, as the page takes them: the real src/core/actions.js listening on a stand-in document
     over the page's three tables, with a recording stand-in for each function the tables call, and as the element each
     control the page's own line drew over its own e(), its attributes read back as a browser reads them. A topic and an
     id that try to close their attribute and write a handler are among them. Every control is tapped, typed in and
     chosen from, in the order drawn; the box holds what was typed and the choice the chapter chosen. */
  const TOPIC = 'it\'s "x" <b> & onclick="no()"', ID = 'v2" onclick="alert(1)';
  ask(`TOPIC_SUGGEST.push(${J(TOPIC)}); SQ.hits.push({ q: { id: ${J(ID)}, ch: 'Arrhythmias', n: 8, s: 's', ex: 'x', o: [{ t: 'a' }], ci: 0, img: 0 }, score: 1 });`);
  const typed = String(ask('buildSearch()'));
  ask(`SQ.q = ''; SQ.hits = [];`);
  const none = String(ask('buildSearch()'));
  ok('over the page\'s own e(), a topic and an id that try to write a handler leave no on* attribute', typed.includes('2 matches') && none.includes('Try a topic') && inlineOf(typed + none).length === 0, inlineOf(typed + none).join(' ') || 'no on* attribute');
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const tables = Object.keys(TABLES).map(t => (page.match(new RegExp('const ' + t + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + t + '={};'])[0].replace(/^const /, 'var ')).join('\n');
  const called = [...new Set([...tables.matchAll(/=>\s*([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'actions.js'), 'utf8') + '\nvar S={chapter:null};\n'
    + called.map(n => `function ${n}(){ tcalls.push(${J(n)} + (arguments.length ? " " + JSON.stringify([].slice.call(arguments)) : "")); }`).join('\n') + '\n' + tables
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\n'
    + Object.keys(TABLES).map(t => `Actions.install(doc,${t},${J(TABLES[t])});`).join('\n'), tctx);
  const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const VALUE = { input: 'long qt', select: 'Valves & more' };
  const controls = html => [...html.matchAll(/<(button|input|select)\b([^>]*)>/g)].map(m => {
    const at = Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], unescape(x[2])]));
    const dataset = Object.fromEntries(Object.keys(at).filter(k => k.startsWith('data-')).map(k => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), at[k]]));
    const el = { nodeType: 1, tagName: m[1].toUpperCase(), value: VALUE[m[1]], dataset, getAttribute: k => (k in at ? at[k] : null), closest: sel => (sel === '[data-action]' && 'data-action' in at ? el : null) };
    return el; });
  const fire = (type, html) => { tcalls.length = 0; controls(html).forEach(el => tctx.listeners.filter(l => l[0] === type).forEach(l => l[1]({ type, target: el }))); return tcalls.slice(); };
  const tapsTyped = fire('click', typed), tapsNone = fire('click', none);
  ok('tapped, with something typed: Clear searches for nothing, Quiz these quizzes, Home goes home, and each row goes to its own question by its id as it is; a tap on the box or the choice calls nothing',
     J(tapsTyped) === J(['searchGo [""]', 'quizFromSearch', 'goHome', 'jumpTo ["v1"]', 'jumpTo [' + J(ID) + ']']), J(tapsTyped));
  ok('tapped, with nothing typed: Home goes home, and each topic searches for itself as it is',
     J(tapsNone) === J(['goHome', 'searchGo ["aortic valve"]', 'searchGo [' + J(TOPIC) + ']']), J(tapsNone));
  const keys = fire('input', typed).concat(fire('input', none));
  ok('typed in: the box calls searchInput() with what it holds, each time it is drawn, and a key in any other control calls nothing', J(keys) === J(['searchInput ["long qt"]', 'searchInput ["long qt"]']), J(keys));
  const chose = fire('change', typed).concat(fire('change', none));
  ok('chosen from: the chapter calls searchChapter() with the chapter chosen, and a change anywhere else, the box\'s among them, calls nothing', J(chose) === J(['searchChapter ["Valves & more"]', 'searchChapter ["Valves & more"]']), J(chose));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
