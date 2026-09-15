/* ═══════════════════════════════════════════════════════════════════════════
   apex.js — the Cloudflare Worker that holds the Gemini key.

   Systole is a local-first app: the question bank, the notes, the figures, the
   scheduling and the tool execution all stay on the iPad. Exactly one thing
   moves to the edge — the Gemini API key — so the app can be opened without
   anyone pasting a secret into it.

   WHY A _worker.js AND NOT A /functions DIRECTORY. Pages builds Functions from
   a functions/ folder, and that folder is ignored by dashboard direct upload,
   which is how this gets deployed: a zip, dragged from the iPad's Files app. A
   _worker.js at the root of the upload IS honoured. So this single module both
   answers /api/apex and serves the static site, and it drops into the zip that
   already exists. No Wrangler, no laptop, no second domain, no CORS.

   THE WORKER DOES NOT UNDERSTAND THE CONVERSATION. The app builds Gemini's wire
   format — systemInstruction, contents, inlineData figures, functionCall parts
   with their thought signatures — and this forwards it. Nothing here parses or
   rebuilds a turn, because every line that did would be a line that could break
   the signature round-trip or drop an image. It routes, it checks a few bounds,
   it attaches a header.

   ONLY GEMINI. Mistral remains bring-your-own-key in the app and never
   reaches this file. One secret to set, one path to get wrong.

   WHAT ACTUALLY PROTECTS THE BILL, honestly ordered:
     1. Cloudflare Access in front of the whole project — only a signed-in
        address reaches this at all. This line USED TO BE THE WHOLE PROTECTION:
        the Access identity was read for rate-limit bucketing and never
        required, so a project deployed without that policy — or with it
        removed, or scoped to the wrong path — was a public proxy to this key,
        and nothing in the code would have said so. It is now enforced here
        rather than assumed of the deployment: no identity, no request, unless
        APEX_ALLOW_UNAUTHENTICATED is set to exactly "yes" by someone who meant
        it (wrangler dev, or a deployment kept private some other way).
     2. The output clamp below, which bounds what any single request can cost.
     3. The body cap.
     4. The rate limiter, which is best-effort and says so: a Worker isolate has
        no shared counter, so two isolates keep two tallies. It is a speed bump
        for a runaway loop, not a quota. If this URL is ever shared beyond one
        person, replace it with a KV-backed counter first.
   ═══════════════════════════════════════════════════════════════════════════ */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

/* Vision turns legitimately carry a few base64 figures — four note figures at
   ~130 KB each, plus the question's own — so the cap has to clear about 2 MB
   without being unbounded. */
const MAX_BODY = 6 * 1024 * 1024;

/* The scan that finds generationConfig used to start with a 64 KB window over
   the head of the body, on the theory that the field is near the front. It was
   removed with the indexOf anchor it belonged to — see topLevelKey() below.

   Worth keeping the reason the window was already known to be wrong, because
   it is the same shape of mistake: the streaming body is ordered
   systemInstruction, tools, generationConfig, contents, and systemInstruction
   carries the system prompt PLUS every retrieved note clipped at 4000
   characters PLUS the memory block. Four notes and a full memory is
   comfortably past 64 KB, so a heavy grounded turn pushed generationConfig out
   of the window and got a 400 from its own edge. A fallback covered it. Both
   are gone now: the replacement skips over string contents natively, so the
   payload it was trying to avoid reading is the part it no longer reads. */

const DEFAULT_MODEL_RE = /^gemini-[a-z0-9][a-z0-9.\-]*$/;
const DEFAULT_MAX_OUTPUT = 2000;
const DEFAULT_RPM = 20;
const TIMEOUT_MS = 120000;      // generous: a long grounded answer streams for a while

/* Best-effort, per-isolate. See the note at the top of the file. */
const seen = new Map();
function sweep(minute) {
  /* The sweep has to run on the NEW-key path, not only the repeat path. It was
     originally below the early return, which is exactly backwards: a repeat
     caller reuses one entry and grows nothing, while a stream of distinct
     callers — the case the map actually needs defending against — took the
     early return every time and never swept. */
  if (seen.size <= 500) return;
  for (const [k, v] of seen) if (v.minute !== minute) seen.delete(k);
}
function overRate(key, limit) {
  const minute = Math.floor(Date.now() / 60000);
  const at = seen.get(key);
  if (!at || at.minute !== minute) { seen.set(key, { minute, n: 1 }); sweep(minute); return false; }
  at.n++;
  sweep(minute);
  return at.n > limit;
}

