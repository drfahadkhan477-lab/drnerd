#!/usr/bin/env node
/*
 * The home screen and its three pages — src/app/home.js: the Home page with the hero and the pearl, the Brain
 * page and the Labs page.
 *
 *   node tests/verify-homescreen-pure.js
 *
 * Pure Node, over invented apps. The module is given the page's state, the chapters, how many cards are due and
 * a kit, and returns markup; nothing before the last part has a page. The kit there is stand-ins: icon('x')
 * is "[icon x]", e('x') is "E(x)", the notes are an array this file made, Memory.count() a number this file
 * chose, and the brain's layout is one this file wrote, drawn with the real BrainMap's shapes, so what the
 * pages are expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the Labs page: what it is, a card for each of the four labs, and the six study tools;
 *   - what Sessions, Chapters, Notes and Memory say of the app as it stands, and without notes or memory;
 *   - the Home page: the three pages and the tabs, the intro or the pearl, the hero and its menu, the session
 *     strip, the greeting for someone new, and what it hands the Brain and Labs pages;
 *   - the Brain page: what it is, the brain and the chosen neuron in their places, the gauge, the figures, the
 *     way to review, and a row for each chapter;
 *   - the brain: nothing without BrainMap or neurons; a neuron for each part, chosen or not; lobes, axons,
 *     signals, glow, flashes, sparks and branches as the layout says; and what the chosen neuron holds;
 *   - that each reads the names it should of the state and the kit, and changes nothing;
 *   - the page's lines, the actions the markup names (each in the page's table as written; no inline handler
 *     but the scroll and key ones left), and those lines over the page's own helpers: the Labs
 *     page with and without notes and Apex's memory, the Brain page over the real FSRS and BrainMap, the Home
 *     page over the page's own pearl and greeting, and the two heart images where the split build finds them;
 *     and every control those lines drew tapped through the real src/core/actions.js.
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
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);

const CH = ['One', 'Two', 'Three'];
const kitOf = over => Object.assign({ REF: [{}, {}, {}, {}], Memory: { count: () => 6 }, TOTAL_Q: 50, icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']' }, over);
const labs = (sOver, dueN, kOver, chapters) => run(() => M.labsHtml(Object.assign({ mock: null }, sOver), chapters || CH, dueN === undefined ? 7 : dueN, kitOf(kOver)));
/* A card of the Labs grid: its class, its action, its id if it has one, the icon beside its name, its name and what it says. */
const cards = html => [...html.matchAll(/<button class="lab-card ([a-z-]+)"(?: id="([^"]*)")? data-action="([^"]*)">([\s\S]*?)<\/button>/g)].map(m => {
  const inner = m[4]; return { cls: m[1], id: m[2], go: m[3], icon: g1(inner, /<span class="lab-ic" aria-hidden="true">([^<]*)<\/span>/), name: g1(inner, /<span class="lab-txt"><b>([^<]*)<\/b>/), says: g1(inner, /<span class="lab-txt"><b>[^<]*<\/b><i>([^<]*)<\/i>/), open: /<span class="lab-go" aria-hidden="true">Open \[icon arrow-right icon-sm\]<\/span>/.test(inner) };
});
/* A door of the study tools: whether it is the wide one, its action, its icon, its name and what it says. */
const doors = html => [...html.matchAll(/<button class="(door(?: door-wide)?)" data-action="([^"]*)">\s*<span class="door-ic">([^<]*)<\/span>\s*<span class="door-txt"><b>([^<]*)<\/b><i>([^<]*)<\/i><\/span>/g)].map(m => m.slice(1));

head('the Labs page');
{
  const html = labs();
  ok('what Labs is', html.startsWith('<header class="page-head"><span class="page-eyebrow">[icon activity icon-sm] Labs</span>') && html.includes('<h1 class="page-title">Hear it, see it, read it</h1>') && html.includes('<p class="page-sub">Traces drawn live, echo views to explore, and sounds and strips to practise on.</p></header>'));
  const c = cards(html);
  ok('a card for each lab, in order: the Rhythm Lab, Echo Studio, the Practice Lab, Sessions', J(c.map(x => [x.cls, x.name])) === J([['lab-rhythm', 'Rhythm Lab'], ['lab-echo', 'Echo Studio'], ['lab-practice', 'Practice Lab'], ['lab-sessions', 'Sessions']]), J(c.map(x => [x.cls, x.name])));
  ok('each a way in to its own lab, and no other, by its action', J(c.map(x => x.go)) === J(['goLab', 'goEcho', 'goPractice', 'goSessions']), J(c.map(x => x.go)));
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
  ok('each opens its own tool, and no other, by its action', J(d.map(x => x[1])) === J(['goStudy', 'openSearch', 'goStats', 'goRefs', 'goMemory', 'goAnnotations']), J(d.map(x => x[1])));
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

/* The Brain page, over a stand-in kit: the art and the info are the page's own lines, here recorded in the order called. */
const BCH = ['Valves & "more"', 'Rhythm', 'Quiet'];
const BPOOL = [{ id: 'v1', ch: BCH[0] }, { id: 'v2', ch: BCH[0] }, { id: 'v3', ch: BCH[0] }, { id: 'r1', ch: 'Rhythm' }, { id: 'r2', ch: 'Rhythm' }];
const BMAST = { [BCH[0]]: 0.666, Rhythm: 0.25, Quiet: 0 };
const calls = [];
const brainKit = over => Object.assign({ POOL: BPOOL, TOTAL_Q: 5, avgRetention: () => 81, masteryFor: ch => BMAST[ch], todayISO: () => '2026-11-17', chInk: c => 'INK(' + c + ')', chIcon: ch => '[ch ' + ch + ']',
  buildBrainArt: () => (calls.push('art'), '[ART]'), brainInfoHtml: () => (calls.push('info'), '[INFO]'), e: s => 'E(' + String(s).replace(/"/g, '&quot;') + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']' }, over);
const BS = { srs: { v1: { due: '2026-11-17' }, v2: { due: '2026-11-18' }, r1: { due: '2026-11-01' } }, practice: { v3: { c: 1 } } };
const brainPage = (sOver, nums, kOver, colors) => run(() => M.brainHtml(Object.assign({}, BS, sOver), BCH, colors || { [BCH[0]]: '#112233' }, ...(nums || [2, 4, 80, 30, { a: 5, c: 3 }]), brainKit(kOver)));

head('the Brain page');
{
  calls.length = 0;
  const html = brainPage();
  ok('what it is', html.startsWith('<header class="page-head"><span class="page-eyebrow">[icon brain icon-sm] Your brain</span>') && html.includes('<h1 class="page-title">What you remember</h1>') && html.includes("Mastery is FSRS's own estimate of what you would recall today, chapter by chapter."));
  ok('the brain in its stage, its legend, then the chosen neuron, each found by its id', /<div class="brain-3d" id="brain3d"><div class="brain-tilt" id="brainTilt">\[ART\]<\/div><\/div>\s*<div class="brain-legend" aria-hidden="true">[\s\S]*?<\/div>\s*<div class="brain-info" id="brainInfo" aria-live="polite">\[INFO\]<\/div>/.test(html));
  ok('drawn in that order: the art first, which can lay the brain out anew, then the info, which reads that layout', J(calls) === J(['art', 'info']), J(calls));
  ok('the legend: solid, fading, weak, not seen yet, and live', J([...html.matchAll(/<span><i data-state="([a-z]+)"><\/i>([^<]*)<\/span>/g)].map(m => m[1] + ':' + m[2])) === J(['solid:solid', 'fading:fading', 'weak:weak', 'new:not seen yet']) && html.includes('<span class="brain-livetag"><i></i>live</span>'));
  ok('the gauge: mastered within seen, said to a screen reader, each ring as far round as its share', html.includes('<div class="brain-gauge" role="img" aria-label="30% mastered, 80% seen">') && /class="bg-seen"[^>]*data-frac="80"/.test(html) && /class="bg-mast"[^>]*data-frac="30"/.test(html) && html.includes('<div class="brain-mid">[icon brain]<b>30%</b><span>mastered</span></div>'));
  const stats = h => [...h.matchAll(/<span class="brain-stat (bs-[a-z]+)"><b>([^<]*)<\/b><i>([^<]*)<\/i><\/span>/g)].map(m => m.slice(1));
  ok('seen of the bank, due, answered today with how many right, and the recall of the cards scheduled', J(stats(html)) === J([['bs-seen', '80%', 'seen · 4 of 5'], ['bs-due', '2', 'due for review'], ['bs-today', '5', 'answered today · 3 right'], ['bs-ret', '81%', 'recall, cards scheduled']]), J(stats(html)));
  ok('nothing answered today says no number right; with nothing scheduled, recall is a dash', J(stats(brainPage({}, [2, 4, 80, 30, { a: 0, c: 0 }], { avgRetention: () => null })).slice(2).map(x => x[1] + ' ' + x[2])) === J(['0 answered today', '— recall, cards scheduled']));
  ok('with cards due, the way to review them all, by startDue', html.includes('<div class="brain-actions"><button class="brain-go primary" data-action="startDue">[icon repeat icon-sm] Review 2 due</button></div>') && !brainPage({}, [0, 4, 80, 30, { a: 5, c: 3 }]).includes('brain-actions'));
  const rows = h => [...h.matchAll(/<button class="brain-ch" style="--c:([^;]*);--ci:([^"]*)" data-action="startChapter" data-ch="([^"]*)"\s*aria-label="([^"]*)">\s*<span class="brain-ch-ic" aria-hidden="true">([^<]*)<\/span>\s*<span class="brain-ch-main"><b>([^<]*)<\/b>\s*<span class="brain-bar" aria-hidden="true"><i data-w="(\d+)"><\/i><\/span>\s*<span class="brain-ch-meta">(.*?)<\/span><\/span>\s*<span class="brain-ch-pct" aria-hidden="true">([^<]*)<\/span>\s*<\/button>/g)].map(m => m.slice(1));
  const r = rows(html);
  ok('under "Chapters", a row for each chapter, in the bank\'s order, in its accent or the teal, with its ink', html.indexOf('<h3 class="page-h3">Chapters</h3>') > html.indexOf('brain-hero') && J(r.map(x => [x[0], x[1]])) === J([['#112233', 'INK(#112233)'], ['var(--teal)', 'INK(var(--teal))'], ['var(--teal)', 'INK(var(--teal))']]), J(r.map(x => [x[0], x[1]])));
  ok('each a way to practise its chapter, by startChapter, its name in data-ch through e()', J(r.map(x => x[2])) === J(['E(Valves & &quot;more&quot;)', 'E(Rhythm)', 'E(Quiet)']), J(r.map(x => x[2])));
  ok('its mastery, rounded: as the bar, the figure, and to a screen reader', J(r.map(x => [x[6], x[8]])) === J([['67', '67%'], ['25', '25%'], ['0', '0%']]), J(r.map(x => [x[6], x[8]])));
  ok('seen counts a card scheduled or practised; due, a scheduled card due today or before', J(r.map(x => x[7])) === J(['3 of 3 seen · <em>1 due</em>', '1 of 2 seen · <em>1 due</em>', '0 of 0 seen']), J(r.map(x => x[7])));
  ok('the same said to a screen reader, the name through e(), "due" only where some are', J(r.map(x => x[3])) === J(['E(Valves & &quot;more&quot;): 67 percent mastered, 3 of 3 seen, 1 due', 'E(Rhythm): 25 percent mastered, 1 of 2 seen, 1 due', 'E(Quiet): 0 percent mastered, 0 of 0 seen']), J(r.map(x => x[3])));
  ok('its own icon, and its name through e()', J(r.map(x => [x[4], x[5]])) === J([['[ch Valves & "more"]', 'E(Valves & &quot;more&quot;)'], ['[ch Rhythm]', 'E(Rhythm)'], ['[ch Quiet]', 'E(Quiet)']]), J(r.map(x => [x[4], x[5]])));
}

/* The brain, over the real BrainMap's shapes and a layout written here: three neurons in two chapters, two axons. */
const BrainMap = require('../src/core/brain.js');
const NODES = [{ x: 300, y: 300, r: 12, key: 'Valves:0', docId: 'Valves & <b>', ci: 0, state: 'solid', title: 'Valves & <b> · questions 1–3', recall: 91 },
  { x: 400, y: 320, r: 12, key: 'Valves:1', docId: 'Valves & <b>', ci: 1, state: 'new', title: 'Valves & <b> · questions 4–6', recall: null },
  { x: 600, y: 280, r: 10, key: 'Rhythm:0', docId: 'Rhythm', ci: 0, state: 'weak', title: 'Rhythm · questions 1–2', recall: 40 }];
const LAY = { nodes: NODES, edges: [{ a: 0, b: 1, kind: 'local', lit: 2, state: 'solid' }, { a: 0, b: 2, kind: 'bridge', lit: 0, state: 'new' }],
  units: [{ docId: 'Valves & <b>', name: 'Valves & <b>', x: 350, y: 310, n: 2 }, { docId: 'Rhythm', name: 'Rhythm', x: 600, y: 280, n: 1 }], gap: 40 };
const TUNE = { MAX_SPARKS: 5 }, LABEL = { solid: 'solid', fading: 'fading', weak: 'weak', 'new': 'not seen yet' };
const artKit = over => Object.assign({ BrainMap, brainLayoutNow: () => LAY, brainSel: -1, BRAIN_TUNE: TUNE, BRAIN_STATE_LABEL: LABEL, e: s => 'E(' + s + ')' }, over);
const art = (kOver, colors) => run(() => M.brainArtHtml(colors || { 'Valves & <b>': '#112233' }, artKit(kOver)));
const hash = t => { let x = 7; for (let i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) >>> 0; return x; };

head('the brain');
{
  const html = art();
  ok('nothing where BrainMap is not loaded, or where there are no neurons', art({ BrainMap: undefined }) === '' && art({ brainLayoutNow: () => ({ nodes: [], edges: [], units: [], gap: 0 }) }) === '');
  ok('an svg found by its id, in BrainMap\'s view, tapped by the brainTap action and keyed by the page\'s handler', html.startsWith('<svg class="brain-svg" id="brainArt" viewBox="' + BrainMap.BRAIN.VIEW + '" role="group"') && J(actionsOf(html)) === J(['brainTap']) && J(handlersOf(html)) === J(['brainKey(event)']) && J(inlineOf(html)) === J(['onkeydown']) && html.endsWith('</g></svg>'));
  ok('said to a screen reader: how many of the neurons are lit, and how to move and practise', html.includes('aria-label="Your brain: 2 of 3 parts of the bank lit. Arrow keys move between them; Enter practises that chapter."'));
  const neurons = h => [...h.matchAll(/<g class="neuron( sel)?" data-i="(\d+)" data-state="([a-z]+)" role="button" tabindex="(-?\d+)" aria-label="([^"]*)" aria-pressed="(true|false)">/g)].map(m => m.slice(1));
  ok('a neuron for each part, in order, with its state, its title, the state\'s word and its recall, through e()', J(neurons(html).map(n => [n[1], n[2], n[4]])) === J([['0', 'solid', 'E(Valves & <b> · questions 1–3, solid, recall 91% today)'], ['1', 'new', 'E(Valves & <b> · questions 4–6, not seen yet)'], ['2', 'weak', 'E(Rhythm · questions 1–2, weak, recall 40% today)']]), J(neurons(html).map(n => n[4])));
  ok('none chosen: none pressed, and the first takes the keyboard', J(neurons(html).map(n => [n[0] || '', n[3], n[5]])) === J([['', '0', 'false'], ['', '-1', 'false'], ['', '-1', 'false']]));
  ok('the one chosen is marked, pressed and takes the keyboard', J(neurons(art({ brainSel: 2 })).map(n => [n[0] || '', n[3], n[5]])) === J([['', '-1', 'false'], ['', '-1', 'false'], [' sel', '0', 'true']]));
  const lobes = [...html.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)" fill="([^"]*)" fill-opacity="\.14"\/>/g)].map(m => m.slice(1));
  ok('a lobe for each chapter, in its accent or the default blue, as wide as its parts', J(lobes) === J([['350', '310', String(Math.round(40 * (1.2 + Math.SQRT2))), '#112233'], ['600', '280', '88', '#38BDF8']]), J(lobes));
  const axon = (a, b, i) => { const c = BrainMap.axonCtrl(a, b, i); return 'M' + a.x + ' ' + a.y + 'Q' + c.x + ' ' + c.y + ' ' + b.x + ' ' + b.y; };
  const axons = [...g1(html, /<g class="brain-axons" aria-hidden="true">([\s\S]*?)<\/g>/).matchAll(/<path d="([^"]*)" data-fired="(\d)" data-state="([a-z]+)" data-kind="([a-z]+)" data-e="(\d+)"\/>/g)].map(m => m.slice(1));
  ok('an axon for each edge, curved as BrainMap curves it, saying whether it fired, its state, its kind and its place', J(axons) === J([[axon(NODES[0], NODES[1], 0), '2', 'solid', 'local', '0'], [axon(NODES[0], NODES[2], 1), '0', 'new', 'bridge', '1']]), J(axons.map(x => x.slice(1))));
  const signals = [...g1(html, /<g class="brain-signals" aria-hidden="true">([\s\S]*?)<\/g>/).matchAll(/<path d="([^"]*)" data-state="([a-z]+)" style="animation-delay:-([\d.]+)s"\/>/g)].map(m => m.slice(1));
  ok('a signal along each axon that fired twice, and no other, its delay from the hash of where it starts', J(signals) === J([[axon(NODES[0], NODES[1], 0), 'solid', String((hash('Valves:0') % 30) / 10)]]), J(signals));
  const glow = [...g1(html, /<g class="brain-glow" aria-hidden="true">([\s\S]*?)<\/g>/).matchAll(/<circle cx="(\d+)" cy="(\d+)" r="([\d.]+)" fill="url\(#(\w+)\)" style="animation-delay:-([\d.]+)s"\/>/g)].map(m => m.slice(1));
  ok('a glow round each neuron seen, two and a half times its size, in its state\'s gradient, and none round one not seen yet', J(glow) === J([['300', '300', '31.2', 'sbGlowSolid', String((hash('Valves:0') % 36) / 10)], ['600', '280', '26.0', 'sbGlowWeak', String((hash('Rhythm:0') % 36) / 10)]]), J(glow));
  const flashes = [...html.matchAll(/<circle class="flash" data-i="(\d+)" cx="\d+" cy="\d+" r="([\d.]+)" fill="url\(#(\w+)\)" style="opacity:0"\/>/g)].map(m => m.slice(1));
  ok('a flash, unseen, for every neuron', J(flashes) === J([['0', '40.8', 'sbGlowSolid'], ['1', '40.8', 'sbGlowNew'], ['2', '34.0', 'sbGlowWeak']]), J(flashes));
  ok('as many sparks, hidden, as the page\'s tuning allows', times(html, '<g class="bspark" style="display:none">') === 5 && times(art({ BRAIN_TUNE: { MAX_SPARKS: 2 } }), '<g class="bspark"') === 2);
  const dend = h => [...h.matchAll(/<path class="dendrite" d="([^"]*)"\/>/g)].map(m => m[1]);
  const d = dend(html);
  ok('each neuron has four branches, forked at two, starting at its edge', d.length === 3 && d.every(p => (p.match(/Q/g) || []).length === 4 && (p.match(/L/g) || []).length === 2) && d.every((p, i) => { const m = /^M([\d.-]+) ([\d.-]+)/.exec(p); return m && Math.abs(Math.hypot(+m[1] - NODES[i].x, +m[2] - NODES[i].y) - NODES[i].r * 0.8) < 0.2; }), d.map(p => p.slice(0, 24)).join(' | '));
  ok('and the branches differ with the neuron, not with where it sits', new Set(d.map((p, i) => p.replace(/[\d.-]+/g, ''))).size >= 1 && d[0] !== d[1] && dend(run(() => M.brainArtHtml({}, artKit({ brainLayoutNow: () => Object.assign({}, LAY, { nodes: [Object.assign({}, NODES[0], { key: 'Valves:1' })].concat(NODES.slice(1)) }) }))))[0] !== d[0]);
  const nuclei = [...html.matchAll(/<circle class="nucleus" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/>/g)].map(m => m.slice(1).map(Number));
  ok('each neuron\'s body its size, and its nucleus up and to the left of its middle, a third of its size', J(nuclei) === J(NODES.map(n => [+(n.x - n.r * 0.25).toFixed(1), +(n.y - n.r * 0.25).toFixed(1), +(n.r * 0.34).toFixed(1)])) && NODES.every(n => html.includes('<circle class="soma" cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '"/>')), J(nuclei));
  ok('the cortex, its folds and its parts are BrainMap\'s', html.includes('<path class="brain-cortex" d="' + BrainMap.BRAIN.cerebrum + '" fill="url(#sbTissue)"/>') && html.includes('<clipPath id="sbCblClip"><path d="' + BrainMap.BRAIN.cerebellum + '"/></clipPath>') && times(html, '<path class="major"') === 3 * BrainMap.BRAIN.SULCI.length);
}

head('what the chosen neuron holds');
{
  const I = over => run(() => M.brainInfoHtml(Object.assign({ brainArtL: { sig: 'x', L: LAY }, brainSel: -1, BRAIN_STATE_LABEL: LABEL, e: s => 'E(' + s + ')', icon: (n, c) => '[icon ' + n + (c ? ' ' + c : '') + ']' }, over)));
  const HINT = '<span class="brain-info-hint">[icon zap icon-sm] Tap a neuron: it fires, and says what it holds.</span>';
  ok('with none chosen, before the brain is laid out, or with a choice the layout does not have: how to choose one', I() === HINT && I({ brainArtL: null, brainSel: 0 }) === HINT && I({ brainSel: 7 }) === HINT);
  const html = I({ brainSel: 0 });
  ok('the chosen neuron\'s chapter, its questions, its state and its recall, through e()', html.startsWith('<span class="brain-info-k">This neuron</span> <b>E(Valves & <b>)</b>') && html.includes('<span class="brain-info-m">E(questions 1–3) · solid · recall 91% today</span>'), html.slice(0, 160));
  ok('and the way to practise its chapter, by startChapter, its name in data-ch through e(), and no inline handler', html.endsWith('<button class="brain-go primary" data-action="startChapter" data-ch="E(Valves & <b>)">[icon play icon-sm] Practise this chapter</button>') && J(actionsOf(html)) === J(['startChapter']) && inlineOf(html).length === 0);
  ok('a neuron not seen yet says so, and no recall', I({ brainSel: 1 }).includes('<span class="brain-info-m">E(questions 4–6) · not seen yet</span>'), g1(I({ brainSel: 1 }), /<span class="brain-info-m">([^<]*)</));
}

/* The Home page, over a stand-in kit: the pearl and the pages beside it are the page's own functions, recorded here. */
const hcalls = [];
const PEARL = { concept: 'A <b>rule</b>', title: 'Title', chapter: 'Valves & "more"', source: 'Note <i>7</i>' };
const homeKit = over => Object.assign({ POOL: BPOOL, TOTAL_Q: 5, atlas3D: true, atlasPaused: false, atlasReading: true, heroCutaway: false, pearlAsWritten: false,
  ATLAS_IMG: '[ATLAS-IMG]', HERO_IMG: '[HERO-IMG]', dueQuestions: () => ['a', 'b'], startedCount: () => 4, todayISO: () => '2026-11-17', masteryFor: ch => BMAST[ch],
  pearlNow: () => (hcalls.push('pearlNow'), PEARL), pearlAll: () => [1, 2, 3], pearlFigure: () => '', pearlEmblem: () => '[EMBLEM]', pearlLadder: p => '[LADDER ' + p.title + ']', showHello: () => false,
  buildBrain: (...a) => (hcalls.push('brain ' + J(a)), '[BRAIN]'), buildLabs: (...a) => (hcalls.push('labs ' + J(a)), '[LABS]'),
  e: s => 'E(' + String(s).replace(/"/g, '&quot;') + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']' }, over);
const HS = { sessionTotal: 4, sessionCorrect: 3, daily: { '2026-11-17': { a: 6, c: 4 }, '2026-11-16': { a: 9, c: 9 } }, homeLayout: 'focus' };
const homePage = (sOver, kOver) => run(() => M.homeHtml(Object.assign({}, HS, sOver), BCH, homeKit(kOver)));

head('the Home page');
{
  hcalls.length = 0;
  const html = homePage();
  ok('three pages side by side in a pager, each a tab panel, and the tabs to them', /^<div class="home-pages" id="homePages">\s*<div class="home-pager" id="homePager" onscroll="homePagerScroll\(\)">/.test(html) && [0, 1, 2].every(i => html.includes('id="homePage' + i + '" role="tabpanel" aria-labelledby="homeTab' + i + '"')) && html.endsWith('</div>\n  </div>'));
  const tabs = [...html.matchAll(/<button class="home-tab" role="tab" id="homeTab(\d)" aria-controls="homePage(\d)" data-action="homeGo" data-page="(\d)">([^<]*)<span>([^<]*)<\/span><\/button>/g)].map(m => m.slice(1));
  ok('three tabs, Home, Brain and Labs, each to its own page by homeGo with the page in data-page, keyed by homeTabKey()', J(tabs) === J([['0', '0', '0', '[icon home icon-sm]', 'Home'], ['1', '1', '1', '[icon brain icon-sm]', 'Brain'], ['2', '2', '2', '[icon activity icon-sm]', 'Labs']]) && html.includes('<div class="home-tabs" role="tablist" aria-label="Home pages" onkeydown="homeTabKey(event)">'), J(tabs));
  ok('the Brain and Labs pages are the page\'s, handed what was counted here: due, started, the share explored, the share mastered, and today', html.includes('<section class="home-page home-brain" id="homePage1" role="tabpanel" aria-labelledby="homeTab1"><div class="home-page-in">[BRAIN]</div></section>') && html.includes('<div class="home-page-in">[LABS]</div></section>')
     && J(hcalls.filter(c => !c.startsWith('pearl'))) === J(['brain [2,4,80,50,{"a":6,"c":4}]', 'labs [2]']), J(hcalls));
  ok('in the layout chosen, reading when there is a pearl, and paused when the heart is', html.includes('<div class="home-wrap anim-fade atlas-reading" data-home="focus">') && homePage({}, { atlasReading: false }).includes('<div class="home-wrap anim-fade" data-home="focus">') && homePage({}, { atlasPaused: true }).startsWith('<div class="home-pages atlas-paused" id="homePages">'));
  ok('with no pearl being read, what the daily pearl is for, the three steps, and the way to the notes', homePage({}, { atlasReading: false, pearlNow: () => null }).includes('<section class="atlas-intro" id="atlasIntro" aria-labelledby="atlasTitle">') && html.includes('<section class="atlas-intro" id="atlasIntro" hidden aria-labelledby="atlasTitle">') && html.includes('<h1 id="atlasTitle">Make one <br>idea stick.</h1>') && html.includes('<button class="atlas-primary" data-action="goRefs">Open notes[icon arrow-right]</button>') && (html.match(/<strong>(Observe|Explain|Recall)<\/strong>/g) || []).length === 3);
}

head('the pearl');
{
  const html = homePage();
  ok('the card, shown when there is a pearl to read, hidden when not, and none without a pearl', html.includes('<div class="pearl-card" id="pearlCard">') && homePage({}, { atlasReading: false }).includes('<div class="pearl-card" id="pearlCard" hidden>') && !homePage({}, { pearlNow: () => null }).includes('pearl-card'));
  ok('marked as having a figure when the page draws one for it', homePage({}, { pearlFigure: () => '<figure>F</figure>' }).includes('<div class="pearl-card has-fig" id="pearlCard">'));
  ok('its chapter, for a screen reader, through e(), or "From your notes"', html.includes('<span class="pearl-cap sr-only" id="pearlCap">E(Valves & &quot;more&quot;)</span>') && homePage({}, { pearlNow: () => ({ concept: 'C' }) }).includes('id="pearlCap">E(From your notes)</span>'));
  ok('another pearl, by pearlNext, only where there are two or more', /<button class="pearl-next" data-action="pearlNext"\s*title="Another pearl" aria-label="Another pearl">\[icon rotate-ccw icon-sm\]<\/button>/.test(html) && /aria-label="Another pearl" disabled>/.test(homePage({}, { pearlAll: () => [1] })));
  ok('what it is about, through e(), or its title where it has no concept', html.includes('<h1 class="pearl-concept" id="pearlConcept" tabindex="-1">E(A <b>rule</b>)</h1>') && homePage({}, { pearlNow: () => ({ title: 'T<x>' }) }).includes('tabindex="-1">E(T<x>)</h1>'));
  ok('the statement as the page\'s ladder lays it out, scrolled by pearlScroll()', html.includes('<div class="pearl-bodywrap" id="pearlBody" role="region" aria-labelledby="pearlConcept" tabindex="0" onscroll="pearlScroll()">[LADDER Title]</div>'));
  ok('Show all, by pearlToggleAll, drawn hidden and collapsed: the page shows it once it has measured the statement past its box', html.includes('<button class="pearl-morecue" id="pearlMore" data-action="pearlToggleAll" aria-controls="pearlBody" aria-expanded="false" hidden>[icon chevron-down icon-sm]<span>Show all</span></button>'));
  const acts = h => [...g1(h, /<div class="pearl-actions">([\s\S]*?)<\/div>/).matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);
  ok('the ways to recall, read it as a paragraph, see the source and open the note, in that order, each its own action', J(acts(html)) === J(['pearlRecall', 'pearlReading', 'pearlSourceToggle', 'pearlOpen']), J(acts(html)));
  ok('the paragraph button pressed only when the statement is read as written', html.includes('id="pearlReading" data-action="pearlReading" aria-controls="pearlBody" aria-pressed="false"') && homePage({}, { pearlAsWritten: true }).includes('aria-pressed="true" title="Read the complete statement as a paragraph"'));
  ok('the note it is from, through e(), as the open button\'s title and as the source; or "Your reference notes"', html.includes('title="E(Note <i>7</i>)">Read note [icon arrow-right icon-sm]</button>') && html.includes('aria-label="Pearl source" hidden>E(Note <i>7</i>)</div>') && homePage({}, { pearlNow: () => ({ concept: 'C' }) }).includes('hidden>E(Your reference notes)</div>'));
  ok('the prompt to explain it, hidden until asked for', html.includes('<div class="pearl-prompt" id="pearlPrompt" hidden>') && html.includes('<strong>Explain it in your own words.</strong>'));
  ok('and last, its figure, then its chapter\'s emblem', /\[EMBLEM\]\n      <\/div>/.test(homePage({}, { pearlEmblem: () => '[EMBLEM]', pearlFigure: () => '' })) && homePage({}, { pearlFigure: () => '[FIG]' }).includes('[FIG][EMBLEM]\n      </div>'));
}

head('the hero');
{
  const html = homePage();
  ok('the anatomy and the beating heart are the page\'s two images, each in its place', html.includes('<div class="hero-live atlas-3d">\n      [ATLAS-IMG]\n') && html.includes('<div class="h-beat">[HERO-IMG]</div>'));
  ok('live in 3D: the cardiac cycle, and the way back to the illustration', html.includes('<span class="hero-live-status"><i aria-hidden="true"></i> Live cardiac cycle</span>') && /id="atlasExplore" data-action="toggleAtlas3D"\s*aria-label="Show heart illustration" aria-pressed="true" title="Show heart illustration">\[icon layers icon-sm\] Illustration<\/button>/.test(html));
  const flat = homePage({}, { atlas3D: false });
  ok('as an illustration: says so, and offers 3D', flat.includes('<div class="hero-live">') && flat.includes('Illustrative anatomy</span>') && /aria-label="Explore heart in 3D" aria-pressed="false" title="Explore heart in 3D">\[icon layers icon-sm\] Explore in 3D<\/button>/.test(flat));
  ok('pause or play, by toggleAtlasMotion, as the heart is', html.includes('id="atlasLandingPause" data-action="toggleAtlasMotion" aria-label="Pause animation">[icon pause icon-sm]</button>') && homePage({}, { atlasPaused: true }).includes('aria-label="Play animation">[icon play icon-sm]</button>')
     && homePage({}, { atlasPaused: true }).includes('id="atlasPause" data-action="toggleAtlasMotion" aria-pressed="true">[icon play icon-sm]<span>Play motion</span>'));
  ok('the heart\'s menu, hidden, opened by toggleHeroMenu: chambers and flow, motion, and the model\'s credit', html.includes('<div class="hero-menu" id="heroMenu" role="group" aria-label="Heart model" hidden>') && /id="heroHeartBtn" data-action="toggleHeroMenu"/.test(html) && J(actionsOf(String(g1(html, /(<div class="hero-menu"[\s\S]*?<\/div>)/)))) === J(['toggleHeroMechanics', 'toggleAtlasMotion', 'toggleHeroCredit']));
  ok('chambers and flow pressed, and the explore button marked, only with the cutaway on', homePage({}, { heroCutaway: true }).includes('id="heroMechanics" data-action="toggleHeroMechanics"\n          aria-pressed="true"') && homePage({}, { heroCutaway: true }).includes('<button class="hero-mechanics is-active" id="atlasExplore"') && html.includes('aria-pressed="false">[icon layers icon-sm]<span>Chambers and flow</span>'));
}

head('the session strip and the greeting');
{
  const html = homePage();
  const strip = g1(html, /(<div class="atlas-session">[\s\S]*?<\/button><\/div>)/) || '';
  ok('explored, answered today and due', /<strong>80<small>%<\/small><\/strong><span>Explored<\/span><\/div><div><strong>6<\/strong><span>Answers today<\/span><\/div><div><strong>2<\/strong><span>Due<\/span>/.test(strip), strip.slice(0, 200));
  ok('a meter of the bank explored, said to a screen reader', strip.includes('aria-valuemax="5" aria-valuenow="4" aria-valuetext="4 of 5 questions explored"><span style="width:80%"></span>'));
  ok('explored is capped at all of it, and nothing with no bank', /<strong>100<small>/.test(homePage({}, { startedCount: () => 9 })) && /<strong>0<small>/.test(homePage({}, { TOTAL_Q: 0 })) && homePage({}, { TOTAL_Q: 0 }).includes('aria-valuemax="1" aria-valuenow="1"'));
  ok('with cards due, Review them (reviewAllDue); with history, Continue (goStudy); with nothing, Start the 20-minute plan (startPlan, 20 in data-plan)', strip.includes('<button data-action="reviewAllDue">Review [icon arrow-right icon-sm]</button>') && homePage({}, { dueQuestions: () => [] }).includes('<button data-action="goStudy">Continue')
     && homePage({}, { dueQuestions: () => [], startedCount: () => 0 }).includes('<button data-action="startPlan" data-plan="20" aria-label="Start a 20-minute study session">Start'));
  ok('today\'s answers are today\'s, not another day\'s, and none with none', /<strong>0<\/strong><span>Answers today/.test(homePage({ daily: { '2026-11-16': { a: 9, c: 9 } } })));
  ok('mastery is the chapters\' weighed by their size: (0.666×3 + 0.25×2 + 0×0) of 5 is 50%, handed to the Brain page', (hcalls.length = 0, homePage(), hcalls.some(c => c.startsWith('brain [2,4,80,50,'))), J(hcalls));
  ok('for someone new, what Chapters and Apex are, with the bank\'s size, and Got it by dismissHello; for others, nothing', homePage({}, { showHello: () => true }).includes('<i><b>Chapters</b> holds all 5 questions, grouped by topic.') && homePage({}, { showHello: () => true }).includes('<button class="hello-x" data-action="dismissHello">Got it</button>') && !html.includes('homeHello'));
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
const HK_READS = new Set(), HS_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const none = () => new Set();
  const outs = [true, false].map(hello => run(() => M.homeHtml(watched(Object.assign({ screen: 'home', srs: {}, mock: null }, JSON.parse(J(HS)), { daily: watched(JSON.parse(J(HS.daily)), none(), 'daily') }), HS_READS, 'S'),
    watched(BCH.slice(), none(), 'CHAPTERS'), watched(homeKit({ showHello: () => hello, pearlNow: () => watched(Object.assign({}, PEARL), none(), 'pearl'), POOL: watched(BPOOL.slice(), none(), 'POOL') }), HK_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('the Home page reads, of the state, the session\'s score, the days and the layout, and nothing else', !outs.some(o => o.startsWith('THREW')) && names(HS_READS) === 'daily homeLayout sessionCorrect sessionTotal', names(HS_READS));
  ok('of its kit, twenty-three names', names(HK_READS) === 'ATLAS_IMG HERO_IMG POOL TOTAL_Q atlas3D atlasPaused atlasReading buildBrain buildLabs dueQuestions e heroCutaway icon masteryFor pearlAll pearlAsWritten pearlEmblem pearlFigure pearlLadder pearlNow showHello startedCount todayISO', names(HK_READS));
  ok('it sets, deletes and defines nothing on the state, the days, the chapters, the pool, the pearl or the kit', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  ok('given everything frozen, it draws the same', run(() => M.homeHtml(deep(JSON.parse(J(HS))), deep(BCH.slice()), deep(homeKit({ pearlNow: () => deep(Object.assign({}, PEARL)) })))) === homePage());
}
const BK_READS = new Set(), BS_READS = new Set(), ART_READS = new Set(), INFO_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const none = () => new Set();
  const page = run(() => M.brainHtml(watched({ screen: 'home', srs: watched(JSON.parse(J(BS.srs)), none(), 'srs'), practice: watched(JSON.parse(J(BS.practice)), none(), 'practice'), mock: null, homeLayout: 'signal' }, BS_READS, 'S'),
    watched(BCH.slice(), none(), 'CHAPTERS'), watched({ [BCH[0]]: '#112233' }, none(), 'CH_COLORS'), 2, 4, 80, 30, watched({ a: 5, c: 3 }, none(), 'today'), watched(brainKit({ POOL: watched(BPOOL.map(q => watched(q, none(), 'question')), none(), 'POOL') }), BK_READS, 'kit')));
  const L = JSON.parse(J(LAY)), wL = watched(Object.assign(L, { nodes: watched(L.nodes.map(n => watched(n, none(), 'node')), none(), 'nodes'), edges: watched(L.edges, none(), 'edges') }), none(), 'layout');
  const artOut = run(() => M.brainArtHtml(watched({ 'Valves & <b>': '#112233' }, none(), 'CH_COLORS'), watched(artKit({ brainLayoutNow: () => wL, brainSel: 2 }), ART_READS, 'kit')));
  const infoOut = run(() => M.brainInfoHtml(watched({ brainArtL: watched({ sig: 'x', L: wL }, none(), 'brainArtL'), brainSel: 0, BRAIN_STATE_LABEL: LABEL, e: String, icon: () => '' }, INFO_READS, 'kit')));
  const names = s => [...s].sort().join(' ');
  ok('the Brain page reads, of the state, the cards scheduled and practised, and nothing else', !page.startsWith('THREW') && names(BS_READS) === 'practice srs', names(BS_READS) + ' · ' + page.slice(0, 40));
  ok('of its kit, eleven names; the art, six; the info, five', names(BK_READS) === 'POOL TOTAL_Q avgRetention brainInfoHtml buildBrainArt chIcon chInk e icon masteryFor todayISO' && names(ART_READS) === 'BRAIN_STATE_LABEL BRAIN_TUNE BrainMap brainLayoutNow brainSel e' && names(INFO_READS) === 'BRAIN_STATE_LABEL brainArtL brainSel e icon',
     names(BK_READS) + ' | ' + names(ART_READS) + ' | ' + names(INFO_READS));
  ok('none of the three sets, deletes or defines anything on what it is given, the layout and its neurons included', wrote.length === 0 && !artOut.startsWith('THREW') && !infoOut.startsWith('THREW'), wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const fz = deep(JSON.parse(J(LAY)));
  ok('given everything frozen, each draws the same', run(() => M.brainHtml(deep(JSON.parse(J(BS))), deep(BCH.slice()), deep({ [BCH[0]]: '#112233' }), 2, 4, 80, 30, deep({ a: 5, c: 3 }), deep(brainKit()))) === brainPage()
     && run(() => M.brainArtHtml(deep({ 'Valves & <b>': '#112233' }), artKit({ brainLayoutNow: () => fz, brainSel: 2, BRAIN_TUNE: deep({ MAX_SPARKS: 5 }) }))) === art({ brainSel: 2 })
     && run(() => M.brainInfoHtml(deep({ brainArtL: { sig: 'x', L: fz }, brainSel: 0, BRAIN_STATE_LABEL: LABEL, e: s => 'E(' + s + ')', icon: (n, c) => '[icon ' + n + (c ? ' ' + c : '') + ']' }))).includes('recall 91% today'));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/home.js]@@';
  const LINE = "function buildLabs(dueN){ return HomeScreen.labsHtml(S,CHAPTERS,dueN,{REF:typeof REF!=='undefined'?REF:undefined,Memory:typeof Memory!=='undefined'?Memory:undefined,TOTAL_Q,icon}); }";
  ok('buildLabs() is one line: the state, the chapters, how many are due, and the kit, the notes and the memory asked for before they are read', count(LINE) === 1 && count('function buildLabs(') === 1);
  ok('the module is written into the page once, above the first of its lines, buildBrain()', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT) && page.indexOf('function buildBrain(') > page.indexOf(SLOT) && page.indexOf('function buildBrain(') < page.indexOf(LINE));
  const handed = String(g1(page, /HomeScreen\.labsHtml\(S,CHAPTERS,dueN,\{([^}]*)\}\); \}/)).split(',').map(x => x.split(':')[0]);
  ok('the kit is the four names the module was seen to ask for', KIT_READS.size === 4 && handed.slice().sort().join(' ') === [...KIT_READS].sort().join(' '), handed.join(','));
  const mod = blankComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'home.js'), 'utf8'));
  ok('the Home page draws the Labs page with the page\'s line, handing on the count of cards due; nothing in the page calls it', mod.split('<div class="home-page-in">${buildLabs(dueN)}</div></section>').length === 2 && (page.match(/[^.\w$]buildLabs\(/g) || []).length === 1, String((page.match(/[^.\w$]buildLabs\(/g) || []).length));
  const WORDS = ['Hear it, see it, read it', 'Study tools', 'Views, findings and the arithmetic', 'Every trace, drawn live', 'Sounds, tracings, strips', 'things Apex knows', 'A mock block is open · resume it'];
  ok('and the Labs page\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = labs() + labs({ mock: { ids: ['a'] } }, 0);
  const la = [...new Set(actionsOf(all))].sort();
  ok('its markup names ten actions and carries no inline handler', J(la) === J(['goAnnotations', 'goEcho', 'goLab', 'goMemory', 'goPractice', 'goRefs', 'goSessions', 'goStats', 'goStudy', 'openSearch']) && inlineOf(all).length === 0, la.join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));

  const BRAIN = "function buildBrain(dueN,seenN,covered,masteryPct,today){ return HomeScreen.brainHtml(S,CHAPTERS,CH_COLORS,dueN,seenN,covered,masteryPct,today,\n  {POOL,TOTAL_Q,avgRetention,masteryFor,todayISO,chInk,chIcon,buildBrainArt,brainInfoHtml,e,icon}); }";
  const ART = "function buildBrainArt(){ return HomeScreen.brainArtHtml(CH_COLORS,{BrainMap:typeof BrainMap!=='undefined'?BrainMap:undefined,brainLayoutNow,brainSel,BRAIN_TUNE,BRAIN_STATE_LABEL,e}); }";
  const INFO = "function brainInfoHtml(){ return HomeScreen.brainInfoHtml({brainArtL,brainSel,BRAIN_STATE_LABEL,e,icon}); }";
  ok('buildBrain(), buildBrainArt() and brainInfoHtml() are each one line over the module, the art asking for BrainMap before it reads it', [BRAIN, ART, INFO].every(l => count(l) === 1) && ['function buildBrain(', 'function buildBrainArt(', 'function brainInfoHtml('].every(f => count(f) === 1) && page.indexOf(BRAIN) > page.indexOf(SLOT));
  const HOME = "function buildHome(){\n  atlasReading=!!pearlNow();\n  return HomeScreen.homeHtml(S,CHAPTERS,{POOL,TOTAL_Q,atlas3D,atlasPaused,atlasReading,heroCutaway,pearlAsWritten,\n    ATLAS_IMG:'<img class=\"atlas-anatomy\" data-atlas-heart=\"img\" src=\"data:image/webp;base64,@@SLOT[asset:assets/atlas-heart/heart.webp]@@\" alt=\"Illustrative anterior view of the heart\" decoding=\"async\">',\n    HERO_IMG:'<img data-hero-heart=\"img\" src=\"data:image/webp;base64,@@SLOT[asset:assets/hero-heart/heart.webp]@@\" alt=\"\" loading=\"eager\" decoding=\"async\">',\n    dueQuestions,startedCount,todayISO,masteryFor,pearlNow,pearlAll,pearlFigure,pearlEmblem,pearlLadder,showHello,buildBrain,buildLabs,e,icon});\n}";
  ok('buildHome() decides whether there is a pearl to read, then is the module\'s home screen, the slot above it', count(HOME) === 1 && count('function buildHome(') === 1 && page.indexOf(HOME) > page.indexOf(SLOT) && page.indexOf(SLOT) > page.lastIndexOf('\n', page.indexOf(SLOT) - 2) - 1 && page.indexOf('function buildHome(') < page.indexOf('function buildBrain('));
  const homeKitNames = String(g1(page, /HomeScreen\.homeHtml\(S,CHAPTERS,\{([\s\S]*?)\}\);\n\}/)).replace(/'[^']*'/g, '').replace(/\s+/g, '').split(',').map(x => x.split(':')[0]).sort().join(' ');
  ok('it hands the twenty-three names the Home page was seen to ask for', homeKitNames === [...HK_READS].sort().join(' '), homeKitNames);
  /* The split build (scripts/build-pwa.js) takes each heart image out of the app's code by its whole <img> element. Built as
     the build builds it, the page's line still holds both, where those patterns find them. */
  const pwa = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-pwa.js'), 'utf8');
  const HERO_RE = '/(<img data-hero-heart="img" src=")data:image\\/webp;base64,[A-Za-z0-9+/=]+(")/', ATLAS_RE = '/(<img class="atlas-anatomy" data-atlas-heart="img" src=")data:image\\/webp;base64,([A-Za-z0-9+/=]+)(")/';
  const built = String(g1(raw, /(function buildHome\(\)\{[\s\S]*?\n\})/)).replace(/@@SLOT\[asset:([^\]]+)\]@@/g, (m, f) => fs.readFileSync(path.join(__dirname, '..', f)).toString('base64'));
  const re = src => new RegExp(src.slice(1, src.lastIndexOf('/')));
  ok('the split build\'s patterns for the two heart images are the ones held here, and each finds its image in the page\'s line as built', pwa.includes('const heroRe = ' + HERO_RE + ';') && pwa.includes('const atlasRe = ' + ATLAS_RE + ';') && re(HERO_RE).test(built) && re(ATLAS_RE).test(built) && built.length > 60000,
     pwa.includes('const heroRe = ' + HERO_RE + ';') + ' ' + pwa.includes('const atlasRe = ' + ATLAS_RE + ';') + ' ' + built.length);
  ok('each image is filled from the asset the splash shares, once each in the page\'s line, and in no module', (count('@@SLOT[asset:assets/hero-heart/heart.webp]@@') >= 2) && (HOME.split('@@SLOT[asset:').length - 1) === 2 && !fs.readdirSync(path.join(__dirname, '..', 'src', 'app')).some(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', f), 'utf8').includes('@@SLOT[')), String(count('@@SLOT[asset:assets/hero-heart/heart.webp]@@')));
  const HWORDS = ['Make one <br>idea stick.', 'The living heart', 'Explain it in your own words.', 'Answers today', 'New here?', 'Chambers and flow'];
  ok('and the Home page\'s own words are no longer in the page', HWORDS.every(t => count(t) === 0), HWORDS.map(t => count(t)).join(' '));
  const hall = homePage({}, { showHello: () => true }) + homePage({}, { dueQuestions: () => [], startedCount: () => 0 }) + homePage({}, { dueQuestions: () => [] });
  const ha = [...new Set(actionsOf(hall))].sort();
  ok('the Home page names seventeen actions', J(ha) === J(['dismissHello', 'goRefs', 'goStudy', 'homeGo', 'pearlNext', 'pearlOpen', 'pearlReading', 'pearlRecall', 'pearlSourceToggle', 'pearlToggleAll', 'reviewAllDue', 'startPlan', 'toggleAtlas3D', 'toggleAtlasMotion', 'toggleHeroCredit', 'toggleHeroMechanics', 'toggleHeroMenu']), ha.join(' '));
  /* A scroll does not bubble to the document, and a key on a tab is the tab list's: those three stay inline for now. */
  const hh = [...new Set(handlersOf(hall))].sort();
  ok('and its only inline handlers are the pager\'s and the pearl\'s scroll and the tabs\' keys, each a function the page declares once',
     J(inlineOf(hall)) === J([0, 1, 2].flatMap(() => ['onscroll', 'onscroll', 'onkeydown'])) && J(hh) === J(['homePagerScroll()', 'homeTabKey(event)', 'pearlScroll()']) && ['homePagerScroll', 'homeTabKey', 'pearlScroll'].every(n => count('function ' + n + '(') === 1),
     inlineOf(hall).join(' ') + ' · ' + hh.join(' '));
  const kitNames = re => String(g1(page, re)).replace(/\s+/g, '').split(',').map(x => x.split(':')[0]).sort().join(' ');
  ok('each hands the names its member was seen to ask for', kitNames(/HomeScreen\.brainHtml\([^{]*\{([^}]*)\}\); \}/) === [...BK_READS].sort().join(' ') && kitNames(/HomeScreen\.brainArtHtml\(CH_COLORS,\{([^}]*)\}\); \}/) === [...ART_READS].sort().join(' ') && kitNames(/HomeScreen\.brainInfoHtml\(\{([^}]*)\}\); \}/) === [...INFO_READS].sort().join(' '),
     kitNames(/HomeScreen\.brainArtHtml\(CH_COLORS,\{([^}]*)\}\); \}/));
  ok('the Home page draws the Brain page with what it counted; brainPick() draws the info again with the page\'s line', mod.split('<div class="home-page-in">${buildBrain(dueN,seenN,covered,masteryPct,today)}</div></section>').length === 2 && count("const info=document.getElementById('brainInfo'); if(info) info.innerHTML=brainInfoHtml();") === 1
     && (page.match(/[^.\w$]buildBrain\(/g) || []).length === 1 && (page.match(/[^.\w$]buildBrainArt\(/g) || []).length === 1 && (page.match(/[^.\w$]brainInfoHtml\(/g) || []).length === 2);
  ok('brainHash(), brainDendrites() and brainAxon() are no longer the page\'s; brainUnits(), brainLayoutNow() and brainPick() are', ['brainHash', 'brainDendrites', 'brainAxon'].every(n => count('function ' + n + '(') === 0 && !new RegExp('[^.\\w$]' + n + '\\(').test(page)) && ['brainUnits', 'brainLayoutNow', 'brainPick'].every(n => count('function ' + n + '(') === 1));
  const BWORDS = ['What you remember', 'recall, cards scheduled', 'Practise this chapter', 'Tap a neuron', 'parts of the bank lit', 'percent mastered'];
  ok('and the Brain page\'s own words are no longer in the page', BWORDS.every(t => count(t) === 0), BWORDS.map(t => count(t)).join(' '));
  const ballx = brainPage() + art() + run(() => M.brainInfoHtml({ brainArtL: { L: LAY }, brainSel: 0, BRAIN_STATE_LABEL: LABEL, e: String, icon: () => '' }));
  const ba = [...new Set(actionsOf(ballx))].sort();
  ok('the Brain page names three actions, and its only inline handler is the brain\'s keys, a function the page declares once', J(ba) === J(['brainTap', 'startChapter', 'startDue']) && J(inlineOf(ballx)) === J(['onkeydown']) && J(handlersOf(ballx)) === J(['brainKey(event)']) && count('function brainKey(') === 1,
     ba.join(' ') + ' · ' + inlineOf(ballx).join(' '));
  /* A tap is looked up in ACTIONS: each action the three pages name is held to that table, as written, and to no other. */
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const keyed = (t, n) => (tableOf(t).match(new RegExp('(^|\\s)' + n + ':', 'g')) || []).length;
  const TABLES = ['ACTIONS', 'INPUT_ACTIONS', 'CHANGE_ACTIONS'];
  const ENTRY = { goAnnotations: 'goAnnotations:()=>goAnnotations(),', goEcho: 'goEcho:()=>goEcho(),', goLab: 'goLab:()=>goLab(),', goMemory: 'goMemory:()=>goMemory(),', goPractice: 'goPractice:()=>goPractice(),',
    goRefs: 'goRefs:()=>goRefs(),', goSessions: 'goSessions:()=>goSessions(),', goStats: 'goStats:()=>goStats(),', goStudy: 'goStudy:()=>goStudy(),', openSearch: 'openSearch:()=>openSearch(),',
    dismissHello: 'dismissHello:()=>dismissHello(),', homeGo: 'homeGo:el=>homeGo(Number(el.dataset.page)),', pearlNext: 'pearlNext:()=>pearlNext(),', pearlOpen: 'pearlOpen:()=>pearlOpen(),', pearlReading: 'pearlReading:()=>pearlReading(),',
    pearlRecall: 'pearlRecall:()=>pearlRecall(),', pearlSourceToggle: 'pearlSourceToggle:()=>pearlSourceToggle(),', pearlToggleAll: 'pearlToggleAll:()=>pearlToggleAll(),', reviewAllDue: "reviewAllDue:()=>startQuiz(null,'due',dueQuestions()),",
    startPlan: 'startPlan:el=>startPlan(Number(el.dataset.plan)),', toggleAtlas3D: 'toggleAtlas3D:()=>toggleAtlas3D(),', toggleAtlasMotion: 'toggleAtlasMotion:()=>toggleAtlasMotion(),', toggleHeroCredit: 'toggleHeroCredit:()=>toggleHeroCredit(),',
    toggleHeroMechanics: 'toggleHeroMechanics:()=>toggleHeroMechanics(),', toggleHeroMenu: 'toggleHeroMenu:(el,ev)=>toggleHeroMenu(undefined,ev),', brainTap: 'brainTap:(el,ev)=>brainTap(ev),',
    startChapter: 'startChapter:el=>startQuiz(el.dataset.ch),', startDue: "startDue:()=>startQuiz(null,'due'),"};
  const named = [...new Set(la.concat(ha, ba))].sort();
  ok('the twenty-eight actions of the three pages are each in ACTIONS once, as written, and in no other table',
     named.length === 28 && named.every(n => ENTRY[n] && keyed('ACTIONS', n) === 1 && keyed('INPUT_ACTIONS', n) === 0 && keyed('CHANGE_ACTIONS', n) === 0 && tableOf('ACTIONS').split(ENTRY[n]).length === 2),
     named.length + ' · ' + named.map(n => n + ':' + TABLES.map(t => keyed(t, n)).join('/') + (ENTRY[n] && tableOf('ACTIONS').split(ENTRY[n]).length === 2 ? '' : ' (not as written)')).join(' '));
  const CALLS = ['brainTap', 'dismissHello', 'dueQuestions', 'goAnnotations', 'goEcho', 'goLab', 'goMemory', 'goPractice', 'goRefs', 'goSessions', 'goStats', 'goStudy', 'homeGo', 'openSearch', 'pearlNext', 'pearlOpen', 'pearlReading',
    'pearlRecall', 'pearlSourceToggle', 'pearlToggleAll', 'startPlan', 'startQuiz', 'toggleAtlas3D', 'toggleAtlasMotion', 'toggleHeroCredit', 'toggleHeroMechanics', 'toggleHeroMenu'];
  ok('they call twenty-seven functions the page declares, once each, and the page listens for taps on the document',
     CALLS.every(n => count('function ' + n + '(') === 1) && count('Actions.install(document,ACTIONS);') === 1, CALLS.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  ok('and the ids the page looks for are drawn: the brain, its tilt, its net and the info', ['brain3d', 'brainTilt', 'brainInfo'].every(id => times(brainPage(), 'id="' + id + '"') === 1) && ['brainArt', 'brainNet'].every(id => times(art(), 'id="' + id + '"') === 1)
     && ["getElementById('brainInfo')", "getElementById('brainTilt')", "getElementById('brainNet')"].every(t => count(t) >= 1) && count("'#brainArt") >= 1, ["getElementById('brainInfo')", "getElementById('brainTilt')", "getElementById('brainNet')", "'#brainArt"].map(t => count(t)).join(' '));

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

  /* The Brain page as the page draws it: its own lines and helpers over the real FSRS and BrainMap, a bank of three
     chapters made here, and the clock held at one moment. The layout starts unmade and a neuron already chosen, so the
     info can only say what the chosen one holds if the art has laid the brain out first. */
  const NOWB = new Date(2026, 10, 17, 9, 0).getTime();
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOWB); } static now() { return NOWB; } }
  const bparts = [read('src/core/fsrs.js'), read('src/core/brain.js'), whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function chIcon(ch,cls){', '\n'), whole('function chInk(hex){', '\n}'),
    whole('function isoLocal(d){', '\n'), whole('function todayISO(){', '\n'), whole('function masteryFor(ch){', '\n}'), whole('function avgRetention(){', '\n}'), whole('const BRAIN_PER=16,', '\n'), whole('const BRAIN_TUNE={', '\n'),
    whole('let brainArtL=null,', '\n'), whole('function qRecall(q){', '\n}'), whole('function brainUnits(){', '\n}'), whole('function brainLayoutNow(){', '\n}'), read('src/app/home.js'), whole('function buildBrain(dueN,', '}); }'), whole('function buildBrainArt(){', '\n'), whole('function brainInfoHtml(){', '\n')].join('\n');
  const bctx = { Date: FixedDate, themeIsDark: () => false, CHAPTERS: ['Valves & more', 'Rhythm', 'Empty'], CH_COLORS: { Rhythm: '#102030' }, CH_ICONS: {}, TOTAL_Q: 4,
    POOL: [{ id: 'v1', ch: 'Valves & more' }, { id: 'v2', ch: 'Valves & more' }, { id: 'r1', ch: 'Rhythm' }, { id: 'r2', ch: 'Rhythm' }],
    S: { srs: { v1: { stability: 1e9, difficulty: 5, last: '2026-11-17', due: '2026-11-17', reps: 3, lapses: 0 } }, practice: { r1: { c: 2, a: 2 } } } };
  bctx.window = bctx; vm.createContext(bctx);
  const bask = code => { try { return vm.runInContext(code, bctx); } catch (err) { return 'THREW ' + err.message; } };
  const bloaded = bask(bparts + '\nbrainSel=0;\n"loaded"');
  const bpage = String(bask('buildBrain(1,2,50,37,{a:3,c:2})'));
  const neuronsDrawn = (bpage.match(/<g class="neuron/g) || []).length;
  ok('the page\'s own lines draw the Brain page over the real BrainMap: a neuron for each question, since a chapter of fewer than sixteen gives each its own part', bloaded === 'loaded' && neuronsDrawn === 4 && bpage.includes('id="brainArt"'), String(bloaded).slice(0, 60) + ' · ' + neuronsDrawn + ' neurons');
  const states = [...bpage.matchAll(/<g class="neuron[^"]*" data-i="(\d)" data-state="([a-z]+)"/g)].map(m => m[2]);
  ok('each neuron lit as the page\'s own recall says: the certain card solid, the one practised twice weak, the others not seen yet', J(states) === J(['solid', 'new', 'weak', 'new']), J(states));
  ok('and the info, drawn after the art laid the brain out, says what the chosen neuron holds: the first chapter\'s first question, certain to be recalled', /<div class="brain-info" id="brainInfo" aria-live="polite"><span class="brain-info-k">This neuron<\/span> <b>Valves &amp; more<\/b>\s*<span class="brain-info-m">questions 1–1 · solid · recall 100% today<\/span>/.test(bpage), g1(bpage, /<div class="brain-info"[^>]*>([\s\S]{0,160})/));
  const brows = [...bpage.matchAll(/<span class="brain-ch-meta">(.*?)<\/span><\/span>\s*<span class="brain-ch-pct" aria-hidden="true">([^<]*)</g)].map(m => m[1] + ' ' + m[2]);
  ok('the rows as the page computes them: one of two certain is 50%; one practised twice of two is 22%; the empty chapter none of none', J(brows) === J(['1 of 2 seen · <em>1 due</em> 50%', '1 of 2 seen 22%', '0 of 0 seen 0%']) && bpage.includes('--c:#102030;--ci:#'), J(brows));
  ok('and the page\'s figures as buildHome() handed them, with the real recall of the one scheduled card', bpage.includes('<b>50%</b><i>seen · 2 of 4</i>') && bpage.includes('<b>100%</b><i>recall, cards scheduled</i>') && bpage.includes('answered today · 2 right'), g1(bpage, /bs-ret"><b>([^<]*)</));
  bask('brainSel=2');
  ok('once another neuron is chosen, the page\'s own lines say so: the info, and the art marking it', String(bask('brainInfoHtml()')).includes('<b>Rhythm</b>') && String(bask('buildBrainArt()')).includes('<g class="neuron sel" data-i="2"'), g1(String(bask('brainInfoHtml()')), /<b>([^<]*)<\/b>/));

  /* The Home page as the page draws it: its own buildHome() and its own pearl and greeting helpers, the real Pearl, and
     icon() and e(); the Brain and Labs pages are recorded stand-ins here, held above. First with a note's pearl, then with
     none, then for someone new. */
  const hparts = [read('src/core/pearl.js'), whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function chIcon(ch,cls){', '\n'),
    whole('let pearlCache=null,', '\n'), whole('let pearlAsWritten=false;', '\n'), whole('function pearlAll(){', '\n}'), whole('function pearlNow(){', '\n}'), whole('let pearlPicked=null,', '\n'), whole('function pearlFigure(p){', '\n}'),
    whole('function pearlChapter(p){', '\n}'), whole('function pearlEmblem(p){', '\n}'), whole('const PEARL_NUM=', '\n'), whole('function pearlMark(escaped){', '\n}'), whole('const PEARL_KINDS=', '};'), whole('function pearlLadder(p){', '\n}'),
    whole('function helloSeen(){', '\n}'), whole('function showHello(){', '\n}'), read('src/app/home.js'), whole('function buildHome(){', '\n}')].join('\n');
  const store = {};
  const hctx = { CHAPTERS: ['Valves & more', 'Rhythm'], CH_ICONS: {}, POOL: [{ id: 'v1', ch: 'Valves & more' }, { id: 'r1', ch: 'Rhythm' }], TOTAL_Q: 2, LOG: [],
    S: { srs: {}, sessionTotal: 0, sessionCorrect: 0, daily: {}, homeLayout: 'signal' }, localStorage: { getItem: k => store[k] || null },
    dueQuestions: () => [], startedCount: () => 0, todayISO: () => '2026-11-17', masteryFor: () => 0, buildBrain: () => '[BRAIN]', buildLabs: () => '[LABS]' };
  hctx.window = hctx; vm.createContext(hctx);
  const hask = code => { try { return vm.runInContext(code, hctx); } catch (err) { return 'THREW ' + err.message; } };
  const hloaded = hask(hparts + '\nvar atlasPaused=false, atlasReading=false, atlas3D=true, heroCutaway=false;\npearlCache=[{concept:"Dose & timing",title:"T",text:"Give 5 mg within 12 hours of onset.",chapter:"Rhythm notes",source:"My note"}];\n"loaded"');
  const withPearl = String(hask('buildHome()'));
  ok('the page\'s own buildHome() over its own pearl: the card shown, the reading flag set, the statement with its numbers marked, the chapter\'s emblem', hloaded === 'loaded' && withPearl.includes('<div class="pearl-card" id="pearlCard">') && hask('atlasReading') === true && withPearl.includes('<b class="pearl-num">5 mg</b>') && withPearl.includes('Dose &amp; timing</h1>') && withPearl.includes('<span class="pe-cap">Rhythm</span>'),
     String(hloaded).slice(0, 60) + ' · ' + hask('atlasReading'));
  ok('the hero\'s two images as the page hands them over, with the build\'s slots in them', withPearl.includes('<img class="atlas-anatomy" data-atlas-heart="img" src="data:image/webp;base64,@@SLOT[asset:assets/atlas-heart/heart.webp]@@"') && withPearl.includes('<div class="h-beat"><img data-hero-heart="img" src="data:image/webp;base64,@@SLOT[asset:assets/hero-heart/heart.webp]@@"'));
  ok('someone new, with no history and not yet welcomed, is greeted with the bank\'s size', withPearl.includes('holds all 2 questions') && (store['accsap12.welcomed'] = '1', !String(hask('buildHome()')).includes('homeHello')));
  /* The notes gone and the pearl let go; the last pick (pearlPicked) is left as it stands, so a pearlNow() that fell
     back to it would draw a card. */
  hask('pearlCache=[]; pearlCurrent=null;');
  const noPearl = String(hask('buildHome()'));
  ok('with no notes, no card: the reading flag cleared and the intro shown', !noPearl.includes('pearl-card') && hask('atlasReading') === false && noPearl.includes('<section class="atlas-intro" id="atlasIntro" aria-labelledby="atlasTitle">'), String(hask('atlasReading')));

  /* A tap, as the page takes it: the real src/core/actions.js listening on a stand-in document over the page's three
     tables, with a recording stand-in for each function they call, and as the element each control the page's own lines
     drew, its attributes read back as a browser reads them (so a chapter's name is the name, not its escaped text). A
     disabled button is not tapped, as a browser fires no click on one. Every other control is tapped, in the order drawn:
     the Labs page as drawn above with notes, a memory and a block open; the Brain page as drawn above, the first neuron
     chosen and a card due; and the Home page with two pearls, a card due, and someone new to greet. An action handed the
     event is recorded as "the click", so it is seen to be handed the click it was tapped with. */
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const tables = TABLES.map(t => (page.match(new RegExp('const ' + t + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + t + '={};'])[0].replace(/^const /, 'var ')).join('\n');
  const called = [...new Set([...tables.matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))].filter(n => n !== 'Number');
  vm.runInContext(read('src/core/actions.js') + '\nvar S={chapter:null,mock:{i:0}}, offlineJob={busy:false};\n'
    + called.map(n => `function ${n}(){ var a=[].slice.call(arguments).map(function(x){ return x===window.__ev ? 'the click' : x===undefined ? 'undefined' : x; }); tcalls.push(${J(n)} + (a.length ? " " + JSON.stringify(a) : "")); return n==='dueQuestions' ? 'DUE' : undefined; }`.replace(/\bn===/, J(n) + '===')).join('\n') + '\n' + tables
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);\nActions.install(doc,INPUT_ACTIONS,"input");\nActions.install(doc,CHANGE_ACTIONS,"change");', tctx);
  const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const controls = h => [...h.matchAll(/<(button|select|input|svg)\b([^>]*)>/g)].map(m => {
    const at = Object.fromEntries([...m[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map(x => [x[1], unescape(x[2] || '')]));
    const dataset = Object.fromEntries(Object.keys(at).filter(k => k.startsWith('data-')).map(k => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), at[k]]));
    const el = { nodeType: 1, value: '', dataset, disabled: 'disabled' in at, getAttribute: k => (k in at ? at[k] : null), closest: sel => (sel === '[data-action]' && 'data-action' in at ? el : null) };
    return el; }).filter(el => !el.disabled);
  const fire = (type, h) => { tcalls.length = 0; controls(h).forEach(el => { const ev = { type, target: el }; tctx.__ev = ev; tctx.listeners.filter(l => l[0] === type).forEach(l => l[1](ev)); }); return tcalls.slice(); };
  const labTaps = fire('click', full);
  ok('tapped, the Labs page: each lab, then each tool, each its own function',
     J(labTaps) === J(['goLab', 'goEcho', 'goPractice', 'goSessions', 'goStudy', 'openSearch', 'goStats', 'goRefs', 'goMemory', 'goAnnotations']), J(labTaps));
  const brainTaps = fire('click', bpage);
  ok('tapped, the Brain page: the brain handed the click, the chosen neuron\'s chapter, the review, and each chapter\'s row, each by its own name',
     J(brainTaps) === J(['brainTap ["the click"]', 'startQuiz ["Valves & more"]', 'startQuiz [null,"due"]', 'startQuiz ["Valves & more"]', 'startQuiz ["Rhythm"]', 'startQuiz ["Empty"]']), J(brainTaps));
  delete store['accsap12.welcomed'];
  hask('pearlCache=[{concept:"One",title:"A",text:"First.",chapter:"Rhythm notes",source:"N1"},{concept:"Two",title:"B",text:"Second.",chapter:"Rhythm notes",source:"N2"}]; pearlCurrent=null; dueQuestions=()=>[1];');
  const greeted = String(hask('buildHome()'));
  const homeTaps = fire('click', greeted);
  ok('tapped, the Home page: the notes, the heart\'s explore, pause and menu (handed the click), its chambers, motion and credit, the pearl\'s six, the review of every card due, Got it, and each tab with its page',
     greeted.includes('homeHello') && greeted.includes('pearl-card') && J(homeTaps) === J(['goRefs', 'toggleAtlas3D', 'toggleAtlasMotion', 'toggleHeroMenu ["undefined","the click"]', 'toggleHeroMechanics', 'toggleAtlasMotion', 'toggleHeroCredit',
       'pearlNext', 'pearlToggleAll', 'pearlRecall', 'pearlReading', 'pearlSourceToggle', 'pearlOpen', 'dueQuestions', 'startQuiz [null,"due","DUE"]', 'dismissHello', 'homeGo [0]', 'homeGo [1]', 'homeGo [2]']), J(homeTaps));
  ok('and a key or a choice on any of the three pages calls nothing here', J(fire('input', full + bpage + greeted).concat(fire('change', full + bpage + greeted))) === J([]));

}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
