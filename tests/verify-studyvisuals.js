#!/usr/bin/env node
/*
 * What the Study-screen cards draw: rings, icons, pips, the pace pill, the countdown, and the voice dock.
 *
 *   node tests/verify-studyvisuals.js build/synthetic/systole.html
 *
 * The other screen suites hold what the cards DO. This holds that what they SHOW is the app's own numbers,
 * read back from the drawing, not from the function that drew it:
 *   · every icon on the Study screen and the quiz header is a symbol the page actually has (two header
 *     buttons drew nothing for a long time because their icons lived in a copy of the sprite nothing inserts);
 *   · the plan gauge's outer arc is the share of the bank seen, counted here from S.srs and POOL;
 *   · the 10 / 20 / 40 chips draw a quarter, a half and a whole circle;
 *   · the pace pill names the forecast's status, and is absent without an exam date;
 *   · the countdown number is the days to the exam, counted from the calendar;
 *   · each topic run wears its chapter's icon and colour and one pip per question;
 *   · the voice dock appears for a session, says what it is doing and which question, moves the tutor and
 *     tools out of its way, and its Stop ends the session and takes it away;
 *   · with reduced motion asked for, nothing on these cards animates; at 360 px nothing scrolls sideways.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-studyvisuals.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const STUB = () => {
  window.__said = []; window.__heard = []; window.__listens = 0;
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 0); }, cancel() {} } });
  window.SpeechRecognition = function () {
    this.start = () => { window.__listens++; const tick = () => { if (window.__heard.length) this.onresult({ results: [[{ transcript: window.__heard.shift() }]] }); else setTimeout(tick, 20); }; tick(); };
    this.stop = () => {};
  };
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 390, height: 1000 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  const inDays = n => page.evaluate(n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }, n);
  const toStudy = async () => { await page.evaluate(() => goStudy()); await onScreen(page, 'study', { marker: '#planCard' }); await quiet(page); };
  /* 60 seen, a quarter of them missed (so runs form), thirty answers a day for a week (so there is a pace). */
  const seed = (perDay) => page.evaluate(perDay => {
    /* Last reviewed twenty days ago, so recall today is well short of 100% and the inner ring has something to show. */
    const ago = new Date(); ago.setDate(ago.getDate() - 20); const t = FSRS.localDateToISO(ago); S.srs = {}; S.missed = new Set(); S.daily = {}; S.chStats = {}; S.examDate = null; _runsKey = '';
    POOL.slice(0, 60).forEach((q, i) => { S.srs[q.id] = { difficulty: 5, stability: 10, ivl: 3, reps: 1, lapses: 0, due: '2099-01-01', last: t, sv: 1 }; if (i % 4 === 0) S.missed.add(q.id); });
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); S.daily[FSRS.localDateToISO(d)] = { a: perDay, c: perDay, r: 0 }; }
    save();
  }, perDay);
  const unresolved = () => page.evaluate(() => {
    const uses = [...document.querySelectorAll('#app use, header use, #voiceDock use')].map(u => u.getAttribute('href'));
    return { n: uses.length, missing: [...new Set(uses.filter(h => !document.querySelector(h)))] };
  });

  head('the icons are ones the page has');
  await seed(30);
  await toStudy();
  let u = await unresolved();
  ok('every icon on the Study screen resolves to a symbol in the page', u.n > 10 && u.missing.length === 0, `${u.n} icons; missing: ${u.missing.join(', ') || 'none'}`);

  head('the plan gauge and the duration chips');
  const g = await page.evaluate(() => {
    const arcOf = sel => { const c = document.querySelector(sel); return c ? { frac: +c.dataset.frac, dash: parseFloat(c.getAttribute('stroke-dasharray')) } : null; };
    return { seen: arcOf('#planGauge .pg-seen'), recall: arcOf('#planGauge .pg-recall'),
      want: Object.keys(S.srs).filter(id => QBYID[id]).length / POOL.length,
      recallWant: StudyPlan.readiness({ pool: POOL, srs: S.srs, chStats: S.chStats }).retention,
      chips: [...document.querySelectorAll('#planCard [data-plan]')].map(b => ({ m: +b.dataset.plan, dash: parseFloat(b.querySelector('.mr-arc').getAttribute('stroke-dasharray')) })) };
  });
  ok('the outer ring is the share of the bank seen, counted from the saved cards', g.seen && Math.abs(g.seen.dash / 100 - g.want) < 0.002, JSON.stringify({ drawn: g.seen && g.seen.dash, want: (g.want * 100).toFixed(1) }));
  ok('the inner ring is the forecast\'s recall today', g.recall && Math.abs(g.recall.dash / 100 - g.recallWant) < 0.002, JSON.stringify({ drawn: g.recall && g.recall.dash, want: g.recallWant }));
  ok('the 10, 20 and 40 minute chips draw a quarter, a half and a whole circle', JSON.stringify(g.chips.map(c => [c.m, c.dash])) === JSON.stringify([[10, 25], [20, 50], [40, 100]]), JSON.stringify(g.chips));

  head('the pace pill and the countdown');
  let p = await page.evaluate(() => ({ pill: !!document.getElementById('pacePill'), days: !!document.getElementById('examDays') }));
  ok('without an exam date there is no pace pill and no countdown number', !p.pill && !p.days, JSON.stringify(p));
  const far = await inDays(60);
  await page.evaluate(d => setExamDate(d), far);
  await onScreen(page, 'study', { marker: '#examDays' });
  p = await page.evaluate(() => ({ pill: document.getElementById('pacePill').dataset.status, text: document.getElementById('pacePill').textContent, days: +document.getElementById('examDays').textContent,
    status: StudyPlan.readiness({ pool: POOL, srs: S.srs, chStats: S.chStats, recentPerDay: recentPerDay(), examDate: S.examDate }).status }));
  ok('sixty days out at thirty a day, the pill says the forecast is ahead', p.pill === 'ahead' && p.status === 'ahead' && /Ahead/.test(p.text), JSON.stringify(p));
  ok('the countdown number is the days to the exam, from the calendar', p.days === 60, p.days);
  await seed(1);
  const near = await inDays(3);
  await page.evaluate(d => { S.examDate = d; save(); goStudy(); }, near);
  await onScreen(page, 'study', { marker: '#examDays' });
  p = await page.evaluate(() => ({ pill: document.getElementById('pacePill').dataset.status, cls: document.getElementById('pacePill').className, days: +document.getElementById('examDays').textContent }));
  ok('three days out at one a day, the pill says behind, in the warning colour', p.pill === 'behind' && /warn/.test(p.cls), JSON.stringify(p));
  ok('and the countdown says 3', p.days === 3, p.days);

  head('topic runs wear their chapter');
  await seed(30);
  await toStudy();
  const runs = await page.evaluate(() => [...document.querySelectorAll('#runCard [data-run]')].map(b => ({
    ch: b.dataset.ch, ico: b.querySelector('.run-ico use').getAttribute('href'), want: '#i-' + (CH_ICONS[b.dataset.ch] || 'layers'),
    col: b.style.getPropertyValue('--ch').trim(), wantCol: CH_COLORS[b.dataset.ch],
    pips: b.querySelectorAll('.run-pips i').length, n: +/(\d+) questions/.exec(b.querySelector('.run-n').textContent)[1],
    ids: _runsShown[+b.dataset.run].ids.length })));
  ok('there are runs to look at', runs.length >= 1, runs.length);
  ok('each run shows its chapter\'s own icon', runs.length && runs.every(r => r.ico === r.want), JSON.stringify(runs.map(r => [r.ico, r.want])));
  ok('each run is drawn in its chapter\'s colour', runs.length && runs.every(r => r.col && r.col === r.wantCol), JSON.stringify(runs.map(r => [r.col, r.wantCol])));
  ok('one pip per question in the run', runs.length && runs.every(r => r.pips === r.ids && r.n === r.ids), JSON.stringify(runs.map(r => [r.pips, r.n, r.ids])));
  /* The invented bank only ever forms runs of three, which cannot tell "a pip per question" from "three pips".
     So the card is handed runs of five and four, made of real questions from one chapter. */
  const saved = await page.evaluate(() => { window.__realRuns = topicRunsNow; const ch = POOL[0].ch, ids = POOL.filter(q => q.ch === ch).slice(0, 9).map(q => q.id);
    topicRunsNow = () => [{ ch, ids: ids.slice(0, 5), shared: ['invented'] }, { ch, ids: ids.slice(5, 9), shared: ['invented'] }]; return ids.length; });
  await toStudy();
  const pips = await page.evaluate(() => [...document.querySelectorAll('#runCard [data-run]')].map(b => b.querySelectorAll('.run-pips i').length));
  await page.evaluate(() => { topicRunsNow = window.__realRuns; });
  ok('runs of five and four draw five and four pips', saved >= 9 && JSON.stringify(pips) === '[5,4]', JSON.stringify(pips));

  head('the voice dock');
  await page.click('#voiceStart');
  await onScreen(page, 'quiz', { marker: '.q-card' });
  await page.waitForFunction(() => window.__listens >= 1, null, { timeout: 15000 });
  const dock = await page.evaluate(() => {
    const d = document.getElementById('voiceDock'), vis = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).visibility : 'absent'; };
    return d ? { state: d.dataset.state, label: d.querySelector('.vd-state').textContent, sub: d.querySelector('.vd-sub').textContent, of: S.questions.length,
      live: d.getAttribute('aria-live'), stop: d.querySelector('#voiceStop').offsetHeight, fab: vis('.ai-fab'), rail: vis('.tool-rail'),
      pad: parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom) } : null;
  });
  ok('a voice session puts up the dock, saying it is listening', dock && dock.state === 'listening' && dock.label === 'Listening', JSON.stringify(dock));
  ok('and which question it is on', dock && dock.sub.startsWith(`Question 1 of ${dock.of}`), dock && dock.sub);
  ok('it announces itself politely to a screen reader', dock && dock.live === 'polite');
  ok('its Stop button is at least 44 px tall', dock && dock.stop >= 44, dock && dock.stop);
  ok('the tutor button and the tools step out from under it, and the quiz gains room for it', dock && dock.fab !== 'visible' && dock.rail !== 'visible' && dock.pad >= 96, JSON.stringify(dock && { fab: dock.fab, rail: dock.rail, pad: dock.pad }));
  u = await unresolved();
  ok('every icon on the quiz screen, its header and the dock resolves (focus mode and themes included)', u.missing.length === 0, u.missing.join(', ') || `${u.n} icons`);
  await page.evaluate(() => window.__heard.push('skip'));
  await page.waitForFunction(() => window.__listens >= 2, null, { timeout: 15000 });
  const sub2 = await page.evaluate(() => ({ sub: document.querySelector('#voiceDock .vd-sub').textContent, qIdx: S.qIdx, of: S.questions.length }));
  ok('after a skip the dock says the second question, as the quiz screen does', sub2.qIdx === 1 && sub2.sub.startsWith(`Question 2 of ${sub2.of}`), JSON.stringify(sub2));
  await page.click('#voiceStop');
  await page.waitForFunction(() => !document.getElementById('voiceDock'), null, { timeout: 5000 }).catch(() => {});
  const gone = await page.evaluate(() => ({ dock: !!document.getElementById('voiceDock'), on: document.body.classList.contains('voice-on'), live: _voice !== null, listens: window.__listens }));
  ok('Stop ends the session and takes the dock away', !gone.dock && !gone.on && !gone.live, JSON.stringify(gone));
  await page.waitForTimeout(500);
  ok('and nothing listens after it', (await page.evaluate(() => window.__listens)) === gone.listens);

  head('reduced motion, and a narrow phone');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toStudy();
  const anim = await page.evaluate(() => ['.voice-wave i', '#planGauge .pg-seen', '.mr-arc', '.vo-ring', '.plan-card > .fc-glow']
    .map(s => { const el = document.querySelector(s); return [s, el ? getComputedStyle(el).animationName : 'absent']; }));
  ok('with reduced motion asked for, the rings, wave, ripple and glow do not animate', anim.every(([, a]) => a === 'none'), JSON.stringify(anim));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 360, height: 900 });
  await toStudy();
  /* The cards clip what overflows them, so the page never widens: each element is measured against its own card. */
  const wide = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth,
    spill: ['planCard', 'runCard', 'voiceCard'].flatMap(id => { const c = document.getElementById(id), cr = c.getBoundingClientRect();
      return [...c.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > cr.right + 1 || r.left < cr.left - 1) && !el.closest('.fc-glow') && !el.matches('.fc-glow'); })
        .map(el => id + ' ' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.')); }) }));
  ok('at 360 px nothing scrolls sideways, and nothing spills out of its card', wide.sw <= 360 && wide.spill.length === 0, JSON.stringify({ sw: wide.sw, spill: wide.spill.slice(0, 6) }));

  ok('nothing threw throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
