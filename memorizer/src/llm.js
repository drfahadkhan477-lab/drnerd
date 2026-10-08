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
   0.6B fits more iPads; the 1.7B is stronger and wants a recent one (M-series);
   the 4B runs the Coach's agent loop best and wants 8 GB (M1 or later).
   Earlier versions offered Llama 3.2 1B and Gemma 3 1B, under their own
   licences. */
var MODELS = [
  { id: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B', mb: 1403, licence: 'Apache-2.0' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B (stronger; newer iPads)', mb: 2037, licence: 'Apache-2.0' },
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B (strongest; iPads with 8 GB, M1 or later)', mb: 3432, licence: 'Apache-2.0' },
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
  if (gpuProbe) return Promise.resolve(gpuProbe()).then(function (g) { return { ok: !!g.ok, why: g.ok ? '' : 'WebGPU is here but found no usable GPU' }; });
  if (!root.navigator || !root.navigator.gpu) return Promise.resolve({ ok: false, why: 'this browser has no WebGPU (on iPad it needs iPadOS 26 or later)' });
  return root.navigator.gpu.requestAdapter().then(function (a) {
    return a ? { ok: true, why: '' } : { ok: false, why: 'WebGPU is here but found no usable GPU' };
  }, function () { return { ok: false, why: 'WebGPU could not start' }; });
}

/* ── the model files, pinned and checked (models.js, scripts/model-manifest.js)
   WebLLM downloads a model from its Hugging Face repository's main branch
   and its runtime (.wasm) from GitHub's main branch; both move. Here every
   model comes from the commit the manifest names and the runtime from the
   commit it names, so what is downloaded cannot change upstream. Then, the
   runtime, the config and the tokenizer are checked by the engine before it
   uses them (integrityOf), and the first time a model loads every file the
   engine stored as bytes, the weights with them, is hashed and compared with
   the manifest before the model answers anything (verify). A file that does
   not match, or one at the pinned address the manifest does not know, and
   the model is deleted and refused.
   WHAT THIS DOES NOT DO: the weights are checked after they are on the GPU,
   not before (the engine has no hook for them), and a file IndexedDB keeps
   as parsed JSON (the weights' index) cannot be hashed and is not counted. */
