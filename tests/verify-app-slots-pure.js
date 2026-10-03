#!/usr/bin/env node
/*
 * The chain's output cuts into an app and its slots losslessly, and the app
 * that comes out carries none of what was cut.
 *
 *   node tests/verify-app-slots-pure.js
 *
 * Pure Node. scripts/app-slots.js and scripts/freeze-shell.js are step 1 of
 * retiring the patch chain: the owner runs freeze-shell on the real build and
 * commits app/systole.html. Nothing here can see the real build, which is
 * licensed, so the whole path runs on a synthetic one that has every payload
 * the real one has (bank, figures, reference seed and figures, the heart's
 * mesh), one real src/ module and one real font from assets/, so the
 * repository side of the cut is the real one.
 *
 * WHAT IT HOLDS: the round trip is byte-identical; each payload leaves; the
 * src and asset slots are filled from the repository as it is NOW (so src/
 * stays the source of truth); every malformed input is refused; the leak scan
 * finds what the cut missed, by count and never by text; and freeze-shell
 * writes app/ only when everything holds.
 *
 * NOT CLAIMED: that the real build cuts cleanly. Only freeze-shell on the
 * owner's machine can show that, and it says so in its own report.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const Slots = require(path.join(ROOT, 'scripts', 'app-slots.js'));
const { freeze } = require(path.join(ROOT, 'scripts', 'freeze-shell.js'));

const SRC = 'src/core/fsrs.js', ASSET = 'assets/fonts/DMSerifDisplay.woff2';
const srcText = fs.readFileSync(path.join(ROOT, SRC), 'utf8');
const fontB64 = fs.readFileSync(path.join(ROOT, ASSET)).toString('base64');
const blob = (seed, n) => Buffer.alloc(n, seed).toString('base64');

/* Invented, and long enough (≥ 40) for the scan to look for them. */
const STEM = 'A fixture patient invented for this suite presents with a made-up complaint.';
const NOTE = 'A fixture reference sentence that no book contains, written only for this test.';
const BANK = JSON.stringify([{ id: 'q1', stem: STEM, options: ['Option one is invented', 'Option two', 'Option three', 'Option four'], answer: 1 }]);
const FIGS = JSON.stringify({ q1: ['data:image/webp;base64,' + blob(7, 3000)] });
const SEED = JSON.stringify([{ title: 'Fixture note', body: NOTE }]);
const RIMG = JSON.stringify({ 'hf/fig1.jpg': 'data:image/jpeg;base64,' + blob(9, 3000) });
const MESH = blob(3, 4000);

const BUILD = [
  '<!doctype html><html><head><style>',
  `@font-face{font-family:'DM Serif Display';src:url(data:font/woff2;base64,${fontB64}) format('woff2')}`,
  '</style></head><body><div id="app"></div>',
  '<script>',
  `const ALL_Q=${BANK};`,
  `const IMGS=${FIGS};`,
  `let REF=/*REF_SEED_START*/${SEED}/*REF_SEED_END*/;`,
  `let REF_IMGS=/*REF_IMGS_START*/${RIMG}/*REF_IMGS_END*/;`,
  'function render(){ return ALL_Q.length; }',
  srcText,
  "window.HEART3D_MESH_KEY='k1';",
  `window.HEART3D_MESH_B64='${MESH}';`,
  '</script></body></html>',
  '',
].join('\n');

const SOURCES = { srcs: { [SRC]: srcText }, assets: { [ASSET]: fontB64 } };
const memResolver = (payloads, over = {}) => (kind, name) =>
  kind === 'payload' ? payloads[name] : kind === 'src' ? (over[name] ?? SOURCES.srcs[name]) : kind === 'asset' ? SOURCES.assets[name] : undefined;

