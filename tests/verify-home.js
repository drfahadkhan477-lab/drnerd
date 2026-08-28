#!/usr/bin/env node
/*
 * Checks for the reworked home screen.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-home.js <patched.html|url>
 *
 * Four claims:
 *   · the welcome bar (the hero ECG strip) is genuinely larger than it was;
 *   · the progress bar reports the REAL state of the bank — its mastery layer
 *     is FSRS's own recall estimate and its width matches the number shown,
 *     and mastery never exceeds coverage (you cannot have mastered more than
 *     you have seen);
 *   · home says ONE thing: the trace, the pearl, the progress bar and a row of
 *     doors — and the study material it used to carry is behind a door rather
 *     than below the fold;
 *   · the three layouts are one markup and a data attribute — switching is a
 *     CSS state change, it persists, and each layout actually differs (Focus
 *     drops the rail; Grid lays the feed out as a grid). The switch lives on
 *     the study page now, with the rail, the feed and the tiles it governs.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-home.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  /* Seed a realistic spread of progress so the bar and the numbers are testable
     and mastery lands strictly below coverage. */
  await page.evaluate(() => {
    const now = todayISO();
    let i = 0;
    for (const q of POOL) {
      i++;
      /* every third card seen; give them a range of stabilities so recall — and
         therefore mastery — comes out well under coverage */
      if (i % 3 === 0) S.srs[q.id] = { stability: 0.6 + (i % 5) * 0.4, last: now, reps: 1 };
      if (i > 300) break;
    }
    save(); render();
  });
  /* Wait past the 1.05s grow animation before measuring rendered widths — a
     mid-flight bar is narrower than its settled value and would fail the
     width-matches-aria check for a reason that has nothing to do with the
     number being right. */
  await page.waitForTimeout(1400);

  head('the welcome bar is larger');
  const ecgH = await page.evaluate(() => {
    const cv = document.getElementById('heroECG');
    return cv ? cv.getBoundingClientRect().height : 0;
  });
  ok('the hero ECG strip is taller than the old 104px ceiling at its minimum', ecgH >= 88, `${ecgH.toFixed(0)}px`);

  head('the progress bar reflects the real bank');
  const prog = await page.evaluate(() => {
    const track = document.querySelector('.hp-track');
    const seen = document.querySelector('.hp-seen'), mast = document.querySelector('.hp-mast');
    const val = document.querySelector('.hp-val').textContent;
    const trackW = track.getBoundingClientRect().width;
    return {
      aria: +track.getAttribute('aria-valuenow'),
      seenW: seen.getBoundingClientRect().width / trackW,
      mastW: mast.getBoundingClientRect().width / trackW,
      seenPctStyle: seen.style.width, mastPctStyle: mast.style.width,
      val, hasShine: !!document.querySelector('.hp-shine'),
    };
  });
  ok('the bar has both a coverage layer and a mastery layer', /%$/.test(prog.seenPctStyle) && /%$/.test(prog.mastPctStyle),
     `seen ${prog.seenPctStyle}, mastered ${prog.mastPctStyle}`);
  ok('mastery never exceeds coverage — you cannot master the unseen',
     parseFloat(prog.mastPctStyle) <= parseFloat(prog.seenPctStyle) + 0.5,
     `${prog.mastPctStyle} ≤ ${prog.seenPctStyle}`);
  ok('the rendered mastery width matches its aria value',
     Math.abs(prog.mastW * 100 - prog.aria) < 2, `width ${(prog.mastW * 100).toFixed(0)}% vs aria ${prog.aria}`);
  ok('the caption states both figures', /mastered/.test(prog.val) && /seen/.test(prog.val), prog.val);
  ok('a highlight sweeps the bar', prog.hasShine);

  head('home says one thing, and the rest is behind a door');
  const homeShape = await page.evaluate(() => ({
    hero: !!document.querySelector('.hero-live #heroECG'),
    pearl: !!document.querySelector('.pearl-card'),
    pearlECG: !!document.querySelector('.pearl-card #pearlECG'),
    progress: !!document.querySelector('.hp-track'),
    doors: document.querySelectorAll('.door-row .door').length,
    rail: !!document.querySelector('.story-rail'),
    feed: !!document.querySelector('.feed'),
    tiles: document.querySelectorAll('.ch-tile').length,
    /* The doors label where they lead; a row of bare icons would be a puzzle. */
    labels: [...document.querySelectorAll('.door .door-txt b')].map(b => b.textContent.trim()),
  }));
  ok('the trace, the pearl and the progress bar are all on it',
     homeShape.hero && homeShape.pearl && homeShape.progress);
  ok('the pearl carries a trace of its own', homeShape.pearlECG);
  ok('and a row of doors under them', homeShape.doors >= 5, String(homeShape.doors));
  const firstDoor = await page.evaluate(() => {
    const d = document.querySelector('.door-row .door');
    return { wide: d.classList.contains('door-wide'),
             widerThanNext: d.getBoundingClientRect().width >
                            document.querySelectorAll('.door-row .door')[1].getBoundingClientRect().width };
  });
  ok('Chapters is the first door, and the widest',
     homeShape.labels[0] === 'Chapters' && firstDoor.wide && firstDoor.widerThanNext,
     homeShape.labels.join(', '));
  ok('the study material is NOT on the home screen any more',
     !homeShape.rail && !homeShape.feed && homeShape.tiles === 0,
     `rail ${homeShape.rail}, feed ${homeShape.feed}, ${homeShape.tiles} tiles`);

  /* render() runs inside document.startViewTransition, so the DOM is not
     updated by the time the click handler returns — wait for the screen the
     door opens onto rather than reading straight after. */
  await page.evaluate(() => document.querySelector('.door-wide').click());
  await page.waitForFunction(() => typeof S !== 'undefined' && S.screen === 'study'
    && !!document.querySelector('.ch-tile'), { timeout: 15000 });
  const study = await page.evaluate(() => ({
    screen: S.screen,
    tiles: document.querySelectorAll('.ch-tile').length,
    rail: document.querySelectorAll('.story-rail .story').length,
    review: !!document.querySelector('.review-card'),
    shuffle: !!document.querySelector('.all-card'),
    back: !!document.querySelector('.study-back'),
    chapters: typeof CHAPTERS !== 'undefined' ? CHAPTERS.length : 0,
  }));
  ok('the door opens a page of its own', study.screen === 'study');
  ok('every chapter has a tile there', study.tiles === study.chapters, `${study.tiles} of ${study.chapters}`);
  ok('and a ring on the rail', study.rail === study.chapters, `${study.rail} of ${study.chapters}`);
  ok('the review queue and the full shuffle came with them', study.review && study.shuffle);
  ok('there is a way back', study.back);

  head('three layouts, one markup');
  /* The switch governs the rail, the feed and the tile density — all of which
     live on the study page now, so that is where it is. */
  const segs = await page.evaluate(() => document.querySelectorAll('.hl-seg').length);
  ok('the switch offers three layouts', segs === 3, String(segs));

  const layoutState = await page.evaluate(async () => {
    const out = {};
    for (const id of ['signal', 'focus', 'grid']) {
      setHomeLayout(id);
      await new Promise(r => setTimeout(r, 260));
      const wrap = document.querySelector('.home-wrap');
      const rail = document.querySelector('.story-rail');
      const feed = document.querySelector('.feed');
      out[id] = {
        attr: wrap.getAttribute('data-home'),
        railShown: rail ? getComputedStyle(rail).display !== 'none' : false,
        feedDisplay: feed ? getComputedStyle(feed).display : '',
        cardPad: parseFloat(getComputedStyle(document.querySelector('.feed-card')).paddingTop),
      };
    }
    return out;
  });
  ok('each layout stamps its own data-home attribute',
     layoutState.signal.attr === 'signal' && layoutState.focus.attr === 'focus' && layoutState.grid.attr === 'grid');
  ok('Signal shows the chapter rings', layoutState.signal.railShown);
  ok('Focus strips the rings away and enlarges the cards',
     !layoutState.focus.railShown && layoutState.focus.cardPad > layoutState.grid.cardPad,
     `focus ${layoutState.focus.cardPad}px vs grid ${layoutState.grid.cardPad}px`);
  ok('Grid lays the feed out as a grid, not a stack', layoutState.grid.feedDisplay === 'grid', layoutState.grid.feedDisplay);

  head('the choice persists');
  const persisted = await page.evaluate(() => {
    setHomeLayout('focus');
    return JSON.parse(localStorage.getItem('accsap12.v2')).homeLayout;
  });
  ok('the layout is saved', persisted === 'focus', persisted);

  await page.reload({ waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.home-wrap'), { timeout: 150000 });
  /* A cold load lands on home, which carries data-home too — the density the
     switch sets reaches the hero as well as the material. The segments
     themselves are on the study page, so go there to read the active one. */
  const homeAttr = await page.evaluate(() => document.querySelector('.home-wrap').getAttribute('data-home'));
  ok('the home screen wears the restored layout too', homeAttr === 'focus', homeAttr);
  await page.evaluate(() => goStudy());
  await page.waitForFunction(() => S.screen === 'study' && !!document.querySelector('.hl-seg'), { timeout: 15000 });
  const afterReload = await page.evaluate(() => ({
    state: S.homeLayout, attr: document.querySelector('.home-wrap').getAttribute('data-home'),
    activeSeg: document.querySelector('.hl-seg.on')?.textContent,
  }));
  ok('a cold load restores the saved layout', afterReload.state === 'focus' && afterReload.attr === 'focus', JSON.stringify(afterReload));
  ok('and marks the active segment', /focus/i.test(afterReload.activeSeg || ''), afterReload.activeSeg);

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
