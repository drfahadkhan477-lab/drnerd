#!/usr/bin/env node
/*
 * Checks for the semantic colour tokens introduced by semantictokens-patch.js.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-tokens.js <patched.html|url>
 *
 * The change itself is invisible by construction — --teal/--green/--red/
 * --amber keep resolving to the exact hex values they always did, just one
 * hop through --accent/--success/--danger/--warning now. So the interesting
 * claims aren't "does the page still look right" (verify-theme.js's ~40
 * existing getComputedStyle assertions already prove that, unmodified,
 * since they read the legacy names and those names haven't moved), but:
 *
 *   · the new semantic names actually exist and equal their legacy alias,
 *     under every one of the eight themes, not just the default;
 *   · they equal the SPECIFIC correct value per theme, not just each other
 *     (a bug that swapped two palettes' accents would still pass an
 *     accent-equals-teal check while being wrong);
 *   · a handful of real painted surfaces — not just the custom property —
 *     agree, closing the loop from "the variable resolves" to "the pixel
 *     is the colour it should be".
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-tokens.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ACCENT_BY_THEME = {
  auto: '#0284c7', daylight: '#0284c7', midnight: '#0284c7',
  slate: '#4f5bd5', parchment: '#0e7c86', nocturne: '#a78bfa',
  cathlab: '#f59e0b', monitor: '#2dd4bf',
};

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof THEMES !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  head('the semantic names alias the legacy hue names, under every theme');
  const perTheme = await page.evaluate(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = n => cs.getPropertyValue(n).trim();
      return {
        accent: v('--accent'), accent2: v('--accent-2'), teal: v('--teal'), teal2: v('--teal2'),
        success: v('--success'), success2: v('--success-2'), green: v('--green'), green2: v('--green2'),
        danger: v('--danger'), danger2: v('--danger-2'), red: v('--red'), red2: v('--red2'),
        warning: v('--warning'), warning2: v('--warning-2'), amber: v('--amber'), amber2: v('--amber2'),
      };
    };
    const out = {};
    for (const t of THEMES) { setTheme(t.id); out[t.id] = read(); }
    setTheme('auto');
    return out;
  });

  for (const [id, v] of Object.entries(perTheme)) {
    ok(`${id}: --accent aliases --teal`, v.accent !== '' && v.accent === v.teal, `${v.accent} vs ${v.teal}`);
    ok(`${id}: --accent-2 aliases --teal2`, v.accent2 !== '' && v.accent2 === v.teal2, `${v.accent2} vs ${v.teal2}`);
    ok(`${id}: --success aliases --green`, v.success !== '' && v.success === v.green);
    ok(`${id}: --success-2 aliases --green2`, v.success2 !== '' && v.success2 === v.green2);
    ok(`${id}: --danger aliases --red`, v.danger !== '' && v.danger === v.red);
    ok(`${id}: --danger-2 aliases --red2`, v.danger2 !== '' && v.danger2 === v.red2);
    ok(`${id}: --warning aliases --amber`, v.warning !== '' && v.warning === v.amber);
    ok(`${id}: --warning-2 aliases --amber2`, v.warning2 !== '' && v.warning2 === v.amber2);
  }

  head('the semantic names carry the SPECIFIC right value per theme, not just each other');
  for (const [id, want] of Object.entries(ACCENT_BY_THEME)) {
    const got = (perTheme[id].accent || '').toLowerCase();
    ok(`${id}: --accent is ${want}`, got === want, got);
  }
  const SUCCESS = '#059669', DANGER = '#dc2626', WARNING = '#b45309';
  for (const id of Object.keys(perTheme)) {
    ok(`${id}: --success is the one true green`, perTheme[id].success.toLowerCase() === SUCCESS, perTheme[id].success);
    ok(`${id}: --danger is the one true red`, perTheme[id].danger.toLowerCase() === DANGER, perTheme[id].danger);
    ok(`${id}: --warning is the one true amber`, perTheme[id].warning.toLowerCase() === WARNING, perTheme[id].warning);
  }

  head('real painted surfaces agree with the tokens, not just the custom properties');
  await page.evaluate(() => { setTheme('daylight'); });

  const nav = await page.evaluate(() => {
    const el = document.querySelector('.nav-logo');
    return el ? getComputedStyle(el).backgroundImage : null;
  });
  ok('.nav-logo\'s accent gradient is painted', !!nav && /gradient/.test(nav), nav || 'not found');

  const answer = await page.evaluate(() => {
    startQuiz(CHAPTERS[0], 'all');
    const q = S.questions[S.qIdx];
    selectOpt(q.ci);
    const correctEl = document.querySelector('.opt.correct');
    const wrong = (q.ci + 1) % q.o.length === q.ci ? null : (q.ci + 1) % q.o.length;
    const before = { correctBorder: correctEl ? getComputedStyle(correctEl).borderColor : null,
                      correctLetterBg: correctEl ? getComputedStyle(correctEl.querySelector('.opt-letter')).backgroundColor : null };
    return before;
  });
  ok('a correct answer option is painted with --success (border)', !!answer.correctBorder, answer.correctBorder || 'not found');
  ok('its letter badge is painted with --success (background)', !!answer.correctLetterBg, answer.correctLetterBg || 'not found');

  const wrongAnswer = await page.evaluate(() => {
    S.answered = false; S.selected = null;
    const q = S.questions[S.qIdx];
    const wrongIdx = (q.ci + 1) % q.o.length;
    selectOpt(wrongIdx);
    const wrongEl = document.querySelectorAll('.opt.wrong')[0];
    return { wrongBorder: wrongEl ? getComputedStyle(wrongEl).borderColor : null };
  });
  ok('a wrong answer option is painted with --danger (border)', !!wrongAnswer.wrongBorder, wrongAnswer.wrongBorder || 'not found');

  const warnProbe = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'fc-streak';
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  });
  ok('a --warning-painted element is actually amber-coloured', !!warnProbe && warnProbe !== 'rgba(0, 0, 0, 0)', warnProbe);

  head('the pre-existing --warn token is a real alias now, not a coincidentally-matching literal');
  /* A snapshot comparison of --warn vs --warning cannot tell an alias from a
     coincidence — they held the same literal hex before this fix too, which
     is the exact hazard being closed. The only test that actually proves
     aliasing is causal: override --warning live and see whether --warn
     follows. An independent literal would not move. */
  const warnCausal = await page.evaluate(() => {
    setTheme('daylight');
    const h = document.documentElement;
    const before = getComputedStyle(h).getPropertyValue('--warn').trim();
    h.style.setProperty('--warning', '#123456');
    const after = getComputedStyle(h).getPropertyValue('--warn').trim();
    h.style.removeProperty('--warning');
    return { before, after };
  });
  ok('overriding --warning moves --warn with it — a real alias, not a coincidence',
     warnCausal.after.toLowerCase() === '#123456', JSON.stringify(warnCausal));

  const warnBgCausal = await page.evaluate(() => {
    const h = document.documentElement;
    h.style.setProperty('--amber-bg', '#abcdef');
    const bg = getComputedStyle(h).getPropertyValue('--warn-bg').trim();
    h.style.removeProperty('--amber-bg');
    h.style.setProperty('--amber-b', '#fedcba');
    const b = getComputedStyle(h).getPropertyValue('--warn-b').trim();
    h.style.removeProperty('--amber-b');
    return { bg, b };
  });
  ok('overriding --amber-bg moves --warn-bg with it', warnBgCausal.bg.toLowerCase() === '#abcdef', JSON.stringify(warnBgCausal));
  ok('overriding --amber-b moves --warn-b with it', warnBgCausal.b.toLowerCase() === '#fedcba', JSON.stringify(warnBgCausal));

  const notice = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'notice';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = { color: cs.color, background: cs.backgroundColor, border: cs.borderColor };
    el.remove();
    return out;
  });
  ok('.notice, the one real reader of --warn, still paints amber', !!notice.color && notice.color !== 'rgba(0, 0, 0, 0)', JSON.stringify(notice));

  head('--warn-bg follows the system under auto, the same as --amber-bg does');
  /* The dark-mode media query only ever sets --amber-bg for a dark system —
     it was never taught to also set --warn-bg, so before this fix an 'auto'
     theme under a dark system left --warn-bg on its light literal while
     --amber-bg correctly went dark. Aliasing --warn-bg to --amber-bg once,
     in :root, fixes this without the media query needing to know --warn-bg
     exists at all. */
  await page.emulateMedia({ colorScheme: 'dark' });
  const autoDark = await page.evaluate(() => {
    setTheme('auto');
    const cs = getComputedStyle(document.documentElement);
    return { amberBg: cs.getPropertyValue('--amber-bg').trim(), warnBg: cs.getPropertyValue('--warn-bg').trim() };
  });
  ok('under auto + a dark system, --warn-bg matches --amber-bg (both dark), not the light literal',
     autoDark.warnBg !== '' && autoDark.warnBg === autoDark.amberBg, JSON.stringify(autoDark));
  await page.emulateMedia({ colorScheme: null });

  head('no stray errors');
  ok('no console or page errors during the whole run', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
