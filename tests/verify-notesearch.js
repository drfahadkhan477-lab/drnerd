#!/usr/bin/env node
/*
 * Search your notes, in a browser: does what notesearch-patch INSERTS run?
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-notesearch.js
 *
 * Takes no build, by the method verify-echo uses and for its reason: the glue
 * is not copied into a fixture, where it would go on proving an old version
 * worked. A scaffold carrying echo-patch's four anchors is written, the real
 * scripts/echo-patch.js is run over it, then the real
 * scripts/notesearch-patch.js over that — so notesearch reads the text echo
 * actually emits, exactly as it does as step 88 — and the result is driven.
 *
 * WHAT THE SCAFFOLD SUPPLIES. What the export and earlier steps would: an S,
 * a render() with the router chain, icon(), e(), a nav with a theme-wrap, and
 * the three things this screen consumes — REF (the shelf), search() (the
 * index, here a word match over REF, ranked by count, questions mixed in as
 * they are in the real one), and md() (reduced to the one thing asserted: a
 * refimg:// citation becomes a <figure>). They are environment, not subject.
 *
 * WHAT THIS DOES NOT COVER. How the screen LOOKS on the real app, and the
 * real search() ranking — verify-retrieval measures that, and
 * tools/search-probe.js asks the real build what it returns for a word.
 *
 * THE CARET CHECK. The results repaint alone while typing; a render() per key
 * would rebuild the field and lose focus after the first letter. The word is
 * typed one key at a time and must arrive whole in a field that is still the
 * same node.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'notesearch-ui-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

const SCAFFOLD = `<!doctype html>
<html><head><meta charset="utf-8"><title>notesearch fixture</title><style>
.nav{color:#fff;height:var(--navh);display:flex;align-items:center;
  justify-content:space-between}
</style></head><body>
<div id="chrome"></div>
<div id="app"></div>
<script>
var S = { screen: 'home' };
function icon(n){ return '<svg class="icon" data-icon="' + n + '"></svg>'; }
function e(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function md(t){ return e(t).replace(/!\\[([^\\]]*)\\]\\(refimg:\\/\\/([^)]+)\\)/g,
  '<figure class="ref-fig" data-key="$2"><figcaption>$1</figcaption></figure>'); }
var REF = [
  { id: 'n1', title: 'Arrhythmias · Therapy — Drug choice for AF by heart substrate',
    body: 'With CAD use sotalol or dofetilide. Sotalol needs renal dosing. Sotalol is class III.' },
  { id: 'n2', title: 'Arrhythmias · Therapy — Sotalol: reverse use dependence, renal dosing and in-hospital initiation',
    body: 'Sotalol shows reverse use dependence.\\n\\n![Fig. 46.2 — shock](refimg://arrhythmias/page_117.jpg)\\n\\nStart in hospital.' },
  { id: 'n3', title: 'Heart failure — Devices', body: 'An ICD after MI with EF of 30% or less.' }
];
/* A word match ranked by count, with a question hit first, as the real index
   mixes them. Enough to make the ordering claim testable: n1 mentions sotalol
   more often than n2, so this puts n1 first, and the screen must not. */
function search(q){
  var w = String(q).toLowerCase().trim(); if (!w) return [];
  var out = [{ score: 99, meta: { kind: 'q', id: 'Q1' } }];
  REF.forEach(function(n){
    var c = (n.title + ' ' + n.body).toLowerCase().split(w).length - 1;
    if (c) out.push({ score: c, meta: { kind: 'r', id: n.id } });
  });
  return out.sort(function(a, b){ return b.score - a.score; });
}
function buildMemory(){ return '<p>memory</p>'; }
function buildStudy(){ return '<p>study</p>'; }
function navHtml(){ return \`
  <nav class="nav"><div class="nav-right">
      <div class="theme-wrap">
        <button class="icon-btn" id="themeBtn">\${icon('palette')}</button>
      </div>
  </div></nav>\`; }
function render(){
  document.getElementById('chrome').innerHTML = navHtml();
  document.getElementById('app').innerHTML =
    S.screen==='echo'?buildEchoScreen()
    :S.screen==='memory'?buildMemory():S.screen==='study'?buildStudy()
    :'<p>home</p>';
}
/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */
</script>
<script>render();</script>
</body></html>
`;

const IN = path.join(TMP, 'in.html');
const MID = path.join(TMP, 'echo.html');
const OUT = path.join(TMP, 'out.html');
fs.writeFileSync(IN, SCAFFOLD, 'utf8');
const run = (script, a, b) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), a, b], { encoding: 'utf8' });
const echo = run('echo-patch.js', IN, MID);
const ns = echo.status === 0 ? run('notesearch-patch.js', MID, OUT) : { status: 1, stdout: '', stderr: 'echo-patch did not apply' };
const nsOut = (ns.stdout || '') + (ns.stderr || '');