/* EVERY ONE OF THESE IS A STRING FROM A DASHBOARD FIELD, and each of the three
   fails differently when it is a typo:

     APEX_RPM        +"twenty" is NaN, and NaN > 0 is false — so the rate-limit
                     branch is skipped entirely and the limiter silently turns
                     OFF. A misconfigured limit that stops limiting is the worst
                     of the three, because nothing about it looks wrong.
     APEX_MAX_OUTPUT NaN reaches the clamp and gets written into the body as
                     "maxOutputTokens":NaN, which is not valid JSON — so every
                     request fails at Google with an opaque error.
     APEX_MODELS     new RegExp() on a bad pattern throws, is caught by the
                     outer handler, and surfaces as "Could not reach Google" —
                     blaming Google for a typo in your own settings.

   So: parse strictly and fall back to the documented default, and let a bad
   regex say which variable is wrong. */
function positiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && Math.floor(n) === n ? n : fallback;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* Shaped like Google's own error envelope, because the app's apiError() already
   reads .error.message and turns it into a sentence a fellow can act on. */
const fail = (status, message) => json(status, { error: { message } });

/* Where the object opened at `from` ends, by brace matching. String contents
   are skipped so a brace inside a prompt cannot close the object early, and a
   backslash-escaped quote cannot end the string early. Returns -1 if the
   object never closes. */