var Models = root.MemModels || (typeof require === 'function' ? require('./models.js') : null);
var VERIFIED_KEY = 'memorizer.llm.verified.';
function modelBase(m) { return 'https://huggingface.co/' + m.repo + '/resolve/' + m.rev + '/'; }
function libUrl(m) { return 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/' + Models.libCommit + '/' + m.lib.path; }
/* hex SHA-256 → the "sha256-<base64>" form the engine checks against */
function sri(h) {
  var bin = '';
  for (var i = 0; i < h.length; i += 2) bin += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return 'sha256-' + (root.btoa || btoa)(bin);
}
/* The engine checks, BEFORE it uses them and on every load, the files it
   is given hashes for: the runtime before it is run, the config and the
   tokenizer before they are read. The weights it does not check; verify()
   below does, once, after the first load. */
function integrityOf(m) {
  var tok = {};
  ['tokenizer.json', 'tokenizer.model'].forEach(function (f) { if (m.files[f]) tok[f] = sri(m.files[f]); });
  var out = { model_lib: sri(m.lib.sha256), tokenizer: tok, onFailure: 'error' };
  if (m.files['mlc-chat-config.json']) out.config = sri(m.files['mlc-chat-config.json']);
  return out;
}
function pinnedConfig(base, backend) {
  var cfg = Object.assign({}, base || {}, { cacheBackend: backend });
  cfg.model_list = ((base && base.model_list) || []).map(function (r) {
    var m = Models && Models.models[r.model_id];
    return m ? Object.assign({}, r, { model: modelBase(m), model_lib: libUrl(m), integrity: integrityOf(m) }) : r;
  });
  return cfg;
}
/* files: [{ url, sha256 }] read back from the browser's store. → { ok,
   checked, bad: [names], unknown: [names] } for model id. PURE. */
function verifyFiles(id, files) {
  var m = Models && Models.models[id];
  if (!m) return { ok: false, checked: 0, bad: [], unknown: [], why: 'no manifest for ' + id };
  var base = modelBase(m), out = { checked: 0, bad: [], unknown: [] };
  files.forEach(function (f) {
    var want = f.url === libUrl(m) ? m.lib.sha256 : f.url.indexOf(base) === 0 ? m.files[decodeURIComponent(f.url.slice(base.length))] : undefined;
    var name = f.url.slice(f.url.lastIndexOf('/') + 1);
    if (want === undefined) { out.unknown.push(name); return; }
    out.checked++;
    if (want !== f.sha256) out.bad.push(name);
  });
  out.ok = out.checked > 0 && !out.bad.length && !out.unknown.length;
  return out;
}
function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function subtle() { var c = root.crypto || (typeof crypto !== 'undefined' ? crypto : null); return c && c.subtle; }
function digest(buf) { return subtle().digest('SHA-256', buf).then(hex); }
/* Everything the engine stored at this model's pinned addresses, from
   whichever store it used, ONE FILE AT A TIME: a model is up to a couple of
   gigabytes, and holding it all at once would end the tab on an iPad.
   Copies at other addresses (a download from before the pin) are not
   looked at: they are not what the engine loads. */
var STORES = ['webllm/model', 'webllm/wasm', 'webllm/config'];
/* A stored file's bytes, through FileReader as ocr.js reads its downloads
   (Blob.arrayBuffer() is Safari 14); Node, where the tests run, has none. */
function bytesOf(blob) {
  if (typeof FileReader === 'undefined') return blob.arrayBuffer();
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () { resolve(fr.result); };
    fr.onerror = function () { reject(fr.error || new Error('could not read a stored file')); };
    fr.readAsArrayBuffer(blob);
  });
}
function storedFiles(id, backend) {
  var m = Models && Models.models[id], out = [];
  if (!m) return Promise.resolve(out);
  var mine = function (url) { return url === libUrl(m) || url.indexOf(modelBase(m)) === 0; };
  var add = function (url, buf) { return digest(buf).then(function (h) { out.push({ url: url, sha256: h }); }); };
  var each = function (list, fn) { return list.reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve()); };
  if (backend !== 'indexeddb') {
    var cs = root.caches || (typeof caches !== 'undefined' ? caches : null);
    if (!cs) return Promise.resolve(out);
    return each(STORES, function (n) {
      return cs.has(n).then(function (has) {
        if (!has) return;
        return cs.open(n).then(function (c) {
          return c.keys().then(function (ks) {
            return each(ks.filter(function (k) { return mine(k.url); }), function (k) {
              return c.match(k).then(function (r) { return r.blob(); }).then(bytesOf).then(function (buf) { return add(k.url, buf); });
            });
          });
        });
      });
    }).then(function () { return out; });
  }
  var idb = root.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) return Promise.resolve(out);
  var req = function (r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); };
  /* A store that is not there is not made here: the engine makes it, with
     its own schema, and would find an empty one in the way. Asked first
     where the browser can say (indexedDB.databases(), Safari 14+): opening
     to look would make it, and aborting that open undoes it on Chromium
     but not on WebKit, which keeps the empty database. The abort stays for
     a browser that cannot say. */
  var listed = idb.databases ? idb.databases().then(function (ds) { return ds.map(function (d) { return d.name; }); }, function () { return null; }) : Promise.resolve(null);
  return listed.then(function (names) { return each(STORES, function (n) {
    if (names && names.indexOf(n) === -1) return;
    return new Promise(function (resolve) {
      var o = idb.open(n);
      o.onupgradeneeded = function () { o.transaction.abort(); };
      o.onerror = function () { resolve(null); };
      o.onsuccess = function () { resolve(o.result); };
    }).then(function (db) {
      if (!db) return;
      if (!db.objectStoreNames.contains('urls')) { db.close(); return; }
      return req(db.transaction('urls').objectStore('urls').getAllKeys()).then(function (keys) {
        return each(keys.filter(function (k) { return typeof k === 'string' && mine(k); }), function (k) {
          return req(db.transaction('urls').objectStore('urls').get(k)).then(function (r) {
            if (r && r.data instanceof ArrayBuffer) return add(k, r.data);
          });
        });
      }).then(function () { db.close(); }, function () { db.close(); });
    });
  }); }).then(function () { return out; });
}
function verify(id, backend) {
  var m = Models && Models.models[id];
  try { if (m && ls().getItem(VERIFIED_KEY + id) === m.rev) return Promise.resolve({ ok: true, cached: true }); } catch (_) {}
  return storedFiles(id, backend).then(function (files) {
    var r = verifyFiles(id, files);
    if (r.ok) { try { ls().setItem(VERIFIED_KEY + id, m.rev); } catch (_) {} }
    return r;
  });
}
var verifier = null;
/* Tests hand in a stand-in for the check (there is no download here). */
function useVerify(fn) { verifier = fn; }
/* What the app says about its model files (Settings). */
function modelSource(id) {
  var m = Models && Models.models[id];
  return m ? { repo: m.repo, rev: m.rev.slice(0, 10), engine: Models.engine, files: Object.keys(m.files).length + 1 } : null;
}

