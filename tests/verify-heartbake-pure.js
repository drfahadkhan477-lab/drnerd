#!/usr/bin/env node
/*
 * The heart's mesh, baked at build time: is the copy the app loads exactly the
 * mesh it would have made, and is every other copy refused?
 *
 *   node tests/verify-heartbake-pure.js
 *
 * WHY. Meshing the heart's muscle and chambers was 78% of the launch — 6.3 s of
 * main thread on the owner's laptop at an iPad's CPU pace, before the home
 * screen could appear. scripts/heart-bake.js now meshes them during the build
 * with heart3d.js's own code, apex-patch embeds the result, build-pwa moves it
 * into a file of its own, and create() loads it instead of meshing.
 *
 * WHAT IS CLAIMED, AND HELD HERE:
 *   · the copy is the mesh, value for value — not an approximation of it;
 *   · a copy made from other code, on another grid, cut short or padded, or
 *     not a mesh at all (a sign-in page) is refused, and the heart meshes
 *     itself as before;
 *   · the split build moves the copy out of app.js under a name derived from
 *     its bytes, so the service worker's cache can never serve an old one;
 *   · the loader hands it over before app.js runs, and nothing about it can
 *     stop a launch: a missing file, a failed fetch or a fetch that never
 *     answers all leave the app starting as before.
 * Everything under test is the shipped code — heart3d.js run as is, the bake
 * module required, build-pwa's function and loader lines lifted out of its
 * source. Nothing is a copy.
 *
 * NOT HERE: whether the built app really draws the baked copy. That needs the
 * licensed build and a browser; tests/verify-heroart.js asks the hero heart
 * which mesh it used.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const HEART = fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8');
const load = src => { const box = {}; new Function('window', src)(box); return box; };
const box = load(HEART);
const M = box.Heart3D && box.Heart3D.mesh;
const { bake, keyOf } = require('../scripts/heart-bake.js');

const FIELDS = ['positions', 'normals', 'weights', 'color', 'extra', 'indices'];
/* Every value of every field of both surfaces, compared as numbers. */
const differences = (a, b) => {
  const out = [];
  for (const s of ['outer', 'cav']) for (const f of FIELDS) {
    const x = a && a[s] && a[s][f], y = b && b[s] && b[s][f];
    if (!x || !y || x.length !== y.length) { out.push(`${s}.${f} length`); continue; }
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { out.push(`${s}.${f}[${i}]`); break; }
  }
  return out;
};

head('the mesh is there to bake');
ok('heart3d.js exposes its mesh builder', !!M && typeof M.build === 'function' && typeof M.pack === 'function');
const built = M.build(M.RES, M.LO, M.HI);
/* Vacuity guard: an empty mesh packs, unpacks and compares equal to itself. */
ok('and it meshes two real surfaces', built.outer.positions.length / 3 > 5000 && built.cav.positions.length / 3 > 5000,
   `${built.outer.positions.length / 3} + ${built.cav.positions.length / 3} vertices`);

head('the packed copy is the mesh, value for value');
const KEY = keyOf(HEART);
const buf = M.pack(built, KEY, M.RES, M.LO, M.HI);
const back = M.unpack(buf, KEY, M.RES, M.LO, M.HI);
const diff = differences(built, back);
ok('every value of both surfaces survives packing', !!back && diff.length === 0, diff.slice(0, 3).join(', ') || 'none differ');

head('any other copy is refused');
ok('one baked from other code (another key)', M.unpack(buf, keyOf(HEART + ' '), M.RES, M.LO, M.HI) === null);
/* Not "presented with no key": that is refused by the key comparison alone,
   which a mutation removing the missing-key guard showed (33/0). The guard's
   own case is a copy baked with no key and asked for with none. */
