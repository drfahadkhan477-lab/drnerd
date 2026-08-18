#!/usr/bin/env node
/*
 * Behavioural checks for the Stage 3 (vision + learning profile) integration.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-stage3.js /path/to/patched.html
 *
 * The important checks here intercept the actual outbound request and inspect
 * the JSON body. Vision code that "looks right" but sends a malformed image
 * block fails at the API with a 400 the user sees and I would not — so these
 * assert the wire format directly, against the shape the Anthropic vision
 * documentation specifies.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-stage3.js <patched.html>'); process.exit(1); }
/* Accepts a path (single-file build) or an http URL (the Stage 1 PWA
   build, which has to be served because it fetches its content). */
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Stub the streaming endpoints so nothing leaves the machine and no key is
   needed: capture the request body, then reply with a minimal valid SSE
   stream so the app's own parser runs end-to-end over it. */
const SSE = [
  'data: {"type":"message_start","message":{"id":"msg_test","content":[]}}',
  'data: {"type":"content_block_start","content_block":{"type":"text"}}',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"The tracing shows atrial flutter."}}',
  'data: {"type":"content_block_stop"}',
  'data: {"type":"message_stop"}',
  '',
].join('\n\n');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const captured = [];
  await page.route('**/v1/messages', route => {
    try { captured.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { captured.push(null); }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE });
  });
  await page.route('**/openai/v1/chat/completions', route => {
    try { captured.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { captured.push(null); }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
      body: 'data: {"choices":[{"delta":{"content":"Text-only reply."}}]}\n\ndata: [DONE]\n\n' });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);

  /* Drive one full exchange on a question that has a figure. */
  const ask = async (provider, wantFigure) => {
    captured.length = 0;
    await page.evaluate(async ({ provider, wantFigure }) => {
      AI.provider = provider;
      AI[provider] = { key: provider === 'anthropic' ? 'sk-ant-test' : 'gsk_test',
                       model: provider === 'anthropic' ? 'claude-sonnet-5' : 'openai/gpt-oss-120b' };
      const q = ALL_Q.find(x => !x.bad && (wantFigure ? (x.img > 0 && (IMGS[x.id] || []).length) : !x.img));
      jumpTo(q.id);
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      window.__q = q;
      fire('why is this the answer?');
    }, { provider, wantFigure });
    for (let i = 0; i < 60 && !captured.length; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    return captured[0];
  };

  head('vision: the figure actually reaches the Anthropic request');
  const withFig = await ask('anthropic', true);
  ok('a request was made', !!withFig);
  const msgs = (withFig && withFig.messages) || [];
  const first = msgs[0] || {};
  ok('first user turn carries content blocks, not a bare string', Array.isArray(first.content),
     typeof first.content);
  const imgBlocks = Array.isArray(first.content) ? first.content.filter(b => b.type === 'image') : [];
  ok('at least one image block is present', imgBlocks.length > 0, imgBlocks.length + ' image block(s)');

  const src = imgBlocks[0] && imgBlocks[0].source;
  ok('image source is base64-shaped', !!src && src.type === 'base64', JSON.stringify(src && src.type));
  ok('media_type is a supported image type', !!src && /^image\/(webp|png|jpeg|gif)$/.test(src.media_type),
     src && src.media_type);
  ok('data is raw base64, with no data: URL prefix left on',
     !!src && typeof src.data === 'string' && !src.data.startsWith('data:') && src.data.length > 100,
     src ? (src.data || '').slice(0, 16) + '… (' + (src.data || '').length + ' chars)' : '');
  ok('data decodes as base64', (() => {
    try { return Buffer.from(src.data, 'base64').length > 100; } catch (_) { return false; }
  })());
  ok('image is under the 10MB per-image API limit',
     Buffer.from(src.data, 'base64').length < 10 * 1024 * 1024,
     (Buffer.from(src.data, 'base64').length / 1024).toFixed(0) + ' KB');

  const blocks = first.content;
  const firstImgIdx = blocks.findIndex(b => b.type === 'image');
  const lastTextIdx = blocks.length - 1;
  ok('images precede the question text, as the docs recommend', firstImgIdx < lastTextIdx);
  ok('the fellow\'s actual question is still the final text block',
     blocks[lastTextIdx].type === 'text' && /why is this the answer/i.test(blocks[lastTextIdx].text),
     JSON.stringify(blocks[lastTextIdx].text).slice(0, 60));
  const labels = blocks.filter(b => b.type === 'text' && /^Figure/.test(b.text));
  ok('each figure is labelled', labels.length === imgBlocks.length,
     labels.map(l => l.text).join(' '));

  head('vision: the system prompt matches what was actually sent');
  const sysText = (withFig.system || []).map(s => s.text).join('\n');
  ok('context says the figures are attached', /attached to this conversation/.test(sysText));
  ok('context no longer claims the tutor is blind', !/which you cannot see/.test(sysText));
  ok('teaching instruction for figures is present', /start by saying what you actually see/i.test(sysText));
  ok('commentary-is-ground-truth guardrail present', /commentary is the ground truth/i.test(sysText));

  head('vision: text-only provider is told the truth instead');
  const groq = await ask('groq', true);
  ok('a Groq request was made', !!groq);
  const groqSys = ((groq.messages || []).find(m => m.role === 'system') || {}).content || '';
  ok('Groq request carries no image blocks', !JSON.stringify(groq).includes('"type":"image"'));
  ok('Groq context says the figures are NOT visible', /cannot see/.test(groqSys), groqSys.slice(0, 40));
  ok('Groq context names the reason', /does not accept images/.test(groqSys));

  head('vision: a question with no figure sends no image');
  const noFig = await ask('anthropic', false);
  ok('no image block on a text-only question', !JSON.stringify(noFig).includes('"type":"image"'));
  ok('first turn stays a plain string when there is nothing to attach',
     typeof (noFig.messages[0] || {}).content === 'string');

  head('images are never persisted to localStorage');
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('accsap12.chat') || '';
    return { len: raw.length, hasImage: raw.includes('"type":"image"') || raw.includes('base64'),
             threads: Object.keys(JSON.parse(raw || '{}')).length };
  });
  ok('saved chat history contains no image data', !persisted.hasImage,
     persisted.threads + ' thread(s), ' + persisted.len + ' bytes');
  ok('saved chat history stays small', persisted.len < 200000, persisted.len + ' bytes');

  head('learning profile');
  const profiled = await page.evaluate(() => {
    S.chStats = { 'Pericardial Disease': { correct: 3, total: 12 }, 'Arrhythmias': { correct: 40, total: 50 } };
    S.sessionCorrect = 43; S.sessionTotal = 62;
    S.missed = new Set(['ARR_2']);
    S.practice['ARR_2'] = { n: 1, c: 0, t: Date.now() };
    return Profile.build();
  });
  ok('profile mentions overall accuracy', /Answered 43\/62/.test(profiled), profiled.split('\n')[1] || '');
  ok('profile ranks the weakest chapter first', /Pericardial Disease 25%/.test(profiled));
  ok('profile ignores chapters with too small a sample', !/Congenital/.test(profiled));
  ok('profile lists recent misses', /ARR_2/.test(profiled));
  ok('profile instructs the model not to read it back', /do not read it back/i.test(profiled));

  const emptyProfile = await page.evaluate(() => {
    S.chStats = {}; S.missed = new Set(); S.practice = {}; S.srs = {};
    S.sessionCorrect = 0; S.sessionTotal = 0;
    return Profile.build();
  });
  ok('a fresh install produces no profile at all', emptyProfile === '', JSON.stringify(emptyProfile));

  const inRequest = await ask('anthropic', true);
  const sysWithProfile = (inRequest.system || []).map(s => s.text).join('\n');
  ok('profile is absent from the request when there is no history',
     !/CURRENT STANDING/.test(sysWithProfile));

  head('ui badge');
  const badge = await page.evaluate(() => {
    AI.provider = 'anthropic';
    const q = ALL_Q.find(x => !x.bad && x.img > 0);
    jumpTo(q.id); buildAI();
    const anth = document.querySelector('.ai-sub').textContent;
    AI.provider = 'groq'; buildAI();
    const gq = document.querySelector('.ai-sub').textContent;
    return { anth, gq };
  });
  ok('badge says the figures are visible on Anthropic', /sees \d+ figure/.test(badge.anth), badge.anth);
  ok('badge says they are not on a text-only provider', /not visible to this model/.test(badge.gq), badge.gq);

  head('regression');
  ok('no console/page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