head('the cut, and back');
const { shell, payloads, report } = Slots.cut(BUILD, SOURCES);
{
  ok('the shell is much smaller than the build', shell.length < BUILD.length / 3, `${shell.length} of ${BUILD.length}`);
  ok('every payload left as a slot', ['ALL_Q', 'IMGS', 'REF_SEED', 'REF_IMGS', 'HEART_MESH'].every(n => shell.includes(Slots.token('payload', n))),
     report.slots.filter(s => s.kind === 'payload').map(s => s.name).join(', '));
  ok('the src module left as a slot', shell.includes(Slots.token('src', SRC)) && !shell.includes(srcText));
  ok('the font left as a slot', shell.includes(Slots.token('asset', ASSET)) && !shell.includes(fontB64));
  ok('the code around each slot is kept', shell.includes('\nconst ALL_Q=' + Slots.token('payload', 'ALL_Q') + ';\n') &&
     shell.includes("window.HEART3D_MESH_B64='" + Slots.token('payload', 'HEART_MESH') + "';") && shell.includes('function render(){'));
  ok('the payloads are exactly what was cut', payloads.ALL_Q === BANK && payloads.IMGS === FIGS && payloads.REF_SEED === SEED && payloads.REF_IMGS === RIMG && payloads.HEART_MESH === MESH);
  const back = Slots.assemble(shell, memResolver(payloads));
  ok('assembling gives the build back, byte for byte', back === BUILD, back === BUILD ? '' : `lengths ${back.length} vs ${BUILD.length}`);
}

head('the shell carries none of what was cut');
{
  for (const [label, text] of [['the question stem', STEM], ['the reference sentence', NOTE], ['the figure base64', blob(7, 3000)],
                               ['the reference figure base64', blob(9, 3000)], ['the mesh', MESH]])
    ok(`no ${label}`, !shell.includes(text));
  const scan = Slots.leakScan(shell, payloads);
  ok('the leak scan finds nothing in a clean shell', scan.questionText === 0 && scan.refText === 0 && scan.base64Runs === 0, JSON.stringify(scan));
}

head('src/ stays the source of truth');
{
  const edited = srcText.replace('use strict', 'use strict"; /* edited after the freeze */ "');
  const out = Slots.assemble(shell, memResolver(payloads, { [SRC]: edited }));
  ok('assembly reads the module as it is now, not as it was cut', out.includes('edited after the freeze') && !out.includes(srcText));
  const drifted = BUILD.replace(srcText, srcText.replace('use strict', 'use  strict'));
  const r = Slots.cut(drifted, SOURCES);
  ok('a module edited inside the build stays inline, and is reported', r.report.inline.src.includes(SRC) && !r.shell.includes(Slots.token('src', SRC)), r.report.inline.src.join(', '));
}

head('malformed input is refused, never guessed at');
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
ok('a build with no question bank', throws(() => Slots.cut(BUILD.replace('\nconst ALL_Q=', '\nconst NOT_Q='), SOURCES), /ALL_Q\] expected exactly 1 match, found 0/));
ok('a build with the bank twice', throws(() => Slots.cut(BUILD.replace(`const IMGS=`, `const ALL_Q=${BANK};\nconst IMGS=`), SOURCES), /ALL_Q\] expected exactly 1 match, found 2/));
ok('a build with no reference seed', throws(() => Slots.cut(BUILD.replace('REF_SEED_START', 'REF_SEED_GONE'), SOURCES), /REF_SEED/));
ok('a build with no reference figures is fine (no note cites one)', !throws(() => Slots.cut(BUILD.replace('REF_IMGS_START', 'REF_IMGS_GONE'), SOURCES), /./));
ok('a build that already has slot tokens', throws(() => Slots.cut(shell, SOURCES), /already contains a slot token/));
ok('assembly with a payload missing', throws(() => Slots.assemble(shell, memResolver({ ...payloads, IMGS: undefined })), /payload:IMGS has nothing to fill it/));
ok('assembly with a slot twice', throws(() => Slots.assemble(shell + Slots.token('payload', 'ALL_Q'), memResolver(payloads)), /more than once/));
ok('assembly with an unknown kind', throws(() => Slots.assemble(shell + Slots.token('other', 'x'), memResolver(payloads)), /other:x has nothing to fill it/));

