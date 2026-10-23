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
 *
 * Nor does it reach Cloudflare Access. The Worker checks the token Access
 * signs against the keys the team publishes; here the team is a key pair this
 * file generates with WebCrypto, its tokens are signed locally, and the global
 * fetch is replaced for the whole file so the Worker's request for the team's
 * keys is answered from that pair. Anything else that reaches the global fetch
 * throws, so no check here can pass by touching the network.
 */
'use strict';

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* The team and the application the Worker is told to trust. ISS is what Access
   writes into iss for that team. */
const TEAM = 'systole-test.cloudflareaccess.com';
const ISS = 'https://' + TEAM;
const AUD = 'a1'.repeat(32);
const ENV = { GEMINI_API_KEY: 'AQ.server-side-secret', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

/* ── a stand-in for Access: a team key, an intruder's key, and tokens ──── */
const { subtle } = globalThis.crypto;
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const b64u = bytes => Buffer.from(bytes).toString('base64url');
async function keyPair(kid) {
  const k = await subtle.generateKey(RSA, true, ['sign', 'verify']);
  const { n, e } = await subtle.exportKey('jwk', k.publicKey);
  /* Shaped like an entry in the team's certs "keys" list. */
  return { kid, privateKey: k.privateKey, jwk: { kid, kty: 'RSA', alg: 'RS256', use: 'sig', n, e } };
}
const nowS = () => Math.floor(Date.now() / 1000);
/* What Access puts in a token for a signed-in person, for this application. */
const claims = (over = {}) => Object.assign({
  aud: [AUD], email: 'fellow@example.org', exp: nowS() + 3600, iat: nowS(), nbf: nowS(),
  iss: ISS, type: 'app', sub: '00000000-0000-4000-8000-000000000001', country: 'GB',
}, over);
let TEAM_KEY = null, INTRUDER = null;
async function sign(payload, { key = TEAM_KEY, kid = key.kid, alg = 'RS256', header = {} } = {}) {
  const h = b64u(JSON.stringify({ alg, kid, typ: 'JWT', ...header }));
  const p = b64u(JSON.stringify(payload));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, Buffer.from(h + '.' + p));
  return `${h}.${p}.${b64u(sig)}`;
}

/* THE GLOBAL FETCH, for the whole file. The Worker's deployed gate fetches the
   team's keys with it, so the team's certs URL answers from TEAM_KEY. `google`
   is what a test wants the rest of the network to say; when it is null,
   anything else that arrives here throws instead of leaving the machine. */
