#!/usr/bin/env node
/*
 * "Your annotations": the questions with a sticky note or pencil marks — src/app/annotations.js.
 *
 *   node tests/verify-annotations-pure.js
 *
 * Pure Node, over invented questions and notes. The module is given what the page has and returns markup;
 * nothing in the first six parts has a page. The helpers it is handed there are stand-ins that say what
 * they were asked (e('x') is "E(x)", clip('x', 9) is "CLIP(x,9)"), so what is expected is worked out here
 * from the row, never read back from the module, and a helper that was not called shows as its absence.
 * The stand-in for FlagSet.words() has a rule of its own (only text that starts "w:" holds words), so a
 * module that decided what words are by itself would be seen.
 *
 * What is measured, rather than assumed:
 *   - a row: the question's id as data, its chapter's colour, what is said of flags, notes and pencil,
 *     and what the notes and the stem are handed to on their way to the page;
 *   - the list: a row each in the order given, and which of two lines stands in for no rows;
 *   - the count, and the Practise button's words;
 *   - the screen: the box, the two buttons, and that the count, the list and the button's words in it are
 *     the three pieces the page asks for again as a key goes down;
 *   - that it reads eight names of the page and changes nothing it is given;
 *   - the page's lines: what they hand over is what the module asks for and no more of the page's state
 *     than it reads, the actions and ids the markup names are the page's, with no inline handler (E2), and the page's own code over the real FlagSet and the page's own helpers
 *     draws, repaints on typing, starts a quiz and follows a tap as the markup has it.
 *
 * Not asserted: the chip's tint for a chapter with no colour of its own. The page writes the teal's name
 * with two hex digits after it there, which is no colour; that is as it was before the screen moved.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const A = require('../src/app/annotations.js').AnnotationsScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
/* A module that throws says so in the markup, so the check that asked says FAIL and the run goes on. */
const run = f => { try { return String(f()); } catch (err) { return 'THREW ' + err.message; } };

/* Stand-ins that say what they were asked. None writes a tag, so the words between tags can be read whole. */
const KIT = Object.freeze({
  FlagSet: Object.freeze({ words: q => (String(q).startsWith('w:') ? ['w'] : []), highlight: (t, q, esc) => 'H(' + t + '|' + q + '|' + esc('esc') + ')' }),
  chInk: c => 'INK(' + c + ')',
  clip: (s, n) => 'CLIP(' + s + ',' + n + ')',
  e: s => 'E(' + s + ')',
  icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
});
/* The page as the module is handed it: what is typed, every annotated row, and the rest. */
const pageOf = (q, rows, over) => Object.assign({ ANNO: { q, rows }, S: { flagged: new Set(), missed: new Set() }, CH_COLORS: { Rhythm: '#112233' } }, KIT, over);
/* A row as FlagSet.annotated() makes one; at and hay are there because a real row has them. */
const row = (id, over, qover) => Object.assign({ id, q: Object.assign({ ch: 'Rhythm', n: 12, s: 'the stem' }, qover), notes: 1, text: 'what the notes say', ink: false, at: 5, hay: 'not read here' }, over);