var libP = null;
function loadLib() {
  if (libP) return libP;
  libP = fetch(WEBLLM.url, { integrity: WEBLLM.sri, mode: 'cors' }).then(function (r) {
    if (!r.ok) throw new Error('could not download the AI engine (' + r.status + ')');
    return r.text();
  }).then(function (src) {
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    /* A plain dynamic import: the page's Content-Security-Policy forbids eval,
       and new Function() is eval. */
    return import(url);
  });
  libP.catch(function () { libP = null; });
  return libP;
}

var embedder = null, embedEngine = null, embedStarting = null;
/* Tests hand in a function from texts to vectors. */
function useEmbedder(fn) { embedder = fn; }
function embedReady() { return !!embedder; }
function startEmbed(onProgress) {
  if (embedder) return Promise.resolve();
  if (embedStarting) return embedStarting;
  embedStarting = persist().then(loadLib).then(function (lib) {
    return create(lib, EMBED.id, onProgress);
  }).then(function (e) {
    embedEngine = e;
    embedder = function (texts) { return e.embeddings.create({ input: texts }).then(function (r) { return r.data.map(function (d) { return d.embedding; }); }); };
  });
  embedStarting.then(function () { embedStarting = null; }, function () { embedStarting = null; });
  return embedStarting;
}
function stopEmbed() {
  var pending = embedStarting;
  return Promise.resolve(pending).catch(function () {}).then(function () { var old = embedEngine; embedder = null; embedEngine = null; return unload(old); });
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

/* ── getting the model onto the iPad ─────────────────────────────────────
   The owner reported the model "not downloading properly". What goes wrong
   on an iPad, and what is done about each:
     · 16-BIT GPU MATHS. The q4f16 builds need WebGPU's "shader-f16"; where
       the adapter lacks it, WebLLM refuses. The same model's q4f32 build
       (in the pinned engine's own list) is used instead, and said so.
     · STORAGE. Hundreds of megabytes go into the browser's storage; Safari
       may refuse or evict it. Persistent storage is asked for first, and a
       refusal is explained (free space; install to the Home Screen).
     · THE CACHE. WebLLM keeps the files in the Cache API by default; where
       that store fails, the download is tried once more into IndexedDB (a
       backend the pinned engine supports), and the store that worked is
       remembered, so the next start finds the files where they are.
     · AN INTERRUPTED DOWNLOAD. Retried, twice: the parts already fetched
       are kept in the store, so a retry continues rather than restarts.
     · GPU MEMORY. A model too big for the iPad loses the GPU device; that is
       explained as "choose a smaller model", not as a raw error.
   A half-downloaded model can be deleted from Settings (clearModel). The
   decisions — variantFor, classify, nextTry — are pure, and the start loop
   is tested against a stand-in engine (useLib / useGpu). */
var BACKEND_KEY = 'memorizer.llm.backend';
var RETRIES = 2;
var WAIT = { ms: 1500 };   /* before a retry, times the attempt number; tests set it to 0 */
function variantFor(id, f16) { return f16 === false ? String(id).replace('-q4f16_1-', '-q4f32_1-') : id; }
var KINDS = [
  ['f16', /shader-f16/i],
  ['memory', /device (?:was |is )?lost|out of memory|\boom\b|allocation|maxStorageBuffer|buffer size|exceeds? the (?:limit|maximum)/i],
  ['quota', /quota|QuotaExceeded|storage (?:is )?full|not enough (?:space|storage)/i],
  ['cache', /\bcaches?\b|cache\.(?:add|put)|indexeddb/i],
  ['network', /failed to fetch|networkerror|load failed|network|timed? ?out|aborted|status (?:5\d\d|0)\b|\b50[234]\b/i],
];
function classify(err) {
  var m = String(err && err.message || err || '');
  for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(m)) return KINDS[i][0];
  return 'other';
}
var SAYS = {
  f16: 'this browser lacks the 16-bit GPU maths the model was built for',
  memory: 'this iPad ran out of GPU memory for this model — choose a smaller one (Qwen3 0.6B) in Settings',
  quota: 'the browser would not store the model — free some space on the iPad, add Memorizer to the Home Screen (an installed app is given more room), and turn it on again; the parts already downloaded are kept',
  cache: 'the browser\u2019s storage refused the model files — try again; if it keeps failing, delete the downloaded model in Settings and start over',
  network: 'the download was interrupted — check the connection and turn it on again; the parts already downloaded are kept',
};
function explain(err) {
  var k = classify(err), raw = String(err && err.message || err || 'unknown error');
  return SAYS[k] ? SAYS[k] + ' (' + raw.slice(0, 160) + ')' : raw;
}
/* After failed attempt n (0-based) on `backend`: the next try, or null. */
function nextTry(err, n, backend) {
  var k = classify(err);
  if (k === 'network' && n < RETRIES) return { backend: backend, wait: WAIT.ms * (n + 1) };
  /* Safari reports a failed cache write as a bare "Load failed", the same
     words as a dropped connection: once the retries are spent on the Cache
     API, the other store is the last thing to try. */
  if ((k === 'cache' || k === 'quota' || k === 'network') && backend === 'cache') return { backend: 'indexeddb', wait: 0 };
  return null;
}
/* What a start is doing, for the bar in Settings. The engine reports a
   fraction and a sentence of its own ("Fetching param cache[3/9]: 120MB
   fetched. 33% completed, …"); the fraction restarts at 0 for each of its
   steps, so the step is named beside it or a bar that falls back to 0
   would read as a download starting over. → { pct, step, detail }. PURE. */
