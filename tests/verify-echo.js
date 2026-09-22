#!/usr/bin/env node
/*
 * Echo Studio, in a browser: does what echo-patch INSERTS actually run?
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-echo.js
 *
 * Takes no build. Three suites already cover the thinking — verify-echo-pure
 * (the tables and the arithmetic), verify-echoui-pure (the markup) and
 * verify-echoanchor-pure (the four anchors still exist where the step runs).
 * All three are pure Node, and none of them can answer the question this one
 * asks, because all three stop at the point where strings become a document.
 *
 * ── THE FIXTURE IS PATCHED BY THE REAL SCRIPT, NOT HAND-COPIED ───────────
 *
 * The obvious way to write this is to paste the glue — goEcho, the two
 * document listeners, echoRepaintResults — into a fixture and drive that.
 * That fixture would then be a second copy of the shipped glue, and the first
 * time somebody edited scripts/echo-patch.js this suite would go on proving
 * that the OLD glue worked. This project has had five copies of a comment
 * blanker and two of them had drifted; tests/_source.js exists because of it.
 *
 * So there is no copy. This writes a small scaffold containing the four
 * anchors echo-patch looks for, runs `node scripts/echo-patch.js` over it as
 * a child process, and drives the output. Everything under test — the
 * modules, the glue, the delegated listeners, the nav button, the CSS — is
 * placed by the shipped step. If the patch changes, this tests the change.
 * If the patch stops applying, patch() throws and this suite dies saying so,
 * which is the same failure a real build would give eighty-seven steps in.
 *
 * ── WHAT THE SCAFFOLD SUPPLIES, AND WHY THAT IS NOT CHEATING ─────────────
 *
 * Four things the licensed export and the earlier chain steps would supply:
 * an `S` with a screen on it, a `render()` whose ternary chain the patch
 * extends, an `icon()`, and a nav with a theme-wrap in it. They are the
 * environment, not the subject — each is the smallest thing that makes the
 * anchor real, and none of them is asserted about.
 *
 * ── WHAT THIS DOES NOT COVER, SAID PLAINLY ───────────────────────────────
 *
 * It is NOT the built app. The scaffold has none of the export's markup and
 * none of the theme tokens, so this suite makes no claim about how Echo
 * Studio LOOKS: no layout assertion, no contrast, no measurement of width at
 * a device frame. Those need a real build and belong to verify-layout, which
 * has 'echo' in its SCREENS for exactly that reason. What is held here is
 * behaviour: that the screen routes, that the tabs and the disease list work
 * through a listener nobody re-attaches, that typing does not move the caret,
 * and that a derived row appears only when the inputs it needs are there.
 *
 * THE CARET CHECK IS THE REASON THIS SUITE EXISTS. echo-patch repaints
 * .echo-out alone on every keystroke instead of calling render(), and its
 * header says why: re-rendering the screen rebuilds the input being typed
 * into, so the caret jumps to the end after every digit. That is an argument
 * in a comment, and an argument in a comment is not a check. Typing three
 * characters into one field settles it — if the node is rebuilt after the
 * first, focus is gone and the other two never land.
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-ui-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

/* ── the scaffold ─────────────────────────────────────────────────────────
   Every one of the four anchors appears here exactly once, spelled as
   scripts/echo-patch.js spells it. patch() throws on anything else, so a
   drift between these strings and the step's is a loud failure here rather
   than a quiet one that only a full build would find. */
const SCAFFOLD = `<!doctype html>
<html><head><meta charset="utf-8"><title>echo fixture</title><style>
.nav{color:#fff;height:var(--navh);display:flex;align-items:center;
  justify-content:space-between}
</style></head><body>
<div id="chrome"></div>
<div id="app"></div>
<script>
var S = { screen: 'echo' };
function icon(n){ return '<svg class="icon" data-icon="' + n + '"></svg>'; }
function buildMemory(){ return '<p>memory</p>'; }
function buildStudy(){ return '<p>study</p>'; }

/* The nav lives in a template literal because it does in the app: the button
   echo-patch inserts interpolates \${icon('zap')}, which is markup only if
   something evaluates it. */
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
    :'<p>other</p>';
}
/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */
</script>
<script>render();</script>
</body></html>
`;

