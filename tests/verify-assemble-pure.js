#!/usr/bin/env node
/*
 * The app assembles from app/systole.html as the chain builds it.
 *
 *   node tests/verify-assemble-pure.js
 *
 * Pure Node. scripts/assemble-app.js is step 2 of retiring the patch chain: it
 * fills the frozen shell's slots from the export, the reference corpus and the
 * repository, the places the chain gets them, and stamps the result as
 * build.js does. Only the owner's machine can compare it with a real chain
 * build (--compare). This holds what can be held without the export:
 *
 *   - ALL_Q is what keys-patch and then flags-patch write, checked against
 *     those two scripts RUN AS THE CHAIN RUNS THEM on a synthetic export, not
 *     against the functions the assembler calls;
 *   - IMGS is the export's line verbatim, HEART_MESH is heart-bake's;
 *   - a synthetic chain output, cut by app-slots and assembled back from the
 *     producers, is the same bytes with the same stamp;
 *   - the shell's old stamp is dropped and exactly one new one goes in, written
 *     as build.js writes it (its template is read from build.js, so the copy in
 *     scripts/stamp.js cannot drift unnoticed);
 *   - --compare says which part differs, by name, never the text.
 *
 * The synthetic bank is invented: question ids and answer letters from
 * keys-patch's CORRECTIONS and flags-patch's FLAGS, which are already in this
 * repository, and placeholder text. No question text exists here.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const S = p => path.join(ROOT, 'scripts', p);
const A = require(S('assemble-app.js'));
const Slots = require(S('app-slots.js'));
const { CORRECTIONS } = require(S('keys-patch.js'));
const { FLAGS, CME_BOILERPLATE } = require(S('flags-patch.js'));
const { bake } = require(S('heart-bake.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-'));
const LETTERS = 'ABCDEFGH';

/* ── a synthetic export ──────────────────────────────────────────────────── */
const byId = new Map();
const q = id => byId.get(id) || (byId.set(id, { id, s: 'Invented stem for ' + id + '.', ci: 0,
  o: [...LETTERS].map(L => ({ t: 'Invented option ' + L })), ex: '', figs: [] }), byId.get(id));
for (const c of CORRECTIONS) q(c.id).ci = LETTERS.indexOf(c.was);
for (const f of FLAGS) { const x = q(f.id); if (f.wantEx != null) x.ex = f.wantEx; }
q('FIXTURE_1').ex = 'Invented teaching. ' + CME_BOILERPLATE + ' and so on.';
const BANK = [...byId.values()];
/* Spaced as JSON.stringify never writes it, so a producer that re-serialized
   the figures instead of copying them would be caught. */
const IMGS = '{ "FIXTURE_1": [ "data:image/webp;base64,' + Buffer.alloc(30, 1).toString('base64') + '" ] }';
const EXPORT = `<!doctype html><html><head><title>fixture</title></head><body>\n<script>\nconst ALL_Q=${JSON.stringify(BANK)};\nconst IMGS=${IMGS};\nfunction render(){}\n</script></body></html>\n`;
const exportFile = path.join(dir, 'export.html');
fs.writeFileSync(exportFile, EXPORT);

/* a reference corpus: one note of 40+ words, citing one figure */
const refs = path.join(dir, 'refs'), imgs = path.join(dir, 'refs-images');
fs.mkdirSync(refs); fs.mkdirSync(path.join(imgs, 'u'), { recursive: true });
fs.writeFileSync(path.join(refs, 'fixture.md'), '---\ntitle: Fixture chapter\n---\n\n## Section one\n\n' +
  'invented words '.repeat(30) + '\n\n![a figure](refimg://u/fig.png)\n');
fs.writeFileSync(path.join(imgs, 'u', 'fig.png'), Buffer.from('89504e470d0a1a0a' + '00'.repeat(40), 'hex'));

const resolve = A.producers({ exportHtml: EXPORT, refsDir: refs, imagesDir: imgs });

