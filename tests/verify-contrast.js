#!/usr/bin/env node
/*
 * Every text the main screens draw, read against the pixels that are actually under it, in every theme.
 *
 *   node tests/verify-contrast.js build/synthetic/systole.html
 *
 * WHY PIXELS. verify-ink reads a list of texts against grounds it composites from background colours, and axe files
 * contrast over a translucent, blurred or gradient ground as "incomplete" and verify-a11y keeps only violations. Both are
 * blind exactly where this app draws most: glass bars, gradient cards, a glow behind a card's text, a pill that slides
 * under a tab as a sibling rather than an ancestor. F1 (the top bar's name at 1.3:1) and D2's first finding (an option's
 * letter at 3.5:1) were in that gap. So this asks the page itself: every visible text box and its colour are recorded,
 * every text is made transparent, the screen is photographed, and each text's colour is laid over the pixels under its
 * own box. A text passes on the median of those pixels (the 10th percentile is printed beside it): 4.5:1, or 3:1 for
 * large text (24px, or 18.66px bold).
 *
 * WHAT IT READS: eight screens (Home's three pages, Chapters, a question answered wrong, Progress, Notes, the Rhythm Lab)
 * at 1180x820, in the twelve theme states verify-ink uses, with motion reduced, so an animated glow is read where it rests.
 * WHAT IT LEAVES OUT: text a reader is not given (hidden, screen-reader-only, aria-hidden, on a disabled control) and a
 * text with no letter or digit in it (a separator dot). Text drawn inside a canvas is not a text node and is not read; a
 * canvas under a text is read, as the pixels it painted. Other screens, other sizes and moving states are not read.
 *
 * It prints where, the colours and the ratio, never the text: on the owner's build a question's text is licensed.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, settled, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-contrast.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* [theme, the device's own scheme, how a check names it]: verify-ink's twelve states. */
const STATES = [['auto', 'dark', 'Auto on a dark device'], ['midnight', 'light', 'Midnight'], ['nocturne', 'light', 'Nocturne'],
  ['cathlab', 'light', 'Cath Lab'], ['monitor', 'light', 'Monitor'], ['contrast', 'light', 'Contrast'],
  ['auto', 'light', 'Auto on a light device'], ['daylight', 'light', 'Daylight'], ['slate', 'light', 'Slate'], ['parchment', 'light', 'Parchment'],
  ['daylight', 'dark', 'Daylight on a dark device'], ['parchment', 'dark', 'Parchment on a dark device']];
const SCREENS = [
  ['Home', () => { goHome(); homeGo(0, false); }],
  ['Brain', () => { goHome(); homeGo(1, false); }],
  ['Labs', () => { goHome(); homeGo(2, false); }],
  ['Chapters', () => { goStudy(); }],
  ['a question answered wrong', () => { const q = POOL.find(x => !x.bad && !x.img); startAdhocQuiz([q], q.ch); selectOpt((q.ci + 1) % q.o.length); }],
  ['Progress', () => { goStats(); }],
  ['the notes', () => { goRefs(); }],
  ['the Rhythm Lab', () => { goLab(); }],
];

