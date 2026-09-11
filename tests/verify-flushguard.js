#!/usr/bin/env node
/*
 * The last chunk is painted however the stream ends.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-flushguard.js <patched.html|url>
 *
 * makeStreamPainter exists for one stated reason, in its own comment: so that
 * "the very last chunk is never left unpainted waiting on a frame that may not
 * come". It coalesces paints onto animation frames, and flush() is the
 * correctness guarantee — it cancels any pending frame and paints the current
 * text synchronously, once, after the stream ends.
 *
 * It was called after the read loop's closing brace, which honours that on the
 * one path where the loop ends normally and on no other. A provider error
 * mid-stream throws out of the loop; tapping stop rejects the in-flight read.
 * Either way control leaves the function past the flush, and the scheduled
 * frame that would have painted the tail fires — if it fires at all — after
 * streamReply's finally has already called buildAI() and replaced the node it
 * would have painted into.
 *
 * WHY THE ASSERTION IS "FLUSH RAN", NOT "THE SCREEN LOOKS RIGHT". Because
 * today the screen looks the same either way, and saying otherwise would be
 * inventing a symptom. On abort, streamReply pushes no partial turn; on error
 * it pushes only err.message; and in both cases buildAI() rebuilds the panel
 * immediately afterwards. The gap is against the module's own documented
 * invariant, and it stops being invisible the day the error path starts
 * showing what arrived before the failure. So what is checked is the invariant
 * itself — flush ran, and when it ran the live node held every chunk that had
 * arrived — which is the thing that has to be true for that change to be safe
 * to make.
 *
 * THE SPY, AND WHAT IT DOES NOT MOVE. makeStreamPainter is wrapped so the test
 * can see a call it cannot otherwise observe. The wrapper delegates to the real
 * painter — the real flush still runs, and the tidy path below is the control
 * that proves the wrapper did not change the behaviour it is measuring.
 *
 * TWO MECHANISMS, AND ONLY ONE OF THEM IS A DOUBLE. The provider-error case
 * uses the app's own `if(j.error) throw` on an ordinary fulfilled response: no
 * emulation at all, the real code throws out of its real loop. The abort case
 * needs a response that is still open when stop is tapped, which a fulfilled
 * body cannot be, so it is served by an in-page fetch double whose stream
 * errors on the signal exactly as the platform's does. The stop itself is the
 * app's own control, not a synthetic call.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-flushguard.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const TAIL = 'and the tail of the answer arrived last.';
const part = p => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [p] } }] }) + '\n\n';
/* A text part, then the provider's own error frame — one response body, two
   frames, so the throw happens in the same task that scheduled the paint and
   no animation frame can have run in between. */
const ERR_SSE = part({ text: 'The gradient is severe. ' }) + part({ text: TAIL })
  + 'data: ' + JSON.stringify({ error: { message: 'the stream failed mid-answer' } }) + '\n\n';
const OK_SSE = part({ text: 'The gradient is severe. ' }) + part({ text: TAIL }) + 'data: [DONE]\n\n';
const CALL_SSE = part({ functionCall: { name: 'get_performance', args: {} } }) + 'data: [DONE]\n\n';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });

  const queued = [];
  await page.route('**/generativelanguage.googleapis.com/**', route => {
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
                    body: queued.shift() || OK_SSE });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)));

  /* The spy. innerHTML is read straight after the real flush returns, because
     streamReply's finally calls buildAI() a tick later and the node the tail
     was painted into stops being the node on screen. */
  const spy = await page.evaluate(() => {
    if (typeof makeStreamPainter !== 'function') return false;
    const real = makeStreamPainter;
    window.__fg = { built: 0, flushes: 0, painted: [] };
    makeStreamPainter = function (live, body, getText) {
      window.__fg.built++;
      const p = real(live, body, getText);
      return {
        schedule() { p.schedule(); },
        flush() { p.flush(); window.__fg.flushes++; window.__fg.painted.push(live ? live.innerHTML : ''); },
      };
    };
    return true;
  });
  ok('the streaming painter is reachable to be watched', spy);

  const open = () => page.evaluate(() => {
    AI.provider = 'gemini';
    AI.gemini = { key: 'test-gemini-key', model: 'gemini-2.5-flash' };
    const q = ALL_Q.find(x => !x.bad);
    jumpTo(q.id);
    const sh = document.getElementById('shell');
    if (!sh.classList.contains('ai-open')) toggleAI();
    buildAI();
    return q.id;
  });
  const qid = await open();
  const reset = () => page.evaluate(id => { delete CHATS[id]; window.__fg = { built: 0, flushes: 0, painted: [] }; }, qid);