const CERTS = new Map();
const ATTACKER_KEYS = 'https://keys.attacker.example/certs';
let google = null;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (CERTS.has(url)) {
    return new Response(JSON.stringify(CERTS.get(url)), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (google) return google(url, init);
  throw new Error('verify-worker reached for the network: ' + url);
};

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
/* Every request below carries an Access identity, because the Worker now
   refuses one that does not — see the fail-closed block in handleApex. The
   header is added HERE rather than at each call site so that the gate's own
   tests, which deliberately omit it, are the only place in this file where its
   absence appears. Adding it site by site would have meant sixty chances to
   write an authenticated test that was quietly testing the anonymous path.

   The identity is a token signed with the team's key (for fellow@example.org,
   good for an hour), not the cf-access-authenticated-user-email header it
   used to be: a header anyone can type is what the gate no longer accepts.
   Assigned once the key exists, before the first check. */
let ACCESS = null;
const req = (path, init = {}) => new Request('https://systole.pages.dev' + path,
  { ...init, headers: { ...ACCESS, ...(init.headers || {}) } });
const post = (path, b) => req(path, { method: 'POST', body: b === undefined ? body() : b });
/* Deliberately without one. */
const anonPost = (path, b) => new Request('https://systole.pages.dev' + path,
  { method: 'POST', body: b === undefined ? body() : b });

(async () => {
  const { handleApex, accessVerifier, default: worker } = await import('file://' + require('path').resolve(__dirname, '..', 'src', 'worker', 'apex.js'));
  TEAM_KEY = await keyPair('team-key-1');
  INTRUDER = await keyPair('intruder-key');
  CERTS.set(ISS + '/cdn-cgi/access/certs', { keys: [TEAM_KEY.jwk] });
  /* A key server the intruder runs, answering for real: a token that names it
     (jku) would verify, if the Worker ever asked a token where its keys are. */
  CERTS.set(ATTACKER_KEYS, { keys: [INTRUDER.jwk] });
  ACCESS = { 'cf-access-jwt-assertion': await sign(claims()) };

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

  head('who is asking is what Access signed, not what the request says');
  {
    /* THE FINDING THIS CLOSES. The gate read cf-access-authenticated-user-email.
       Access sets that header when it is in front; where it is not — the very
       deployment the gate exists for — the header is the client's own word, and
       one typed header got the key handed out (reproduced: 200, Google called).
       The identity is now the email in the token Access signs, checked against
       the team's keys, the team, this application's AUD and the token's
       lifetime.

       Every refusal is checked for its REASON as well as its status. The checks
       overlap — a token for another application is refused by the aud check,
       and would be by others behind it — so a check that read only 403 would
       stay green with the very check it names removed.

       APEX_RPM '0' unless the check is about the limiter: the buckets are shared
       by the whole file.

       This section runs before the routing checks, in the handler's own order.
       A gate that refused every request would otherwise crash the suite at the
       first check below that reads a forwarded call (f.calls[0].url), and none
       of these would ever report which of them failed. */
    const NORATE = { ...ENV, APEX_RPM: '0' };
    const PATH = 'https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview';
    const send = async (headers, env = NORATE, verify) => {
      const f = stub();
      const r = await handleApex(new Request(PATH, { method: 'POST', body: body(), headers }), env, f, verify);
      const said = r.status === 200 ? '' : String(((await r.json()).error || {}).message || '');
      return { status: r.status, google: f.calls.length, said };
    };
    const jwt = token => ({ 'cf-access-jwt-assertion': token });
    const TYPED = { 'cf-access-authenticated-user-email': 'fellow@example.org' };
    const show = r => `${r.status}, Google called ${r.google}x${r.said ? ', ' + r.said.slice(0, 90) : ''}`;
    const GOOD = await sign(claims());

    const forged = await send(TYPED);
    ok('a typed cf-access-authenticated-user-email with no token is refused', forged.status === 403 && forged.google === 0, show(forged));
    ok('and the refusal says the request carries no Access token', /no Cloudflare Access token/.test(forged.said), show(forged));

    const good = await send(jwt(GOOD));
    ok('a token the team signed, for this application, in date, is served', good.status === 200 && good.google === 1, show(good));
    const strAud = await send(jwt(await sign(claims({ aud: AUD }))));
    ok('an aud written as one string rather than a list, as RFC 7519 allows, is read', strAud.status === 200, show(strAud));
    const early = await send(jwt(await sign(claims({ iat: nowS() + 5, nbf: nowS() + 5 }))));
    ok('a token minted a few seconds ahead of this clock is not refused for it', early.status === 200, show(early));

    /* alg none and HS256 are the two classic ways round an RS256 check: no
       signature at all, or an HMAC keyed on the public key, which anyone has. */
    const segs = alg => [b64u(JSON.stringify({ alg, kid: TEAM_KEY.kid, typ: 'JWT' })), b64u(JSON.stringify(claims()))];
    const [nh, np] = segs('none');
    const [hh, hp] = segs('HS256');
    const hs256 = `${hh}.${hp}.` + require('crypto').createHmac('sha256', TEAM_KEY.jwk.n).update(`${hh}.${hp}`).digest('base64url');
    const refusals = [
      ['signed with another key under the team key\'s kid', await sign(claims(), { key: INTRUDER, kid: TEAM_KEY.kid }), /signature does not verify/],
      ['signed with a key the team does not publish', await sign(claims(), { key: INTRUDER }), /key the team does not publish/],
      ['that names its own key server (jku) and is signed by it', await sign(claims(), { key: INTRUDER, header: { jku: ATTACKER_KEYS } }), /key the team does not publish/],
      ['that has expired', await sign(claims({ exp: nowS() - 60 })), /has expired/],
      ['with no exp at all', await sign(claims({ exp: undefined })), /no expiry/],
      ['for another Access application (aud)', await sign(claims({ aud: ['b2'.repeat(32)] })), /audience \(aud\)/],
      ['whose one-string aud names another application', await sign(claims({ aud: 'b2'.repeat(32) })), /audience \(aud\)/],
      /* String.prototype.includes is a substring test: an aud read as a string
         and asked .includes(AUD) would accept any longer string containing it. */
      ['whose one-string aud only contains this application\'s', await sign(claims({ aud: 'b2' + AUD })), /audience \(aud\)/],
      ['issued by another team (iss)', await sign(claims({ iss: 'https://another-team.cloudflareaccess.com' })), /issuer \(iss\)/],
      ['not valid for another hour (nbf)', await sign(claims({ nbf: nowS() + 3600 })), /not valid yet/],
      ['that names no email', await sign(claims({ email: undefined })), /no email/],
      ['with alg none and no signature', `${nh}.${np}.`, /RS256/],
      ['with alg HS256, keyed on the team\'s public key', hs256, /RS256/],
      ['that is not a JWT at all', 'fellow@example.org', /not a JWT/],
    ];
    for (const [label, token, why] of refusals) {
      /* With the typed header beside it, so the header cannot rescue a bad token. */
      const r = await send({ ...jwt(token), ...TYPED });
      ok(`a token ${label} is refused, for that reason`, r.status === 403 && r.google === 0 && why.test(r.said), show(r));
    }

    /* Without the two variables the gate cannot know which team or application
       to trust, so it refuses everything — a good token included. */
    const { ACCESS_TEAM_DOMAIN: _team, ...noTeam } = NORATE;
    const { ACCESS_AUD: _aud, ...noAud } = NORATE;
    for (const [label, env, missing] of [
      ['neither variable', { ...NORATE, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }, /ACCESS_TEAM_DOMAIN and ACCESS_AUD are not set/],
      ['no ACCESS_AUD', noAud, /: ACCESS_AUD is not set/],
      ['no ACCESS_TEAM_DOMAIN', noTeam, /: ACCESS_TEAM_DOMAIN is not set/],
    ]) {
      const r = await send({ ...jwt(GOOD), ...TYPED }, env);
      ok(`with ${label} set, even a good token is refused`, r.status === 403 && r.google === 0, show(r));
      ok('and the refusal says what is missing, and names both variables',
         missing.test(r.said) && /ACCESS_TEAM_DOMAIN \(/.test(r.said) && /ACCESS_AUD \(/.test(r.said), show(r));
    }
    for (const v of ['http://' + TEAM, TEAM + '/cdn-cgi/access/certs', TEAM + ':8443', 'systole-test']) {
      const r = await send(jwt(GOOD), { ...NORATE, ACCESS_TEAM_DOMAIN: v });
      ok(`ACCESS_TEAM_DOMAIN "${v}" is refused by name, not guessed at`,
         r.status === 403 && r.google === 0 && /ACCESS_TEAM_DOMAIN is not a team domain/.test(r.said), show(r));
    }
    for (const v of [ISS, TEAM + '/', TEAM.toUpperCase()]) {
      const r = await send(jwt(GOOD), { ...NORATE, ACCESS_TEAM_DOMAIN: v });
      ok(`ACCESS_TEAM_DOMAIN "${v}" names the same team`, r.status === 200, show(r));
    }

    /* The keys: where they come from, how long they are kept, and what happens
       when they cannot be had. Each verifier here is new, so its cache starts
       empty and its fetches can be counted. */
    const asked = [];
    const listed = accessVerifier(async url => {
      asked.push(url);
      /* Two keys, as the real endpoint lists: the token has to pick its own. */
      return new Response(JSON.stringify({ keys: [INTRUDER.jwk, TEAM_KEY.jwk] }), { status: 200 });
    });
    const three = [];
    for (let i = 0; i < 3; i++) three.push((await send(jwt(GOOD), NORATE, listed)).status);
    ok('the keys are asked of the team in ACCESS_TEAM_DOMAIN, at its certs path', asked[0] === ISS + '/cdn-cgi/access/certs', String(asked[0]));
    ok('the token is checked against the key its kid names, out of several listed', three[0] === 200, three.join(','));
    ok('and the keys are fetched once for three requests, not three times', three.join(',') === '200,200,200' && asked.length === 1,
       `${three.join(',')} after ${asked.length} fetch(es)`);
    const realNow = Date.now;
    let later;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try { later = await send(jwt(GOOD), NORATE, listed); } finally { Date.now = realNow; }
    ok('and fetched again once they are more than five minutes old', later.status === 200 && asked.length === 2,
       `${later.status} after ${asked.length} fetch(es)`);

    for (const [label, src] of [
      /* With the team's real key set in the body, so the status is the only
         thing that can refuse it. */
      ['answers 500, whatever its body says', async () => new Response(JSON.stringify({ keys: [TEAM_KEY.jwk] }), { status: 500 })],
      ['cannot be reached', async () => { throw new Error('getaddrinfo ENOTFOUND'); }],
      ['lists no keys', async () => new Response(JSON.stringify({ keys: [] }), { status: 200 })],
      ['answers with a sign-in page', async () => new Response('<!doctype html><title>Sign in</title>', { status: 200 })],
    ]) {
      const r = await send(jwt(GOOD), NORATE, accessVerifier(src));
      ok(`when the team's certs endpoint ${label}, a good token is refused, not let through`,
         r.status === 503 && r.google === 0 && /signing keys/.test(r.said), show(r));
    }
    let tries = 0;
    const recovers = accessVerifier(async () => new Response(JSON.stringify({ keys: ++tries === 1 ? [] : [TEAM_KEY.jwk] }), { status: 200 }));
    const first = await send(jwt(GOOD), NORATE, recovers), second = await send(jwt(GOOD), NORATE, recovers);
    ok('a failed fetch is not remembered: the next request asks again, and is served',
       first.status === 503 && second.status === 200 && tries === 2, `${first.status} then ${second.status}, ${tries} fetch(es)`);

    /* The rate limiter's bucket is the signed email. The clock is pinned so
       these requests cannot straddle a minute and start a fresh bucket. */
    const RPM1 = { ...ENV, APEX_RPM: '1' };
    const A = await sign(claims({ email: 'bucket-a@example.org' }));
    const B = await sign(claims({ email: 'bucket-b@example.org' }));
    const OPEN = { GEMINI_API_KEY: ENV.GEMINI_API_KEY, APEX_RPM: '1', APEX_ALLOW_UNAUTHENTICATED: 'yes' };
    const at = realNow();
    const lim = [];
    Date.now = () => at;
    try {
      lim.push(await send({ ...jwt(A), 'cf-access-authenticated-user-email': 'x1@example.org', 'cf-connecting-ip': '192.0.2.50' }, RPM1));
      lim.push(await send({ ...jwt(A), 'cf-access-authenticated-user-email': 'x2@example.org', 'cf-connecting-ip': '192.0.2.50' }, RPM1));
      lim.push(await send({ ...jwt(B), 'cf-access-authenticated-user-email': 'x2@example.org', 'cf-connecting-ip': '192.0.2.50' }, RPM1));
      /* The escape hatch: no token to read, so the bucket is the connecting
         address — and a fresh typed email per request must not be a fresh
         allowance per request. */
      lim.push(await send({ 'cf-access-authenticated-user-email': 'y1@example.org', 'cf-connecting-ip': '192.0.2.60' }, OPEN));
      lim.push(await send({ 'cf-access-authenticated-user-email': 'y2@example.org', 'cf-connecting-ip': '192.0.2.60' }, OPEN));
    } finally { Date.now = realNow; }
    const codes = lim.map(x => x.status).join(',');
    ok('the limiter counts the signed email: a second request on one token is limited, whatever email header it carries',
       lim[0].status === 200 && lim[1].status === 429, codes);
    ok('and another signed email, from the same address with the same header, has its own allowance', lim[2].status === 200, codes);
    ok('with the gate opened on purpose (and no Access variables), the request is served',
       lim[3].status === 200, codes);
    ok('and a new typed email is not a new allowance there either', lim[4].status === 429, codes);

    /* The entry point Cloudflare actually runs, with its own verifier and the
       platform fetch: the property above must hold there, not only in the
       handler a test can hand a verifier to. */
    const ASSETS = { fetch: async () => new Response('site') };
    let viaForged, viaGood;
    google = async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    try {
      viaForged = await worker.fetch(new Request(PATH, { method: 'POST', body: body(), headers: TYPED }), { ...NORATE, ASSETS });
      viaGood = await worker.fetch(new Request(PATH, { method: 'POST', body: body(), headers: jwt(GOOD) }), { ...NORATE, ASSETS });
    } finally { google = null; }
    ok('through the deployed entry point, the typed header alone is refused', viaForged.status === 403, String(viaForged.status));
    ok('and a signed token is served', viaGood.status === 200, String(viaGood.status));
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
    /* Isolates the Content-Length fast path from the raw.length backstop: the
       body actually attached here is tiny, well under MAX_BODY, so the old
       post-buffering check alone would let this through. Only a check
       against the declared header, made before request.text() ever runs,
       catches it. */
    const spoofed = new Request('https://systole.pages.dev/api/apex/gemini/generate?model=gemini-3-flash-preview',
      { method: 'POST', body: body(), headers: { ...ACCESS, 'content-length': String(50 * 1024 * 1024) } });
    const r7 = await handleApex(spoofed, ENV, f);
    ok('a declared Content-Length over the cap is refused even though the real body is tiny', r7.status === 413, String(r7.status));
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

    /* THE CHECK ABOVE PASSED FOR A REASON THAT WAS NOT THE ANCHORING. JSON
       escapes a quote inside a string as \\", so "generationConfig" with bare
       quotes cannot occur inside prose — the old indexOf anchor could not be
       fooled by a note no matter what it said, and the comment crediting
       anchoring for that was describing the wrong mechanism.

       Where it DID break is a whole string VALUE, which is not escaped: a
       message whose text is exactly "generationConfig" puts a real token in
       the body. indexOf stopped there, the next { was an unrelated object, and
       the request was refused 400 — the fellow's own question rejected because
       of one word in it. Reproduced at 400 before the fix, against the control
       below which differs only in that word. */
    const withWord = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'generationConfig' }, { text: 'what is it?' }] }],
      generationConfig: { maxOutputTokens: 900000 },
    });
    const fWord = stub();
    const rWord = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', withWord), ENV, fWord);
    ok('a message that is exactly the field name is not refused', rWord.status === 200, String(rWord.status));
    ok('and it is still clamped correctly',
       fWord.calls.length === 1 &&
       JSON.parse(fWord.calls[0].opts.body).generationConfig.maxOutputTokens === 2000,
       fWord.calls.length ? String(JSON.parse(fWord.calls[0].opts.body).generationConfig.maxOutputTokens) : 'never sent');
    ok('and the message itself is untouched',
       fWord.calls.length === 1 &&
       JSON.parse(fWord.calls[0].opts.body).contents[0].parts[0].text === 'generationConfig');

    /* The control: identical shape, one word different. If this ever fails the
       one above proves nothing. */
    const control = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'aortic stenosis' }, { text: 'what is it?' }] }],
      generationConfig: { maxOutputTokens: 900000 },
    });
    const fCtrl = stub();
    const rCtrl = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', control), ENV, fCtrl);
    ok('the same request without that word behaves identically', rCtrl.status === 200, String(rCtrl.status));

    /* A nested key must not be mistaken for the real one. Here the only
       top-level generationConfig comes second, and the first is a key of an
       object inside contents — depth, not position, is what tells them apart. */
    const nested = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'x' }], meta: { generationConfig: { maxOutputTokens: 7 } } }],
      generationConfig: { maxOutputTokens: 900000 },
    });
    const fNest = stub();
    await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', nested), ENV, fNest);
    const sentNest = JSON.parse(fNest.calls[0].opts.body);
    ok('a nested generationConfig is not mistaken for the top-level one',
       sentNest.generationConfig.maxOutputTokens === 2000, String(sentNest.generationConfig.maxOutputTokens));
    ok('and the nested one is left exactly as the caller wrote it',
       sentNest.contents[0].meta.generationConfig.maxOutputTokens === 7,
       String(sentNest.contents[0].meta.generationConfig.maxOutputTokens));

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
                     headers: new Map([['content-type', 'application/json'], ['retry-after', '2']]) });
    const r = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'), ENV, f);
    ok('an upstream status is preserved, so the app can explain it', r.status === 429, String(r.status));
    ok('the upstream Retry-After reaches the client unchanged', r.headers.get('retry-after') === '2');
    /* apiError() in the app reads .error.message; a thrown fetch must still
       produce that shape rather than an empty 502. */
    const env2 = { ...ENV, ASSETS: { fetch: () => ({ status: 200 }) } };
    const bad = { ...env2 };
    /* Google is down; Access's keys are not. The global fetch still answers the
       team's certs URL, so the request gets past the gate on its own merits and
       what fails is the call this check is about. */
    google = async () => { throw new Error('network down'); };
    const r2 = await worker.fetch(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'), bad);
    google = null;
    const j2 = await r2.json();
    ok('and a network failure is a 502 in Google\'s own error shape',
       r2.status === 502 && typeof j2.error.message === 'string', j2.error.message);
  }

  head('the rate limiter, which is a speed bump and says so');
  {
    const f = stub();
    const env = { ...ENV, APEX_RPM: '3' };
    /* Its OWN identity, not the file's shared one. Buckets are keyed on `who`,
       and `who` now prefers the Access identity over the connecting IP — so a
       burst test sharing the default identity counts against every other test
       in this file and starts already spent. It is also the more realistic
       key: behind Access, one person on two networks is one caller. */
    const burst = await sign(claims({ email: 'burst@example.org' }));
    const mk = () => handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body(),
        headers: { 'cf-access-jwt-assertion': burst,
                   'cf-connecting-ip': '203.0.113.9' } }), env, f);
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
      { method: 'POST', body: body(), headers: ACCESS }), loose, spy);
    ok('a widened allowlist still cannot admit a path', r.status === 400, String(r.status));
    ok('and no request left for anywhere', reached === null, String(reached));

    /* The widened allowlist must still do its actual job. */
    let ok2 = null;
    const spy2 = async (url) => { ok2 = url; return new Response('ok', { status: 200 }); };
    const good = await handleApex(new Request(
      'https://systole.pages.dev/api/apex/gemini/stream?model=gemini-9.9-flash',
      { method: 'POST', body: body(), headers: ACCESS }), loose, spy2);
    ok('while a genuine model it was widened for still goes through',
       good.status === 200 && /\/models\/gemini-9\.9-flash:/.test(ok2 || ''), String(good.status));

    for (const bad of ['gemini-x?key=leak', 'gemini-x#frag', 'gemini-x:generateContent', '../etc', '']) {
      const rr = await handleApex(new Request(
        'https://systole.pages.dev/api/apex/gemini/stream?model=' + encodeURIComponent(bad),
        { method: 'POST', body: body(), headers: ACCESS }), loose, async () => new Response('ok'));
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
      { method: 'POST', body: big, headers: ACCESS }), { ...ENV, APEX_RPM: '0' }, f);
    ok('a generationConfig larger than the old window is not refused', r.status === 200, String(r.status));
    ok('and its maxOutputTokens is still clamped', /"maxOutputTokens":2000/.test(sent || ''),
       (sent || '').slice(-60));
    ok('the padding either side of it is untouched',
       /"stopSequences"/.test(sent || '') && /"contents":\[\]/.test(sent || ''));
  }

  head('the clamp reads the value Google will read, or refuses');
  /* A review found three ways past the clamp, each reproduced against a stub
     before this was written: the value was read as its leading digits, so
     1e5 read as 1 and went upstream as 100,000 tokens; a second
     maxOutputTokens was never looked at; and the first match anywhere in
     generationConfig counted, so a same-named field inside a responseSchema
     could stand in for the real one. */
  {
    const send = async raw => {
      let sent = null;
      const f = async (u, init) => { sent = init && init.body; return new Response('ok', { status: 200 }); };
      const r = await handleApex(new Request(
        'https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
        { method: 'POST', body: raw, headers: ACCESS }), { ...ENV, APEX_RPM: '0' }, f);
      return { status: r.status, sent, said: r.status === 200 ? '' : await r.text() };
    };
    const asked = sent => { try { return JSON.parse(sent).generationConfig.maxOutputTokens; } catch (_) { return 'unparsed'; } };
    const C = '"contents":[{"role":"user","parts":[{"text":"x"}]}]';

    const exp = await send(`{"generationConfig":{"maxOutputTokens":1e5},${C}}`);
    ok('1e5 is read as 100,000 and clamped, not as 1 and let through', exp.status === 200 && asked(exp.sent) === 2000,
       `${exp.status}, sent ${asked(exp.sent)}`);
    const frac = await send(`{"generationConfig":{"maxOutputTokens":2.5e3},${C}}`);
    ok('2.5e3 is the whole number 2500, and clamped', frac.status === 200 && asked(frac.sent) === 2000, `${frac.status}, sent ${asked(frac.sent)}`);
    for (const [label, v] of [['a fraction', '1500.5'], ['zero', '0'], ['a negative', '-5'],
                              ['a string Google would still parse as a number', '"100000"'], ['a number with junk after it', '100000x']]) {
      const r = await send(`{"generationConfig":{"maxOutputTokens":${v}},${C}}`);
      ok(`${label} (${v}) is refused, not reinterpreted`, r.status === 400 && r.sent === null, `${r.status}, sent ${r.sent === null ? 'nothing' : asked(r.sent)}`);
    }

    for (const [label, cfg] of [['2000 then 100000', '"maxOutputTokens":2000,"maxOutputTokens":100000'],
                                ['100000 then 2000', '"maxOutputTokens":100000,"maxOutputTokens":2000']]) {
      const r = await send(`{"generationConfig":{${cfg}},${C}}`);
      ok(`maxOutputTokens twice (${label}) is refused, whichever copy a parser keeps`, r.status === 400 && r.sent === null && /appears 2 times/.test(r.said), `${r.status} ${r.said.slice(0, 80)}`);
    }
    const twoCfg = await send(`{"generationConfig":{"maxOutputTokens":2000},${C},"generationConfig":{"maxOutputTokens":100000}}`);
    ok('generationConfig twice is refused', twoCfg.status === 400 && twoCfg.sent === null, String(twoCfg.status));
    const escaped = await send(`{"generationConfig":{"maxOutputTokens":2000},${C},"generation\\u0043onfig":{"maxOutputTokens":100000}}`);
    ok('a second generationConfig spelled with an escape is refused, not missed', escaped.status === 400 && escaped.sent === null, String(escaped.status));
    const escKey = await send(`{"generationConfig":{"maxOutputTokens":2000,"maxOutput\\u0054okens":100000},${C}}`);
    ok('and so is a second maxOutputTokens spelled that way', escKey.status === 400 && escKey.sent === null, String(escKey.status));

    const schema = '"responseSchema":{"type":"object","properties":{"maxOutputTokens":5}}';
    const nested = await send(`{"generationConfig":{${schema},"maxOutputTokens":900000},${C}}`);
    ok('a same-named field inside a responseSchema does not stand in for the real one', nested.status === 200 && asked(nested.sent) === 2000,
       `${nested.status}, sent ${asked(nested.sent)}`);
    ok('and is itself left as written', nested.sent !== null && JSON.parse(nested.sent).generationConfig.responseSchema.properties.maxOutputTokens === 5);
    const onlyNested = await send(`{"generationConfig":{${schema}},${C}}`);
    ok('with no real one beside it, it is refused as missing', onlyNested.status === 400 && onlyNested.sent === null, String(onlyNested.status));

    const trailing = await send(`{"generationConfig":{"maxOutputTokens":2000},${C}}{"generationConfig":{"maxOutputTokens":100000}}`);
    ok('a second object after the first is refused', trailing.status === 400 && trailing.sent === null, String(trailing.status));
    const spaced = await send(`{ "generationConfig" : { "maxOutputTokens" : 900000 } , ${C} }`);
    ok('whitespace around the colon is still a key, and still clamped', spaced.status === 200 && asked(spaced.sent) === 2000, `${spaced.status}, sent ${asked(spaced.sent)}`);
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
        { method: 'POST', body: body(), headers: { ...ACCESS, 'cf-connecting-ip': '198.51.100.7' } }),
        { ...ENV, APEX_RPM: 'twenty' }, stub());
      codes.push(r.status);
    }
    ok('a non-numeric APEX_RPM falls back to the default instead of switching the limiter off',
       codes.includes(429), `${codes.filter(c => c === 200).length} ok, ${codes.filter(c => c === 429).length} limited`);

    let sent = null;
    const spy = async (u, i) => { sent = i && i.body; return new Response('ok', { status: 200 }); };
    /* Asks for more than the default, so "fell back to the default" and "passed the request through" differ.
       A request never forwarded leaves sent null, and !/NaN/.test('') and JSON.parse(null) both pass on that —
       so both checks first require that a body was sent. */
    await handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body({ generationConfig: { maxOutputTokens: 8000 } }), headers: ACCESS }), { ...ENV, APEX_RPM: '0', APEX_MAX_OUTPUT: '2k' }, spy);
    ok('a non-numeric APEX_MAX_OUTPUT never reaches the body as NaN', typeof sent === 'string' && sent.length > 0 && !/NaN/.test(sent),
       typeof sent === 'string' ? sent.slice(0, 70) : 'nothing was forwarded');
    let fwd = null; try { fwd = JSON.parse(sent); } catch (_) {}
    ok('so what is forwarded is valid JSON, capped at the default of 2000',
       !!fwd && typeof fwd === 'object' && fwd.generationConfig.maxOutputTokens === 2000, fwd ? JSON.stringify(fwd.generationConfig) : String(fwd));

    const r = await worker.fetch(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body(), headers: ACCESS }),
      { ...ENV, APEX_RPM: '0', APEX_MODELS: 'gemini-([a-z', ASSETS: { fetch: async () => new Response('site') } });
    const msg = (await r.json()).error.message;
    ok('a malformed APEX_MODELS names the variable rather than blaming Google',
       /APEX_MODELS/.test(msg) && !/reach Google/.test(msg), `${r.status} ${msg.slice(0, 60)}`);

    /* And a good configuration is untouched by any of it. */
    let good = null;
    const spy2 = async (u, i) => { good = i && i.body; return new Response('ok', { status: 200 }); };
    const okr = await handleApex(new Request('https://systole.pages.dev/api/apex/gemini/stream?model=gemini-3-flash-preview',
      { method: 'POST', body: body(), headers: ACCESS }), { ...ENV, APEX_RPM: '0', APEX_MAX_OUTPUT: '500' }, spy2);
    ok('a valid APEX_MAX_OUTPUT still clamps to exactly that',
       okr.status === 200 && /"maxOutputTokens":500/.test(good || ''), (good || '').slice(0, 60));
  }

  head('it will not hand out the key to a caller it cannot name');
{
  /* THE FINDING THIS CLOSES. The Access identity used to be READ and never
     REQUIRED: `who` fell back to the connecting IP and then to 'anon', and the
     request went through either way. The entire protection was a sentence in a
     comment telling the deployer to put Cloudflare Access in front. A project
     deployed without that policy was a public proxy to the owner's Gemini key.

     These checks are what make the protection a property of the code rather
     than of the deployment. */
  const f = stub();
  /* APEX_RPM '0' throughout this block: the limiter is a shared in-memory
     bucket across the whole file, and none of these checks are about it. */
  const NORATE = { ...ENV, APEX_RPM: '0' };
  const r = await handleApex(anonPost('/api/apex/gemini/stream?model=gemini-3-flash-preview'), NORATE, f);
  ok('an unauthenticated request is refused', r.status === 403, String(r.status));
  ok('and Google is never called for it', f.calls.length === 0, String(f.calls.length));
  const said = await r.json();
  ok('and the refusal says how to fix it, both ways',
     /Cloudflare Access/.test(said.error.message) && /APEX_ALLOW_UNAUTHENTICATED/.test(said.error.message),
     String(said.error.message).slice(0, 80));

  /* The escape hatch exists for wrangler dev and for a deployment kept private
     by other means — but it must be typed on purpose. */
  const f2 = stub();
  const r2 = await handleApex(anonPost('/api/apex/gemini/stream?model=gemini-3-flash-preview'),
    { ...NORATE, APEX_ALLOW_UNAUTHENTICATED: 'yes' }, f2);
  ok('an explicit opt-out lets an unauthenticated request through', r2.status === 200, String(r2.status));

  /* And it is the WORD that opts out, not merely the variable existing. A
     deployer who sets it to "no", "false" or "0" meaning to disable it would
     otherwise have switched the protection off with the opposite word. */
  for (const v of ['no', 'false', '0', '', 'true', '1']) {
    const f3 = stub();
    const r3 = await handleApex(anonPost('/api/apex/gemini/stream?model=gemini-3-flash-preview'),
      { ...NORATE, APEX_ALLOW_UNAUTHENTICATED: v }, f3);
    ok(`APEX_ALLOW_UNAUTHENTICATED="${v}" does not open the gate`, r3.status === 403, String(r3.status));
  }

  const f4 = stub();
  const r4 = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'), NORATE, f4);
  ok('an authenticated request is served as before', r4.status === 200, String(r4.status));
}

