#!/usr/bin/env node
/*
 * The iPad pass: a text size for the reading, and controls a finger can hit.
 *
 *   node tests/verify-readsize.js build/synthetic/systole.html
 *
 * What is measured, rather than assumed:
 *   · Standard is the page as it was: no attribute, and the stem, options, explanation and Apex's thread at their old
 *     sizes (worked out here, not read back from the page);
 *   · each of Large, Larger and Largest draws those four at 1.125, 1.25 and 1.4 times, in a quiz and in a mock block,
 *     on phones of 360 and 390 px (whose options start at 13 px) and an iPad, Apex's headings, tables and code with them, and leaves the chrome alone: the question's tag, the reason
 *     chips, the top bar's buttons;
 *   · the control is four items in the theme menu that say which is chosen, choosing one keeps the menu open and is
 *     announced, and the size is kept on the device across a reload, never in the saved record or a backup; a stored
 *     value that is not one of the four is Standard, and a write the storage refuses changes nothing it says it did; on a phone on its side the menu scrolls and every size can be reached;
 *   · at Largest nothing scrolls sideways at 320 px, on the quiz, the mock block or with Apex open;
 *   · Ask Apex why, the theme options and the text-size items are 44 px tall, and Apex's More and Send buttons, drawn
 *     at 40, take a tap across 44 with nothing over them;
 *   · the pencil's rail, folded and open, keeps off Apex and its Send button in each of the ways Apex opens (a sheet, a
 *     split in portrait, a column in landscape), standing just above a sheet or a split and never under the top bar; on
 *     a phone on its side it waits under the sheet as it did; with Apex full screen it is put away; and open, with Apex
 *     shut, it fits the screen on a phone, on an iPad on its side and in a short window, every tool reachable;
 *   · at Largest a word longer than its line breaks inside the stem, an option and the explanation;
 *   · nothing throws.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, quiet, onScreen } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-readsize.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.01;
const FACTORS = [1, 1.125, 1.25, 1.4];

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));

  const open = async (viewport, extra) => {
    const page = watch(await (await browser.newContext(Object.assign({ viewport, serviceWorkers: 'block' }, extra || {}))).newPage(), events, viewport.width + 'px');
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await booted(page);
    return page;
  };
  const quiz = async page => {
    await page.evaluate(() => { const q = POOL.find(x => !x.bad); startAdhocQuiz([q], null); });
    const up = await page.waitForFunction(() => S.screen === 'quiz' && !!document.querySelector('.opt') && !!document.querySelector('.q-card'), null, { timeout: 8000 }).then(() => true, () => false);
    await quiet(page);
    await page.evaluate(() => selectOpt((S.questions[S.qIdx].ci + 1) % S.questions[S.qIdx].o.length));
    await page.waitForFunction(() => S.answered === true && !!document.querySelector('.exp-text'), null, { timeout: 6000 }).catch(() => {});
    await quiet(page);
    return up;
  };
  /* Sizes as the engine computes them; null where the element is missing, which fails every comparison below. */
  const sizes = page => page.evaluate(() => {
    const fs = s => { const el = document.querySelector(s); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
    const bar = document.querySelector('#navbar .icon-btn');
    return { stem: fs('.q-card'), opt: fs('.opt'), exp: fs('.exp-text'), tag: fs('.q-tag'), chip: fs('.miss-chip'),
      bar: bar ? Math.round(bar.getBoundingClientRect().height) : null, attr: document.documentElement.getAttribute('data-read') };
  });
  const setSize = (page, n) => page.evaluate(n => setReadSize(n), n);

  head('Standard is the page as it was');
  {
    const page = await open({ width: 820, height: 1180 });
    const up = await quiz(page);
    const s = await sizes(page);
    ok('a quiz is up and answered (precondition)', up && s.exp !== null, JSON.stringify(s));
    ok('no attribute on the page by default', s.attr === null, String(s.attr));
    ok('the stem, the options and the explanation at 16 px, the tag at 11, as before', s.stem === 16 && s.opt === 16 && s.exp === 16 && s.tag === 11, JSON.stringify(s));
    ok('nothing is stored for a size never chosen', await page.evaluate(() => localStorage.getItem('accsap12.readsize') === null));
    await page.context().close();
  }

  head('each step scales the reading and only the reading');
  for (const [w, h, optBase] of [[820, 1180, 16], [390, 844, 13], [360, 780, 13]]) {
    const page = await open({ width: w, height: h });
    await quiz(page);
    const base = await sizes(page);
    for (const n of [1, 2, 3]) {
      await setSize(page, n);
      const s = await sizes(page);
      const f = FACTORS[n];
      ok(w + ' px, ' + ['', 'Large', 'Larger', 'Largest'][n] + ': stem, options and explanation at ' + f + ' times',
        s.attr === String(n) && near(s.stem, 16 * f) && near(s.opt, optBase * f) && near(s.exp, 16 * f), JSON.stringify(s));
      ok(w + ' px, ' + ['', 'Large', 'Larger', 'Largest'][n] + ': the tag, the reason chips and the top bar are as they were',
        s.tag === base.tag && s.chip === base.chip && s.bar === base.bar && base.chip !== null && base.bar !== null, JSON.stringify([base, s]));
    }
    await setSize(page, 0);
    const back = await sizes(page);
    ok(w + ' px: back to Standard removes the attribute and the old sizes return', back.attr === null && back.stem === 16 && back.opt === optBase, JSON.stringify(back));
    await page.context().close();
  }

  head('a mock block and Apex\'s thread follow it');
  {
    const page = await open({ width: 820, height: 1180 });
    await setSize(page, 2);
    await page.evaluate(() => { const ids = POOL.filter(q => !q.bad).slice(0, 3).map(q => q.id); const real = MockExam.build; MockExam.build = () => ids; _mockCfg.sec = 0; _mockCfg.n = 20; _mockCfg.ch = ''; try { startMock(); } finally { MockExam.build = real; } mockStopTicker(); });
    const inBlock = await page.waitForFunction(() => S.screen === 'mock' && !!document.querySelector('.q-card') && !!document.querySelector('.opt.mock-opt'), null, { timeout: 8000 }).then(() => true, () => false);
    const m = await page.evaluate(() => ({ stem: parseFloat(getComputedStyle(document.querySelector('.q-card')).fontSize), opt: parseFloat(getComputedStyle(document.querySelector('.opt.mock-opt')).fontSize) }));
    ok('a mock block\'s stem and options at Larger', inBlock && near(m.stem, 20) && near(m.opt, 20), JSON.stringify(m));
    await page.evaluate(() => { mockStopTicker(); S.mock = null; goHome(); });
    await quiz(page);
    await page.evaluate(() => { const k = (S.questions[S.qIdx] || {}).id || '_general'; CHATS[k] = [{ role: 'user', content: 'a question' }, { role: 'assistant', content: 'An invented reply.' }];
      AI.provider = 'gemini'; AI.gemini = { key: 'test-key', model: 'gemini-2.5-flash' }; if (!document.getElementById('shell').classList.contains('ai-open')) toggleAI(); else buildAI(); });
    const msg = await page.waitForFunction(() => !!document.querySelector('.msg.bot'), null, { timeout: 6000 }).then(() => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.msg.bot')).fontSize)), () => null);
    ok('Apex\'s thread at Larger', near(msg, 20), String(msg));
    /* The thread's own parts, from Apex's markdown as it renders a reply: a heading of each level, a table and code. */
    const parts = await page.evaluate(() => { const k = (S.questions[S.qIdx] || {}).id || '_general';
      CHATS[k] = [{ role: 'assistant', content: '### Big heading\n\n#### Small heading\n\nText with `code` in it.\n\n| a | b |\n|---|---|\n| 1 | 2 |' }]; buildAI();
      const fs = s => { const el = document.querySelector(s); return el ? parseFloat(getComputedStyle(el).fontSize) : null; };
      return { h3: fs('.msg.bot h3'), h4: fs('.msg.bot h4'), code: fs('.msg.bot code'), table: fs('.msg table'), p: fs('.msg.bot p') }; });
    ok('and its headings, tables and code with it, so a heading is still larger than the text under it', near(parts.h3, 19 * 1.25) && near(parts.h4, 16 * 1.25) && near(parts.code, 13 * 1.25) && near(parts.table, 13 * 1.25) && parts.h3 > parts.p, JSON.stringify(parts));
    await page.context().close();
  }

  head('the control');
  {
    const page = await open({ width: 820, height: 1180 });
    await quiz(page);
    await page.evaluate(() => toggleThemeMenu());
    await page.waitForFunction(() => document.getElementById('generalSettings').open, null, { timeout: 4000 }).catch(() => {});
    await quiet(page);
    const items = await page.evaluate(() => [...document.querySelectorAll('#generalSettings .read-opt')].map(b => ({ label: b.getAttribute('aria-label'), role: b.getAttribute('role'), checked: b.getAttribute('aria-checked') })));
    ok('four items in the theme menu, named, Standard checked', items.length === 4 && items.map(i => i.label).join() === 'Standard,Large,Larger,Largest' && items.every(i => i.role === 'radio') && items.map(i => i.checked).join() === 'true,false,false,false', JSON.stringify(items));
    await page.click('#generalSettings .read-opt[data-read="3"]', { timeout: 4000 }).catch(() => {});   // a control that is not there is named above, not by a throw
    const after = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-read'), open: document.getElementById('generalSettings').open,
      checked: [...document.querySelectorAll('#generalSettings .read-opt')].map(b => b.getAttribute('aria-checked')).join(), live: (document.getElementById('srLive') || {}).textContent }));
    ok('a tap on Largest chooses it, says so, and leaves the menu open', after.attr === '3' && after.open && after.checked === 'false,false,false,true' && after.live === 'Text size: Largest.', JSON.stringify(after));
    const stored = await page.evaluate(() => ({ own: localStorage.getItem('accsap12.readsize'), record: Object.keys(JSON.parse(localStorage.getItem('accsap12.v2') || '{}')).filter(k => /read/i.test(k)) }));
    ok('kept under its own key on this device, and not in the saved record', stored.own === '3' && stored.record.length === 0, JSON.stringify(stored));
    const exported = await page.evaluate(async () => {
      const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click; let blob = null;
      URL.createObjectURL = b => { blob = b; return 'blob:stub'; }; HTMLAnchorElement.prototype.click = () => {};
      try { await exportMarkup(); } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
      return blob ? await blob.text() : null;
    });
    ok('and not in a backup', typeof exported === 'string' && exported.length > 20 && !/readsize|"readSize"/i.test(exported), exported ? exported.length + ' bytes' : 'no export');
    await page.reload({ waitUntil: 'load' });
    await booted(page);
    await quiz(page);
    const kept = await sizes(page);
    ok('after a reload the size is still Largest', kept.attr === '3' && near(kept.stem, 22.4), JSON.stringify(kept));
    for (const junk of ['7', '-1', '1.5', 'abc', '']) {
      await page.evaluate(v => localStorage.setItem('accsap12.readsize', v), junk);
      const n = await page.evaluate(() => { applyReadSize(); return { attr: document.documentElement.getAttribute('data-read'), size: readSize() }; });
      ok('a stored "' + junk + '" is Standard', n.attr === null && n.size === 0, JSON.stringify(n));
    }
    /* Storage that refuses the write: the page and the menu stay where they were, and what is announced is what is kept. */
    await page.evaluate(() => { localStorage.removeItem('accsap12.readsize'); applyReadSize(); openSettings(); });
    const refused = await page.evaluate(() => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('quota'); };
      try { setReadSize(2); } finally { Storage.prototype.setItem = real; }
      return { attr: document.documentElement.getAttribute('data-read'), checked: [...document.querySelectorAll('.read-opt')].map(b => b.getAttribute('aria-checked')).join(), live: (document.getElementById('srLive') || {}).textContent }; });
    ok('a write the storage refuses changes nothing, and the menu and the announcement say Standard', refused.attr === null && refused.checked === 'true,false,false,false' && refused.live === 'Text size: Standard.', JSON.stringify(refused));
    await page.evaluate(() => localStorage.setItem('accsap12.readsize', ''));
    await page.evaluate(() => setReadSize(9));
    ok('a size that is not one of the four is refused and nothing changes', await page.evaluate(() => document.documentElement.getAttribute('data-read') === null && localStorage.getItem('accsap12.readsize') === ''));
    await page.context().close();
  }

  head('the menu on a short screen');
  {
    const page = await open({ width: 667, height: 375 }, { hasTouch: true, isMobile: true });
    await page.evaluate(() => toggleThemeMenu());
    await page.waitForFunction(() => document.getElementById('generalSettings').open, null, { timeout: 4000 }).catch(() => {});
    await quiet(page);
    const m = await page.evaluate(() => { const menu = document.getElementById('generalSettings'), b = menu.querySelector('.read-opt[data-read="3"]');
      if (!b) return { missing: true };
      const fits = menu.getBoundingClientRect().bottom <= innerHeight;
      b.scrollIntoView({ block: 'nearest' });
      const q = b.getBoundingClientRect(), el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return { fits, reach: !!el && b.contains(el), scrolls: menu.scrollHeight > menu.clientHeight };
    });
    ok('667x375: the theme menu stays inside the screen, scrolls, and Largest can be reached and tapped', m.fits && m.reach && m.scrolls, JSON.stringify(m));
    await page.context().close();
  }

  head('at Largest nothing scrolls sideways on a narrow screen');
  {
    const page = await open({ width: 320, height: 700 });
    await setSize(page, 3);
    await quiz(page);
    const q = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok('320 px, quiz: no sideways scroll', q === 0, String(q));
    /* A word longer than its line, at Largest: it breaks inside the card rather than being cut off by the card's edge. */
    const longWord = 'Pseudohypoaldosteronism'.repeat(2);
    const cut = await page.evaluate(w => { const out = {};
      for (const [k, sel] of [['stem', '.q-card'], ['option', '.opt .opt-text'], ['explanation', '.exp-text']]) {
        const el = document.querySelector(sel); if (!el) { out[k] = 'missing'; continue; }
        const span = document.createElement('span'); span.textContent = ' ' + w; el.appendChild(span);
        const host = k === 'option' ? el.closest('.opt') : el;
        out[k] = { over: el.scrollWidth - el.clientWidth, hostOver: host.scrollWidth - host.clientWidth, spanRight: Math.round(span.getBoundingClientRect().right), hostRight: Math.round(host.getBoundingClientRect().right) };
        span.remove(); }
      return out; }, longWord);
    ok('320 px, Largest: a word longer than its line breaks inside the stem, an option and the explanation, and is not cut off',
      ['stem', 'option', 'explanation'].every(k => cut[k] && cut[k].over <= 0 && cut[k].hostOver <= 0 && cut[k].spanRight <= cut[k].hostRight), JSON.stringify(cut));
    await page.evaluate(() => { AI.provider = 'gemini'; AI.gemini = { key: 'test-key', model: 'gemini-2.5-flash' }; const k = S.questions[S.qIdx].id; CHATS[k] = [{ role: 'assistant', content: 'An invented reply with a long unbroken word: '.concat('x'.repeat(10)) }]; toggleAI(); });
    await page.waitForFunction(() => !!document.querySelector('.msg.bot'), null, { timeout: 6000 }).catch(() => {});
    await quiet(page);
    const a = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, body: (() => { const b = document.getElementById('aiBody'); return b ? b.scrollWidth - b.clientWidth : -1; })() }));
    ok('320 px, Apex open: no sideways scroll on the page or in the thread', a.page === 0 && a.body === 0, JSON.stringify(a));
    await page.context().close();
  }

  head('controls a finger can hit');
  {
    const page = await open({ width: 834, height: 1194 }, { hasTouch: true, isMobile: true });
    ok('the page is one that cannot hover, as an iPad is (precondition)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
    await quiz(page);
    const ask = await page.evaluate(() => { const b = document.querySelector('.miss-ask'); return b ? b.offsetHeight : -1; });
    ok('Ask Apex why is 44 px tall', ask >= 44, String(ask));
    await page.evaluate(() => toggleThemeMenu());
    await quiet(page);
    const menu = await page.evaluate(() => ({ themes: [...document.querySelectorAll('#generalSettings .theme-opt')].map(b => b.offsetHeight), sizes: [...document.querySelectorAll('#generalSettings .read-opt')].map(b => b.offsetHeight) }));
    ok('every theme option and every text-size item is 44 px tall', menu.themes.length > 0 && menu.themes.every(x => x >= 44) && menu.sizes.length === 4 && menu.sizes.every(x => x >= 44), JSON.stringify(menu));
    await page.evaluate(() => { closeSettings(); AI.provider = 'gemini'; AI.gemini = { key: 'test-key', model: 'gemini-2.5-flash' }; toggleAI(); });
    await page.waitForFunction(() => !!document.getElementById('aiSend') && !!document.getElementById('aiMore'), null, { timeout: 6000 }).catch(() => {});
    await quiet(page);
    /* Precondition: taps reach the page. While a view transition runs, the engine hit-tests the root, and every point
       reads as <html>; the composer's text box, not the two buttons under test, says when that window has closed. */
    await page.waitForFunction(() => { const t = document.getElementById('aiIn'); if (!t) return false; const q = t.getBoundingClientRect();
      const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!el && el !== document.documentElement; }, null, { timeout: 6000 }).catch(() => {});
    /* The hit area as the engine has it: from the centre outward, in quarter pixels, as far as a tap still lands on the button. */
    const hit = await page.evaluate(() => ['aiMore', 'aiSend'].map(id => {
      const b = document.getElementById(id); if (!b) return { id, drawn: 'missing', w: 0, h: 0 };
      const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const at = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && b.contains(el); };
      const reach = (dx, dy) => { let d = 0; while (d < 40 && at(cx + dx * (d + 0.25), cy + dy * (d + 0.25))) d += 0.25; return d; };
      return { id, drawn: Math.round(r.width) + 'x' + Math.round(r.height), w: reach(-1, 0) + reach(1, 0), h: reach(0, -1) + reach(0, 1) };
    }));
    ok('More and Send are drawn at 40 px, and a tap lands on them across 44: nothing lies over them', hit.every(x => x.drawn === '40x40' && x.w >= 43.5 && x.h >= 43.5), JSON.stringify(hit));

    /* HOW WIDE AN ANSWER READS (28 October 2026). apex.css capped the answer at 72ch and nobody checked what that came
       to: `ch` is the advance of the ZERO glyph, 11.00px in DM Sans at 16px, while the average character of running
       text is 7.40px — so the cap was 792px and let 107 characters onto a line. In the portrait sheet, which docks at
       the full width of the iPad, every answer ran at 95 characters by the lowercase measure, against the 50-75 that
       reads comfortably and the 80 WCAG 1.4.8 names. Measured in characters, not in the unit the stylesheet happens to
       use, because the unit was the bug. */
    await page.evaluate(() => { const k = S.questions && S.questions.length ? S.questions[S.qIdx].id : '_general';
      CHATS[k] = [{ role: 'assistant', content: 'The invented finding starts a clock and the agent has to be given inside the window, after which the benefit in the synthetic trial disappears entirely and the course is not started at all.' }];
      buildAI(); });
    await quiet(page);
    const measure = await page.evaluate(() => {
      const p = document.querySelector('.ai-body .msg.bot p') || document.querySelector('.ai-body .msg.bot');
      if (!p) return null;
      const cs = getComputedStyle(p), probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + cs.font;
      /* The line the eye travels, in the characters it is made of: a sentence of this page's own prose, not a run of
         one letter and not the digit the `ch` unit measures. */
      probe.textContent = 'the invented finding starts a clock and the agent has to be given inside the window';
      p.appendChild(probe);
      const per = probe.getBoundingClientRect().width / probe.textContent.length;
      probe.remove();
      const w = p.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { chars: Math.round(w / per), px: Math.round(w), per: +per.toFixed(2) };
    });
    ok('an answer reads between 50 and 75 characters to the line',
       !!measure && measure.chars >= 50 && measure.chars <= 75,
       measure ? `${measure.chars} characters across ${measure.px}px at ${measure.per}px each` : 'no answer on screen');
    /* The sentence that says Apex can be wrong about something that changes care was set at 9px, the smallest type in
       the app. 11 is the floor; it is set at 12. */
    const fine = await page.evaluate(() => ['ai-disclaim', 'ai-powered'].map(c => {
      const el = document.querySelector('.' + c); return { c, px: el ? parseFloat(getComputedStyle(el).fontSize) : 0 }; }));
    ok('the safety line and the model line are at least 11 px', fine.every(f => f.px >= 11), JSON.stringify(fine));

    /* THE COMPOSER DOES NOT KEEP WHAT IT HAS ALREADY SENT. buildAI() reads the panel through apexPanelState() and
       writes it back through apexPanelRestore(), so a draft survives a rebuild mid-typing — and so did the question
       that had just gone, which then sat under the next one. A chip fires its own text, and a half-typed draft beside
       it is somebody's thought: that one stays. */
    await page.route('**/generativelanguage.googleapis.com/**', r => r.fulfill({ status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Noted.' }], role: 'model' } }] }) + '\n\n'
          + 'data: ' + JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }], role: 'model' } }] }) + '\n\n' }));
    const composer = await page.evaluate(async () => {
      const ta = document.getElementById('aiIn'), done = () => new Promise(r => { const t0 = performance.now();
        const f = () => (!aiBusy || performance.now() - t0 > 8000) ? r() : setTimeout(f, 40); f(); });
      ta.value = 'why do I keep missing these'; fire(ta.value); await done();
      const afterSend = document.getElementById('aiIn').value;
      document.getElementById('aiIn').value = 'half a thought, still being typed';
      fire('Quiz me back'); await done();
      return { afterSend, afterChip: document.getElementById('aiIn').value };
    });
    await page.unroute('**/generativelanguage.googleapis.com/**');
    ok('the composer is empty once the question has gone', composer.afterSend === '', JSON.stringify(composer.afterSend));
    ok('and a chip does not throw away what was half typed beside it', composer.afterChip === 'half a thought, still being typed', JSON.stringify(composer.afterChip));
    const railBefore = await page.evaluate(() => { const r = document.getElementById('rail'); return !!r && r.offsetWidth > 0; });
    await page.evaluate(() => toggleApexFull());
    const full = await page.evaluate(() => ({ full: document.getElementById('shell').classList.contains('ai-full'), rail: (() => { const r = document.getElementById('rail'); return !!r && r.offsetWidth === 0; })() }));
    ok('the rail is there with Apex open, and with Apex full screen it is put away', railBefore && full.full && full.rail, JSON.stringify([railBefore, full]));
    await page.evaluate(() => toggleApexFull());
    await page.context().close();
  }

  head('the pencil\'s rail and Apex, in each way Apex opens');
  const LAYOUTS = [[390, 844, 'a sheet on a phone', 'above'], [667, 375, 'a sheet on a phone on its side', 'under'], [834, 1194, 'the lower half of an iPad in portrait', 'above'],
    [1024, 1366, 'the lower half of an iPad Pro in portrait', 'above'], [900, 700, 'a column beside the question in landscape', 'beside'], [1180, 820, 'a column on a wide iPad', 'beside']];
  for (const [w, h, how, where] of LAYOUTS) {
    const page = await open({ width: w, height: h }, { hasTouch: true, isMobile: true });
    await page.evaluate(() => { AI.provider = 'gemini'; AI.gemini = { key: 'test-key', model: 'gemini-2.5-flash' }; startAdhocQuiz([POOL.find(q => !q.bad)], null); });
    await page.waitForFunction(() => S.screen === 'quiz' && !!document.getElementById('rail') && document.getElementById('rail').offsetWidth > 0, null, { timeout: 8000 }).catch(() => {});
    await quiet(page);
    await page.evaluate(() => toggleAI());
    for (const mini of [true, false]) {
      await page.evaluate(m => { T.min = m; buildRail(); }, mini);
      await page.evaluate(() => Promise.all(document.getElementById('rail').getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
      /* Precondition: the panel has finished opening, its height and the rail's box the same over half a second. */
      const settledAi = await page.waitForFunction(() => { const a = document.getElementById('ai'), s = document.getElementById('aiSend'), r = document.getElementById('rail'); if (!a || !s || !r) return false;
        const key = [a.getBoundingClientRect().height, r.getBoundingClientRect().width, r.getBoundingClientRect().top].map(Math.round).join(); const was = window.__aiKey; window.__aiKey = key; return a.getBoundingClientRect().height > 150 && was === key; }, null, { timeout: 8000, polling: 500 }).then(() => true, () => false);
      /* Apex's column is sticky beside the question: where it ends depends on how far the page is scrolled, so the rail is
         measured with the page at its end, where the column reaches lowest. */
      if (where === 'beside') { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await quiet(page); }
      const m = await page.evaluate(() => {
        const r = document.getElementById('rail'), a = document.getElementById('ai'), s = document.getElementById('aiSend'), n = document.getElementById('navbar');
        const rr = r.getBoundingClientRect(), ar = a.getBoundingClientRect(), sr = s.getBoundingClientRect(), nr = n.getBoundingClientRect();
        const over = (x, y) => !(x.right <= y.left || x.left >= y.right || x.bottom <= y.top || x.top >= y.bottom);
        const pts = [[.5, .5], [.2, .15], [.8, .15], [.2, .85], [.8, .85]].map(([fx, fy]) => { const el = document.elementFromPoint(sr.left + sr.width * fx, sr.top + sr.height * fy); return !!el && s.contains(el); });
        const c = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
        return { send: pts.every(Boolean), overAi: over(rr, ar), overNav: over(rr, nr), inView: rr.top >= 0 && rr.bottom <= innerHeight && rr.left >= 0 && rr.right <= innerWidth,
          reachable: !!c && r.contains(c), gap: Math.round(ar.top - rr.bottom) };
      });
      const tag = w + 'x' + h + ', Apex as ' + how + ', the rail ' + (mini ? 'folded' : 'open') + ': ';
      if (where === 'under') {
        ok(tag + 'Send takes a tap anywhere on it, and the rail is not pushed under the top bar (it waits under the sheet)', settledAi && m.send && !m.overNav, JSON.stringify(m));
      } else {
        ok(tag + 'Send takes a tap anywhere on it, and the rail is on the screen, off Apex and off the top bar, where a tap reaches it', settledAi && m.send && m.inView && !m.overAi && !m.overNav && m.reachable, JSON.stringify(m));
        if (where === 'above') ok(tag + 'it stands just above Apex, not far up the question', m.gap >= 0 && m.gap <= 80, String(m.gap));
      }
    }
    await page.context().close();
  }

  head('the open rail fits the screen with Apex shut');
  for (const [w, h] of [[390, 844], [1024, 768], [1180, 820], [1024, 600]]) {
    const page = await open({ width: w, height: h }, { hasTouch: true, isMobile: true });
    await page.evaluate(() => startAdhocQuiz([POOL.find(q => !q.bad)], null));
    await page.waitForFunction(() => S.screen === 'quiz' && !!document.getElementById('rail') && document.getElementById('rail').offsetWidth > 0, null, { timeout: 8000 }).catch(() => {});
    await quiet(page);
    await page.evaluate(() => { T.min = false; buildRail(); });
    await quiet(page);
    /* Precondition: the rail's entrance has finished, so what is measured is where it rests. */
    await page.evaluate(() => Promise.all(document.getElementById('rail').getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
    /* And the screen change before it has let go of the pointer: while a view transition runs, Chromium hit-tests <html>
       (tests/_render.js). The rail's own button is what a tap at its centre must reach before anything is counted. */
    await page.waitForFunction(() => { const b = document.querySelector('#rail button'); if (!b) return false; const q = b.getBoundingClientRect();
      const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!el && el !== document.documentElement; }, null, { timeout: 6000 }).catch(() => {});
    const m = await page.evaluate(() => { const r = document.getElementById('rail'); const rr = r.getBoundingClientRect();
      const tools = [...r.querySelectorAll('button')].filter(b => b.offsetWidth);
      const reach = tools.map(b => { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const q = b.getBoundingClientRect(); const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!el && b.contains(el); });
      return { box: [rr.left, rr.top, rr.right, rr.bottom].map(Math.round), inView: rr.left >= 0 && rr.right <= innerWidth && rr.top >= 0 && rr.bottom <= innerHeight, tools: tools.length, reach: reach.filter(Boolean).length }; });
    ok(w + 'x' + h + ': the open rail is inside the screen, and every one of its tools can be reached and tapped', m.inView && m.tools >= 8 && m.reach === m.tools, JSON.stringify(m));
    await page.context().close();
  }

  head('reading width');
  /* The column a tablet reads in, the way a reader app offers margins: --measure, which the navbar and the reading
     screens are drawn to. Wide is the default; Home is a full-width layout of its own. */
  {
    const page = await open({ width: 1366, height: 1024 });
    await quiz(page);
    const box = () => page.evaluate(() => { const a = document.getElementById('app').getBoundingClientRect(), n = document.querySelector('#navbar .nav').getBoundingClientRect();
      const c = document.querySelector('.q-card').getBoundingClientRect(), r = document.getElementById('rail');
      return { attr: document.documentElement.getAttribute('data-width'), app: Math.round(a.width), nav: Math.round(n.width), cardLeft: Math.round(c.left),
        rail: r && r.offsetWidth ? Math.round(r.getBoundingClientRect().right) : null, vw: innerWidth }; });
    const wide = await box();
    ok('by default the column is Wide: 1200px on a landscape iPad, the navbar with it', wide.attr === '2' && wide.app === 1200 && wide.nav === 1200, JSON.stringify(wide));
    await page.evaluate(() => toggleThemeMenu());
    await page.waitForFunction(() => document.getElementById('generalSettings').open, null, { timeout: 4000 }).catch(() => {});
    await quiet(page);
    await page.waitForFunction(() => !document.getElementById('generalSettings').getAnimations().length, null, { timeout: 4000 }).catch(() => {});
    const items = await page.evaluate(() => [...document.querySelectorAll('#generalSettings .width-opt')].map(b => ({ label: b.getAttribute('aria-label'), role: b.getAttribute('role'), checked: b.getAttribute('aria-checked'), h: b.getBoundingClientRect().height })));
    ok('four width items in the theme menu, named, Wide checked, each 44px tall', items.length === 4 && items.map(i => i.label).join() === 'Narrow,Medium,Wide,Full' &&
       items.every(i => i.role === 'radio' && i.h >= 44) && items.map(i => i.checked).join() === 'false,false,true,false', JSON.stringify(items));
    await page.click('#generalSettings .width-opt[data-width="0"]', { timeout: 4000 }).catch(() => {});
    const narrow = await box();
    const said = await page.evaluate(() => ({ live: (document.getElementById('srLive') || {}).textContent, own: localStorage.getItem('systole.readwidth'),
      checked: [...document.querySelectorAll('#generalSettings .width-opt')].map(b => b.getAttribute('aria-checked')).join() }));
    ok('a tap on Narrow sets a 720px column, says so, and is kept on this device', narrow.attr === '0' && narrow.app === 720 && said.live === 'Reading width: Narrow.' && said.own === '0' && said.checked === 'true,false,false,false', JSON.stringify([narrow, said]));
    await page.reload({ waitUntil: 'load' });
    await booted(page);
    await quiz(page);
    ok('after a reload it is still Narrow', (await box()).app === 720);
    await page.evaluate(() => setReadWidth(3));
    const full = await box();
    ok('Full runs the column edge to edge, and the question still clears the pencil rail', full.attr === '3' && full.app >= full.vw - 2 && full.cardLeft >= 92 && (full.rail === null || full.rail < full.cardLeft), JSON.stringify(full));
    await page.evaluate(() => setReadWidth(0));
    await page.evaluate(() => { goHome(); render(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
    const home = await page.evaluate(() => ({ app: Math.round(document.getElementById('app').getBoundingClientRect().width), vw: innerWidth }));
    ok('Home keeps its own full-width layout at any reading width', home.app >= home.vw - 2, JSON.stringify(home));
    for (const junk of ['7', '-1', '1.5', 'abc', '']) {
      await page.evaluate(v => localStorage.setItem('systole.readwidth', v), junk);
      const n = await page.evaluate(() => { applyReadWidth(); return { attr: document.documentElement.getAttribute('data-width'), w: readWidth() }; });
      ok('a stored "' + junk + '" is Wide', n.attr === '2' && n.w === 2, JSON.stringify(n));
    }
    await page.evaluate(() => { localStorage.removeItem('systole.readwidth'); applyReadWidth(); });
    await page.evaluate(() => { const q = POOL.find(x => x.img && IMGS[x.id] && IMGS[x.id].length); if (q) startAdhocQuiz([q], null); });
    await page.waitForFunction(() => S.screen === 'quiz' && !!document.querySelector('.fig-img'), null, { timeout: 8000 }).catch(() => {});
    await quiet(page);
    const fig = await page.evaluate(() => { const i = document.querySelector('.fig-img'); return i ? { h: Math.round(i.getBoundingClientRect().height), vh: innerHeight } : null; });
    ok('a figure in the wider column is no taller than about 60% of the window', !!fig && fig.h > 50 && fig.h <= Math.ceil(fig.vh * 0.6) + 1, JSON.stringify(fig));
    await page.context().close();
  }

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
