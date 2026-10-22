#!/usr/bin/env node
/*
 * The reference library screen, drawn a page at a time.
 *
 *   node tests/verify-reflist.js build/synthetic/systole.html
 *
 * The library used to be drawn whole: on a library the size of the real one (1,144 notes) that was 20,000
 * elements and 9 MB of markup, a second and a half of the main thread each time the screen was drawn, and
 * drawn again from scratch by anything that redrew the screen. It is drawn REF_PAGE notes at a time now, newest
 * first. This holds what that must not cost:
 *   · the first page is the newest notes, in order, with a button that says how many are left;
 *   · the button adds the next page in place: the cards already drawn are the same cards, and a note being
 *     typed into the form above them is still there; the last page takes the button away, and every note is
 *     drawn once. The button is held with the observer that presses it for a reader switched off, which is
 *     what a browser that cannot say when the end is near gives: otherwise the observer presses it first;
 *   · reaching the end of the list loads the next page without a press, and then stops: the end is no longer
 *     at the edge, and the rest of the library is not drawn behind the reader's back;
 *   · leaving and coming back starts again at the first page; deleting a note keeps what was loaded; a note
 *     added from the form is at the top; one note opened from its source link is one card and no button, and
 *     if that note is deleted while it is looked at, the library that is left still pages;
 *   · nothing keeps watching the end of a list once the screen is left, and nothing throws.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-reflist.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 1194, height: 834 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  /* The ids of the cards on screen, in order, read from each card's own Edit button. */
  const drawnIds = () => page.evaluate(() => [...document.querySelectorAll('.ref-card .ref-acts .chip:first-child')]
    .map(b => b.dataset.refId));
  const pager = () => page.evaluate(() => { const p = document.getElementById('refPager'); return !p ? null : { button: p.querySelector('button').textContent.trim(), left: p.querySelector('span').textContent.trim() }; });
  const toLibrary = async id => {
    await page.evaluate(id => goRefs(id), id);
    await onScreen(page, 'refs', { marker: '.ref-card' });
    await quiet(page);
  };
  const waitCards = n => page.waitForFunction(n => document.querySelectorAll('.ref-card').length === n, n, { timeout: 5000 }).then(() => true, () => false);
  /* The observer that presses the button, switched off or back on. The page asks for it after every draw, so it is
     the function that is swapped. With it off the button is what a browser with no observer gives the reader. */
  const observer = on => page.evaluate(on => {
    if (!window.__mountRefPager) window.__mountRefPager = mountRefPager;
    mountRefPager = on ? window.__mountRefPager : function () { if (refPageWatch) { refPageWatch.disconnect(); refPageWatch = null; } };
  }, on);

  /* A library with more than two pages in it, newest to oldest by a time of its own, so that "newest first" has an
     answer: the seeded notes all carry the build's one time. */
  const lib = await page.evaluate(() => {
    REF.forEach((r, i) => { r.ts = 1.7e12 + i * 1000; });
    return { total: REF.length, page: REF_PAGE, newest: REF.slice().sort((a, b) => b.ts - a.ts).map(r => r.id) };
  });
  const PAGE = lib.page, TOTAL = lib.total;

  await observer(false);
  head('the first page');
  await toLibrary();
  ok('the library holds more than two pages, so paging has something to do', TOTAL > PAGE * 2 + 1, `${TOTAL} notes, pages of ${PAGE}`);
  const first = await drawnIds();
  ok('it draws the newest page of notes, in order, and no more', same(first, lib.newest.slice(0, PAGE)), `${first.length} drawn`);
  const p0 = await pager();
  ok('and a button names the next page and says how many are left', !!p0 && p0.button === `Show ${PAGE} more` && p0.left === `${TOTAL - PAGE} more in your library`, JSON.stringify(p0));

  head('the button adds the next page in place');
  {
    await page.fill('#refB', 'half a note, typed before the next page');
    await page.evaluate(() => { document.querySelector('.ref-card').dataset.kept = 'yes'; });
    await page.click('#refPager button');
    const two = await waitCards(PAGE * 2);
    const ids = await drawnIds();
    ok('the next page follows the first, in order', two && same(ids, lib.newest.slice(0, PAGE * 2)), `${ids.length} drawn`);
    const kept = await page.evaluate(() => ({ text: document.getElementById('refB').value, card: document.querySelector('.ref-card').dataset.kept || null }));
    ok('the note being typed is still in the form, and the first card is the card that was there, not a copy', kept.text === 'half a note, typed before the next page' && kept.card === 'yes', JSON.stringify(kept));
    const p1 = await pager();
    ok('the button counts down', !!p1 && p1.left === `${TOTAL - PAGE * 2} more in your library`, JSON.stringify(p1));
    for (let i = 0; i < Math.ceil(TOTAL / PAGE) + 1 && await pager(); i++) { await page.click('#refPager button'); await quiet(page); }
    const all = await drawnIds();
    ok('the last page takes the button away, and every note is drawn once', !(await pager()) && all.length === TOTAL && new Set(all).size === TOTAL, `${all.length} of ${TOTAL}, ${new Set(all).size} distinct`);
  }

  head('leaving, deleting, adding, and one note on its own');
  {
    await toLibrary();
    ok('a fresh visit is the first page again, not where the last visit ended', same(await drawnIds(), lib.newest.slice(0, PAGE)));
    await page.click('#refPager button');
    await waitCards(PAGE * 2);
    await page.evaluate(() => goHome());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await toLibrary();
    ok('coming back from another screen starts at the first page', (await drawnIds()).length === PAGE);

    await page.click('#refPager button');
    await waitCards(PAGE * 2);
    const gone = (await drawnIds())[4];
    await page.evaluate(id => refRemove(id), gone);
    await quiet(page);
    const after = await drawnIds();
    ok('deleting a note keeps what was loaded: the note is gone, the same number are drawn, and the next one has moved up',
       !after.includes(gone) && after.length === PAGE * 2 && await page.evaluate(() => REF.length) === TOTAL - 1, `${after.length} drawn`);

    await page.fill('#refT', 'A note about the list itself');
    await page.fill('#refB', 'Written in the form, it is the newest note and is drawn first.');
    await page.click('.ref-new .btn-next');
    await quiet(page);
    const top = await page.evaluate(() => ({ title: document.querySelector('.ref-card .ref-title').textContent.trim(), total: REF.length }));
    ok('a note added from the form is the first card', top.title === 'A note about the list itself' && top.total === TOTAL, JSON.stringify(top));

    const one = lib.newest[PAGE * 3];
    await toLibrary(one);
    ok('one note opened from its source link is one card and no button', (await drawnIds()).length === 1 && !(await pager()) && (await drawnIds())[0] === one);

    /* That note is deleted while it is the one being looked at. The id it was opened by is left behind, and there is no note
       under it: what is left to look at is the library, and the library pages. */
    await page.evaluate(id => refRemove(id), one);
    await quiet(page);
    const lone = await page.evaluate(() => ({ cards: document.querySelectorAll('.ref-card').length, button: !!document.querySelector('#refPager button'), notes: REF.length }));
    ok('a note deleted while it was looked at on its own leaves the library, a page of it, and the button for the rest', lone.cards === PAGE && lone.button && lone.notes === TOTAL - 1, JSON.stringify(lone));
    await page.click('#refPager button');
    ok('and the button adds the next page', await waitCards(PAGE * 2), `${await page.evaluate(() => document.querySelectorAll('.ref-card').length)} drawn`);
    /* The press scrolled to the foot of two pages, and a screen opened afresh scrolls back to the top smoothly. For the first
       frames of that the end of the list is in reach of the observer in the next section, which draws a second page before
       anyone asked. That section is about a fresh visit, so it is left at the top of the screen, at once. */
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    await quiet(page);
  }

  await observer(true);
  head('reaching the end of the list loads the next page by itself, and then stops');
  {
    await toLibrary();
    { const n = (await drawnIds()).length; ok('a fresh visit is the first page', n === PAGE, `${n} drawn`); }
    await page.evaluate(() => { document.getElementById('refPager').scrollIntoView({ block: 'end' }); });
    const more = await page.waitForFunction(n => document.querySelectorAll('.ref-card').length > n, PAGE, { timeout: 5000 }).then(() => true, () => false);
    await quiet(page);
    /* Nothing observable marks "no further page is coming", so the quiet above is followed by a look after the
       observer has had its turn: an observer that always found the end within reach would go on drawing the library
       to its last note without a finger on the screen. */
    await page.waitForTimeout(700);
    const ids = await drawnIds();
    const newestNow = await page.evaluate(() => refsNewestFirst().map(r => r.id));   // the library has changed since it was counted: a note added, one deleted
    ok('with the end of the list at the edge of the screen, a page is drawn without a press, in order', more && same(ids.slice(0, PAGE * 2), newestNow.slice(0, PAGE * 2)), `${ids.length} drawn`);
    ok('and then it stops: the end is no longer at the edge, so the rest is not drawn until it is reached', ids.length === PAGE * 2 && !!(await pager()), `${ids.length} drawn of ${TOTAL}`);
  }

  head('nothing keeps watching');
  {
    ok('while the library is up the end of the list is watched', await page.evaluate(() => refPageWatch !== null));
    await page.evaluate(() => goHome());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    ok('once the screen is left nothing is', await page.evaluate(() => refPageWatch === null));
    ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
