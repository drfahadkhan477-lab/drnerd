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

  head('it fills the display, like an app');
  /* Added to the Home Screen, iPadOS gives a web app the whole screen and draws
     the status bar over it. The bar lived inside #app — a 960px reading
     measure, centred — so on a 1366px iPad it was a floating strip with 203px
     of page showing either side: a browser with the chrome hidden, not an app. */
  const chrome = await page.evaluate(() => {
    const bar = document.getElementById('navbar');
    const nav = document.querySelector('.nav');
    if (!bar || !nav) return null;
    const b = bar.getBoundingClientRect(), n = nav.getBoundingClientRect();
    return {
      barL: b.left, barR: b.right, vw: innerWidth,
      navL: n.left, navW: n.width,
      outsideApp: !document.getElementById('app').contains(nav),
      overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  });
  ok('the bar is outside the reading column', chrome && chrome.outsideApp);
  ok('and its colour reaches both edges of the display',
     chrome.barL <= 0 && chrome.barR >= chrome.vw, `${chrome.barL}–${chrome.barR} of ${chrome.vw}`);
  /* Full bleed must not mean full width: a wordmark alone in the far corner of
     a 1366px screen is not what a native app does either. */
  ok('while its contents keep the measure the page below it keeps',
     chrome.navW <= chrome.vw, `${Math.round(chrome.navW)}px in ${chrome.vw}px`);
  /* Fixed, not 100vw — 100vw counts the scrollbar and would add a sideways
     scroll on a desktop. */
  ok('and nothing spills sideways', chrome.overflow);

  /* env() cannot be given a value from a test, which is why the insets are
     named variables. Set a real one and the chrome must move: the colour stays
     welded to the top edge, the contents step below the clock, and the screen
     starts below all of it. */
  const inset = await page.evaluate(() => {
    document.documentElement.style.setProperty('--sat', '24px');
    return new Promise(r => setTimeout(() => {
      const b = document.getElementById('navbar').getBoundingClientRect();
      const n = document.querySelector('.nav').getBoundingClientRect();
      const app = document.getElementById('app').getBoundingClientRect();
      document.documentElement.style.removeProperty('--sat');
      r({ barTop: b.top, barH: b.height, navTop: n.top, appTop: app.top });
    }, 200));
  });
  ok('with a status bar, the colour still starts at the very top', inset.barTop <= 0.5, `${inset.barTop}px`);
  ok('the bar grows by exactly the inset', inset.barH >= 58 + 24 - 1, `${Math.round(inset.barH)}px`);
  ok('its contents clear the clock', inset.navTop >= 23.5, `${Math.round(inset.navTop)}px`);
  ok('and the screen begins below the bar', inset.appTop >= inset.barH - 1,
     `app at ${Math.round(inset.appTop)}, bar ${Math.round(inset.barH)}`);

  /* AND env() CANNOT TELL US ABOUT AN IPAD. iPadOS reports
     safe-area-inset-top: 0 for an installed web app, because a device with no
     notch has no geometrically unsafe area — yet the status bar is still drawn
     over the page, so the clock landed on the wordmark. Being installed is the
     fact that matters, and .installed on <html> carries it. */
  const home = await page.evaluate(() => {
    const read = () => {
      const bar = document.getElementById('navbar').getBoundingClientRect();
      const nav = document.querySelector('.nav').getBoundingClientRect();
      return { barH: bar.height, navTop: nav.top };
    };
    const inBrowser = read();
    document.documentElement.classList.add('installed');
    const installed = read();
    document.documentElement.classList.remove('installed');
    return { inBrowser, installed, tall: innerHeight >= 600 };
  });
  ok('in a browser tab nothing is reserved — the browser draws its own chrome',
     home.inBrowser.navTop < 1, `${home.inBrowser.navTop}px`);
  ok('but installed, the bar reserves the strip the status bar is drawn in',
     !home.tall || home.installed.navTop >= 23.5, `${home.installed.navTop}px`);
  ok('and grows rather than shifting, so the colour still meets the top edge',
     !home.tall || home.installed.barH > home.inBrowser.barH + 20,
     `${Math.round(home.inBrowser.barH)} → ${Math.round(home.installed.barH)}`);

  head('home says one thing, and the rest is behind a door');
  const homeShape = await page.evaluate(() => ({
    hero: !!document.querySelector('.hero-live #heroECG'),
    pearl: !!document.querySelector('.pearl-card'),
    pearlPV: !!document.querySelector('.pearl-card #pearlPV'),
    pearlCurrent: !!document.querySelector('.pearl-card #pearlCurrent'),
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
  /* The pressure-volume loop was a good drawing in a bad place — 104px pinned
     in the corner of the prose column. It is now a full-width ECG trace running
     behind the words, which is what the card wanted along its foot. */
  ok('the pearl carries a current of its own', homeShape.pearlCurrent);
  ok('and the corner loop it replaced is gone', homeShape.pearlPV === false);
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

  head('the home screen fills the iPad it is on');
  {
    /* MEASURED BEFORE THIS WAS BUILT, on 1366x1024: #app was capped at 960px —
       406px of dead space down the sides — and the four stacked blocks ran to
       1142px against a 1024px viewport, so it scrolled by 118px. Both numbers
       are asserted here, from the other side. */
    const settle = async () => {
      await page.evaluate(() => { window.__s = 0; window.__l = null; });
      await page.waitForFunction(() => {
        const a = document.getElementById('app');
        const r = a.getBoundingClientRect();
        const k = [innerWidth, innerHeight, Math.round(r.width), Math.round(r.height)].join(',');
        window.__s = (window.__l === k) ? (window.__s || 0) + 1 : 0;
        window.__l = k;
        return window.__s >= 5;
      }, { timeout: 15000, polling: 'raf' });
    };
    const at = async (w, h) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(([w, h]) =>
        Math.abs(innerWidth - w) <= 2 && Math.abs(innerHeight - h) <= 2, [w, h], { timeout: 8000 });
      await page.evaluate(() => { goHome(); render(); });
      await settle();
      return page.evaluate(() => {
        const app = document.getElementById('app');
        const R = s => { const el = document.querySelector(s); if (!el) return null;
          const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height) }; };
        return { appW: Math.round(app.getBoundingClientRect().width), vw: innerWidth,
                 over: document.documentElement.scrollHeight - innerHeight,
                 screen: app.dataset.screen,
                 hero: R('.hero-live'), pearl: R('.pearl-card'), doors: R('.door-row') };
      });
    };

    const pro = await at(1366, 1024);
    ok('the shell says which screen it is showing', pro.screen === 'home', String(pro.screen));
    ok('a landscape iPad Pro uses its whole width',
       pro.appW / pro.vw > 0.9, `${pro.appW} of ${pro.vw}`);
    ok('and the home screen fits in one screen, with nothing to scroll',
       pro.over <= 0, `${pro.over}px over`);
    ok('the pearl sits beside the hero rather than under it',
       pro.pearl.x > pro.hero.x + pro.hero.w - 4, `pearl x${pro.pearl.x} vs hero right ${pro.hero.x + pro.hero.w}`);
    ok('and it runs taller than the letterbox it used to be',
       pro.pearl.h > 400, `${pro.pearl.h}px tall`);
    ok('the doors span the full width underneath',
       pro.doors.w / pro.vw > 0.85 && pro.doors.y > pro.hero.y, `${pro.doors.w} wide`);

    const air = await at(1194, 834);
    ok('an 11-inch iPad in landscape fits too',
       air.over <= 0 && air.appW / air.vw > 0.9, `${air.appW}/${air.vw}, ${air.over}px over`);

    /* PORTRAIT MUST NOT MOVE. It already fitted, and a second layout for it
       would be change for its own sake. */
    const port = await at(1024, 1366);
    ok('portrait still stacks, and still fits',
       port.over <= 0 && port.pearl.x < port.hero.x + 40, `pearl x${port.pearl.x}`);
    ok('and its column is a fixed measure, not the width of whatever pearl was picked',
       port.appW === 960, `${port.appW}px`);

    /* THE ONE THAT WOULD QUIETLY RUIN THE APP. The reading measure exists so a
       vignette is readable; widening the home screen must not widen a stem. */
    await page.setViewportSize({ width: 1366, height: 1024 });
    const quiz = await page.evaluate(() => {
      const q = ALL_Q.find(x => !x.bad);
      jumpTo(q.id); render();
      const app = document.getElementById('app');
      return { w: Math.round(app.getBoundingClientRect().width), screen: app.dataset.screen };
    });
    ok('a question stem keeps its reading measure on the same wide screen',
       quiz.screen === 'quiz' && quiz.w <= 980, `${quiz.w}px on ${quiz.screen}`);
    await page.evaluate(() => { goHome(); render(); });
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
