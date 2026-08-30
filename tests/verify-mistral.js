#!/usr/bin/env node
/*
 * Behavioural checks for Mistral as a BYOK provider.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-mistral.js /path/to/patched.html
 *
 * Mistral's wire shape is OpenAI-compatible — the same shape Groq used to
 * occupy — but that is a claim worth checking against the actual request
 * rather than trusting that "OpenAI-compatible" was implemented correctly:
 * a system role message instead of Anthropic's separate field or Gemini's
 * systemInstruction, images as a nested {image_url:{url}} object rather than
 * a bare string, tools as {type:'function',function:{...}}, and a distinct
 * assistant tool_calls message followed by one role:'tool' message per
 * result. Discovery is verified against Mistral's real capability booleans
 * (capabilities.completion_chat/.function_calling/.vision) rather than a
 * name regex — simpler than Gemini's filter, but "simpler" is not the same
 * as "obviously right": a first version of this fixture used capabilities.
 * chat, matching a first version of the app's own filter, and the two wrong
 * guesses agreed with each other and passed. A real key exposed it — Mistral
 * names that field completion_chat — so the fixture now matches the field a
 * real response actually sends, not the field a plausible guess invented.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-mistral.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Mistral streams a complete tool-call object per delta rather than
   fragmenting it across chunks the way OpenAI itself does — so, unlike the
   accumulate-by-index parser it exercises, the fixture only needs one chunk
   per call. */
const sse = text => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n';
const toolSSE = (name, args) => 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [
  { index: 0, id: 'call_1', function: { name, arguments: JSON.stringify(args) } },
] } }] }) + '\n\ndata: [DONE]\n\n';

/* A model list shaped the way Mistral really sends one: real capability
   booleans, not a name a filter has to guess at. Alongside the fully capable
   models, the three ways a listed model can fail the filter — no vision, no
   function calling, and neither (a pure embedding model). */
