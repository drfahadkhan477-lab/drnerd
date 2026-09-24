/* ═══════════════════════════════════════════════════════════════════════════
   provider.js — which coach runs the protocol, and the one call to Claude.

   Two choices. The BUILT-IN coach (coach.js) needs no key, no account and no
   network, and is the default. CLAUDE is the optional upgrade: the user's
   own key, kept in this browser's localStorage and sent only to Anthropic.

   Gemini and Groq were here and were removed at the owner's request after
   both failed on first use (Gemini: "high demand"; Groq: key rejected). A
   saved setting naming either is read as the built-in coach — and its key is
   dropped, never sent to a different provider.

   Raw fetch rather than an SDK: this is a single HTML file with no bundler.
   Every phase asks for JSON and names its schema, and the reply goes through
   MemPrompts.parse, which is the check that counts.

   build(): pure — the request a call WOULD make. call(): does it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var PROVIDERS = {
  builtin: {
    label: 'Built-in coach \u2014 free, no key, works offline',
    models: [['builtin', 'Built-in']],
    keyHint: '',
    noKey: true,
  },
  anthropic: {
    label: 'Claude (Anthropic) \u2014 your own API key',
    models: [['claude-opus-5', 'Claude Opus 5 \u2014 best teacher'],
             ['claude-sonnet-5', 'Claude Sonnet 5 \u2014 faster, cheaper'],
             ['claude-haiku-4-5', 'Claude Haiku 4.5 \u2014 fastest']],
    keyHint: 'sk-ant-\u2026  from console.anthropic.com',
  },
};
var DEFAULT_PROVIDER = 'builtin';

var ENDPOINT = {
  anthropic: 'https://api.anthropic.com/v1/messages',
};

/* How long to wait before the one retry of an overloaded provider. A
   property so a test can shorten it. */
var RETRY_MS = 2000;

/* Claude Opus 5's safety classifiers can decline a request; "default"
   fallbacks re-run a declined request on Anthropic's recommended model
   server-side instead of returning the refusal. Opus 5 only. */
var FALLBACK_MODELS = { 'claude-opus-5': true };

function build(cfg, prompt, schema, opts) {
  opts = opts || {};
  var provider = cfg.provider, model = cfg.model, key = cfg.key;
  if (provider === 'anthropic') {
    var headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    var body = {
      model: model, max_tokens: 16000, system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    };
    if (schema) body.output_config = { format: { type: 'json_schema', schema: schema } };
    if (FALLBACK_MODELS[model] && !opts.noFallbacks) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    return { url: ENDPOINT.anthropic, init: { method: 'POST', headers: headers, body: JSON.stringify(body) } };
  }
  throw new Error('unknown provider ' + provider);
}

/* The reply text, or a thrown Error that says what went wrong in words. */
function textOf(provider, data) {
  if (provider === 'anthropic') {
    if (data.stop_reason === 'refusal') {
      var why = data.stop_details && data.stop_details.explanation;
      throw new Error('Claude declined this request' + (why ? ': ' + why : '.'));
    }
    if (data.stop_reason === 'max_tokens') throw new Error('the reply was cut off before it finished');
    return (data.content || []).filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('');
  }
  return '';
}

function errorText(status, data) {
  var m = data && data.error && (data.error.message || data.error.type);
  if (status === 401 || status === 403) return 'the API key was rejected (' + status + '). Check it in Settings.';
  if (status === 429) return 'rate limited (429) — wait a moment and try again.';
  if (status === 529 || status === 503) return 'the provider is overloaded right now (' + status + ') \u2014 try again in a minute, or switch to the built-in coach in Settings.';
  /* Providers retire models; the one saved in Settings may no longer exist
     for this key. Say what to do, and keep the provider's own words. */
  if (status === 404) return 'this model is not available to your key (404) — choose another model in Settings.' + (m ? ' The provider said: ' + m : '');
  return 'the provider returned ' + status + (m ? ': ' + m : '');
}

function call(cfg, prompt, kind, fetchImpl) {
  var f = fetchImpl || function (u, i) { return root.fetch(u, i); };
  var P = root.MemPrompts || (typeof require === 'function' ? require('./prompts.js') : null);
  var schema = P.SCHEMAS[kind];
  function attempt(opts) {
    var req = build(cfg, prompt, schema, opts);
    return f(req.url, req.init).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = JSON.parse(t); } catch (_) { /* reported below */ }
        if (!res.ok) {
          /* An account without the fallback beta, or a model that does not
             take it, says so in a 400 naming the parameter. Retry once
             without it rather than fail the whole step. */
          if (res.status === 400 && !(opts && opts.noFallbacks) && /fallback/i.test(t) && cfg.provider === 'anthropic') {
            return attempt({ noFallbacks: true, retried: opts && opts.retried });
          }
          /* Overloaded ("high demand") is usually over in seconds. One
             retry, after a pause; a second overload is reported. */
          if ((res.status === 529 || res.status === 503) && !(opts && opts.retried)) {
            return new Promise(function (resolve) { setTimeout(resolve, MemProvider.RETRY_MS); })
              .then(function () { return attempt({ noFallbacks: opts && opts.noFallbacks, retried: true }); });
          }
          throw new Error(errorText(res.status, data));
        }
        if (!data) throw new Error('the provider\'s reply was not JSON');
        var parsed = P.parse(kind, textOf(cfg.provider, data));
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      });
    });
  }
  return attempt({});
}

var CFG_KEY = 'memorizer.ai.v1';
/* A saved model that is no longer in its provider's list — one this app has
   since dropped because the provider retired it — is replaced by that
   provider's first model, rather than being sent again to fail. Without
   this, removing a retired model from the list would fix new users and leave
   everyone who had already saved it stuck on the 404. The key is kept. */
function loadConfig(storage) {
  var d = { provider: DEFAULT_PROVIDER, model: PROVIDERS[DEFAULT_PROVIDER].models[0][0], key: '' };
  try {
    /* reading root.localStorage itself throws where storage is refused (a data: URL) */
    var st = storage || root.localStorage;
    var s = JSON.parse(st.getItem(CFG_KEY) || 'null');
    if (s && PROVIDERS[s.provider]) {
      var listed = PROVIDERS[s.provider].models.some(function (m) { return m[0] === s.model; });
      d.provider = s.provider;
      d.model = listed ? s.model : PROVIDERS[s.provider].models[0][0];
      d.key = s.key || '';
    }
  } catch (_) { /* private mode or blocked storage: defaults */ }
  return d;
}
function saveConfig(cfg, storage) {
  try { var st = storage || root.localStorage; st.setItem(CFG_KEY, JSON.stringify(cfg)); return true; } catch (_) { return false; }
}

function needsKey(cfg) { return !(PROVIDERS[cfg.provider] && PROVIDERS[cfg.provider].noKey); }
function ready(cfg) { return !needsKey(cfg) || !!cfg.key; }

var MemProvider = {
  PROVIDERS: PROVIDERS, DEFAULT_PROVIDER: DEFAULT_PROVIDER, RETRY_MS: RETRY_MS, needsKey: needsKey, ready: ready, ENDPOINT: ENDPOINT, build: build, textOf: textOf, call: call,
  loadConfig: loadConfig, saveConfig: saveConfig,
};
root.MemProvider = MemProvider;
if (typeof module !== 'undefined' && module.exports) module.exports = MemProvider;
})(typeof window !== 'undefined' ? window : this);
