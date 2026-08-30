#!/usr/bin/env node
/*
 * The Cloudflare Worker that holds the Gemini key.
 *
 *   node tests/verify-worker.js
 *
 * No browser and no Wrangler — there is no Workers runtime in this
 * environment, so the Worker exports a pure handleApex(request, env, fetchImpl)
 * and this drives it with a fake env and a stubbed fetch. That covers every
 * claim worth making about it: what it forwards, what it refuses, what it
 * attaches, and what it never sends back.
 *
 * The one claim it cannot make is "this runs on Cloudflare". That is verified
 * by deploying it.
 */
'use strict';

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ENV = { GEMINI_API_KEY: 'AQ.server-side-secret' };
const body = (extra = {}) => JSON.stringify(Object.assign({
  systemInstruction: { parts: [{ text: 'you are apex' }] },
  generationConfig: { maxOutputTokens: 2000 },
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
}, extra));

/* A stub that records what it was asked for and answers plausibly. */
function stub(reply) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    return reply || {
      status: 200,
      body: 'STREAM-BODY',
      headers: new Map([['content-type', 'text/event-stream']]),
    };
  };
  fn.calls = calls;
  return fn;
}
const req = (path, init = {}) => new Request('https://systole.pages.dev' + path, init);
const post = (path, b) => req(path, { method: 'POST', body: b === undefined ? body() : b });

