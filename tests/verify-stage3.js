#!/usr/bin/env node
/*
 * Behavioural checks for the Stage 3 (vision + learning profile) integration.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-stage3.js /path/to/patched.html
 *
 * The important checks here intercept the actual outbound request and inspect
 * the JSON body. Vision code that "looks right" but sends a malformed image
 * block fails at the API with a 400 the user sees and I would not — so these
 * assert the wire format directly, against Mistral's actual image_url shape.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

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
  'data: ' + JSON.stringify({ choices: [{ delta: { content: 'The tracing shows atrial flutter.' } }] }),
  'data: [DONE]',
  '',
].join('\n\n');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  const captured = [];
  await page.route('**/v1/chat/completions', route => {
    try { captured.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { captured.push(null); }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);

  /* Drive one full exchange on a question that has a figure, against Mistral —
     the one remaining BYOK provider with real vision. */
  const ask = async wantFigure => {
    captured.length = 0;
    await page.evaluate(async wantFigure => {
      AI.provider = 'mistral';
      AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
      const q = ALL_Q.find(x => !x.bad && (wantFigure ? (x.img > 0 && (IMGS[x.id] || []).length) : !x.img));
      jumpTo(q.id);
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      window.__q = q;
      fire('why is this the answer?');
    }, wantFigure);
    for (let i = 0; i < 60 && !captured.length; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    return captured[0];
  };

  head('vision: the figure actually reaches the Mistral request');
  const withFig = await ask(true);
  ok('a request was made', !!withFig);
  const msgs = (withFig && withFig.messages) || [];
  const first = msgs.find(m => m.role === 'user') || {};
  ok('first user turn carries content blocks, not a bare string', Array.isArray(first.content),
     typeof first.content);
  const imgBlocks = Array.isArray(first.content) ? first.content.filter(b => b.type === 'image_url') : [];
  ok('at least one image block is present', imgBlocks.length > 0, imgBlocks.length + ' image block(s)');

  const url = imgBlocks[0] && imgBlocks[0].image_url && imgBlocks[0].image_url.url;
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(url || '');
  ok('image is a data: URL, not a dead reference', !!m, (url || '').slice(0, 24));
  ok('media_type is a supported image type', !!m && /^image\/(webp|png|jpeg|gif)$/.test(m[1]), m && m[1]);
  ok('data decodes as base64', (() => {
    try { return !!m && Buffer.from(m[2], 'base64').length > 100; } catch (_) { return false; }
  })());
  ok('image is under the 10MB per-image API limit',
     !!m && Buffer.from(m[2], 'base64').length < 10 * 1024 * 1024,
     m ? (Buffer.from(m[2], 'base64').length / 1024).toFixed(0) + ' KB' : '');

  const blocks = first.content;
  const firstImgIdx = blocks.findIndex(b => b.type === 'image_url');
  const lastTextIdx = blocks.length - 1;
  ok('images precede the question text, as the docs recommend', firstImgIdx < lastTextIdx);
  ok('the fellow\'s actual question is still the final text block',
     blocks[lastTextIdx].type === 'text' && /why is this the answer/i.test(blocks[lastTextIdx].text),
     JSON.stringify(blocks[lastTextIdx].text).slice(0, 60));
  const labels = blocks.filter(b => b.type === 'text' && /^Figure/.test(b.text));
  ok('each figure is labelled', labels.length === imgBlocks.length,
     labels.map(l => l.text).join(' '));

  head('vision: the system prompt matches what was actually sent');
  const sysText = (withFig.messages || []).find(s => s.role === 'system')?.content || '';
  ok('context says the figures are attached', /attached to this conversation/.test(sysText));
  ok('context no longer claims the tutor is blind', !/which you cannot see/.test(sysText));
  ok('teaching instruction for figures is present', /start by saying what you actually see/i.test(sysText));
  ok('commentary-is-ground-truth guardrail present', /commentary is the ground truth/i.test(sysText));

  /* Both remaining providers see figures — no real provider takes the "cannot
     see this" path any more. The fallback is still correct and cheap, so it
     is tested directly against Vision's own functions rather than through a
     live provider that no longer exists. */
  head('vision: a provider not on the list is told the truth instead');
  const noVision = await page.evaluate(() => ({
    sees: Vision.providerSeesFigures('not-a-real-provider'),
    ctx: Vision.figureContextLine({ img: 2 }, 'not-a-real-provider'),
  }));
  ok('an unlisted provider is not treated as seeing figures', noVision.sees === false);
  ok('its context line says the figures are NOT visible', /cannot see/.test(noVision.ctx), noVision.ctx);
  ok('the context line names the reason', /does not accept images/.test(noVision.ctx));

  head('vision: a question with no figure sends no image');
  const noFig = await ask(false);
  ok('no image block on a text-only question', !JSON.stringify(noFig).includes('"type":"image_url"'));
  ok('first turn stays a plain string when there is nothing to attach',
     typeof (noFig.messages.find(x => x.role === 'user') || {}).content === 'string');

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

  const inRequest = await ask(true);
  const sysWithProfile = (inRequest.messages || []).find(s => s.role === 'system')?.content || '';
  ok('profile is absent from the request when there is no history',
     !/CURRENT STANDING/.test(sysWithProfile));

  head('ui badge');
  const badge = await page.evaluate(() => {
    AI.provider = 'mistral';
    const q = ALL_Q.find(x => !x.bad && x.img > 0);
    jumpTo(q.id); buildAI();
    const mist = document.querySelector('.ai-sub').textContent;
    /* Not a real remaining provider — a synthetic id to exercise the branch
       VISION_PROVIDERS leaves in place for a provider that cannot see images.
       buildAI reads AI[AI.provider] regardless of whether it is a real
       provider, so it needs a slot of its own. */
    AI.provider = 'not-a-real-provider';
    AI['not-a-real-provider'] = { key: 'x', model: 'x' };
    buildAI();
    const gq = document.querySelector('.ai-sub').textContent;
    return { mist, gq };
  });
  ok('badge says the figures are visible on Mistral', /sees \d+ figure/.test(badge.mist), badge.mist);
  ok('badge says they are not on a text-only provider', /not visible to this model/.test(badge.gq), badge.gq);

  head('regression');
  ok('no console/page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
