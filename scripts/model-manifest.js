#!/usr/bin/env node
/*
 * Writes memorizer/src/models.js: for every on-device model the app offers,
 * the exact Hugging Face commit to download from and the SHA-256 of every
 * file in it, and the commit of the engine's runtime library (.wasm) and its
 * SHA-256. The app downloads from those commits only and checks the files it
 * got against these hashes before it uses a model (llm.js verify).
 *
 *   node scripts/model-manifest.js
 *
 * Needs the network. Run it when the pinned WebLLM version or the model list
 * changes; the result is committed, and the app never asks the network what
 * a file should be.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'memorizer', 'src', 'models.js');
const llmSrc = fs.readFileSync(path.join(ROOT, 'memorizer', 'src', 'llm.js'), 'utf8');
/* The engine's address is read from llm.js and must be exactly this shape:
   the script fetches it, so it is not fetched on the say-so of a file. */
const WEBLLM_URL = /url: '(https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@\d+\.\d+\.\d+\/lib\/index\.js)'/.exec(llmSrc)[1];
const ENGINE = /web-llm@(\d+\.\d+\.\d+)\//.exec(WEBLLM_URL)[1];
/* What comes back from the network is written into code the app runs, so
   every field must be exactly the shape it should be, or nothing is
   written. (SHAPE is also what tests/verify-memorizer-chunk-pure.js holds
   the committed file to.) */
const SHAPE = {
  id: /^[A-Za-z0-9][\w.-]*-MLC(?:-b4)?$/, repo: /^mlc-ai\/[A-Za-z0-9][\w.-]*$/, rev: /^[0-9a-f]{40}$/, sha256: /^[0-9a-f]{64}$/,
  file: /^[\w.-]+(?:\/[\w.-]+)*$/, lib: /^web-llm-models\/v\d+_\d+_\d+\/[\w\/.-]+\.wasm$/,
};
const must = (what, re, v) => { if (typeof v !== 'string' || !re.test(v) || /\.\./.test(v)) throw new Error('refusing ' + what + ': ' + JSON.stringify(v)); return v; };
const LIB_REPO = 'https://github.com/mlc-ai/binary-mlc-llm-libs';

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
async function get(url, as) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return as === 'json' ? await r.json() : as === 'text' ? await r.text() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 3) throw e; await new Promise(res => setTimeout(res, 2000 * (i + 1))); }
  }
}

/* The whole manifest, field by field: what the generator writes and what
   the test reads back. Throws on the first field out of shape. */
function check(m) {
  must('engine version', /^\d+\.\d+\.\d+$/, m.engine);
  must('runtime commit', SHAPE.rev, m.libCommit);
  if (!m.models || !Object.keys(m.models).length) throw new Error('refusing a manifest with no models');
  for (const [id, x] of Object.entries(m.models)) {
    must('model id', SHAPE.id, id); must('repository of ' + id, SHAPE.repo, x.repo); must('commit of ' + id, SHAPE.rev, x.rev);
    must('runtime path of ' + id, SHAPE.lib, x.lib && x.lib.path); must('runtime hash of ' + id, SHAPE.sha256, x.lib.sha256);
    for (const [f, h] of Object.entries(x.files || {})) { must('file name in ' + id, SHAPE.file, f); must('hash of ' + f, SHAPE.sha256, h); }
  }
  return true;
}
module.exports = { check, SHAPE };

if (require.main === module) (async () => {
  const lib = await get(WEBLLM_URL, 'text');
  const version = /modelVersion = "([^"]+)"/.exec(lib)[1];
  const libCommit = must('runtime commit', SHAPE.rev, execFileSync('git', ['ls-remote', LIB_REPO, 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0]);
  const ids = [];
  for (const m of llmSrc.matchAll(/\{ id: '([\w.-]+-MLC(?:-b4)?)'/g)) ids.push(m[1]);
  const all = [...new Set(ids.flatMap(id => [id, id.replace('-q4f16_1-', '-q4f32_1-')]))];
  const models = {};
  for (const id of all) {
    must('model id', SHAPE.id, id);
    const at = lib.indexOf('model_id: "' + id + '"');
    if (at === -1) throw new Error('WebLLM ' + ENGINE + ' has no model ' + id);
    const rec = lib.slice(lib.lastIndexOf('{', at), lib.indexOf('}', at));
    const repo = must('repository', SHAPE.repo, /model: "https:\/\/huggingface\.co\/([^"]+)"/.exec(rec)[1]);
    const wasm = /modelVersion \+\s*"([^"]+\.wasm)"/.exec(rec)[1];
    const info = await get('https://huggingface.co/api/models/' + repo, 'json');
    const rev = must('commit of ' + repo, SHAPE.rev, info.sha);
    const tree = await get('https://huggingface.co/api/models/' + repo + '/tree/' + rev + '?recursive=true', 'json');
    const files = {};
    for (const f of tree) {
      if (f.type !== 'file' || /^\.gitattributes$|^README\.md$/.test(f.path)) continue;
      must('file name in ' + repo, SHAPE.file, f.path);
      files[f.path] = must('hash of ' + f.path, SHAPE.sha256,
        f.lfs && f.lfs.oid ? f.lfs.oid : sha256(await get('https://huggingface.co/' + repo + '/resolve/' + rev + '/' + f.path)));
    }
    const libPath = must('runtime path', SHAPE.lib, 'web-llm-models/' + version + wasm);
    const libHash = sha256(await get('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/' + libCommit + '/' + libPath));
    models[id] = { repo, rev, lib: { path: libPath, sha256: libHash }, files };
    console.log(id, info.sha.slice(0, 10), Object.keys(files).length + ' files');
  }
  const manifest = { engine: ENGINE, libCommit, models };
  check(manifest);
  fs.writeFileSync(OUT, [
    '/* Written by scripts/model-manifest.js for WebLLM ' + ENGINE + '. Do not edit by hand. */',
    '(function (root) {',
    "'use strict';",
    'var MemModels = ' + JSON.stringify(manifest) + ';',
    'root.MemModels = MemModels;',
    "if (typeof module !== 'undefined' && module.exports) module.exports = MemModels;",
    "})(typeof window !== 'undefined' ? window : this);",
    ''].join('\n'));
  console.log('wrote ' + path.relative(process.cwd(), OUT));
})().catch(e => { console.error('model-manifest: ' + e.message); process.exit(1); });
