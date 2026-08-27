#!/usr/bin/env node
/*
 * Behavioural checks for Gemini as a third provider.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-gemini.js /path/to/patched.html
 *
 * Gemini's wire shape is close to neither Anthropic's nor Groq's — a top-level
 * systemInstruction instead of a system message, roles 'user'/'model' instead
 * of 'user'/'assistant', images as inlineData instead of a source block, tool
 * results matched by name instead of by id. Getting any one of those wrong is
 * invisible until a real request 400s, so — same discipline as verify-stage3
 * for the other two providers — this intercepts the actual outbound request
 * and inspects the JSON body rather than trusting that the code "looks right".
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-gemini.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* One complete Gemini streamGenerateContent SSE reply: a text part, then a
   functionCall part, so a single stub covers both the plain-answer path and
   the tool-calling path without needing two different fixtures. */
const sseText = 'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"The ECG shows atrial flutter."}]}}]}\n\n';
const sseCall = 'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_performance","args":{}}}]}}]}\n\n';
const sseFollowup = 'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"You are weakest in Pericardial Disease."}]}}]}\n\n';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  /* The two deliberately-triggered error responses below (403, 429) log as
     browser-level resource-load failures regardless of how gracefully the
     app's own code handles them — that is Chromium's console, not a bug. */
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())
      && !/Failed to load resource.*(403|429)/.test(m.text())) errors.push(m.text()); });

  const captured = [];
  let turn = 0;
  await page.route('**/generativelanguage.googleapis.com/**', route => {
    const url = route.request().url();
    let body = null;
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (_) { /* validateKey posts JSON too */ }
    captured.push({ url, headers: route.request().headers(), body });
    if (/:generateContent(\?|$)/.test(url) && !/streamGenerateContent/.test(url)) {
      // validateKey's throwaway call — any 200 with a candidate is "valid"
      route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) });
      return;
    }
    turn++;
    const sse = turn === 1 ? sseCall : sseFollowup;
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);

  head('provider is listed, free, and marked as seeing figures');
  const config = await page.evaluate(() => ({
    listed: PROVIDERS.some(p => p[0] === 'gemini'),
    models: (MODELS.gemini || []).map(m => m[0]),
    keyPrefix: KEY_PREFIX.gemini,
    sees: Vision.providerSeesFigures('gemini'),
    endpoint: ENDPOINT.gemini,
  }));
  ok('gemini is in PROVIDERS', config.listed);
  ok('gemini has at least one model, and 2.5 Flash is offered', config.models.includes('gemini-2.5-flash'), config.models.join(', '));
  ok('key prefix accepts both key generations Google has issued',
     Array.isArray(config.keyPrefix) && config.keyPrefix.includes('AQ.') && config.keyPrefix.includes('AIza'),
     JSON.stringify(config.keyPrefix));
  ok('Vision.providerSeesFigures says gemini can see a figure', config.sees === true);
  ok('endpoint points at the Generative Language API', /generativelanguage\.googleapis\.com/.test(config.endpoint || ''));

  head('an existing config saved before Gemini existed does not crash on switch');
  const repaired = await page.evaluate(() => {
    AI = { provider: 'groq', groq: { key: 'gsk_x', model: 'openai/gpt-oss-120b' },
            anthropic: { key: '', model: 'claude-sonnet-5' } };   // pre-Gemini shape, no .gemini
    saveJSON(AI_CFG, AI);
    AI = loadJSON(AI_CFG, AI_DEFAULT);
    if (AI && !AI.gemini) AI.gemini = { key: '', model: 'gemini-2.5-flash' };
    AI.provider = 'gemini';
    let threw = false;
    try { buildAI(); } catch (_) { threw = true; }
    return { hasSlot: !!AI.gemini, threw };
  });
  ok('a .gemini slot exists even for a config saved before this feature', repaired.hasSlot);
  ok('switching to it does not throw', !repaired.threw);

  head('key validation — the throwaway call is shaped right');
  await page.evaluate(async () => {
    AI.gemini = { key: 'AIzaFAKE-TEST-KEY', model: 'gemini-2.5-flash' };
    await validateKey('gemini', AI.gemini.key, AI.gemini.model);
  });
  const validateReq = captured.find(c => /:generateContent(\?|$)/.test(c.url) && !/streamGenerateContent/.test(c.url));
  ok('a validation request was made', !!validateReq);
  ok('the key rides in a header, not the URL', !!validateReq && !validateReq.url.includes('AIzaFAKE'),
     validateReq && validateReq.url);
  ok('the key header is x-goog-api-key', !!validateReq && validateReq.headers['x-goog-api-key'] === 'AIzaFAKE-TEST-KEY');
  captured.length = 0;

  head('setup screen accepts the new AQ. key shape, not just the old AIza one');
  const aqAttempt = await page.evaluate(async () => {
    AI.gemini = { key: '', model: 'gemini-2.5-flash' };
    AI.provider = 'gemini';
    aiSettings();
    document.querySelector('[data-prov="gemini"]').click();
    const inp = document.getElementById('aiKey');
    inp.value = 'AQ.Ab8-FAKE-TEST-KEY-NOT-REAL-0000000000000000000000';
    document.getElementById('aiSave').click();
    await new Promise(r => setTimeout(r, 300));
    return document.getElementById('keyMsg').textContent;
  });
  ok('a real AQ. key is not rejected as "a different kind of key"', !/different kind of key/i.test(aqAttempt), aqAttempt);
  captured.length = 0;

  /* Drive one full exchange: fires a question with no figure of its own, but
     asks something generic enough that the model reaches for a tool — this
     exercises the request shape, the streamed reply, AND the tool round trip
     in a single pass. */
  const ask = async (wantFigure) => {
    captured.length = 0; turn = 0;
    await page.evaluate(async ({ wantFigure }) => {
      AI.provider = 'gemini';
      AI.gemini = { key: 'AIzaFAKE-TEST-KEY', model: 'gemini-2.5-flash' };
      const q = ALL_Q.find(x => !x.bad && (wantFigure ? (x.img > 0 && (IMGS[x.id] || []).length) : !x.img));
      jumpTo(q.id);
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI();
      fire('where am I weak?');
    }, { wantFigure });
    for (let i = 0; i < 60 && captured.length < 2; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    return captured;
  };

  head('the request Gemini actually receives');
  const toolsLen = await page.evaluate(() => TOOLS.length);
  const reqs = await ask(true);
  const first = reqs[0];
  ok('a request was made', !!first);
  ok('the system prompt is a top-level systemInstruction, not a message', !!first && !!first.body.systemInstruction,
     first && JSON.stringify(Object.keys(first.body || {})));
  ok('contents carries no system role', !!first && first.body.contents.every(c => c.role === 'user' || c.role === 'model'),
     first && first.body.contents.map(c => c.role).join(','));
  ok('the first turn is role "user", never "assistant"', !!first && first.body.contents[0].role === 'user');
  ok('tools are sent as functionDeclarations', !!first && Array.isArray(first.body.tools?.[0]?.functionDeclarations),
     first && JSON.stringify(first.body.tools).slice(0, 80));
  ok('every app tool made it into functionDeclarations', !!first &&
     first.body.tools[0].functionDeclarations.length === toolsLen,
     first && first.body.tools[0].functionDeclarations.length + ' vs ' + toolsLen);

  head('a figure rides as inlineData, not a source block');
  const parts = first ? first.body.contents[0].parts : [];
  const img = parts.find(p => p.inlineData);
  ok('an inlineData part is present for a question with a figure', !!img, JSON.stringify(parts.map(p => Object.keys(p))));
  ok('it carries a mimeType', !!img && /^image\//.test(img.inlineData.mimeType || ''), img && img.inlineData.mimeType);
  ok('its data is raw base64, no data: URL prefix', !!img && typeof img.inlineData.data === 'string' &&
     !img.inlineData.data.startsWith('data:') && img.inlineData.data.length > 100);
  ok('a text part is also present alongside the image', parts.some(p => typeof p.text === 'string' && p.text.length > 0));

  head('the tool round trip: functionCall out, functionResponse back, matched by name');
  ok('two requests were made — the call, then the follow-up with its result', reqs.length >= 2, reqs.length);
  const second = reqs[1];
  if (second) {
    const modelTurn = second.body.contents.find(c => c.role === 'model' && (c.parts || []).some(p => p.functionCall));
    const userTurn = second.body.contents.find(c => (c.parts || []).some(p => p.functionResponse));
    ok('the model\'s functionCall turn was pushed back', !!modelTurn);
    ok('a functionResponse turn follows it', !!userTurn);
    const fr = userTurn && userTurn.parts.find(p => p.functionResponse);
    ok('the functionResponse names the same function that was called', !!fr && fr.functionResponse.name === 'get_performance',
       fr && fr.functionResponse.name);
    ok('the functionResponse carries content, not an id (Gemini has no id to match)', !!fr && !!fr.functionResponse.response &&
       'content' in fr.functionResponse.response && fr.functionResponse.id === undefined);
  } else {
    ok('the model\'s functionCall turn was pushed back', false);
    ok('a functionResponse turn follows it', false);
    ok('the functionResponse names the same function that was called', false);
    ok('the functionResponse carries content, not an id (Gemini has no id to match)', false);
  }

  head('the streamed reply reaches the chat');
  const chatText = await page.evaluate(() => {
    const hist = CHATS[ALL_Q.find(x => !x.bad && x.img > 0).id] || CHATS['_general'] || [];
    return hist.map(m => m.content).join(' | ');
  });
  ok('the follow-up text made it into chat history', /weakest in Pericardial/.test(chatText), chatText.slice(-120));

  head('errors, in Gemini\'s own words');
  await page.route('**/generativelanguage.googleapis.com/**', route => {
    route.fulfill({ status: 403, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) });
  }, { times: 1 });
  const badKeyMsg = await page.evaluate(async () => {
    const r = await fetch(`${ENDPOINT.gemini}/gemini-2.5-flash:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': 'bad' }, body: '{}' });
    return apiError(r, 'gemini');
  });
  ok('a 403 reads as a rejected key, not a raw status code', /rejected/i.test(badKeyMsg), badKeyMsg);

  await page.route('**/generativelanguage.googleapis.com/**', route => {
    route.fulfill({ status: 429, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan.' } }) });
  }, { times: 1 });
  const quotaMsg = await page.evaluate(async () => {
    const r = await fetch(`${ENDPOINT.gemini}/gemini-2.5-flash:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': 'bad' }, body: '{}' });
    return apiError(r, 'gemini');
  });
  ok('a quota 429 says "tomorrow", not "wait a few seconds"', /tomorrow/i.test(quotaMsg), quotaMsg);

  head('regression');
  ok('no console/page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