/* The parts of the markup a reader sees. */
const g = (s, re) => (s.match(re) || [])[1];
const rowsOf = html => html.split('<button class="hit anno-row"').slice(1).map(s => {
  s = s.slice(0, s.indexOf('</button>'));
  return {
    id: g(s, /data-anno="([^"]*)"/), edge: g(s, /style="border-left-color:([^"]*)"/),
    tint: g(s, /class="hit-ch" style="background:([^;]*);/), ink: g(s, /class="hit-ch" style="[^"]*;color:([^"]*)"/), chip: g(s, /class="hit-ch"[^>]*>([^<]*)</),
    flags: [...s.matchAll(/<span class="hit-flag[^"]*">([^<]*)<\/span>/g)].map(m => m[1]),
    figs: [...s.matchAll(/<span class="hit-fig">([\s\S]*?)<\/span>/g)].map(m => m[1]),
    text: g(s, /<div class="anno-text">([\s\S]*?)<\/div>/), none: g(s, /<div class="anno-text none">([^<]*)<\/div>/), stem: g(s, /<div class="anno-stem">([\s\S]*?)<\/div>/),
  };
});
const one = (p, r) => rowsOf(run(() => A.rowHtml(p, r)))[0] || {};
const tagOf = (html, id) => (html.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')) || [''])[0];
const countIn = html => g(html, /id="annoCount" role="status">([^<]*)<\/div>/);
const buttonIn = html => g(html, /<button[^>]*\bid="annoPractise"[^>]*>([\s\S]*?)<\/button>/);
const listIn = html => g(html, /<div class="hits" id="annoList">([\s\S]*)<\/div>\s*<\/div>\s*$/);
const times = (html, text) => html.split(text).length - 1;

const NOTHING = 'Nothing is written on any question yet.';
const HOW = '<span>Open a question, choose the pencil, then the sticky note: what you write is kept here.</span>';
const TRY = '<span>Try fewer or shorter words. It looks in the note, the chapter and the question.</span>';

head('a row');
{
  const p = pageOf('w:sign', []);
  const r = one(p, row('q7'));
  ok('a row carries the question\'s id as data, through e()', r.id === 'E(q7)', r.id);
  ok('its edge is the chapter\'s colour, and its chip is that colour at a tint, in the ink chInk() makes of it', r.edge === '#112233' && r.tint === '#1122331F' && r.ink === 'INK(#112233)', [r.edge, r.tint, r.ink].join(' · '));
  ok('the chip names the chapter, through e(), and the question\'s number', r.chip === 'E(Rhythm) · 12', r.chip);
  const plain = one(p, row('q8', {}, { ch: 'A chapter of the bank\'s own' }));
  ok('a chapter with no colour of its own takes the teal for its edge, and chInk() is asked about the teal', plain.edge === 'var(--teal)' && plain.ink === 'INK(var(--teal))', plain.edge + ' · ' + plain.ink);

  const flagsFor = (flagged, missed) => J(one(pageOf('', [], { S: { flagged: new Set(flagged), missed: new Set(missed) } }), row('q7')).flags);
  ok('"flagged" is said of a flagged question and "previously missed" of a missed one, each on its own, both together, and neither of another question',
     flagsFor(['q7'], []) === J(['flagged']) && flagsFor([], ['q7']) === J(['previously missed']) && flagsFor(['q7'], ['q7']) === J(['flagged', 'previously missed']) && flagsFor(['q1'], ['q2']) === J([]),
     [flagsFor(['q7'], []), flagsFor([], ['q7']), flagsFor(['q7'], ['q7']), flagsFor(['q1'], ['q2'])].join(' '));
  const figs = over => J(one(p, row('q7', over)).figs);
  ok('one note is "note", three are "3 notes", and both carry the sticky note', figs({ notes: 1 }) === J(['[icon sticky-note icon-sm] note']) && figs({ notes: 3 }) === J(['[icon sticky-note icon-sm] 3 notes']), figs({ notes: 1 }) + ' ' + figs({ notes: 3 }));
  ok('pencil is said of a question with ink, after its notes, and of ink alone', figs({ notes: 2, ink: true }) === J(['[icon sticky-note icon-sm] 2 notes', '[icon pencil icon-sm] pencil']) && figs({ notes: 0, text: '', ink: true }) === J(['[icon pencil icon-sm] pencil']),
     figs({ notes: 2, ink: true }) + ' ' + figs({ notes: 0, text: '', ink: true }));

  ok('what the notes say is cut at 320 and handed to FlagSet.highlight() with what is typed and the page\'s e()', r.text === 'H(CLIP(what the notes say,320)|w:sign|E(esc))' && r.none === undefined, r.text);
  ok('the start of the question is cut at 150 and handed over the same way', r.stem === 'H(CLIP(the stem,150)|w:sign|E(esc))', r.stem);
  const blank = one(p, row('q7', { notes: 2, text: '' })), inked = one(p, row('q7', { notes: 0, text: '', ink: true }));
  ok('notes with no words say "An empty sticky note", and ink with no note "Pencil marks, no words"', blank.none === 'An empty sticky note' && blank.text === undefined && inked.none === 'Pencil marks, no words' && inked.text === undefined, blank.none + ' · ' + inked.none);

  /* Helpers that answer with one fixed word, and a clip that hands back what it was given: whatever of the
     row is in the markup then got there without them. */
  const mute = { e: () => 'SAFE', clip: s => s, chInk: () => 'INK', FlagSet: { words: () => ['w'], highlight: () => 'MARKED' } };
  const hostile = row('HOSTILE-id', { text: 'HOSTILE-text' }, { ch: 'HOSTILE-ch', s: 'HOSTILE-stem' });
  const drawn = run(() => A.screenHtml(pageOf('HOSTILE-typed', [hostile], mute), [hostile])) + run(() => A.listHtml(pageOf('HOSTILE-typed', [hostile], mute), []));
  ok('an id, a chapter, a note, a stem and what is typed reach the page only through e() or highlight()', !drawn.includes('THREW') && rowsOf(drawn).length === 1 && times(drawn, 'HOSTILE') === 0 && times(drawn, 'SAFE') >= 4 && times(drawn, 'MARKED') === 2,
     (drawn.match(/HOSTILE-\w+/g) || ['none']).join(' '));
}

head('the list');
{
  const rows = [row('q3'), row('q1', { notes: 0, text: '', ink: true }), row('q2', {}, { ch: 'Other', n: 4 })];
  const p = pageOf('', rows);
  const html = run(() => A.listHtml(p, rows));
  ok('a row for each, in the order given', J(rowsOf(html).map(r => r.id)) === J(['E(q3)', 'E(q1)', 'E(q2)']), J(rowsOf(html).map(r => r.id)));
  ok('and the list is those rows and nothing between them', !html.startsWith('THREW') && html === rows.map(r => A.rowHtml(p, r)).join(''));
  const miss = run(() => A.listHtml(pageOf('zzz', rows), []));
  ok('with no row to show and questions annotated, it says nothing matched what was typed, through e(), and what to try',
     miss === '<div class="sb-none">Nothing matched <b>E(zzz)</b>.<br>' + TRY + '</div>', miss);
  const bare = run(() => A.listHtml(pageOf('zzz', []), []));
  ok('with nothing annotated at all, it says so and how to write a note, whatever is typed', bare === '<div class="sb-none">' + NOTHING + '<br>' + HOW + '</div>', bare);
}

head('the count');
{
  const say = (q, all, shown) => run(() => A.countText(pageOf(q, []), all, shown));
  ok('with nothing annotated it says so, typed or not', say('', 0, 0) === NOTHING && say('w:sign', 0, 0) === NOTHING, say('', 0, 0) + ' · ' + say('w:sign', 0, 0));
  ok('with nothing typed it counts the questions: "1 question", "5 questions"',
     say('', 1, 1) === '1 question with a sticky note or pencil marks' && say('', 5, 5) === '5 questions with a sticky note or pencil marks', say('', 1, 1) + ' · ' + say('', 5, 5));
  ok('with words typed it says how many of them match: shown, then all', say('w:sign', 5, 2) === '2 of 5 match' && say('w:sign', 1, 1) === '1 of 1 match', say('w:sign', 5, 2) + ' · ' + say('w:sign', 1, 1));
  ok('what counts as words is FlagSet\'s to say: text it finds no word in is nothing typed', say('sign', 5, 5) === '5 questions with a sticky note or pencil marks' && say('   ', 5, 5) === '5 questions with a sticky note or pencil marks',
     say('sign', 5, 5) + ' · ' + say('   ', 5, 5));
}

head('the Practise button\'s words');
{
  const says = n => run(() => A.practiseHtml(pageOf('', []), n));
  ok('it says how many, then the arrow', says(3) === 'Practise these 3 [icon arrow-right icon-sm]' && says(0) === 'Practise these 0 [icon arrow-right icon-sm]', says(3) + ' · ' + says(0));
}

head('the screen');
{
  const all = [row('q1'), row('q2'), row('q3')], shown = all.slice(0, 2);
  const p = pageOf('w:sign', all);
  const scr = run(() => A.screenHtml(p, shown)), none = run(() => A.screenHtml(p, []));
  const box = tagOf(scr, 'annoQ');
  ok('the box is a search field with a name for a screen reader, and holds what is typed, through e()',
     box.startsWith('<input ') && box.includes(' type="search"') && box.includes(' aria-label="Search your annotations"') && box.includes(' placeholder="Find a note by what it says…"') && box.includes(' value="E(w:sign)"'), box);
  ok('it names the annoInput action, which the page calls as a key goes down, and offers no correction of what is typed',
     box.includes(' data-action="annoInput"') && box.includes(' autocomplete="off"') && box.includes(' autocapitalize="off"') && box.includes(' spellcheck="false"'), box);
  ok('the bar carries the pencil', times(scr, '<span class="sb-icon">[icon pencil]</span>') === 1);
  const btn = tagOf(scr, 'annoPractise');
  ok('the Practise button names practiceAnnotated and says how many rows are shown', btn.includes(' data-action="practiceAnnotated"') && btn.includes(' type="button"') && buttonIn(scr) === A.practiseHtml(p, 2) && buttonIn(none) === A.practiseHtml(p, 0),
     btn + ' ' + buttonIn(scr));
  ok('it is disabled with no row to show, and not with some', / disabled>$/.test(tagOf(none, 'annoPractise')) && !/disabled/.test(btn), tagOf(none, 'annoPractise') + ' | ' + btn);
  ok('"Chapters" goes back, by the goStudy action', times(scr, '<button class="btn sb-back" type="button" data-action="goStudy">[icon arrow-left icon-sm] Chapters</button>') === 1);
  ok('the line above the list is a status, and holds the count of every annotated question and of those shown, through e()',
     tagOf(scr, 'annoCount').includes(' role="status"') && countIn(scr) === 'E(' + A.countText(p, 3, 2) + ')' && countIn(scr) === 'E(2 of 3 match)', countIn(scr));
  ok('the list holds the rows shown, as listHtml() draws them', listIn(scr) === A.listHtml(p, shown) && rowsOf(scr).length === 2 && listIn(none) === A.listHtml(p, []), String(listIn(scr)).slice(0, 80));
  ok('the box and the three places the page repaints are each in the markup once, by id',
     ['annoQ', 'annoPractise', 'annoCount', 'annoList'].every(id => times(scr, ' id="' + id + '"') === 1), ['annoQ', 'annoPractise', 'annoCount', 'annoList'].map(id => id + ':' + times(scr, ' id="' + id + '"')).join(' '));
}

head('it reads what it is given, and changes nothing');
const READS = new Set(), STATE = new Set();
{
  const seen = { page: READS, anno: new Set(), state: STATE, row: new Set(), question: new Set() }, wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const rows = () => [row('q1', { ink: true }), row('q2', { notes: 0, text: '', ink: true })];
  const spied = rows().map(r => watched(Object.assign(r, { q: watched(r.q, seen.question, 'question') }), seen.row, 'row'));
  const base = pageOf('w:sign', spied);
  const p = watched(Object.assign({}, base, { ANNO: watched(base.ANNO, seen.anno, 'ANNO'), S: watched(base.S, seen.state, 'S') }), seen.page, 'page');
  /* Every way in: the screen with rows and with none, and each piece asked for alone, as typing asks. */
  const out = [() => A.screenHtml(p, spied), () => A.screenHtml(p, []), () => A.listHtml(p, spied), () => A.rowHtml(p, spied[0]), () => A.countText(p, 2, 1), () => A.practiseHtml(p, 1)].map(run);
  const names = s => [...s].sort().join(' ');
  ok('of the page it asks for eight names and nothing else', !out.some(o => o.startsWith('THREW')) && names(seen.page) === 'ANNO CH_COLORS FlagSet S chInk clip e icon', names(seen.page));
  ok('of ANNO it reads what is typed and the rows; of the page\'s state, the flagged and the missed', names(seen.anno) === 'q rows' && names(seen.state) === 'flagged missed', names(seen.anno) + ' · ' + names(seen.state));
  ok('of a row it reads id, ink, notes, q and text, and of its question ch, n and s', names(seen.row) === 'id ink notes q text' && names(seen.question) === 'ch n s', names(seen.row) + ' · ' + names(seen.question));
  ok('it sets, deletes and defines nothing on any of them', !out.some(o => o.startsWith('THREW')) && wrote.length === 0, wrote.join(', ') || 'nothing');
  /* Frozen all the way down: in a strict module a write throws, and run() then says THREW. */
  const ice = rows().map(r => Object.freeze(Object.assign(r, { q: Object.freeze(r.q) })));
  const cold = Object.freeze(Object.assign(pageOf('w:sign', null), { ANNO: Object.freeze({ q: 'w:sign', rows: Object.freeze(ice) }), S: Object.freeze({ flagged: new Set(['q1']), missed: new Set() }), CH_COLORS: Object.freeze({ Rhythm: '#112233' }) }));
  const warm = pageOf('w:sign', rows(), { S: { flagged: new Set(['q1']), missed: new Set() } });
  const frozen = run(() => A.screenHtml(cold, Object.freeze(ice.slice()))), loose = run(() => A.screenHtml(warm, warm.ANNO.rows));
  ok('given the page, its state, the rows and the questions frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && rowsOf(frozen).length === 2, frozen.slice(0, 80));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  /* Read with its comments blanked: the page explains itself, and quotes what is looked for. Positions are
     kept, so code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/annotations.js]@@';
  const LINES = [
    'function annoCountText(all,shown){ return AnnotationsScreen.countText(annoPage(),all,shown); }',
    'function annoListHtml(rows){ return AnnotationsScreen.listHtml(annoPage(),rows); }',
    'const annoPractiseHtml=n=>AnnotationsScreen.practiseHtml(annoPage(),n);',
    'function buildAnnotations(){\n  ANNO.rows=FlagSet.annotated(NOTES,INK,QBYID);\n  return AnnotationsScreen.screenHtml(annoPage(),annoShown());\n}',
  ];
  const slot = page.indexOf(SLOT);
  ok('the module is written into the page once, above the lines that call it', count(SLOT) === 1 && LINES.every(l => page.indexOf(l) > slot), `${count(SLOT)} slot(s), at ${slot}`);
  ok('the count, the list and the button\'s words are each one call into it, and the screen is the rows made and then one call',
     LINES.every(l => count(l) === 1) && ['function annoCountText(', 'function annoListHtml(', 'const annoPractiseHtml=', 'function buildAnnotations('].every(d => count(d) === 1), LINES.map(l => count(l)).join(' '));
  ok('the rows shown are still FlagSet.find() of every row and what is typed', count('const annoShown=()=>FlagSet.find(ANNO.rows,ANNO.q);') === 1 && count('annoShown=') === 1);
  /* Asked for each time, so the module sees the state as it is then. Seven of the eight go by name alone, so
     each is the page's own thing under the name the module knows it by; of the page's state, two sets go. */
  const handed = String(g(page, /const annoPage=\(\)=>\(\{(.*)\}\);/));
  const ofState = String(g(handed, /(?:^|,)S:\{([^}]*)\}/)), names = handed.replace(/(^|,)S:\{[^}]*\}/, '$1S');
  ok('annoPage() hands over, each time it is asked, the eight names the module was seen to read, seven of them the page\'s own as they are',
     count('const annoPage=') === 1 && READS.size === 8 && names.split(',').sort().join(' ') === [...READS].sort().join(' '), handed);
  ok('and of the page\'s state, the two sets the module was seen to read, each under its own name, and no more',
     STATE.size === 2 && ofState.split(',').sort().join(' ') === [...STATE].sort().map(k => k + ':S.' + k).join(' '), ofState);
  /* "Nothing matched" is the search screen's too, so this screen's own line is known by what follows it. */
  const WORDS = ['Find a note by what it says', 'Pencil marks, no words', 'An empty sticky note', 'It looks in the note, the chapter and the question', 'with a sticky note or pencil marks', NOTHING, 'Practise these', 'function annoRowHtml('];
  ok('and the screen\'s own words, and the row\'s function, are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));

  const p = pageOf('', [row('q1')]);
  const scr = run(() => A.screenHtml(p, p.ANNO.rows));
  /* docs/ROADMAP.md, E2. Attribute names, read tag by tag with each value consumed whole, so text inside a value is never
     taken for a name. */
  const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
  const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
  const handlers = [...new Set([...scr.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]))].sort();
  ok('its markup names three actions and carries no inline handler', J(handlers) === J(['annoInput', 'goStudy', 'practiceAnnotated']) && inlineOf(scr).length === 0 && inlineOf(run(() => A.screenHtml(pageOf('', []), []))).length === 0, handlers.join(' ') + ' · ' + (inlineOf(scr).join(' ') || 'no on* attribute'));
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const clicks = tableOf('ACTIONS'), inputs = tableOf('INPUT_ACTIONS');
  ok('the two buttons are in the page\'s ACTIONS table and the box in its INPUT_ACTIONS, each once and in no other, over the page\'s function of that name, declared once',
     clicks.split('practiceAnnotated:()=>practiceAnnotated(),').length === 2 && clicks.split('goStudy:()=>goStudy(),').length === 2 && !/annoInput/.test(clicks)
     && inputs.split('annoInput:el=>annoInput(el.value),').length === 2 && !/practiceAnnotated|goStudy/.test(inputs) && handlers.every(n => count('function ' + n + '(') === 1),
     handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  ok('and the page listens for taps over the one and for typing over the other, on the document', count('Actions.install(document,ACTIONS);') === 1 && count("Actions.install(document,INPUT_ACTIONS,'input');") === 1);

  /* A tap and a key, as the page takes them: the real src/core/actions.js listening on a stand-in document for clicks
     over the page's ACTIONS and for input over its INPUT_ACTIONS, over stand-ins for the three functions, and each
     control the module drew, with the attributes it drew, as the element. The box holds what was typed. */
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const stubs = ['goHome', 'memForget', 'memForgetAll', 'setLab', 'startQuiz', 'askApexMisses', 'practiceAnnotated', 'goStudy', 'annoInput'].map(n => `function ${n}(){ tcalls.push(${JSON.stringify(n)} + (arguments.length ? " " + JSON.stringify([].slice.call(arguments)) : "")); }`).join('\n');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'actions.js'), 'utf8') + '\nvar S={chapter:null};\n' + stubs + '\n'
    + ['ACTIONS', 'INPUT_ACTIONS'].map(n => (page.match(new RegExp('const ' + n + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + n + '={};'])[0].replace(/^const /, 'var ')).join('\n')
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);\nActions.install(doc,INPUT_ACTIONS,"input");', tctx);
  const controls = [...scr.matchAll(/<(button|input)\b([^>]*)>/g)].map(m => Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]))).filter(at => 'data-action' in at);
  const fire = (type, at) => { const el = { nodeType: 1, value: 'sotalol', getAttribute: k => (k in at ? at[k] : null), dataset: {}, closest: sel => (sel === '[data-action]' ? el : null) };
    tctx.listeners.filter(l => l[0] === type).forEach(l => l[1]({ type, target: el })); };
  tcalls.length = 0; controls.forEach(at => fire('click', at));
  const tappedNow = tcalls.slice();
  tcalls.length = 0; controls.forEach(at => fire('input', at));
  const typedNow = tcalls.slice();
  ok('through the real Actions and the page\'s tables: a tap on each button calls its function and a tap on the box nothing; typing in the box calls annoInput() with what it holds, and in a button nothing',
     controls.length === 3 && J(tappedNow) === J(['practiceAnnotated', 'goStudy']) && J(typedNow) === J(['annoInput ["sotalol"]']), J(tappedNow) + ' · ' + J(typedNow));

  /* The page's own stretch, from the screen's state to the listener that follows a tap, taken whole, with
     this module where its slot stands, the real FlagSet, and the page's own helpers. What is not the
     screen's is a recorder: the elements typing writes into, and the functions that leave the screen. */
  const whole = (from, to, after) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, after ? page.indexOf(after, a) : a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const helpers = [whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function clip(s,n){', '\n'), whole('function chInk(hex){', '\n}')].join('\n');
  const stretch = whole('const ANNO={q:\'\',rows:[]};', '\n});', 'document.addEventListener(\'click\'');
  const lookedUp = [...new Set([...whole('function annoInput(v){', '\n}').matchAll(/getElementById\('([^']*)'\)/g)].map(m => m[1]))].sort();
  ok('as a key goes down the page looks up three elements, by the ids the markup gives them', J(lookedUp) === J(['annoCount', 'annoList', 'annoPractise']) && lookedUp.every(id => times(scr, ' id="' + id + '"') === 1), lookedUp.join(' '));

  const writes = [], calls = [], listeners = [], there = { annoList: true, annoCount: true, annoPractise: true };
  const el = name => { const o = {}; for (const k of ['innerHTML', 'textContent', 'disabled']) Object.defineProperty(o, k, { set(v) { writes.push([name, k, v]); } }); return o; };
  const ctx = {
    NOTES: {}, INK: {}, CH_COLORS: { Rhythm: '#6366F1' }, S: { screen: 'home', flagged: new Set(['a1']), missed: new Set(['c3']) }, themeIsDark: () => false,
    QBYID: { a1: { id: 'a1', ch: 'Rhythm', n: 3, s: 'Flutter after ablation: the next step?' }, b2: { id: 'b2', ch: 'Valves', n: 9, s: 'A murmur & a "click"' }, c3: { id: 'c3', ch: 'Rhythm', n: 1, s: 'Nothing typed is found here' } },
    document: { getElementById: id => (there[id] ? el(id) : null), addEventListener: (type, fn) => listeners.push([type, fn]) },
    render: () => calls.push('render'), toTop: () => calls.push('toTop'), shuf: a => a.slice(), jumpTo: id => calls.push(['jumpTo', id]),
    startAdhocQuiz: (qs, x) => calls.push(['quiz', qs.map(q => q.id), x]), toast: m => calls.push(['toast', m]),
  };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(helpers + '\n' + read('src/core/flagset.js') + '\n' + stretch.replace(SLOT, () => read('src/app/annotations.js')) + '\n"loaded"');
  const draw = () => String(ask('buildAnnotations()'));

  const empty = draw();
  ok('with nothing written, the page\'s own lines draw the empty screen: the count and the list both say so, and Practise is disabled',
     loaded === 'loaded' && countIn(empty) === NOTHING && String(listIn(empty)).includes(NOTHING) && rowsOf(empty).length === 0 && / disabled>$/.test(tagOf(empty, 'annoPractise')), String(loaded).slice(0, 90) + ' · ' + countIn(empty));

  /* n9 is a later note than n1, and c3 has ink and no note: FlagSet puts the newest note first. */
  ctx.NOTES = { a1: [{ id: 'n1', text: 'Kussmaul <b>sign</b> & pulsus' }], b2: [{ id: 'n9', text: 'remember sotalol' }] };
  ctx.INK = { 'c3:q': [[1, 2]] };
  const full = draw(), drawn = rowsOf(full);
  ok('with two notes and a pencil mark, a row each, the newest note first, and ANNO.rows is every one of them',
     J(drawn.map(r => r.id)) === J(['b2', 'a1', 'c3']) && J(ask('ANNO.rows.map(r=>r.id)')) === J(['b2', 'a1', 'c3']) && countIn(full) === '3 questions with a sticky note or pencil marks', J(drawn.map(r => r.id)) + ' · ' + countIn(full));
  const a1 = drawn[1] || {}, b2 = drawn[0] || {}, c3 = drawn[2] || {};
  ok('a note\'s words are escaped by the page\'s e(), and a row says what its question carries',
     a1.text === 'Kussmaul &lt;b&gt;sign&lt;/b&gt; &amp; pulsus' && J(a1.flags) === J(['flagged']) && J(c3.flags) === J(['previously missed']) && c3.none === 'Pencil marks, no words' && b2.stem === 'A murmur &amp; a &quot;click&quot;',
     a1.text + ' · ' + J(a1.flags) + J(c3.flags) + ' · ' + c3.none + ' · ' + b2.stem);
  const inkOf = String(ask('chInk("#6366F1")'));
  ok('the chip\'s ink is the page\'s chInk() of the chapter\'s colour, and of the teal for a chapter with none',
     /^#[0-9a-f]{6}$/.test(inkOf) && inkOf !== '#6366f1' && a1.ink === inkOf && a1.edge === '#6366F1' && b2.edge === 'var(--teal)' && b2.ink === String(ask('chInk("var(--teal)")')) && b2.ink === 'var(--teal-ink)', a1.ink + ' · ' + b2.ink);

  writes.length = 0; ask('annoInput("SIGN")');
  const typed = writes.slice(), after = draw(), shown = rowsOf(after);
  ok('typing a word keeps it, finds the rows that hold it in any case, and marks it where it stands',
     ask('ANNO.q') === 'SIGN' && J(shown.map(r => r.id)) === J(['a1']) && (shown[0] || {}).text === 'Kussmaul &lt;b&gt;<mark>sign</mark>&lt;/b&gt; &amp; pulsus', J(shown.map(r => r.id)) + ' · ' + (shown[0] || {}).text);
  ok('and it repaints the list, the count and the button, with what the screen itself draws for those words',
     J(typed.map(w => w[0] + '.' + w[1])) === J(['annoList.innerHTML', 'annoCount.textContent', 'annoPractise.disabled', 'annoPractise.innerHTML'])
     && typed[0][2] === listIn(after) && typed[1][2] === '1 of 3 match' && typed[1][2] === countIn(after) && typed[2][2] === false && !/disabled/.test(tagOf(after, 'annoPractise')) && typed[3][2] === buttonIn(after) && /^Practise these 1 <svg/.test(String(typed[3][2])),
     J(typed.map(w => w[0] + '.' + w[1])) + ' · ' + (typed[1] || [])[2]);

  writes.length = 0; ask('annoInput(\'zzzz "q"\')');
  ok('words that nothing holds: the list says nothing matched them, escaped, the count is "0 of 3", and Practise is disabled',
     writes.length === 4 && writes[0][2] === '<div class="sb-none">Nothing matched <b>zzzz &quot;q&quot;</b>.<br>' + TRY + '</div>' && writes[1][2] === '0 of 3 match' && writes[2][2] === true && /^Practise these 0 /.test(String(writes[3][2])), J(writes.map(w => w[2])).slice(0, 200));
  writes.length = 0; ask('annoInput(null)');
  ok('an empty box is every row again', ask('ANNO.q') === '' && writes.length === 4 && rowsOf(String(writes[0][2])).length === 3 && writes[1][2] === '3 questions with a sticky note or pencil marks' && writes[2][2] === false, ask('ANNO.q') + ' · ' + (writes[1] || [])[2]);
  there.annoList = false; writes.length = 0; ask('annoInput("sotalol")'); there.annoList = true;
  ok('typed where the list is not on the page, the words are kept and nothing is written', ask('ANNO.q') === 'sotalol' && writes.length === 0, ask('ANNO.q') + ' · ' + writes.length + ' write(s)');

  calls.length = 0; ask('practiceAnnotated()');
  const quiz = J(calls);
  ask('annoInput("zzzz")'); calls.length = 0; ask('practiceAnnotated()');
  ok('Practise starts a quiz of the questions shown and says how many; with none shown it starts nothing',
     quiz === J([['quiz', ['b2'], null], ['toast', 'Quiz built from your annotations — 1 question.']]) && calls.length === 0, quiz + ' · then ' + J(calls));
  calls.length = 0; ask('goAnnotations()');
  ok('coming to the screen clears what was typed, and draws', ask('ANNO.q') === '' && ctx.S.screen === 'annotations' && J(calls) === J(['render', 'toTop']), J([ask('ANNO.q'), ctx.S.screen, calls]));

  /* The row is the module's and the listener the page's: they meet at one attribute. */
  const asked = [], tap = hit => ({ target: { closest: sel => { asked.push(sel); return hit ? { getAttribute: name => { asked.push(name); return 'a1'; } } : null; } } });
  calls.length = 0;
  if (listeners.length === 1 && listeners[0][0] === 'click') { try { listeners[0][1](tap(true)); listeners[0][1](tap(false)); } catch (err) { calls.push('THREW ' + err.message); } }
  ok('a tap on a row: the page\'s one listener asks for the nearest element with the attribute the row carries, and jumps to the question it holds; a tap elsewhere goes nowhere',
     listeners.length === 1 && J(asked) === J(['[data-anno]', 'data-anno', '[data-anno]']) && J(calls) === J([['jumpTo', 'a1']]) && rowsOf(full).every(r => r.id !== undefined), J(asked) + ' · ' + J(calls));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
