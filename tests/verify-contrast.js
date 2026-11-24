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
 * WHAT IT READS: fifteen screens (Home's three pages, Chapters, a question answered wrong, Progress, Notes, the Rhythm Lab,
 * Sessions, the mock exam with an answer chosen, a figure question answered right, Apex before a key is given and with an
 * invented conversation, Settings, and the mock exam's report) at 1180x820, and eight of them on a 390x844 touch phone, in
 * the twelve theme states verify-ink uses, with motion reduced, so an animated glow is read where it rests.
 * WHAT IT LEAVES OUT: text a reader is not given (hidden, screen-reader-only, aria-hidden, on a disabled control), a text
 * with no letter or digit in it (a separator dot), text behind an open modal dialog or inside [inert] (inactive), and
 * text a reader cannot see where it is: cut away by a box that clips overflow, under a frosted bar or a sheet
 * with a solid ground, or under any element whose pixels did not change when the text was taken away. A text under a
 * transparent element is read. How many were set aside, and why, is printed.
 * Text drawn inside a canvas is not a text node and is not read; a canvas under a text is read, as the pixels it painted.
 * Other screens, other phone sizes, a page scrolled anywhere but its top (the mock exam's chosen answer aside), and moving
 * states are not read.
 *
 * It prints where, the colours and the ratio, never the text: on the owner's build a question's text is licensed.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, settled, watchTransitions, stillMoving } = require('./_render.js');

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
  ['Sessions', () => { goSessions(); }],
  /* The clock is stopped once the block is on screen, so a slow run cannot hand it in while the page is photographed. */
  /* A long stem pushes the options below the fold: the chosen one is scrolled to once the screen is drawn, and must be there. */
  ['the mock exam, an answer chosen', () => { if (S.mock) resumeMock(); else startMock(); mockStopTicker(); if (S.mock.sel[S.mock.i] !== 1) mockPick(1); },
    () => { const e = document.querySelector('.mock-opt.picked'); if (!e) return false; e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }],
  ['a figure question answered right', () => { const q = POOL.find(x => !x.bad && x.img); startAdhocQuiz([q], q.ch); selectOpt(q.ci); },
    () => { const i = document.querySelector('.fig-img'); return !!i && i.getBoundingClientRect().height > 20; }],
  /* With no key Apex shows its setup screen, as a new reader sees it first. */
  ['Apex, before a key is given', () => { goHome(); homeGo(0, false); if (document.getElementById('shell').classList.contains('ai-open')) buildAI(); else toggleAI(); },
    () => !!document.querySelector('#shell.ai-open .setup'),
    () => { if (document.getElementById('shell').classList.contains('ai-open')) toggleAI(); }],
  /* An invented conversation (synthetic text: a question, an answer with Markdown, an error), so the bubbles are read. The
     key is a placeholder held in memory for this screen only: nothing is sent, and it is taken away when the screen is left. */
  ['Apex, with a conversation', () => { goHome(); homeGo(0, false); window.__keyWas = cur().key; cur().key = 'placeholder-not-a-key';
    CHATS._general = [{ role: 'user', content: 'Why does the invented finding X7 matter?' },
      { role: 'assistant', content: '**Short answer:** it marks *invented agent SDX2* as due.\n\n- First point, with `a code`\n- Second point\n\n> A quoted line.' },
      { role: 'assistant', content: 'The invented provider did not answer.', err: true }];
    if (document.getElementById('shell').classList.contains('ai-open')) buildAI(); else toggleAI(); },
    () => !!document.querySelector('#shell.ai-open .msg.bot'),
    () => { if (document.getElementById('shell').classList.contains('ai-open')) toggleAI(); cur().key = window.__keyWas; }],
  ['Settings', () => { goHome(); homeGo(0, false); openSettings(); }, () => !!document.getElementById('generalSettings'), () => { closeSettings(); }],
  ['the mock exam\'s report', () => { if (!S.mock) startMock(); mockStopTicker(); if (S.mock.sel[S.mock.i] !== 0) mockPick(0); mockSubmit(false); }],
];
/* A phone draws the same colours in another arrangement: a text can land on another part of a glow or a gradient. */
const PHONE = ['Home', 'Brain', 'Labs', 'a question answered wrong', 'the mock exam, an answer chosen', 'Apex, before a key is given', 'Apex, with a conversation', 'Settings'];

