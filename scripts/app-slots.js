#!/usr/bin/env node
/*
 * The finished single file, cut into the app (ours) and its slots (not code).
 *
 * WHY. The app is built by 91 patch scripts applied to the ACCSAP export. The
 * export's application code is the owner's own; what is licensed is what it
 * carries: the question bank, its figures, and the Braunwald reference seed
 * and figures the chain bakes in. Retiring the chain starts by committing the
 * chain's OUTPUT, minus those payloads, as the app's source. That needs a cut
 * that is provably lossless and provably clean, which is this file.
 *
 * A SLOT is a span of the built file replaced by a token, @@SLOT[kind:name]@@.
 * Four kinds of span leave the shell:
 *
 *   payload   ALL_Q, IMGS, the reference seed, the reference figures and the
 *             heart's baked mesh. Stored beside the content (content/payload/,
 *             gitignored), never in the app. The first four are licensed; the
 *             mesh is ours but 3 MB of base64, and scripts/heart-bake.js makes it.
 *   src       a module of src/ found verbatim. src/ stays the source of truth:
 *             assembling reads the file as it is now, not as it was cut.
 *   asset     a file of assets/ found verbatim as base64 (fonts, the splash
 *             photograph). Read from assets/ at assembly, same reason.
 *   app       a piece of the app carved out of the shell into its own file
 *             under app/ (scripts/carve.js): step 3 of retiring the chain.
 *             Ours, committed, and read at assembly as src is. Held to
 *             exactly-once as src is, and a piece holds no token itself.
 *
 * A payload or a src module must match exactly once, as patch() must. One that
 * is not found verbatim stays inline and is REPORTED, not guessed at: it means
 * a later patch edited the embedded copy, which is drift worth knowing.
 *
 * An asset may be embedded more than once (the heart photograph is, by the
 * splash and by the home hero) and is claimed at every site. Exactly-once
 * guards an edit landing in the wrong place; a verbatim base64 file filled
 * back from the same file is the same bytes wherever it stands, and left
 * inline it is a blob the leak scan rightly refuses.
 *
 * assemble() is cut()'s inverse. freeze-shell.js proves it byte for byte on the
 * real build; tests/verify-app-slots-pure.js on a synthetic one.
 *
 * leakScan() looks in the shell for what cut() was meant to remove, and
 * reports COUNTS and offsets only. It never returns the text it found.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOKEN_RE = /@@SLOT\[([a-z]+):([^\]@]+)\]@@/g;
const token = (kind, name) => `@@SLOT[${kind}:${name}]@@`;

/* The licensed and generated spans. Each `re` captures (1) what stays and
   (2) the span that leaves, so the token replaces only the payload and the
   code around it is kept verbatim. The ALL_Q and IMGS patterns are
   scripts/extract-content.js's, anchored to their own line, except that the
   newline after is a lookahead: consumed, it hid a second ALL_Q line directly
   below the first from the exactly-once count. */
