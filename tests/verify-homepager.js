#!/usr/bin/env node
/*
 * The home screen as three pages: Home, Brain and Labs, side by side, a swipe apart.
 *
 *   node tests/verify-homepager.js build/synthetic/systole.html
 *
 * The claims: Home holds the hero and the pearl, and nothing else (the progress bar is gone, and the doors); Brain holds
 * the gauge, a row per chapter and the brain, which is live while it shows, turns, and runs at Systole's own rates; Labs
 * holds the Rhythm Lab, Echo and the Practice Lab, and under them the study doors. A horizontal swipe
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
    // Long renderer probes can cross the idle threshold; wake through real input before navigating.
    await page.keyboard.press('Shift');
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
      .map(t => ({ left: innerWidth>=700?t.top:t.left, width: innerWidth>=700?t.height:t.width })).concat([{ pill: innerWidth>=700?pill.top:pill.left, w: innerWidth>=700?pill.height:pill.width }]);
  });

  await page.evaluate(() => { homePage = 0; S.screen = 'home'; render(); });
  await still('first render');
  head('the selected Home invitation');
  await require('./_atlas-landing')(page,ok,settled);
  await still('after invitation actions');

  head('three pages, each with its own things');
  const parts = await page.evaluate(() => {
    const p = i => document.getElementById('homePage' + i);
    return {
      pages: document.querySelectorAll('#homePager > .home-page').length,
      tabs: [...document.querySelectorAll('.home-tabs [role="tab"]')].map(t => t.textContent.trim()),
      home: { hero: !!p(0).querySelector('.hero-live'), pearl: !!p(0).querySelector('#pearlCard'), prog: !!document.getElementById('homeProgress'),
        doors: p(0).querySelectorAll('.door').length },
      brain: { gauge: !!p(1).querySelector('.brain-gauge'), rows: p(1).querySelectorAll('.brain-ch').length, chapters: CHAPTERS.length,
        doors: p(1).querySelectorAll('.door').length },
      labs: [...p(2).querySelectorAll('.lab-card')].map(c => c.getAttribute('onclick')),
      labDoors: [...p(2).querySelectorAll('.door b')].map(b => b.textContent),
      after: (() => { const c = p(2).querySelectorAll('.lab-card'), d = p(2).querySelector('.door'); return !!(c.length && d && (c[c.length - 1].compareDocumentPosition(d) & 4)); })(),
    };
  });
  ok('there are three pages and three tabs: Home, Brain, Labs', parts.pages === 3 && parts.tabs.join('|') === 'Home|Brain|Labs', parts.pages + ' pages; ' + parts.tabs.join(' · '));
  ok('Home holds the hero and the pearl, no progress bar and no doors', parts.home.hero && parts.home.pearl && !parts.home.prog && parts.home.doors === 0, JSON.stringify(parts.home));
  ok('Brain holds the gauge and a row for every chapter, and no doors', parts.brain.gauge && parts.brain.rows === parts.brain.chapters && parts.brain.rows > 0 && parts.brain.doors === 0,
     `${parts.brain.rows} rows for ${parts.brain.chapters} chapters, ${parts.brain.doors} doors`);
  ok('Labs holds the Rhythm Lab, Echo and the Practice Lab', parts.labs.join('|') === 'goLab()|goEcho()|goPractice()', parts.labs.join(' · '));
  ok('and under them the study tools, Chapters first', parts.after && parts.labDoors[0] === 'Chapters' && ['Search', 'Progress', 'Notes', 'Memory', 'Annotations'].every(d => parts.labDoors.includes(d)),
     parts.labDoors.join(' · ') + (parts.after ? '' : ' (not under the labs)'));

  head('one screen tall');
  /* Tablet navigation follows the selected left-rail design; phones retain bottom tabs. */
  const fits = async (label) => {
    const g = await page.evaluate(() => { const r = e => e.getBoundingClientRect();
      const tabs = r(document.querySelector('.home-tabs')), pager = r(document.getElementById('homePager')), fab = r(document.getElementById('aiFab'));
      const buttons=[...document.querySelectorAll('.home-tab')].map(r);
      /* WHICH WAY THE RAIL SITS IS READ OFF THE SCREEN, not from the 700px the script uses. Asking
         innerWidth>=700 for the answer asks the implementation to mark its own paper: homeMark() and
         homeTabKey() both carry that literal, the stylesheet carries it in seven media queries, and
         nothing binds the two. Move the stylesheet's breakpoint alone and the rail would sit under the
         pages while aria-orientation still said vertical and the arrow keys still ran up and down.
         Beside the pages is a rail; under them is a bar. */
      const besidePages = tabs.right <= pager.left + 1;
      return { doc: document.documentElement.scrollHeight, vh: innerHeight, besidePages,
        placement: besidePages ? tabs.left>=0 && tabs.top>=0 && tabs.bottom<=innerHeight
          : pager.bottom<=tabs.top && Math.abs(innerHeight-12-tabs.bottom)<=1,
        orientation: document.querySelector('.home-tabs').getAttribute('aria-orientation'),
        wanted: besidePages?'vertical':'horizontal',

        fabClear:buttons.every(t=>fab.right<=t.left||fab.left>=t.right||fab.bottom<=t.top||fab.top>=t.bottom) };
    });
    ok(`${label}: the screen does not scroll, the pages do`,g.doc<=g.vh+1,JSON.stringify(g));
    ok(`${label}: navigation fits its viewport and declares its direction`,g.placement&&g.orientation===g.wanted,JSON.stringify(g));
    ok(`${label}: and the Apex button is clear of every tab`,g.fabClear,JSON.stringify(g));
  };
  await fits('landscape');
  /* ON THE BREAKPOINT ITSELF. Every other width here is hundreds of pixels clear of 700, so a
     stylesheet that moved its breakpoint and left the script behind would lay out and announce
     consistently at all of them and say nothing. These two sit either side of the line. */
  for (const w of [699, 701]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate(()=>homeGo(0,false)); await still('Home at the breakpoint');
    await fits(`${w}px, across the 700px breakpoint`);
  }
  await page.setViewportSize({width:1180,height:820});
  await page.evaluate(()=>homeGo(0,false)); await still('Home after the breakpoint pair');

  for (const size of [{width:1180,height:820},{width:834,height:1194},{width:1024,height:768}]) {
    await page.setViewportSize(size);
    for(let i=0;i<3;i++) {
      await page.evaluate(i=>homeGo(i,false),i); await still('tablet landing page');
      const g=await page.evaluate(i=>{const e=document.getElementById('homePage'+i);return {height:e.clientHeight,content:e.scrollHeight,width:e.clientWidth,contentWidth:e.scrollWidth};},i);
      ok(`${size.width}×${size.height}: landing page ${i} fits without clipping or page scrolling`,g.height>0&&g.content<=g.height+1&&g.contentWidth<=g.width+1,JSON.stringify(g));
      const headings=await page.evaluate(()=>[...document.querySelectorAll('.home-page:not([inert]) h1')].filter(h=>h.getClientRects().length).length);

      ok(`${size.width}×${size.height}: active landing page ${i} has one H1`,headings===1,String(headings));
    }
  }
  await page.setViewportSize({width:1180,height:820});
  await page.evaluate(()=>homeGo(0,false)); await still('Home after tablet sizes');
  await page.getByRole('button',{name:'Begin recall',exact:true}).click();
  await page.getByRole('button',{name:'Reveal',exact:true}).click();
  await page.getByRole('button',{name:'Explore heart in 3D',exact:true}).click();



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
  ok('the pill sits on the Brain tab', p1[1].left > p1[0].left && Math.abs(p1[3].pill - p1[1].left) <= 2, `pill at ${p1[3].pill.toFixed(1)}, Brain tab at ${p1[1].left.toFixed(1)}`);

  head('the pill follows the finger');
  /* Half a page, held there (the snap lifted so it stays): the pill is half way between the two tabs. */
  const half = await page.evaluate(() => new Promise(r => {
    const p = document.getElementById('homePager'); p.style.scrollSnapType = 'none'; p.scrollLeft = p.clientWidth * 1.5;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const pill = document.querySelector('.home-tab-pill').getBoundingClientRect().top;
      const a = document.getElementById('homeTab1').getBoundingClientRect().top, b = document.getElementById('homeTab2').getBoundingClientRect().top;
      p.style.scrollSnapType = ''; r({ pill, a, b });
    }));
  }));
  ok('half a swipe from Brain to Labs puts the pill half way', half.b > half.a && Math.abs(half.pill - (half.a + half.b) / 2) <= 3, `pill ${half.pill.toFixed(1)}, half way ${((half.a + half.b) / 2).toFixed(1)}`);
  await page.evaluate(() => homeGo(1));
  await still('back on Brain');

  head('the tabs, by touch and by key');
  await page.locator('#homeTab2').click();
  /* Read from what homeGo chose, not from whether the glide is still running: a 420ms glide can be over by the time a
     loaded runner reads it, and the check then failed on the fixed build. */
  const glide = await page.evaluate(() => ({ moving: !!(homeLastGo && homeLastGo.to === 2 && homeLastGo.glide) }));
  await still('after the Labs tab');
  const hiddenHero = await page.evaluate(async () => {
    const cv=document.getElementById('pearlCurrent'), ctx=cv.getContext('2d'), clear=ctx.clearRect;
    let paints=0; ctx.clearRect=function(...a){paints++;return clear.apply(this,a);};
    const before=heroMon.t;
    await new Promise(resolve=>{let n=0;const tick=()=>++n<20?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);});
    ctx.clearRect=clear;
    return {paints,advance:heroMon.t-before};
  });
  ok('offscreen Home does not repaint its pearl or advance its ECG', hiddenHero.paints===0 && hiddenHero.advance===0, JSON.stringify(hiddenHero));
  const s2 = await state();
  ok('the Labs tab glides there rather than jumping', glide.moving, JSON.stringify(glide));
  ok('and lands on Labs', Math.abs(s2.f - 2) < 0.01 && s2.sel.join() === '2', JSON.stringify(s2));
  await page.locator('#homeTab2').focus();
  await page.keyboard.press('ArrowUp');
  await still('after ArrowUp');
  const k = await page.evaluate(() => ({ f: document.getElementById('homePager').scrollLeft / document.getElementById('homePager').clientWidth,
    focus: document.activeElement && document.activeElement.id }));
  ok('ArrowUp on the vertical tab bar goes to Brain and takes the focus with it', Math.abs(k.f - 1) < 0.01 && k.focus === 'homeTab1', JSON.stringify(k));
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

  head('the brain, drawn from the bank, and live');
  /* Memorizer's brain (src/core/brain.js): a lobe per chapter, a neuron per slice of its questions, each lit by what FSRS
     predicts of that slice today. Impulses run while Brain is the page showing, and stop when it is not. */
  const br = await page.evaluate(() => {
    const L = brainArtL && brainArtL.L, art = document.getElementById('brainArt');
    const want = CHAPTERS.reduce((n, ch) => { const k = POOL.filter(q => q.ch === ch).length; return n + Math.ceil(k / Math.max(1, Math.ceil(k / BRAIN_PER))); }, 0);
    /* every neuron's state against its own slice, worked out here again from the cards */
    const ch0 = CHAPTERS[0], qs = POOL.filter(q => q.ch === ch0), per = Math.max(1, Math.ceil(qs.length / BRAIN_PER));
    const first = qs.slice(0, per).map(qRecall).filter(v => v != null), avg = first.length ? first.reduce((a, b) => a + b, 0) / first.length : null;
    const wantState = avg == null ? 'new' : avg >= 0.85 ? 'solid' : avg >= 0.6 ? 'fading' : 'weak';
    const g = art && art.querySelector('.neuron[data-i="' + L.nodes.findIndex(x => x.docId === ch0 && x.ci === 0) + '"]');
    return { drawn: art ? art.querySelectorAll('.neuron').length : 0, want, lobes: L ? L.units.length : 0, chapters: CHAPTERS.length,
      wantState, shown: g && g.dataset.state, label: g && g.getAttribute('aria-label') };
  });
  ok('the brain has a lobe for every chapter and a neuron for every slice of its questions', br.drawn === br.want && br.lobes === br.chapters && br.drawn > 0,
     `${br.drawn} neurons (want ${br.want}), ${br.lobes} lobes for ${br.chapters} chapters`);
  ok('a neuron is lit by what is remembered of its slice', br.shown === br.wantState && br.wantState !== 'new' && /recall \d+% today/.test(br.label || ''), JSON.stringify(br));
  const f0 = await page.evaluate(() => brainLiveRun ? brainLiveRun.frames : -1);
  /* The claim is that the loop runs, not how fast: headless WebKit draws a few frames a second (3 to 13 in five seconds,
     measured), where a device draws thirty. */
  await settled(page, (f) => brainLiveRun && brainLiveRun.frames > f + 2 && brainLiveRun.st.fired > 0, { arg: f0, timeout: 5000, label: 'the brain to draw a few frames' }).catch(() => {});
  const f1 = await page.evaluate(() => ({ frames: brainLiveRun ? brainLiveRun.frames : -1, fired: brainLiveRun ? brainLiveRun.st.fired : 0 }));
  ok('while Brain is showing, the brain is live: impulses fire and it is redrawn', f1.frames > f0 + 2 && f1.fired > 0, `${f0} → ${f1.frames} frames, ${f1.fired} fired`);
  /* The turn: the brain sways on its axes, the light on the cortex moves as it turns, and the wiring slides against the
     tissue. Read twice, some frames apart: one reading cannot tell a turning brain from one set at an angle once. */
  const turnAt = () => page.evaluate(() => ({ frames: brainLiveRun ? brainLiveRun.frames : -1,
    tilt: (document.getElementById('brainTilt') || {}).style ? document.getElementById('brainTilt').style.transform : '',
    net: (document.getElementById('brainNet') || { getAttribute: () => '' }).getAttribute('transform') || '',
    light: (document.querySelector('#brainArt #sbTissue') || { getAttribute: () => '' }).getAttribute('cx') }));
  const t0 = await turnAt();
  await settled(page, (f) => brainLiveRun && brainLiveRun.frames > f + 3, { arg: t0.frames, timeout: 5000, label: 'more frames of the turn' }).catch(() => {});
  const t1 = await turnAt();
  const ang = t => { const m = /rotateY\((-?[\d.]+)deg\)/.exec(t.tilt); return m ? +m[1] : NaN; };
  ok('it turns: the brain is drawn at an angle that changes from frame to frame', Number.isFinite(ang(t0)) && Number.isFinite(ang(t1)) && t0.tilt !== t1.tilt,
     `${t0.tilt || 'none'} → ${t1.tilt || 'none'} (${t0.frames} → ${t1.frames} frames)`);
  ok('and the light and the wiring move with it', t0.light !== t1.light && /^translate\(/.test(t1.net) && t0.net !== t1.net, `light ${t0.light} → ${t1.light}, wiring ${t0.net} → ${t1.net}`);
  const tune = await page.evaluate(() => ({ run: brainLiveRun && brainLiveRun.st.live ? brainLiveRun.st.live.PASS['new'] : null, want: BRAIN_TUNE.PASS['new'], base: BrainMap.LIVE.PASS['new'] }));
  ok('and it runs at Systole\'s own rates, where an unseen neuron passes impulses on more often than in Memorizer', tune.run === tune.want && tune.want > tune.base,
     `passes on ${tune.run} (Systole ${tune.want}, Memorizer ${tune.base})`);
  /* Under a pointer it holds still: a neuron is a target, and one that never stops moving is a hard one to hit. The
     pointer is over the stage before it taps, as a real one is; the angle is read twice, frames apart. */
  await page.hover('#brain3d', { position: { x: 40, y: 40 } });
  const h0f = await page.evaluate(() => brainLiveRun.frames);
  /* Precondition: frames enough for the lean towards the pointer to land (a fifth of the way a frame, then exact within
     0.3 degrees: about twenty frames from the widest sway). */
  await settled(page, (f) => brainLiveRun && brainLiveRun.frames > f + 40, { arg: h0f, timeout: 20000, label: 'the brain to lean to the pointer' }).catch(() => {});
  const hA = await turnAt();
  await settled(page, (f) => brainLiveRun && brainLiveRun.frames > f + 4, { arg: hA.frames, timeout: 5000, label: 'frames under the pointer' }).catch(() => {});
  const hB = await turnAt();
  ok('under a pointer the brain holds still, so a neuron can be tapped', hB.frames > hA.frames && hA.tilt === hB.tilt && hA.net === hB.net && !!hA.tilt,
     `${hA.tilt} → ${hB.tilt} over ${hB.frames - hA.frames} frames`);
  await page.locator('#brainArt .neuron').nth(3).click();
  const tap = await page.evaluate(() => ({ sel: brainSel, info: document.getElementById('brainInfo').textContent.replace(/\s+/g, ' ').trim(),
    tapped: brainLiveRun && brainLiveRun.st.lastTap ? brainLiveRun.st.lastTap.i : null, pressed: document.querySelector('#brainArt .neuron[data-i="3"]').getAttribute('aria-pressed') }));
  ok('a tap fires the neuron and says what it holds', tap.sel === 3 && tap.tapped === 3 && tap.pressed === 'true' && /This neuron .+ questions \d+–\d+/.test(tap.info), JSON.stringify(tap));
  head('Brain rests under overlays and a changed motion preference');
  const brainWork = () => page.evaluate(async () => {
    const before=brainLiveRun.frames;
    await new Promise(resolve=>{let n=0;const tick=()=>++n<20?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);});
    return brainLiveRun.frames-before;
  });
  await page.evaluate(() => openFigure('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="gray"/></svg>'),'Brain overlay fixture','Test'));
  const brainFigure = await brainWork();
  ok('Brain does not redraw behind a full-screen figure', brainFigure===0, `${brainFigure} draws in 20 animation frames`);
  await page.evaluate(() => closePeek());
  const brainAfterFigure = await brainWork();
  ok('Brain resumes drawing when the figure closes', brainAfterFigure>2, `${brainAfterFigure} draws`);
  await page.evaluate(() => toggleApexFull());
  const brainApex = await brainWork();
  ok('Brain does not redraw behind full-screen Apex', brainApex===0, `${brainApex} draws in 20 animation frames`);
  await page.evaluate(() => toggleAI());
  const brainAfterApex = await brainWork();
  ok('Brain resumes drawing when full-screen Apex closes', brainAfterApex>2, `${brainAfterApex} draws`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const brainReduced = await brainWork();
  ok('enabling reduced motion stops an already-mounted Brain without a reload', brainReduced===0, `${brainReduced} draws in 20 animation frames`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const brainAfterMotion = await brainWork();
  ok('restoring motion resumes the already-mounted Brain', brainAfterMotion>2, `${brainAfterMotion} draws`);
  await page.evaluate(() => homeGo(0));
  await still('Home, leaving Brain');
  const stableTrace = await page.evaluate(async () => {
    const cv=document.getElementById('pearlCurrent'), ctx=cv.getContext('2d'), clear=ctx.clearRect;
    const wave=rhythmMV; let calls=0, paints=0;
    heroMon.stop();
    rhythmMV=(...a)=>{calls++;return wave(...a);};
    ctx.clearRect=function(...a){paints++;return clear.apply(this,a);};
    await new Promise(resolve=>{let n=0;const tick=()=>++n<20?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);});
    rhythmMV=wave;ctx.clearRect=clear;heroMon.start();
    return {calls,paints};
  });
  ok('the visible pearl keeps animating without recalculating its unchanged waveform', stableTrace.paints>2 && stableTrace.calls===0, JSON.stringify(stableTrace));
  head('full-screen overlays leave Home at rest');
  await page.evaluate(() => {
    window.__homeWork = async () => {
      const counts={pearl:0,ecg:0,heart:0}, undo=[];
      const pearl=document.getElementById('pearlCurrent')?.getContext('2d');
      const ecg=document.getElementById('heroECG')?.getContext('2d');
      const heart=document.getElementById('heroHeart3d')?.getContext('webgl2');
      const countPaint=(ctx,method,key)=>{ if(!ctx) return; const fn=ctx[method];
        ctx[method]=function(...args){counts[key]++;return fn.apply(this,args);}; undo.push(()=>{ctx[method]=fn;}); };
      countPaint(pearl,'clearRect','pearl'); countPaint(ecg,'stroke','ecg'); countPaint(heart,'clear','heart');
      try { await new Promise(r=>{let n=0;const f=()=>++n<20?requestAnimationFrame(f):r();requestAnimationFrame(f);}); }
      finally { undo.forEach(f=>f()); }
      return {...counts,hasPearl:!!pearl,hasECG:!!ecg,hasHeart:!!heart};
    };
  });
  const covered = v => v.hasPearl && v.hasECG && v.pearl===0 && v.ecg===0 && (!v.hasHeart || v.heart===0);
  const visible = v => v.hasPearl && v.hasECG && v.pearl>2 && v.ecg>2 && (!v.hasHeart || v.heart>2);
  const paused = await page.evaluate(async () => {
    document.getElementById('atlasPause')?.click();
    return {...await __homeWork(),label:document.getElementById('atlasPause')?.getAttribute('aria-label'),
      fallback:getComputedStyle(document.querySelector('.h-beat')).animationPlayState};
  });
  ok('Pause stops Home canvases and the CSS heart with a Play name',covered(paused)&&paused.label==='Play animation'&&paused.fallback==='paused',JSON.stringify(paused));
  await page.evaluate(()=>render());
  await still('paused Home remounted');
  await settled(page,()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect&&Number.isFinite(a.effect.getTiming().iterations)),{label:'Home entrance effects finished'});
  const pausedRemount=await page.evaluate(async()=>({...await __homeWork(),opacity:getComputedStyle(document.querySelector('.hero-h1')).opacity,
    label:document.getElementById('atlasPause')?.getAttribute('aria-label')}));
  ok('paused Home keeps its heading visible after remount',covered(pausedRemount)&&pausedRemount.opacity==='1'&&pausedRemount.label==='Play animation',JSON.stringify(pausedRemount));

  const resumed = await page.evaluate(async () => {
    document.getElementById('atlasPause')?.click();
    return {...await __homeWork(),label:document.getElementById('atlasPause')?.getAttribute('aria-label'),
      fallback:getComputedStyle(document.querySelector('.h-beat')).animationPlayState};
  });
  ok('Play resumes Home canvases and the CSS heart with a Pause name',visible(resumed)&&resumed.label==='Pause animation'&&resumed.fallback==='running',JSON.stringify(resumed));
  const figureWork = await page.evaluate(async () => {
    await openFigure('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="gray"/></svg>'),'Overlay fixture','Test');
    return {viewer:!!document.querySelector('.pswp'),...await __homeWork()};
  });
  ok('Home renderers stop behind the full-screen figure', figureWork.viewer && covered(figureWork), JSON.stringify(figureWork));
  const afterFigure = await page.evaluate(async () => { closePeek(); return __homeWork(); });
  ok('Home renderers resume after the figure is gone', visible(afterFigure), JSON.stringify(afterFigure));
  const apexWork = await page.evaluate(async () => { toggleApexFull(); return {full:apexIsFull(),...await __homeWork()}; });
  ok('Home renderers stop behind full-screen Apex', apexWork.full && covered(apexWork), JSON.stringify(apexWork));
  const afterApex = await page.evaluate(async () => { toggleAI(); return __homeWork(); });
  ok('Home renderers resume after full-screen Apex closes', visible(afterApex), JSON.stringify(afterApex));
  const h0 = await page.evaluate(() => brainLiveRun.frames);
  await page.evaluate(() => new Promise(r => { let n = 0; const f = () => (++n < 20 ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }));
  const h1 = await page.evaluate(() => brainLiveRun.frames);
  ok('and it rests while another page is showing', h1 === h0, `${h0} → ${h1} frames over 20 animation frames on Home`);

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
  await settled(page, () => document.getElementById('homePager').clientWidth === innerWidth - 80 && innerWidth === 820, { label: 'the pager to take the portrait width' });
  await still('after turning');
  const turned = await state();
  ok('turned to portrait, Brain is still the page', Math.abs(turned.f - 1) < 0.01 && turned.sel.join() === '1', JSON.stringify(turned));
  await fits('portrait');
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page, () => document.getElementById('homePager').clientWidth === 390, { label: 'the pager to take a phone\'s width' });
  await still('on a phone');
  await fits('a phone');
  await page.setViewportSize({ width: 820, height: 1180 });
  await settled(page, () => document.getElementById('homePager').clientWidth === 740, { label: 'the pager back at the portrait width' });
  await still('back in portrait');

  head('reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const jump = await page.evaluate(() => { homeGo(0); const p = document.getElementById('homePager'); return { f: p.scrollLeft / p.clientWidth, tween: !!homeTween || !!(homeLastGo && homeLastGo.glide) }; });
  ok('with reduced motion a tab jumps to its page, no glide', Math.abs(jump.f) < 0.01 && !jump.tween, JSON.stringify(jump));
  /* Brain is a whole page away (--hp-d 1), where the scale would be .94 without the reduced-motion rule. */
  const still2 = await page.evaluate(() => { const pg = document.getElementById('homePage1'); return pg.style.getPropertyValue('--hp-d') === '1.0000' ? getComputedStyle(pg.querySelector('.home-page-in')).transform : 'UNMEASURED: Brain is not a page away (--hp-d ' + pg.style.getPropertyValue('--hp-d') + ')'; });
  /* WebKit reports an unscaled element as the identity matrix rather than 'none'. */
  ok('and the pages are not scaled as they leave', still2 === 'none' || still2 === 'matrix(1, 0, 0, 1, 0, 0)', still2);
  await page.evaluate(() => { homePage = 1; S.screen = 'home'; render(); });
  await still('Brain with reduced motion');
  const rm = await page.evaluate(() => ({ run: brainLiveRun, art: !!document.getElementById('brainArt') }));
  ok('and the brain is drawn but not run', rm.art && rm.run === null, JSON.stringify({ art: rm.art, run: rm.run && rm.run.running }));

  head('long captions remain keyboard readable');
  await page.evaluate(()=>{homePage=0;S.screen='home';pearlCurrent=pearlAll().find(p=>p.figKey&&refImgSrc(p.figKey));render();});
  await still('caption reading');
  const compactHidden=await page.evaluate(()=>{const f=document.getElementById('pearlFig');f.querySelector('figcaption').textContent='Long caption for keyboard scrolling. '.repeat(60);pearlFit();return getComputedStyle(f).display==='none';});
  await page.evaluate(()=>pearlToggleAll());
  await still('expanded caption reading');
  const expandedFigure=await page.evaluate(()=>getComputedStyle(document.getElementById('pearlFig')).display!=='none');
  ok('Show all restores a figure hidden by the compact layout',compactHidden&&expandedFigure,JSON.stringify({compactHidden,expandedFigure}));
  if(expandedFigure){await page.locator('#pearlFig').focus();await page.keyboard.press('End');}

  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const captionScroll=await page.evaluate(()=>{const f=document.getElementById('pearlFig');return {overflow:f.scrollHeight-f.clientHeight,scroll:f.scrollTop};});
  ok('a long figure caption can be scrolled with the keyboard',captionScroll.overflow>0&&captionScroll.scroll>0,JSON.stringify(captionScroll));

  head('next session uses the actual due deck');
  await page.evaluate(()=>{S.srs={};homePage=0;S.screen='home';render();});
  await still('empty due deck');
  await page.locator('.atlas-session button').click();

  await settled(page,()=>!window.__vtLive,{label:'chapter action'});
  ok('with no due cards the next-session action opens Chapters',await page.evaluate(()=>S.screen==='study'));
  const wanted=await page.evaluate(()=>{S.srs={};for(const q of POOL.slice(0,2)) S.srs[q.id]={due:todayISO(),stability:1,reps:1,last:todayISO()};
    homePage=0;S.screen='home';render();return dueQuestions().map(q=>q.id);});
  await still('two due cards');
  await page.locator('.atlas-session button').click();

  await settled(page,()=>!window.__vtLive,{label:'due action'});
  const actual=await page.evaluate(()=>({screen:S.screen,ids:S.questions.map(q=>q.id),mode:S.mode}));
  ok('the next-session review opens only the cards actually due',wanted.length===2&&actual.screen==='quiz'&&actual.mode==='due'&&JSON.stringify(actual.ids)===JSON.stringify(wanted),JSON.stringify({count:actual.ids.length}));

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