/* In the page: every visible text box, its colour and the opacity it is painted at. Never its text. */
const COLLECT = () => {
  const parse = s => { let m = /^rgba?\(([^)]+)\)$/.exec(s); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = /^color\(srgb ([^)]+)\)$/.exec(s); if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; } return null; };
  const name = e => !e ? '' : e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  let modal = null; try { modal = document.querySelector('dialog:modal'); } catch (_) { modal = document.querySelector('dialog[open][aria-modal="true"]'); }
  const out = Object.assign([], { clipped: 0, inert: 0 }), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!/[A-Za-z0-9]/.test(n.nodeValue)) continue;
    const el = n.parentElement; if (!el) continue;
    if (el.closest('[hidden],.sr-only,[aria-hidden="true"],script,style,svg,:disabled,[aria-disabled="true"]')) continue;
    if (el.closest('[inert]') || (modal && !modal.contains(el))) { out.inert++; continue; }    // behind an open modal: inactive, not read
    const cs = getComputedStyle(el); if (cs.visibility !== 'visible') continue;
    let op = 1; for (let p = el; p && p.nodeType === 1; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    const c = parse(cs.color); if (!c || c[3] * op < 0.05) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const q of rg.getClientRects()) {
      /* A Range can report the full line even when its own element truncates it with an ellipsis. Clip to that
         element as well as its ancestors so the hidden part does not sample a neighbour's background. */
      let x0 = Math.max(0, q.left), y0 = Math.max(0, q.top), x1 = Math.min(innerWidth, q.right), y1 = Math.min(innerHeight, q.bottom);
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX !== 'visible' || as.overflowY !== 'visible') {
          const b = a.getBoundingClientRect();
          if (as.overflowX !== 'visible') { x0 = Math.max(x0, b.left); x1 = Math.min(x1, b.right); }
          if (as.overflowY !== 'visible') { y0 = Math.max(y0, b.top); y1 = Math.min(y1, b.bottom); }
        }
        if (as.position === 'fixed') break;
      }
      if (x1 - x0 < 2 || y1 - y0 < 4) {
        if (q.width >= 2 && q.height >= 4 && q.right > 0 && q.bottom > 0 && q.left < innerWidth && q.top < innerHeight) out.clipped++;
        continue;
      }
      /* Another element on top at the box's middle: a transparent button laid over a label (the label is still read), a
         frosted bar the text has scrolled under (a blur, not a text) or a sheet with a solid ground (set aside), or anything
         else under which taking the text away left the pixels as they were (set aside, by READ). The cover's own text can
         sit in the box, so a solid ground is decided from its style, not from the photographs. */
      const top = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2), cov = !top || !(el.contains(top) || top.contains(el)) ? name(top) || '(nothing)' : null;
      let blur = false;
      for (let a = cov && top; a && !a.contains(el); a = a.parentElement) {
        const as = getComputedStyle(a), f = as.backdropFilter || as.webkitBackdropFilter, g = parse(as.backgroundColor);
        if ((f && f !== 'none') || (g && g[3] >= 1 && parseFloat(as.opacity) >= 1)) { blur = true; break; }
      }
      const r = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
      const box = el.closest('[id],[class]'), up = box && box.parentElement && box.parentElement.closest('[id],[class]');
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, c, op, px: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 700, cov, blur,
        where: name(el) + (box && box !== el ? ' < ' + name(box) : '') + (up ? ' < ' + name(up) : '') });
    }
  }
  return { boxes: [...out], clipped: out.clipped, inert: out.inert };
};
/* In a blank page: decode the photograph and read the pixels under each box. */
const READ = async ({ png, shown, boxes }) => {
  const draw = async src => { const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0); return { cv, g }; };
  const { cv, g } = await draw(png), was = await draw(shown);
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
    if (b.cov) {
      const e = was.g.getImageData(x0, y0, w, h).data;
      let same = !b.blur; for (let i = 0; i < e.length && same; i++) same = e[i] === d[i];
      if (same || b.blur) return { where: b.where, under: b.cov + (b.blur ? ' (frosted or solid)' : '') };
    }
    const mid = Math.floor((w * h) / 2) * 4;
    return { where: b.where, need: (b.px >= 24 || (b.px >= 18.66 && b.bold)) ? 3 : 4.5, r50: rs[Math.floor(rs.length / 2)], r10: rs[Math.floor(rs.length / 10)],
      colour: b.c.slice(0, 3).map(Math.round).join(','), ground: [d[mid], d[mid + 1], d[mid + 2]].join(',') };
  });
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));

  /* One device: a page of the app and a blank page to read its photographs in. */
  const open = async (viewport, tag, touch) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: touch, isMobile: touch });
    const page = watch(await ctx.newPage(), events, tag);
    page.on('pageerror', e => errors.push(tag + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(tag + ': ' + m.text()); });
    page.on('dialog', d => d.dismiss());
    await watchTransitions(page);
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await booted(page);
    return { ctx, page, blank: await ctx.newPage() };
  };

  /* Every screen named, in every theme state: the failures by screen, the boxes read, the photographs taken. */
  const sweep = async ({ page, blank }, screens) => {
    /* At rest, as verify-a11y waits: the screen change over, and no transition or finite animation still listed. */
    const rest = async () => {
      await settled(page, () => !window.__vtLive, { timeout: 15000, label: 'the screen change to finish' });
      try {
        await settled(page, () => !document.getAnimations().some(a => (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)
          || (a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity)),
          { timeout: 15000, label: 'the screen\'s entrances and the theme\'s transitions to end' });
      } catch (e) {
        /* Says what never stopped, by element and property and never by text, so a run on another machine can be acted on. */
        throw new Error(`${e.message} ${await stillMoving(page)}`);
      }
    };
    const per = {}, counts = {}, skipped = { clipped: 0, covered: 0, inert: 0, under: {} }, missing = [], thin = [];
    let photographed = 0, hiddenWorked = true;
    for (const [id, scheme, label] of STATES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate(id => setTheme(id), id);
      for (const [where, go, shows, leave] of screens) {
        await page.evaluate(`(${go})()`);
        await rest();
        if (shows) { if (!await page.evaluate(`(${shows})()`)) missing.push(`${where} in ${label}`); await rest(); }
        const got = await page.evaluate(COLLECT), boxes = got.boxes;
        skipped.clipped += got.clipped; skipped.inert += got.inert;
        const shown = (await page.screenshot()).toString('base64');
        await page.addStyleTag({ content: '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;transition:none!important}' })
          .then(h => h.evaluate(e => { e.id = '__contrastHide'; }));
        const png = (await page.screenshot()).toString('base64');
        await page.evaluate(() => { const s = document.getElementById('__contrastHide'); if (s) s.remove(); });
        if (boxes.length && png === shown) hiddenWorked = false;    // the text was never taken away: it would be read against itself
        photographed++;
        if (leave) await page.evaluate(`(${leave})()`);
        const all = await blank.evaluate(READ, { png, shown, boxes }), read = all.filter(r => !r.under);
        for (const r of all) if (r.under) { skipped.covered++; skipped.under[r.under] = (skipped.under[r.under] || 0) + 1; }
        counts[where] = (counts[where] || 0) + read.length;
        if (read.length < 5) thin.push(`${where} in ${label} (${read.length})`);    // judged per state: a sum would hide one that read nothing
        for (const r of read) {
          if (r.r50 >= r.need) continue;
          const k = where + ': ' + r.where, row = per[k] = per[k] || { worst: Infinity, states: [] };
          row.states.push(label);
          if (r.r50 < row.worst) Object.assign(row, { worst: r.r50, r10: r.r10, need: r.need, colour: r.colour, ground: r.ground, at: label });
        }
      }
    }
    return { per, counts, photographed, hiddenWorked, skipped, missing, thin };
  };
  const report = (screens, { per, counts }, suffix) => {
    for (const [where] of screens) {
      const bad = Object.entries(per).filter(([k]) => k.startsWith(where + ': '));
      ok(`${where}${suffix}: every text clears its contrast on what is under it, in every theme`, bad.length === 0,
        bad.length ? bad.slice(0, 4).map(([k, v]) => `${k.slice(where.length + 2)} ${v.worst.toFixed(2)}:1 (needs ${v.need}; 10th pct ${v.r10.toFixed(2)}) `
          + `rgb(${v.colour}) on rgb(${v.ground}) in ${v.at}${v.states.length > 1 ? ' and ' + (v.states.length - 1) + ' more' : ''}`).join('; ')
          : `${counts[where]} text boxes read`);
    }
  };

  head('every text on each screen, against what is under it, in every theme (1180x820)');
  const tablet = await open({ width: 1180, height: 820 }, '1180px', false);
  const wide = await sweep(tablet, SCREENS);
  report(SCREENS, wide, '');
  await tablet.blank.setContent('<div id="contrastClip" style="width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
    + 'An invented chapter name much wider than its caption</div>');
  const clipBoxes = (await tablet.blank.evaluate(COLLECT)).boxes.filter(b => b.where.startsWith('#contrastClip'));
  const clip = await tablet.blank.locator('#contrastClip').evaluate(el => {
    const { left, right } = el.getBoundingClientRect();
    return { left, right, overflow: el.scrollWidth - el.clientWidth };
  });
  await tablet.ctx.close();

  head('and on a phone (390x844, touch)');
  const onPhone = SCREENS.filter(([w]) => PHONE.includes(w));
  const phone = await open({ width: 390, height: 844 }, '390px', true);
  const narrow = await sweep(phone, onPhone);
  report(onPhone, narrow, ', on a phone');
  await phone.ctx.close();

  head('it measured something');
  ok('every screen was photographed in every theme state, on both devices (precondition)',
    wide.photographed === STATES.length * SCREENS.length && narrow.photographed === STATES.length * PHONE.length && onPhone.length === PHONE.length,
    `${wide.photographed} of ${STATES.length * SCREENS.length}, and ${narrow.photographed} of ${STATES.length * PHONE.length} on a phone`);
  ok('what a screen is for was on screen when it was photographed, in every state on both devices (precondition)',
    !wide.missing.length && !narrow.missing.length, [...wide.missing, ...narrow.missing.map(m => m + ' on a phone')].slice(0, 4).join('; '));
  ok('every screen gave it text to read (at least five boxes) in each state on its own, on both devices', !wide.thin.length && !narrow.thin.length,
    wide.thin.length || narrow.thin.length ? [...wide.thin, ...narrow.thin.map(t => t + ' on a phone')].slice(0, 4).join('; ') : JSON.stringify(wide.counts) + ' ' + JSON.stringify(narrow.counts));
  ok('and taking the text away changed the photograph, so no text was read against itself', wide.hiddenWorked && narrow.hiddenWorked);
  ok('a truncated caption is measured within its own clipping box', clip.overflow > 0 && clipBoxes.length > 0
    && clipBoxes.every(b => b.x >= clip.left && b.x + b.w <= clip.right),
    `visible x=${clip.left}–${clip.right}, samples end at ${clipBoxes.map(b => b.x + b.w).join(', ')}`);
  /* A text set aside as covered is not read at all, so an element laid over the whole screen would empty the sweep. */
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0), under = d => Object.entries(d.skipped.under).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k || '(nothing)'} ${n}`).join(', ');
  ok('fewer text boxes were set aside as scrolled out of sight or covered than were read, on each device',
    wide.skipped.clipped + wide.skipped.inert + wide.skipped.covered < sum(wide.counts) && narrow.skipped.clipped + narrow.skipped.inert + narrow.skipped.covered < sum(narrow.counts),
    `1180px: ${sum(wide.counts)} read, ${wide.skipped.clipped} clipped, ${wide.skipped.inert} behind a modal, ${wide.skipped.covered} covered (by ${under(wide)}); `
    + `390px: ${sum(narrow.counts)} read, ${narrow.skipped.clipped} clipped, ${narrow.skipped.inert} behind a modal, ${narrow.skipped.covered} covered (by ${under(narrow)})`);

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
