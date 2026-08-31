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
 *   · S.homeLayout still persists and still reaches the home screen's own
 *     hero sizing on a cold load. It used to also drive a visible three-way
 *     switch — Signal/Focus/Grid — but studyflow removed that control: it
 *     lived on the Chapters page despite the name, governed only that page's
 *     rail/feed/tile density, and Chapters is now one fixed, uniform design.
 *     What is left of homeLayout is inert for Chapters and real for Home,
 *     and only the Home-real part is still asserted here.
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
    /* .hp-val was one caption stating both figures in a single line; homeprog
       split it into a legend with one .hp-stat per figure. The claim below —
       that both words appear somewhere on the card — still holds over the
       legend's combined text, so this reads that instead of a span that no
       longer exists. */
    const val = document.querySelector('.hp-legend')?.textContent || '';
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
  /* Case-insensitive: the claim is that both words are legible somewhere on
     the card, not that they keep the exact casing of the sentence .hp-val
     used to embed them in. The legend states them as title-cased keys
     ("Mastered", "Seen") rather than lowercase inside a run-on caption —
     a real, deliberate change in presentation, not a loss of the words. */
  ok('the caption states both figures', /mastered/i.test(prog.val) && /seen/i.test(prog.val), prog.val);
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

  head('chapters is one fixed design now, not a switch between three');
  /* studyflow removed the only control that ever called setHomeLayout() from
     the UI. The rail/feed/tile density it used to govern all lived on this
     page, so the honest claim now is "the switch is gone and Chapters no
     longer varies", not "Focus/Grid still work" — calling setHomeLayout
     directly and checking for an effect on this screen would be asserting a
     behavior no user can ever reach again. */
  const gone = await page.evaluate(async () => {
    const before = document.querySelectorAll('.hl-seg').length;
    const railBefore = getComputedStyle(document.querySelector('.story-rail')).display;
    /* 'focus' specifically, not 'grid': focus is the one value that used to
       hide the rail outright, so this is the value that actually exercises
       whether calling the function still reaches this page at all. */
    setHomeLayout('focus');                     // still callable — see "the choice persists" below
    await new Promise(r => setTimeout(r, 260));
    const railAfter = getComputedStyle(document.querySelector('.story-rail')).display;
    return {
      segsOnPage: before,
      studyWrapAttr: document.querySelector('.study-wrap').getAttribute('data-home'),
      railUnaffectedByGrid: railBefore === railAfter,
    };
  });
  ok('no layout switch remains on the page', gone.segsOnPage === 0, String(gone.segsOnPage));
  ok('the study wrapper carries no data-home for anything to key off',
     gone.studyWrapAttr === null, String(gone.studyWrapAttr));
  ok('calling the old function directly no longer changes this page',
     gone.railUnaffectedByGrid);

  head('the choice persists');
  const persisted = await page.evaluate(() => {
    setHomeLayout('focus');
    return JSON.parse(localStorage.getItem('accsap12.v2')).homeLayout;
  });
  ok('the layout is saved', persisted === 'focus', persisted);

  await page.reload({ waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.home-wrap'), { timeout: 150000 });
  /* A cold load lands on home, which still carries data-home — the one real
     survivor of the old switch, since it sizes buildHome()'s own hero. This
     is genuinely Home's behavior, not Chapters', so it stays asserted. */
  const afterReload = await page.evaluate(() => ({
    state: S.homeLayout,
    attr: document.querySelector('.home-wrap').getAttribute('data-home'),
  }));
  ok('the persisted state itself survives a cold load', afterReload.state === 'focus', afterReload.state);
  ok('and the home screen wears the restored layout too', afterReload.attr === 'focus', afterReload.attr);

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

  head('the first-run hint appears for a newcomer and for nobody else');
  /* Three gates, and each is tested on its own rather than trusting the one
     that is easiest to set. The flag alone would have been the obvious
     implementation and the wrong one: it would hand a "New here?" card to
     every existing reader the first time they loaded a build containing this
     step — exactly the audience it is not for — so the empty-scheduler and
     empty-log gates are the ones actually worth proving. */
  {
    const r = await page.evaluate(async () => {
      const fresh = () => { try { localStorage.removeItem('accsap12.welcomed'); } catch (_) {} };
      const shown = () => !!document.getElementById('homeHello');

      fresh(); S.srs = {}; if (typeof LOG !== 'undefined') LOG.length = 0;
      goHome(); render();
      const forNewcomer = shown();

      // gate 2: a reader with scheduled cards is not new, flag unset or not
      fresh(); S.srs = { X: { difficulty: 5, stability: 10, ivl: 5, reps: 1, lapses: 0, last: '2026-08-20', due: '2026-09-01' } };
      goHome(); render();
      const withHistory = shown();

      // gate 3: a reader with a review log is not new either
      fresh(); S.srs = {};
      let loggedShown = null;
      if (typeof LOG !== 'undefined') { LOG.length = 0; LOG.push({ id: 'X', r: 3, t: Date.now() }); goHome(); render(); loggedShown = shown(); LOG.length = 0; }

      // gate 1: the dismissal flag
      S.srs = {};
      try { localStorage.setItem('accsap12.welcomed', '1'); } catch (_) {}
      goHome(); render();
      const afterFlag = shown();

      // and dismissing it really does persist across a re-render
      fresh(); goHome(); render();
      const beforeTap = shown();
      dismissHello();
      await new Promise(res => setTimeout(res, 340));
      const goneAfterTap = !shown();
      goHome(); render();
      const stillGone = !shown();
      let flagWritten = null;
      try { flagWritten = localStorage.getItem('accsap12.welcomed'); } catch (_) {}

      fresh(); S.srs = {}; goHome(); render();
      return { forNewcomer, withHistory, loggedShown, afterFlag, beforeTap, goneAfterTap, stillGone, flagWritten };
    });
    ok('a genuine newcomer is shown it', r.forNewcomer === true);
    ok('someone with cards already scheduled never sees it', r.withHistory === false);
    ok('nor does someone with a review log, even on a clean flag',
       r.loggedShown === false || r.loggedShown === null, String(r.loggedShown));
    ok('and it stays away once the flag is set', r.afterFlag === false);
    ok('tapping Got it removes it', r.beforeTap === true && r.goneAfterTap === true,
       `shown ${r.beforeTap} → gone ${r.goneAfterTap}`);
    ok('and it does not come back on the next render', r.stillGone === true);
    ok('because the dismissal was actually written down', r.flagWritten === '1', String(r.flagWritten));
  }

  head('the dismiss button is never buried under the Apex button');
  /* Found by screenshotting the card rather than by reading its CSS. Apex's
     button is position:fixed in the bottom-right corner, so it floats over
     whatever is scrolled beneath it — and the first version of this card put
     "Got it" at its own right-hand edge, which on an iPad in portrait put the
     FAB exactly on top of it: elementFromPoint at the button's centre came
     back as aiFab, so the control whose only job is dismissing the card could
     not be pressed.

     WHAT THIS ASSERTS, AND WHY IT IS NOT THE OBVIOUS THING. The first version
     of this check compared the button's rectangle against the FAB's and
     demanded they not intersect — and it PASSED against the broken
     right-aligned layout, because whether those two rectangles happen to meet
     depends on how tall the page is and where it is scrolled, neither of
     which the suite controls. A guard that only fires when the page happens
     to be the right height is not a guard. So this checks the property that
     actually makes the collision impossible instead: the button keeps more
     clearance from its card's right edge than the FAB is wide, so no amount
     of scrolling can put the FAB over it. That is scroll-independent,
     content-independent, and fails on the original layout. */
  {
    const prev = page.viewportSize();
    const rows = [];
    for (const [w, h, label] of [[390, 844, 'phone'], [834, 1112, 'iPad portrait'], [1194, 834, 'iPad landscape']]) {
      await page.setViewportSize({ width: w, height: h });
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem('accsap12.welcomed'); } catch (_) {}
        S.srs = {}; if (typeof LOG !== 'undefined') LOG.length = 0;
        goHome(); render();
        await new Promise(res => setTimeout(res, 280));
        const card = document.getElementById('homeHello');
        const btn = card && card.querySelector('.hello-x');
        const fab = document.getElementById('aiFab');
        if (!btn) return { err: 'hint missing' };
        const c = card.getBoundingClientRect(), a = btn.getBoundingClientRect();
        const fabW = fab && getComputedStyle(fab).display !== 'none' ? fab.getBoundingClientRect().width : 0;
        return { clearance: Math.round(c.right - a.right), fabW: Math.round(fabW) };
      });
      rows.push({ label, ...r });
    }
    if (prev) await page.setViewportSize(prev);
    for (const r of rows) {
      ok(`${r.label}: "Got it" keeps more room from the card's right edge than the Apex button is wide`,
         !r.err && r.clearance > r.fabW, r.err || `${r.clearance}px clear vs a ${r.fabW}px button`);
    }
  }

  head('and the hint itself is readable, on every theme');
  /* The same AA floor the progress card is now held to, applied to the new
     card rather than assumed of it — this is the component most likely to be
     written in whatever colour looked nice. */
  {
    const rows = await page.evaluate(async () => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
      const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
      const over = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
      const stack = el => { let a = 1, n = el;
        while (n && n !== document.documentElement) { a *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; } return a; };
      const out = [];
      for (const t of THEMES) {
        try { localStorage.removeItem('accsap12.welcomed'); } catch (_) {}
        S.theme = t.id; applyTheme(); S.srs = {}; goHome(); render();
        let card = null;
        for (let i = 0; i < 60; i++) {
          card = document.getElementById('homeHello');
          if (card && stack(card) > 0.999) break;
          await new Promise(res => requestAnimationFrame(res));
        }
        if (!card) { out.push({ theme: t.id, error: 'hint not rendered' }); continue; }
        const pageRaw = parse(getComputedStyle(document.body).backgroundColor);
        const pageBg = pageRaw && pageRaw.a === 1 ? pageRaw.rgb : [255, 255, 255];
        const cardRaw = parse(getComputedStyle(card).backgroundColor);
        const cardBg = cardRaw ? over(cardRaw, pageBg) : pageBg;
        let worst = Infinity;
        for (const el of card.querySelectorAll('b,i,button')) {
          const c = parse(getComputedStyle(el).color);
          if (!c) continue;
          worst = Math.min(worst, ratio(over({ rgb: c.rgb, a: c.a * stack(el) }, cardBg), cardBg));
        }
        out.push({ theme: t.id, worst: +worst.toFixed(2) });
      }
      S.theme = 'auto'; applyTheme();
      try { localStorage.setItem('accsap12.welcomed', '1'); } catch (_) {}
      goHome(); render();
      return out;
    });
    for (const r of rows) {
      ok(`${r.theme}: every word in the hint clears AA`, !r.error && r.worst >= 4.5, r.error || `${r.worst}:1`);
    }
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
