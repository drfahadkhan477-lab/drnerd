#!/usr/bin/env node
/*
 * Behavioural checks for figures appearing in Apex's answers.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-chatfigs.js /path/to/patched.html
 *
 * The claim: when Apex answers from a note that carries a figure, the fellow
 * sees the figure. Every part of that already existed — the note cites it, the
 * library renders it, a vision model receives it — and the one place it never
 * appeared was the answer, which is the only place it was needed.
 *
 * Two failure modes this guards, both of which produce a silent nothing rather
 * than an error. The strip must be built by the app from the notes actually
 * retrieved, so it does not depend on the model emitting markup it would have
 * to reproduce byte-perfect. And it must not be gated on grounded mode, which
 * is what hid it before: sending an image and showing one are different
 * decisions with different costs, and only the first should be rationed.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-chatfigs.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const sse = text => [
  'data: {"type":"message_start","message":{"id":"m","content":[]}}',
  'data: {"type":"content_block_start","content_block":{"type":"text"}}',
  'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }),
  'data: {"type":"content_block_stop"}',
  'data: {"type":"message_stop"}',
  '',
].join('\n\n');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const sent = [];
  let reply = 'Pressure overload adds sarcomeres in parallel.';
  await page.route('**/v1/messages', route => {
    try { sent.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(reply) });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });
  await page.waitForTimeout(900);

  /* Ask a question, then pin lastHits to a note that definitely has a figure —
     rather than hoping retrieval picks one — and re-render. */
  const ask = async grounded => {
    sent.length = 0;
    return page.evaluate(async grounded => {
      AI.provider = 'anthropic';
      AI.anthropic = { key: 'sk-ant-test', model: 'claude-sonnet-5' };
      AI_GROUNDED = grounded;
      const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      fire('explain this');
      await new Promise(r => setTimeout(r, 1600));
      lastHits = [{ kind: 'r', id: note.id, title: note.title }];
      buildAI();
      const img = document.querySelector('.fig-strip .ai-fig img');
      return {
        noteTitle: note.title,
        figs: document.querySelectorAll('.fig-strip .ai-fig').length,
        src: (img && img.getAttribute('src') || '').slice(0, 22),
        caption: (document.querySelector('.fig-strip figcaption') || {}).textContent || '',
        label: (document.querySelector('.fig-strip .src-lbl') || {}).textContent || '',
      };
    }, grounded);
  };

  head('open mode — where the figure used to be invisible');
  const open = await ask(false);
  ok('a figure from the cited note is shown', open.figs >= 1, open.figs + ' figure(s)');
  ok('it is a real decoded image, not a dead reference', /^data:image\//.test(open.src), open.src);
  ok('it is captioned', open.caption.length > 20, open.caption.slice(0, 60));
  ok('and attributed to the note it came from',
     open.caption.includes(open.noteTitle.slice(0, 18)), open.caption.slice(-40));
  ok('the strip says what it is', /figure/i.test(open.label), open.label);

  head('the vision attachment stays rationed, though the display is not');
  const openSys = (sent.find(Boolean) || {});
  const openHasImage = JSON.stringify(openSys).includes('"type":"image"');
  ok('open mode still does not spend tokens sending note figures', !openHasImage);

  head('grounded mode — shown and sent');
  const grounded = await ask(true);
  ok('the figure is still shown', grounded.figs >= 1, grounded.figs + ' figure(s)');
  const gReq = sent.find(Boolean) || {};
  ok('and now it is sent to the model too', JSON.stringify(gReq).includes('"type":"image"'));

  head('the model may place one inline, and then it is not shown twice');
  const inline = await page.evaluate(async () => {
    const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
    const key = /refimg:\/\/([^)\s]+)/.exec(note.body)[1];
    const q = null;
    CHATS['_general'] = [
      { role: 'user', content: 'explain' },
      { role: 'assistant', content: 'Look here: ![the figure](refimg://' + key + ') — note the branch points.' },
    ];
    saveJSON(AI_CHAT, CHATS);
    S.screen = 'home';
    lastHits = [{ kind: 'r', id: note.id, title: note.title }];
    buildAI();
    return {
      inBody: document.querySelectorAll('.msg.bot figure.ref-fig img').length,
      inStrip: document.querySelectorAll('.fig-strip .ai-fig').length,
    };
  });
  ok('a citation the model copied renders inside the reply', inline.inBody === 1, inline.inBody + ' inline');
  ok('and the strip does not repeat it underneath', inline.inStrip === 0, inline.inStrip + ' in strip');

  head('the evidence belongs to one conversation');
  /* lastHits is a single global. Before it was tagged with its thread, asking
     about one question and then opening another that already had a chat showed
     the first question's notes — and, once figures were added, printed the
     first question's diagram as the evidence for the second. */
  const leak = await page.evaluate(async () => {
    const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
    const [a, b] = ALL_Q.filter(x => !x.bad).slice(0, 2);
    /* A conversation exists on B, but the retrieval that produced lastHits
       happened on A. */
    CHATS[b.id] = [{ role: 'user', content: 'unrelated' },
                   { role: 'assistant', content: 'An answer with no figure in it.' }];
    saveJSON(AI_CHAT, CHATS);
    lastHits = [{ kind: 'r', id: note.id, title: note.title }];
    lastHitsKey = a.id;
    jumpTo(b.id); buildAI();
    const strayFigs = document.querySelectorAll('.fig-strip .ai-fig').length;
    const strayPills = document.querySelectorAll('.src-strip .src-pill').length;
    /* And when the hits do belong to this thread, they draw as normal. */
    lastHitsKey = b.id; buildAI();
    return { strayFigs, strayPills,
             ownFigs: document.querySelectorAll('.fig-strip .ai-fig').length };
  });
  ok('another thread\'s figure is not printed as this one\'s evidence',
     leak.strayFigs === 0, leak.strayFigs + ' stray figure(s)');
  ok('nor are its "drawing on" pills', leak.strayPills === 0, leak.strayPills + ' stray pill(s)');
  ok('while the thread\'s own figure still shows', leak.ownFigs === 1, leak.ownFigs + ' figure(s)');

  head('the strip is evidence, not furniture');
  const empty = await page.evaluate(() => {
    delete CHATS['_general']; saveJSON(AI_CHAT, CHATS);
    lastHits = [];
    S.screen = 'home';
    buildAI();
    return document.querySelectorAll('.fig-strip').length;
  });
  ok('an empty thread shows no figure strip', empty === 0, String(empty));

  head('the system prompt tells the model how to place one safely');
  const prompt = await page.evaluate(() => SYSTEM);
  ok('it explains the citation form', /refimg:\/\/KEY/.test(prompt));
  ok('it insists the key be copied verbatim', /EXACTLY|character for character/.test(prompt));
  ok('it forbids inventing one, which would render as nothing',
     /Never invent, guess or abbreviate/i.test(prompt));

  head('regression');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
