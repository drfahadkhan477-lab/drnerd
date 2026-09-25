#!/usr/bin/env node
/*
 * What does the library's search actually return for a word, in a given build?
 *
 *   node tools/search-probe.js <build/systole.html | http://localhost:8080> <word> [word…]
 *
 * WHY THIS EXISTS. After the arrhythmias unit shipped, the shelf on the iPad
 * read "530 notes" and a search for "sotalol" — a word in one of those notes'
 * titles — showed nothing, while verify-retrieval had measured the same notes
 * at 100% on their titles. Something differs between the build the suites
 * test and the thing on the device, and guessing which is how an evening goes.
 * This asks the build directly: how many notes it holds, how many of them
 * contain the word at all, and what search() ranks first for it.
 *
 * Titles only. Results are split by kind; for question hits it prints a COUNT,
 * never their text — the bank is licensed and this output gets pasted.
 *
 * Point it at the single-file build, or at dist/ served locally
 * (node scripts/serve.js 8080 dist) to test the split build the iPad runs,
 * where the notes arrive by fetch after the first paint.
 */
'use strict';
const path = require('path');
const { launch } = require('../tests/_engine');

const args = process.argv.slice(2);
const target = args.shift();
if (!target || !args.length) {
  console.error('usage: node tools/search-probe.js <build/systole.html | http://…> <word> [word…]');
  process.exit(1);
}
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

(async () => {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(URL);
  await page.waitForFunction(
    () => typeof search === 'function' && typeof REF !== 'undefined', null, { timeout: 120000 });
  /* The split build fetches its notes after the first paint. Wait for the
     count to stop moving rather than for a fixed time. */
  let last = -1, stable = 0;
  for (let i = 0; i < 60 && stable < 4; i++) {
    const n = await page.evaluate(() => REF.length);
    stable = n === last ? stable + 1 : 0; last = n;
    await page.waitForTimeout(250);
  }
  const out = await page.evaluate((words) => {
    const r = { notes: REF.length,
                arrhythmias: REF.filter(x => /^Arrhythmias\b/.test(x.title || '')).length, words: [] };
    for (const w of words) {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const hits = search(w, { limit: 40 });
      r.words.push({
        word: w,
        titleHas: REF.filter(x => re.test(x.title || '')).length,
        bodyHas: REF.filter(x => re.test(x.body || '')).length,
        noteHits: hits.filter(h => h.meta.kind === 'r').slice(0, 5)
          .map(h => (REF.find(x => x.id === h.meta.id) || {}).title || '(id ' + h.meta.id + ')'),
        questionHits: hits.filter(h => h.meta.kind !== 'r').length,
      });
    }
    return r;
  }, args);
  await browser.close();

  console.log(`\n  ${out.notes} notes in REF, ${out.arrhythmias} of them "Arrhythmias · …"`);
  for (const w of out.words) {
    console.log(`\n  "${w.word}": in ${w.titleHas} note titles, ${w.bodyHas} note bodies`);
    console.log(`    search() → ${w.noteHits.length} note hits, ${w.questionHits} question hits`);
    w.noteHits.forEach((t, i) => console.log(`      ${i + 1}. ${t}`));
  }
  console.log('');
})().catch(e => { console.error(e); process.exit(1); });