const PAYLOADS = [
  { name: 'ALL_Q', re: /(\nconst ALL_Q=)(\[[\s\S]*?\]);(?=\n)/, required: true },
  { name: 'IMGS', re: /(\nconst IMGS=)(\{[\s\S]*?\});(?=\n)/, required: true },
  { name: 'REF_SEED', re: /(\/\*REF_SEED_START\*\/)([\s\S]*?)\/\*REF_SEED_END\*\//, required: true },
  { name: 'REF_IMGS', re: /(\/\*REF_IMGS_START\*\/)([\s\S]*?)\/\*REF_IMGS_END\*\//, required: false },
  { name: 'HEART_MESH', re: /(\nwindow\.HEART3D_MESH_B64=')([A-Za-z0-9+/=]*)';/, required: true },
];

const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

function walk(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
  });
}

/* What the repository offers to slot, as { name: text }. Names are
   repository-relative paths, so a slot names the file it came from — with
   forward slashes whatever the machine, because the names are written into the
   committed shell and a shell cut on Windows has to assemble on Linux. */
function repoSources(root = ROOT) {
  const srcs = {}, assets = {}, apps = {};
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  for (const f of walk(path.join(root, 'src'), p => p.endsWith('.js')))
    srcs[rel(f)] = fs.readFileSync(f, 'utf8');
  /* Assets under 512 bytes are skipped: a short base64 string could match by
     accident, and nothing that small is worth a slot. */
  for (const f of walk(path.join(root, 'assets'), p => !p.endsWith('.md') && fs.statSync(p).size >= 512))
    assets[rel(f)] = fs.readFileSync(f).toString('base64');
  /* The pieces carved out of the shell: everything under app/ but the shell. */
  const shellFile = path.join(root, 'app', 'systole.html');
  for (const f of walk(path.join(root, 'app'), p => p !== shellFile))
    apps[rel(f)] = fs.readFileSync(f, 'utf8');
  return { srcs, assets, apps };
}

/* cut(html, sources) → { shell, payloads, report }
   payloads: { ALL_Q: text, … } — the spans that left and must be stored.
   report:   { slots: [{kind,name,bytes,times}], inline: {src:[…], asset:[…], app:[…]} }
             times is how many sites an asset was claimed at; absent means one. */
function cut(html, sources = repoSources()) {
  if (html.includes('@@SLOT[')) throw new Error('the input already contains a slot token: it is not a fresh build');
  let shell = html;
  const payloads = {}, slots = [];
  for (const p of PAYLOADS) {
    const global = new RegExp(p.re.source, 'g');
    const n = (shell.match(global) || []).length;
    if (n === 0 && !p.required) continue;
    if (n !== 1) throw new Error(`[${p.name}] expected exactly 1 match, found ${n}`);
    const m = p.re.exec(shell);
    payloads[p.name] = m[2];
    const whole = m[0], kept = m[1], tail = whole.slice(kept.length + m[2].length);
    shell = shell.replace(whole, () => kept + token('payload', p.name) + tail);
    slots.push({ kind: 'payload', name: p.name, bytes: m[2].length });
  }
  const inline = { src: [], asset: [], app: [] };
  for (const [kind, table] of [['src', sources.srcs], ['asset', sources.assets], ['app', sources.apps || {}]]) {
    for (const name of Object.keys(table).sort()) {
      const text = table[name], n = count(shell, text);
      if (n === 1) {
        shell = shell.replace(text, () => token(kind, name));
        slots.push({ kind, name, bytes: text.length });
      } else if (n > 1 && kind === 'asset') {
        shell = shell.split(text).join(token(kind, name));
        slots.push({ kind, name, bytes: text.length, times: n });
      } else if (n > 1) {
        inline[kind].push(`${name} (found ${n} times)`);
      } else {
        inline[kind].push(name);
      }
    }
  }
  return { shell, payloads, report: { slots, inline } };
}

/* assemble(shell, resolve) — resolve(kind, name) returns the span's text.
   A payload or src token may appear once; an asset token may repeat, as the
   asset did in the build. An unknown kind, a missing payload or a token left
   over is an error, never an empty string. */
function assemble(shell, resolve) {
  const seen = new Set();
  const out = shell.replace(TOKEN_RE, (_, kind, name) => {
    const key = kind + ':' + name;
    if (seen.has(key) && kind !== 'asset') throw new Error(`slot ${key} appears more than once in the shell`);
    seen.add(key);
    const text = resolve(kind, name);
    if (typeof text !== 'string') throw new Error(`slot ${key} has nothing to fill it`);
    return text;
  });
  if (out.includes('@@SLOT[')) throw new Error('a slot token survived assembly');
  return out;
}

/* The resolver assembly uses: payloads from a directory, src and assets from
   the repository as it is now. */
function repoResolver(payloadDir, root = ROOT) {
  return (kind, name) => {
    if (kind === 'payload') {
      const f = path.join(payloadDir, name + '.txt');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined;
    }
    const f = path.join(root, name);
    if (!fs.existsSync(f)) return undefined;
    if (kind === 'src' || kind === 'app') return fs.readFileSync(f, 'utf8');
    if (kind === 'asset') return fs.readFileSync(f).toString('base64');
    return undefined;
  };
}

/* Every string of at least `min` characters in a JSON value. */
function strings(value, min, out = []) {
  if (typeof value === 'string') { if (value.length >= min) out.push(value); }
  else if (Array.isArray(value)) value.forEach(v => strings(v, min, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, min, out));
  return out;
}

/* leakScan(shell, payloads) → { questionText, refText, base64Runs, offsets }
   questionText: how many strings (≥ 40 chars) of the question bank are in the
   shell; refText the same for the reference seed. base64Runs: base64 runs of
   2000+ characters still in the shell, which would be an image or a blob no
   slot claimed. Offsets only, never the text. */
function leakScan(shell, payloads) {
  const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
  const hits = (list) => {
    const at = [];
    for (const s of new Set(list)) { const i = shell.indexOf(s); if (i >= 0) at.push(i); }
    return at;
  };
  const q = hits(strings(parse(payloads.ALL_Q || 'null'), 40));
  const r = hits(strings(parse(payloads.REF_SEED || 'null'), 40));
  const runs = [];
  for (const m of shell.matchAll(/[A-Za-z0-9+/]{2000,}={0,2}/g)) runs.push(m.index);
  return { questionText: q.length, refText: r.length, base64Runs: runs.length,
           offsets: { questionText: q.slice(0, 10), refText: r.slice(0, 10), base64Runs: runs.slice(0, 10) } };
}

module.exports = { PAYLOADS, TOKEN_RE, token, cut, assemble, repoSources, repoResolver, leakScan };