function objectEnd(raw, from) {
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/* Clamp maxOutputTokens without parsing the body.
   Returns { body, error }. */
/* Find a KEY of the top-level object, rather than the first place its name
   happens to appear.

   WHY THIS IS NOT indexOf. The old anchor was
   raw.indexOf('"generationConfig"'), and the comment beside it credited
   anchoring with protecting the fellow's own prose from being rewritten. That
   protection was real but it came from somewhere else: JSON escapes a quote
   inside a string value as \", so the byte sequence "generationConfig" with
   bare quotes cannot appear inside prose at all. The anchor was correct by
   luck, not by construction.

   The luck runs out when the name is a whole string VALUE, which is not
   escaped. A message whose text is exactly "generationConfig" puts a real
   "generationConfig" token in the body, indexOf stops there, the next { is
   some unrelated object, and a request carrying a perfectly good
   generationConfig is refused with "maxOutputTokens is required" — a 400 on
   the fellow's own question because of a word in it. Reproduced before this
   was written, against the identical request with the word changed.

   So: track string state, require depth 1, and require a colon after the
   name. A value fails the colon test; a nested key fails the depth test.

   STRINGS ARE JUMPED, NOT WALKED. A vision request carries figures as inline
   base64 and runs to megabytes, so stepping character by character through it
   would be a real cost on every call. indexOf finds each closing quote
   natively, and base64 contains neither quotes nor backslashes, so a figure is
   crossed in one call. That is why HEAD_WINDOW is gone: it existed to keep the
   common case off a full-body scan, and a scan that skips the payload no
   longer needs it. */
function topLevelKey(raw, name) {
  const needle = `"${name}"`;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (depth === 1 && raw.startsWith(needle, i)) {
        let j = i + needle.length;
        while (j < raw.length && (raw[j] === ' ' || raw[j] === '\n' ||
                                  raw[j] === '\r' || raw[j] === '\t')) j++;
        if (raw[j] === ':') return i;
      }
      /* Skip to this string's unescaped closing quote. A quote is closing only
         when an EVEN number of backslashes precedes it — \\" ends the string,
         \" does not. */
      for (let j = i; ;) {
        j = raw.indexOf('"', j + 1);
        if (j < 0) return -1;
        let b = j - 1, slashes = 0;
        while (b >= 0 && raw[b] === '\\') { slashes++; b--; }
        if (slashes % 2 === 0) { i = j; break; }
      }
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return -1;
}

function clampOutput(raw, max) {
  const at = topLevelKey(raw, 'generationConfig');
  if (at < 0) return { error: 'generationConfig is required.' };
  /* Anchored to the generationConfig object rather than searched for globally:
     a note quoting the literal text "maxOutputTokens": 99999 must not be
     rewritten, because that would corrupt the fellow's own prose.

     BOUNDED BY THE OBJECT, NOT BY A FIXED NUMBER OF CHARACTERS. This was a
     400-character window, which is ample for {maxOutputTokens:2000} and quietly
     wrong for anything larger: add stopSequences or a responseSchema and the
     field slides out of the window, whereupon a request carrying a perfectly
     good maxOutputTokens is refused with "maxOutputTokens is required". Brace
     matching costs one pass over an object that is small by construction, and
     it cannot be outgrown. */
  const open = raw.indexOf('{', at);
  const end = open < 0 ? -1 : objectEnd(raw, open);
  if (end < 0) return { error: 'generationConfig is malformed.' };
  const slice = raw.slice(at, end);
  const m = /"maxOutputTokens"\s*:\s*(\d+)/.exec(slice);
  if (!m) return { error: 'generationConfig.maxOutputTokens is required.' };
  const asked = +m[1];
  if (asked <= max) return { body: raw };
  const fixed = slice.replace(m[0], `"maxOutputTokens":${max}`);
  return { body: raw.slice(0, at) + fixed + raw.slice(at + slice.length) };
}

export async function handleApex(request, env, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const url = new URL(request.url);
  const op = url.pathname.replace(/^\/api\/apex\/gemini\//, '').replace(/\/+$/, '');

  const key = env.GEMINI_API_KEY;
  if (!key) return fail(503, 'This deployment has no GEMINI_API_KEY set. Add it in the Cloudflare dashboard under Settings → Environment variables, or paste your own key in Apex settings.');

  /* ── WHO IS ASKING, AND WHETHER THEY MAY ────────────────────────────────
     This used to READ the Access identity and never REQUIRE it: `who` fell
     back to the connecting IP and then to the string 'anon', and the request
     proceeded either way. The whole protection was a sentence in the header
     comment telling the deployer to put Cloudflare Access in front. A project
     deployed without that policy — or with it removed, or scoped to the wrong
     path — was a public proxy to the owner's Gemini key, spending their quota
     for anyone who found the URL, and nothing anywhere would have said so.

     So it fails closed. No Access identity, no request. The escape hatch is
     deliberate and explicit, because a local `wrangler dev` has no Access in
     front of it and neither does a deployment someone has decided to keep
     private by other means — but it has to be TYPED, once, by a person who
     meant it, and it is named so that it cannot be set by accident. */
  const identity = request.headers.get('cf-access-authenticated-user-email');
  if (!identity && String(env.APEX_ALLOW_UNAUTHENTICATED || '') !== 'yes') {
    return fail(403,
      'This deployment is not protected. Put Cloudflare Access in front of the ' +
      'project so only you can reach it — or, if it is private by other means, set ' +
      'APEX_ALLOW_UNAUTHENTICATED to "yes" in Settings → Environment variables. ' +
      'Until one of those is true the Gemini key is not handed out.');
  }
  const rpm = positiveInt(env.APEX_RPM, DEFAULT_RPM);
  /* Rate limiting still prefers the identity and falls back, because once the
     gate above has passed, the only question left is how to bucket a caller. */
  const who = identity || request.headers.get('cf-connecting-ip') || 'anon';
  if (rpm > 0 && overRate(who, rpm)) {
    return fail(429, 'Too many requests in a minute — wait a moment and try again.');
  }

  let modelRe;
  try { modelRe = env.APEX_MODELS ? new RegExp(env.APEX_MODELS) : DEFAULT_MODEL_RE; }
  catch (_) {
    return fail(500, 'APEX_MODELS is not a valid regular expression. Fix it in the Cloudflare dashboard under Settings \u2192 Environment variables, or remove it to use the default.');
  }
  const maxOut = positiveInt(env.APEX_MAX_OUTPUT, DEFAULT_MAX_OUTPUT) || DEFAULT_MAX_OUTPUT;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };

  /* ── the model list, so the menu is built from what the key can reach ── */
  if (op === 'models') {
    if (request.method !== 'GET') return fail(405, 'Use GET for the model list.');
    const page = url.searchParams.get('pageToken');
    const target = `${GEMINI}?pageSize=200${page ? '&pageToken=' + encodeURIComponent(page) : ''}`;
    const r = await doFetch(target, { headers: { 'x-goog-api-key': key }, signal });
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
  }

  if (op !== 'stream' && op !== 'generate') return fail(404, 'No such Apex route.');
  if (request.method !== 'POST') return fail(405, 'Use POST.');

  const model = url.searchParams.get('model') || '';
  /* THE SHAPE CHECK COMES FIRST, AND DOES NOT DEPEND ON APEX_MODELS. The model
     is interpolated into a URL path, so anything structural in it — a slash, a
     dot-dot, a query or fragment marker, a second colon — can steer the request
     somewhere other than the model it names, with this deployment's key
     attached. The DEFAULT regex is anchored and already refuses all of that;
     a custom APEX_MODELS need not be, and an operator writing "gemini-" to
     widen the allowlist would not expect to have opened a path traversal.
     A configurable allowlist may choose WHICH models are permitted; it may not
     choose whether the value is still a bare model name. */
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) {
    return fail(400, `"${model}" is not a valid model name.`);
  }
  if (!modelRe.test(model)) return fail(400, `"${model}" is not a model this deployment will call.`);

  /* Checked twice on purpose. Content-Length is the cheap rejection for the
     common case — refusing an oversized request before request.text() ever
     buffers it into memory or spends CPU decoding it, which matters on a
     CPU-metered platform. It is also the only one a client can lie about or
     omit (chunked transfer encoding sends none at all), so the length check
     below stays as the backstop that is actually authoritative. */
  const declaredLength = +(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY) {
    return fail(413, 'That request is too large. Try again without attaching so many figures.');
  }

  const raw = await request.text();
  /* BYTES, not characters. This was raw.length, which is UTF-16 code units:
     MAX_BODY is a byte budget, content-length above is measured in bytes, and
     the two checks disagreed on what they were counting. Anything outside the
     BMP or simply outside ASCII — Urdu or Arabic in a pasted note, an emoji,
     a figure caption with a µ in it — encodes to two, three or four bytes per
     unit, so a body this check believed was under 6 MB could be three times
     that on the wire. It only ever mattered where the header was absent or
     wrong, which is exactly the case this check exists to be the backstop
     for. TextEncoder is what the platform gives; Buffer does not exist here. */
  if (new TextEncoder().encode(raw).length > MAX_BODY) {
    return fail(413, 'That request is too large. Try again without attaching so many figures.');
  }

  const clamped = clampOutput(raw, maxOut);
  if (clamped.error) return fail(400, clamped.error);

  const method = op === 'stream' ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const upstream = await doFetch(`${GEMINI}/${model}:${method}`,
    { method: 'POST', headers, body: clamped.body, signal });

  /* The stream is passed through, never buffered — collecting it here would
     turn a live answer into a long pause and then a wall of text. The upstream
     content-type is kept so the app's SSE reader sees what it expects. */
  const out = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) out.set('content-type', ct);
  out.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/* Kept in step with scripts/csp.js by scripts/build-pwa.js, which refuses to
   write _worker.js if this string and that module's HEADER_POLICY differ. It
   is spelled out here rather than substituted from a placeholder because this
   file is deployed verbatim and imported verbatim by tests/verify-worker.js —
   a half-built worker carrying '__CSP__' would be a valid file shipping an
   inert policy, which is the failure that looks most like success.

   frame-ancestors appears here and not in the shell's <meta>, because a meta
   policy ignores it. See scripts/csp.js for what this policy contains and,
   more importantly, what it does not claim to prevent. */
