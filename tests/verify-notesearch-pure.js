#!/usr/bin/env node
/*
 * Search your notes, without a browser: the ranking, the quoting, the markup,
 * and the four anchors notesearch-patch relies on.
 *
 *   node tests/verify-notesearch-pure.js
 *
 * No browser, no build, no licensed export. tests/verify-notesearch.js drives
 * the patched screen in a browser; this holds everything that decides
 * something, which is all of src/core/notesearch.js.
 *
 * THE RANKING CHECK IS THE REASON THIS EXISTS. On the device, the app's own
 * search() ranked "Drug choice for AF by heart substrate" above "Sotalol:
 * reverse use dependence…" for the query "sotalol" (tools/search-probe.js).
 * NoteSearch.results moves notes whose section title holds every word typed
 * to the front. That claim is asserted here against that exact pair, in that
 * exact order, with the rest of the order left as search() gave it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = read('src/core/notesearch.js');
const win = {};
new Function('window', SRC)(win);
const N = win.NoteSearch;

/* The app's escaper, as refs and md() rely on it: all five characters. */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const NOTES = [
  { id: 'n1', title: 'Arrhythmias · Therapy — Drug choice for AF by heart substrate',
    body: 'Without structural disease use flecainide or propafenone; with CAD use sotalol or dofetilide; sotalol needs renal dosing. Sotalol again.' },
  { id: 'n2', title: 'Arrhythmias · Therapy — Sotalol: reverse use dependence, renal dosing and in-hospital initiation',
    body: '**Sotalol** shows reverse use dependence.\n\n![Fig. 46.2 — shock](refimg://arrhythmias/page_117.jpg)\n\nStart in hospital.' },
  { id: 'n3', title: 'Heart failure — Devices', body: 'An ICD is indicated after MI with EF 30% or less.' },
];
/* search() as the app returns it: questions and notes mixed, best first. */
const fakeSearch = order => () => order.map(x => x[0] === 'q' ? { meta: { kind: 'q', id: x } } : { meta: { kind: 'r', id: x } });

head('the module loads and says what it offers');
ok('NoteSearch is defined', !!N && typeof N.results === 'function', N ? Object.keys(N).join(', ') : 'undefined');

head('results: which notes, in what order');
{
  const probeOrder = fakeSearch(['q1', 'n1', 'q2', 'n2', 'n3']);
  const r = N.results('sotalol', NOTES, probeOrder).map(n => n.id);
  ok('the note titled with the word comes first, as the device needed', r[0] === 'n2', r.join(', '));
  ok('and the rest keep search()\'s order behind it', r.join(',') === 'n2,n1,n3', r.join(', '));
  ok('questions are never returned as notes', r.every(id => !/^q/.test(id)));
  const two = N.results('renal dosing', NOTES, probeOrder).map(n => n.id);
  ok('every word must be in the title to move a note forward', two[0] === 'n2' && two.length === 3, two.join(', '));
  ok('a note gone from the shelf since the index was built is skipped',
     N.results('sotalol', NOTES.slice(1), probeOrder).map(n => n.id).join(',') === 'n2,n3');
  ok('duplicate hits are shown once',
     N.results('x1', NOTES, fakeSearch(['n1', 'n1', 'n3'])).map(n => n.id).join(',') === 'n1,n3');
  ok('one character searches nothing', N.results('s', NOTES, probeOrder).length === 0);
  ok('a search() that throws gives no results rather than a broken screen',
     N.results('sotalol', NOTES, () => { throw new Error('index gone'); }).length === 0);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, title: 'T — t' + i, body: 'b' }));
  ok('the list stops at MAX_RESULTS', N.results('zz', many, () => many.map(n => ({ meta: { kind: 'r', id: n.id } }))).length === N.MAX_RESULTS);
}

