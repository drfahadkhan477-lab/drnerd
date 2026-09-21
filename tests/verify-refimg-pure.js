#!/usr/bin/env node
/*
 * A corpus with no pictures in it must still build.
 *
 *   node tests/verify-refimg-pure.js
 *
 * No browser, no build, no licensed export — the two patch scripts are run
 * against a stand-in whose only content is the anchors they look for.
 *
 * WHAT BROKE. ref-images used to bail out early whenever content/refs cited
 * no refimg:// figures: copy the input through, exit 0, inject nothing. The
 * very next step, assets, anchors on the md() renderer that ref-images is the
 * one to inject, and patch() throws unless its anchor matches exactly once.
 * So a corpus without figures killed the build 63 steps in with
 *
 *   [render: a cited figure may come from the build or from an import]
 *   expected exactly 1 match, found 0
 *
 * which names neither the corpus nor the step that actually went missing. The
 * three worked examples in docs/reference-examples cite no figures, so this
 * was every first build anybody made from the documented starting point. It
 * survived because the owner's own corpus always had figures in it.
 *
 * AND IT WAS THE SMALLER HALF. That same renderer resolves figures imported
 * at RUNTIME — assets rewrites it to fall through to RefAssets — so skipping
 * it silently removed a feature that has nothing to do with whether the
 * build-time corpus happened to contain pictures. An empty REF_IMGS is the
 * honest representation of "no figures baked in"; an absent one is not.
 *
 * WHY THE ANCHORS ARE LIFTED, NOT COPIED. The stand-in is assembled from the
 * patch scripts' own `find` arguments, so it cannot drift away from what they
 * search for. If it ever does, patch() throws and this suite goes red saying
 * so — the fixture cannot rot quietly.
 *
 * AND WHY IT IS NOT READ THROUGH blankComments. Several anchors ARE comments
 * — `/* Headings before inline marks ... *\/` is part of the string being
 * searched for. Blanking would erase the thing under test. The usual hazard
 * (a scan reporting the paragraph that warns about a bug AS the bug) needs a
 * pattern hunt over prose; this is a structured lift of call arguments whose
 * correctness the scripts themselves then confirm by matching.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'refimg-'));

/* Every first template-literal argument to patch() — the strings each script
   requires to be present exactly once. */
function finds(file) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
  const out = [];
  const re = /patch\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1\s*,\s*`((?:\\.|[^\\`])*)`/g;
  let m;
  /* eslint-disable-next-line no-eval */
  while ((m = re.exec(src))) out.push(eval('`' + m[2] + '`'));
  return out;
}

const RI = finds('ref-images-patch.js');
const AS = finds('assets-patch.js');

head('the stand-in is assembled from what the scripts actually look for');
{
  /* VACUITY GUARD. A regex that matched nothing would leave an empty
     stand-in, every patch below would throw for the wrong reason, and a
     "found 0" failure would look exactly like the bug this defends. */
  ok('anchors were lifted from ref-images-patch.js', RI.length >= 5, `${RI.length} anchors`);
  ok('anchors were lifted from assets-patch.js', AS.length >= 5, `${AS.length} anchors`);
}

/* assets' two REF_IMGS anchors are injected BY ref-images, so the stand-in
   must not carry them itself — that is the dependency under test. */
const seeded = [...RI, ...AS.filter(s => !/REF_IMGS\[/.test(s))];
const STANDIN = '<html><script>\n' + [...new Set(seeded)].join('\n\n') + '\n</script></html>';

function corpus(name, note) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (note) fs.writeFileSync(path.join(dir, 'note.md'), note);
  return dir;
}
/* refs-patch rejects a section under 40 words, so the filler is not padding
   for its own sake — a thinner note would fail the step before this one. */
const NOTE = body => `---\ntitle: A note\ntags: x\nsource: y\n---\n\n## A section\n${body}\n${'word '.repeat(60)}\n`;