var CHECKING = 'Checking the downloaded files against their published hashes';
var STEPS = [
  [/^Start to fetch params/, 'Downloading the model', null],
  [/^Fetching param cache\[\d+\/\d+\]: (\d+)MB fetched/, 'Downloading the model', ' MB downloaded'],
  [/^Loading model from cache\[\d+\/\d+\]: (\d+)MB loaded/, 'Loading the model onto the GPU', ' MB loaded'],
  [/^Loading GPU shader modules/, 'Preparing the GPU', null],
  [/^Finish loading on /, 'Loaded on the GPU', null],
  [new RegExp('^' + CHECKING), 'Checking the files', null],
];
function stage(p, text) {
  var t = String(text || ''), pct = Math.max(0, Math.min(100, Math.floor(100 * (+p || 0))));
  for (var i = 0; i < STEPS.length; i++) {
    var m = t.match(STEPS[i][0]);
    if (m) return { pct: pct, step: STEPS[i][1], detail: STEPS[i][2] && m[1] ? m[1] + STEPS[i][2] : '' };
  }
  return { pct: pct, step: t || 'Starting', detail: '' };
}
/* root.localStorage in a page; a global one where a test provides it */
function ls() { return root.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null); }
function savedBackend() { try { return ls().getItem(BACKEND_KEY) === 'indexeddb' ? 'indexeddb' : 'cache'; } catch (_) { return 'cache'; } }
function saveBackend(b) { try { ls().setItem(BACKEND_KEY, b); } catch (_) {} }
/* Asked, not waited on for ever: Firefox answers persist() with a prompt,
   and a prompt nobody answers leaves the promise pending, so a start that
   awaited it never reached the engine (CI's headless Firefox, and anyone who
   closes the prompt). After PERSIST.ms the start goes on; the question stays
   on screen and an answer still counts for the files stored after it. */
