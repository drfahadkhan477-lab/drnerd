/* ═══════════════════════════════════════════════════════════════════════════
   llm.js — a small language model, running on this device.

   OPTIONAL, and off until the owner turns it on in Settings. It downloads a
   model once (under a gigabyte) and runs it on the iPad's GPU through WebGPU
   with WebLLM (Apache-2.0); after that it works offline and nothing is sent
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
/* Small enough for an iPad: Safari caps one GPU buffer at about a gigabyte
   even on an iPad Pro, and a tab's memory lower on older models. */
var MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', mb: 879, licence: 'Llama 3.2 Community License' },
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B (smaller)', mb: 711, licence: 'Gemma Terms of Use' },
];
var CFG_KEY = 'memorizer.llm.v1';

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

function chat(system, user, schema, maxTokens) {
  if (!engine) return Promise.reject(new Error('the on-device AI is not running'));
  var req = { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens || 400 };
  if (schema) req.response_format = { type: 'json_object', schema: JSON.stringify(schema) };
  return engine.chat.completions.create(req).then(function (r) {
    return String((r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '');
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

var MemLLM = { WEBLLM: WEBLLM, MODELS: MODELS, CFG_KEY: CFG_KEY, loadConfig: loadConfig, saveConfig: saveConfig, supported: supported,
               loadLib: loadLib, useEngine: useEngine, ready: ready, start: start, chat: chat, SYSTEM: SYSTEM,
               summaryPrompt: summaryPrompt, plainPrompt: plainPrompt, analogyPrompt: analogyPrompt, questionsPrompt: questionsPrompt,
               QUESTIONS_SCHEMA: QUESTIONS_SCHEMA, parseQuestions: parseQuestions };
root.MemLLM = MemLLM;
if (typeof module !== 'undefined' && module.exports) module.exports = MemLLM;
})(typeof window !== 'undefined' ? window : this);