function run(script, inFile, outFile, env) {
  const inp = path.join(TMP, inFile), out = path.join(TMP, outFile);
  fs.writeFileSync(inp, STANDIN);
  fs.rmSync(out, { force: true });
  try {
    const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), inp, out],
      { env: { ...process.env, ...env }, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, stdout, out };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.stdout || e), out };
  }
}
function chain(name, refsDir, imgsDir) {
  const env = { SYSTOLE_REFS_DIR: refsDir, SYSTOLE_REF_IMAGES_DIR: imgsDir };
  const a = run('ref-images-patch.js', `${name}-in.html`, `${name}-mid.html`, env);
  if (!a.ok || !fs.existsSync(a.out)) return { first: a, mid: null, second: null };
  const midText = fs.readFileSync(a.out, 'utf8');
  const inp = path.join(TMP, `${name}-mid2.html`), out = path.join(TMP, `${name}-out.html`);
  fs.writeFileSync(inp, midText);
  let b;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'assets-patch.js'), inp, out],
      { env: { ...process.env, ...env }, stdio: 'pipe', encoding: 'utf8' });
    b = { ok: true };
  } catch (e) { b = { ok: false, err: String(e.stderr || e.stdout || e) }; }
  return { first: a, mid: midText, second: b };
}

const RENDERER = "const src=(typeof REF_IMGS!=='undefined'&&REF_IMGS[key])||''";

head('a corpus that cites no figures — the shipped worked examples');
{
  const r = chain('empty', corpus('empty-refs', NOTE('')), path.join(TMP, 'no-imgs'));
  ok('ref-images succeeds', r.first.ok, r.first.ok ? '' : r.first.err.split('\n')[0]);
  ok('and writes an output file rather than leaving the chain nothing to read',
     fs.existsSync(r.first.out));
  ok('the md() refimg renderer is injected even with nothing to embed',
     !!r.mid && r.mid.includes(RENDERER));
  ok('REF_IMGS ships empty rather than absent', !!r.mid && /let REF_IMGS = \/\*REF_IMGS_START\*\/\{\}/.test(r.mid));
  /* THE REGRESSION. This is the failure, verbatim, that a figure-free corpus
     produced 63 steps into the build. */
  ok('and assets — the very next step — finds its anchor',
     !!r.second && r.second.ok,
     r.second && !r.second.ok ? (r.second.err.match(/\[render:[^\]]+\][^\n]*/) || [''])[0] : '');
}

head('a corpus that does cite one — the path that always worked');
{
  const refs = corpus('full-refs', NOTE('![A caption](refimg://unit/a.png)'));
  const imgs = path.join(TMP, 'full-imgs', 'unit');
  fs.mkdirSync(imgs, { recursive: true });
  /* A real 1x1 PNG, so the embed runs on bytes an image decoder would accept
     rather than on a placeholder that only has to be non-empty. */
  fs.writeFileSync(path.join(imgs, 'a.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const r = chain('full', refs, path.join(TMP, 'full-imgs'));
  ok('ref-images succeeds', r.first.ok, r.first.ok ? '' : r.first.err.split('\n')[0]);
  ok('the renderer is injected here too', !!r.mid && r.mid.includes(RENDERER));
  /* NON-VACUITY. Without this, the section above would pass just as well
     against a script that had stopped embedding anything at all. */
  ok('and the cited figure is actually baked in as a data URL',
     !!r.mid && /data:image\/png;base64,iVBOR/.test(r.mid));
  ok('assets still finds its anchor', !!r.second && r.second.ok);
}

head('a corpus directory that is not there at all');
{
  /* refs-patch fails the build first in a real chain, so this is defence in
     depth — but the old code exited 0 here WITHOUT writing an output file,
     which would hand the next step a path that does not exist. */
  const r = chain('absent', path.join(TMP, 'does-not-exist'), path.join(TMP, 'nor-this'));
  ok('ref-images still succeeds', r.first.ok, r.first.ok ? '' : r.first.err.split('\n')[0]);
  ok('and still writes an output file', fs.existsSync(r.first.out));
  ok('with the renderer in it', !!r.mid && r.mid.includes(RENDERER));
  ok('so assets survives that too', !!r.second && r.second.ok);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
