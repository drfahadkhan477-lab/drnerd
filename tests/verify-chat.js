#!/usr/bin/env node
/*
 * Checks for the Apex panel: what it keeps, what it sends, and what it
 * survives.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-chat.js <patched.html|url>
 *
 * These are the complaints you only have after using the thing for an hour,
 * which is why none of them showed up in the suites that came before. The
 * panel is rebuilt wholesale after every tool step, and each rebuild used to
 * throw away the sentence you were typing and the place you had scrolled to.
 * The thread only ever grew, on the wire and on disk. And a config naming a
 * provider this build does not have took the whole panel down before it could
 * render the settings screen you would have fixed it from.
 *
 * Everything here is driven through the real panel and read off the real
 * request. Nothing asserts on state that only the test can see.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-chat.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const sse = text => [
  `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}`,
  'data: [DONE]',
  '',
].join('\n\n');

/* A tool round, so the panel rebuilds mid-reply — which is exactly when the
   composer used to be wiped. */
const TOOL_SSE = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_performance","arguments":"{}"}}]}}]}',
  'data: [DONE]',
  '',
].join('\n\n');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text());
  });

  const captured = [];
  const queued = [];
  await page.route('**/v1/chat/completions', route => {
    try { captured.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { captured.push(null); }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: queued.shift() || sse('Noted.') });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(800);

  const openPanel = () => page.evaluate(() => {
    AI.provider = 'mistral';
    AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
    const q = ALL_Q.find(x => !x.bad);
    jumpTo(q.id);
    const sh = document.getElementById('shell');
    if (!sh.classList.contains('ai-open')) toggleAI();
    buildAI();
    return q.id;
  });

  const qid = await openPanel();

  head('the composer survives a rebuild');
  {
    await page.evaluate(() => { delete CHATS[Object.keys(CHATS)[0]]; });
    queued.length = 0; queued.push(TOOL_SSE, sse('Here is your record.'));
    /* Type a real follow-up into the real textarea, then fire — the tool step
       rebuilds the panel underneath it. */
    await page.fill('#aiIn', 'and what about the RV?');
    await page.evaluate(() => { const t = document.getElementById('aiIn'); t.focus(); t.setSelectionRange(4, 4); });
    await page.evaluate(() => fire('how am I doing?'));
    await page.waitForTimeout(2600);
    const after = await page.evaluate(() => {
      const t = document.getElementById('aiIn');
      return { value: t ? t.value : null, start: t ? t.selectionStart : -1,
               focused: !!t && document.activeElement === t, tall: t ? parseInt(t.style.height || '0', 10) : 0 };
    });
    ok('what you were typing is still there after a tool step',
       after.value === 'and what about the RV?', JSON.stringify(after.value));
    ok('and the caret did not jump to the end', after.start === 4, String(after.start));
    ok('and it is still the focused field', after.focused === true);
  }

  head('the scroll stays where you were reading');
  {
    /* A thread long enough to scroll, then scroll up and rebuild. */
    await page.evaluate(qid => {
      const h = CHATS[qid] || (CHATS[qid] = []);
      h.length = 0;
      for (let i = 0; i < 24; i++) {
        h.push({ role: 'user', content: 'question number ' + i });
        h.push({ role: 'assistant', content: ('paragraph ' + i + ' ').repeat(40) });
      }
      buildAI();
    }, qid);
    await page.waitForTimeout(300);
    const moved = await page.evaluate(() => {
      const b = document.getElementById('aiBody');
      b.scrollTop = 200;
      const before = b.scrollTop;
      buildAI();
      const el = document.getElementById('aiBody');
      return { before, after: el.scrollTop, max: el.scrollHeight - el.clientHeight };
    });
    ok('the panel is actually scrollable, so this measures something',
       moved.max > 400, `${moved.max}px of scroll`);
    ok('a rebuild does not drag you back to the bottom',
       Math.abs(moved.after - moved.before) < 8, `${moved.before} → ${moved.after}`);
    const pinned = await page.evaluate(() => {
      const b = document.getElementById('aiBody');
      b.scrollTop = b.scrollHeight;
      buildAI();
      const el = document.getElementById('aiBody');
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    ok('but if you were at the bottom it still follows the reply', pinned < 40, `${pinned}px from bottom`);
  }

  head('the thread is a window, not an archive');
  {
    const sent = await page.evaluate(async qid => {
      const h = CHATS[qid] || (CHATS[qid] = []);
      h.length = 0;
      /* Comfortably past APEX_KEEP: a fixture that sits exactly at the ceiling
         measures nothing, because trimming and not trimming give the same
         answer. */
      for (let i = 0; i < 60; i++) {
        h.push({ role: 'user', content: 'turn ' + i });
        h.push({ role: 'assistant', content: 'reply ' + i });
      }
      return { total: h.length };
    }, qid);
    captured.length = 0; queued.length = 0;
    await page.evaluate(() => fire('one more'));
    await page.waitForTimeout(1600);
    const req = captured.find(Boolean);
    /* Mistral's wire puts the system prompt as messages[0]. Stripping it here
       isolates the conversation window, so the assertions below stay about
       the windowing, not the wire. */
    const allMsgs = (req && req.messages) || [];
    const msgs = (allMsgs[0] && allMsgs[0].role === 'system') ? allMsgs.slice(1) : allMsgs;
    ok('a long thread exists to be windowed', sent.total === 120, String(sent.total));
    ok('the request carries a window, not the whole thread',
       msgs.length > 0 && msgs.length <= 17, `${msgs.length} messages`);
    ok('it still ends with what you just asked',
       String(msgs[msgs.length - 1] && msgs[msgs.length - 1].content).includes('one more'));
    ok('and it opens on a user turn, so the roles still alternate',
       msgs[0] && msgs[0].role === 'user', msgs[0] && msgs[0].role);
    ok('no two turns of the same role sit next to each other',
       msgs.every((m, i) => i === 0 || m.role !== msgs[i - 1].role));
    ok('the elision is stated rather than silent',
       /not included/.test(String(msgs[0] && msgs[0].content)),
       String(msgs[0] && msgs[0].content).slice(0, 48));
    ok('the oldest turns really are gone from the wire',
       !JSON.stringify(msgs).includes('"turn 0"'));

    const stored = await page.evaluate(qid => (CHATS[qid] || []).length, qid);
    ok('and storage has a ceiling too', stored <= 62, `${stored} kept`);
  }

  head('the figure strip is derived once');
  {
    /* Point the panel at a real seeded note that really carries a figure —
       counting calls in a state where the strip is empty measures nothing. */
    const counted = await page.evaluate(qid => {
      const note = REF.find(r => extractRefImages(r.body).some(i => refImgSrc(i.key)));
      if (!note) return { skip: true };
      lastHits = [{ kind: 'r', id: note.id, title: note.title }];
      lastHitsKey = qid;
      const h = CHATS[qid] || (CHATS[qid] = []);
      h.length = 0;
      h.push({ role: 'user', content: 'show me that figure' });
      h.push({ role: 'assistant', content: 'Here.' });

      const real = window.refFiguresForHits;
      let n = 0;
      window.refFiguresForHits = function () { n++; return real.apply(this, arguments); };
      buildAI();
      const first = n;
      const shown = document.querySelectorAll('.fig-strip .ai-fig').length;
      buildAI(); buildAI(); buildAI();
      const after = n;
      window.refFiguresForHits = real;
      return { first, after, shown };
    }, qid);
    ok('a figure really is on screen, so this measures something',
       !counted.skip && counted.shown > 0, counted.skip ? 'no seeded note with a figure' : `${counted.shown} figure(s)`);
    ok('deriving it happened at all', counted.first > 0, `${counted.first} call(s)`);
    ok('three further rebuilds do not re-walk the library',
       counted.after === counted.first, `${counted.first} → ${counted.after} calls`);
  }

  head('the prompts are there when asked for, and not before');
  {
    const chips = await page.evaluate(() => {
      const strip = document.getElementById('aiChips'), more = document.getElementById('aiMore');
      if (!strip || !more) return null;
      const shut = { display: getComputedStyle(strip).display,
                     h: Math.round(strip.getBoundingClientRect().height),
                     aria: more.getAttribute('aria-expanded') };
      more.click();
      const open = { display: getComputedStyle(strip).display,
                     n: strip.querySelectorAll('[data-chip]').length,
                     aria: more.getAttribute('aria-expanded') };
      more.click();
      const shutAgain = getComputedStyle(strip).display;
      return { shut, open, shutAgain };
    });
    /* Guarded: on a build without the button this reports six failures rather
       than throwing on the next line and ending the run. */
    const C = chips || { shut: { display: 'flex', h: -1, aria: null },
                         open: { display: 'flex', n: 0, aria: null }, shutAgain: 'flex' };
    ok('there is a button for them at all', chips !== null);
    ok('the panel opens with no prompts above the box',
       C.shut.display === 'none' && C.shut.h === 0, `${C.shut.display}, ${C.shut.h}px`);
    ok('and they take no space while shut — display:none, not height:0',
       C.shut.display === 'none');
    ok('the button reveals all of them', C.open.display !== 'none' && C.open.n >= 9,
       `${C.open.n} prompts`);
    ok('and puts them away again', C.shutAgain === 'none');
    ok('the button says what it is doing, for a screen reader',
       C.shut.aria === 'false' && C.open.aria === 'true');

    /* WHAT THE CHIPS WERE COSTING. This needs its own state and its own wait:
       a thread long enough to fill the panel, and the panel's 280ms open
       transition finished. Measuring whatever the previous section happened to
       leave behind is how an earlier version of this reported 275px and a
       31% share — the panel was short because the thread was two messages
       long, which says nothing about the chips. */
    await page.evaluate(qid => {
      /* And clear what the figure-memo section left in lastHits: a cited figure
         legitimately takes room in the panel, and measuring the chips' effect
         with one on screen measures the figure instead. */
      lastHits = []; lastHitsKey = null;
      const h = CHATS[qid] || (CHATS[qid] = []);
      h.length = 0;
      for (let i = 0; i < 20; i++) {
        h.push({ role: 'user', content: 'question ' + i });
        h.push({ role: 'assistant', content: ('a paragraph of reply ' + i + ' ').repeat(30) });
      }
      buildAI();
    }, qid);
    await page.waitForTimeout(900);
    const room = await page.evaluate(() => {
      const bd = document.getElementById('aiBody'), ai = document.getElementById('ai');
      return { share: bd.clientHeight / ai.getBoundingClientRect().height,
               px: bd.clientHeight,
               panelW: Math.round(ai.getBoundingClientRect().width),
               panelH: Math.round(ai.getBoundingClientRect().height),
               kids: [...ai.children].map(k => k.className.split(' ')[0] + ':' +
                 Math.round(k.getBoundingClientRect().height)).join(' ') };
    });
    ok('the thread gets most of the panel', room.share > 0.8,
       `${Math.round(room.share * 100)}% — ${room.px}px of ${room.panelH}, panel ${room.panelW}w · ${room.kids}`);
  }

  head('the scroll container is built to scroll');
  {
    /* None of this is claimed to BE the iOS bug — the panel scrolls when
       measured here. These are the two known WebKit causes of a nested
       scroller feeling locked, closed off by inspection. */
    const css = await page.evaluate(() => {
      const bd = document.getElementById('aiBody');
      const tw = document.createElement('div');
      tw.className = 'tw';
      const msg = document.querySelector('.msg') || document.body;
      msg.appendChild(tw);
      const twStyle = getComputedStyle(tw).touchAction;
      tw.remove();
      return { overscroll: getComputedStyle(bd).overscrollBehavior,
               minHeight: getComputedStyle(bd).minHeight,
               twTouch: twStyle,
               scrollH: bd.scrollHeight,
               scrollable: bd.scrollHeight - bd.clientHeight };
    });
    ok('the gesture stops at the thread instead of chaining to a locked parent',
       /contain/.test(css.overscroll), css.overscroll);
    /* This asserted min-height:0 exactly, which snapshotted the MECHANISM
       rather than the property in its own label. The answer now carries an
       8rem floor so the figure strip cannot crush it to one line (chain step
       70), and overflow still engages — a floor far below the content is not
       the same thing as a floor that stops the box shrinking. That is what is
       checked now, and the next assertion proves the outcome. */
    ok('and the box may still shrink far below its content, so overflow can engage',
       parseFloat(css.minHeight) < css.scrollH * 0.4,
       `floor ${css.minHeight} against ${css.scrollH}px of content`);
    ok('a table inside a message does not swallow a vertical drag',
       /pan-y/.test(css.twTouch), css.twTouch);
    ok('and the thread does scroll', css.scrollable > 100, `${css.scrollable}px of range`);
  }

  head('a config that names a provider this build does not have');
  {
    /* A cold load, in this same context, so the fixture written to localStorage
       is actually the config the app boots from. Last in the file because the
       reload resets everything the sections above set up. */
    await page.evaluate(() =>
      localStorage.setItem('accsap12.ai', JSON.stringify({ provider: 'nonesuch', nonesuch: { key: 'x', model: 'y' } })));
    const bootErrors = [];
    const onErr = e => bootErrors.push(e.message);
    page.on('pageerror', onErr);
    await page.reload({ waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined', { timeout: 120000 });
    await page.waitForTimeout(600);
    /* Caught rather than allowed to propagate: on a build without the fix this
       throws inside buildAI, and an uncaught rejection would end the run
       instead of reporting the failure it is here to report. */
    const panel = await page.evaluate(() => {
      try {
        const sh = document.getElementById('shell');
        if (!sh.classList.contains('ai-open')) toggleAI();
        buildAI();
      } catch (err) { return { threw: String((err && err.message) || err), html: 0 }; }
      const w = document.getElementById('ai');
      return { threw: null, html: (w && w.innerHTML.length) || 0,
               provider: AI.provider, hasSlot: !!AI[AI.provider] };
    });
    page.off('pageerror', onErr);
    ok('the panel still renders', !panel.threw && panel.html > 200, panel.threw || `${panel.html} chars`);
    ok('the provider was corrected to one this build actually has a path for',
       ['gemini', 'mistral'].indexOf(panel.provider) > -1 && panel.hasSlot === true,
       String(panel.provider));
    ok('and nothing threw on the way', bootErrors.length === 0, bootErrors.slice(0, 2).join(' | '));
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