const SECURITY_HEADERS = {
  /* ONE UNBROKEN LITERAL, and it has to stay that way. scripts/build-pwa.js
     refuses to write _worker.js unless this file CONTAINS scripts/csp.js's
     policy as a substring, and tests/verify-csp.js asserts the same. Splitting
     it across a concatenation for line length defeats both: the runtime value
     stays correct while every textual check silently stops matching. That is
     not hypothetical — it is what the first version of this did, and the build
     guard would have thrown on every build. */
  // eslint-disable-next-line max-len
  'Content-Security-Policy': "base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'; connect-src 'self' https://generativelanguage.googleapis.com; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/apex/')) {
      try {
        return await handleApex(request, env);
      } catch (err) {
        const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return fail(timedOut ? 504 : 502,
          timedOut ? 'Google did not answer in time. Try again.'
                   : 'Could not reach Google from the server. Try again.');
      }
    }
    /* EVERYTHING ELSE IS THE SITE. In advanced mode this Worker owns every
       request to the project, so forgetting this line does not break the API —
       it 404s the entire app.

       It is also why the security headers go here and not in a dist/_headers
       file: Pages honours _headers only when no _worker.js is present, and
       this one owns every request, so _headers would be silently ignored and
       the policy would look shipped while doing nothing. */
    const res = await env.ASSETS.fetch(request);
    /* new Response(body, res) copies status and headers and gives back a
       MUTABLE header set; the one on the ASSETS response is immutable, so
       setting on it directly throws. */
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
