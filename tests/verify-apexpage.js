#!/usr/bin/env node
/*
 * Apex takes the whole page when asked, and its answers are set like prose.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-apexpage.js <patched.html>
 *   NODE_PATH=$(npm root -g) node tests/verify-apexpage.js http://localhost:8137
 *
 * TWO HALVES, AND THE SECOND ONE IS WHERE THE BUG WAS.
 *
 * FULL PAGE. The panel's geometry is set by four different #ai rules, several
 * inside media queries. Full-page mode overrides them by specificity rather
 * than order (#shell.ai-full #ai), which is the kind of thing that works until
 * someone appends one more media query. So this suite does not check that a
 * class was added — it measures the rendered box against the viewport, which
 * is the thing that actually breaks.
 *
 * MARKDOWN. md() turned `1. one` and `- one` both into a bare <li> and wrapped
 * every run in <ul>, so every numbered list Apex ever wrote rendered as
 * bullets with the numbers thrown away. In an app that teaches sequences —
 * the steps of an algorithm, the order of a work-up — that is not cosmetic.
 * The checks below are written against md() directly rather than against a
 * mocked reply, because md() is the whole of the claim and going through a
 * fake provider would only add ways for the test to be flaky.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { booted, settled } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-apexpage.js <patched.html>'); process.exit(1); }
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  const events = [];
  page.on('crash', () => events.push('the browser CRASHED the page'));
  page.on('close', () => events.push('the page closed'));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    if (why) events.push(`request failed: ${String(r.url()).slice(-50)} — ${why}`);
  });
  /* A crash and a close are different diagnoses; Playwright reports both
     as "Target page, context or browser has been closed" on the next call,
     so only the event says which. See tests/_deathnote.js. */
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await page.waitForTimeout(600);

  head('how an answer is turned into markup');
  const md = await page.evaluate(() => {
    const out = {};
    out.ordered = md('1. first\n2. second\n3. third');
    out.unordered = md('- alpha\n- beta');
    out.mixed = md('1. first\n2. second\n- a bullet\n- another');
    /* A literal '>' — md() runs e() over its input first, so passing the
       already-escaped entity here would have tested nothing. */
    out.quote = md('> a quoted line\n> and its continuation');
    out.rule = md('above\n\n---\n\nbelow');
    out.heading = md('## A section\n\nBody text.');
    return out;
  }).catch(e => ({ error: String(e) }));

  ok('md() is reachable from the page', !md.error, md.error || '');
  if (!md.error) {
    const ol = (md.ordered.match(/<ol>/g) || []).length;
    ok('a numbered list becomes an <ol>, not a bullet list',
       ol === 1 && !/<ul>/.test(md.ordered), md.ordered.slice(0, 90));
    ok('and it keeps all three items', (md.ordered.match(/<li>/g) || []).length === 3,
       `${(md.ordered.match(/<li>/g) || []).length} items`);
    ok('a dashed list is still a <ul>',
       /<ul>/.test(md.unordered) && !/<ol>/.test(md.unordered), md.unordered.slice(0, 80));
    /* The interesting case: a run that changes kind halfway is two lists. The
       old code produced one <ul> holding all four, which is how the numbers
       disappeared without anything looking wrong. */
    ok('a run that changes kind halfway becomes two lists',
       /<ol>/.test(md.mixed) && /<ul>/.test(md.mixed)
       && (md.mixed.match(/<li>/g) || []).length === 4,
       md.mixed.slice(0, 130));
    ok('a quoted run becomes one <blockquote>, not one per line',
       (md.quote.match(/<blockquote>/g) || []).length === 1, md.quote.slice(0, 100));
    /* Not just "an <hr> appeared" — the first version of this rule produced
       one inside the paragraph it was meant to divide, which looked right in
       the string and wrong on the page. */
    ok('a bare rule becomes an <hr> that actually separates the two paragraphs',
       /<p>above<\/p>\s*<hr>\s*<p>below<\/p>/.test(md.rule), md.rule.slice(0, 110));
    ok('a heading is still a heading, and its body is still a paragraph',
       /<h3>A section<\/h3>/.test(md.heading) && /<p>Body text\.<\/p>/.test(md.heading));
  }

  head('the panel can take the whole page');
  const open = () => page.evaluate(() => {
    AI.provider = 'gemini';
    AI.gemini = { key: 'test-gemini-key', model: 'gemini-2.5-flash' };
    const sh = document.getElementById('shell');
    if (!sh.classList.contains('ai-open')) toggleAI(); else buildAI();
  });
  await open();
  await page.waitForTimeout(350);

  const geoOf = () => page.evaluate(() => {
    const ai = document.getElementById('ai');
    const app = document.getElementById('app');
    const sh = document.getElementById('shell');
    const r = ai.getBoundingClientRect();
    const body = document.getElementById('aiBody');
    return {
      full: sh.classList.contains('ai-full'),
      w: Math.round(r.width), h: Math.round(r.height),
      vw: window.innerWidth, vh: window.innerHeight,
      appVisible: getComputedStyle(app).visibility !== 'hidden',
      bodyW: body ? Math.round(body.getBoundingClientRect().width) : 0,
      head: [...document.querySelectorAll('.ai-head button')].map(b => b.getAttribute('data-action')).join(','),
    };
  });

  const side = await geoOf();
  /* The owner's choice of November 2026: the head is one control, which closes Apex; grounding, full page and the
     connection are Settings' Apex section, chosen there below. */
  ok('the header is one control, which closes Apex', side.head === 'toggleAI', side.head);
  ok('as a side panel it takes part of the width, not all of it',
     side.w > 0 && side.w < side.vw * 0.75, `${side.w} of ${side.vw}px`);

  /* Grounding and full page are chosen in Settings' Apex section (CHANGE_ACTIONS), as a reader chooses them. */
  await page.evaluate(() => openSettings('apex'));
  await settled(page, () => !!document.querySelector('#generalSettings select[name="apexGrounded"]'), { label: 'Settings open at Apex' });
  const groundedNow = () => page.evaluate(() => ({ on: AI_GROUNDED, chosen: document.querySelector('#generalSettings select[name="apexGrounded"]').value,
    says: /grounded ·/.test((document.querySelector('.ai-head .ai-sub') || {}).textContent || '') }));
  const g0 = await groundedNow();
  await page.selectOption('#generalSettings select[name="apexGrounded"]', g0.on ? 'open' : 'grounded');
  const g1 = await groundedNow();
  await page.selectOption('#generalSettings select[name="apexGrounded"]', g0.on ? 'grounded' : 'open');
  const g2 = await groundedNow();
  ok('Settings\' "Apex answers from", chosen, turns grounding over and the head says so, and chosen back turns it back',
     g1.on === !g0.on && g1.chosen === (g1.on ? 'grounded' : 'open') && g1.says === g1.on && g2.on === g0.on && g2.says === g0.on, JSON.stringify([g0, g1, g2]));
  await page.evaluate(() => closeSettings());
  await page.evaluate(() => aiSettings());
  const sets = await page.evaluate(() => ({ open: !!document.getElementById('generalSettings')?.open, at: document.activeElement && document.activeElement.id,
    choices: [...document.querySelectorAll('#generalSettings select[name^="apex"]')].map(x => x.name).join(',') }));
  ok('Apex\'s settings open Settings at Apex, where its choices are', sets.open && sets.at === 'apexSettingsHeading' && sets.choices === 'apexGrounded,apexOpens', JSON.stringify(sets));

  await page.selectOption('#generalSettings select[name="apexOpens"]', 'full');
  await page.evaluate(() => closeSettings());
  await settled(page, () => document.getElementById('shell').classList.contains('ai-full'), { label: 'Apex full page, chosen in Settings' }).catch(() => {});
  const full = await geoOf();
  await page.evaluate(async () => {
    const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="gray"/></svg>');
    await openFigure(src,'Modal keyboard fixture','UI test');
  });
  await page.waitForFunction(() => figPs && figPs.opener.isOpen, null, {timeout:3000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.pswp'), null, {timeout:3000});
  const afterFigure = await geoOf();
  ok('expanding stays full page when a figure is closed', full.full && afterFigure.full);
  /* The measurement that matters: specificity actually beat the media-query
     rules, and the panel really is the width of the window. */
  ok('and the panel really spans the viewport', full.w >= full.vw - 2,
     `${full.w} of ${full.vw}px`);
  ok('the quiz behind it is hidden rather than showing through', !full.appVisible);
  ok('the thread keeps a readable measure instead of running the full width',
     full.bodyW > 0 && full.bodyW <= 900, `${full.bodyW}px column in a ${full.vw}px window`);

  head('and gives the page back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await geoOf();
  ok('Escape returns it to the side panel', !afterEsc.full);
  ok('and the panel is still open, not dismissed by the same press',
     afterEsc.w > 0 && afterEsc.appVisible, `${afterEsc.w}px wide`);
  /* The choice is how Apex opens: shut and opened again, it opens full page; chosen back, beside the question. */
  await page.evaluate(() => { toggleAI(); toggleAI(); });
  const reopened = await page.evaluate(() => document.getElementById('shell').classList.contains('ai-full'));
  await page.evaluate(() => { setApexOpens('side'); });
  const sideAgain = await page.evaluate(() => { const sh = document.getElementById('shell'); return sh.classList.contains('ai-open') && !sh.classList.contains('ai-full'); });
  ok('Settings\' "Apex opens: full screen" is kept: shut and opened again, Apex opens full page, and "beside the question" puts it back', reopened && sideAgain, JSON.stringify({ reopened, sideAgain }));

  /* Closing while full must not leave the flag set: the next tap on the FAB
     would otherwise take the whole screen with no warning. */
  await page.evaluate(() => { toggleApexFull(); });
  await page.waitForTimeout(200);
  await page.click('.ai-head [data-action="toggleAI"]');
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => {
    const sh = document.getElementById('shell');
    let stored = null; try { stored = localStorage.getItem('accsap12.aifull'); } catch (_) {}
    return { full: sh.classList.contains('ai-full'), open: sh.classList.contains('ai-open'), stored };
  });
  ok('closing the panel clears full-page too', !closed.full && !closed.open);
  ok('and clears it in storage, so the next launch is not a surprise',
     closed.stored === '0', `stored ${closed.stored}`);

  head('reading the conversation from the keyboard');
  await page.evaluate(() => startAdhocQuiz(POOL.filter(q => !q.bad).slice(0, 2), null));
  await settled(page, () => S.screen === 'quiz' && !!document.querySelector('.opt'), {label:'a quiz behind Apex'});
  await open();
  const reading = await page.evaluate(() => {
    const history = chatFor(S.questions[S.qIdx]);
    history.length = 0; history.push({role:'assistant',content:'Conversation reading fixture.\n\n'.repeat(100)});
    buildAI();
    const body = document.getElementById('aiBody');
    body.scrollTop = 0; body.focus();
    return {focused:document.activeElement === body, overflow:body.scrollHeight > body.clientHeight,
      question:S.questions[S.qIdx].id};
  });
  ok('the conversation can receive keyboard focus with content to scroll', reading.focused && reading.overflow);
  await page.evaluate(() => buildAI());
  /* What the key did, kept for the detail when the check fails: the check alone failed in CI's WebKit with nothing to
     say why, and never here (#463, #466, November 2026). Listeners that only watch: passive, in the capture phase, and
     reading defaultPrevented after every handler has run. */
  await page.evaluate(() => {
    const w = window.__pgdn = { keys: [], scrolls: 0, at: null };
    document.addEventListener('keydown', ev => { if (ev.key !== 'PageDown') return;
      const t = ev.target, k = { on: t && (t.id || t.tagName), prevented: null };
      w.keys.push(k); setTimeout(() => { k.prevented = ev.defaultPrevented; }, 0); }, { capture: true, passive: true });
    const body = document.getElementById('aiBody'), t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    /* Who called: the first frames of the stack below the wrapper, file and line only. */
    const who = () => String(new Error().stack || '').split('\n').slice(2, 5).map(l => l.trim().replace(/^.*[\/(]/, '').replace(/\)$/, '')).join(' < ');
    w.log = [];
    /* One line per event; an event the same as the one before it is counted on that line, not written again. */
    w.add = text => { const last = w.log[w.log.length - 1];
      if (last && last.text === text) last.n++; else w.log.push({ at: ms(), text, n: 1 }); };
    body.addEventListener('scroll', () => { w.scrolls++; w.add('scroll ' + Math.round(body.scrollTop)); }, { passive: true });
    /* Each write to the conversation's scrollTop, and each redraw, with who asked: the scroll in CI's failure ran (two scroll
       events) and ended at 0, so something put it back. They only record, and are taken off once the check has its answer. */
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(body, 'scrollTop', { configurable: true, get() { return desc.get.call(this); },
      set(v) { w.add('scrollTop=' + Math.round(v) + ' by ' + who()); desc.set.call(this, v); } });
    w.real = { buildAI, render };
    buildAI = function () { w.add('buildAI by ' + who()); return w.real.buildAI.apply(this, arguments); };
    render = function () { w.add('render by ' + who()); return w.real.render.apply(this, arguments); };
    w.at = { active: document.activeElement && (document.activeElement.id || document.activeElement.tagName), focus: document.hasFocus() };
  });
  await page.keyboard.press('PageDown');
  const scrolled = await page.waitForFunction(() => document.getElementById('aiBody').scrollTop > 0, null, {timeout:3000}).then(() => true, () => false);
  const said = scrolled ? '' : await page.evaluate(() => { const b = document.getElementById('aiBody'), w = window.__pgdn || {};
    return JSON.stringify({ before: w.at, keys: w.keys, scrolls: w.scrolls, now: { active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
      top: b && b.scrollTop, height: b && b.scrollHeight, shown: b && b.clientHeight, kept: b === document.getElementById('aiBody') },
      page: { y: window.scrollY, app: (document.getElementById('app') || {}).scrollTop }, log: (w.log || []).slice(0, 24).map(l => l.at + ' ' + l.text + (l.n > 1 ? ' ×' + l.n : '')) }); });
  await page.evaluate(() => { const w = window.__pgdn; if (!w || !w.real) return;
    buildAI = w.real.buildAI; render = w.real.render; delete document.getElementById('aiBody').scrollTop; });
  ok('Page Down scrolls the conversation after a panel redraw', scrolled, said);
  /* A redraw DURING the scroll, not before it. Page Down scrolls smoothly, and when the key press returns the scroll
     has not begun: in both engines scrollTop is still 0. A panel redraw then (Apex redraws after every tool step) used
     to put a new conversation in place of the one scrolling, and the key press was lost. Seen in CI on 25 November
     2026, in WebKit, on #463. */
  await page.evaluate(() => { const b = document.getElementById('aiBody'); b.scrollTop = 0; b.focus(); });
  await page.keyboard.press('PageDown');
  const during = await page.evaluate(() => { const before = document.getElementById('aiBody');
    buildAI(); return { kept: document.getElementById('aiBody') === before }; });
  const scrolledThrough = await page.waitForFunction(() => document.getElementById('aiBody').scrollTop > 0, null, {timeout:3000}).then(() => true, () => false);
  ok('a Page Down under way when the panel is redrawn still scrolls the conversation', scrolledThrough,
     during.kept ? 'the conversation was kept' : 'the conversation was replaced');
  await page.keyboard.press('b');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  const kept = await page.evaluate(() => ({question:S.questions[S.qIdx].id, answered:S.answered}));
  ok('reading keys never answer or advance the quiz behind Apex', kept.question === reading.question && !kept.answered);

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
