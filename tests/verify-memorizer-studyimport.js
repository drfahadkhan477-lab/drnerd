#!/usr/bin/env node
/*
 * Study files in a real browser: HTML read by the page's own DOMParser, and
 * the Import Study dialog driven as a person would.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer-studyimport.js
 *
 * Builds memorizer/ itself with scripts/build-memorizer.js into a temporary
 * directory, so what is tested is the one file a user opens. Every HTML page
 * here is written in this file; no one's study material is read. Needs no
 * network: nothing on these paths fetches.
 *
 * WHAT IS PROVEN, beyond tests/verify-memorizer-studyimport-pure.js (which
 * has no DOM):
 *   · a saved page's navigation, scripts and SVG never become study text; its
 *     definition lists, tables, image descriptions and captions do;
 *   · a question's options are its option list, not the list of reasons
 *     under its explanation; its answer is read from data-answer, a .correct
 *     option, or a checked radio button — the last before form controls are
 *     dropped; an unmarked question has no answer and is counted;
 *   · the dialog is a modal (dialog.js): both Cancel and × close it, Escape
 *     closes it and gives focus back, the whole drop area opens the picker,
 *     and a file over the limit is refused before it is read;
 *   · an import becomes a unit that opens, with its file and front-matter
 *     source shown under its title; and when
 *     the pack cannot be stored, no unit is left behind.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const errors = [], events = [];
onDeath(() => ({ section, checks: passed + failed, errors, events }));

const ROOT = path.join(__dirname, '..');
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));

const PAGE = `<!doctype html><html><head><title>Saved page title</title>
<style>.x{color:red}</style><script>var NAVSCRIPT = "script text must not be studied";</script></head><body>
<nav><a href="/">Home navigation link</a></nav>
<h1>Valve Lesions</h1>
<h2>Key terms</h2>
<dl><dt>Aortic stenosis</dt><dd>narrowing of the aortic valve that causes a crescendo-decrescendo systolic murmur.</dd>
<dt>Mitral regurgitation</dt><dd>backflow through the mitral valve that causes a holosystolic murmur at the apex.</dd></dl>
<p>Aortic stenosis presents with angina, syncope and heart failure, and the murmur radiates to the carotids.</p>
<ul><li>Outer item about valves<ul><li>Nested item about calcification of the leaflets</li></ul></li></ul>
<figure><img src="x.png" alt="Pressure tracing across a stenotic aortic valve"><figcaption>The gradient between ventricle and aorta</figcaption></figure>
<svg viewBox="0 0 10 10"><text>svg label must not be studied</text></svg>
<table><thead><tr><th>Lesion</th><th>Murmur</th></tr></thead><tbody>
<tr><td>Aortic stenosis</td><td>crescendo-decrescendo systolic</td></tr><tr><td>Mitral regurgitation</td><td>holosystolic at the apex</td></tr></tbody></table>
<h2>Questions</h2>
<div class="question" data-answer="B"><p class="stem">Which lesion causes a holosystolic murmur at the apex?</p>
 <ol class="options"><li>Aortic stenosis</li><li>Mitral regurgitation</li><li>Pulmonary stenosis</li><li>Tricuspid stenosis</li></ol>
 <div class="explanation">Mitral regurgitation is holosystolic at the apex.</div>
 <ul class="why-wrong"><li>A is crescendo-decrescendo</li><li>C is at the left upper sternal border</li><li>D is diastolic</li></ul></div>
<div data-question><p>Which murmur radiates to the carotids?</p>
 <div data-option>Mitral regurgitation</div><div data-option class="correct">Aortic stenosis</div><div data-option>Tricuspid regurgitation</div><div data-option>Pulmonary stenosis</div></div>
<fieldset><legend>Which lesion presents with syncope?</legend>
 <label><input type="radio" name="q3"> Mitral regurgitation</label><label><input type="radio" name="q3"> Tricuspid stenosis</label>
 <label><input type="radio" name="q3" checked> Aortic stenosis</label><label><input type="radio" name="q3"> Pulmonary regurgitation</label></fieldset>
<div class="question"><p class="stem">An unmarked question about murmurs?</p><ul><li>One</li><li>Two</li><li>Three</li><li>Four</li></ul></div>
<footer>Footer copyright line</footer>
<p>Malformed tail <b>unclosed <i>tags continue about the aortic valve
</body></html>`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-studyimport-'));
  build(dir);
  const URL = 'file://' + path.join(dir, 'index.html');
  const T = { timeout: 30000 };
  const browser = await launch();
  const fresh = async tag => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' });
    const p = watch(await ctx.newPage(), events, tag, errors);
    await p.goto(URL);
    await p.waitForSelector('#chip-import-study', T);
    return { ctx, p };
  };
  try {
    head('a saved HTML page, read in the page');
    let { ctx, p } = await fresh('parse');
    const r = await p.evaluate(html => {
      const got = MemStudyImport.parseStudyFile(html, 'valves.html');
      return { ok: got.success, error: got.error, format: got.format, summary: got.summary, text: got.study && got.study.text,
               qs: got.study && got.study.parsed.questions.map(q => ({ q: q.question, options: q.options, answer: q.answer })) };
    }, PAGE);
    ok('it is read, as HTML', r.ok && r.format === 'html', r.error || r.format);
    const text = r.text || '', qs = r.qs || [];
    ok('the unit is named from its <h1>', r.summary && r.summary.unit === 'Valve Lesions', r.summary && r.summary.unit);
    ok('navigation, script, SVG and footer never become study text',
       !/navigation link|script text|svg label|Footer copyright/.test(text), text.slice(0, 160));
    ok('each <dt>/<dd> pair is a teaching point', r.summary && r.summary.teaching_points === 2, r.summary && String(r.summary.teaching_points));
    ok('the table is read', r.summary && r.summary.tables === 1 && /Mitral regurgitation; Murmur: holosystolic at the apex/.test(text));
    ok('an image’s description and a caption become figure lines', /Figure: Pressure tracing across a stenotic aortic valve\./.test(text) && /Figure: The gradient between ventricle and aorta\./.test(text));
    ok('a nested list item is kept', /Nested item about calcification/.test(text));
    ok('prose after the last question, in unclosed markup, is still study text', /tags continue about the aortic valve/.test(text));
    ok('question text is not taught as study text', !/Which lesion causes a holosystolic murmur/.test(text));
    ok('four questions are found', qs.length === 4, JSON.stringify(qs.map(q => q.q)));
    const q1 = qs[0] || { options: [] };
    ok('a .question’s options are its option list, not the reasons listed under its explanation',
       q1.options.length === 4 && !q1.options.some(o => /crescendo|sternal|diastolic/.test(o)), JSON.stringify(q1.options));
    ok('data-answer="B" is the second option', q1.answer === 1 && q1.options[1] === 'Mitral regurgitation');
    const q2 = qs[1] || {};
    ok('a [data-question] block with a .correct option has that answer', q2.answer === 1 && q2.options && q2.options[1] === 'Aortic stenosis', JSON.stringify(q2));
    const q3 = qs[2] || {};
    ok('a fieldset’s checked radio is its answer, read before form controls are dropped', q3.answer === 2 && q3.options && q3.options[2] === 'Aortic stenosis', JSON.stringify(q3));
    ok('an unmarked question has no answer (-1), and is counted as such', (qs[3] || {}).answer === -1 && r.summary.unanswered === 1, JSON.stringify(r.summary));
    await ctx.close();

    head('the dialog');
    ({ ctx, p } = await fresh('dialog'));
    await p.click('#chip-import-study');
    await p.waitForSelector('#import-dialog', T);
    const a = await p.evaluate(() => {
      const d = document.getElementById('import-dialog'), inp = document.getElementById('import-file'), drop = document.getElementById('import-drop');
      return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-labelledby'),
               title: (document.getElementById(d.getAttribute('aria-labelledby')) || {}).textContent,
               inside: d.contains(document.activeElement), inert: document.getElementById('app').hasAttribute('inert'),
               dropOpens: drop.control === inp, accept: inp.accept, ids: document.querySelectorAll('#import-dialog [id]').length,
               uniqueIds: new Set([...document.querySelectorAll('#import-dialog [id]')].map(e => e.id)).size,
               closeLabel: document.getElementById('import-close').getAttribute('aria-label') };
    });
    ok('it is a labelled modal dialog', a.role === 'dialog' && a.modal === 'true' && a.title === 'Import a study file', JSON.stringify(a));
    ok('focus is inside it and the app behind it is inert', a.inside && a.inert);
    ok('no two of its elements share an id', a.ids === a.uniqueIds, a.ids + ' ids, ' + a.uniqueIds + ' distinct');
    ok('the × has a spoken name', a.closeLabel === 'Close');
    ok('the whole drop area opens the file picker (it is the input’s label)', a.dropOpens);
    ok('it accepts every kind it reads: .md .markdown .txt .html .htm', ['.md', '.markdown', '.txt', '.html', '.htm'].every(x => a.accept.split(',').includes(x)), a.accept);
    await p.click('#import-cancel');
    ok('the footer Cancel closes it', await p.$('#import-dialog') === null);
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.click('#import-close');
    ok('the × closes it', await p.$('#import-dialog') === null);
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.keyboard.press('Escape');
    ok('Escape closes it, and focus goes back to Import Study',
       await p.$('#import-dialog') === null && await p.evaluate(() => document.activeElement && document.activeElement.id) === 'chip-import-study');

    head('a file too large');
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.setInputFiles('#import-file', { name: 'huge.html', mimeType: 'text/html', buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 'a') });
    await p.waitForFunction(() => /too large/.test(document.getElementById('import-status').textContent), null, T);
    ok('it is refused before it is read, with its size and a way forward, and Import stays off',
       await p.evaluate(() => /\(2\.0 MB; the limit is 2 MB\)/.test(document.getElementById('import-status').textContent) && /Split it into smaller/.test(document.getElementById('import-status').textContent) && document.getElementById('import-go').disabled));

    head('importing the page');
    await p.setInputFiles('#import-file', { name: 'valves.html', mimeType: 'text/html', buffer: Buffer.from(PAGE) });
    await p.waitForFunction(() => !document.getElementById('import-go').disabled, null, T);
    const preview = await p.$eval('#import-summary', e => e.textContent);
    ok('the preview says what will be left out before anything is stored', /3 of 4 usable/.test(preview) && /1 question with no marked answer/.test(preview), preview);
    await p.click('#import-go');
    await p.waitForSelector('#learn-unit', T);
    const u = await p.evaluate(() => ({ notice: (document.getElementById('notice') || {}).textContent || '', source: (document.getElementById('unit-source') || {}).textContent || '',
      qn: Memorizer.ui.pack ? Object.values(Memorizer.ui.pack.sections).reduce((n, s) => n + s.quiz.questions.length, 0) : 0 }));
    ok('the unit opens, and its note counts what the check did', /Imported section/.test(u.notice) && /1 question with no marked answer left out/.test(u.notice), u.notice);
    ok('the unit says it came from this file', /Imported study file “valves\.html”/.test(u.source), u.source);
    ok('the three answered questions are the unit’s', u.qn === 3, String(u.qn));
    await ctx.close();

    head('a markdown file’s source details');
    ({ ctx, p } = await fresh('markdown'));
    const MD = ['---', 'unit: Ventricular Loading', 'source_book: Braunwald 12e, chapter 22', 'source_page_range: 450-470', 'difficulty_level: advanced',
      'estimated_study_time_minutes: 35', '---', '', '## Teaching Points',
      '- **Preload**: the stretch on the ventricular wall at the end of filling, set by venous return [p. 452].',
      '- **Afterload**: the load the ventricle pumps against during ejection, raised by high aortic pressure.'].join('\n');
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.setInputFiles('#import-file', { name: 'loading.md', mimeType: 'text/markdown', buffer: Buffer.from(MD) });
    await p.waitForFunction(() => !document.getElementById('import-go').disabled, null, T);
    await p.click('#import-go');
    await p.waitForSelector('#unit-source', T);
    const src = await p.$eval('#unit-source', e => e.textContent);
    ok('the unit shows the file, source book, pages, level and time from its front matter',
       /loading\.md/.test(src) && /Braunwald 12e, chapter 22/.test(src) && /pp\. 450-470/.test(src) && /advanced/.test(src) && /~35 min/.test(src), src);
    await ctx.close();

    head('all or nothing');
    ({ ctx, p } = await fresh('rollback'));
    await p.evaluate(() => { const put = MemStore.put; MemStore.put = (s, v) => s === 'packs' ? Promise.reject(new Error('disk full (test)')) : put(s, v); });
    const before = await p.evaluate(() => MemStore.all('docs').then(d => d.length));
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.setInputFiles('#import-file', { name: 'valves.html', mimeType: 'text/html', buffer: Buffer.from(PAGE) });
    await p.waitForFunction(() => !document.getElementById('import-go').disabled, null, T);
    await p.click('#import-go');
    await p.waitForFunction(() => /disk full \(test\)/.test(document.body.textContent), null, T);
    const after = await p.evaluate(() => MemStore.all('docs').then(d => d.length));
    ok('when the pack cannot be stored, the error is shown and no unit is left behind', after === before, before + ' units before, ' + after + ' after');
    await ctx.close();
  } finally {
    await browser.close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