var PERSIST = { ms: 3000 };
function persist() {
  var nav = root.navigator || (typeof navigator !== 'undefined' ? navigator : null), st = nav && nav.storage;
  if (!st || !st.persist) return Promise.resolve(false);
  return Promise.race([st.persist().then(function (v) { return !!v; }, function () { return false; }),
    new Promise(function (r) { setTimeout(function () { r(false); }, PERSIST.ms); })]);
}
var gpuProbe = null;
/* Tests hand in a stand-in engine library and GPU. */
function useLib(lib) { libP = lib ? Promise.resolve(lib) : null; }
function useGpu(fn) { gpuProbe = fn; }
function gpu() {
  if (gpuProbe) return Promise.resolve(gpuProbe());
  if (!root.navigator || !root.navigator.gpu) return Promise.resolve({ ok: false, f16: false });
  return root.navigator.gpu.requestAdapter().then(function (a) {
    return a ? { ok: true, f16: !!(a.features && a.features.has && a.features.has('shader-f16')) } : { ok: false, f16: false };
  }, function () { return { ok: false, f16: false }; });
}
/* One engine, tried and retried by the rules above. */
function create(lib, id, onProgress) {
  var backend = savedBackend();
  /* a model that is not the one the manifest names: not used, not kept (a
     retry would only load the same cached file again) */
  function refuse(e, what) {
    return unload(e).catch(function () {}).then(function () {
      return deleteFiles(lib, id).then(function () { return 'It has been deleted and was not used'; },
        function (d) { return 'It was not used, and could not be deleted (' + d.message + '); delete it in Settings'; });
    }).then(function (done) {
      var err = new Error('the downloaded model does not match the one Memorizer expects: ' + what + '. ' + done);
      err.integrity = true;
      throw err;
    });
  }
  function attempt(n) {
    var appConfig = pinnedConfig(lib.prebuiltAppConfig, backend);
    return lib.CreateMLCEngine(id, { appConfig: appConfig, initProgressCallback: function (p) { if (onProgress) onProgress(p.progress || 0, p.text || ''); } })
      .then(function (e) {
        saveBackend(backend);
        /* the first start hashes every stored file, a gigabyte or more on an
           iPad, after the engine has already said 100% */
        if (onProgress) onProgress(1, CHECKING);
        return (verifier || verify)(id, backend).then(function (v) {
          if (v.ok) return e;
          return refuse(e, v.why || (v.bad.length ? v.bad.length + ' file' + (v.bad.length === 1 ? '' : 's') + ' not what it should be (' + v.bad.slice(0, 3).join(', ') + ')'
            : v.unknown.length ? 'files it does not expect (' + v.unknown.slice(0, 3).join(', ') + ')' : 'no files to check'));
        });
      }, function (err) {
        if (err && err.name === 'IntegrityError') {
          var url = String(err.url || '');
          return refuse(null, (url.slice(url.lastIndexOf('/') + 1) || 'a file') + ' not what it should be');
        }
        var next = nextTry(err, n, backend);
        if (!next) throw new Error(explain(err));
        if (onProgress) onProgress(0, next.backend !== backend ? 'the browser cache refused the files; trying its other store' : 'the download was interrupted; trying again (' + (n + 2) + ' of ' + (RETRIES + 1) + ')');
        backend = next.backend;
        return new Promise(function (r) { setTimeout(r, next.wait); }).then(function () { return attempt(n + 1); });
      });
  }
  return attempt(0);
}

var engine = null, engineModel = null, engineStarting = null, startingModel = null, generation = 0;
function unload(e) { return e && e.unload ? Promise.resolve().then(function () { return e.unload(); }) : Promise.resolve(); }
function stop() { generation++; var old = engine; engine = null; engineModel = null; return unload(old); }
/* Tests hand in a stand-in with the same chat.completions.create(). */
function useEngine(e, model) { engine = e; engineModel = model || 'stub'; }
function ready(model) { return !!engine && (!model || engineModel === model || engineModel === 'stub'); }
function start(model, onProgress) {
  if (ready(model)) return Promise.resolve(engine);
  if (engineStarting) return startingModel === model ? engineStarting : engineStarting.catch(function () {}).then(function () { return start(model, onProgress); });
  var id = model, gen = generation, old = engine;
  engine = null; engineModel = null; startingModel = model;
  var pending = unload(old).then(persist).then(gpu).then(function (g) {
    id = variantFor(model, g.f16);
    if (id !== model && onProgress) onProgress(0, 'this browser has no 16-bit GPU maths, so the 32-bit build of the same model is used');
    return loadLib();
  }).then(function (lib) { return create(lib, id, onProgress); })
    .then(function (e) {
      if (gen !== generation) return unload(e).then(function () { throw new Error('model start cancelled'); });
      engine = e; engineModel = model; return e;
    });
  engineStarting = pending;
  pending.then(function () { if (engineStarting === pending) engineStarting = null; }, function () { if (engineStarting === pending) engineStarting = null; });
  return pending;
}
/* Delete a model's downloaded files — both builds, both stores — so a
   broken download starts clean. */