/* In the page: every visible text box, its colour and the opacity it is painted at. Never its text. */
const COLLECT = () => {
  const parse = s => { let m = /^rgba?\(([^)]+)\)$/.exec(s); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = /^color\(srgb ([^)]+)\)$/.exec(s); if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; } return null; };
  const name = e => !e ? '' : e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!/[A-Za-z0-9]/.test(n.nodeValue)) continue;
    const el = n.parentElement; if (!el) continue;
    if (el.closest('[hidden],.sr-only,[aria-hidden="true"],script,style,svg,:disabled,[aria-disabled="true"]')) continue;
    const cs = getComputedStyle(el); if (cs.visibility !== 'visible') continue;
    let op = 1; for (let p = el; p && p.nodeType === 1; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    const c = parse(cs.color); if (!c || c[3] * op < 0.05) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) {
      if (r.width < 2 || r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      const box = el.closest('[id],[class]'), up = box && box.parentElement && box.parentElement.closest('[id],[class]');
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, c, op, px: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 700,
        where: name(el) + (box && box !== el ? ' < ' + name(box) : '') + (up ? ' < ' + name(up) : '') });
    }
  }
  return out;
};
/* In a blank page: decode the photograph and read the pixels under each box. */
const READ = async ({ png, boxes }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  return boxes.map(b => {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
    const w = Math.max(1, Math.min(cv.width - x0, Math.floor(b.w))), h = Math.max(1, Math.min(cv.height - y0, Math.floor(b.h)));
    const d = g.getImageData(x0, y0, w, h).data, a = b.c[3] * b.op, step = Math.max(1, Math.floor((w * h) / 400)), rs = [];
    for (let i = 0; i < w * h; i += step) {
      const gr = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], t = [0, 1, 2].map(k => b.c[k] * a + gr[k] * (1 - a));
      const x = L(t), y = L(gr); rs.push((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05));
    }
    rs.sort((p, q) => p - q);
    const mid = Math.floor((w * h) / 2) * 4;
    return { where: b.where, need: (b.px >= 24 || (b.px >= 18.66 && b.bold)) ? 3 : 4.5, r50: rs[Math.floor(rs.length / 2)], r10: rs[Math.floor(rs.length / 10)],
      colour: b.c.slice(0, 3).map(Math.round).join(','), ground: [d[mid], d[mid + 1], d[mid + 2]].join(',') };
  });
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = watch(await ctx.newPage(), events, '1180px');
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.dismiss());
  await watchTransitions(page);
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  const blank = await ctx.newPage();

  /* At rest, as verify-a11y waits: the screen change over, and no transition or finite animation still listed. */
  const rest = async () => {
    await settled(page, () => !window.__vtLive, { timeout: 15000, label: 'the screen change to finish' });
    await settled(page, () => !document.getAnimations().some(a => (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)
      || (a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity)),
      { timeout: 15000, label: 'the screen\'s entrances and the theme\'s transitions to end' });
  };

  head('every text on each screen, against what is under it, in every theme');
  const per = {}, counts = {};
  let photographed = 0, hiddenWorked = true;
  for (const [id, scheme, label] of STATES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(id => setTheme(id), id);
    for (const [where, go] of SCREENS) {
      await page.evaluate(`(${go})()`);
      await rest();
      const boxes = await page.evaluate(COLLECT);
      const shown = (await page.screenshot()).toString('base64');
      await page.addStyleTag({ content: '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;transition:none!important}' })
        .then(h => h.evaluate(e => { e.id = '__contrastHide'; }));
      const png = (await page.screenshot()).toString('base64');
      await page.evaluate(() => { const s = document.getElementById('__contrastHide'); if (s) s.remove(); });
      if (boxes.length && png === shown) hiddenWorked = false;    // the text was never taken away: it would be read against itself
      photographed++;
      const read = await blank.evaluate(READ, { png, boxes });
      counts[where] = (counts[where] || 0) + read.length;
      for (const r of read) {
        if (r.r50 >= r.need) continue;
        const k = where + ': ' + r.where, row = per[k] = per[k] || { worst: Infinity, states: [] };
        row.states.push(label);
        if (r.r50 < row.worst) Object.assign(row, { worst: r.r50, r10: r.r10, need: r.need, colour: r.colour, ground: r.ground, at: label });
      }
    }
  }
  for (const [where] of SCREENS) {
    const bad = Object.entries(per).filter(([k]) => k.startsWith(where + ': '));
    ok(`${where}: every text clears its contrast on what is under it, in every theme`, bad.length === 0,
      bad.length ? bad.slice(0, 4).map(([k, v]) => `${k.slice(where.length + 2)} ${v.worst.toFixed(2)}:1 (needs ${v.need}; 10th pct ${v.r10.toFixed(2)}) `
        + `rgb(${v.colour}) on rgb(${v.ground}) in ${v.at}${v.states.length > 1 ? ' and ' + (v.states.length - 1) + ' more' : ''}`).join('; ')
        : `${counts[where]} text boxes read`);
  }

  head('it measured something');
  ok('every screen was photographed in every theme state (precondition)', photographed === STATES.length * SCREENS.length, `${photographed} of ${STATES.length * SCREENS.length}`);
  ok('every screen gave it text to read, in every state', SCREENS.every(([w]) => counts[w] >= STATES.length * 5), JSON.stringify(counts));
  ok('and taking the text away changed the photograph, so no text was read against itself', hiddenWorked);

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