const IN = path.join(TMP, 'in.html');
const OUT = path.join(TMP, 'out.html');
fs.writeFileSync(IN, SCAFFOLD, 'utf8');

const applied = spawnSync(process.execPath,
  [path.join(ROOT, 'scripts', 'echo-patch.js'), IN, OUT], { encoding: 'utf8' });
const patchOut = (applied.stdout || '') + (applied.stderr || '');

head('the shipped patch applies to the scaffold');
ok('scripts/echo-patch.js exits 0', applied.status === 0,
   applied.status === 0 ? 'applied' : patchOut.trim().split('\n').slice(0, 3).join(' / '));
/* NON-VACUITY. Everything below is read out of the patched file, so a patch
   that did nothing would leave a page with no Echo on it and every check
   after this would fail for the wrong reason. The edit list makes the cause
   unambiguous instead. */
ok('and reports all four of its edits', (patchOut.match(/✓/g) || []).length === 4,
   (patchOut.match(/✓/g) || []).length + ' edits');

if (applied.status !== 0) {
  console.log('\n' + patchOut);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

/* The panel is repainted by innerHTML, so node identity is the whole question
   in the caret section. A dataset marker survives a repaint that leaves the
   node alone and dies with one that rebuilds it. */
const MARK = 'echomark';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [];
  /* Whatever the page said before this died, printed rather than collected
     and dropped — see tests/_deathnote.js. The patched file is named too:
     this suite's fixture lives in a temp directory that is removed on exit,
     so without it there is nothing left to look at afterwards. */
  onDeath(() => ({ section, checks: passed + failed, errors, fixture: OUT }));
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
  page.on('console', m => {
    if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push('console: ' + m.text().slice(0, 120));
  });
  await page.goto('file://' + OUT);

  const $ = sel => page.locator(sel);

  head('the patched page runs');
  ok('nothing threw on load', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');
  ok('the Echo screen rendered', await $('section.echo-studio').count() === 1,
     `${await $('section.echo-studio').count()} .echo-studio`);
  ok('both modules reached the page',
     await page.evaluate(() => typeof window.Echo === 'object' && typeof window.EchoUI === 'object'),
     await page.evaluate(() => [typeof window.Echo, typeof window.EchoUI].join('/')));

  head('the way in');
  ok('the nav carries the button the patch inserted',
     await page.evaluate(() => !!document.querySelector('.nav [onclick="goEcho()"]')),
     await page.evaluate(() => {
       const b = document.querySelector('.nav [onclick="goEcho()"]');
       return b ? 'title=' + b.getAttribute('title') : 'absent';
     }));
  ok('and its glyph was interpolated rather than printed',
     await page.evaluate(() => {
       const b = document.querySelector('.nav [onclick="goEcho()"]');
       return !!b && !!b.querySelector('svg') && !/\$\{/.test(b.innerHTML);
     }));
  /* Leave the screen, come back through the button: this is the router edit
     and the nav edit checked together, which is how the fellow meets them. */
  await page.evaluate(() => { S.screen = 'memory'; render(); });
  ok('leaving the screen really leaves it', await $('section.echo-studio').count() === 0,
     `${await $('section.echo-studio').count()} .echo-studio`);
  await page.click('.nav [onclick="goEcho()"]');
  ok('and the button brings it back', await $('section.echo-studio').count() === 1,
     await page.evaluate(() => S.screen));

  head('two tabs, delegated from the document');
  /* THE TRANSITION, NOT THE DESTINATION. A first draft asserted only that
     .echo-list was on screen after clicking Reference — and when an injected
     mount-style binding killed the listener, that check passed anyway,
     because the screen had never left Reference to begin with. It was
     reporting "the click worked" on the strength of nothing having happened.
     So each of these requires the state it came FROM as well as the state it
     is in, and the second cannot pass unless the first did. */
  const tabNow = () => page.evaluate(() => {
    const t = document.querySelector('.echo-tab.on');
    return t ? t.getAttribute('data-echo-tab') : null;
  });
  const first = await tabNow();
  ok('Reference is the tab shown first', first === 'reference', String(first));
  await page.click('[data-echo-tab="calculator"]');
  const onCalc = await tabNow();
  ok('clicking Calculator switches to it',
     onCalc === 'calculator' && await $('.echo-calc').count() === 1,
     `${first} → ${onCalc}`);
  await page.click('[data-echo-tab="reference"]');
  const backRef = await tabNow();
  ok('and clicking Reference switches back',
     onCalc === 'calculator' && backRef === 'reference' && await $('.echo-list').count() === 1,
     `${onCalc} → ${backRef}`);
  /* THE POINT OF THE DELEGATION. render() replaced the panel twice by now. A
     listener bound to the tab elements at mount would be gone; one bound to
     the document is not, and nothing re-attached it. */
  const picked = await page.evaluate(() => {
     const b = document.querySelector('[data-echo-disease]');
     return b ? b.getAttribute('data-echo-disease') : null;
  });
  if (picked) await page.click(`[data-echo-disease="${picked}"]`);
  ok('a disease click still lands after two full repaints',
     await page.evaluate(id => {
       const b = document.querySelector(`[data-echo-disease="${id}"]`);
       return !!b && b.classList.contains('on');
     }, picked), String(picked));

  head('typing does not move the caret');
  await page.click('[data-echo-tab="calculator"]');
  /* NULL-SAFE ON PURPOSE. If the calculator tab never opened, these nodes do
     not exist — and an evaluate() that throws here would end the run early,
     so the suite would report fewer checks than it contains. scripts/verify.js
     reads a suite's count off its summary line, so a suite whose size moves
     with its outcome writes a wrong number into the record. That happened
     once today already, by a different route. */
  const marked = await page.evaluate(m => {
    const el = document.querySelector('[data-echo-field="lvotD"]');
    const box = document.querySelector('.echo-fields');
    if (el) { el.dataset[m] = '1'; el.focus(); }
    if (box) box.dataset[m] = '1';
    return !!el && !!box;
  }, MARK);
  if (marked) await page.keyboard.type('2.1');
  const typed = await page.evaluate(m => {
    const el = document.querySelector('[data-echo-field="lvotD"]');
    const box = document.querySelector('.echo-fields');
    const act = document.activeElement;
    return {
      value: el ? el.value : null,
      focusedField: act && act.getAttribute ? act.getAttribute('data-echo-field') : null,
      sameNode: !!act && !!act.dataset && act.dataset[m] === '1',
      fieldsSurvived: !!box && box.dataset[m] === '1',
    };
  }, MARK);
  ok('all three keystrokes landed in the field', typed.value === '2.1', `value "${typed.value}"`);
  ok('the field still has focus', typed.focusedField === 'lvotD', String(typed.focusedField));
  ok('and it is the same element, not one rebuilt under the caret', typed.sameNode,
     typed.sameNode ? 'marker survived' : 'marker gone — the node was replaced');
  ok('the field block was not repainted at all', typed.fieldsSurvived,
     typed.fieldsSurvived ? '.echo-fields untouched' : '.echo-fields was rebuilt');

  head('a row appears only when every input it needs is present');
  /* The VALUE CELL, not the row. A first draft read the whole row's text and
     rejected any em-dash in it — but the grade column is an em-dash by design
     for stroke volume, which has no severity table, so the check failed on a
     correct row. It was scanning a field the data does not have, which is the
     shape CLAUDE.md lists among the seven. Narrowed to the cell it meant. */
  const svRow = () => page.evaluate(() => {
    const tr = [...document.querySelectorAll('.echo-results tbody tr')]
      .find(r => /Stroke volume/.test(r.textContent));
    if (!tr) return null;
    const v = tr.querySelector('.echo-value');
    return { row: tr.textContent.replace(/\s+/g, ' ').trim(), value: v ? v.textContent.trim() : null };
  });
  ok('with one of the two inputs there is no stroke-volume row', (await svRow()) === null,
     JSON.stringify(await svRow()));
  ok('and it says so by name rather than silently',
     await page.evaluate(() => /Stroke volume/.test(
       (document.querySelector('.echo-missing') || {}).textContent || '')),
     await page.evaluate(() => ((document.querySelector('.echo-missing summary') || {}).textContent || 'none')));
  if (await $('[data-echo-field="lvotVti"]').count() === 1) {
    await page.click('[data-echo-field="lvotVti"]');
    await page.keyboard.type('22');
  }
  const row = await svRow();
  ok('with both, the row appears', row !== null, row ? row.row : 'still absent');
  ok('and its value cell carries a computed number, not a placeholder',
     !!row && /^\d+(\.\d+)?\s*mL$/.test(row.value || ''), row ? `"${row.value}"` : '-');

  /* Clearing removes the row. NARROWER THAN IT FIRST LOOKED, and the note is
     here because the injection that was supposed to prove it came back green:
     replacing the glue's `delete ECHO.fields[id]` with `= 0` changed nothing
     for this row, because src/core/echo.js refuses lvotVti <= 0 on its own.
     So this holds "the row goes away", which is worth holding, and says
     nothing about WHICH of the two layers made it go away. The check below
     is the one that separates them. */
  await page.evaluate(() => {
    const el = document.querySelector('[data-echo-field="lvotVti"]');
    if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  ok('clearing a field takes the row away again',
     row !== null && (await svRow()) === null,
     row === null ? 'there was no row to clear' : JSON.stringify(await svRow()));

  /* ABSENT IS NOT ZERO, on the one row where the core cannot cover for the
     glue. RA pressure is a lookup, not arithmetic: raPressure() accepts a
     collapse of 0 as a real measurement, because an IVC that does not
     collapse is a finding rather than a missing number. So a glue that wrote
     0 for an empty field would not blank the row — it would report a dilated
     non-collapsing IVC and 15 mmHg, which is a confident wrong answer on a
     study screen and exactly what this screen is built not to do. */
  const rapRow = () => page.evaluate(() => {
    const tr = [...document.querySelectorAll('.echo-results tbody tr')]
      .find(r => /RA pressure/.test(r.textContent));
    if (!tr) return null;
    const v = tr.querySelector('.echo-value');
    return v ? v.textContent.trim() : '';
  });
  const enter = async (id, text) => {
    if (await $(`[data-echo-field="${id}"]`).count() !== 1) return false;
    await page.click(`[data-echo-field="${id}"]`);
    await page.keyboard.type(text);
    return true;
  };
  await enter('ivcD', '2.5');
  await enter('ivcCollapse', '60');
  const rapBefore = await rapRow();
  ok('a collapsing IVC gives an RA pressure', rapBefore !== null, String(rapBefore));
  await page.evaluate(() => {
    const el = document.querySelector('[data-echo-field="ivcCollapse"]');
    if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  /* Requires the row to have BEEN there: "it is gone" is not evidence of
     anything when nothing was ever computed. Same vacuity the tab checks
     above had, found the same way — by injecting a defect and watching this
     stay green while its own precondition went red. */
  const rapAfter = await rapRow();
  ok('and clearing the collapse reports it missing, not as a non-collapsing IVC',
     rapBefore !== null && rapAfter === null,
     rapBefore === null ? 'there was no RA pressure to clear'
       : rapAfter === null ? 'row gone' : `still says ${rapAfter}`);
  ok('nothing on the panel reads NaN',
     await page.evaluate(() => {
       const p = document.querySelector('.echo-panel');
       return !!p && !/NaN/.test(p.textContent);
     }));
  ok('and no error was raised by any of it', errors.length === 0,
     errors.slice(0, 2).join(' | ') || 'clean');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('\n  the suite itself died: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
