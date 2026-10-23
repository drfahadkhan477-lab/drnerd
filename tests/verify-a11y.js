#!/usr/bin/env node
/*
 * Every screen passes axe-core's accessibility rules, in a light and a dark theme.
 *
 *   node tests/verify-a11y.js build/synthetic/systole.html
 *
 * axe-core (the rule engine, pinned in package.json) is put into the app the build makes, and each screen is opened the
 * way the app opens it: home, Study, a quiz with a figure (unanswered, answered wrong, and with Apex open), search with
 * results, the notes, note search, Memory, statistics, annotations, Echo, the Rhythm Lab, the Practice Lab and one of its
 * drills, a mock exam, and the theme menu. Each is read at rest, once its entrances have ended, in Daylight on a light
 * device and Midnight on a dark one. The rules are WCAG 2.2 A and AA and axe's best practice; a screen passes when axe
 * finds nothing, whatever the impact. Contrast in all twelve theme states is verify-ink's; this is every other rule, and
 * contrast again in these two.
 *
 * Its report names a rule, how many elements broke it, and the first one's tag and class: never the page's text, which
 * on the owner's build is the licensed bank's.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, quiet, settled, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-a11y.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const AXE_FILE = require.resolve('axe-core/axe.min.js', { paths: [ROOT] });
const AXE = fs.readFileSync(AXE_FILE, 'utf8');
const PINNED = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies['axe-core'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/* [name, how the app opens it, what is done on it once it is up, the screen it must be on] */
const SCREENS = [
  ['home', () => { goHome(); }, null, 'home'],
  ['Study', () => { goStudy(); }, null, 'study'],
  ['a quiz with a figure', () => { startAdhocQuiz([POOL.find(x => !x.bad && x.img)], null); }, null, 'quiz'],
  ['the same question, answered wrong', () => { startAdhocQuiz([POOL.find(x => !x.bad && x.img)], null); },
    () => { const q = S.questions[S.qIdx]; const o = document.querySelector('.opt[data-idx="' + ((q.ci + 1) % q.o.length) + '"]'); if (o) o.click(); }, 'quiz'],
  ['a quiz with Apex open', () => { startAdhocQuiz([POOL.find(x => !x.bad)], null); },
    () => { if (!document.getElementById('shell').classList.contains('ai-open')) toggleAI(); }, 'quiz'],
  ['search, with results', () => { openSearch(); }, () => {
    let w = null;
    for (const q of POOL) { for (const x of (q.s + ' ' + q.ex).split(/[^A-Za-z]+/)) if (x.length >= 7 && search(x, { limit: 5 }).some(h => h.meta.kind === 'q')) { w = x; break; } if (w) break; }
    searchGo(w || ''); }, 'search'],
  ['the notes', () => {
    // Imported excerpts can begin in the middle of an outline. Keep the real
    // library on screen too, and make this case independent of its contents.
    refAdd('Accessible outline fixture', '#### Deep first\n\nText.\n\n### Section\n\n#### Detail\n\n| | Value |\n|---|---|\n| Item | 1 |', 'accessibility');
    goRefs();
  }, null, 'refs'],
  ['note search', () => { goNoteSearch(); }, null, 'notesearch'],
  ['Memory', () => { goMemory(); }, null, 'memory'],
  ['statistics', () => { goStats(); }, null, 'stats'],
  ['annotations', () => { goAnnotations(); }, null, 'annotations'],
  ['Echo', () => { goEcho(); }, null, 'echo'],
  ['the Rhythm Lab', () => { goLab(); }, null, 'lab'],
  ['the Practice Lab', () => { goPractice(); }, null, 'practice'],
  ['a Practice Lab drill', () => { goPractice(); }, () => { const t = document.querySelector('.plab-tile[data-act="open"]'); if (t) t.click(); }, 'practice'],
  ['a mock exam', () => { startMock(); }, null, 'mock'],
  ['the theme menu', () => { goHome(); }, () => { openThemeMenu(); }, 'home'],
];
const THEMES = [['daylight', 'light', 'Daylight'], ['midnight', 'dark', 'Midnight']];

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'block' })).newPage(), events, '820px');
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.dismiss());
  await watchTransitions(page);
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  /* At rest. render() swaps screens inside a view transition, and while it runs the old screen's snapshot is drawn over the
     page, so it is waited out: a precondition. So is every finite animation on the page: the screen's entrances, and the
     colour transitions a theme change starts. A transition is waited out until the engine no longer lists it, not only
     until it stops running: WebKit kept a finished one's old colour on #app, and so on the Echo title it passes down to,
     for about a fifth of a second after it finished (1.1:1, the previous theme's text). */
  const rest = async () => {
    await settled(page, () => !window.__vtLive, { timeout: 15000, label: 'the screen change to finish' });
    await settled(page, () => !document.getAnimations().some(a => (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)
      || (a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity)),
      { timeout: 15000, label: 'the screen\'s entrances and the theme\'s transitions to end' });
  };
  const reset = () => page.evaluate(() => {
    if (S.mock && typeof mockStopTicker === 'function') mockStopTicker();
    if (document.getElementById('shell').classList.contains('ai-open')) toggleAI();
    if (typeof closeThemeMenu === 'function') closeThemeMenu();
  });
  const scan = () => page.evaluate(async tags => {
    const res = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    /* A rule, its count, and the first element's tag and first class: never its text. */
    return res.violations.map(v => { const h = (v.nodes[0] && v.nodes[0].html) || ''; const tag = (h.match(/^<([a-z0-9-]+)/i) || [])[1] || '?';
      const cls = (h.match(/^<[^>]*\sclass="([^" ]+)/) || [])[1];
      /* Contrast says what it measured: colours and the ratio, which hold no text. */
      const d = v.id === 'color-contrast' && v.nodes[0] && ((v.nodes[0].any[0] || {}).data || {});
      return `${v.id} (${v.impact}) ×${v.nodes.length} at ${tag}${cls ? '.' + cls : ''}${d ? ` ${d.contrastRatio}:1, ${d.fgColor} on ${d.bgColor}` : ''}`; });
  }, TAGS);

  head('the rule engine');
  await page.addScriptTag({ content: AXE });
  const engine = await page.evaluate(() => ({ version: window.axe && axe.version, rules: window.axe ? axe.getRules().length : 0 }));
  ok('axe-core is in the page, the version package.json pins, with its rules', engine.version === PINNED && engine.rules > 50, `axe ${engine.version} (pinned ${PINNED}), ${engine.rules} rules`);

  head('every screen, in Daylight and in Midnight');
  for (const [name, go, then, want] of SCREENS) {
    const found = [], off = [];
    for (const [id, scheme, label] of THEMES) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.evaluate(id => setTheme(id), id);
      await reset();
      await page.evaluate(`(${go})()`); await quiet(page);
      if (then) { await page.evaluate(`(${then})()`); await quiet(page); }
      await rest();
      const on = await page.evaluate(() => S.screen);
      if (on !== want) { off.push(`${label} on ${on}`); continue; }
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
      for (const v of await scan()) found.push(`${label}: ${v}`);
    }
    ok(`${name}: axe finds nothing, in Daylight and in Midnight`, !off.length && !found.length,
      off.length ? 'did not reach the screen: ' + off.join(', ') : found.slice(0, 4).join('; ') || 'clean');
  }

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
