/* ═══════════════════════════════════════════════════════════════════════════
   provider.js — one call, three providers, JSON back.

   The key is the user's own, kept in this browser's localStorage and sent
   only to the provider it belongs to. Nothing goes anywhere else.

   Raw fetch rather than an SDK: this is a single HTML file with no bundler,
   and the wire shapes are the same ones Systole's gemini-patch.js already
   speaks (Anthropic Messages, Gemini generateContent, Groq's OpenAI-shaped
   chat completions).

   Every phase asks for JSON and names its schema. Where the provider can
   constrain output to a schema it is asked to; either way the reply goes
   through MemPrompts.parse, which is the check that counts.

   build(): pure — the request a call WOULD make. call(): does it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    models: [['claude-opus-5', 'Claude Opus 5 — best teacher'],
             ['claude-sonnet-5', 'Claude Sonnet 5 — faster, cheaper'],
             ['claude-haiku-4-5', 'Claude Haiku 4.5 — fastest']],
    keyHint: 'sk-ant-…  from console.anthropic.com',
  },
  gemini: {
    label: 'Gemini (Google)',
    models: [['gemini-2.5-flash', 'Gemini 2.5 Flash']],
    keyHint: 'from aistudio.google.com',
  },
  groq: {
    label: 'Groq (free tier)',
    models: [['openai/gpt-oss-120b', 'GPT-OSS 120B'], ['openai/gpt-oss-20b', 'GPT-OSS 20B — fastest']],
    keyHint: 'gsk_…  from console.groq.com',
  },
};

var ENDPOINT = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

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
  if (provider === 'gemini') {
    return {
      url: ENDPOINT.gemini + '/' + encodeURIComponent(model) + ':generateContent',
      init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }) },
    };
  }
  if (provider === 'groq') {
    return {
      url: ENDPOINT.groq,
      init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          response_format: { type: 'json_object' },
        }) },
    };
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
  if (provider === 'gemini') {
    var cand = data.candidates && data.candidates[0];
    if (!cand) throw new Error('Gemini returned no answer' + (data.promptFeedback && data.promptFeedback.blockReason ? ' (' + data.promptFeedback.blockReason + ')' : ''));
    return ((cand.content && cand.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
  }
  if (provider === 'groq') {
    var ch = data.choices && data.choices[0];
    return (ch && ch.message && ch.message.content) || '';
  }
  return '';
}

function errorText(status, data) {
  var m = data && data.error && (data.error.message || data.error.type);
  if (status === 401 || status === 403) return 'the API key was rejected (' + status + '). Check it in Settings.';
  if (status === 429) return 'rate limited (429) — wait a moment and try again.';
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
            return attempt({ noFallbacks: true });
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
function loadConfig() {
  var d = { provider: 'anthropic', model: 'claude-opus-5', key: '' };
  try {
    var s = JSON.parse(root.localStorage.getItem(CFG_KEY) || 'null');
    if (s && PROVIDERS[s.provider]) { d.provider = s.provider; d.model = s.model || PROVIDERS[s.provider].models[0][0]; d.key = s.key || ''; }
  } catch (_) { /* private mode or blocked storage: defaults */ }
  return d;
}
function saveConfig(cfg) {
  try { root.localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); return true; } catch (_) { return false; }
}

var MemProvider = {
  PROVIDERS: PROVIDERS, ENDPOINT: ENDPOINT, build: build, textOf: textOf, call: call,
  loadConfig: loadConfig, saveConfig: saveConfig,
};
root.MemProvider = MemProvider;
if (typeof module !== 'undefined' && module.exports) module.exports = MemProvider;
})(typeof window !== 'undefined' ? window : this);
