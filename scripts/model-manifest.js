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
const WEBLLM_URL = /url: '(https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@[^']+)'/.exec(llmSrc)[1];
const ENGINE = /web-llm@([\d.]+)/.exec(WEBLLM_URL)[1];
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

(async () => {
  const lib = await get(WEBLLM_URL, 'text');
  const version = /modelVersion = "([^"]+)"/.exec(lib)[1];
  const libCommit = execFileSync('git', ['ls-remote', LIB_REPO, 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0];
  const ids = [];
  for (const m of llmSrc.matchAll(/\{ id: '([\w.-]+-MLC(?:-b4)?)'/g)) ids.push(m[1]);
  const all = [...new Set(ids.flatMap(id => [id, id.replace('-q4f16_1-', '-q4f32_1-')]))];
  const models = {};
  for (const id of all) {
    const at = lib.indexOf('model_id: "' + id + '"');
    if (at === -1) throw new Error('WebLLM ' + ENGINE + ' has no model ' + id);
    const rec = lib.slice(lib.lastIndexOf('{', at), lib.indexOf('}', at));
    const repo = /model: "https:\/\/huggingface\.co\/([^"]+)"/.exec(rec)[1];
    const wasm = /modelVersion \+\s*"([^"]+\.wasm)"/.exec(rec)[1];
    const info = await get('https://huggingface.co/api/models/' + repo, 'json');
    const tree = await get('https://huggingface.co/api/models/' + repo + '/tree/' + info.sha + '?recursive=true', 'json');
    const files = {};
    for (const f of tree) {
      if (f.type !== 'file' || /^\.gitattributes$|^README\.md$/.test(f.path)) continue;
      files[f.path] = f.lfs && f.lfs.oid ? f.lfs.oid : sha256(await get('https://huggingface.co/' + repo + '/resolve/' + info.sha + '/' + f.path));
    }
    const libPath = 'web-llm-models/' + version + wasm;
    const libHash = sha256(await get('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/' + libCommit + '/' + libPath));
    models[id] = { repo, rev: info.sha, lib: { path: libPath, sha256: libHash }, files };
    console.log(id, info.sha.slice(0, 10), Object.keys(files).length + ' files');
  }
  const manifest = { engine: ENGINE, libCommit, models };
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
