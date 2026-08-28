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

   ONLY GEMINI. Groq and Anthropic remain bring-your-own-key in the app and
   never reach this file. One secret to set, one path to get wrong.

   WHAT ACTUALLY PROTECTS THE BILL, honestly ordered:
     1. Cloudflare Access in front of the whole project — only a signed-in
        address reaches this at all.
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

/* Where generationConfig is looked for first. Scanning a window rather than
   parsing is the difference between a regex and JSON.parse over 2 MB, which
   matters on a CPU-metered platform.

   IT IS A FAST PATH, NOT A RULE, and it took a review to notice why. The
   streaming body is ordered systemInstruction, tools, generationConfig,
   contents — and systemInstruction carries the system prompt PLUS every
   retrieved note, each clipped at 4000 characters, plus the memory block. Four
   notes and a full memory is comfortably past 64 KB, so a heavy grounded turn
   pushed generationConfig out of the window and got a 400 from its own edge.
   Two of the three Gemini call sites put `contents` first outright.

   So the window is tried first, and a miss falls through to one indexOf over
   the whole body before anything is refused. That is a single pass over a
   string already in memory — nothing like parsing it. */
const HEAD_WINDOW = 64 * 1024;

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

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* Shaped like Google's own error envelope, because the app's apiError() already
   reads .error.message and turns it into a sentence a fellow can act on. */
const fail = (status, message) => json(status, { error: { message } });

/* Clamp maxOutputTokens without parsing the body.
   Returns { body, error }. */
function clampOutput(raw, max) {
  let at = raw.slice(0, HEAD_WINDOW).indexOf('"generationConfig"');
  if (at < 0) at = raw.indexOf('"generationConfig"');      // see HEAD_WINDOW above
  if (at < 0) return { error: 'generationConfig is required.' };
  /* Anchored to the generationConfig object rather than searched for globally:
     a note quoting the literal text "maxOutputTokens": 99999 must not be
     rewritten, because that would corrupt the fellow's own prose. */
  const slice = raw.slice(at, at + 400);
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

  const rpm = +(env.APEX_RPM || DEFAULT_RPM);
  const who = request.headers.get('cf-access-authenticated-user-email')
    || request.headers.get('cf-connecting-ip') || 'anon';
  if (rpm > 0 && overRate(who, rpm)) {
    return fail(429, 'Too many requests in a minute — wait a moment and try again.');
  }

  const modelRe = env.APEX_MODELS ? new RegExp(env.APEX_MODELS) : DEFAULT_MODEL_RE;
  const maxOut = +(env.APEX_MAX_OUTPUT || DEFAULT_MAX_OUTPUT);
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
  if (!modelRe.test(model)) return fail(400, `"${model}" is not a model this deployment will call.`);

  const raw = await request.text();
  if (raw.length > MAX_BODY) {
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
       it 404s the entire app. */
    return env.ASSETS.fetch(request);
  },
};