head('the size cap counts bytes, not characters');
{
  /* MAX_BODY is a byte budget and content-length is measured in bytes, but the
     backstop counted raw.length — UTF-16 code units. Urdu, Arabic, an emoji or
     a µ in a caption encodes to two to four bytes per unit, so a body this
     check believed was under 6 MB could be three times that on the wire. It
     mattered precisely where the header is absent or wrong, which is the only
     case the backstop exists for. */
  const enc = new TextEncoder();
  /* Comfortably under the cap as UTF-16 units, comfortably over it as bytes. */
  const fat = 'ت'.repeat(3.2 * 1024 * 1024);
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: fat }] },
    generationConfig: { maxOutputTokens: 2000 },
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
  });
  ok('the fixture is the shape the bug needed — short in units, long in bytes',
     payload.length < 6 * 1024 * 1024 && enc.encode(payload).length > 6 * 1024 * 1024,
     `${payload.length} units, ${enc.encode(payload).length} bytes`);

  const f = stub();
  /* No content-length, so the header check cannot catch it and the backstop
     is the only thing standing there — exactly the case it is for. */
  const r = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview', payload),
    { ...ENV, APEX_RPM: '0' }, f);
  ok('a body over the byte cap is refused', r.status === 413, String(r.status));
  ok('and Google is never called for it', f.calls.length === 0, String(f.calls.length));

  /* The other direction: ordinary ASCII well under the cap still goes through,
     so this is a cap and not a blanket refusal. */
  const f2 = stub();
  const r2 = await handleApex(post('/api/apex/gemini/stream?model=gemini-3-flash-preview'),
    { ...ENV, APEX_RPM: '0' }, f2);
  ok('an ordinary request is unaffected', r2.status === 200, String(r2.status));
}


console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