const MODEL_LIST = {
  data: [
    { id: 'pixtral-large-latest', capabilities: { completion_chat: true, function_calling: true, vision: true } },
    { id: 'mistral-small-latest', capabilities: { completion_chat: true, function_calling: true, vision: true } },
    { id: 'mistral-embed', capabilities: { completion_chat: false, function_calling: false, vision: false } },
    { id: 'open-mistral-7b', capabilities: { completion_chat: true, function_calling: false, vision: false } },
    { id: 'pixtral-12b-2409', capabilities: { completion_chat: true, function_calling: true, vision: false } },
  ],
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())
      && !/Failed to load resource.*(401|404|429)/.test(m.text())) errors.push(m.text()); });

  const captured = [];
  let listBody = MODEL_LIST;
  const queued = [];               // queued SSE bodies for chat/completions, in order
  await page.route('**/api.mistral.ai/v1/**', route => {
    const url = route.request().url();
    const method = route.request().method();
    let body = null;
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (_) { /* GETs have none */ }
    captured.push({ url, method, headers: route.request().headers(), body });
    if (/\/models(\?|$)/.test(url)) {
      route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(listBody) });
      return;
    }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: queued.shift() || sse('Noted.') });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);

  head('provider is listed, free, and marked as seeing figures');
  const config = await page.evaluate(() => ({
    listed: PROVIDERS.some(p => p[0] === 'mistral'),
    models: (MODELS.mistral || []).map(m => m[0]),
    keyPrefix: KEY_PREFIX.mistral,
    sees: Vision.providerSeesFigures('mistral'),
    endpoint: ENDPOINT.mistral,
  }));
  ok('mistral is in PROVIDERS', config.listed);
  ok('the model menu has a placeholder before any key exists', config.models.length > 0, config.models.join(', '));
  ok('the key prefix is empty — Mistral keys have no recognisable prefix',
     config.keyPrefix === '', JSON.stringify(config.keyPrefix));
  ok('Vision.providerSeesFigures says mistral can see a figure', config.sees === true);
  ok('endpoint points at the Mistral API', /api\.mistral\.ai/.test(config.endpoint || ''));

  head('key validation — the throwaway call is shaped right');
  const valOk = await page.evaluate(async () => {
    const r = await validateKey('mistral', 'test-mistral-key', 'pixtral-large-latest');
    return r.ok;
  });
  const validateReq = captured.find(c => /\/chat\/completions(\?|$)/.test(c.url));
  ok('a validation request was made', !!validateReq);
  ok('the mocked probe reports ok', valOk === true);
  ok('it posts to chat/completions, the same endpoint a real turn uses',
     !!validateReq && /\/chat\/completions$/.test(validateReq.url), validateReq && validateReq.url);
  ok('the key rides as a bearer token, not in the URL',
     !!validateReq && validateReq.headers['authorization'] === 'Bearer test-mistral-key' &&
     !validateReq.url.includes('test-mistral-key'));
  ok('it sends a minimal one-token probe, not a real conversation',
     !!validateReq && validateReq.body && validateReq.body.max_tokens === 1 &&
     Array.isArray(validateReq.body.messages) && validateReq.body.messages.length === 1);
  captured.length = 0;

  /* Connect a key through the real setup screen — the empty-prefix gate and
     live discovery both live here. */
  const connect = async (key, picked) => {
    captured.length = 0;
    return page.evaluate(async ({ key, picked }) => {
      try { localStorage.removeItem('accsap12.mistral.models'); } catch (_) {}
      AI.mistral = { key: '', model: picked };
      AI.provider = 'mistral';
      aiSettings();
      document.querySelector('[data-prov="mistral"]').click();
      document.getElementById('aiKey').value = key;
      if (picked) {
        const sel = document.getElementById('aiModel');
        if ([...sel.options].some(o => o.value === picked)) sel.value = picked;
      }
      document.getElementById('aiSave').click();
      await new Promise(r => setTimeout(r, 450));
      const el = document.getElementById('keyMsg');
      const msg = el ? el.textContent : '';
      await new Promise(r => setTimeout(r, 500));
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem('accsap12.mistral.models') || 'null'); } catch (_) {}
      return { msg, models: (MODELS.mistral || []).map(m => m[0]), chosen: AI.mistral.model, cached };
    }, { key, picked });
  };

  head('a key with no recognisable prefix is not rejected at the door');
  const gate = await connect('anything-goes-here', 'pixtral-large-latest');
  ok('no "different kind of key" rejection for a provider with no prefix to check',
     !/different kind of key/i.test(gate.msg), gate.msg);
  ok('the connect flow completes and reports success', /Connected/i.test(gate.msg), gate.msg);

  head('Connect asks Mistral which models the key can reach');
  const listReq = captured.find(c => /\/models(\?|$)/.test(c.url));
  ok('a models request was made', !!listReq, listReq && listReq.url);
  ok('it is a GET, not a generate call', !!listReq && listReq.method === 'GET');
  ok('it authenticates with the same bearer token', !!listReq &&
     listReq.headers['authorization'] === 'Bearer anything-goes-here');

  head('the discovered list keeps only models that can chat, call tools, and see');
  ok('a fully capable model is kept', gate.models.includes('pixtral-large-latest'), gate.models.join(', '));
  ok('a second fully capable model is kept too', gate.models.includes('mistral-small-latest'));
  ok('a pure embedding model is dropped', !gate.models.includes('mistral-embed'));
  ok('a model that can chat but not call tools is dropped', !gate.models.includes('open-mistral-7b'));
  ok('a model that can call tools but not see is dropped', !gate.models.includes('pixtral-12b-2409'));
  ok('nothing survives the filter except the two fully capable models',
     gate.models.length === 2, gate.models.join(', '));
  ok('the built-in placeholder id is gone once a real list exists',
     !gate.models.every(m => m === 'pixtral-large-latest') || gate.models.length > 1);
  ok('the picked model, still on the key, is kept as the choice', gate.chosen === 'pixtral-large-latest', gate.chosen);
  ok('the list is cached so the menu is right on the next load',
     Array.isArray(gate.cached) && gate.cached.some(m => m[0] === 'pixtral-large-latest'));

  head('a key with nothing usable shows its evidence, not a generic failure');
  listBody = { data: [{ id: 'mistral-embed', capabilities: { completion_chat: false, function_calling: false, vision: false } }] };
  const starved = await connect('starved-key-0000000000', 'pixtral-large-latest');
  ok('it does not report a false success', !/Connected/i.test(starved.msg), starved.msg);
  ok('it names what Mistral actually returned', /mistral-embed/.test(starved.msg), starved.msg);
  ok('it points at the free Experiment plan, the thing that actually starves a key',
     /Experiment/i.test(starved.msg), starved.msg);
  listBody = MODEL_LIST;
  await connect('test-mistral-key', 'pixtral-large-latest');
  captured.length = 0;

  /* Drive one full exchange: a question with a figure, generic enough that
     the model reaches for a tool — exercising the request shape, the image
     block, the streamed reply, and the tool round trip in one pass. */
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
      fire('where am I weak?');
    }, wantFigure);
    for (let i = 0; i < 60 && captured.length < 2; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    return captured;
  };

  head('the request Mistral actually receives');
  const toolsLen = await page.evaluate(() => TOOLS.length);
  queued.push(toolSSE('get_performance', {}), sse('You are weakest in Pericardial Disease.'));
  const reqs = await ask(true);
  const first = reqs[0];
  ok('a request was made', !!first);
  ok('the system prompt rides as a role:"system" message',
     !!first && first.body.messages[0].role === 'system', first && JSON.stringify(Object.keys(first.body || {})));
  ok('tools are sent as {type:"function",function:{...}}', !!first &&
     Array.isArray(first.body.tools) && first.body.tools[0]?.type === 'function' && !!first.body.tools[0]?.function?.name,
     first && JSON.stringify(first.body.tools).slice(0, 80));
  ok('every app tool made it into the tools array', !!first && first.body.tools.length === toolsLen,
     first && first.body.tools.length + ' vs ' + toolsLen);
  ok('tool_choice is auto, so Apex decides for itself', !!first && first.body.tool_choice === 'auto');
  ok('the request streams', !!first && first.body.stream === true);

  head('a figure rides as image_url, a nested object — not a bare string');
  const userMsgs = first ? (first.body.messages || []).filter(m => m.role === 'user') : [];
  const firstUser = userMsgs[0] || {};
  const blocks = Array.isArray(firstUser.content) ? firstUser.content : [];
  const img = blocks.find(b => b.type === 'image_url');
  ok('an image_url block is present for a question with a figure', !!img, JSON.stringify(blocks.map(b => b.type)));
  ok('image_url is a nested object with a url field, matching OpenAI — one candidate wire format was a bare string, and was wrong',
     !!img && typeof img.image_url === 'object' && typeof img.image_url.url === 'string');
  ok('the url is a real data: URL, not a dead reference',
     !!img && /^data:image\/[a-z]+;base64,/.test((img.image_url || {}).url || ''),
     img && (img.image_url || {}).url && img.image_url.url.slice(0, 24));
  ok('a text block rides alongside the image', blocks.some(b => b.type === 'text' && (b.text || '').length > 0));

  head('the tool round trip: an assistant tool_calls message, then a role:"tool" result');
  ok('two requests were made — the call, then the follow-up with its result', reqs.length >= 2, reqs.length);
  const second = reqs[1];
  const assistantTurn = second && (second.body.messages || []).find(m => m.role === 'assistant' && Array.isArray(m.tool_calls));
  const toolTurn = second && (second.body.messages || []).find(m => m.role === 'tool');
  ok('the assistant turn carries tool_calls', !!assistantTurn);
  ok('a role:"tool" result follows it', !!toolTurn);
  ok('the tool call is {id,type:"function",function:{name,arguments}}', !!assistantTurn &&
     assistantTurn.tool_calls[0]?.type === 'function' && assistantTurn.tool_calls[0]?.function?.name === 'get_performance',
     assistantTurn && JSON.stringify(assistantTurn.tool_calls[0]));
  ok('the tool result carries a tool_call_id matching the call, so Mistral can pair them',
     !!toolTurn && !!assistantTurn && toolTurn.tool_call_id === assistantTurn.tool_calls[0].id);

  head('the streamed reply reaches the chat');
  const chatText = await page.evaluate(() => {
    const hist = CHATS[ALL_Q.find(x => !x.bad && x.img > 0).id] || CHATS['_general'] || [];
    return hist.map(m => m.content).join(' | ');
  });
  ok('the follow-up text made it into chat history', /weakest in Pericardial/.test(chatText), chatText.slice(-120));

  head('apiError names the two providers that remain');
  const err401 = await page.evaluate(async () => apiError({ status: 401, json: async () => ({}) }, 'mistral'));
  ok('a 401 reads as a rejected key', /rejected/i.test(err401), err401);
  const err500 = await page.evaluate(async () => apiError({ status: 500, json: async () => ({}) }, 'mistral'));
  ok('a 500 names Mistral, not a bare status code', /Mistral had a server error/.test(err500), err500);
  const err404 = await page.evaluate(async () => apiError({ status: 404, json: async () => ({}) }, 'mistral'));
  ok('a 404 names Mistral and points at the model menu — no live-discovery-specific copy the way Gemini gets',
     /Mistral/.test(err404) && /pick a different one/i.test(err404), err404);
  const err429 = await page.evaluate(async () => apiError({ status: 429, json: async () => ({}) }, 'mistral'));
  ok('a 429 is a plain rate limit — Mistral\'s free tier is per-minute, not Gemini\'s daily quota',
     /rate limited/i.test(err429) && !/tomorrow/i.test(err429), err429);

  head('the error body is read in the shape each provider actually sends it');
  /* Mistral does not nest the text under `error` the way Gemini and Anthropic
     do — it is {"object":"error","message":"…"} at the top level, or {detail}
     on a validation error. Reading only j.error.message left every Mistral
     failure with an empty explanation: the out-of-credit branch never fired
     and the fallback printed a bare status. Each shape is driven directly. */
  const shapes = await page.evaluate(async () => ({
    mistralTop: await apiError({ status: 400,
      json: async () => ({ object: 'error', message: 'You have exceeded your credit balance.' }) }, 'mistral'),
    mistralDetailStr: await apiError({ status: 418,
      json: async () => ({ detail: 'Extra inputs are not permitted' }) }, 'mistral'),
    mistralDetailArr: await apiError({ status: 422,
      json: async () => ({ detail: [{ msg: 'field required', loc: ['body', 'model'] }] }) }, 'mistral'),
    geminiNested: await apiError({ status: 418,
      json: async () => ({ error: { message: 'nested shape still wins' } }) }, 'gemini'),
    empty: await apiError({ status: 418, json: async () => ({}) }, 'mistral'),
    notJson: await apiError({ status: 418, json: async () => { throw new Error('not json'); } }, 'mistral'),
  }));
  ok('a top-level {message} reaches the out-of-credit branch, which it never used to',
     /out of credit/i.test(shapes.mistralTop), shapes.mistralTop);
  ok('a string {detail} is surfaced rather than swallowed',
     /Extra inputs are not permitted/.test(shapes.mistralDetailStr), shapes.mistralDetailStr);
  ok('an array {detail} is serialised rather than printed as [object Object]',
     /field required/.test(shapes.mistralDetailArr) && !/\[object Object\]/.test(shapes.mistralDetailArr),
     shapes.mistralDetailArr);
  ok('Gemini\'s nested shape is still read first, so nothing regressed there',
     /nested shape still wins/.test(shapes.geminiNested), shapes.geminiNested);
  ok('an error body with nothing in it does not print "undefined"',
     !/undefined|null/.test(shapes.empty), shapes.empty);
  ok('a body that is not JSON at all is survived, not thrown through',
     typeof shapes.notJson === 'string' && !/undefined/.test(shapes.notJson), shapes.notJson);

  head('what the provider says is shown, not run');
  /* keyMsg() assigns with innerHTML — it must, because several apiError
     branches deliberately return markup ("press <b>Connect</b> again"). That
     makes the one place the provider's own text is interpolated into that
     string an injection sink, in the origin holding the fellow's API keys,
     notes and chats. Driven through the real sink rather than by inspecting
     the string, because the string looking wrong is not the failure — an
     element being constructed and its handler running is. */
  const inject = await page.evaluate(async () => {
    aiSettings();                                     // puts #keyMsg in the DOM
    delete window.__pwned;
    const hostile = { status: 418, json: async () => ({ object: 'error',
      message: '<img src=x onerror="window.__pwned=1"><b>markup</b>' }) };
    const msg = await apiError(hostile, 'mistral');
    keyMsg(msg, 'bad');
    await new Promise(r => setTimeout(r, 350));
    const el = document.getElementById('keyMsg');
    return { imgs: el.querySelectorAll('img').length,
             bolds: el.querySelectorAll('b').length,
             ran: window.__pwned === 1,
             shown: el.textContent };
  });
  ok('a provider error carrying markup builds no elements', inject.imgs === 0 && inject.bolds === 0,
     `${inject.imgs} img, ${inject.bolds} b`);
  ok('and nothing in it executes', !inject.ran);
  ok('while the fellow still sees what the provider actually said',
     /markup/.test(inject.shown) && /img src=x/.test(inject.shown), inject.shown.slice(0, 70));
  /* The escaping must not have flattened the markup apiError writes itself. */
  const ownMarkup = await page.evaluate(async () => {
    aiSettings();
    keyMsg(await apiError({ status: 404, json: async () => ({}) }, 'gemini'), 'bad');
    return document.getElementById('keyMsg').querySelectorAll('b').length;
  });
  ok('apiError\'s own deliberate markup still renders', ownMarkup === 1, `${ownMarkup} <b>`);

  head('a mid-stream error ends the turn instead of vanishing');
  /* The same wrong shape with a worse ending. Mistral can abort a turn by
     emitting one error object into the SSE stream; because it is not
     {error:{…}}, the old check skipped it as an ordinary chunk and the reply
     simply stopped — a truncated answer with no error shown anywhere, which
     reads as the app losing the thread rather than the API refusing. */
  queued.length = 0;
  queued.push('data: ' + JSON.stringify({ object: 'error',
    message: 'Service tier capacity exceeded for this model.' }) + '\n\ndata: [DONE]\n\n');
  const midStream = await page.evaluate(async () => {
    AI.provider = 'mistral';
    AI.mistral = { key: 'test-mistral-key', model: 'pixtral-large-latest' };
    CHATS['_general'] = []; S.screen = 'home';
    buildAI();
    fire('this turn dies mid-stream');
    for (let i = 0; i < 90 && aiBusy; i++) await new Promise(r => setTimeout(r, 120));
    return (CHATS['_general'] || []).map(m => ({ err: !!m.err, text: String(m.content || '') }));
  });
  const errTurn = midStream.find(m => m.err);
  ok('the failure is recorded as an error turn, not silently dropped',
     !!errTurn, midStream.map(m => (m.err ? 'ERR:' : '') + m.text.slice(0, 40)).join(' | '));
  ok('and it carries what the API actually said, so it is diagnosable',
     !!errTurn && /Service tier capacity exceeded/.test(errTurn.text), errTurn && errTurn.text);
  ok('the turn is not left stuck busy afterwards',
     await page.evaluate(() => aiBusy === false));

  head('a config saved before Mistral existed gets a slot, and an existing key is not disturbed');
  /* The self-heal runs once, at script load — so proving the APP repairs this
     means saving the stale shape and reloading, not hand-patching AI. */
  await page.evaluate(() => {
    saveJSON(AI_CFG, { provider: 'gemini', gemini: { key: 'AIzaFAKE-TEST-KEY', model: 'gemini-2.5-flash' } });  // no .mistral
  });
  await page.reload({ waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(800);
  const healed = await page.evaluate(() => ({
    hasEmptyMistralSlot: !!AI.mistral && AI.mistral.key === '' && AI.mistral.model === '',
    geminiUntouched: !!AI.gemini && AI.gemini.key === 'AIzaFAKE-TEST-KEY',
    provider: AI.provider,
  }));
  ok('a fresh, empty .mistral slot appears without being asked for',
     healed.hasEmptyMistralSlot, JSON.stringify(healed));
  ok('the fellow\'s existing Gemini key survives untouched', healed.geminiUntouched);
  ok('the active provider is left as it was, not reset to the default', healed.provider === 'gemini', healed.provider);

  head('regression');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
