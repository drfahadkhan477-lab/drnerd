#!/usr/bin/env node
/*
 * Checks for the Braunwald reference library and grounded mode.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-braunwald.js <patched.html|url>
 *
 * The claim that matters is not "a toggle exists". It is that when grounded
 * mode is on, the request actually leaving the app carries the prohibition and
 * carries the fellow's notes and NOTHING from the ACC question bank — because
 * that is the only thing standing between "grounded" and "grounded-flavoured".
 * So the checks intercept the real request rather than reading state.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-braunwald.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SSE = [
  'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Per your notes.' } }] }),
  'data: [DONE]',
  '',
].join('\n\n');

/* Two files: one with full front matter, one with none, so both paths run. */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-'));
fs.writeFileSync(path.join(DIR, 'amyloid.md'), `---
title: Cardiac amyloidosis
tags: amyloid, ATTR, AL, restrictive
source: Braunwald's Heart Disease 12e, Ch 77
---

## Recognition
Suspect in HFpEF with increased wall thickness and discordantly low voltage.
Apical sparing on longitudinal strain is the classic pattern.

## Management
Tafamidis reduces mortality in ATTR-CM. Avoid digoxin and calcium channel
blockers, which bind amyloid fibrils.
`);
fs.writeFileSync(path.join(DIR, 'pericardial-disease.md'), `# Constrictive pericarditis
Septal bounce and respirophasic ventricular interdependence are the hallmarks.
Discordant LV/RV systolic pressures on simultaneous catheterisation is the most
specific haemodynamic finding.
`);

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const captured = [];
  await page.route('**/v1/chat/completions', route => {
    try { captured.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { captured.push(null); }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(800);

  head('importing a corpus');
  await page.evaluate(() => { goRefs(); render(); });
  /* The build ships a seeded library now (refs-patch), so the importer's own
     fixture has to start from a known-empty one. The assertions below are
     absolute counts, and they are about what the IMPORTER produced — not
     about what happened to be on the shelf when it ran. */
  await page.evaluate(() => { REF.length = 0; invalidateIndex(); });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.evaluate(() => refImportText()),
  ]);
  await chooser.setFiles([path.join(DIR, 'amyloid.md'), path.join(DIR, 'pericardial-disease.md')]);
  await page.waitForTimeout(1000);

  const lib = await page.evaluate(() => ({
    count: REF.length,
    titles: REF.map(r => r.title),
    sources: REF.map(r => r.source || ''),
    tags: REF.map(r => r.tags || ''),
    ids: REF.map(r => r.id),
  }));
  ok('both files imported in one pick', lib.count === 3, `${lib.count} notes`);
  ok('a chapter splits into one note per section, chapter named in each',
     lib.titles.filter(t => t.startsWith('Cardiac amyloidosis — ')).length === 2,
     lib.titles.join(' | '));
  ok('front-matter source is carried onto every section of that file',
     lib.sources.filter(s => /Braunwald/.test(s)).length === 2, JSON.stringify(lib.sources));
  ok('front-matter tags are carried through',
     lib.tags.some(t => /ATTR/.test(t)), lib.tags[0]);
  ok('a file with no front matter still imports',
     lib.titles.some(t => /Constrictive pericarditis/.test(t)), lib.titles.join(' | '));
  ok('ids are unique across a same-tick bulk import',
     new Set(lib.ids).size === lib.ids.length, `${new Set(lib.ids).size}/${lib.ids.length}`);
  ok('the source is shown in the library UI',
     (await page.evaluate(() => document.body.innerHTML)).includes('ref-src'));

  head('the grounded switch');
  const flip = await page.evaluate(() => {
    const before = AI_GROUNDED;
    toggleGrounded();
    return { before, after: AI_GROUNDED, persisted: localStorage.getItem('accsap12.grounded') };
  });
  ok('off by default', flip.before === false);
  ok('turns on with a library present', flip.after === true);
  ok('the choice is remembered', flip.persisted === '1');

  /* Drive one real exchange and read what actually went out. */
  const ask = async () => {
    captured.length = 0;
    await page.evaluate(async () => {
      AI.provider = 'mistral';
      AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
      const q = ALL_Q.find(x => !x.bad);
      jumpTo(q.id);
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      fire('how do I tell AL from ATTR?');
    });
    await page.waitForTimeout(1800);
    return captured.find(Boolean);
  };

  head('grounded: what actually leaves the app');
  const groundedReq = await ask();
  /* Collapse whitespace before matching: the prompt is hard-wrapped for
     readability in source, so a phrase can straddle a newline. */
  const flat = t => String(t || '').replace(/\s+/g, ' ');
  const sysText = flat((groundedReq.messages || []).find(m => m.role === 'system')?.content || '');
  ok('a request was captured', !!groundedReq);
  ok('the prohibition is in the system prompt', /GROUNDED MODE IS ON/.test(sysText));
  ok('it is told not to supplement from its own knowledge',
     /Do not supplement them from your own knowledge/.test(sysText));
  ok('it is given the exact words to refuse with',
     /Your notes do not cover this/.test(sysText));
  ok('the fellow\'s notes are in the context, inside their own fence',
     /<<<NOTE-[A-Z0-9]{12}>>> title: Cardiac amyloidosis/.test(sysText));
  ok('the note\'s source travels with it, so a citation is checkable',
     /source: Braunwald/.test(sysText));
  ok('no retrieved question-bank items are included',
     !/RELATED ITEM/.test(sysText));
  ok('the answer key itself is withheld',
     !/OFFICIAL ACC COMMENTARY/.test(sysText) && /commentary for this item is withheld/i.test(sysText));
  ok('but the stem is still there, so it knows what was asked',
     /CURRENT QUESTION/.test(sysText) && /STEM/.test(sysText));

  head('open mode: unchanged behaviour');
  await page.evaluate(() => { toggleGrounded(); });
  const openReq = await ask();
  const openSys = flat((openReq.messages || []).find(m => m.role === 'system')?.content || '');
  ok('the prohibition is gone', !/GROUNDED MODE IS ON/.test(openSys));
  ok('the answer key and bank come back', /OFFICIAL ACC COMMENTARY/.test(openSys));

  head('grounded with nothing to read');
  const empty = await page.evaluate(() => {
    const saved = REF.slice();
    REF.length = 0; invalidateIndex();
    AI_GROUNDED = true;
    const ctx = retrievedContext('something entirely unrelated to any note', null);
    REF.push(...saved); invalidateIndex(); AI_GROUNDED = false;
    return ctx.text;
  });
  ok('it is told to say the notes do not cover it, not to improvise',
     /RETURNED NOTHING/.test(empty) && /do not answer from your own knowledge/.test(empty),
     empty.slice(0, 90));

  const guard = await page.evaluate(() => {
    const saved = REF.slice();
    REF.length = 0; invalidateIndex();
    AI_GROUNDED = false;
    toggleGrounded();
    const got = AI_GROUNDED;
    REF.push(...saved); invalidateIndex();
    return got;
  });
  ok('the switch refuses to turn on with an empty library', guard === false);

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
