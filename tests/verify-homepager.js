#!/usr/bin/env node
/*
 * The home screen as three pages: Home, Brain and Labs, side by side, a swipe apart.
 *
 *   node tests/verify-homepager.js build/synthetic/systole.html
 *
 * The claims: Home holds the hero, the pearl and the progress bar and nothing else of the old doors; Brain holds the
 * gauge, a row per chapter and the study doors; Labs holds the Rhythm Lab, Echo and the Practice Lab. A horizontal swipe
 * lands on the next page; the tab bar's pill follows the finger (it is placed from the scroll position, so half a swipe
 * puts it half way); a tab, or an arrow key on the tab bar, glides to its page and lands on it; the pages that are off
 * the screen are inert, so Tab never walks into them; the page that was showing is the one that shows on the way back
 * from a lab; the screen is one screen tall, in landscape and in portrait; the chapter bars fill when Brain is first
 * seen; and turning the iPad keeps the page.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, quiet, settled, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-homepager.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
  const page = watch(await ctx.newPage(), events, '1180px');
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.dismiss());
  await watchTransitions(page);
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* A precondition, never the claim: the screen change has finished, and the pager is still (no glide, no scroll). */
  const still = async (label) => {
    await settled(page, () => !window.__vtLive && !!document.getElementById('homePager'), { label: label + ': the home screen' });
    await settled(page, () => { const p = document.getElementById('homePager'); const w = p.clientWidth;
      return !homeTween && Math.abs(p.scrollLeft / w - Math.round(p.scrollLeft / w)) < 0.01; }, { timeout: 8000, label: label + ': the pager to come to rest on a page' });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  const state = () => page.evaluate(() => {
    const p = document.getElementById('homePager'), w = p.clientWidth;
    const sel = [0, 1, 2].filter(i => document.getElementById('homeTab' + i).getAttribute('aria-selected') === 'true');
    return { f: p.scrollLeft / w, sel, homePage, inert: [0, 1, 2].map(i => !!document.getElementById('homePage' + i).inert),
      hidden: [0, 1, 2].map(i => document.getElementById('homePage' + i).getAttribute('aria-hidden') === 'true') };
  });
  const pillAt = () => page.evaluate(() => {
    const pill = document.querySelector('.home-tab-pill').getBoundingClientRect();
    return [0, 1, 2].map(i => document.getElementById('homeTab' + i).getBoundingClientRect())
      .map(t => ({ left: t.left, width: t.width })).concat([{ pill: pill.left, w: pill.width }]);
  });

  await page.evaluate(() => { homePage = 0; S.screen = 'home'; render(); });
  await still('first render');

  head('three pages, each with its own things');
  const parts = await page.evaluate(() => {
    const p = i => document.getElementById('homePage' + i);
    return {
      pages: document.querySelectorAll('#homePager > .home-page').length,
      tabs: [...document.querySelectorAll('.home-tabs [role="tab"]')].map(t => t.textContent.trim()),
      home: { hero: !!p(0).querySelector('.hero-live'), pearl: !!p(0).querySelector('#pearlCard'), prog: !!p(0).querySelector('#homeProgress'),
        doors: p(0).querySelectorAll('.door').length },
      brain: { gauge: !!p(1).querySelector('.brain-gauge'), rows: p(1).querySelectorAll('.brain-ch').length, chapters: CHAPTERS.length,
        doors: [...p(1).querySelectorAll('.door b')].map(b => b.textContent) },
      labs: [...p(2).querySelectorAll('.lab-card')].map(c => c.getAttribute('onclick')),
    };
  });
  ok('there are three pages and three tabs: Home, Brain, Labs', parts.pages === 3 && parts.tabs.join('|') === 'Home|Brain|Labs', parts.pages + ' pages; ' + parts.tabs.join(' · '));
  ok('Home holds the hero, the pearl and the progress bar, and no doors', parts.home.hero && parts.home.pearl && parts.home.prog && parts.home.doors === 0, JSON.stringify(parts.home));
  ok('Brain holds the gauge and a row for every chapter', parts.brain.gauge && parts.brain.rows === parts.brain.chapters && parts.brain.rows > 0, `${parts.brain.rows} rows for ${parts.brain.chapters} chapters`);
  ok('and the study doors, Chapters first', parts.brain.doors[0] === 'Chapters' && ['Search', 'Progress', 'Notes', 'Memory', 'Annotations'].every(d => parts.brain.doors.includes(d)), parts.brain.doors.join(' · '));
  ok('Labs holds the Rhythm Lab, Echo and the Practice Lab', parts.labs.join('|') === 'goLab()|goEcho()|goPractice()', parts.labs.join(' · '));

  head('one screen tall');
  const fits = async (label) => {
    const g = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, vh: innerHeight,
      pagerBottom: document.getElementById('homePager').getBoundingClientRect().bottom }));
    ok(`${label}: the screen does not scroll, the pages do`, g.doc <= g.vh + 1 && Math.abs(g.pagerBottom - g.vh) <= 1, JSON.stringify(g));
  };
  await fits('landscape');

  head('a swipe');
  const s0 = await state();
  ok('it opens on Home, the one tab selected, the other pages inert and hidden', s0.sel.join() === '0' && s0.inert.join() === 'false,true,true' && s0.hidden.join() === 'false,true,true', JSON.stringify(s0));
  /* A horizontal wheel on the pager is the trackpad's swipe; the snap carries it to a page. */
  const box = await page.locator('#homePager').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.wheel(Math.round(box.width * 0.6), 0);
  await still('after a swipe');
  const s1 = await state();
  ok('a swipe to the left lands on Brain', Math.abs(s1.f - 1) < 0.01 && s1.sel.join() === '1' && s1.homePage === 1, JSON.stringify(s1));
  ok('and Brain is now the live page, Home inert', s1.inert.join() === 'true,false,true' && s1.hidden.join() === 'true,false,true', s1.inert.join());
  const p1 = await pillAt();
  ok('the pill sits on the Brain tab', Math.abs(p1[3].pill - p1[1].left) <= 2, `pill at ${p1[3].pill.toFixed(1)}, Brain tab at ${p1[1].left.toFixed(1)}`);

  head('the pill follows the finger');
  /* Half a page, held there (the snap lifted so it stays): the pill is half way between the two tabs. */
  const half = await page.evaluate(() => new Promise(r => {
    const p = document.getElementById('homePager'); p.style.scrollSnapType = 'none'; p.scrollLeft = p.clientWidth * 1.5;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const pill = document.querySelector('.home-tab-pill').getBoundingClientRect().left;
      const a = document.getElementById('homeTab1').getBoundingClientRect().left, b = document.getElementById('homeTab2').getBoundingClientRect().left;
      p.style.scrollSnapType = ''; r({ pill, a, b });
    }));
  }));
  ok('half a swipe from Brain to Labs puts the pill half way', Math.abs(half.pill - (half.a + half.b) / 2) <= 3, `pill ${half.pill.toFixed(1)}, half way ${((half.a + half.b) / 2).toFixed(1)}`);
  await page.evaluate(() => homeGo(1));
  await still('back on Brain');

  head('the tabs, by touch and by key');
  await page.locator('#homeTab2').click();
  const glide = await page.evaluate(() => ({ moving: !!homeTween }));
  await still('after the Labs tab');
  const s2 = await state();
  ok('the Labs tab glides there rather than jumping', glide.moving, JSON.stringify(glide));
  ok('and lands on Labs', Math.abs(s2.f - 2) < 0.01 && s2.sel.join() === '2', JSON.stringify(s2));
  await page.locator('#homeTab2').focus();
  await page.keyboard.press('ArrowLeft');
  await still('after ArrowLeft');
  const k = await page.evaluate(() => ({ f: document.getElementById('homePager').scrollLeft / document.getElementById('homePager').clientWidth,
    focus: document.activeElement && document.activeElement.id }));
  ok('ArrowLeft on the tab bar goes to Brain and takes the focus with it', Math.abs(k.f - 1) < 0.01 && k.focus === 'homeTab1', JSON.stringify(k));
  const tabStop = await page.evaluate(() => [0, 1, 2].map(i => document.getElementById('homeTab' + i).tabIndex).join());
  ok('only the selected tab is a tab stop', tabStop === '-1,0,-1', tabStop);

  head('Brain fills when it is seen');
  /* Some cards reviewed today, so the chapter they are in has a mastery to show. */
  await page.evaluate(() => {
    const t = todayISO(), ch = CHAPTERS[0];
    POOL.filter(q => q.ch === ch).slice(0, 6).forEach(q => { S.srs[q.id] = { stability: 20, difficulty: 5, reps: 2, last: t, due: addDays(t, 10) }; });
    homePage = 0; S.screen = 'home'; render();
  });
  await still('home with a reviewed chapter');
  const before = await page.evaluate(() => { const b = document.querySelector('#homePage1 .brain-bar i'); return { w: b.style.width, data: +b.dataset.w }; });
  await page.evaluate(() => homeGo(1));
  await still('Brain after the reviews');
  await settled(page, () => { const b = document.querySelector('#homePage1 .brain-bar i'); return !!b.style.width; }, { timeout: 3000, label: 'the first bar to be given its width' }).catch(() => {});
  const after = await page.evaluate(() => { const b = document.querySelector('#homePage1 .brain-bar i'); const m = document.querySelector('#homePage1 .bg-mast');
    return { w: b.style.width, data: +b.dataset.w, ring: m.style.strokeDasharray, on: m.classList.contains('is-on'), frac: m.dataset.frac }; });
  ok('a chapter bar is empty while Brain is off to the side', !before.w && before.data > 0, JSON.stringify(before));
  ok('and filled to the chapter\'s mastery once Brain is seen', after.w === after.data + '%', JSON.stringify(after));
  ok('the gauge is drawn to the bank\'s mastery', after.on === (+after.frac > 0) && parseFloat(after.ring) === +(+after.frac).toFixed(1), JSON.stringify(after));

  head('the page is kept');
  await page.evaluate(() => homeGo(2));
  await still('Labs before a lab');
  await page.locator('#homePage2 .lab-rhythm').click();
  await settled(page, () => S.screen === 'lab' && !window.__vtLive, { label: 'the Rhythm Lab' });
  const inLab = await page.evaluate(() => S.screen);
  await page.evaluate(() => goHome());
  await still('home again');
  const back = await state();
  ok('the Rhythm Lab card opens the Rhythm Lab', inLab === 'lab', inLab);
  ok('and on the way back, Labs is the page showing', Math.abs(back.f - 2) < 0.01 && back.sel.join() === '2', JSON.stringify(back));
  for (const [cls, want] of [['lab-echo', 'echo'], ['lab-practice', 'practice']]) {
    await page.locator('#homePage2 .' + cls).click();
    await settled(page, (w) => S.screen === w && !window.__vtLive, { arg: want, label: want });
    const on = await page.evaluate(() => S.screen);
    ok(`the ${cls.slice(4)} card opens ${want}`, on === want, on);
    await page.evaluate(() => goHome()); await still('home after ' + want);
  }
  await page.evaluate(() => homeGo(1)); await still('Brain for a chapter');
  const chq = await page.evaluate(() => { const b = document.querySelector('#homePage1 .brain-ch'); const name = b.querySelector('b').textContent; b.click();
    return { name, screen: S.screen, chs: [...new Set((S.questions || []).map(q => q.ch))] }; });
  ok('a chapter row starts that chapter\'s questions', chq.screen === 'quiz' && chq.chs.length === 1 && chq.chs[0] === chq.name, JSON.stringify(chq));
  await settled(page, () => !window.__vtLive, { label: 'the quiz' });
  await page.evaluate(() => goHome()); await still('home after a chapter');

  head('turning the iPad');
  await page.evaluate(() => homeGo(1)); await still('Brain before turning');
  await page.setViewportSize({ width: 820, height: 1180 });
  await settled(page, () => document.getElementById('homePager').clientWidth === innerWidth && innerWidth === 820, { label: 'the pager to take the portrait width' });
  await still('after turning');
  const turned = await state();
  ok('turned to portrait, Brain is still the page', Math.abs(turned.f - 1) < 0.01 && turned.sel.join() === '1', JSON.stringify(turned));
  await fits('portrait');

  head('reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const jump = await page.evaluate(() => { homeGo(0); const p = document.getElementById('homePager'); return { f: p.scrollLeft / p.clientWidth, tween: !!homeTween }; });
  ok('with reduced motion a tab jumps to its page, no glide', Math.abs(jump.f) < 0.01 && !jump.tween, JSON.stringify(jump));
  const still2 = await page.evaluate(() => getComputedStyle(document.querySelector('#homePage1 .home-page-in')).transform);
  ok('and the pages are not scaled as they leave', still2 === 'none', still2);

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
