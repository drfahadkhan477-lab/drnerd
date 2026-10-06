#!/usr/bin/env node
/*
 * The exam date on the Study screen: set it once, see the countdown, keep it.
 *
 *   node tests/verify-examdate.js build/synthetic/systole.html
 *
 * src/core/studyplan.js turns a date into a forecast and is held by verify-plan-pure. This holds the
 * part that is the app's: the field on the plan card, what it stores, and what survives a reload.
 *   · with no date there is a field, no countdown, no Clear button, and the forecast offers to take one;
 *   · choosing a date through the field stores it in the saved blob and shows the days left, counted
 *     here from the calendar and not from the app's own helper;
 *   · the forecast sentence uses it, a reload keeps it, today / tomorrow / a past date are worded so;
 *   · Clear removes it from the screen and from storage;
 *   · a date that is not a real day is refused, and a saved blob holding junk loads as no date.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet, settled } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-examdate.js <build.html>'); process.exit(1); }
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
  const page = watch(await browser.newPage({ viewport: { width: 430, height: 1000 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  /* A day n from today, written from the calendar: the page's own date helpers are what is under test. */
  const inDays = n => page.evaluate(n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }, n);
  const toStudy = async () => {
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    await quiet(page);
  };
  const read = () => page.evaluate(() => ({
    has: !!document.getElementById('examDate'), val: (document.getElementById('examDate') || {}).value,
    clear: !!document.getElementById('examClear'), left: (document.getElementById('examLeft') || {}).textContent || '',
    ready: (document.getElementById('planReady') || {}).textContent || '',
    stored: (() => { try { return JSON.parse(localStorage.getItem(KEY)).examDate; } catch (_) { return 'unreadable'; } })(),
    mem: S.examDate,
    h: (document.getElementById('examDate') || {}).offsetHeight || 0,
  }));
  /* Enough seen questions that the forecast says something (it will not under twenty). */
  await page.evaluate(() => {
    S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {}; S.examDate = null;
    POOL.slice(0, 30).forEach(q => { S.srs[q.id] = { difficulty: 5, stability: 3, ivl: 3, reps: 1, lapses: 0, due: '2099-01-01', last: todayISO(), sv: 1 }; });
    save();
  });

  head('no date yet');
  await toStudy();
  let r = await read();
  ok('the plan card has an exam-date field, at least 44 px tall', r.has && r.h >= 44, r.h + ' px');
  ok('no countdown and no Clear button without a date', r.left === '' && r.clear === false, JSON.stringify({ left: r.left, clear: r.clear }));
  ok('the forecast offers to take one', /exam date/i.test(r.ready), r.ready);
  ok('nothing is stored', r.stored == null && r.mem === null, JSON.stringify({ s: r.stored, m: r.mem }));

  head('choosing a date');
  const d30 = await inDays(30);
  await page.fill('#examDate', d30);
  await page.dispatchEvent('#examDate', 'change');
  await settled(page, () => S.examDate !== null, { label: 'the chosen date to reach S.examDate' });
  await onScreen(page, 'study', { marker: '#examClear' });
  r = await read();
  ok('the date is stored in the saved blob', r.stored === d30 && r.mem === d30, JSON.stringify({ s: r.stored, m: r.mem, want: d30 }));
  ok('the countdown counts the days from the calendar', r.left === '30 days to your exam', r.left);
  ok('the forecast sentence uses the date', /30 days left/.test(r.ready), r.ready);
  ok('the field shows the date and Clear appears', r.val === d30 && r.clear === true);

  head('it survives a reload');
  await page.reload({ waitUntil: 'load', timeout: 200000 });   // the real build is ~90 MB: not Playwright's 30 s default
  await booted(page);
  await toStudy();
  r = await read();
  ok('after a reload the date is still there, on the field and in the countdown', r.val === d30 && r.left === '30 days to your exam', JSON.stringify({ v: r.val, l: r.left }));

  head('today, tomorrow, and a date gone by');
  for (const [n, want] of [[1, 'Your exam is tomorrow'], [0, 'Your exam is today'], [-3, 'Your exam date has passed']]) {
    const d = await inDays(n);
    await page.evaluate(d => setExamDate(d), d);
    await onScreen(page, 'study', { marker: '#examClear' });
    r = await read();
    ok(`${n === 1 ? 'tomorrow' : n === 0 ? 'today' : 'three days ago'} reads "${want}"`, r.left === want, r.left);
  }

  head('clearing it');
  await page.click('#examClear');
  await settled(page, () => S.examDate === null, { label: 'Clear to empty S.examDate' });
  await onScreen(page, 'study', { marker: '#planCard' });
  r = await read();
  ok('Clear removes the date from the screen and from storage', r.left === '' && r.clear === false && r.val === '' && r.stored == null, JSON.stringify(r));

  head('what is not a date');
  const keep = await inDays(10);
  await page.evaluate(d => setExamDate(d), keep);
  await page.evaluate(() => setExamDate('2099-02-30'));
  ok('a day that does not exist (30 February) is refused, and the date already set stays', (await read()).mem === keep);
  await page.evaluate(() => setExamDate('next week'));
  ok('free text is refused, and the date already set stays', (await read()).mem === keep);
  await page.evaluate(() => { const b = JSON.parse(localStorage.getItem(KEY)); b.examDate = 'banana'; localStorage.setItem(KEY, JSON.stringify(b)); });
  await page.reload({ waitUntil: 'load', timeout: 200000 });   // the real build is ~90 MB: not Playwright's 30 s default
  await booted(page);
  await toStudy();
  r = await read();
  ok('a saved blob holding junk loads as no date, and the screen is intact', r.mem === null && r.has === true && r.left === '', JSON.stringify({ m: r.mem, has: r.has }));

  ok('nothing threw throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
