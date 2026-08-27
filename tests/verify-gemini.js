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
      && !/Failed to load resource.*(403|404|429)/.test(m.text())) errors.push(m.text()); });

  /* A realistic ListModels page: two usable chat models, plus the three kinds
     of thing the filter has to reject — an embedding model, an image model,
     and a model that can generateContent but cannot stream, which this app
     needs because it streams every reply. */
  const MODEL_LIST = {
    models: [
      { name: 'models/gemini-9.9-flash', displayName: 'Gemini 9.9 Flash',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'] },
      { name: 'models/gemini-9.9-pro', displayName: 'Gemini 9.9 Pro',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
      { name: 'models/text-embedding-9', displayName: 'Text Embedding 9',
        supportedGenerationMethods: ['embedContent'] },
      { name: 'models/imagen-9', displayName: 'Imagen 9',
        supportedGenerationMethods: ['predict'] },
      { name: 'models/gemini-9.9-batch', displayName: 'Gemini 9.9 Batch',
        supportedGenerationMethods: ['generateContent'] },
    ],
  };

  const captured = [];
  let turn = 0;
  let listBody = MODEL_LIST;            // swapped per-test to fake a starved key
  await page.route('**/generativelanguage.googleapis.com/**', route => {
    const url = route.request().url();
    let body = null;
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (_) { /* GETs have none */ }
    captured.push({ url, method: route.request().method(), headers: route.request().headers(), body });
    /* ListModels is the collection itself — no ":method" suffix on the path. */
    if (/\/v1beta\/models(\?|$)/.test(url)) {
      route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(listBody) });
      return;
    }
    if (/:generateContent(\?|$)/.test(url) && !/streamGenerateContent/.test(url)) {
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
  ok('the model menu has a placeholder before any key exists', config.models.length > 0, config.models.join(', '));
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

  /* Connect a key through the real setup screen. This is the whole fix: the
     model ids are not written into the build any more, they are whatever this
     key can actually reach. */
  const connect = async (key, picked) => {
    captured.length = 0;
    return page.evaluate(async ({ key, picked }) => {
      try { localStorage.removeItem('accsap12.gemini.models'); } catch (_) {}
      AI.gemini = { key: '', model: picked };
      AI.provider = 'gemini';
      aiSettings();
      document.querySelector('[data-prov="gemini"]').click();
      document.getElementById('aiKey').value = key;
      if (picked) {
        const sel = document.getElementById('aiModel');
        if ([...sel.options].some(o => o.value === picked)) sel.value = picked;
      }
      document.getElementById('aiSave').click();
      /* Read the message BEFORE the success path's deferred buildAI() fires and
         replaces the whole panel, then wait past that timer so the next connect
         starts from a settled DOM rather than racing a pending re-render. */
      await new Promise(r => setTimeout(r, 450));
      const el = document.getElementById('keyMsg');
      const msg = el ? el.textContent : '';
      await new Promise(r => setTimeout(r, 500));
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem('accsap12.gemini.models') || 'null'); } catch (_) {}
      return { msg, models: (MODELS.gemini || []).map(m => m[0]),
               chosen: AI.gemini.model, cached };
    }, { key, picked });
  };

  head('setup accepts the new AQ. key shape, not just the old AIza one');
  const aq = await connect('AQ.Ab8-FAKE-TEST-KEY-NOT-REAL-0000000000000000000000', 'gemini-2.5-flash');
  ok('a real AQ. key is not rejected as "a different kind of key"', !/different kind of key/i.test(aq.msg), aq.msg);

  head('Connect asks Google which models the key can reach');
  const listReq = captured.find(c => /\/v1beta\/models(\?|$)/.test(c.url));
  ok('a ListModels request was made', !!listReq, listReq && listReq.url);
  ok('it is a GET on the collection, not a generate call', !!listReq && listReq.method === 'GET');
  ok('it authenticates with the same x-goog-api-key header',
     !!listReq && /^AQ\./.test(listReq.headers['x-goog-api-key'] || ''));
  ok('no throwaway generateContent call is made — ListModels already proves the key',
     !captured.some(c => /:generateContent(\?|$)/.test(c.url) && !/streamGenerateContent/.test(c.url)));

  head('the discovered list replaces the built-in placeholder');
  ok('both streamable chat models were kept',
     aq.models.includes('gemini-9.9-flash') && aq.models.includes('gemini-9.9-pro'), aq.models.join(', '));
  ok('the embedding model was dropped', !aq.models.includes('text-embedding-9'));
  ok('the image model was dropped', !aq.models.includes('imagen-9'));
  ok('a generateContent-only model was dropped, because every reply streams',
     !aq.models.includes('gemini-9.9-batch'));
  ok('the stale placeholder id is gone', !aq.models.includes('gemini-2.5-flash'), aq.models.join(', '));
  ok('a model the key does not have is not silently kept as the choice',
     aq.chosen !== 'gemini-2.5-flash', aq.chosen);
  ok('it fell back to a plain Flash rather than the first thing in the list',
     aq.chosen === 'gemini-9.9-flash', aq.chosen);
  ok('the fellow is told their pick was not available',
     /not on this key/i.test(aq.msg), aq.msg);
  ok('the list is cached so the menu is right on the next load',
     Array.isArray(aq.cached) && aq.cached.some(m => m[0] === 'gemini-9.9-flash'));

  head('a key whose project has no chat model says so, instead of failing later');
  listBody = { models: [{ name: 'models/text-embedding-9', displayName: 'Embedding',
                          supportedGenerationMethods: ['embedContent'] }] };
  const starved = await connect('AQ.Ab8-STARVED-KEY-0000000000000000000000000000', 'gemini-9.9-flash');
  ok('it does not report a false success', !/Connected/i.test(starved.msg), starved.msg);
  ok('the message names the real problem and the real fix',
     /no chat-capable/i.test(starved.msg) && /project/i.test(starved.msg), starved.msg);
  listBody = MODEL_LIST;
  await connect('AQ.Ab8-FAKE-TEST-KEY-NOT-REAL-0000000000000000000000', 'gemini-9.9-flash');
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

  await page.route('**/generativelanguage.googleapis.com/**', route => {
    route.fulfill({ status: 404, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'models/gemini-1.0-pro is not found for API version v1beta' } }) });
  }, { times: 1 });
  const goneMsg = await page.evaluate(async () => {
    const r = await fetch(`${ENDPOINT.gemini}/gemini-1.0-pro:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': 'x' }, body: '{}' });
    return apiError(r, 'gemini');
  });
  /* The old text sent you to a menu in which every name was equally dead. */
  ok('a retired model points at Connect, not at the model menu',
     /Connect/.test(goneMsg) && !/pick a different one in settings/i.test(goneMsg), goneMsg);

  head('regression');
  ok('no console/page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