head('the shipped patches apply, in chain order');
ok('scripts/echo-patch.js exits 0', echo.status === 0, echo.status === 0 ? 'applied' : ((echo.stdout || '') + (echo.stderr || '')).trim().split('\n')[0]);
ok('scripts/notesearch-patch.js exits 0 on echo\'s output', ns.status === 0,
   ns.status === 0 ? 'applied' : nsOut.trim().split('\n').slice(0, 2).join(' / '));
/* Non-vacuity: everything below reads the patched file. */
ok('and reports all four of its edits', (nsOut.match(/✓/g) || []).length === 4, (nsOut.match(/✓/g) || []).length + ' edits');
if (ns.status !== 0) { console.log('\n' + nsOut); console.log(`\n${passed} passed, ${failed} failed`); process.exit(1); }

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [];
  onDeath(() => ({ section, checks: passed + failed, errors, fixture: OUT }));
  page.on('pageerror', x => errors.push(String(x.message).slice(0, 120)));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push('console: ' + m.text().slice(0, 120)); });
  await page.goto('file://' + OUT);
  await page.waitForFunction(() => typeof goNoteSearch === 'function', null, { timeout: 10000 });

  head('a way in');
  const btn = await page.evaluate(() => {
    const b = document.querySelector('.nav [onclick="goNoteSearch()"]');
    return b ? { label: b.getAttribute('aria-label'), icon: (b.querySelector('[data-icon]') || {}).getAttribute
      ? b.querySelector('[data-icon]').getAttribute('data-icon') : null,
      beforeEcho: !!(b.nextElementSibling && /goEcho/.test(b.nextElementSibling.getAttribute('onclick') || '')) } : null;
  });
  ok('the nav has a Search-your-notes button', !!btn && btn.label === 'Search your notes', btn ? btn.label : 'missing');
  ok('with the book glyph, evaluated rather than left as text', !!btn && btn.icon === 'book', btn ? String(btn.icon) : '');
  ok('beside Echo\'s', !!btn && btn.beforeEcho);
  await page.click('.nav [onclick="goNoteSearch()"]');
  const screen = await page.evaluate(() => ({ s: S.screen, field: !!document.querySelector('[data-ns-q]'),
    hint: (document.querySelector('.ns-hint') || {}).textContent || '' }));
  ok('it opens the notes search screen', screen.s === 'notesearch' && screen.field, screen.s);
  ok('which says how many notes it searches', /3 notes/.test(screen.hint), screen.hint);

  head('typing keeps the caret, and finds the note titled with the word');
  await page.evaluate(() => { document.querySelector('[data-ns-q]').dataset.mark = 'nsmark'; });
  await page.focus('[data-ns-q]');
  await page.keyboard.type('sotalol', { delay: 20 });
  const typed = await page.evaluate(() => {
    const f = document.querySelector('[data-ns-q]');
    return { value: f.value, same: f.dataset.mark === 'nsmark', focused: document.activeElement === f,
      titles: [...document.querySelectorAll('.ns-hit .ns-title')].map(x => x.textContent),
      marks: document.querySelectorAll('.ns-hit mark').length, questions: document.querySelectorAll('[data-ns-open="Q1"]').length };
  });
  ok('the whole word arrives, in the same field, still focused',
     typed.value === 'sotalol' && typed.same && typed.focused, `"${typed.value}" same=${typed.same} focused=${typed.focused}`);
  ok('the Sotalol note is first, though another note mentions it more often',
     /^Sotalol: reverse use dependence/.test(typed.titles[0] || ''), typed.titles.join(' | '));
  ok('both notes that mention it are listed, and no question', typed.titles.length === 2 && typed.questions === 0);
  ok('the matched word is marked', typed.marks >= 2, typed.marks + ' marks');

  head('a tap opens the whole note, figures included, and back returns');
  await page.click('.ns-hit');
  const opened = await page.evaluate(() => ({
    title: (document.querySelector('.ns-note-title') || {}).textContent || '',
    fig: !!document.querySelector('.ns-note .ref-body figure[data-key="arrhythmias/page_117.jpg"]'),
    field: !!document.querySelector('[data-ns-q]') }));
  ok('the note opens in place of the list', /^Sotalol/.test(opened.title) && !opened.field, opened.title);
  ok('its figure is rendered through md()', opened.fig);
  await page.click('[data-ns-back]');
  const back = await page.evaluate(() => ({ value: (document.querySelector('[data-ns-q]') || {}).value,
    hits: document.querySelectorAll('.ns-hit').length }));
  ok('back shows the results again, with the query kept', back.value === 'sotalol' && back.hits === 2, `"${back.value}", ${back.hits} hits`);

  head('nothing found is said plainly');
  await page.fill('[data-ns-q]', 'zzqx');
  const none = await page.evaluate(() => (document.querySelector('.ns-hint') || {}).textContent || '');
  ok('a query with no match says so and names it', /No note matched zzqx/.test(none), none);

  ok('no error was raised by any of it', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('\n  the suite itself died: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