head('the leak scan finds what the cut missed, by count and never by text');
{
  const leaky = shell.replace('function render(){', `var copied = ${JSON.stringify(STEM)};\nvar note = ${JSON.stringify(NOTE)};\nvar img = '${blob(5, 2400)}';\nfunction render(){`);
  const scan = Slots.leakScan(leaky, payloads);
  ok('a question stem copied into the code is counted', scan.questionText === 1, String(scan.questionText));
  ok('a reference sentence copied into the code is counted', scan.refText === 1, String(scan.refText));
  ok('a stray base64 blob is counted', scan.base64Runs === 1, String(scan.base64Runs));
  ok('and the report carries offsets, not text', !JSON.stringify(scan).includes('fixture'), JSON.stringify(scan.offsets));
}

head('freeze-shell writes app/ only when every check holds');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-'));
  const root = path.join(dir, 'repo');
  for (const rel of [SRC, ASSET, 'scripts/leak-guard.js']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  const run = (html, tag) => {
    const input = path.join(dir, tag + '.html');
    fs.writeFileSync(input, html);
    const appDir = path.join(dir, tag + '-app'), payloadDir = path.join(dir, tag + '-payload');
    const lines = [];
    const r = freeze({ input, appDir, payloadDir, root, log: l => lines.push(l) });
    return { r, appDir, payloadDir, out: lines.join('\n') };
  };
  const good = run(BUILD, 'good');
  const frozen = path.join(good.appDir, 'systole.html');
  ok('a clean build is frozen', good.r.ok && fs.existsSync(frozen), good.r.failures.join(' | '));
  ok('the frozen shell is the cut shell', fs.existsSync(frozen) && fs.readFileSync(frozen, 'utf8') === shell);
  const meshFile = path.join(good.payloadDir, 'HEART_MESH.txt');
  ok('the payloads are stored beside it', fs.existsSync(path.join(good.payloadDir, 'ALL_Q.txt')) && fs.existsSync(meshFile) && fs.readFileSync(meshFile, 'utf8') === MESH);
  ok('its report says the round trip held', /round trip byte-identical/.test(good.out));
  ok('and quotes nothing of the bank', !good.out.includes(STEM) && !good.out.includes('Option one is invented'));

  const bad = run(BUILD.replace('function render(){', `var copied = ${JSON.stringify(STEM)};\nfunction render(){`), 'bad');
  ok('a build whose code carries a question stem is not frozen', !bad.r.ok && !fs.existsSync(path.join(bad.appDir, 'systole.html')), bad.r.failures.join(' | '));
  ok('it is kept for a look where git ignores it', fs.existsSync(path.join(bad.payloadDir, 'shell.rejected.html')));

  const big = run(BUILD.replace('function render(){', `/* ${'x'.repeat(1100000)} */\nfunction render(){`), 'big');
  ok('a shell leak-guard would refuse (over 1 MB) is not frozen', !big.r.ok && /leak-guard refuses/.test(big.r.failures.join(' ')), big.r.failures.join(' | ').slice(0, 120));

  /* A cut that loses a byte must not be frozen: the round trip is what says so.
     Without this, freeze's own byte comparison could be removed and nothing
     here would notice, because the real cut is lossless. */
  const lossy = { ...Slots, cut: (h, s) => { const c = Slots.cut(h, s); return { ...c, shell: c.shell.replace('function render(){ ', 'function render(){') }; } };
  const lines = [], input = path.join(dir, 'lossy.html'), appDir = path.join(dir, 'lossy-app');
  fs.writeFileSync(input, BUILD);
  const lr = freeze({ input, appDir, payloadDir: path.join(dir, 'lossy-payload'), root, log: l => lines.push(l), slots: lossy });
  ok('a cut that loses a byte is not frozen', !lr.ok && !fs.existsSync(path.join(appDir, 'systole.html')) && /does not give back the input/.test(lr.failures.join(' ')), lr.failures.join(' | '));

  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'freeze-shell.js'), path.join(dir, 'missing.html')], { encoding: 'utf8' });
  ok('the command line refuses a build that is not there', cli.status === 2, String(cli.status));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