head('snippet: the words around the match, not markup');
{
  const s = N.snippet(NOTES[1].body, 'hospital');
  ok('markup and figures are gone from the quote', !/\*\*|!\[|refimg/.test(s), s);
  ok('and the matched word is in it', /hospital/i.test(s));
  const long = 'alpha '.repeat(80) + 'dofetilide needs QT monitoring ' + 'omega '.repeat(80);
  const t = N.snippet(long, 'dofetilide');
  ok('a match deep in a long note is quoted with ellipses either side',
     /^…/.test(t) && /…$/.test(t) && /dofetilide/.test(t), t.slice(0, 40) + '…');
  ok('with no word in the body, the note\'s opening is quoted', N.snippet('Opening line. Rest.', 'zzz').startsWith('Opening'));
}

head('highlight: escaped first, marked once');
{
  const h = N.highlight('<b>x</b> sotalol & Sotalol', 'sotalol', esc);
  ok('the text is escaped, so a note cannot inject markup', !/<b>/.test(h) && /&lt;b&gt;/.test(h), h);
  ok('matches are marked case-insensitively', (h.match(/<mark>/g) || []).length === 2);
  const q = N.highlight('Tom & Jerry', 'amp jerry', esc);
  ok('a query of "amp" leaves &amp; whole', /&amp;/.test(q) && !/&<mark>/.test(q), q);
  const m = N.highlight('a remark on marks', 'mark remark', esc);
  ok('no word is marked inside a <mark> another word inserted', !/<<mark>|<mark>[^<]*<mark>/.test(m) && (m.match(/<mark>/g) || []).length === 2, m);
  /* The markup is in the text as well as the query: with plain text there is nothing for the query to match,
     highlight() returns the text unchanged, and the check could not fail whatever highlight() did. */
  const x = N.highlight('a note quoting "><img src=x onerror=alert(1)> as text', '"><img src=x onerror=alert(1)>', esc);
  ok('a hostile query adds no tag but <mark>', (x.match(/<mark>/g) || []).length >= 3 && !/</.test(x.replace(/<\/?mark>/g, '')), x);
}

head('the markup the screen shows');
{
  const hint = N.resultsHtml('', [], 530, esc);
  ok('an empty field says how many notes there are to search', /530 notes/.test(hint), hint.slice(0, 120));
  const none = N.resultsHtml('zzzz', [], 530, esc);
  ok('no match says so, naming the query', /No note matched <b>zzzz<\/b>/.test(none));
  const list = N.resultsHtml('sotalol', [NOTES[1], NOTES[0]], 530, esc);
  ok('hits are buttons carrying their note id', (list.match(/data-ns-open="n[12]"/g) || []).length === 2);
  ok('with the chapter shown apart from the section', /class="ns-chapter">Arrhythmias · Therapy</.test(list));
  ok('and a count', /2 notes/.test(list));
  const hostile = N.resultsHtml('sotalol', [{ id: '"><script>', title: 'T — t', body: 'x' }], 1, esc);
  ok('an id is escaped into its attribute', /data-ns-open="&quot;&gt;&lt;script&gt;"/.test(hostile) && !/<script/i.test(hostile),
     (hostile.match(/data-ns-open="[^"]*"/) || ['no data-ns-open'])[0]);
  let mdSeen = '';
  const note = N.noteHtml(NOTES[1], esc, b => { mdSeen = b; return '<figure>rendered</figure>'; }, () => '<svg></svg>');
  ok('an opened note\'s body goes through md(), so its figures render', mdSeen === NOTES[1].body && /<figure>rendered<\/figure>/.test(note));
  ok('inside .ref-body, so it takes the Notes screen\'s figure styling', /<div class="ref-body"><figure>/.test(note));
  ok('with a way back to the results', /data-ns-back/.test(note));
  const scr = N.screenHtml({ q: '"><b>', open: null }, NOTES, fakeSearch([]), esc, x => x, () => '');
  ok('the query is escaped into the field\'s value', /value="&quot;&gt;&lt;b&gt;"/.test(scr), (scr.match(/value="[^"]*"/) || [''])[0]);
  ok('the field turns off autocorrect, which rewrites drug names on an iPad',
     /autocorrect="off"/.test(scr) && /spellcheck="false"/.test(scr));
  const opened = N.screenHtml({ q: 'sotalol', open: 'n2' }, NOTES, fakeSearch([]), esc, x => x, () => '');
  ok('an open note replaces the list', /ns-note-title">Sotalol/.test(opened) && !/data-ns-q/.test(opened));
  const missing = N.screenHtml({ q: 'sotalol', open: 'gone' }, NOTES, fakeSearch([]), esc, x => x, () => '');
  ok('an open id no longer on the shelf falls back to the search', /data-ns-q/.test(missing));
}

head('the four anchors are echo\'s own output, and nothing runs between');
{
  /* notesearch-patch's safety argument, checked: each anchor is text that
     echo-patch emits, and notesearch runs straight after echo, so no step can
     rewrite an anchor before this one reads it. */
  const patchSrc = read('scripts/notesearch-patch.js');
  const echoSrc = read('scripts/echo-patch.js');
  const CALL = /patch\(\s*'([^']*)',\s*`((?:\\.|[^\\`])*)`/g;
  const un = t => t.replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
  const anchors = [...patchSrc.matchAll(CALL)].map(m => ({ label: m[1], find: un(m[2]) }));
  ok('four anchors found in notesearch-patch.js', anchors.length === 4, anchors.map(a => a.label).join(' | '));
  const echoEmits = [...echoSrc.matchAll(/patch\(\s*'[^']*',\s*`(?:\\.|[^\\`])*`\s*,\s*`((?:\\.|[^\\`])*)`\s*\)/g)].map(m => un(m[1])).join('\n');
  for (const a of anchors) {
    ok(`"${a.label}" is text echo-patch emits`, echoEmits.includes(a.find), a.find.split('\n')[0].slice(0, 60));
  }
  const chain = [...(read('scripts/build.js').match(/const CHAIN = \[([\s\S]*?)\];/) || [, ''])[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
  ok('notesearch runs immediately after echo', chain.indexOf('notesearch') === chain.indexOf('echo') + 1 && chain.indexOf('echo') > -1,
     `echo at ${chain.indexOf('echo') + 1}, notesearch at ${chain.indexOf('notesearch') + 1}`);
}

head('Safari 13.4 can parse it');
{
  /* Comments blanked first: they describe what is avoided, in its own syntax. */
  const code = require('./_source.js').blankComments(SRC);
  ok('no optional chaining', !/\?\.[A-Za-z_$(]/.test(code));
  ok('no nullish coalescing', !/\?\?/.test(code));
  ok('no lookbehind', !/\(\?<[=!]/.test(code));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