function clearModel(model) {
  return loadLib().then(function (lib) {
    var pending = engineStarting, matching = engineModel === model || startingModel === model;
    return (matching ? stop().then(function () { return pending; }).catch(function () {}) : Promise.resolve()).then(function () {
      return deleteFiles(lib, model);
    });
  });
}
/* The files themselves, both builds, both stores. A copy at the pinned
   addresses that cannot be deleted is said so; a copy from before the pin,
   at the engine's own addresses, is removed if it is there (nothing loads
   it any more, and it holds the same gigabytes) and is not an error if it
   is not. Called by clearModel once nothing is starting, and directly by a
   refusal inside a start (create), which clearModel would wait on. */
function deleteFiles(lib, model) {
  var jobs = [];
  [model, variantFor(model, false)].forEach(function (id) {
    try { ls().removeItem(VERIFIED_KEY + id); } catch (_) {}
    ['cache', 'indexeddb'].forEach(function (b) {
      jobs.push(Promise.resolve().then(function () {
        return lib.deleteModelAllInfoInCache(id, pinnedConfig(lib.prebuiltAppConfig, b));
      }).catch(function (e) { throw new Error('Could not delete ' + id + ' from ' + b + ': ' + ((e && e.message) || e)); }));
      jobs.push(Promise.resolve().then(function () {
        return lib.deleteModelAllInfoInCache(id, Object.assign({}, lib.prebuiltAppConfig || {}, { cacheBackend: b }));
      }).catch(function () {}));
    });
  });
  return Promise.all(jobs).then(function () { return true; });
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

/* ── with a study pack: Claude's notes, put another way ─────────────────
   The model is handed the pack's notes (ground.js packContext) and asked
   for words only; ground.js variant and missExplain hold what comes back. */
function variantPrompt(q, notes) {
  return 'Notes from the student\u2019s study pack, checked against their textbook:\n' + notes +
    '\n\nExam question: ' + q.question + '\nIts answer: ' + q.options[q.answer] +
    '\n\nRewrite the question so it asks for the same answer in different words, as a short clinical scenario if you can. ' +
    'Do not change what it asks. Do not put the answer or any option in it. Use no number, drug, test or disease that is not in the notes or the question. ' +
    'Reply as JSON: {"question": "..."}';
}
var VARIANT_SCHEMA = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] };
function parseVariant(text) {
  var t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { var v = JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t); return v && typeof v.question === 'string' ? v.question : ''; } catch (_) { return ''; }
}
function missPrompt(q, chosen, notes) {
  var right = q.options[q.answer], mine = chosen >= 0 ? q.options[chosen] : '';
  return 'Notes from the student\u2019s study pack, checked against their textbook:\n' + notes +
    '\n\nQuestion: ' + q.question + '\n' + (mine ? 'The student chose: ' + mine + '.' : 'The student was not sure.') + ' The answer is: ' + right + '.' +
    '\nWhy the answer is right: ' + q.explain +
    (mine && q.why && q.why[chosen] ? '\nWhy their choice is wrong: ' + q.why[chosen] : '') + (q.trap ? '\nThe trap: ' + q.trap : '') +
    '\n\nIn 2 or 3 short sentences, speaking to the student, explain why ' + right + ' is the answer' + (mine ? ' and why ' + mine + ' is not' : '') +
    '. Use only what is written above. No new numbers, drugs, tests or diseases.';
}

