#!/usr/bin/env node
/*
 * The home screen as three pages: Home, Brain and Labs, side by side; one page to the reader, its doors the way between.
 *
 *   node tests/verify-homepager.js build/synthetic/systole.html
 *
 * The claims: Home holds the hero and the pearl, and ends with a door to Brain and one to Labs (the owner's choice,
 * November 2026: no tab bar, no sideways swipe); Brain holds the gauge, a row per chapter and the brain, which is live
 * while it shows, turns, and runs at Systole's own rates; Labs holds the Rhythm Lab, Echo and the Practice Lab, and under
 * them the study doors; each of the two begins with the way Home. A sideways swipe leaves Home where it is; a door glides
 * to its page, lands on it and takes the keyboard to the way Home, which goes back to the door it came by; the pages that
 * are off the screen are inert, so Tab never walks into them; the page that was showing is the one that shows on the way back
 * from a lab; the screen is one screen tall, in landscape and in portrait; the chapter bars fill when Brain is first
 * seen; turning the iPad keeps the page; and Home has no session strip, what is due being reviewed from Brain.
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
    try{
      await settled(page, () => { const p = document.getElementById('homePager'); const w = p.clientWidth;
        return !homeTween && Math.abs(p.scrollLeft / w - Math.round(p.scrollLeft / w)) < 0.01; }, { timeout: 8000, label: label + ': the pager to come to rest on a page' });
    }catch(err){
      const geometry=await page.evaluate(()=>{const p=document.getElementById('homePager');return {page:homePage,tween:homeTween,width:p.clientWidth,left:p.scrollLeft,scrollWidth:p.scrollWidth,snap:getComputedStyle(p).scrollSnapType,focus:document.activeElement?.id,panels:[...p.children].map(e=>({width:e.getBoundingClientRect().width,scroll:e.scrollWidth}))};});
      throw new Error(err.message+'; pager geometry '+JSON.stringify(geometry));
    }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  const state = () => page.evaluate(() => {
    const p = document.getElementById('homePager'), w = p.clientWidth;
    /* No tab is selected any more (no tab bar): the page in use is the one that is not inert. */
    const sel = [0, 1, 2].filter(i => !document.getElementById('homePage' + i).inert);
    return { f: p.scrollLeft / w, sel, homePage, inert: [0, 1, 2].map(i => !!document.getElementById('homePage' + i).inert),
      hidden: [0, 1, 2].map(i => document.getElementById('homePage' + i).getAttribute('aria-hidden') === 'true') };
  });
  await page.evaluate(() => { homePage = 0; S.screen = 'home'; render(); });
  await still('first render');
  head('Home opens on the pearl and live heart');
  await require('./_atlas-landing')(page,ok,settled);
  await still('after Home study actions');

  head('three pages, each with its own things');
  const parts = await page.evaluate(() => {
    const p = i => document.getElementById('homePage' + i);
    return {
      pages: document.querySelectorAll('#homePager > .home-page').length,
      tabs: document.querySelectorAll('.home-tabs, [role="tab"]').length,
      homeDoors: [...p(0).querySelectorAll('.home-door b')].map(b => b.textContent), backs: [1, 2].map(i => !!p(i).querySelector('.home-back')),
      home: { hero: !!p(0).querySelector('.hero-live'), pearl: !!p(0).querySelector('#pearlCard'), prog: !!document.getElementById('homeProgress'),
        doors: p(0).querySelectorAll('.door').length },
      brain: { gauge: !!p(1).querySelector('.brain-gauge'), rows: p(1).querySelectorAll('.brain-ch').length, chapters: CHAPTERS.length,
        doors: p(1).querySelectorAll('.door').length },
      labs: [...p(2).querySelectorAll('.lab-card')].map(c => c.getAttribute('data-action')),
      labDoors: [...p(2).querySelectorAll('.door b')].map(b => b.textContent),
      after: (() => { const c = p(2).querySelectorAll('.lab-card'), d = p(2).querySelector('.door'); return !!(c.length && d && (c[c.length - 1].compareDocumentPosition(d) & 4)); })(),
    };
  });
  ok('there are three pages and no tab bar: Home ends with a door to Brain and one to Labs, and each of those begins with the way Home',
     parts.pages === 3 && parts.tabs === 0 && parts.homeDoors.join('|') === 'Brain|Labs' && parts.backs.join() === 'true,true', JSON.stringify({ pages: parts.pages, tabs: parts.tabs, doors: parts.homeDoors, backs: parts.backs }));
  ok('Home holds the hero and the pearl, no progress bar and none of the study doors', parts.home.hero && parts.home.pearl && !parts.home.prog && parts.home.doors === 0, JSON.stringify(parts.home));
  ok('Brain holds the gauge and a row for every chapter, and no doors', parts.brain.gauge && parts.brain.rows === parts.brain.chapters && parts.brain.rows > 0 && parts.brain.doors === 0,
     `${parts.brain.rows} rows for ${parts.brain.chapters} chapters, ${parts.brain.doors} doors`);
  ok('Labs holds the Rhythm Lab, Echo, the Practice Lab and Sessions', parts.labs.join('|') === 'goLab|goEcho|goPractice|goSessions', parts.labs.join(' · '));
  /* Every card's white type sits on its own gradient: a card with none is white on the page (Sessions shipped so). */
  const bare = await page.evaluate(() => [...document.querySelectorAll('.lab-card')].filter(c => getComputedStyle(c).backgroundImage === 'none').map(c => c.className));
  ok('every Labs card is painted with its own gradient', bare.length === 0 && parts.labs.length === 4, bare.join(' · '));
  ok('and under them the study tools, Chapters first', parts.after && parts.labDoors[0] === 'Chapters' && ['Search', 'Progress', 'Notes', 'Memory', 'Annotations'].every(d => parts.labDoors.includes(d)),
     parts.labDoors.join(' · ') + (parts.after ? '' : ' (not under the labs)'));

  head('one screen tall');
  /* One page (the owner's choice, November 2026): no rail and no bar, at any width. The screen does not scroll, the pages
     do; Apex keeps its corner, clear of Home's doors. Either side of 700px, where the rail used to begin, too. */
  const fits = async (label) => {
    const g = await page.evaluate(() => { const r = e => e.getBoundingClientRect(), fab = r(document.getElementById('aiFab'));
      const doors = [...document.querySelectorAll('#homePage0 .home-door')].map(r);
      return { doc: document.documentElement.scrollHeight, vh: innerHeight, bar: document.querySelectorAll('.home-tabs').length,
        corner: Math.round(innerWidth - fab.right) < 40 && Math.round(innerHeight - fab.bottom) < 60,
        fabClear: doors.length === 2 && doors.every(t => fab.right <= t.left || fab.left >= t.right || fab.bottom <= t.top || fab.top >= t.bottom) };
    });
    ok(`${label}: the screen does not scroll, the pages do`,g.doc<=g.vh+1,JSON.stringify(g));
    ok(`${label}: no rail and no tab bar, and Apex in its corner`,g.bar===0&&g.corner,JSON.stringify(g));
    ok(`${label}: and the Apex button is clear of Home's doors`,g.fabClear,JSON.stringify(g));
  };
  await fits('landscape');
  for (const w of [699, 701]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate(()=>homeGo(0,false)); await still('Home at the old breakpoint');
    await fits(`${w}px, either side of where the rail began`);
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
  // The pearl and live heart are already visible.



  head('no swipe: the doors');
  const s0 = await state();
  ok('it opens on Home, the other pages inert and hidden', s0.sel.join() === '0' && s0.inert.join() === 'false,true,true' && s0.hidden.join() === 'false,true,true', JSON.stringify(s0));
  /* A horizontal wheel on the pager is the trackpad's swipe. Home is one page now: it stays where it is. */
  const box = await page.locator('#homePager').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.wheel(Math.round(box.width * 0.6), 0);
  await still('after a swipe');
  const s1 = await state();
  ok('a sideways swipe leaves Home where it is', Math.abs(s1.f) < 0.01 && s1.homePage === 0 && s1.sel.join() === '0', JSON.stringify(s1));

  await page.locator('#homePage0 .home-door[data-page="2"]').click();
  /* Read from what homeGo chose, not from whether the glide is still running: a 420ms glide can be over by the time a
     loaded runner reads it. */
  const glide = await page.evaluate(() => ({ moving: !!(homeLastGo && homeLastGo.to === 2 && homeLastGo.glide) }));
  await still('after the Labs door');
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
  ok('the Labs door glides there rather than jumping', glide.moving, JSON.stringify(glide));
  ok('and lands on Labs, the only page in use, with the keyboard on its way Home', Math.abs(s2.f - 2) < 0.01 && s2.sel.join() === '2'
     && await page.evaluate(() => document.activeElement === document.querySelector('#homePage2 .home-back')), JSON.stringify(s2));
  await page.keyboard.press('Enter');
  await still('after Home from Labs');
  const homeAgain = await page.evaluate(() => ({ f: document.getElementById('homePager').scrollLeft / document.getElementById('homePager').clientWidth,
    focus: document.activeElement && document.activeElement.className + ' ' + (document.activeElement.dataset.page || '') }));
  ok('Enter on the way Home goes Home and puts the keyboard back on the door it came by', Math.abs(homeAgain.f) < 0.01 && homeAgain.focus === 'home-door 2', JSON.stringify(homeAgain));
  // The trace clock wraps at the canvas edge; actual paints cannot look like backwards progress when a sample crosses that wrap.
  const ecg = await require('./_home-ecg')(page);
  ok('back on Home the trace is shown across the hero and drawn', ecg.shown !== 'hidden' && ecg.width > 200 && ecg.live > 0, JSON.stringify(ecg));

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
  /* Some frames on, and turned by at least 0.6 degrees: at the end of the sway the turn is slow, and two readings a few
     frames apart (5.18 to 5.23 degrees, once in CI) left the wiring's one-decimal transform the same. A wait, not the
     proposition: if the brain never turns, the readings below still fail. */
  const y0 = (/rotateY\((-?[\d.]+)deg\)/.exec(t0.tilt) || [])[1];
  await settled(page, ({ f, y }) => { const el = document.getElementById('brainTilt'), m = el && /rotateY\((-?[\d.]+)deg\)/.exec(el.style.transform);
    return brainLiveRun && brainLiveRun.frames > f + 3 && !!m && y !== undefined && Math.abs(+m[1] - +y) >= 0.6; },
    { arg: { f: t0.frames, y: y0 }, timeout: 8000, label: 'the brain to turn by 0.6 degrees' }).catch(() => {});
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
    return {...await __homeWork(),label:document.getElementById('atlasPause')?.textContent.trim(),
      fallback:getComputedStyle(document.querySelector('.h-beat')).animationPlayState};
  });
  ok('Pause stops Home canvases and the CSS heart with a Play name',covered(paused)&&paused.label==='Play motion'&&paused.fallback==='paused',JSON.stringify(paused));
  await page.evaluate(()=>render());
  await still('paused Home remounted');
  await settled(page,()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect&&Number.isFinite(a.effect.getTiming().iterations)),{label:'Home entrance effects finished'});
  const pausedRemount=await page.evaluate(async()=>({...await __homeWork(),opacity:getComputedStyle(document.querySelector('#pearlConcept')).opacity,
    label:document.getElementById('atlasPause')?.textContent.trim()}));
  ok('paused Home keeps its heading visible after remount',covered(pausedRemount)&&pausedRemount.opacity==='1'&&pausedRemount.label==='Play motion',JSON.stringify(pausedRemount));

  const resumed = await page.evaluate(async () => {
    document.getElementById('atlasPause')?.click();
    return {...await __homeWork(),label:document.getElementById('atlasPause')?.textContent.trim(),
      fallback:getComputedStyle(document.querySelector('.h-beat')).animationPlayState};
  });
  ok('Play resumes Home canvases and the CSS heart with a Pause name',visible(resumed)&&resumed.label==='Pause motion'&&resumed.fallback==='running',JSON.stringify(resumed));
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
  await settled(page, () => document.getElementById('homePager').clientWidth === innerWidth && innerWidth === 820, { label: 'the pager to take the portrait width' });
  await still('after turning');
  const turned = await state();
  ok('turned to portrait, Brain is still the page', Math.abs(turned.f - 1) < 0.01 && turned.sel.join() === '1', JSON.stringify(turned));
  await fits('portrait');
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page, () => document.getElementById('homePager').clientWidth === 390, { label: 'the pager to take a phone\'s width' });
  await still('on a phone');
  await fits('a phone');
  await page.setViewportSize({ width: 820, height: 1180 });
  await settled(page, () => document.getElementById('homePager').clientWidth === 820, { label: 'the pager back at the portrait width' });
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
  const compactHidden=await page.evaluate(()=>{const f=document.getElementById('pearlFig');f.querySelector('figcaption').textContent='Long caption for keyboard scrolling. '.repeat(60);pearlFit();return getComputedStyle(f).display!=='none'&&document.getElementById('pearlCard').classList.contains('pearl-figthumb');});
  await page.evaluate(()=>pearlToggleAll());
  await still('expanded caption reading');
  const expandedFigure=await page.evaluate(()=>getComputedStyle(document.getElementById('pearlFig')).display!=='none');
  ok('Show all expands a figure kept as a compact thumbnail',compactHidden&&expandedFigure,JSON.stringify({compactHidden,expandedFigure}));
  /* The figure's own keys (pearlFigureKey(), KEY_ACTIONS.openPearlFigure): End scrolls it and goes no further, so nothing
     past the document hears it. A listener on window hears a key only if the figure let it go; a browser scrolling the
     figure by itself would pass the scroll check below and fail this one. */
  await page.evaluate(()=>{window.__pastFigure=[];window.__pastFigureL=e=>window.__pastFigure.push(e.key+(e.defaultPrevented?'(prevented)':''));window.addEventListener('keydown',window.__pastFigureL);});
  if(expandedFigure){await page.locator('#pearlFig').focus();await page.keyboard.press('End');}
  const pastFigure=await page.evaluate(()=>{window.removeEventListener('keydown',window.__pastFigureL);return window.__pastFigure;});
  ok('the figure takes End for itself: it goes no further than the figure',expandedFigure&&pastFigure.length===0,JSON.stringify(pastFigure));

  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const captionScroll=await page.evaluate(()=>{const f=document.getElementById('pearlFig');return {overflow:f.scrollHeight-f.clientHeight,scroll:f.scrollTop};});
  ok('a long figure caption can be scrolled with the keyboard',captionScroll.overflow>0&&captionScroll.scroll>0,JSON.stringify(captionScroll));

  head('the hero: the bank in one line, the rhythm under it, and the heart is the control');
  /* The hero as it was before the Quiet Atlas (the owner's screenshot, November 2026): the greeting, Systole, the bank in
     one line and the rhythm under it, inside the hero; no 3D switch beside the heart, whose tap opens its menu. */
  await page.evaluate(()=>{S.srs={};homePage=0;S.screen='home';render();});
  await still('hero, nothing due');
  const hero=await page.evaluate(()=>{
    const r=s=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
    const rhythm=r('#homePage0 .hero-rhythm-label'), stats=r('#homePage0 .hero-line'), live=r('#homePage0 .hero-live');
    const loose=[...document.querySelectorAll('#homePage0 .hero-tool')].filter(b=>!b.closest('#heroMenu')&&b.offsetWidth>0).length;
    return {entry:!!document.getElementById('atlasExplore'),
      above:!!(rhythm&&stats)&&rhythm.top>=stats.bottom-1, inside:!!(stats&&live&&rhythm)&&rhythm.bottom<=live.bottom+1&&stats.top>=live.top,
      loose, menuHidden:document.getElementById('heroMenu')?.hidden};
  });
  ok('the bank\'s line, then the rhythm under it, both inside the hero, and no 3D switch',hero.above&&hero.inside&&!hero.entry,JSON.stringify(hero));
  ok('no round tool stands beside the heart; they are in its menu, closed',hero.loose===0&&hero.menuHidden===true,JSON.stringify(hero));
  /* A dot only between two items on one row: the line wraps on a narrower iPad held sideways, and a dot left hanging at the
     end of a row read as a list with an item missing. Each item's dot is its ::before; the row is clipped on the left by
     its clip-path, so what is drawn is read off the geometry and the clip together, and a wrap is a precondition. */
  const dots=async(w,h)=>{
    await page.setViewportSize({width:w,height:h}); await page.evaluate(()=>homeGo(0,false)); await still(`the hero at ${w}x${h}`);
    return page.evaluate(()=>{
      const line=document.querySelector('#homePage0 .hero-line'), lr=line.getBoundingClientRect();
      const m=/inset\(\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(getComputedStyle(line).clipPath||'');
      const clipLeft=m?lr.left+Number(m[4]):-Infinity;
      const items=[...line.querySelectorAll('.hl-item')].map(el=>{const r=el.getBoundingClientRect(), b=getComputedStyle(el,'::before');
        const drawn=b.content!=='none'&&b.display!=='none'&&parseFloat(b.width)>0&&parseFloat(b.opacity)>0;
        const dotLeft=r.left+(parseFloat(b.left)||0), dotRight=dotLeft+(parseFloat(b.width)||0);
        return {top:Math.round(r.top),left:Math.round(r.left),shown:drawn&&dotRight>clipLeft};});
      const rows=[...new Set(items.map(i=>i.top))];
      const first=items.map(i=>i.left===Math.min(...items.filter(j=>j.top===i.top).map(j=>j.left)));
      const wrong=items.map((it,k)=>first[k]?(it.shown?'dot at the start of a row':''):(!it.shown?'no dot between two items':(items[k-1].top!==it.top?'dot after a wrap':''))).map((x,k)=>x&&k+': '+x).filter(Boolean);
      const spans=[...line.querySelectorAll('.hl-dot')].filter(d=>d.getClientRects().length&&d.getBoundingClientRect().width>0).length;
      return {rows:rows.length,items:items.length,shown:items.filter(i=>i.shown).length,wrong,spans};
    });
  };
  const narrow=await dots(1024,768), wide=await dots(1366,1024);
  ok('at 1024x768 the bank\'s line wraps (precondition)',narrow.rows>=2,JSON.stringify(narrow));
  ok('and a dot stands only between two items on one row, never at a row\'s start or end',narrow.rows>=2&&narrow.wrong.length===0&&narrow.spans===0&&narrow.shown===narrow.items-narrow.rows,JSON.stringify(narrow));
  ok('at 1366x1024, one row with a dot between each pair',wide.rows===1&&wide.wrong.length===0&&wide.spans===0&&wide.shown===wide.items-1,JSON.stringify(wide));
  await page.setViewportSize({width:1180,height:820}); await page.evaluate(()=>homeGo(0,false)); await still('the hero back at 1180x820');
  await page.locator('#heroHeartBtn').click();
  const opened=await page.evaluate(()=>{const m=document.getElementById('heroMenu'),b=document.getElementById('heroHeartBtn');
    const items=[...m.querySelectorAll('button')].filter(x=>!x.hidden).map(x=>({t:x.textContent.trim(),h:Math.round(x.getBoundingClientRect().height)}));
    return {open:!m.hidden&&m.offsetHeight>0,expanded:b.getAttribute('aria-expanded'),items};});
  ok('a tap on the heart opens its menu: motion and the chambers, each 44px tall',opened.open&&opened.expanded==='true'&&
     opened.items.some(i=>/motion/i.test(i.t))&&opened.items.some(i=>/chambers/i.test(i.t))&&opened.items.every(i=>i.h>=44),JSON.stringify(opened));
  await page.keyboard.press('Escape');
  const esc=await page.evaluate(()=>({hidden:document.getElementById('heroMenu').hidden,focus:document.activeElement&&document.activeElement.id}));
  ok('Escape closes it and gives focus back to the heart',esc.hidden===true&&esc.focus==='heroHeartBtn',JSON.stringify(esc));
  await page.locator('#heroHeartBtn').click();
  await page.mouse.click(5,5);
  ok('and a tap anywhere else closes it',await page.evaluate(()=>document.getElementById('heroMenu').hidden===true));

  head('the review on Brain');

  /* Home's session strip, with its Start, Continue and Review, is gone (the owner's choice, November 2026); what is due is
     reviewed from the Brain page, by its Review, which is the review session Chapters starts too: every card due, then
     new questions, twenty in all, dealt by reviewDeck (docs/ROADMAP.md, S6). */
  const wanted=await page.evaluate(()=>{S.srs={};for(const q of POOL.slice(0,2)) S.srs[q.id]={due:todayISO(),stability:1,reps:1,last:todayISO()};
    homePage=0;S.screen='home';render();return {due:dueQuestions().map(q=>q.id),queue:reviewQueue(20).map(q=>q.id)};});
  await still('two due cards');
  ok('Home has no session strip',await page.evaluate(()=>!document.querySelector('.atlas-session')));
  await page.evaluate(()=>homeGo(1,false)); await still('Brain with two due cards');
  await page.locator('#homePage1 [data-action="startDue"]').click();

  await settled(page,()=>!window.__vtLive&&S.screen!=='home',{label:'due action'});
  const actual=await page.evaluate(()=>({screen:S.screen,ids:S.questions.map(q=>q.id),mode:S.mode}));
  const sorted=a=>JSON.stringify([...a].sort());
  ok('Brain\'s Review opens the review session: both cards due, and new questions to twenty, each once',wanted.due.length===2&&actual.screen==='quiz'&&actual.mode==='due'&&actual.ids.length===20&&new Set(actual.ids).size===20
     &&wanted.due.every(id=>actual.ids.includes(id))&&sorted(actual.ids)===sorted(wanted.queue),JSON.stringify({count:actual.ids.length,due:wanted.due.filter(id=>actual.ids.includes(id)).length}));

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
