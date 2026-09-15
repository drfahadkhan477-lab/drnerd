#!/usr/bin/env node
/*
 * Watch a question figure fail to appear, and say which half failed.
 *
 *   node tools/figure-probe.js build/systole.html
 *   node tools/figure-probe.js http://localhost:8080          # the split build
 *   node tools/figure-probe.js build/systole.html --chapter "Valvular Disease"
 *   node tools/figure-probe.js build/systole.html --limit 40
 *
 * THE SECOND HALF OF A TWO-PART DIAGNOSIS. tools/figure-audit.js asks whether
 * the CONTENT is at fault — whether a question refers to a picture it does not
 * carry. If that comes back clean, the figures exist and the app is not showing
 * them, and this is what asks why.
 *
 * WHY IT DOES NOT NEED TO KNOW THE MARKUP. The obvious probe looks for the
 * question figure's CSS class, which is in the ACCSAP source and not in this
 * repository. It does not need to: IMGS[q.id] holds the exact src of every
 * figure the question should show, so every <img> in the document can be
 * matched by src instead. That makes this immune to a class rename and, more
 * importantly, writable and testable without the licensed build.
 *
 * THE THREE OUTCOMES, which are three different bugs:
 *
 *   ABSENT    IMGS has the figure, but no <img> in the document carries that
 *             src. The app never rendered it — a logic fault, not a loading
 *             one. In the single-file build this is the ONLY possible failure,
 *             because the src is a data: URI that cannot 404.
 *   UNDECODED An <img> has the src but naturalWidth is 0. The bytes did not
 *             become a picture: a 404 or a corrupt figure in the split build,
 *             or a malformed data: URI in the single file.
 *   UNBOXED   It decoded, but its layout box is 0 wide or 0 high, so nothing
 *             is on screen. This is the mechanism behind the figsharp race —
 *             width:auto on an image gives zero width until it decodes — and
 *             it looks exactly like a missing figure to the reader.
 *
 * Reported per question and summarised, because "31 undecoded, all in one
 * chapter" and "31 unboxed, scattered" are different investigations.
 *
 * ON LICENSED CONTENT. It prints question ids, chapters and pixel dimensions.
 * No stem text, no options, no commentary, no image data.
 */
'use strict';
const path = require('path');
const { launch, engineName } = require('../tests/_engine.js');
const { booted } = require('../tests/_render.js');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const flag = n => { const i = args.indexOf('--' + n); return i < 0 ? null : args[i + 1]; };
const LIMIT = +(flag('limit') || 25);
const ONLY_CH = flag('chapter');
if (!target) {
  console.error('usage: node tools/figure-probe.js <build/systole.html | http://host:port> [--chapter NAME] [--limit N]');
  process.exit(2);
}
const url = /^https?:/.test(target) ? target : 'file://' + path.resolve(target);

(async () => {
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)); });

  console.log(`Figure probe — ${engineName()}`);
  console.log(`  ${target}\n`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await booted(page);

  /* Which questions to look at: those the app itself says carry a figure. */
  const plan = await page.evaluate(ch => {
    if (typeof ALL_Q === 'undefined' || typeof IMGS === 'undefined') return null;
    return ALL_Q
      .filter(q => (!ch || q.ch === ch) && IMGS[q.id] && IMGS[q.id].length)
      .map(q => ({ id: q.id, ch: q.ch, want: IMGS[q.id].length }));
  }, ONLY_CH);

  if (!plan) {
    console.error('  ALL_Q or IMGS is not defined on this page — is this a Systole build?');
    await browser.close(); process.exit(1);
  }
  if (!plan.length) {
    console.error(`  no question carries a figure${ONLY_CH ? ` in "${ONLY_CH}"` : ''}.`);
    await browser.close(); process.exit(1);
  }
  const chapters = [...new Set(plan.map(p => p.ch))];
  console.log(`  ${plan.length} question(s) carry a figure across ${chapters.length} chapter(s)`);
  console.log(`  looking at the first ${Math.min(LIMIT, plan.length)}\n`);

  const rows = [];
  for (const item of plan.slice(0, LIMIT)) {
    /* Put the question on screen. startQuiz builds the list for the chapter;
       then walk to the one we want rather than assuming an order. */
    const placed = await page.evaluate(({ id, ch }) => {
      try { startQuiz(ch, 'all'); } catch (e) { return 'startQuiz threw: ' + e.message; }
      const at = S.questions.findIndex(q => q.id === id);
      if (at < 0) return 'not in the chapter list';
      S.qIdx = at;
      render();
      return 'ok';
    }, item);
    if (placed !== 'ok') { rows.push({ ...item, verdict: 'UNREACHED', note: placed }); continue; }

    /* Wait for the figures to be attached AND settled, rather than sleeping:
       render() commits inside startViewTransition, so reading immediately
       reads the previous question. Give up rather than hang. */
    const seen = await page.evaluate(async id => {
      const want = IMGS[id] || [];
      const find = () => want.map(src => [...document.images].find(i => i.currentSrc === src || i.src === src));
      const t0 = Date.now();
      let found = find();
      while (Date.now() - t0 < 10000) {
        found = find();
        if (found.every(Boolean) && found.every(i => i.complete)) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return found.map((img, i) => {
        if (!img) return { i, state: 'ABSENT' };
        const r = img.getBoundingClientRect();
        const decoded = img.naturalWidth > 0 && img.naturalHeight > 0;
        const boxed = r.width > 0 && r.height > 0;
        return {
          i,
          state: !decoded ? 'UNDECODED' : !boxed ? 'UNBOXED' : 'OK',
          natural: `${img.naturalWidth}x${img.naturalHeight}`,
          box: `${Math.round(r.width)}x${Math.round(r.height)}`,
          hidden: getComputedStyle(img).display === 'none' || getComputedStyle(img).visibility === 'hidden',
        };
      });
    }, item.id);

    const bad = seen.filter(s => s.state !== 'OK');
    rows.push({ ...item, seen, verdict: bad.length ? bad[0].state : 'OK', bad });
  }

  /* ── report ─────────────────────────────────────────────────────────────── */
  const tally = {};
  for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  const broken = rows.filter(r => r.verdict !== 'OK');

  for (const r of broken) {
    console.log(`  ${r.verdict.padEnd(10)} ${r.id.padEnd(10)} ${r.ch}`);
    for (const s of (r.bad || [])) {
      console.log(`             figure ${s.i + 1}/${r.want}` +
        (s.state === 'ABSENT' ? '  no <img> in the document carries this src'
          : `  decoded ${s.natural}, box ${s.box}${s.hidden ? ', and it is display:none / visibility:hidden' : ''}`));
    }
    if (r.note) console.log(`             ${r.note}`);
  }

  console.log(`\n  ${rows.length} checked:  ` +
    Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('   '));

  if (!broken.length) {
    console.log('\nEvery figure decoded and was laid out. The figures these questions');
    console.log('carry do render — so whatever you saw is either a different chapter');
    console.log('(re-run with --chapter) or not a rendering fault at all.');
  } else {
    console.log('\nABSENT means the app never rendered it — a logic fault.');
    console.log('UNDECODED means the bytes never became a picture — a loading fault.');
    console.log('UNBOXED means it decoded but has no layout box — a CSS fault.');
    console.log('Those are three different investigations; the counts above say which.');
  }
  if (pageErrors.length) {
    console.log(`\n  ${pageErrors.length} page error(s), first few:`);
    [...new Set(pageErrors)].slice(0, 5).forEach(e => console.log('    ' + e));
  }
  await browser.close();
  process.exit(broken.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