ok('one baked with no key, asked for with none', M.unpack(M.pack(built, '', M.RES, M.LO, M.HI), undefined, M.RES, M.LO, M.HI) === null);
ok('one meshed on another grid', M.unpack(buf, KEY, [M.RES[0], M.RES[1], M.RES[2] + 1], M.LO, M.HI) === null);
ok('one over other bounds', M.unpack(buf, KEY, M.RES, [M.LO[0] - 0.1, M.LO[1], M.LO[2]], M.HI) === null);
/* A throw is reported as one rather than crashing the suite. */
const refuses = b => { try { return M.unpack(b, KEY, M.RES, M.LO, M.HI) === null ? 'refused' : 'accepted'; } catch (e) { return 'threw: ' + e.message.slice(0, 50); } };
const short = refuses(buf.slice(0, buf.byteLength - 4));
ok('one cut short', short === 'refused', short);
const padded = new Uint8Array(buf.byteLength + 4); padded.set(new Uint8Array(buf));
const spare = refuses(padded.buffer);
ok('one with bytes to spare', spare === 'refused', spare);
const page = Buffer.from('<!doctype html><title>Sign in</title>' + ' '.repeat(80));
ok('a sign-in page served in its place', M.unpack(new Uint8Array(page).buffer, KEY, M.RES, M.LO, M.HI) === null);

head('the build bakes it with the shipped code');
const baked = bake(HEART);
ok('the bake is keyed to heart3d.js as it is', baked.key === KEY && /^[0-9a-f]{16}$/.test(baked.key), baked.key);
ok('and a one-character change to the code changes the key', keyOf(HEART.replace('sdCapsule(', 'sdCapsule (')) !== KEY);
const bakedBuf = new Uint8Array(Buffer.from(baked.b64, 'base64')).buffer;
ok('what it embeds unpacks to the mesh, value for value',
   differences(built, M.unpack(bakedBuf, baked.key, M.RES, M.LO, M.HI)).length === 0);
const apex = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'apex-patch.js'), 'utf8'));
ok('apex-patch bakes with this module, from the heart3d.js it embeds',
   /require\('\.\/heart-bake\.js'\)\.bake\(heart3d\)/.test(apex));
ok('and embeds the key and the copy beside the code',
   apex.includes("window.HEART3D_MESH_KEY='${bakedHeart.key}';") && apex.includes("window.HEART3D_MESH_B64='${bakedHeart.b64}';"));

head('create() takes the copy only when it is the one for this code');
/* take() is what create() calls: it reads the page's globals. */
const page1 = load(HEART);
page1.HEART3D_MESH_KEY = baked.key; page1.HEART3D_MESH_B64 = baked.b64;
const took = page1.Heart3D.mesh.take(M.RES, M.LO, M.HI);
ok('the single file\'s base64 is decoded and used', !!took && differences(built, took).length === 0);
ok('and kept, so a second heart on the page does not decode it again',
   page1.HEART3D_MESH instanceof ArrayBuffer && page1.HEART3D_MESH.byteLength === baked.bytes);
const page2 = load(HEART);
page2.HEART3D_MESH_KEY = keyOf('some other heart3d.js'); page2.HEART3D_MESH_B64 = baked.b64;
ok('a copy with another key is left alone, and the heart meshes itself', page2.Heart3D.mesh.take(M.RES, M.LO, M.HI) === null);
const bad = buf.slice(0); new Uint32Array(bad, 56, 1)[0] = 1e7;   // a header claiming ten million vertices
const page4 = load(HEART);
page4.HEART3D_MESH_KEY = KEY; page4.HEART3D_MESH = bad;
let took4; try { took4 = page4.Heart3D.mesh.take(M.RES, M.LO, M.HI); } catch (e) { took4 = 'threw: ' + e.message; }
ok('a copy whose header claims more than it holds is refused, not thrown', took4 === null, String(took4).slice(0, 60));
const page3 = load(HEART);
page3.HEART3D_MESH_KEY = baked.key; page3.HEART3D_MESH = bakedBuf;
ok('the split build\'s fetched ArrayBuffer is used as it is', !!page3.Heart3D.mesh.take(M.RES, M.LO, M.HI));