/* Teach-back, marked: the model judges each point and quotes the student. */
function teachPrompt(points, said) {
  return 'Key points of the lesson:\n' + points.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n') +
    '\n\nThe student\u2019s explanation:\n"' + String(said || '').replace(/\s+/g, ' ').trim() + '"' +
    '\n\nMark the student\u2019s explanation against each key point: "covered" if it says the point, even in other words; "wrong" if it says something that contradicts the point; "missed" if it leaves the point out. ' +
    'For "covered" or "wrong", copy the student\u2019s own words that show it, exactly as written. Reply as JSON: {"points": [{"n": 1, "verdict": "covered", "quote": "..."}]}';
}
var TEACH_SCHEMA = { type: 'object', properties: { points: { type: 'array', items: { type: 'object',
  properties: { n: { type: 'integer' }, verdict: { type: 'string', enum: ['covered', 'wrong', 'missed'] }, quote: { type: 'string' } }, required: ['n', 'verdict', 'quote'] } } }, required: ['points'] };
/* A Socratic follow-up from the pack's notes. */
function followUpPrompt(notes, asked) {
  return 'Notes from the student\u2019s study pack, checked against their textbook:\n' + notes +
    ((asked || []).length ? '\n\nAlready asked:\n' + asked.map(function (a) { return '- ' + a; }).join('\n') : '') +
    '\n\nAsk the student ONE new "why" or "how" question that these notes answer, and give its answer in one sentence taken from the notes. ' +
    'Use no number, drug, test or disease that is not in the notes. Reply as JSON: {"question": "...", "answer": "..."}';
}
var FOLLOW_SCHEMA = { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] };
function parseFollowUp(text) {
  var t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { var v = JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t); return { question: v && typeof v.question === 'string' ? v.question : '', answer: v && typeof v.answer === 'string' ? v.answer : '' }; }
  catch (_) { return { question: '', answer: '' }; }
}

function parseQuestions(text) {
  try {
    var v = JSON.parse(text);
    return (v && Array.isArray(v.questions) ? v.questions : []).filter(function (q) {
      return q && typeof q.question === 'string' && Array.isArray(q.options) && typeof q.answer === 'number';
    }).map(function (q) { return { question: q.question, quote: '', options: q.options.map(String), answer: q.answer, explain: '', page: 0 }; });
  } catch (_) { return []; }
}

var MemLLM = { stage: stage, PERSIST: PERSIST, CHECKING: CHECKING, pinnedConfig: pinnedConfig, verifyFiles: verifyFiles, verify: verify, storedFiles: storedFiles, useVerify: useVerify, modelSource: modelSource, stop: stop, stopEmbed: stopEmbed, WAIT: WAIT, variantFor: variantFor, classify: classify, explain: explain, nextTry: nextTry, RETRIES: RETRIES, BACKEND_KEY: BACKEND_KEY, useLib: useLib, useGpu: useGpu, gpu: gpu, clearModel: clearModel, EMBED: EMBED, useEmbedder: useEmbedder, embedReady: embedReady, startEmbed: startEmbed, embed: embed, WEBLLM: WEBLLM, MODELS: MODELS, CFG_KEY: CFG_KEY, loadConfig: loadConfig, saveConfig: saveConfig, supported: supported,
               loadLib: loadLib, useEngine: useEngine, ready: ready, start: start, chat: chat, SYSTEM: SYSTEM,
               summaryPrompt: summaryPrompt, plainPrompt: plainPrompt, analogyPrompt: analogyPrompt, questionsPrompt: questionsPrompt,
               QUESTIONS_SCHEMA: QUESTIONS_SCHEMA, parseQuestions: parseQuestions, stripThinking: stripThinking,
               variantPrompt: variantPrompt, VARIANT_SCHEMA: VARIANT_SCHEMA, parseVariant: parseVariant, missPrompt: missPrompt,
               teachPrompt: teachPrompt, TEACH_SCHEMA: TEACH_SCHEMA, followUpPrompt: followUpPrompt, FOLLOW_SCHEMA: FOLLOW_SCHEMA, parseFollowUp: parseFollowUp };
root.MemLLM = MemLLM;
if (typeof module !== 'undefined' && module.exports) module.exports = MemLLM;
})(typeof window !== 'undefined' ? window : this);
