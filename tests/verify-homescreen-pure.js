#!/usr/bin/env node
/*
 * The home screen's pages — src/app/home.js. So far the Labs page and the Brain page; the Home page, with the
 * hero and the pearl, is still the page's own function.
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
 *   - the Brain page: what it is, the brain and the chosen neuron in their places, the gauge, the figures, the
 *     way to review, and a row for each chapter;
 *   - the brain: nothing without BrainMap or neurons; a neuron for each part, chosen or not; lobes, axons,
 *     signals, glow, flashes, sparks and branches as the layout says; and what the chosen neuron holds;
 *   - that each reads the names it should of the state and the kit, and changes nothing;
 *   - the page's lines, the handlers the markup names, and those lines over the page's own helpers: the Labs
 *     page with and without notes and Apex's memory, the Brain page over the real FSRS and BrainMap.
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
  ok('with cards due, the way to review them all', html.includes('<div class="brain-actions"><button class="brain-go primary" onclick="startQuiz(null,\'due\')">[icon repeat icon-sm] Review 2 due</button></div>') && !brainPage({}, [0, 4, 80, 30, { a: 5, c: 3 }]).includes('brain-actions'));
  const rows = h => [...h.matchAll(/<button class="brain-ch" style="--c:([^;]*);--ci:([^"]*)" onclick="startQuiz\(([^)]*)\)"\s*aria-label="([^"]*)">\s*<span class="brain-ch-ic" aria-hidden="true">([^<]*)<\/span>\s*<span class="brain-ch-main"><b>([^<]*)<\/b>\s*<span class="brain-bar" aria-hidden="true"><i data-w="(\d+)"><\/i><\/span>\s*<span class="brain-ch-meta">(.*?)<\/span><\/span>\s*<span class="brain-ch-pct" aria-hidden="true">([^<]*)<\/span>\s*<\/button>/g)].map(m => m.slice(1));
  const r = rows(html);
  ok('under "Chapters", a row for each chapter, in the bank\'s order, in its accent or the teal, with its ink', html.indexOf('<h3 class="page-h3">Chapters</h3>') > html.indexOf('brain-hero') && J(r.map(x => [x[0], x[1]])) === J([['#112233', 'INK(#112233)'], ['var(--teal)', 'INK(var(--teal))'], ['var(--teal)', 'INK(var(--teal))']]), J(r.map(x => [x[0], x[1]])));
  ok('each a way to practise its chapter, the name\'s quotes written as entities', J(r.map(x => x[2])) === J(['&quot;Valves & \\&quot;more\\&quot;&quot;', '&quot;Rhythm&quot;', '&quot;Quiet&quot;']), J(r.map(x => x[2])));
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
  ok('an svg found by its id, in BrainMap\'s view, tapped and keyed by the page\'s handlers', html.startsWith('<svg class="brain-svg" id="brainArt" viewBox="' + BrainMap.BRAIN.VIEW + '" role="group"') && J(handlersOf(html)) === J(['brainTap(event)', 'brainKey(event)']) && html.endsWith('</g></svg>'));
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
  ok('and the way to practise its chapter, the name\'s quotes written as entities', html.endsWith('<button class="brain-go primary" onclick="startQuiz(&quot;Valves & <b>&quot;)">[icon play icon-sm] Practise this chapter</button>') && J(handlersOf(html)) === J(['startQuiz(&quot;Valves & <b>&quot;)']));
  ok('a neuron not seen yet says so, and no recall', I({ brainSel: 1 }).includes('<span class="brain-info-m">E(questions 4–6) · not seen yet</span>'), g1(I({ brainSel: 1 }), /<span class="brain-info-m">([^<]*)</));
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
  ok('buildHome() still draws the Labs page with it, handing on the count of cards due', count('<div class="home-page-in">${buildLabs(dueN)}</div></section>') === 1 && (page.match(/[^.\w$]buildLabs\(/g) || []).length === 2, String((page.match(/[^.\w$]buildLabs\(/g) || []).length));
  const WORDS = ['Hear it, see it, read it', 'Study tools', 'Views, findings and the arithmetic', 'Every trace, drawn live', 'Sounds, tracings, strips', 'things Apex knows', 'A mock block is open · resume it'];
  ok('and the Labs page\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = labs() + labs({ mock: { ids: ['a'] } }, 0);
  const handlers = [...new Set(handlersOf(all).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its markup names ten handlers', J(handlers) === J(['goAnnotations', 'goEcho', 'goLab', 'goMemory', 'goPractice', 'goRefs', 'goSessions', 'goStats', 'goStudy', 'openSearch']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));

  const BRAIN = "function buildBrain(dueN,seenN,covered,masteryPct,today){ return HomeScreen.brainHtml(S,CHAPTERS,CH_COLORS,dueN,seenN,covered,masteryPct,today,\n  {POOL,TOTAL_Q,avgRetention,masteryFor,todayISO,chInk,chIcon,buildBrainArt,brainInfoHtml,e,icon}); }";
  const ART = "function buildBrainArt(){ return HomeScreen.brainArtHtml(CH_COLORS,{BrainMap:typeof BrainMap!=='undefined'?BrainMap:undefined,brainLayoutNow,brainSel,BRAIN_TUNE,BRAIN_STATE_LABEL,e}); }";
  const INFO = "function brainInfoHtml(){ return HomeScreen.brainInfoHtml({brainArtL,brainSel,BRAIN_STATE_LABEL,e,icon}); }";
  ok('buildBrain(), buildBrainArt() and brainInfoHtml() are each one line over the module, the art asking for BrainMap before it reads it', [BRAIN, ART, INFO].every(l => count(l) === 1) && ['function buildBrain(', 'function buildBrainArt(', 'function brainInfoHtml('].every(f => count(f) === 1) && page.indexOf(BRAIN) > page.indexOf(SLOT));
  const kitNames = re => String(g1(page, re)).replace(/\s+/g, '').split(',').map(x => x.split(':')[0]).sort().join(' ');
  ok('each hands the names its member was seen to ask for', kitNames(/HomeScreen\.brainHtml\([^{]*\{([^}]*)\}\); \}/) === [...BK_READS].sort().join(' ') && kitNames(/HomeScreen\.brainArtHtml\(CH_COLORS,\{([^}]*)\}\); \}/) === [...ART_READS].sort().join(' ') && kitNames(/HomeScreen\.brainInfoHtml\(\{([^}]*)\}\); \}/) === [...INFO_READS].sort().join(' '),
     kitNames(/HomeScreen\.brainArtHtml\(CH_COLORS,\{([^}]*)\}\); \}/));
  ok('buildHome() draws the Brain page with what it counted; brainPick() draws the info again with the page\'s line', count('<div class="home-page-in">${buildBrain(dueN,seenN,covered,masteryPct,today)}</div></section>') === 1 && count("const info=document.getElementById('brainInfo'); if(info) info.innerHTML=brainInfoHtml();") === 1
     && (page.match(/[^.\w$]buildBrain\(/g) || []).length === 2 && (page.match(/[^.\w$]buildBrainArt\(/g) || []).length === 1 && (page.match(/[^.\w$]brainInfoHtml\(/g) || []).length === 2);
  ok('brainHash(), brainDendrites() and brainAxon() are no longer the page\'s; brainUnits(), brainLayoutNow() and brainPick() are', ['brainHash', 'brainDendrites', 'brainAxon'].every(n => count('function ' + n + '(') === 0 && !new RegExp('[^.\\w$]' + n + '\\(').test(page)) && ['brainUnits', 'brainLayoutNow', 'brainPick'].every(n => count('function ' + n + '(') === 1));
  const BWORDS = ['What you remember', 'recall, cards scheduled', 'Practise this chapter', 'Tap a neuron', 'parts of the bank lit', 'percent mastered'];
  ok('and the Brain page\'s own words are no longer in the page', BWORDS.every(t => count(t) === 0), BWORDS.map(t => count(t)).join(' '));
  const ballx = brainPage() + art() + run(() => M.brainInfoHtml({ brainArtL: { L: LAY }, brainSel: 0, BRAIN_STATE_LABEL: LABEL, e: String, icon: () => '' }));
  const bh = [...new Set(handlersOf(ballx).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('the Brain page names three handlers, each a function the page declares once', J(bh) === J(['brainKey', 'brainTap', 'startQuiz']) && bh.every(n => count('function ' + n + '(') === 1), bh.map(n => n + ':' + count('function ' + n + '(')).join(' '));
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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
