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
 *   · nothing keeps watching the end of a list once the screen is left, and nothing throws;
 *   · Cancel, Import, Export, Back, Back to study and Show all notes each reach their function when tapped.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');
const { heldRoom, keptRoom, roomSaid } = require('./_figroom.js');

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
  /* A precondition of every press, never the thing tested: the button is put in view and pressed only once it has
     stopped moving. After filling the form the pager is a long scroll away, and scrolled to (without a smooth scroll),
     the cards above it come within reach of their lazy figures. A figure written without a size has no room until it
     loads, so its card grew as it did: three cards of 345 px became 418, and the page kept growing and scrolling for a
     quarter of a second after the scroll had ended. Playwright then pressed the button and let go of the row around it,
     so the click went to the row and did nothing. The page now writes each figure's size (section below), and this
     still waits, for a figure it could not size. It is a wait, not a sleep: it ends when no figure on the screen is
     still loading (one there has begun to load and will finish; one off it may never be asked for) and the button and
     the page's height have held for five frames, or at the deadline. A deadline reached is said, and the press goes
     ahead, so the check that follows measures what it does. quiet() cannot see this: a figure that loads changes no
     markup. */
  const placed = () => page.evaluate(timeout => new Promise(resolve => {
    const deadline = performance.now() + timeout;
    let last = null, calm = 0;
    const tick = () => {
      const el = document.querySelector('#refPager button');
      if (!el) return resolve('no button');
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const top = el.getBoundingClientRect().top, h = innerHeight;
      const loading = [...document.querySelectorAll('.ref-card img')].some(im => {
        if (im.complete) return false;
        const r = im.getBoundingClientRect();
        return r.bottom > 0 && r.top < h;
      });
      const at = Math.round(top) + ',' + document.documentElement.scrollHeight;
      calm = !loading && at === last ? calm + 1 : 0;
      last = at;
      if (calm >= 5) return resolve('');
      if (performance.now() > deadline) return resolve(loading ? 'a figure near the button was still loading' : 'the button was still moving');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), 10000);
  const clickPager = async () => {
    const unsettled = await placed();
    if (unsettled) console.log(`  note: pressed the button anyway after 10 s: ${unsettled}`);
    await page.locator('#refPager button').click();
  };
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
    await clickPager();
    const two = await waitCards(PAGE * 2);
    const ids = await drawnIds();
    ok('the next page follows the first, in order', two && same(ids, lib.newest.slice(0, PAGE * 2)), `${ids.length} drawn`);
    const kept = await page.evaluate(() => ({ text: document.getElementById('refB').value, card: document.querySelector('.ref-card').dataset.kept || null }));
    ok('the note being typed is still in the form, and the first card is the card that was there, not a copy', kept.text === 'half a note, typed before the next page' && kept.card === 'yes', JSON.stringify(kept));
    const p1 = await pager();
    ok('the button counts down', !!p1 && p1.left === `${TOTAL - PAGE * 2} more in your library`, JSON.stringify(p1));
    for (let i = 0; i < Math.ceil(TOTAL / PAGE) + 1 && await pager(); i++) { await clickPager(); await quiet(page); }
    const all = await drawnIds();
    ok('the last page takes the button away, and every note is drawn once', !(await pager()) && all.length === TOTAL && new Set(all).size === TOTAL, `${all.length} of ${TOTAL}, ${new Set(all).size} distinct`);
  }

  head('a figure keeps its room while it loads');
  {
    /* A figure written without a size has no room until it decodes, so it, and the card round it, grew as it arrived:
       cards of 345 px became 418 under a scrolling finger. tests/_figroom.js puts a drawn figure back as a fresh <img>,
       with the attributes the page wrote, and holds its picture back. */
    // Use a public image and note so this check does not depend on which
    // licensed notes happen to occupy the first page of the library.
    // The temporary note is removed before the remaining library checks.
    const image = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'echo', 'four-chamber.jpg')).toString('base64');
    await page.evaluate(image => {
      REF_IMGS['test-figure.jpg'] = image;
      REF.push({ id: 'test-figure-note', title: 'Test figure', body: '![Test figure](refimg://test-figure.jpg)', tags: [], ts: Date.now() });
    }, image);
    await toLibrary('test-figure-note');
    await page.waitForFunction(() => { const img = document.querySelector('.ref-card .ref-fig img'); return img && img.complete; });
    const sized = await page.evaluate(() => [...document.querySelectorAll('.ref-card .ref-fig img')].filter(x => x.complete && x.naturalWidth)
      .map(x => [x.getAttribute('width'), x.getAttribute('height'), x.naturalWidth, x.naturalHeight]));
    ok('each figure drawn is written with its own width and height', sized.length > 0 && sized.every(([w, h, nw, nh]) => w === String(nw) && h === String(nh)),
       `${sized.length} figures; ` + JSON.stringify(sized.find(([w, h, nw, nh]) => w !== String(nw) || h !== String(nh)) || sized[0]));
    const room = await heldRoom(page, '.ref-card .ref-fig img');
    ok('a figure has the room while it is loading that it takes once it has loaded', keptRoom(room), roomSaid(room));
    await page.evaluate(() => { REF = REF.filter(r => r.id !== 'test-figure-note'); delete REF_IMGS['test-figure.jpg']; });
  }

  head('leaving, deleting, adding, and one note on its own');
  {
    await toLibrary();
    ok('a fresh visit is the first page again, not where the last visit ended', same(await drawnIds(), lib.newest.slice(0, PAGE)));
    await clickPager();
    await waitCards(PAGE * 2);
    await page.evaluate(() => goHome());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await toLibrary();
    ok('coming back from another screen starts at the first page', (await drawnIds()).length === PAGE);

    await clickPager();
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
    await clickPager();
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

  /* docs/ROADMAP.md, E2. The screen's buttons name actions, not inline handlers, which the page's ACTIONS table calls
     through one listener on the document (src/core/actions.js). The pager and Add note are pressed above through the
     real functions. The rest are tapped here, on a page of their own, with each function the table calls replaced by a
     recorder that the page's own scope is seen to find, so each tap must reach one call of its function, with nothing,
     and no other. What those functions then do is held in their own suites. A tap that cannot be made is a FAIL. */
  head('the library\'s other buttons, tapped');
  {
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 } }), p = watch(await context.newPage(), events, 'refs-taps');
    const tapErrors = []; p.on('pageerror', e => { errors.push(e.message); tapErrors.push(e.message); });
    await p.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await booted(p);
    const NAMES = ['refCancel', 'refImportText', 'refExport', 'goHome', 'goRefs'];
    const one = await p.evaluate(() => REF[0] && REF[0].id);
    const draw = (editing, viewing) => p.evaluate(([editing, viewing]) => { refEditing = editing; refViewing = viewing; S.screen = 'refs'; render(); }, [editing, viewing]);
    const set = await p.evaluate(names => {
      const ok = names.every(n => typeof window[n] === 'function');
      window.__taps = [];
      for (const n of names) window[n] = function () { window.__taps.push([n].concat([].slice.call(arguments))); };
      return { ok, reached: names.every(n => (0, eval)(n) === window[n]) };
    }, NAMES);
    ok('each function the buttons call is the page\'s, and the page finds its recorder by that name', set.ok && set.reached && !!one, JSON.stringify(set));
    const tap = async sel => { await p.evaluate(() => { window.__taps = []; });
      const made = await p.locator(sel).first().click({ timeout: 5000 }).then(() => true, () => false);
      return { made, taps: await p.evaluate(() => window.__taps) }; };
    await draw(one, null);
    await onScreen(p, 'refs', { marker: '.ref-new' }); await quiet(p);
    const rows = [
      [await tap('.ref-new button:has-text("Cancel")'), 'refCancel', 'with a note edited, Cancel stops editing'],
      [await tap('.ref-new button:has-text("Import")'), 'refImportText', 'Import reads a file'],
      [await tap('.ref-new button:has-text("Export notes")'), 'refExport', 'Export writes the notes'],
      [await tap('.ref-new button:has-text("Back")'), 'goHome', 'Back goes home'],
    ];
    await draw(null, one);
    await onScreen(p, 'refs', { marker: '.ref-btns .chip' }); await quiet(p);
    rows.push([await tap('.ref-btns .chip:has-text("Back to study")'), 'goHome', 'with one note looked at, Back to study goes home']);
    rows.push([await tap('.ref-btns .chip:has-text("Show all notes")'), 'goRefs', 'and Show all notes opens the whole library']);
    for (const [r, want, label] of rows) ok(label + ', by one call with nothing, and no other', r.made && JSON.stringify(r.taps) === JSON.stringify([[want]]), (r.made ? '' : 'the tap could not be made; ') + JSON.stringify(r.taps));
    ok('and nothing throws on that page', tapErrors.length === 0, tapErrors.slice(0, 3).join(' | '));
    await context.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
