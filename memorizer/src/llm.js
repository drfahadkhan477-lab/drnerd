/* ═══════════════════════════════════════════════════════════════════════════
   llm.js — a small language model, running on this device.

   OPTIONAL, and off until the owner turns it on in Settings. It downloads a
   model once (under a gigabyte) and runs it on the iPad's GPU through WebGPU
   with WebLLM (Apache-2.0), running Qwen3 (Apache-2.0); after that it works offline and nothing is sent
   anywhere. It makes the built-in coach more like a tutor — a summary of what
   the book says, an explanation in plain words, an analogy, harder
   questions — and NOTHING IT WRITES IS SHOWN UNCHECKED: ground.js holds every
   sentence to the book (no new numbers, no new named things, cited, and a
   question's answer found in the section and explained by the book's own
   sentence). What fails is dropped and counted, and the built-in coach
   fills the gap. A 1-billion-parameter model is not a source of medical
   facts; the book is.

   LOADED ONLY WHEN TURNED ON, AND CHECKED. WebLLM itself comes from jsDelivr,
   pinned to a version and fetched with a subresource-integrity hash, then
   imported from a blob of the checked bytes. The model's weights and its
   compiled GPU library are fetched by WebLLM from Hugging Face and GitHub
   and kept in the browser's cache; WebLLM does not check them against a
   hash, and Settings says so.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var WEBLLM = { url: 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js',
               sri: 'sha384-rfElDdXnNkSgbLTTGiKHTrsetCVAYzzLZBD96/rZdD9XYvryEyShqz3ph8j+x7HH' };
/* Qwen3, Apache-2.0, at the owner's request for an Apache-licensed model.
   The GPU memory is WebLLM's own figure for each (its prebuilt config): the
   0.6B fits more iPads; the 1.7B is stronger and wants a recent one (M-series).
   Earlier versions offered Llama 3.2 1B and Gemma 3 1B, under their own
   licences. */
var MODELS = [
  { id: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B', mb: 1403, licence: 'Apache-2.0' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B (stronger; newer iPads)', mb: 2037, licence: 'Apache-2.0' },
];
var CFG_KEY = 'memorizer.llm.v1';
/* Search by meaning: Snowflake's arctic-embed-s (Apache-2.0, 384
   dimensions), about 130 MB, through the same checked engine. The -b4 build
   takes four texts at a time and needs the least GPU memory. */
var EMBED = { id: 'snowflake-arctic-embed-s-q0f32-MLC-b4', label: 'arctic-embed-s', mb: 130, licence: 'Apache-2.0', batch: 4, words: 300 };

function loadConfig() {
  try { var c = JSON.parse(root.localStorage.getItem(CFG_KEY) || 'null'); if (c && c.model) return c; } catch (_) {}
  return { on: false, model: MODELS[0].id };
}
function saveConfig(c) { try { root.localStorage.setItem(CFG_KEY, JSON.stringify(c)); return true; } catch (_) { return false; } }

/* WebGPU with an adapter, or why not. */
function supported() {
  if (!root.navigator || !root.navigator.gpu) return Promise.resolve({ ok: false, why: 'this browser has no WebGPU (on iPad it needs iPadOS 26 or later)' });
  return root.navigator.gpu.requestAdapter().then(function (a) {
    return a ? { ok: true, why: '' } : { ok: false, why: 'WebGPU is here but found no usable GPU' };
  }, function () { return { ok: false, why: 'WebGPU could not start' }; });
}

var libP = null;
function loadLib() {
  if (libP) return libP;
  libP = fetch(WEBLLM.url, { integrity: WEBLLM.sri, mode: 'cors' }).then(function (r) {
    if (!r.ok) throw new Error('could not download the AI engine (' + r.status + ')');
    return r.text();
  }).then(function (src) {
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    /* An indirect import(): a bundler, or an old parser, never sees it. */
    return new Function('u', 'return import(u)')(url);
  });
  libP.catch(function () { libP = null; });
  return libP;
}

var embedder = null;
/* Tests hand in a function from texts to vectors. */
function useEmbedder(fn) { embedder = fn; }
function embedReady() { return !!embedder; }
function startEmbed(onProgress) {
  if (embedder) return Promise.resolve();
  return loadLib().then(function (lib) {
    return lib.CreateMLCEngine(EMBED.id, { initProgressCallback: function (p) { if (onProgress) onProgress(p.progress || 0, p.text || ''); } });
  }).then(function (e) {
    embedder = function (texts) { return e.embeddings.create({ input: texts }).then(function (r) { return r.data.map(function (d) { return d.embedding; }); }); };
  });
}
/* Texts → vectors, a batch at a time, each text cut to the model's reach. */
function embed(texts, onBatch) {
  if (!embedder) return Promise.reject(new Error('search by meaning is not running'));
  var out = [], cut = texts.map(function (t) { return String(t).split(/\s+/).slice(0, EMBED.words).join(' '); });
  var chain = Promise.resolve();
  for (var i = 0; i < cut.length; i += EMBED.batch) {
    (function (k) {
      chain = chain.then(function () { return embedder(cut.slice(k, k + EMBED.batch)); }).then(function (v) {
        v.forEach(function (x) { out.push(Array.prototype.slice.call(x)); });
        if (onBatch) onBatch(out.length, cut.length);
      });
    })(i);
  }
  return chain.then(function () { return out; });
}

