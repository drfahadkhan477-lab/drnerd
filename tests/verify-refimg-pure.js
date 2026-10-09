#!/usr/bin/env node
/*
 * A corpus with no pictures in it must still build.
 *
 *   node tests/verify-refimg-pure.js
 *
 * No browser and no licensed export: the app is assembled by
 * scripts/assemble-app.js — the build that ships — around the synthetic
 * export, with reference corpora made here, and the page it writes is read.
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
 * Until the patch chain was retired this ran ref-images-patch.js and then
 * assets-patch.js over a stand-in made of their anchors. The assembler builds
 * the app now, so the same three corpora go through it instead: a page that
 * failed to build, or built without REF_IMGS, fails here.
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
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

/* The invented bank the CI build uses: no licensed content anywhere. */
const EXPORT = path.join(TMP, 'export.html');
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'synthetic-export.js'), EXPORT], { stdio: 'pipe' });

function corpus(name, note) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (note) fs.writeFileSync(path.join(dir, 'note.md'), note);
  return dir;
}
/* The reference seed rejects a section under 40 words, so the filler is not
   padding for its own sake — a thinner note would fail the build for that. */
const NOTE = body => `---\ntitle: A note\ntags: x\nsource: y\n---\n\n## A section\n${body}\n${'word '.repeat(60)}\n`;

/* Assemble, as `npm run build` does, and hand back the page or the error. */
function assemble(name, refsDir, imgsDir) {
  const out = path.join(TMP, `${name}.html`);
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'assemble-app.js'), EXPORT,
      '--refs', refsDir, '--ref-images', imgsDir, '--out', out], { stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, page: fs.readFileSync(out, 'utf8') };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.stdout || e).split('\n').filter(Boolean)[0] || 'failed' };
  }
}
const REF_IMGS = page => (page.match(/let REF_IMGS = \/\*REF_IMGS_START\*\/([\s\S]*?)\/\*REF_IMGS_END\*\//) || [])[1];
/* md()'s figure branch, which runs whatever REF_IMGS holds: the renderer
   must be in the page whether or not anything was baked into it. */
const RENDERER = "const baked=(typeof REF_IMGS!=='undefined'&&REF_IMGS[key])||'';";

head('a corpus that cites no figures — the shipped worked examples');
{
  const r = assemble('empty', corpus('empty-refs', NOTE('')), path.join(TMP, 'no-imgs'));
  ok('the app builds', r.ok, r.ok ? '' : r.err);
  ok('REF_IMGS ships empty rather than absent', r.ok && REF_IMGS(r.page) === '{}', r.ok ? String(REF_IMGS(r.page)).slice(0, 40) : 'no page');
  ok('and md()\'s figure renderer is in the page all the same', r.ok && r.page.includes(RENDERER));
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
  const r = assemble('full', refs, path.join(TMP, 'full-imgs'));
  ok('the app builds', r.ok, r.ok ? '' : r.err);
  /* NON-VACUITY. Without this, the section above would pass just as well
     against a build that had stopped embedding anything at all. */
  ok('and the cited figure is baked into REF_IMGS as a data URL',
     r.ok && /data:image\/png;base64,iVBOR/.test(String(REF_IMGS(r.page))));
}

head('a figures directory that is not there at all');
{
  const r = assemble('absent', corpus('absent-refs', NOTE('')), path.join(TMP, 'nor-this'));
  ok('the app still builds', r.ok, r.ok ? '' : r.err);
  ok('with REF_IMGS empty, not missing', r.ok && REF_IMGS(r.page) === '{}');
  ok('and the renderer in it', r.ok && r.page.includes(RENDERER));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