head('the split build moves it out of app.js, named by its bytes');
const PWA = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8');
const lift = (src, name) => {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
  }
  return end > 0 ? new Function('crypto', 'Buffer', `${src.slice(at, end)}\nreturn ${name};`)(require('crypto'), Buffer) : null;
};
const split = lift(PWA, 'splitHeartMesh');
ok('splitHeartMesh was lifted out of build-pwa.js', typeof split === 'function');
const appCode = `var a=1;\nwindow.HEART3D_MESH_KEY='${baked.key}';\nwindow.HEART3D_MESH_B64='${baked.b64}';\nvar b=2;\n`;
const cut = split ? split(appCode) : null;
ok('the copy leaves app.js, and the key stays with the code',
   !!cut && !cut.code.includes(baked.b64) && cut.code.includes(`HEART3D_MESH_KEY='${baked.key}'`) && /HEART3D_MESH_B64=null;/.test(cut.code));
ok('what it writes is the copy\'s bytes', !!cut && Buffer.compare(cut.bin, Buffer.from(baked.b64, 'base64')) === 0);
ok('under content/, named by those bytes', !!cut && /^content\/heart-mesh-[0-9a-f]{12}\.bin$/.test(cut.name), cut && cut.name);
const other = split ? split(appCode.replace(baked.b64, Buffer.from('another mesh entirely').toString('base64'))) : null;
ok('so a different mesh gets a different name', !!other && !!cut && other.name !== cut.name, other && other.name);
ok('app code with no copy is left alone', split ? split('var a=1;') === null : false);
let threw = false; try { split(appCode + appCode); } catch (_) { threw = true; }
ok('two copies stop the build rather than shipping one of them', threw);

head('the loader hands it over before app.js, and never holds a launch');
const LOADER = (() => {
  const i = PWA.indexOf('const LOADER = `<script>'), j = PWA.indexOf('</script>`;', i);
  return i < 0 || j < 0 ? '' : PWA.slice(i, j).replace(/\\`/g, '`').replace(/\\\$/g, '$');
})();
const start = LOADER.indexOf("var HEART_MESH_URL = '__HEART_MESH__';");
const fetchEnd = LOADER.indexOf('\n    : null;', start);   // the ternary's own line, not the one inside the callback
const waitLine = (LOADER.match(/\n\s*if\(heartMesh\) await Promise\.race\(\[heartMesh, new Promise\(function\(r\)\{ setTimeout\(r, 5000\); \}\)\]\);/) || [''])[0];
ok('the loader fetches the mesh from a placeholder the build fills', start > -1 && fetchEnd > start && waitLine !== '');
ok('and waits for it before app.js is appended',
   waitLine !== '' && LOADER.indexOf(waitLine) < LOADER.indexOf("s.src = 'app.js'") && LOADER.indexOf(waitLine) > start);
/* Run those lines, as the build fills them, against stand-ins. */
const run = async (url, fetch, timer) => {
  const win = {};
  const body = LOADER.slice(start, fetchEnd + '\n    : null;'.length).replace("'__HEART_MESH__'", JSON.stringify(url)) + waitLine;
  await new Function('window', 'fetch', 'setTimeout', `return (async function(){ ${body} })();`)(win, fetch, timer || setTimeout);
  return win;
};
const ab = new ArrayBuffer(8);

(async () => {
  const w1 = await run('content/heart-mesh-abc.bin', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(ab) }));
  ok('a mesh that arrives is on window.HEART3D_MESH when app.js runs', w1.HEART3D_MESH === ab);
  const w2 = await run('content/heart-mesh-abc.bin', () => Promise.resolve({ ok: false, status: 404 }));
  ok('a 404 hands over nothing, and the launch goes on', w2.HEART3D_MESH === undefined);
  const w3 = await run('content/heart-mesh-abc.bin', () => Promise.reject(new TypeError('offline')));
  ok('a failed fetch hands over nothing, and the launch goes on', w3.HEART3D_MESH === undefined);
  let waited = null;
  const w4 = await run('content/heart-mesh-abc.bin', () => new Promise(() => {}), (f, ms) => { waited = ms; f(); });
  ok('a fetch that never answers holds the launch five seconds at most', w4.HEART3D_MESH === undefined && waited === 5000, `waited ${waited} ms`);
  let asked = 0;
  const w5 = await run('', () => { asked++; return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(ab) }); });
  ok('a build with no mesh fetches nothing', asked === 0 && w5.HEART3D_MESH === undefined, `${asked} fetches`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