(async () => {
  const { handleApex, default: worker } = await import('file://' + require('path').resolve(__dirname, '..', 'src', 'worker', 'apex.js'));

  head('the site still works — the line that matters most');
  /* In advanced mode the Worker owns EVERY request to the project. Forgetting
     the ASSETS passthrough does not break the API, it 404s the whole app. */
  {
    let asked = null;
    const env = { ...ENV, ASSETS: { fetch: r => { asked = r.url; return { status: 200, ok: true }; } } };
    await worker.fetch(req('/'), env);
    ok('a request for the site goes to ASSETS, not to the API', asked === 'https://systole.pages.dev/', asked);
    asked = null;
    await worker.fetch(req('/content/questions.json'), env);
    ok('and so does the question bank', /questions\.json$/.test(asked || ''), asked);
    asked = null;
    await worker.fetch(post('/api/apex/gemini/generate?model=gemini-3-flash-preview'),
      { ...env, GEMINI_API_KEY: '' });
    ok('but an /api/apex path never reaches ASSETS', asked === null, String(asked));
  }

  head('what it refuses');
  {
    const f = stub();
    const r1 = await handleApex(post('/api/apex/gemini/summarise?model=gemini-3-flash-preview'), ENV, f);
    ok('an op that is not on the list is a 404', r1.status === 404, String(r1.status));
    const r2 = await handleApex(post('/api/apex/gemini/generate?model=gpt-4o'), ENV, f);
    ok('a model that is not Gemini is refused', r2.status === 400, String(r2.status));
    const r3 = await handleApex(post('/api/apex/gemini/generate'), ENV, f);
    ok('and so is no model at all', r3.status === 400, String(r3.status));
    const r4 = await handleApex(req('/api/apex/gemini/generate?model=gemini-3-flash-preview'), ENV, f);
    ok('GET on a generate route is refused', r4.status === 405, String(r4.status));
    const big = body({ pad: 'x'.repeat(7 * 1024 * 1024) });
    const r5 = await handleApex(post('/api/apex/gemini/generate?model=gemini-3-flash-preview', big), ENV, f);
    ok('a body over the cap is refused', r5.status === 413, String(r5.status));
    ok('and none of those reached Google', f.calls.length === 0, String(f.calls.length));
    const r6 = await handleApex(post('/api/apex/gemini/generate?model=gemini-3-flash-preview'),
      { GEMINI_API_KEY: '' }, f);
    const j6 = await r6.json();
    ok('a missing secret is a 503 that names it', r6.status === 503 && /GEMINI_API_KEY/.test(j6.error.message),
       j6.error.message.slice(0, 60));
  }

  head('what it attaches, and what it never sends back');
  {
    const f = stub();
    const r = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'), ENV, f);
    const call = f.calls[0];
    ok('the request went to the streaming endpoint for that model',
       /\/gemini-3-flash-preview:streamGenerateContent\?alt=sse$/.test(call.url), call.url);
    ok('with the server-side key attached',
       call.opts.headers['x-goog-api-key'] === 'AQ.server-side-secret');
    /* The browser must never be able to read the key back out of a response. */
    const echoed = [...(r.headers || new Headers()).keys ? r.headers.keys() : []];
    ok('and the key is not echoed to the browser in any header',
       !echoed.some(h => /goog-api-key|authorization/i.test(h)), echoed.join(', '));
    /* "Not buffered" is not directly observable from outside, so the claim is
       made two ways: the Worker never awaited the upstream body (it hands back
       a stream, not a string), and what arrives is byte-identical. */
    ok('the reply comes back as a stream rather than a collected string',
       r.body && typeof r.body.getReader === 'function', typeof r.body);
    ok('and it arrives intact', (await r.text()) === 'STREAM-BODY');
    ok('and keeps the content type the SSE reader expects',
       r.headers.get('content-type') === 'text/event-stream', r.headers.get('content-type'));
  }

  head('the body is forwarded, not rebuilt');
  {
    /* Every line that rebuilt a turn would be a line that could drop an image
       or break a thought-signature round trip. */
    const f = stub();
    const sent = body({ tools: [{ functionDeclarations: [{ name: 'search_bank' }] }] });
    await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', sent), ENV, f);
    const got = JSON.parse(f.calls[0].opts.body);
    ok('the conversation arrives at Google unchanged',
       JSON.stringify(got.contents) === JSON.stringify(JSON.parse(sent).contents));
    ok('and so do the tools', got.tools[0].functionDeclarations[0].name === 'search_bank');
    ok('and the system instruction', got.systemInstruction.parts[0].text === 'you are apex');
  }

  head('the output clamp, which is what bounds the bill');
  {
    const f = stub();
    const greedy = body({ generationConfig: { maxOutputTokens: 900000 } });
    await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', greedy), ENV, f);
    const got = JSON.parse(f.calls[0].opts.body);
    ok('an inflated maxOutputTokens is clamped', got.generationConfig.maxOutputTokens === 2000,
       String(got.generationConfig.maxOutputTokens));
    ok('and the rest of the request survives the rewrite',
       got.contents[0].parts[0].text === 'hello' && got.systemInstruction.parts[0].text === 'you are apex');

    const f2 = stub();
    await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', body()), ENV, f2);
    ok('a reasonable one is left alone',
       JSON.parse(f2.calls[0].opts.body).generationConfig.maxOutputTokens === 2000);

    /* A note quoting the literal text must not be rewritten — that would
       corrupt the fellow's own prose on its way to the model. */
    const f3 = stub();
    const quoting = JSON.stringify({
      systemInstruction: { parts: [{ text: 'x' }] },
      generationConfig: { maxOutputTokens: 2000 },
      contents: [{ role: 'user', parts: [{ text: 'my note says "maxOutputTokens": 99999 somewhere' }] }],
    });
    await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', quoting), ENV, f3);
    ok('a note that quotes the field is not rewritten',
       /"maxOutputTokens": 99999 somewhere/.test(JSON.parse(f3.calls[0].opts.body).contents[0].parts[0].text));

    /* THIS USED TO ASSERT A REFUSAL, AND THE REFUSAL WAS WRONG. The rule was
       "generationConfig must be inside the 64 KB head window or the request is
       rejected", on the stated grounds that the app always puts it first. The
       app does not: the streaming body is systemInstruction, tools,
       generationConfig, contents — and systemInstruction carries the system
       prompt plus every retrieved note clipped at 4000 characters plus memory.
       A heavy grounded turn is past 64 KB, so the edge was rejecting its own
       client's real traffic.

       What actually protects the bill is the clamp, not the window. So a
       buried generationConfig is now found and clamped. The property under
       test is the one that always mattered: nothing gets through unclamped. */
    const f4 = stub();
    const buried = '{"contents":[{"role":"user","parts":[{"text":"' + 'y'.repeat(70 * 1024) +
                   '"}]}],"generationConfig":{"maxOutputTokens":900000}}';
    const r4 = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', buried), ENV, f4);
    ok('a generationConfig past the head window is still found', f4.calls.length === 1, String(r4.status));
    ok('and clamped rather than let through',
       f4.calls.length === 1 && /"maxOutputTokens":2000/.test(f4.calls[0].opts.body) &&
       !/900000/.test(f4.calls[0].opts.body));

    /* A grounded turn, shaped the way the app actually shapes one. */
    const f5 = stub();
    const grounded = '{"systemInstruction":{"parts":[{"text":"' + 'note. '.repeat(14000) +
                     '"}]},"tools":[],"generationConfig":{"maxOutputTokens":2000},' +
                     '"contents":[{"role":"user","parts":[{"text":"what is takotsubo?"}]}]}';
    const r5 = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', grounded), ENV, f5);
    ok('a real grounded turn with 80 KB of notes is forwarded, not refused',
       r5.status === 200 && f5.calls.length === 1, String(r5.status));
    ok('and reaches Google byte-for-byte, since it asked for no more than allowed',
       f5.calls.length === 1 && f5.calls[0].opts.body === grounded);
  }

  head('the model list, so the menu comes from the live key');
  {
    const f = stub({ status: 200, body: '{"models":[]}', headers: new Map([['content-type', 'application/json']]) });
    const r = await handleApex(req('/api/apex/gemini/models'), ENV, f);
    ok('it reaches ListModels with the server key', /\/v1beta\/models\?pageSize=200$/.test(f.calls[0].url),
       f.calls[0].url);
    ok('with the secret attached there too', f.calls[0].opts.headers['x-goog-api-key'] === 'AQ.server-side-secret');
    ok('and comes back as JSON', r.status === 200 && r.headers.get('content-type') === 'application/json');
    const f2 = stub();
    await handleApex(req('/api/apex/gemini/models?pageToken=abc'), ENV, f2);
    ok('pagination is carried through', /pageToken=abc/.test(f2.calls[0].url), f2.calls[0].url);
  }

  head('failures are reported, not swallowed');
  {
    const f = stub({ status: 429, body: '{"error":{"message":"quota"}}',
                     headers: new Map([['content-type', 'application/json']]) });
    const r = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'), ENV, f);
    ok('an upstream status is preserved, so the app can explain it', r.status === 429, String(r.status));
    /* apiError() in the app reads .error.message; a thrown fetch must still
       produce that shape rather than an empty 502. */
    const env2 = { ...ENV, ASSETS: { fetch: () => ({ status: 200 }) } };
    const bad = { ...env2 };
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network down'); };
    const r2 = await worker.fetch(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'), bad);
    globalThis.fetch = orig;
    const j2 = await r2.json();
    ok('and a network failure is a 502 in Google\'s own error shape',
       r2.status === 502 && typeof j2.error.message === 'string', j2.error.message);
  }

  head('the rate limiter, which is a speed bump and says so');
  {
    const f = stub();
    const env = { ...ENV, APEX_RPM: '3' };
    const mk = () => handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body(), headers: { 'cf-connecting-ip': '203.0.113.9' } }), env, f);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await mk()).status);
    ok('a burst past the limit is refused', codes.filter(c => c === 429).length >= 1, codes.join(','));
    ok('and the ones under it went through', codes.filter(c => c === 200).length === 3, codes.join(','));
  }

  head('the model name is a model name, whatever APEX_MODELS says');
  /* The model is interpolated into a URL path. The DEFAULT regex is anchored
     and refuses anything structural, but APEX_MODELS exists precisely so an
     operator can replace it — and "gemini-" is the obvious thing to write to
     widen the allowlist. Unanchored, it let a model of
     "gemini-2.5-flash/../../../v1beta/tunedModels/private" through, and the
     URL normalised to a different Google endpoint reached with this
     deployment's key attached. The shape check must not be delegable. */
  {
    const traversal = 'gemini-2.5-flash/../../../v1beta/tunedModels/private';
    const loose = { ...ENV, APEX_RPM: '0', APEX_MODELS: 'gemini-' };
    let reached = null;
    const spy = async (url) => { reached = url; return new Response('ok', { status: 200 }); };
    const r = await handleApex(new Request(
      'https://systole.pages.dev/api/apex/gemini/stream?model=' + encodeURIComponent(traversal),
      { method: 'POST', body: body() }), loose, spy);
    ok('a widened allowlist still cannot admit a path', r.status === 400, String(r.status));
    ok('and no request left for anywhere', reached === null, String(reached));

    /* The widened allowlist must still do its actual job. */
    let ok2 = null;
    const spy2 = async (url) => { ok2 = url; return new Response('ok', { status: 200 }); };
    const good = await handleApex(new Request(
      'https://systole.pages.dev/api/apex/gemini/stream?model=gemini-9.9-flash',
      { method: 'POST', body: body() }), loose, spy2);
    ok('while a genuine model it was widened for still goes through',
       good.status === 200 && /\/models\/gemini-9\.9-flash:/.test(ok2 || ''), String(good.status));

    for (const bad of ['gemini-x?key=leak', 'gemini-x#frag', 'gemini-x:generateContent', '../etc', '']) {
      const rr = await handleApex(new Request(
        'https://systole.pages.dev/api/apex/gemini/stream?model=' + encodeURIComponent(bad),
        { method: 'POST', body: body() }), loose, async () => new Response('ok'));
      ok(`"${bad || '(empty)'}" is refused`, rr.status === 400, String(rr.status));
    }
  }

  head('the output clamp is bounded by the object, not by a character count');
  /* generationConfig was scanned in a fixed 400-character window. Add
     stopSequences or a responseSchema and maxOutputTokens slides out of it,
     and a request carrying a perfectly good value is refused as though it
     carried none. */
  {
    const pad = '"stopSequences":[' + Array.from({ length: 30 }, (_, i) => `"seq${i}xxxxxxxxxx"`).join(',') + '],';
    const big = '{"systemInstruction":{},"generationConfig":{' + pad + '"maxOutputTokens":9999},"contents":[]}';
    let sent = null;
    const f = async (u, init) => { sent = init && init.body; return new Response('ok', { status: 200 }); };
    const r = await handleApex(new Request(
      'https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: big }), { ...ENV, APEX_RPM: '0' }, f);
    ok('a generationConfig larger than the old window is not refused', r.status === 200, String(r.status));
    ok('and its maxOutputTokens is still clamped', /"maxOutputTokens":2000/.test(sent || ''),
       (sent || '').slice(-60));
    ok('the padding either side of it is untouched',
       /"stopSequences"/.test(sent || '') && /"contents":\[\]/.test(sent || ''));
  }

  head('a typo in a dashboard field does not disable a safeguard');
  /* All three of these are strings typed into a Cloudflare settings field, and
     each used to fail differently and quietly:
       APEX_RPM         +"twenty" is NaN and NaN > 0 is false, so the limiter
                        was skipped entirely — a rate limit that stops limiting
                        and looks no different from one that works.
       APEX_MAX_OUTPUT  NaN was written into the body as "maxOutputTokens":NaN,
                        which is not valid JSON, so every request failed at
                        Google with nothing useful said about why.
       APEX_MODELS      new RegExp() threw, the outer handler caught it, and it
                        surfaced as "Could not reach Google" — blaming Google
                        for a typo in your own settings. */
  {
    const codes = [];
    for (let i = 0; i < 25; i++) {
      const r = await handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
        { method: 'POST', body: body(), headers: { 'cf-connecting-ip': '198.51.100.7' } }),
        { ...ENV, APEX_RPM: 'twenty' }, stub());
      codes.push(r.status);
    }
    ok('a non-numeric APEX_RPM falls back to the default instead of switching the limiter off',
       codes.includes(429), `${codes.filter(c => c === 200).length} ok, ${codes.filter(c => c === 429).length} limited`);

    let sent = null;
    const spy = async (u, i) => { sent = i && i.body; return new Response('ok', { status: 200 }); };
    await handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body() }), { ...ENV, APEX_RPM: '0', APEX_MAX_OUTPUT: '2k' }, spy);
    ok('a non-numeric APEX_MAX_OUTPUT never reaches the body as NaN', !/NaN/.test(sent || ''), (sent || '').slice(0, 70));
    let parses = true; try { JSON.parse(sent); } catch (_) { parses = false; }
    ok('so what is forwarded is still valid JSON', parses);

    const r = await worker.fetch(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body() }),
      { ...ENV, APEX_RPM: '0', APEX_MODELS: 'gemini-([a-z', ASSETS: { fetch: async () => new Response('site') } });
    const msg = (await r.json()).error.message;
    ok('a malformed APEX_MODELS names the variable rather than blaming Google',
       /APEX_MODELS/.test(msg) && !/reach Google/.test(msg), `${r.status} ${msg.slice(0, 60)}`);

    /* And a good configuration is untouched by any of it. */
    let good = null;
    const spy2 = async (u, i) => { good = i && i.body; return new Response('ok', { status: 200 }); };
    const okr = await handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body() }), { ...ENV, APEX_RPM: '0', APEX_MAX_OUTPUT: '500' }, spy2);
    ok('a valid APEX_MAX_OUTPUT still clamps to exactly that',
       okr.status === 200 && /"maxOutputTokens":500/.test(good || ''), (good || '').slice(0, 60));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