/* Resolves to false rather than throwing, because a turn that never ends is
     a result this suite has to be able to report. The pre-fix build cannot
     stop a stream at all, so without this the run dies on an uncaught timeout
     in the middle and the checks after it are never reached. */
  const settled = () => page.waitForFunction(
    () => typeof aiBusy !== 'undefined' && !aiBusy, { timeout: 20000 }).then(() => true, () => false);
  const settledOk = async (label, why) => {
    const done = await settled();
    ok(label, done, done ? '' : (why || 'aiBusy never cleared'));
    return done;
  };

  head('the tidy path — the control');
  {
    await reset();
    queued.length = 0; queued.push(OK_SSE);
    await page.evaluate(() => fire('how bad is this gradient?'));
    await settledOk('the turn ends');
    const r = await page.evaluate(id => ({ fg: window.__fg, last: (CHATS[id] || []).slice(-1)[0] || null }), qid);
    ok('one painter is built for the turn', r.fg.built === 1, String(r.fg.built));
    ok('and it is flushed exactly once — not twice', r.fg.flushes === 1, String(r.fg.flushes));
    ok('the flush painted the whole answer, tail included',
       (r.fg.painted[0] || '').includes(TAIL));
    ok('and the reply that was kept is complete',
       !!r.last && r.last.role === 'assistant' && String(r.last.content).includes(TAIL));
  }

  head('the provider fails mid-answer');
  {
    await reset();
    queued.length = 0; queued.push(ERR_SSE);
    await page.evaluate(() => fire('how bad is this gradient?'));
    await settledOk('the failed turn ends rather than hanging');
    const r = await page.evaluate(id => ({ fg: window.__fg, last: (CHATS[id] || []).slice(-1)[0] || null }), qid);
    /* The check the fix exists for. Pre-fix this is 0: the throw carries
       control past the flush that sits after the loop. */
    ok('the stream that threw was still flushed', r.fg.flushes === 1, `${r.fg.flushes} flush(es)`);
    ok('and what it painted was everything that had arrived',
       (r.fg.painted[0] || '').includes(TAIL),
       r.fg.flushes ? '' : 'nothing was painted because nothing flushed');
    /* The failure still has to reach the fellow — a finally that swallowed the
       error would pass the two checks above and break the app. */
    ok('the failure is still reported as a failure',
       !!r.last && r.last.err === true && String(r.last.content).includes('mid-answer'),
       r.last ? String(r.last.content).slice(0, 60) : 'nothing was pushed');
  }

  head('the fellow taps stop');
  {
    await reset();
    /* An open stream, served in-page, because a fulfilled body is closed by
       the time the app could stop it. It errors on the signal exactly as a
       real one does. */
    await page.evaluate(tail => {
      const realFetch = window.fetch.bind(window);
      window.__restoreFetch = () => { window.fetch = realFetch; };
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!/generativelanguage/.test(url)) return realFetch(input, init);
        const sig = init && init.signal;
        const enc = new TextEncoder();
        const frame = t => enc.encode('data: ' + JSON.stringify(
          { candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] }) + '\n\n');
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(frame('The gradient is severe. '));
            c.enqueue(frame(tail));
            window.__streaming = true;
            if (sig) sig.addEventListener('abort', () => {
              try { c.error(new DOMException('The user aborted a request.', 'AbortError')); } catch (_) {}
            });
          },
        });
        return Promise.resolve(new Response(stream, {
          status: 200, headers: { 'content-type': 'text/event-stream' } }));
      };
      window.__streaming = false;
    }, TAIL);

    await page.evaluate(() => fire('how bad is this gradient?'));
    await page.waitForFunction(() => window.__streaming === true && typeof aiBusy !== 'undefined' && aiBusy, { timeout: 20000 });
    /* Wait for both chunks to have been read and accumulated, so there is a
       tail to lose. */
    await page.waitForFunction(() => (window.__fg.built === 1), { timeout: 20000 });
    await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
    /* The app's own stop: the send button is the stop button while busy. It
       used to be rendered `disabled` in exactly that state, so this is the
       check that the control is a control — clicking a disabled button does
       nothing at all, silently, and every assertion after it would have been
       measuring the stop that never happened. */
    const btn = await page.evaluate(() => {
      const b = document.getElementById('aiSend');
      if (!b) return null;
      const st = { disabled: !!b.disabled, label: b.getAttribute('aria-label') || '',
                   title: b.getAttribute('title') || '', glyph: b.textContent.trim() };
      b.click();
      return st;
    });
    ok('the composer has a send button to become the stop button', !!btn);
    ok('it shows the stop glyph while a reply is streaming', !!btn && btn.glyph === '■',
       btn ? JSON.stringify(btn.glyph) : '');
    ok('and it is not disabled while it is the only way to stop',
       !!btn && btn.disabled === false, btn && btn.disabled ? 'disabled' : '');
    ok('and it says so, for anyone not looking at a square',
       !!btn && /stop/i.test(btn.label) && /stop/i.test(btn.title),
       btn ? `${JSON.stringify(btn.label)} / ${JSON.stringify(btn.title)}` : '');
    await settledOk('the stopped turn ends', 'aiBusy never cleared — the stop did not take');
    const r = await page.evaluate(id => ({ fg: window.__fg, len: (CHATS[id] || []).length }), qid);
    ok('the stream that was aborted was still flushed', r.fg.flushes === 1, `${r.fg.flushes} flush(es)`);
    ok('and the flush painted what had arrived before the stop',
       (r.fg.painted[0] || '').includes(TAIL),
       r.fg.flushes ? '' : 'nothing was painted because nothing flushed');
    /* Unchanged by the fix, and asserted so it stays that way: a stop is not
       an error, and half an answer is not a turn worth keeping. */
    ok('stopping still leaves no assistant turn behind', r.len === 1, `${r.len} message(s) in the thread`);
    /* Unconditionally, so the sections after this one still talk to the route
       mock rather than to an open stream nobody can close. */
    await page.evaluate(() => { window.__restoreFetch(); if (typeof aiAbort !== 'undefined' && aiAbort) aiAbort.abort(); });
  }

  head('and it is a send button again when there is nothing to stop');
  {
    const idle = await page.evaluate(() => {
      const b = document.getElementById('aiSend');
      return b ? { disabled: !!b.disabled, label: b.getAttribute('aria-label') || '',
                   stopping: b.classList.contains('stopping'), glyph: b.textContent.trim() } : null;
    });
    ok('at rest it is labelled Send', !!idle && /send/i.test(idle.label), idle ? idle.label : '');
    ok('and carries no stop styling', !!idle && idle.stopping === false);
    ok('and is still enabled, as it always was', !!idle && idle.disabled === false);
  }

  head('a tool round still returns through the guard');
  {
    await reset();
    queued.length = 0; queued.push(CALL_SSE, OK_SSE);
    await page.evaluate(() => fire('how am I doing?'));
    await settledOk('the exchange ends');
    const r = await page.evaluate(id => ({ fg: window.__fg, last: (CHATS[id] || []).slice(-1)[0] || null }), qid);
    /* Two turns, two painters, two flushes — the finally is per loop, not per
       exchange, and wrapping the loop must not have swallowed the parts the
       first turn returns. */
    ok('both turns of the exchange built a painter', r.fg.built === 2, String(r.fg.built));
    ok('and both flushed', r.fg.flushes === 2, String(r.fg.flushes));
    ok('the tool call still came back out of the guarded loop',
       !!r.last && String(r.last.content).includes(TAIL),
       r.last ? String(r.last.content).slice(0, 60) : 'no reply');
  }

  head('one streaming turn, one guard');
  {
    /* A second provider brings its own read loop and its own way out of it.
       This is the check that notices. */
    const shape = await page.evaluate(() => ({
      oneTurn: typeof oneTurn === 'function' ? String(oneTurn) : '',
      names: Object.getOwnPropertyNames(window).filter(n => /^oneTurn./.test(n)),
    }));
    ok('the dispatcher has exactly one provider to dispatch to',
       shape.names.length === 1, shape.names.join(', ') || 'none found');
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