head('each payload is what the chain writes');
{
  /* keys-patch then flags-patch, as build.js runs them: separate processes on files. */
  const mid = path.join(dir, 'keys.html'), out = path.join(dir, 'flags.html');
  const k = spawnSync(process.execPath, [S('keys-patch.js'), exportFile, mid], { encoding: 'utf8' });
  const f = spawnSync(process.execPath, [S('flags-patch.js'), mid, out], { encoding: 'utf8' });
  ok('keys-patch and flags-patch accept the synthetic export', k.status === 0 && f.status === 0, (k.stderr + f.stderr).trim().slice(0, 120));
  const chainBank = (/\nconst ALL_Q=(\[[\s\S]*?\]);\n/.exec(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '') || [])[1];
  ok('ALL_Q is the bank those two steps write, byte for byte', !!chainBank && resolve('payload', 'ALL_Q') === chainBank);
  const fixed = JSON.parse(resolve('payload', 'ALL_Q'));
  ok('and it carries the corrections (one key moved, the boilerplate gone)',
     fixed.find(x => x.id === CORRECTIONS[0].id).ci === LETTERS.indexOf(CORRECTIONS[0].now) &&
     !fixed.find(x => x.id === 'FIXTURE_1').ex.includes(CME_BOILERPLATE));
  ok('IMGS is the export’s line, verbatim', resolve('payload', 'IMGS') === IMGS);
  ok('HEART_MESH is heart-bake over src/core/heart3d.js',
     resolve('payload', 'HEART_MESH') === bake(fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8')).b64);
  const seed = JSON.parse(resolve('payload', 'REF_SEED'));
  ok('REF_SEED is the corpus as notes', seed.length === 1 && /Fixture chapter — Section one/.test(seed[0].title));
  const ri = JSON.parse(resolve('payload', 'REF_IMGS'));
  ok('REF_IMGS is the cited figure, as a data URL', Object.keys(ri).join() === 'u/fig.png' && /^data:image\/png;base64,/.test(ri['u/fig.png']));
  ok('an unknown payload has no producer', resolve('payload', 'NOPE') === undefined);
}

head('a chain output, cut and assembled back, is the same bytes');
const SRC = 'src/core/fsrs.js', srcText = fs.readFileSync(path.join(ROOT, SRC), 'utf8');
const CHAIN_UNSTAMPED = [
  '<!doctype html><html><head><title>fixture</title></head><body><script>',
  `const ALL_Q=${resolve('payload', 'ALL_Q')};`,
  `const IMGS=${IMGS};`,
  `let REF=/*REF_SEED_START*/${resolve('payload', 'REF_SEED')}/*REF_SEED_END*/;`,
  `let REF_IMGS=/*REF_IMGS_START*/${resolve('payload', 'REF_IMGS')}/*REF_IMGS_END*/;`,
  srcText,
  `window.HEART3D_MESH_B64='${resolve('payload', 'HEART_MESH')}';`,
  '</script></body></html>', ''].join('\n');
const { stampBuffer } = require(S('stamp.js'));
const chainStamped = stampBuffer(Buffer.from(CHAIN_UNSTAMPED), 'abc123def456').out;
const SOURCES = { srcs: { [SRC]: srcText }, assets: {} };
const shell = Slots.cut(chainStamped.toString('utf8'), SOURCES).shell;
{
  ok('the frozen shell carries the chain’s stamp, as the real one does', (shell.match(/systole-build/g) || []).length === 1);
  const r = A.assembleApp({ shell, resolve, commit: 'abc123def456' });
  ok('assembled, unstamped, it is the chain output unstamped', r.unstamped.equals(Buffer.from(CHAIN_UNSTAMPED)));
  ok('and stamped with the same commit, the same stamped bytes', r.out.equals(chainStamped));
  ok('exactly one stamp: the shell’s old one is gone', (r.out.toString().match(/systole-build/g) || []).length === 1);
  ok('its digest is over the unstamped bytes', r.digest === crypto.createHash('sha256').update(r.unstamped).digest('hex').slice(0, 16));
  ok('a shell with two stamps is refused', (() => { try { A.assembleApp({ shell: shell.replace('</head>', '<!-- systole-build 0123456789abcdef commit abc -->\n</head>'), resolve, commit: 'x' }); return false; } catch (e) { return /2 build stamps/.test(e.message); } })());
}

head('the stamp is build.js’s');
{
  const tmpl = src => (src.match(/Buffer\.from\(`(<!-- systole-build [^`]*)`\)/) || [])[1];
  const fromBuild = tmpl(fs.readFileSync(S('build.js'), 'utf8')), fromStamp = tmpl(fs.readFileSync(S('stamp.js'), 'utf8'));
  ok('build.js’s stamp template was found', !!fromBuild, String(fromBuild));
  ok('scripts/stamp.js writes the same template', !!fromBuild && fromBuild === fromStamp, String(fromStamp));
}

head('--compare names the part that differs, never its text');
{
  const r = A.assembleApp({ shell, resolve, commit: 'abc123def456' });
  const same = A.compareToChain(chainStamped, r.unstamped, SOURCES);
  ok('the same build compares the same', same.same && same.parts.length === 0);
  const bank = JSON.parse(resolve('payload', 'ALL_Q')); bank[0].ci = (bank[0].ci + 1) % 4;
  const other = Buffer.from(chainStamped.toString('utf8').replace(resolve('payload', 'ALL_Q'), JSON.stringify(bank)));
  const diff = A.compareToChain(other, r.unstamped, SOURCES);
  const differs = diff.parts.filter(p => !p.same).map(p => p.part);
  ok('one answer key moved: ALL_Q differs, and nothing else', !diff.same && differs.join() === 'ALL_Q', differs.join());
  ok('and the report holds names only', !JSON.stringify(diff).includes('Invented'));
}

head('the command line');
{
  const shellFile = path.join(dir, 'shell.html'), outFile = path.join(dir, 'out.html'), chainFile = path.join(dir, 'chain.html');
  fs.writeFileSync(shellFile, shell); fs.writeFileSync(chainFile, chainStamped);
  const env = { ...process.env, SYSTOLE_REFS_DIR: refs, SYSTOLE_REF_IMAGES_DIR: imgs };
  const run = extra => spawnSync(process.execPath, [S('assemble-app.js'), exportFile, '--shell', shellFile, '--out', outFile, ...extra], { encoding: 'utf8', env });
  const plain = run([]);
  ok('it writes a stamped file', plain.status === 0 && fs.existsSync(outFile) && /systole-build/.test(fs.readFileSync(outFile, 'utf8')), (plain.stdout + plain.stderr).trim().slice(0, 120));
  /* Both reference scripts follow SYSTOLE_REFS_DIR. When only ref-images-patch
     did, the CLI paired content/refs with the fixture's figures: green where
     content/refs is absent, red on the machine that has it. */
  ok('and its references are the fixture corpus, not content/refs', plain.status === 0 && fs.readFileSync(outFile, 'utf8').includes('Fixture chapter'), (plain.stdout + plain.stderr).trim().slice(0, 120));
  /* The export found the way build.js finds it: the owner's first run was
     refused because this read a variable build.js does not. */
  const viaEnv = spawnSync(process.execPath, [S('assemble-app.js'), '--shell', shellFile, '--out', outFile], { encoding: 'utf8', env: { ...env, SYSTOLE_SRC: exportFile } });
  ok('it finds the export through SYSTOLE_SRC, as build.js does', viaEnv.status === 0, (viaEnv.stdout + viaEnv.stderr).trim().slice(0, 120));
  const buildVar = (fs.readFileSync(S('build.js'), 'utf8').match(/process\.env\.(SYSTOLE_\w+)\) return path\.resolve/) || [])[1];
  ok('and that is the variable build.js reads', buildVar === 'SYSTOLE_SRC', String(buildVar));
  const none = spawnSync(process.execPath, [S('assemble-app.js'), path.join(dir, 'missing.html')], { encoding: 'utf8' });
  ok('an export that is not there exits 2', none.status === 2, String(none.status));
}

head('a flagged question that now ships a figure stops the build');
{
  /* flags-patch records wantFigs: 0 for questions flagged for a missing
     figure. If the export starts shipping one, the flag is stale and the
     step must refuse. The single-file bank says how many through img, not
     figs, so that is the case that matters. */
  const { applyContentFlags } = require(S('flags-patch.js'));
  const f = FLAGS.find(x => x.wantFigs === 0);
  const bank = () => JSON.parse(JSON.stringify(BANK)).map(x => { delete x.figs; return x; });
  const tries = mutate => { const b = bank(); mutate(b.find(x => x.id === f.id)); try { applyContentFlags(b); return ''; } catch (e) { return e.message; } };
  ok('a flagged question declaring a figure through img is refused', /now ships 1 figure/.test(tries(x => { x.img = 1; })),
     tries(x => { x.img = 1; }).split('\n')[0] || 'accepted');
  ok('and one with img 0 is not', tries(x => { x.img = 0; }) === '', tries(x => { x.img = 0; }).split('\n')[0]);
  ok('figs still counts where a bank carries it', /now ships 1 figure/.test(tries(x => { x.figs = ['a.webp']; })));
}

head('a note in a subfolder is seeded with its figures');
{
  /* refs-patch walks subfolders; ref-images-patch read only the top level,
     so a figure cited from a subfolder's note was never embedded. */
  const { buildRefImages } = require(S('ref-images-patch.js'));
  const { buildRefSeed } = require(S('refs-patch.js'));
  const r2 = path.join(dir, 'refs2'), i2 = path.join(dir, 'refs2-images');
  fs.mkdirSync(path.join(r2, 'unit'), { recursive: true }); fs.mkdirSync(i2);
  fs.writeFileSync(path.join(r2, 'unit', 'deep.md'), '---\ntitle: Deep chapter\n---\n\n## Section\n\n' +
    'invented words '.repeat(30) + '\n\n![deep](refimg://deep.png)\n');
  fs.writeFileSync(path.join(i2, 'deep.png'), Buffer.from('89504e470d0a1a0a' + '00'.repeat(40), 'hex'));
  const seeded = buildRefSeed(r2).notes.length;
  let keys = [];
  try { keys = [...buildRefImages(r2, i2).keys]; } catch (e) { keys = ['threw: ' + e.message]; }
  ok('the note is seeded', seeded === 1, seeded + ' note(s)');
  ok('and its figure is embedded with it', keys.length === 1 && keys[0] === 'deep.png', keys.join(', ') || 'no figures');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
