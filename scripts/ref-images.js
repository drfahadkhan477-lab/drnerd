#!/usr/bin/env node
/*
 * Figures inside reference notes — rendered in the library, and shown to
 * Apex, not just described to it.
 *
 *   node scripts/ref-images-patch.js <input.html> <output.html>
 *
 * The notes already cite `![caption](refimg://KEY)` at the point in the
 * prose a figure actually illustrates — a flowchart next to the paragraph
 * describing the algorithm, the STICH survival curve next to the sentence
 * quoting its hazard ratio. This step is what turns that citation into
 * something real: a resolvable image in the Notes panel, and — the harder
 * half — an actual picture attached to Apex's turn when a cited note is the
 * material it is answering from.
 *
 * THE THREE PIECES.
 *
 * 1. REF_IMGS. content/refs-images/<key> holds pre-compressed JPEGs (resized
 *    and requantised once, by hand, before this script ever runs — the build
 *    stays dependency-free by never touching an image library itself, the
 *    same reason content/figures/*.webp already ships pre-built rather than
 *    generated at build time). This step base64s each file a note actually
 *    references into REF_IMGS, keyed by the same `refimg://` path.
 *
 * 2. md() LEARNS ONE MORE SYNTAX. `![caption](refimg://KEY)` becomes a
 *    <figure> with the resolved image and a caption — added ahead of the
 *    other inline rules so a caption's own markdown, if any, is not
 *    double-processed, and folded into the paragraph-wrap exclusion so it is
 *    never lifted into a stray <p>.
 *
 * 3. APEX SEES THE FIGURE, NOT JUST ITS ALT TEXT. Question-bank figures
 *    already ride into the conversation as real image blocks via
 *    Vision.withFigures (src/core/vision.js) — the fellow's ACCSAP diagrams,
 *    attached to the first user turn, with a text fallback line for
 *    providers that cannot see images. Reference-note figures get the same
 *    treatment through two new, deliberately separate functions,
 *    Vision.refImageBlocks and Vision.withImages: separate because a note's
 *    images are not tied to a question the way IMGS[q.id] is — they have to
 *    be discovered from whichever notes actually made it into context this
 *    turn, which is `lastHits`, not `q`. Composing withImages after
 *    withFigures lets both attach in the same request without either
 *    clobbering the other's blocks.
 *
 * Capped at 4 images per turn — a fellow asking about STICH doesn't need
 * six figures competing with the two the answer actually turns on, and an
 * unbounded attachment list is the difference between "shows the curve" and
 * "burns the vision budget on a Table of Contents nobody asked about."
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findMarkdownFiles } = require('./ref-seed.js');

/* Overridable so a test can point this at a fixture corpus instead of the
   licensed one. Unset in every real build, where the defaults are the only
   thing build.js ever uses. */
const REFS_DIR = process.env.SYSTOLE_REFS_DIR || path.join(__dirname, '..', 'content', 'refs');
const IMAGES_DIR = process.env.SYSTOLE_REF_IMAGES_DIR || path.join(__dirname, '..', 'content', 'refs-images');

/* ── find every refimg:// key actually cited in the corpus ────────────────── */
/* THE CODE BELOW IS INJECTED WHETHER OR NOT ANYTHING IS CITED. Only the DATA
   is conditional. This used to bail out early — copy the input through and
   exit — whenever the corpus cited no figures, and that was wrong twice over:
   the assets step immediately after anchors on the md() renderer this injects
   and dies "expected exactly 1 match, found 0" on a corpus without figures,
   which is every corpus the shipped worked examples produce; and the renderer
   is also the half of refimg:// that resolves figures imported at RUNTIME, so
   skipping it silently killed a feature that has nothing to do with whether
   the build-time corpus happened to have pictures in it. An empty REF_IMGS is
   the honest representation of "no figures baked in" — not an absent one. */
/* The figures every note cites, as the JSON this step embeds. Exported so
   scripts/assemble-app.js fills the frozen shell's REF_IMGS slot with exactly
   what this step writes; the script below calls it with the two directories. */
function buildRefImages(refsDir = REFS_DIR, imagesDir = IMAGES_DIR) {
  /* The notes refs-patch seeds, found the way refs-patch finds them. This
     read only the top level of refsDir while refs-patch walks into
     subfolders, so a note filed in a subfolder was seeded and its figures
     were not. */
  const mdFiles = fs.existsSync(refsDir) ? findMarkdownFiles(refsDir) : [];
  const keys = new Set();
  for (const f of mdFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    const re = /!\[[^\]]*\]\(refimg:\/\/([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(raw))) keys.add(m[1]);
  }

  const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const REF_IMGS = {};
  let totalBytes = 0;
  for (const key of keys) {
    const file = path.join(imagesDir, key);
    if (!fs.existsSync(file)) {
      throw new Error(`ref-images: "${key}" is cited by a note but content/refs-images/${key} does not exist`);
    }
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error(`ref-images: "${key}" has an unsupported extension (${ext})`);
    const buf = fs.readFileSync(file);
    totalBytes += buf.length;
    REF_IMGS[key] = `data:${mime};base64,${buf.toString('base64')}`;
  }

  return { keys, totalBytes, json: JSON.stringify(REF_IMGS) };
}

module.exports = { buildRefImages, REFS_DIR, IMAGES_DIR };
