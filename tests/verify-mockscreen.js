#!/usr/bin/env node
/*
 * The mock exam in the app: a timed block with no feedback until it is handed in.
 *
 *   node tests/verify-mockscreen.js build/synthetic/systole.html
 *
 * src/core/mockexam.js is held by verify-mockexam-pure; this holds that the app is wired to it:
 *   · the Study screen has the card, every control at least 44 px tall, and changing it changes the
 *     block it would start, in place;
 *   · a block shows no verdict, no chapter, no search and no Apex, and answering it, flagging it and
 *     moving about it changes nothing in the progress record;
 *   · the clock counts down while the app is on screen, not while it is hidden or the block is
 *     paused, warns at five minutes and one, and hands the block in when it reaches zero;
 *   · leaving the block, reloading the page, or a damaged record in storage leaves the block as it
 *     was, or nothing, never a half block;
 *   · handing in counts the answers into the progress record exactly as the same answers made in
 *     the quiz would (chapter totals, missed list, practice counts, the day, the review log), once,
 *     leaves the schedule alone, keeps a summary, and shows a report whose numbers are the block's;
 *   · the review opens the questions on the quiz screen with the answers already given and
 *     re-records nothing;
 *   · the kept history survives a backup, is refused when it is not sound, and Reset clears it;
 *   · every screen of it fits, from a phone to an iPad in landscape, and nothing throws.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');
const { blankComments } = require('./_source.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-mockscreen.js <build.html>'); process.exit(1); }
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
  const page = watch(await browser.newPage({ viewport: { width: 834, height: 1194 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  const toStudy = async () => {
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    await quiet(page);
  };
  const clean = keep => page.evaluate(keep => {   // a fellow with nothing done, and no block anywhere
    S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {}; S.practice = {}; S.sessionCorrect = 0; S.sessionTotal = 0;
    LOG.length = 0; if (!keep) S.mocks = []; S.mock = null; S.mockLast = null; _mockArm = false;
    localStorage.removeItem('accsap12.mock'); localStorage.removeItem('accsap12.mocklast'); save();
  }, !!keep);
  /* The record the fellow's progress is, as numbers a test can compare. */
  const snap = () => page.evaluate(() => ({
    chStats: JSON.parse(JSON.stringify(S.chStats)), sessionTotal: S.sessionTotal, sessionCorrect: S.sessionCorrect,
    missed: [...S.missed].sort(), practice: JSON.parse(JSON.stringify(S.practice)), srs: JSON.stringify(S.srs),
    day: JSON.parse(JSON.stringify(S.daily[FSRS.todayISO()] || { a: 0, c: 0, r: 0 })), log: LOG.length,
  }));
  /* Starts a block through the card's own button, on questions the test chose. */
  const startWith = async (ids, sec, keep) => {
    await clean(keep); await toStudy();
    await page.evaluate(({ ids, sec }) => { window.__build = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = sec; _mockCfg.n = 20; _mockCfg.ch = ''; render(); }, { ids, sec });
    await onScreen(page, 'study', { marker: '#planCard' });
    await page.waitForSelector('#mockStart', { timeout: 8000 });
    /* The card's own button is pressed in 'starting from the card'; here the block starts with Apex open, which a click on the
       button could not do: the open panel covers it. */
    await page.evaluate(() => { document.getElementById('shell').classList.add('ai-open'); startMock(); });
    await onScreen(page, 'mock', { marker: '.mock-opt' });
    await page.evaluate(() => { MockExam.build = window.__build; mockStopTicker(); MockExam.hold(S.mock); });
    await realClock(false);
  };
  const reached = (screen, ms) => page.waitForFunction(s => S.screen === s, screen, { timeout: ms || 6000 }).then(() => true, () => false);
  /* The screen being named is not the screen being drawn: S.screen is set at once and the markup follows. */
  const drawn = sel => page.waitForSelector(sel, { timeout: 4000 }).then(() => true, () => false);
  const info = ids => page.evaluate(ids => ids.map(id => ({ id, ch: QBYID[id].ch, ci: QBYID[id].ci, n: QBYID[id].o.length, img: !!QBYID[id].img })), ids);
  /* The test says what time it is, an hour ahead of the real clock: a reading the app takes of its own clock (leaving
     the page, say) is then earlier than the last tick and adds nothing, so every number below is the test's own. */
  const base = () => Date.now() + 3600000;
  /* Drives the clock by hand: the page's own interval is stopped and the test says what time it is. */
  const clockAt = t => page.evaluate(t => { MockExam.resume(S.mock, t); }, t);
  const realClock = on => page.evaluate(on => { window.__realStart = window.__realStart || mockStartTicker; mockStartTicker = on ? window.__realStart : () => {}; }, on);
  const tick = t => page.evaluate(t => { mockTick(t); return { el: S.mock ? S.mock.elapsedMs : null, screen: S.screen }; }, t);

  head('the mock exam\'s styles keep the Safari floor');
  {
    /* A mixed colour is not understood before Safari 16.2; a declaration with it needs a plain one for the same property first. */
    const css = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'study.css'), 'utf8'));
    const bad = []; let mixes = 0;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().replace(/\s+/g, ' ');
      if (!/\.mock|\.mk-/.test(sel)) continue;
      const decls = m[2].split(';').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf(':'); return [x.slice(0, i).trim(), x.slice(i + 1)]; });
      decls.forEach(([prop, val], i) => {
        if (!/color-mix\(/.test(val)) return;
        mixes++;
        if (!decls.slice(0, i).some(([p2, v2]) => p2 === prop && !/color-mix\(/.test(v2))) bad.push(sel.slice(0, 40) + ' { ' + prop + ' }');
      });
    }
    ok('the scan found the mixed colours it is there to check', mixes >= 4, String(mixes));
    ok('every colour mixed in a mock exam style has a plain one before it, for Safari before 16.2', bad.length === 0, bad.join(' | '));
  }

  head('the card on the Study screen');
  await clean(); await toStudy();
  ok('the Study screen has the mock exam card', await page.evaluate(() => !!document.getElementById('mockCard')));
  {
    const r = await page.evaluate(() => {
      const c = document.getElementById('mockCard');
      const ctl = [...c.querySelectorAll('button,select')];
      return {
        sizes: [...c.querySelectorAll('[data-n]')].map(b => +b.dataset.n), paces: [...c.querySelectorAll('[data-sec]')].map(b => +b.dataset.sec),
        small: ctl.filter(b => b.offsetHeight < 44).map(b => b.id || b.className),
        chapters: [...c.querySelectorAll('#mockCh option')].map(o => o.value), expect: CHAPTERS.slice(),
        on: { n: +c.querySelector('[data-n].on').dataset.n, sec: +c.querySelector('[data-sec].on').dataset.sec },
        start: document.getElementById('mockStart').textContent.trim(), pool: POOL.length,
        order: [...document.querySelectorAll('#app .feed-card')].map(x => x.id || x.className.split(' ')[1]),
        /* Everything but the glow, which is drawn wider than the card on purpose and clipped by it, as on the plan card. */
        spill: [...c.querySelectorAll('*')].some(x => { const b = x.getBoundingClientRect(), k = c.getBoundingClientRect(); return b.width > 0 && !x.closest('.fc-glow') && (b.right > k.right + 1 || b.left < k.left - 1); }),   // an <option> has no box
        glow: getComputedStyle(c.querySelector('.fc-glow')).position,
      };
    });
    ok('the card is there with 20, 40 and 60 questions and 60, 90, 120 seconds and no limit', same(r.sizes, [20, 40, 60]) && same(r.paces, [60, 90, 120, 0]), JSON.stringify([r.sizes, r.paces]));
    ok('every button and the chapter menu is at least 44 px tall', r.small.length === 0, r.small.join());
    ok('it offers every chapter and all of them', r.chapters[0] === '' && same(r.chapters.slice(1), r.expect));
    ok('it starts set to 40 questions at 90 seconds, and says what that is: an hour', r.on.n === 40 && r.on.sec === 90 && /Start a 40-question block · 1:00:00 on the clock/.test(r.start), r.start);
    ok('it sits among the other Study cards, after the plan', r.order.indexOf('mockCard') === r.order.indexOf('planCard') + 1, r.order.join());
    ok('nothing spills out of the card', r.spill === false);
    ok('the glow behind the card is out of the flow, as on the other cards, so it can be seen at all', r.glow === 'absolute', r.glow);
  }
  {
    await page.evaluate(() => { window.__card = document.getElementById('mockCard'); });
    await page.click('#mockCard [data-n="20"]');
    await page.click('#mockCard [data-sec="60"]');
    const r = await page.evaluate(() => ({
      same: document.getElementById('mockCard') === window.__card, screen: S.screen,
      on: { n: +document.querySelector('#mockCard [data-n].on').dataset.n, sec: +document.querySelector('#mockCard [data-sec].on').dataset.sec },
      pressed: [...document.querySelectorAll('#mockCard [data-n]')].map(b => b.getAttribute('aria-pressed')).join(),
      start: document.getElementById('mockStart').textContent.trim(),
    }));
    ok('choosing 20 questions and 60 seconds changes the card in place: the same card, the same screen', r.same && r.screen === 'study');
    ok('the choice is marked and said: twenty minutes', r.on.n === 20 && r.on.sec === 60 && /Start a 20-question block · 20:00 on the clock/.test(r.start) && r.pressed === 'true,false,false', r.start + ' / ' + r.pressed);
    const kept = await page.evaluate(() => { const was = JSON.stringify(_mockCfg); setMockCfg('sec', 45); setMockCfg('sec', -1); setMockCfg('n', -5); setMockCfg('n', 'x'); setMockCfg('ch', 'Not a chapter'); setMockCfg('what', 1); return { same: JSON.stringify(_mockCfg) === was, cfg: _mockCfg }; });
    ok('the card refuses a pace it does not offer, a size that is not a number, a chapter the bank lacks, and a setting it does not have', kept.same && kept.cfg.ch === '', JSON.stringify(kept.cfg));
    await page.click('#mockCard [data-sec="0"]');
    ok('no limit says so, and does not name a time', /Start a 20-question block · no time limit/.test(await page.evaluate(() => document.getElementById('mockStart').textContent)));
    /* By the keyboard, as VoiceOver or a switch does it: the redraw replaces the control that was pressed, and the keys must stay on it. */
    await page.focus('#mockCard [data-n="60"]'); await page.keyboard.press('Enter');
    ok('pressing a size with the keyboard leaves the keyboard on that size', await page.evaluate(() => !!document.activeElement && document.activeElement.dataset.n === '60' && document.activeElement.classList.contains('on')));
    await page.focus('#mockCard [data-sec="120"]'); await page.keyboard.press('Enter');
    ok('and so does pressing a pace', await page.evaluate(() => !!document.activeElement && document.activeElement.dataset.sec === '120' && document.activeElement.classList.contains('on')));
    const ch = await page.evaluate(() => { const c = CHAPTERS.map(x => ({ x, n: POOL.filter(q => q.ch === x).length })).sort((a, b) => a.n - b.n)[0]; return c; });
    await page.focus('#mockCh');
    await page.selectOption('#mockCh', ch.x);
    ok('and so does choosing a chapter', await page.evaluate(() => !!document.activeElement && document.activeElement.id === 'mockCh'));
    const r2 = await page.evaluate(() => ({
      sizes: [...document.querySelectorAll('#mockCard [data-n]')].map(b => +b.dataset.n), on: +document.querySelector('#mockCard [data-n].on').dataset.n,
      start: document.getElementById('mockStart').textContent.trim(),
    }));
    ok('a chapter with fewer questions offers only sizes it can fill, and starts a block no longer than it has', r2.sizes.every(n => n <= ch.n) && r2.on <= ch.n && new RegExp('Start a ' + r2.on + '-question').test(r2.start), `${ch.x} has ${ch.n}: ${r2.sizes.join()} → ${r2.start}`);
  }

  head('starting from the card asks what the card says');
  {
    await clean(); await toStudy();
    const big = await page.evaluate(() => CHAPTERS.map(x => ({ x, n: POOL.filter(q => q.ch === x).length })).sort((a, b) => b.n - a.n)[0]);
    await page.evaluate(big => { setMockCfg('ch', big.x); setMockCfg('n', 20); setMockCfg('sec', 60); }, big);
    await page.click('#mockStart');
    ok('a block set to one chapter opens, and its first question is drawn', await reached('mock') && await drawn('.mock-opt'));
    const r = await page.evaluate(() => ({ ids: S.mock.ids.slice(), chs: [...new Set(S.mock.ids.map(id => QBYID[id].ch))], ch: S.mock.chapter, sec: S.mock.secPerQ, uniq: new Set(S.mock.ids).size }));
    ok('and asks only that chapter, the size asked, each question once, at the pace asked', r.chs.length === 1 && r.chs[0] === big.x && r.ids.length === Math.min(20, big.n) && r.uniq === r.ids.length && r.ch === big.x && r.sec === 60, JSON.stringify([r.chs, r.ids.length, r.ch, r.sec]));
    await clean(); await toStudy();
    await page.evaluate(() => {
      window.__fresh = POOL.slice(-12).map(q => q.id);
      POOL.slice(0, -12).forEach(q => { S.practice[q.id] = { n: 1, c: 1, t: 1 }; });
      save(); setMockCfg('ch', ''); setMockCfg('n', 20); setMockCfg('sec', 90);
    });
    await page.click('#mockStart');
    ok('a block from the whole bank opens, and its first question is drawn', await reached('mock') && await drawn('.mock-opt'));
    const f = await page.evaluate(() => ({ missing: window.__fresh.filter(id => !S.mock.ids.includes(id)).length, n: S.mock.ids.length }));
    ok('questions never met come before ones already seen: all twelve unseen are in a block of twenty', f.missing === 0 && f.n === 20, JSON.stringify(f));
  }

  head('a block: no verdict, no chapter, no search, no Apex');
  const ids10 = await page.evaluate(() => POOL.filter(q => !q.img).slice(0, 12).map(q => q.id));
  const q10 = await info(ids10);
  await startWith(ids10, 60);
  {
    const before = await snap();
    const r = await page.evaluate(() => ({
      screen: S.screen, n: S.mock.ids.length, attr: document.documentElement.hasAttribute('data-mock'),
      nav: [...document.querySelectorAll('#navbar button')].map(b => b.getAttribute('onclick') || ''),
      fab: getComputedStyle(document.getElementById('aiFab')).display, panel: getComputedStyle(document.getElementById('ai')).display,
      shell: document.getElementById('shell').className, text: document.getElementById('app').innerText,
      ch: QBYID[S.mock.ids[0]].ch, header: document.querySelector('.mock-bar').innerText,
      badge: !!document.querySelector('.ch-badge'), rail: document.getElementById('rail').classList.contains('hidden'),
      opts: document.querySelectorAll('.mock-opt').length, keys: QBYID[S.mock.ids[0]].o.length,
    }));
    ok('pressing Start opens the block on the first question, of the size asked for', r.screen === 'mock' && r.n === 12 && /Question 1 of 12/.test(r.header), r.header.replace(/\n/g, ' '));
    ok('the top bar has no search, no notes search and no Echo; only the theme menu is left', !r.nav.some(x => /openSearch|goNoteSearch|goEcho/.test(x)) && r.nav.some(x => /toggleThemeMenu/.test(x)), r.nav.join('|'));
    ok('the Apex button and panel are gone, and the panel is shut', r.fab === 'none' && r.panel === 'none' && !/ai-open|ai-full/.test(r.shell), r.fab + '/' + r.panel);
    ok('the pen and note tools are put away too', r.rail === true);
    ok('the chapter is not on the screen: not as a badge, not in the words (read as drawn, where the stylesheet capitals them)', !r.badge && !r.text.toLowerCase().includes(r.ch.toLowerCase()), r.ch);
    ok('there is an option per answer and the marker on the page says a block is open', r.opts === r.keys && r.attr === true);
    ok('opening the block changed nothing in the progress record', same(await snap(), before));
  }
  {
    const before = await snap();
    await page.click('.mock-opt[data-mi="1"]');
    const a = await page.evaluate(() => ({ picked: [...document.querySelectorAll('.mock-opt')].map(b => b.classList.contains('picked')), pressed: [...document.querySelectorAll('.mock-opt')].map(b => b.getAttribute('aria-pressed')), sel: S.mock.sel[0], sub: document.getElementById('mockSub').textContent }));
    ok('tapping an option marks it, and only it, as picked', a.picked.join() === 'false,true,false,false,false' && a.pressed[1] === 'true' && a.sel === 1, a.picked.join());
    ok('and the count above says one answered', /^1 answered · 0 flagged/.test(a.sub), a.sub);
    const v = await page.evaluate(() => ({
      verdict: document.querySelectorAll('.reveal-card,.opt.correct,.opt.wrong,.opt-pct,.dist-row,.reveal-header').length,
      words: /Correct|Incorrect|% of candidates|Answer Distribution/i.test(document.getElementById('app').innerText),
    }));
    ok('nothing says right or wrong: no reveal, no green or red option, no percentages', v.verdict === 0 && v.words === false);
    await page.evaluate(() => { mockGo(1); mockGo(0); });
    const again = await page.evaluate(() => ({
      picked: [...document.querySelectorAll('.mock-opt')].map(b => b.classList.contains('picked')).join(),
      verdict: document.querySelectorAll('.reveal-card,.opt.correct,.opt.wrong,.opt-pct,.dist-row,.reveal-header').length,
      words: /Correct|Incorrect|% of candidates|Answer Distribution/i.test(document.getElementById('app').innerText),
    }));
    ok('and when the question is drawn again (going away and back), the pick is still marked and still no verdict is', again.picked === 'false,true,false,false,false' && again.verdict === 0 && again.words === false, again.picked);
    await page.click('.mock-opt[data-mi="1"]');
    ok('tapping the same option again takes the answer back', await page.evaluate(() => S.mock.sel[0] === undefined && !document.querySelector('.mock-opt.picked') && /^0 answered/.test(document.getElementById('mockSub').textContent)));
    await page.evaluate(() => { window.__opt = document.querySelector('.mock-opt[data-mi="2"]'); });
    await page.click('.mock-opt[data-mi="2"]');
    ok('a tap updates the screen where it stands: the option on screen is the same element, not a redraw', await page.evaluate(() => window.__opt.isConnected && window.__opt.classList.contains('picked')));
    const sp = await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.mock')));
    ok('the pick is stored the moment it is made, before anything else is done', sp.sel[0] === 2 && !sp.flag[0], JSON.stringify([sp.sel, sp.flag]));
    await page.click('#mockFlagBtn');
    const f = await page.evaluate(() => ({ btn: document.getElementById('mockFlagBtn').classList.contains('on'), pressed: document.getElementById('mockFlagBtn').getAttribute('aria-pressed'), cell: document.querySelector('.mock-cell[data-mc="0"]').classList.contains('flag'), sub: document.getElementById('mockSub').textContent, flag: S.mock.flag[0] }));
    ok('flagging marks the button, the question\'s cell in the navigator, and the count', f.btn && f.pressed === 'true' && f.cell && /1 answered · 1 flagged/.test(f.sub) && f.flag === 1, JSON.stringify(f));
    ok('answering and flagging changed nothing in the progress record: no chapter total, no missed list, no log, no schedule', same(await snap(), before));
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.mock')));
    ok('but the block stored itself as each answer and flag was made, so a page that closes now loses neither', st.sel[0] === 2 && st.flag[0] === 1, JSON.stringify([st.sel, st.flag]));
  }
  {
    await page.click('.mock-cell[data-mc="4"]');
    const a = await page.evaluate(() => ({ i: S.mock.i, head: document.querySelector('.q-counter').textContent, cur: [...document.querySelectorAll('.mock-cell')].findIndex(c => c.classList.contains('cur')), stem: document.querySelector('.q-card').innerText }));
    ok('tapping a number in the navigator goes to that question', a.i === 4 && /Question 5 of 12/.test(a.head) && a.cur === 4, a.head);
    ok('and puts the keyboard on that question, as the quiz does, so a screen reader reads it', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('q-card')));
    await page.keyboard.press('b');
    await page.keyboard.press('f');
    const k = await page.evaluate(() => ({ sel: S.mock.sel[4], flag: S.mock.flag[4] }));
    ok('the keys work: B picks B, F flags', k.sel === 1 && k.flag === 1, JSON.stringify(k));
    await page.keyboard.press('b');
    ok('B again takes it back', await page.evaluate(() => S.mock.sel[4] === undefined));
    await page.keyboard.press('ArrowLeft');
    ok('the left arrow goes back a question, and the answer given there is still there', await page.evaluate(() => S.mock.i === 3 && S.mock.sel[3] === undefined) && (await page.evaluate(() => { mockGo(0); return S.mock.sel[0]; })) === 2);
    await page.keyboard.press('ArrowRight');
    ok('the right arrow goes forward', await page.evaluate(() => S.mock.i === 1));
    const n = await page.evaluate(() => S.mock.ids.length);
    await page.evaluate(n => { mockGo(n - 1); }, n);
    ok('the last question offers to review and hand in, not "Next"', /Review and hand in/.test(await page.evaluate(() => document.querySelector('.mock-actions .btn-next').textContent)));
    await page.click('.mock-actions .btn-next');
    const opened = await page.waitForSelector('.mock-end', { timeout: 4000 }).then(() => true, () => false);
    ok('Review and hand in opens the hand-in page', opened);
    const e = opened ? await page.evaluate(() => ({ t: document.querySelector('.mock-end').innerText, chips: [...document.querySelectorAll('.mock-end .mock-chip')].map(c => c.textContent) })) : { t: '', chips: [] };
    ok('it opens the hand-in page: how many answered, which are blank, which are flagged', /1 of 12 answered/.test(e.t) && /11 not answered/.test(e.t) && /2 flagged/.test(e.t) && e.chips.length === 13, e.t.replace(/\n+/g, ' | '));
    await page.click('.mock-end .mock-chip.flag');
    ok('a number on that page goes to the question', await page.evaluate(() => S.screen === 'mock' && S.mockView === 'q' && S.mock.i === 0));
  }

  head('the tutor is put away for a block and comes back as it was');
  await realClock(false);
  {
    const apex = () => page.evaluate(() => {
      const sh = document.getElementById('shell'), fab = document.getElementById('aiFab'), panel = document.getElementById('ai');
      return { open: sh.classList.contains('ai-open'), full: sh.classList.contains('ai-full'), fab: fab.style.display, button: getComputedStyle(fab).display !== 'none', panel: getComputedStyle(panel).display !== 'none' };
    });
    /* Apex set the way its own buttons set it (they hide the round button with a style of their own), a block begun from the
       card, then left by going Home. startWith adds the class by hand and cannot tell this from a tutor that was never open. */
    const through = async how => {
      await page.evaluate(() => goHome());                       // leave any block first: leaving is what gives Apex back
      await onScreen(page, 'home', { marker: '.hero-h1' });
      await page.evaluate(() => { document.getElementById('shell').classList.remove('ai-open', 'ai-full'); document.getElementById('aiFab').style.display = ''; });
      await clean(); await toStudy();
      await page.evaluate(how);
      const before = await apex();
      await page.evaluate(ids => { window.__build = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 60; startMock(); }, ids10);
      await onScreen(page, 'mock', { marker: '.mock-opt' });
      const during = await apex();
      await page.evaluate(() => mockGo(1));                       // the screen is drawn again while the block is open, as every answer and move does
      await page.evaluate(() => { mockStopTicker(); MockExam.build = window.__build; goHome(); });
      await onScreen(page, 'home', { marker: '.hero-h1' });
      return { before, during, after: await apex() };
    };
    const shut = await through(() => {});
    ok('a tutor that was shut stays shut, with its round button where it was', !shut.before.open && !shut.after.open && shut.before.fab === shut.after.fab && shut.after.button === true && shut.during.panel === false && shut.during.button === false, JSON.stringify(shut));
    const open = await through(() => toggleAI());
    ok('a tutor that was open is put away during the block and open again after it', open.before.open && open.before.button === false && !open.during.open && open.during.panel === false && open.during.button === false && open.after.open === true, JSON.stringify(open));
    ok('and its round button is hidden after, as it was before: the button and the panel are not both gone', open.after.fab === open.before.fab && open.after.button === false && open.after.panel === true, JSON.stringify(open.after));
    const full = await through(() => toggleApexFull());
    ok('a tutor that was full page is full page again after the block', full.before.full && !full.during.full && full.after.full === true && full.after.open === true, JSON.stringify(full));
    await page.evaluate(() => { document.getElementById('shell').classList.remove('ai-open', 'ai-full'); document.getElementById('aiFab').style.display = ''; try { localStorage.setItem('accsap12.aiopen', '0'); localStorage.setItem('accsap12.aifull', '0'); } catch (_) {} });
  }

  head('nothing the quiz said is left to be read in a block');
  {
    const said = () => page.evaluate(() => document.getElementById('srLive').textContent);
    const leave = () => page.evaluate(() => announceResult(false, { l: 'C', t: 'a right answer that must not be read out' }));   // what the quiz leaves after a wrong answer
    await clean(); await toStudy();
    await leave();
    ok('the quiz leaves the right answer in the live region, which is what has to be gone', /a right answer/.test(await said()), await said());
    await page.evaluate(ids => { window.__build = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 60; startMock(); }, ids10);
    await onScreen(page, 'mock', { marker: '.mock-opt' });
    ok('starting a block empties it', (await said()) === '', await said());
    await leave(); await page.evaluate(() => mockGo(1));
    ok('and so does moving to another question', (await said()) === '', await said());
    await page.evaluate(() => { mockStopTicker(); MockExam.build = window.__build; goHome(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await leave(); await page.evaluate(() => resumeMock());
    await onScreen(page, 'mock', { marker: '.mock-opt' });
    ok('and so does taking a block up again', (await said()) === '', await said());
    await page.evaluate(() => { mockStopTicker(); goHome(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
  }

  head('a key held down does not pick and un-pick');
  await startWith(ids10, 60);
  {
    await page.evaluate(() => { window.__keys = []; document.addEventListener('keydown', e => window.__keys.push([e.key, e.repeat]), true); });
    await page.keyboard.down('b'); await page.keyboard.down('b'); await page.keyboard.up('b');
    await page.keyboard.down('f'); await page.keyboard.down('f'); await page.keyboard.up('f');
    const k = await page.evaluate(() => ({ keys: window.__keys, sel: S.mock.sel[0], flag: S.mock.flag[0] }));
    ok('a key held down reaches the page as a repeat, so what follows is what holding does', k.keys.length === 4 && k.keys[0][1] === false && k.keys[1][1] === true && k.keys[3][1] === true, JSON.stringify(k.keys));
    ok('holding B picks B once and does not take it back', k.sel === 1, String(k.sel));
    ok('holding F flags the question once and does not take the flag off', k.flag === 1, String(k.flag));
  }

  head('a question with a figure shows it, and the block still shows no verdict');
  {
    const fig = await page.evaluate(() => POOL.find(q => q.img && IMGS[q.id] && IMGS[q.id].length).id);
    await startWith([fig], 0);
    const r = await page.evaluate(() => ({ cards: document.querySelectorAll('.mock-wrap .fig-card').length, expect: IMGS[S.mock.ids[0]].length, imgs: [...document.querySelectorAll('.fig-card img')].map(i => !!i.getAttribute('src')), alts: [...document.querySelectorAll('.fig-card img')].map(i => i.alt), n: QBYID[S.mock.ids[0]].n }));
    ok('the figure is drawn as it is in the quiz, one card for each', r.cards === r.expect && r.imgs.every(Boolean), r.cards + ' of ' + r.expect);
    ok('the question with the figure is not the bank\'s first, so its number and its place in the block differ', r.n !== 1, String(r.n));
    ok('a screen reader is told which question the figure is for by its place in the block, not by its number in the bank', r.alts.length === r.expect && r.alts.every(a => / for question 1$/.test(a)), r.alts.join(' | '));
    await page.click('.fig-card');
    ok('and tapping it enlarges it', await page.evaluate(() => document.querySelector('.fig-card').classList.contains('zoomed')));
  }

  head('a figure enlarged on one question is not enlarged on the next, nor when the question is come back to');
  {
    const figs = await page.evaluate(() => POOL.filter(q => q.img && IMGS[q.id] && IMGS[q.id].length).slice(0, 2).map(q => q.id));
    ok('the bank has two questions with figures to try it on', figs.length === 2, String(figs.length));
    if (figs.length === 2) {
      await startWith(figs, 0);
      await page.click('.fig-card');
      ok('a figure tapped is enlarged', await page.evaluate(() => S.zoomed === 0 && document.querySelectorAll('.fig-card.zoomed').length === 1));
      await page.evaluate(() => mockGo(1));
      const z = await page.evaluate(() => ({ s: S.zoomed, on: document.querySelectorAll('.fig-card.zoomed').length, cards: document.querySelectorAll('.fig-card').length }));
      ok('the next question\'s figure is not enlarged', z.s === -1 && z.on === 0 && z.cards > 0, JSON.stringify(z));
      await page.evaluate(() => mockGo(0));
      await page.click('.fig-card');
      await page.evaluate(() => { mockEnd(); mockGo(0); });
      const b = await page.evaluate(() => ({ s: S.zoomed, on: document.querySelectorAll('.fig-card.zoomed').length, cards: document.querySelectorAll('.fig-card').length }));
      ok('and coming back to the question from the hand-in page does not bring back the enlarged figure that was kept', b.s === -1 && b.on === 0 && b.cards > 0, JSON.stringify(b));
    }
  }

  head('the clock counts only while the app is on screen');
  await startWith(ids10, 60);
  {
    const t0 = base(), limit = 12 * 60 * 1000;
    const txt = () => page.evaluate(() => ({ c: document.getElementById('mockClock').textContent, u: document.getElementById('mockClock').dataset.urgency, lab: document.querySelector('.mock-clock-lab').textContent }));
    const shown = visible => page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, visible ? 'visible' : 'hidden');
    await clockAt(t0);
    let r = await tick(t0 + 1000);
    ok('after a second, a twelve-minute block says 11:59 left', r.el === 1000 && (await txt()).c === '11:59' && (await txt()).lab === 'left', JSON.stringify(await txt()));
    await tick(t0 + 4000);
    ok('the time goes to the question on screen', await page.evaluate(() => S.mock.ms[0] === 3000 + 1000 && S.mock.elapsedMs === 4000));
    await shown(false);
    await tick(t0 + 89000);
    r = await tick(t0 + 90000);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.mock')).elapsedMs);
    ok('while the app is hidden the clock does not move however many times its timer fires, and what it had is stored at once', r.el === 4000 && stored === 4000, r.el + ' / stored ' + stored);
    await shown(true);
    await clockAt(t0 + 100000);
    await tick(t0 + 102000);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const closing = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('accsap12.mock')).elapsedMs, now: S.mock.elapsedMs, held: S.mock.last }));
    ok('when the page is closing, what the clock had is stored at that moment and the clock is let go', closing.stored === closing.now && closing.now === 6000 && closing.held === null, JSON.stringify(closing));
    await clockAt(t0 + 100000);
    r = await tick(t0 + 101000);
    ok('and when it comes back it counts from then, not from before', r.el === 7000, String(r.el));
    r = await tick(t0 + 101000 + 10 * 60000);
    ok('a gap of ten minutes between ticks is counted as fifteen seconds at most', r.el === 7000 + 15000, String(r.el));
    await page.evaluate(limit => { S.mock.elapsedMs = limit - 300000; _mockSaid = { five: false, one: false }; }, limit);
    await clockAt(t0 + 200000); await tick(t0 + 201000);
    let a = await page.evaluate(() => ({ u: document.getElementById('mockClock').dataset.urgency, live: document.getElementById('srLive').textContent, c: document.getElementById('mockClock').textContent }));
    ok('five minutes from the end the clock turns amber and the screen reader is told', a.u === 'low' && a.live === 'Five minutes left.', JSON.stringify(a));
    await page.evaluate(() => { document.getElementById('srLive').textContent = 'quiet'; });
    await tick(t0 + 202000);
    ok('and it is told once, not every second', (await page.evaluate(() => document.getElementById('srLive').textContent)) === 'quiet');
    await page.evaluate(limit => { S.mock.elapsedMs = limit - 60000; }, limit);
    await clockAt(t0 + 300000); await tick(t0 + 301000);
    a = await page.evaluate(() => ({ u: document.getElementById('mockClock').dataset.urgency, live: document.getElementById('srLive').textContent }));
    ok('one minute from the end it turns red and says so', a.u === 'critical' && a.live === 'One minute left.', JSON.stringify(a));
    await page.evaluate(() => { S.mock.far = 0; S.mock.i = 0; S.mock.elapsedMs = 6 * 60000; });
    await clockAt(t0 + 400000); await tick(t0 + 401000);
    a = await page.evaluate(() => ({ s: document.getElementById('mockPace').dataset.status, t: document.getElementById('mockPace').textContent }));
    ok('far behind an even pace, it says so and names the question to be on', a.s === 'behind' && a.t === 'Behind pace · aim for question 7', a.t);
  }

  head('the real clock ticks, and ends the block at zero');
  await startWith(ids10, 60);
  {
    await realClock(true);
    await page.evaluate(() => { mockStartTicker(); });
    const e0 = await page.evaluate(() => S.mock.elapsedMs);
    await page.waitForTimeout(2600);
    const e1 = await page.evaluate(() => S.mock.elapsedMs);
    ok('the app\'s own clock runs while the block is on screen: about two and a half seconds in two and a half seconds', e1 - e0 >= 1500 && e1 - e0 <= 4000, String(e1 - e0));
    await page.evaluate(() => mockStopTicker());
    await realClock(false);
    const t0 = base();
    await page.evaluate(() => { S.mock.elapsedMs = 12 * 60000 - 500; });
    await clockAt(t0); await tick(t0 + 1000);
    const handedIn = await reached('mockreport');
    ok('at zero the app hands the block in by itself', handedIn);
    await onScreen(page, 'mockreport', { marker: '#mockSummary' });
    const r = await page.evaluate(() => ({ time: document.getElementById('mockTime').textContent, mock: S.mock, key: localStorage.getItem('accsap12.mock'), expired: S.mockLast.expired, used: S.mockLast.elapsedMs, ticker: _mockTimer }));
    ok('at zero the block is handed in by itself, and the report says time ran out at twelve minutes', /Time ran out at 12:00/.test(r.time) && r.expired === true && r.used === 12 * 60000, r.time);
    ok('nothing is left open: no block, nothing stored, no clock running', r.mock === null && r.key === null && r.ticker === null);
  }

  head('a tick that lands while the screen is changing');
  await startWith(ids10, 60);
  {
    const t0 = base();
    await page.evaluate(() => { S.mock.elapsedMs = 12 * 60000 - 500; });
    await clockAt(t0);
    /* Leaving sets the screen at once and redraws a moment later (render() swaps inside a view transition), and the page's
       timer can fire in between: that tick finds a block whose screen has gone. */
    const r = await page.evaluate(t => {
      S.screen = 'home';
      mockTick(t);
      const out = { open: !!S.mock, el: S.mock && S.mock.elapsedMs, held: S.mock && S.mock.last === null, report: S.mockLast !== null, screen: S.screen };
      S.screen = 'mock';
      return out;
    }, t0 + 1000);
    ok('a tick after the block\'s screen has been left counts nothing and hands nothing in, though it is a second past the end', r.open && r.el === 12 * 60000 - 500 && r.held && !r.report && r.screen === 'home', JSON.stringify(r));
  }

  head('a block taken up again late does not announce what it has already passed');
  await startWith(ids10, 60);
  {
    const t0 = base(), limit = 12 * 60 * 1000;
    await page.evaluate(limit => { S.mock.elapsedMs = limit - 140000; }, limit);              // two minutes twenty left: past the five-minute mark
    await page.evaluate(() => goHome());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await page.evaluate(() => resumeMock());
    await onScreen(page, 'mock', { marker: '.mock-opt' });
    await page.evaluate(() => { document.getElementById('srLive').textContent = 'quiet'; });
    await clockAt(t0); await tick(t0 + 1000);
    ok('it does not say five minutes are left when there are two', (await page.evaluate(() => document.getElementById('srLive').textContent)) === 'quiet', await page.evaluate(() => document.getElementById('srLive').textContent));
    await page.evaluate(limit => { S.mock.elapsedMs = limit - 61000; }, limit);
    await tick(t0 + 2000);
    ok('and it still says the minute when the minute comes', (await page.evaluate(() => document.getElementById('srLive').textContent)) === 'One minute left.');
    await page.evaluate(() => { _mockSaid = { five: true, one: true }; goHome(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await page.evaluate(() => { S.mock.elapsedMs = 12 * 60000 - 50000; resumeMock(); });                 // fifty seconds left: already inside the last minute
    await onScreen(page, 'mock', { marker: '.mock-opt' });
    await page.evaluate(() => { document.getElementById('srLive').textContent = 'quiet'; });
    await clockAt(t0 + 3000); await tick(t0 + 4000);
    ok('a block taken up with a minute left does not announce the minute it is already in', (await page.evaluate(() => document.getElementById('srLive').textContent)) === 'quiet', await page.evaluate(() => document.getElementById('srLive').textContent));
  }

  head('an untimed block counts up and never ends by itself');
  await startWith(ids10, 0);
  {
    const t0 = base();
    await clockAt(t0);
    await tick(t0 + 1000); await tick(t0 + 2000);
    const r = await page.evaluate(() => ({ c: document.getElementById('mockClock').textContent, lab: document.querySelector('.mock-clock-lab').textContent, pace: document.getElementById('mockPace').textContent }));
    ok('it shows the time spent, labelled elapsed, and has no pace to keep', r.c === '00:02' && r.lab === 'elapsed' && r.pace === '', JSON.stringify(r));
    await page.evaluate(() => { S.mock.elapsedMs = 1e10; });
    const t = await tick(t0 + 3000);
    ok('however long it has been, it stays open', t.screen === 'mock' && (await page.evaluate(() => !!S.mock)));
    await page.evaluate(() => { S.mock.elapsedMs = 125000; mockPick(0); mockSubmit(); });
    await onScreen(page, 'mockreport', { marker: '#mockSummary' });
    const u = await page.evaluate(() => document.getElementById('mockTime').textContent);
    ok('its report gives the time taken and says there was no limit, without a limit to set it against', /^02:05, no time limit/.test(u) && !/ of /.test(u), u);
  }

  head('pausing');
  await startWith(ids10, 60);
  {
    const t0 = base();
    await page.evaluate(() => { S.mock.elapsedMs = 5000; });
    await clockAt(t0);
    await page.evaluate(() => mockPause());
    const p = await page.evaluate(() => ({ opts: document.querySelectorAll('.mock-opt').length, paused: !!document.querySelector('.mock-paused'), stem: document.getElementById('app').innerText.includes(QBYID[S.mock.ids[S.mock.i]].s.slice(0, 20)), stored: JSON.parse(localStorage.getItem('accsap12.mock')).paused }));
    ok('pausing hides the question and the options, and says the clock is stopped', p.opts === 0 && p.paused && !p.stem && /stopped/.test(await page.evaluate(() => document.querySelector('.mock-paused').innerText)), JSON.stringify(p));
    const e0 = await page.evaluate(() => S.mock.elapsedMs);
    await tick(t0 + 30000);
    await page.keyboard.press('b');
    const e1 = await page.evaluate(() => ({ el: S.mock.elapsedMs, sel: S.mock.sel[S.mock.i] }));
    ok('time does not pass while paused, and a key press chooses nothing', e1.el === e0 && e1.sel === undefined, JSON.stringify(e1));
    await page.evaluate(() => mockUnpause());
    ok('resuming brings the question back', await page.evaluate(() => document.querySelectorAll('.mock-opt').length > 0 && !document.querySelector('.mock-paused')));
    await clockAt(t0 + 60000); await tick(t0 + 61000); await tick(t0 + 62000);
    ok('and the clock counts again from the resume, not for the pause: two seconds', (await page.evaluate(() => S.mock.elapsedMs)) === e0 + 2000);
    /* By the keyboard: Pause is the button the keys are on, and pressing it draws the screen again under them. */
    await page.focus('button[aria-label="Pause the block"]'); await page.keyboard.press('Enter');
    ok('pausing with the keyboard puts the keyboard on Resume', await page.evaluate(() => !!document.activeElement && /Resume/.test(document.activeElement.textContent) && !!document.activeElement.closest('.mock-paused')));
    await page.keyboard.press('Enter');
    ok('and resuming with it puts the keyboard on the question', await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('q-card')));
    await page.focus('.mock-navh .mock-mini'); await page.keyboard.press('Enter');
    ok('ending the block with it puts the keyboard on the heading of the hand-in page', await page.evaluate(() => !!document.activeElement && document.activeElement.tagName === 'H2' && !!document.activeElement.closest('.mock-end')));
  }

  head('leaving a block, and coming back to it');
  await startWith(ids10, 60);
  {
    await page.click('.mock-opt[data-mi="2"]'); await page.click('#mockFlagBtn');
    await realClock(true);
    /* The page's timer is started for real, then made to do nothing when it fires: the tick that would find the block left
       and stop the clock a second late is out of the picture, so only leaving itself can stop it. */
    await page.evaluate(() => { S.mock.elapsedMs = 7000; mockStartTicker(); window.__mockTick = mockTick; mockTick = () => {}; });
    const running = await page.evaluate(() => _mockTimer !== null);
    await page.evaluate(() => goHome());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    const stopped = await page.evaluate(() => { const gone = _mockTimer === null; mockTick = window.__mockTick; mockStopTicker(); return gone; });
    ok('going Home stops the app\'s own clock then and there, not at its next tick', running && stopped, JSON.stringify({ running, stopped }));
    await realClock(false);
    const s0 = await page.evaluate(() => ({ el: S.mock.elapsedMs, stored: JSON.parse(localStorage.getItem('accsap12.mock')), attr: document.documentElement.hasAttribute('data-mock'), fab: getComputedStyle(document.getElementById('aiFab')).display }));
    ok('going Home stops the clock, keeps the block, and gives the search and the tutor back', s0.attr === false && s0.fab !== 'none' && s0.stored.sel[0] === 2 && s0.stored.flag[0] === 1 && s0.stored.elapsedMs === s0.el && s0.el >= 7000, JSON.stringify([s0.el, s0.fab]));
    await page.waitForTimeout(2200);
    ok('and time at home is not charged to the block', (await page.evaluate(() => S.mock.elapsedMs)) === s0.el);
    ok('the Chapters door on the Home screen says a block is open, so it is not lost', /A mock block is open/.test(await page.evaluate(() => document.querySelector('.door-wide .door-txt i').textContent)));
    await toStudy();
    const c = await page.evaluate(() => ({ t: document.getElementById('mockCard').innerText, resume: !!document.getElementById('mockResume'), start: !!document.getElementById('mockStart') }));
    ok('the Study card now says a block is open, how far it is and how long is left, and offers to resume it', /a block is open/i.test(c.t) && /1 of 12 answered/.test(c.t) && /left/.test(c.t) && /1 flagged/.test(c.t) && c.resume && !c.start, c.t.replace(/\n+/g, ' | '));
    const idsBefore = await page.evaluate(() => S.mock.ids.slice());
    await page.evaluate(() => startMock());
    const reopened = await reached('mock');
    if (reopened) await onScreen(page, 'mock', { marker: '.mock-opt' });
    ok('starting a block while one is open opens that one, and does not replace it', reopened && await page.evaluate(ids => JSON.stringify(S.mock.ids) === JSON.stringify(ids), idsBefore));
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    await page.click('#mockDiscard');
    ok('discarding takes two taps: the first only asks', await page.evaluate(() => !!S.mock && /Tap again to discard/.test(document.getElementById('mockDiscard').textContent)));
    ok('and the keyboard is still on the button that asked, which was drawn again', await page.evaluate(() => !!document.activeElement && document.activeElement.id === 'mockDiscard'));
    await page.waitForTimeout(5400);
    ok('and if the second tap does not come, the button goes back to asking nothing', await page.evaluate(() => _mockArm === false && /Discard this block/.test(document.getElementById('mockDiscard').textContent)));
    await page.click('#mockDiscard');             // asks again, and this time Resume is pressed before the five seconds are up
    const armed = await page.evaluate(() => _mockArm === true);
    await page.click('#mockResume');
    const opened = await reached('mock');
    ok('Resume opens the block', opened);
    if (opened) await onScreen(page, 'mock', { marker: '.mock-opt' });
    const r = await page.evaluate(() => { const p = document.querySelector('.mock-opt.picked'), f = document.getElementById('mockFlagBtn'); return { i: S.mock.i, sel: S.mock.sel[0], picked: p && p.dataset.mi, flag: !!f && f.classList.contains('on'), arm: _mockArm }; });
    ok('resuming returns to the same question with the answer and the flag as they were', r.i === 0 && r.sel === 2 && r.picked === '2' && r.flag, JSON.stringify(r));
    ok('and the discard it had been asked for goes back to asking nothing, so a single tap later does not throw the block away', armed && r.arm === false, JSON.stringify({ armed, arm: r.arm }));
    await page.evaluate(() => goHome());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await toStudy();
    await page.click('#mockDiscard');
    await page.click('#mockDiscard');
    const d = await page.evaluate(() => ({ mock: S.mock, key: localStorage.getItem('accsap12.mock'), start: !!document.getElementById('mockStart') }));
    ok('the second tap throws the block away: nothing in memory, nothing stored, the card offers a new one', d.mock === null && d.key === null && d.start);
  }

  head('reloading the page in the middle of a block');
  await startWith(ids10, 60);
  {
    await page.click('.mock-opt[data-mi="3"]');
    await page.evaluate(() => { mockGo(2); mockPick(0); mockFlag(); S.mock.elapsedMs = 9000; S.mock.ms = { 0: 4000, 2: 5000 }; mockPersist(); });
    const was = await page.evaluate(() => JSON.parse(localStorage.getItem('accsap12.mock')));
    await page.reload({ waitUntil: 'load' });
    await booted(page);
    const r = await page.evaluate(() => ({ screen: S.screen, mock: S.mock && MockExam.serialize(S.mock), last: S.mock && S.mock.last, paused: S.mock && S.mock.paused, timer: _mockTimer }));
    ok('after a reload the block is back where it was: questions, order, answers, flags, place, time', r.mock && same(r.mock.ids, was.ids) && same(r.mock.sel, was.sel) && same(r.mock.flag, was.flag) && r.mock.i === 2 && r.mock.elapsedMs === 9000 && same(r.mock.ms, was.ms), JSON.stringify(r.mock && [r.mock.i, r.mock.elapsedMs]));
    ok('the app opens on Home, not on the block, with the clock stopped', r.screen === 'home' && r.last === null && r.timer === null);
    await page.waitForTimeout(1500);
    ok('and the time since the page closed is not counted', (await page.evaluate(() => S.mock.elapsedMs)) === 9000);
    await toStudy();
    ok('the Study card offers it', /a block is open/i.test(await page.evaluate(() => document.getElementById('mockCard').innerText)));
    await page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('accsap12.mock')); r.ids[0] = 'NOT_A_QUESTION';
      localStorage.setItem('accsap12.mock', JSON.stringify(r));
    });
    await page.reload({ waitUntil: 'load' }); await booted(page);
    ok('a block that names a question the bank does not have is forgotten, and its record removed', await page.evaluate(() => S.mock === null && localStorage.getItem('accsap12.mock') === null));
    const cardText = () => page.evaluate(() => document.getElementById('mockCard').innerText);
    await toStudy();
    ok('and the Study card says a block was set aside, rather than saying nothing', /could not be carried on/.test(await cardText()), (await cardText()).replace(/\n+/g, ' | ').slice(0, 160));
    await page.evaluate(ids => { window.__build = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 60; startMock(); mockStopTicker(); MockExam.build = window.__build; goStudy(); }, ids10);
    await onScreen(page, 'study', { marker: '#planCard' });
    await page.evaluate(() => { discardMock(); discardMock(); });
    ok('beginning another block takes that sentence away', !/could not be carried on/.test(await cardText()) && await page.evaluate(() => !!document.getElementById('mockStart')), (await cardText()).replace(/\n+/g, ' | ').slice(0, 160));
    await page.evaluate(() => localStorage.setItem('accsap12.mock', '{not json'));
    await page.reload({ waitUntil: 'load' }); await booted(page);
    ok('a record that is not even JSON is forgotten without an error', await page.evaluate(() => S.mock === null && localStorage.getItem('accsap12.mock') === null));
    await toStudy();
    ok('and that is said too', /could not be carried on/.test(await cardText()));
    await page.evaluate(() => {
      const ids = ['constructor', 'toString', '__proto__'];
      localStorage.setItem('accsap12.mock', JSON.stringify(MockExam.serialize(MockExam.start({ ids, secPerQ: 60, now: Date.now() }))));
    });
    await page.reload({ waitUntil: 'load' }); await booted(page);
    ok('a block whose questions are names every object answers to ("constructor", "toString") is forgotten, not carried on to a crash', await page.evaluate(() => S.mock === null && localStorage.getItem('accsap12.mock') === null));
    await page.evaluate(() => {
      const ids = POOL.slice(0, 5).map(q => q.id), r = MockExam.start({ ids, secPerQ: 60, now: 424242 });
      localStorage.setItem('accsap12.mock', JSON.stringify(MockExam.serialize(r)));
      const done = MockExam.finish(MockExam.start({ ids, secPerQ: 60, now: 424242 }), 424999, false);
      localStorage.setItem('accsap12.mocklast', JSON.stringify(MockExam.serialize(done)));
    });
    await page.reload({ waitUntil: 'load' }); await booted(page);
    ok('a block with the start time of the block already handed in is dropped, so it cannot be counted twice', await page.evaluate(() => S.mock === null && S.mockLast !== null && localStorage.getItem('accsap12.mock') === null));
    await toStudy();
    ok('but nothing is said of that one: it was handed in, and is only left over', !/could not be carried on/.test(await cardText()), (await cardText()).replace(/\n+/g, ' | ').slice(0, 160));
  }

  head('handing in counts the answers once, as the quiz would');
  const ids = await page.evaluate(() => { const per = {}, out = []; for (const q of POOL) { if (q.img) continue; per[q.ch] = per[q.ch] || 0; if (per[q.ch] < 2) { per[q.ch]++; out.push(q.id); } if (out.length === 10) break; } return out; });
  const q = await info(ids);
  /* 4 right, 3 wrong, 3 blank; two flagged */
  const plan = q.map((x, k) => k < 4 ? x.ci : k < 7 ? (x.ci + 1) % x.n : null);
  const flagged = [1, 5, 8];                    // one right, one wrong, one left blank
  await startWith(ids, 60);
  await page.evaluate(id => { S.missed.add(id); save(); }, ids[0]);            // a question missed before, answered right now
  const pre = await snap();
  const driven = await page.evaluate(({ plan, flagged }) => {
    plan.forEach((p, k) => { mockGo(k); if (p != null) mockPick(p); if (flagged.includes(k)) mockFlag(); });
    S.mock.elapsedMs = 600000; S.mock.ms = { 0: 30000, 1: 90000, 2: 20000, 3: 10000, 4: 60000, 5: 40000, 6: 5000, 7: 200000, 8: 100000, 9: 45000 };
    return { sel: S.mock.sel, flag: S.mock.flag };
  }, { plan, flagged });
  ok('the block holds the seven choices and three flags the test made, by the handlers the buttons call', Object.keys(driven.sel).length === 7 && Object.keys(driven.flag).length === 3, JSON.stringify(driven));
  const midway = await snap();
  ok('and holds them, ungraded: the record is exactly what it was before the block began', same(midway, pre));
  await page.evaluate(() => mockEnd());
  await page.waitForSelector('.mock-end');
  await page.click('.mock-end .btn-next');
  await onScreen(page, 'mockreport', { marker: '#mockSummary' });
  const post = await snap();
  const exp = (() => {
    const e = { chStats: JSON.parse(JSON.stringify(pre.chStats)), practice: JSON.parse(JSON.stringify(pre.practice)), missed: new Set(pre.missed), total: 0, right: 0 };
    q.forEach((x, k) => {
      if (plan[k] == null) return;
      const okk = plan[k] === x.ci, st = e.chStats[x.ch] || (e.chStats[x.ch] = { correct: 0, total: 0 });
      st.total++; e.total++; if (okk) { st.correct++; e.right++; e.missed.delete(x.id); } else e.missed.add(x.id);
      const pr = e.practice[x.id] || (e.practice[x.id] = { n: 0, c: 0, t: 0 }); pr.n++; if (okk) pr.c++;
    });
    return e;
  })();
  ok('the summary line is the block\'s own count: 4 right, 3 wrong, 3 not answered, of 10', await page.evaluate(() => document.getElementById('mockSummary').textContent) === '4 correct · 3 wrong · 3 not answered · of 10');
  ok('each chapter\'s right and total moved by exactly the answers given in it', same(post.chStats, exp.chStats), JSON.stringify(post.chStats).slice(0, 160));
  ok('the session counts moved by seven answered and four right: blanks are not answers', post.sessionTotal === pre.sessionTotal + 7 && post.sessionCorrect === pre.sessionCorrect + 4, `${post.sessionTotal - pre.sessionTotal}/${post.sessionCorrect - pre.sessionCorrect}`);
  ok('the missed list lost the one answered right and gained the three answered wrong, and no blank', same(post.missed, [...exp.missed].sort()), post.missed.length + ' ids');
  ok('each answered question has one more practice answer, and a blank has none', same(Object.fromEntries(Object.entries(post.practice).map(([k, v]) => [k, [v.n, v.c]])), Object.fromEntries(Object.entries(exp.practice).map(([k, v]) => [k, [v.n, v.c]]))));
  ok('today\'s count moved by seven answered and four right', post.day.a === pre.day.a + 7 && post.day.c === pre.day.c + 4, JSON.stringify(post.day));
  ok('and the review schedule was not touched', post.srs === pre.srs);
  {
    const log = await page.evaluate(n => LOG.slice(-n).map(r => ({ q: r.q, ok: r.ok, m: r.m, cf: r.cf, ms: r.ms, g: r.g })), 7);
    const want = q.slice(0, 7).map((x, k) => ({ q: x.id, ok: plan[k] === x.ci ? 1 : 0 }));
    ok('seven rows went into the review log, marked as exam answers, with who was right', log.length === 7 && log.every(r => r.m === 'exam' && r.g === null && r.cf === null) && same(log.map(r => ({ q: r.q, ok: r.ok })), want), JSON.stringify(log.slice(0, 2)));
    ok('and each row carries the time that question took, as the block measured it', same(log.map(r => r.ms), [30000, 90000, 20000, 10000, 60000, 40000, 5000]), log.map(r => r.ms).join());
  }
  {
    const r = await page.evaluate(() => ({
      mocks: JSON.parse(JSON.stringify(S.mocks)), stored: JSON.parse(localStorage.getItem('accsap12.v2')).exams,
      mock: S.mock, key: localStorage.getItem('accsap12.mock'), last: !!localStorage.getItem('accsap12.mocklast'),
      time: document.getElementById('mockTime').textContent, pct: document.querySelector('.score-pct').textContent,
      rows: [...document.querySelectorAll('.mock-chrow')].map(x => ({ ch: x.dataset.ch, count: x.querySelector('.chp-count').textContent })),
      slow: (document.querySelector('.mock-slow') || {}).innerText, text: document.querySelector('.mock-report').innerText,
    }));
    const byCh = {}; q.forEach((x, k) => { const c = byCh[x.ch] || (byCh[x.ch] = [0, 0]); c[1]++; if (plan[k] === x.ci) c[0]++; });
    const m0 = r.mocks[0] || {};                  // no summary at all must be a failed check, not a thrown error that ends the run
    ok('what is kept of the block is one summary: its size, answered, right, time, limit and chapters', r.mocks.length === 1 && m0.n === 10 && m0.answered === 7 && m0.correct === 4 && m0.ms === 600000 && m0.limit === 600000 && same(m0.by, byCh), JSON.stringify(r.mocks).slice(0, 200));
    ok('and it is in the saved record as well as in memory', same(r.stored, r.mocks));
    ok('the block in progress is gone from memory and from storage; the one handed in is kept for its report', r.mock === null && r.key === null && r.last === true);
    ok('the report says 40%, and the time: ten minutes of ten, a minute a question', r.pct === '40%' && /10:00 of 10:00/.test(r.time) && /about 60 s a question/.test(r.time), r.time);
    ok('the chapters on it are this block\'s, weakest first, each with its own right and total', same(r.rows.map(x => x.ch + ' ' + x.count), Object.entries(byCh).sort((a, b) => (a[1][0] / a[1][1]) - (b[1][0] / b[1][1]) || a[0].localeCompare(b[0])).map(([c, v]) => c + ' ' + v[0] + '/' + v[1])), r.rows.map(x => x.ch + ' ' + x.count).join(' | '));
    ok('it names the three slowest, longest first, and says how many flagged were not right', /Slowest Q8 \(.+, 03:20\) · Q9 \(.+, 01:40\) · Q2 \(.+, 01:30\)/.test((r.text.match(/Slowest[^\n]*/) || [''])[0]) && /3 flagged — 2 of them not right/.test(r.text), (r.text.match(/Slowest[^\n]*/) || [''])[0]);
  }
  {
    await page.evaluate(() => { mockSubmit(); mockSubmit(true); });
    ok('handing in again does nothing: nothing was counted twice', same(await snap(), post) && (await page.evaluate(() => S.mocks.length)) === 1);
  }

  head('the same answers, made as practice, count the same');
  {
    /* The progress record after a block is the one after the same answers given in the quiz. */
    await clean(true); await page.evaluate(id => { S.missed.add(id); save(); }, ids[0]);
    await page.evaluate(({ ids, plan }) => {
      const deck = ids.map(id => QBYID[id]);
      Object.assign(S, { screen: 'quiz', chapter: null, questions: deck, qIdx: 0, selected: null, answered: false, mode: 'all', zoomed: -1, quizCorrect: 0, quizTotal: 0, answers: {}, resumed: false });
      plan.forEach((p, k) => { if (p == null) return; S.qIdx = k; S.selected = null; S.answered = false; selectOpt(p); });
    }, { ids, plan });
    const twin = await snap();
    const counts = x => ({ c: x.chStats, st: x.sessionTotal, sc: x.sessionCorrect, m: x.missed, p: Object.fromEntries(Object.entries(x.practice).map(([k, v]) => [k, [v.n, v.c]])), d: [x.day.a, x.day.c] });
    ok('chapter totals, session counts, missed list, practice counts and the day are those the block made', same(counts(twin), counts(post)), JSON.stringify(counts(twin)).slice(0, 120));
    await page.evaluate(() => goHome());
  }

  head('reviewing a block that was handed in');
  {
    await startWith(ids, 60, true);
    await page.evaluate(({ plan, flagged }) => {
      plan.forEach((p, k) => { mockGo(k); if (p != null) mockPick(p); if (flagged.includes(k)) mockFlag(); });
      mockSubmit();
    }, { plan, flagged });
    await onScreen(page, 'mockreport', { marker: '#mockSummary' });
    const before = await snap();
    const missedIds = ids.filter((id, k) => plan[k] == null || plan[k] !== q[k].ci || flagged.includes(k));
    ok('the report offers to review exactly the wrong, the blank and the flagged', (await page.evaluate(() => document.querySelector('.results-btns .btn-next').textContent)).includes('Review the ' + missedIds.length + ' to learn from'), String(missedIds.length));
    await page.click('.results-btns .btn-next');
    const inQuiz = await reached('quiz');
    if (inQuiz) await onScreen(page, 'quiz', { marker: '.q-card' });
    const r = await page.evaluate(() => ({ mode: S.mode, ids: S.questions.map(x => x.id), rev: !!document.querySelector('.reveal-card'), wrong: document.querySelectorAll('.opt.wrong').length, right: document.querySelectorAll('.opt.correct').length, rate: !!document.querySelector('.rate-prompt'), sel: S.selected, first: S.answers[0] }));
    ok('the review is the quiz screen on exactly those questions, in the order they were asked', inQuiz && r.mode === 'mockreview' && same(r.ids, missedIds), r.ids.length + ' questions');
    const k0 = ids.indexOf(r.ids[0]), wantWrong = plan[k0] != null && plan[k0] !== q[k0].ci ? 1 : 0;
    ok('it opens on the reveal for the answer that was given: the explanation, the choice if it was wrong, the key; and no rating', r.rev && r.right === 1 && r.wrong === wantWrong && r.rate === false, JSON.stringify([r.rev, r.wrong, r.right, wantWrong]));
    ok('opening it counted nothing', same(await snap(), before));
    const wrongAt = inQuiz ? await page.evaluate(() => { const k = S.questions.findIndex((x, i) => S.answers[i] && S.answers[i].selected !== x.ci); if (k >= 0) { S.qIdx = k; restoreQuizState(); render(); } return k; }) : -1;
    ok('among the questions of the review there is one that was answered wrongly, to be asked why', wrongAt >= 0, String(wrongAt));
    if (wrongAt >= 0) {
      const reasons = () => page.evaluate(() => { const r = Calib.reasons(LOG); return { tagged: r.tagged, gap: r.counts.find(c => c.id === 'gap').n, misses: r.misses }; });
      const r0 = await reasons();
      await page.click('.miss-chip[data-why="gap"]');
      const r1 = await reasons();
      ok('a reason given for a miss in the review is counted in "Where the misses come from"', r1.tagged === r0.tagged + 1 && r1.gap === r0.gap + 1, JSON.stringify([r0, r1]));
      ok('and the misses it is asked about were counted as misses all along', r0.misses >= 3, String(r0.misses));
    }
    const blank = inQuiz ? await page.evaluate(() => { const k = S.questions.findIndex((x, i) => !S.answers[i]); S.qIdx = k; restoreQuizState(); render(); return k; }) : -1;
    ok('and among the questions of the review there is one that was left blank, to try the next two checks on', blank >= 0, String(blank));
    if (blank >= 0) {
      await page.waitForSelector('.opt:not([disabled])');
      ok('a question that was left blank is open to answer, not revealed', await page.evaluate(() => !document.querySelector('.reveal-card') && S.answered === false));
      const b0 = await snap();
      await page.evaluate(() => selectOpt(S.questions[S.qIdx].ci));
      const b1 = await snap();
      ok('answering it now counts as one practice answer, and only that one', b1.sessionTotal === b0.sessionTotal + 1 && b1.log === b0.log + 1 && b1.srs === b0.srs);
    }
    if (inQuiz) await page.evaluate(() => { S.qIdx = S.questions.length - 1; restoreQuizState(); nextQ(); });
    const backAtReport = await reached('mockreport');
    if (backAtReport) await onScreen(page, 'mockreport', { marker: '#mockSummary' });
    ok('finishing the review goes back to the report', backAtReport);
  }

  head('the report and the history survive a reload');
  {
    const before = await page.evaluate(() => ({ mocks: JSON.stringify(S.mocks), summary: document.getElementById('mockSummary').textContent }));
    await page.reload({ waitUntil: 'load' }); await booted(page);
    ok('the history is read back from the saved record', await page.evaluate(b => JSON.stringify(S.mocks) === b.mocks && S.mocks.length === 2, before));
    await toStudy();
    const c = await page.evaluate(() => document.getElementById('mockCard').innerText);
    ok('the Study card shows the score of the last block and offers its report', /Last block: \d+%/.test(c) && /see the report/.test(c), c.replace(/\n+/g, ' | '));
    const stale = await page.evaluate(() => {
      const was = S.mockLast.submittedAt; S.mockLast.submittedAt = was + 1; render();       // a report that is not the last block's: an import replaced the history, or a write failed
      const b = document.querySelector('#mockCard .mock-quiet'), out = { disabled: b.disabled, text: b.textContent.trim() };
      S.mockLast.submittedAt = was; render();
      return out;
    });
    ok('a report that is not the last block\'s is not offered with its score: the score is shown, the report is not', stale.disabled === true && /Last block: \d+%$/.test(stale.text), JSON.stringify(stale));
    await page.click('#mockCard .mock-quiet');
    const reportOpen = await reached('mockreport');
    if (reportOpen) await onScreen(page, 'mockreport', { marker: '#mockSummary' });
    ok('the report opens, with the numbers of that block', reportOpen && (await page.evaluate(() => (document.getElementById('mockSummary') || {}).textContent)) === before.summary);
  }

  head('the Progress screen shows the blocks handed in');
  {
    await page.evaluate(() => goStats());
    await onScreen(page, 'stats', { marker: '#mockPanel' });
    const r = await page.evaluate(() => ({
      head: document.querySelector('#mockPanel .panel-h').textContent,
      bars: [...document.querySelectorAll('#mockPanel .mk-bar')].map(b => ({ pct: +b.dataset.pct, h: parseFloat(b.querySelector('i').style.height), cls: b.className.replace('mk-bar ', ''), label: b.querySelector('b').textContent })),
      expect: S.mocks.map(x => Math.round(100 * x.correct / x.n)), hint: document.querySelector('#mockPanel .ref-hint').textContent, last: S.mocks[S.mocks.length - 1],
    }));
    ok('it has a bar for each block handed in, oldest first, each labelled with its score', r.head === 'Mock exam blocks · 2' && same(r.bars.map(b => b.pct), r.expect) && r.bars.every(b => b.label === b.pct + '%'), r.head + ' / ' + r.bars.map(b => b.pct));
    ok('each bar is as high as its score, and coloured by it: green from 80, amber from 60, red below', r.bars.every(b => b.h === Math.max(4, b.pct) && b.cls === (b.pct >= 80 ? 'g' : b.pct >= 60 ? 'a' : 'r')), JSON.stringify(r.bars));
    ok('it says what the last block was: its score, its size, its time, and that a blank counts as wrong', new RegExp('Last: ' + Math.round(100 * r.last.correct / r.last.n) + '%, ' + r.last.correct + ' of ' + r.last.n + ' in ').test(r.hint) && /left blank counts as wrong/.test(r.hint), r.hint);
    await page.evaluate(() => {
      S.mocks = Array.from({ length: 10 }, (_, k) => ({ ts: 1000 + k, n: 10, answered: 10, correct: k, ms: 300000, limit: 600000, ch: null, by: { Alpha: [k, 10] } }));
      render();
    });
    const m = await page.evaluate(() => ({ head: document.querySelector('#mockPanel .panel-h').textContent, pcts: [...document.querySelectorAll('#mockPanel .mk-bar')].map(b => +b.dataset.pct), h0: parseFloat(document.querySelector('#mockPanel .mk-bar i').style.height) }));
    ok('with ten blocks it shows the last eight, newest at the right, and says there are ten', m.head === 'Mock exam blocks · 10' && same(m.pcts, [20, 30, 40, 50, 60, 70, 80, 90]), m.head + ' / ' + m.pcts);
    await page.evaluate(() => { S.mocks = S.mocks.slice(0, 1); render(); });
    ok('a block with no right answer still has a bar you can see', (await page.evaluate(() => parseFloat(document.querySelector('#mockPanel .mk-bar i').style.height))) === 4);
    await page.evaluate(() => { S.mocks = []; render(); });
    /* "No panel" alone is also what a Progress screen that failed to draw at all looks like. */
    ok('with none handed in there is no panel at all, and the rest of the Progress screen is still there', await page.evaluate(() => !document.getElementById('mockPanel') && /last 30 days/i.test(document.getElementById('app').innerText)));
    await page.evaluate(() => { S.mocks = JSON.parse(localStorage.getItem('accsap12.v2')).exams; });
  }

  head('a backup carries the history, and refuses what is not sound');
  {
    const r = await page.evaluate(() => {
      const good = S.mocks[0], bad = Object.assign({}, good, { correct: good.answered + 1 });
      const t = f => { try { f(); return 'ok'; } catch (e) { return e.message; } };
      const out = {
        exported: usableStats(JSON.parse(localStorage.getItem('accsap12.v2'))).exams.length,
        filtered: usableStats({ exams: [good, bad, null, 5] }).exams.length,
        notList: usableStats({ exams: 'x' }).exams.length,
        badEntry: t(() => progressFromBackup({ exams: [good, bad] })),
        notArray: t(() => progressFromBackup({ exams: { a: 1 } })),
        none: t(() => progressFromBackup({})),
        round: progressFromBackup({ exams: [good] }).mocks.length,
        missing: progressFromBackup({}).mocks.length,
        keys: SCHEMA_KEYS.includes('exams'),
      };
      return out;
    });
    ok('the export carries the history', r.exported === 2 && r.keys, JSON.stringify(r));
    ok('an export leaves out an entry that is not sound, and a history that is not a list', r.filtered === 1 && r.notList === 0);
    ok('an import refuses a history with an entry that is not sound, or that is not a list, by name', r.badEntry === 'Invalid exam history.' && r.notArray === 'Invalid exam history.', r.badEntry + ' / ' + r.notArray);
    ok('and takes a backup with no history at all, as every backup made before this one has none', r.none === 'ok' && r.missing === 0);
    ok('a good history comes through the import', r.round === 1);
  }
  {
    const s = await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('accsap12.v2')); o.futureField = { x: 1 }; localStorage.setItem('accsap12.v2', JSON.stringify(o)); return Object.keys(o).length; });
    await page.reload({ waitUntil: 'load' }); await booted(page);
    await page.evaluate(() => save());
    ok('a field this build does not know still passes through a save, and the history is a field it does know, not one carried as foreign', await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('accsap12.v2')); return !!o.futureField && Array.isArray(o.exams) && o.exams.length === 2 && S.mocks.length === 2 && !Object.keys(FOREIGN).includes('exams') && Object.keys(FOREIGN).includes('futureField'); }));
  }

  head('Reset clears the mock exam record');
  {
    await page.evaluate(() => { const ids = POOL.slice(0, 5).map(q => q.id); S.mock = MockExam.start({ ids, secPerQ: 60, now: 5 }); mockPersist(); });
    page.once('dialog', d => d.accept());
    await page.evaluate(() => resetProgress());
    await onScreen(page, 'home', { marker: '.hero-h1' });
    const r = await page.evaluate(() => ({ mocks: S.mocks.length, last: S.mockLast, mock: S.mock, k1: localStorage.getItem('accsap12.mock'), k2: localStorage.getItem('accsap12.mocklast'), stored: JSON.parse(localStorage.getItem('accsap12.v2')).exams }));
    ok('the history, the last block and the block in progress are all gone, in memory and in storage', r.mocks === 0 && r.last === null && r.mock === null && r.k1 === null && r.k2 === null && same(r.stored, []), JSON.stringify(r));
  }

  head('every screen fits, from a phone to an iPad in landscape');
  {
    /* Measured once the entrance animations have finished (finite ones only: the glow on a card never does), as
       verify-layout does: an option sliding in is four pixels wide of its column for a third of a second. */
    const settle = () => page.evaluate(async () => {
      for (let i = 0; i < 90; i++) {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (!document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect && a.effect.getTiming().iterations))) return true;
      }
      return false;
    });
    const probe = async () => {
      await settle();
      return page.evaluate(() => {
        const de = document.documentElement, app = document.getElementById('app');
        const small = [...app.querySelectorAll('button,select,input')].filter(b => b.offsetParent && b.offsetHeight < 44).map(b => (b.id || b.className || b.tagName) + ':' + b.offsetHeight);
        return { over: de.scrollWidth - de.clientWidth, appOver: app.scrollWidth - app.clientWidth, small };
      });
    };
    const sizes = [[320, 568], [360, 780], [390, 844], [744, 1133], [834, 1194], [1194, 834], [1366, 1024]];
    const bad = [], flagWord = [];
    const check = (name, w, p, anySmall) => { if (p.over > 1 || p.appOver > 1 || (anySmall ? p.small.length : p.small.some(x => /mock/.test(x)))) bad.push(`${name}@${w} ${JSON.stringify(p)}`); };
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await clean(); await toStudy();
      check('card', w, await probe(), false);
      await startWith(ids10, 60);
      await page.evaluate(() => { mockPick(0); mockFlag(); });
      check('block', w, await probe(), true);
      await page.evaluate(() => mockGo(S.mock.ids.length - 1));          // the last question's row has the longest label: "Review and hand in"
      check('last question', w, await probe(), true);
      flagWord.push(await page.evaluate(() => [Math.round(document.querySelector('.mock-flag-l').getBoundingClientRect().width), /Flag/.test(document.getElementById('mockFlagBtn').textContent)]).then(r => [w, ...r]));
      await page.evaluate(() => mockEnd()); await page.waitForSelector('.mock-end');
      check('end', w, await probe(), true);
      await page.evaluate(() => { mockGo(0); mockPause(); });
      check('paused', w, await probe(), true);
      await page.evaluate(() => { mockUnpause(); mockSubmit(); });
      await onScreen(page, 'mockreport', { marker: '#mockSummary' });
      check('report', w, await probe(), true);
      await page.evaluate(() => {
        S.mocks = Array.from({ length: 8 }, (_, k) => ({ ts: 1000 + k, n: 40, answered: 40, correct: 5 * k, ms: 3000000, limit: 3600000, ch: null, by: { Alpha: [5 * k, 40] } }));
        goStats();
      });
      await onScreen(page, 'stats', { marker: '#mockPanel' });
      check('progress', w, await probe(), false);
    }
    await page.setViewportSize({ width: 834, height: 1194 });
    ok('on a phone the flag button shows its icon and the word stays for a screen reader; on anything wider the word is shown', flagWord.length === sizes.length && flagWord.every(([w, lw, sr]) => sr && (w <= 380 ? lw <= 1 : lw > 10)), JSON.stringify(flagWord));
    ok('the card, the block, the hand-in page, the pause and the report never run past the screen, and every control on them is at least 44 px tall', bad.length === 0, bad.join(' | ').slice(0, 400));
  }

  ok('and nothing threw throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