var engine = null, engineModel = null;
/* Tests hand in a stand-in with the same chat.completions.create(). */
function useEngine(e, model) { engine = e; engineModel = model || 'stub'; }
function ready() { return !!engine; }
function start(model, onProgress) {
  if (engine && engineModel === model) return Promise.resolve(engine);
  return loadLib().then(function (lib) {
    return lib.CreateMLCEngine(model, { initProgressCallback: function (p) { if (onProgress) onProgress(p.progress || 0, p.text || ''); } });
  }).then(function (e) { engine = e; engineModel = model; return e; });
}

function stripThinking(t) { return String(t).replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim(); }
function chat(system, user, schema, maxTokens) {
  if (!engine) return Promise.reject(new Error('the on-device AI is not running'));
  /* Qwen3 reasons aloud in <think> by default; off, its answers are short
     and come at once. Anything that still arrives in <think> is removed. */
  var req = { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens || 400,
              extra_body: { enable_thinking: false } };
  if (schema) req.response_format = { type: 'json_object', schema: JSON.stringify(schema) };
  return engine.chat.completions.create(req).then(function (r) {
    return stripThinking(String((r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || ''));
  });
}

/* ── the four jobs, each prompt short: a 1B model follows short ones ────── */
var SYSTEM = 'You are a careful medical tutor. Use ONLY the text given. Never add a number, drug, test or disease that the text does not contain.';
function summaryPrompt(question, passages) {
  return 'Question: ' + question + '\n\nPassages from the student’s textbook:\n' +
    passages.map(function (p, i) { return '[' + (i + 1) + '] ' + p.text; }).join('\n') +
    '\n\nAnswer the question in 2 to 4 short sentences using only these passages. End every sentence with the number of the passage it comes from, like [2].';
}
function plainPrompt(title, points) {
  return 'Section: ' + title + '\nKey points from the textbook:\n' + points.map(function (p) { return '- ' + p; }).join('\n') +
    '\n\nExplain this section to a student in 3 short sentences of plain words. Add nothing that is not in the key points.';
}
function analogyPrompt(title, points) {
  return 'Section: ' + title + '\nKey points:\n' + points.slice(0, 5).map(function (p) { return '- ' + p; }).join('\n') +
    '\n\nWrite ONE everyday analogy (2 sentences) that helps a student remember the main mechanism. No numbers. No medical facts beyond the key points.';
}
function questionsPrompt(title, sentences) {
  return 'Section: ' + title + '\nTextbook sentences:\n' + sentences.slice(0, 18).map(function (s) { return '- ' + s.text; }).join('\n') +
    '\n\nWrite 4 hard multiple-choice questions a doctor would be asked about this section. Each has exactly 4 short options and one correct answer, ' +
    'and the correct answer must be stated in one of the sentences above. Wrong options must be plausible but wrong. Reply as JSON.';
}
var QUESTIONS_SCHEMA = { type: 'object', properties: { questions: { type: 'array', items: { type: 'object',
  properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' } },
  required: ['question', 'options', 'answer'] } } }, required: ['questions'] };

function parseQuestions(text) {
  try {
    var v = JSON.parse(text);
    return (v && Array.isArray(v.questions) ? v.questions : []).filter(function (q) {
      return q && typeof q.question === 'string' && Array.isArray(q.options) && typeof q.answer === 'number';
    }).map(function (q) { return { question: q.question, quote: '', options: q.options.map(String), answer: q.answer, explain: '', page: 0 }; });
  } catch (_) { return []; }
}

var MemLLM = { EMBED: EMBED, useEmbedder: useEmbedder, embedReady: embedReady, startEmbed: startEmbed, embed: embed, WEBLLM: WEBLLM, MODELS: MODELS, CFG_KEY: CFG_KEY, loadConfig: loadConfig, saveConfig: saveConfig, supported: supported,
               loadLib: loadLib, useEngine: useEngine, ready: ready, start: start, chat: chat, SYSTEM: SYSTEM,
               summaryPrompt: summaryPrompt, plainPrompt: plainPrompt, analogyPrompt: analogyPrompt, questionsPrompt: questionsPrompt,
               QUESTIONS_SCHEMA: QUESTIONS_SCHEMA, parseQuestions: parseQuestions, stripThinking: stripThinking };
root.MemLLM = MemLLM;
if (typeof module !== 'undefined' && module.exports) module.exports = MemLLM;
})(typeof window !== 'undefined' ? window : this);
