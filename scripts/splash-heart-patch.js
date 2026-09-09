#!/usr/bin/env node
/*
 * A photographed heart on the startup screen, set in a medallion.
 *
 *   node scripts/splash-heart-patch.js <home-output.html> <output.html>
 *
 * WHAT CHANGED, AND WHY. This step has now had three hearts. First a hand-drawn
 * SVG animated with CSS keyframes, which read as a heart but a FLAT one.
 * Then a Lottie file — proper gradient meshes, bezier easing, a trim-path for
 * light travelling along a coronary — which was a real improvement and stood
 * for a while. It is now a photograph, because the app's owner supplied one
 * and it is simply a better image than either drawing: a rendered anterior
 * view with the coronary tree in relief, lit from one side, on its own dark
 * ground. No amount of vector authoring gets there.
 *
 * THE TRADE THAT MAKES IT WORTH IT. The Lottie heart cost 168 KB of player
 * plus 23 KB of animation data, and it animated: the coronaries lit up in
 * sequence. The photograph is 42 KB total, animates only in the sense that it
 * beats, and cannot light a vessel. So this is a straight swap of one kind of
 * richness for another — motion for material — at a quarter of the bytes and
 * with the whole Lottie runtime deleted from the build. Said plainly because
 * the previous version of this comment argued for the animation, and that
 * argument was good; it just lost to a better picture.
 *
 * IT CARRIES ITS OWN GROUND, DELIBERATELY. The picture has a dark navy
 * background baked into it, and the splash has to read on Parchment's cream
 * as well as Nocturne's near-black. Rather than cutting the heart out — a
 * dark silhouette on a dark ground, which masks badly at every edge — it is
 * framed: a rounded medallion with a hairline ring and a soft outer shadow,
 * so the dark field reads as a plate the heart sits on rather than a square
 * someone forgot to erase. That framing is the same idea the first version of
 * this splash had ("a lit instrument plate behind an anatomical heart"); only
 * now the plate and the heart arrive in one file.
 *
 * IT BEATS, AND IT STOPS WHEN ASKED. A slow scale pulse on the image, eased
 * so the upstroke is quicker than the relaxation, which is the one thing a
 * still picture of a heart can do that reads as alive. Under
 * prefers-reduced-motion it holds still — not slowed, stopped — and so does
 * the entrance rise.
 *
 * TWO DELIVERY PATHS, BECAUSE THE BUDGETS ARE DIFFERENT. 42 KB is nothing
 * against a single-file build that is tens of megabytes, so there it is
 * inlined as a data: URI and paints with the rest of the splash markup — no
 * request, no wait, which is the entire point of a splash. Against the split
 * PWA shell it is real money: base64 does not gzip (the bytes are already
 * compressed), so inlining would put ~57 KB straight onto the transferred
 * shell, which verify-pwa holds under 280 KB gzipped and which is at ~229 KB.
 * So build-pwa.js pulls the image back out to content/splash-heart/ and
 * rewrites the src to a URL — the same move it already made for the Lottie
 * pair, and the img is marked data-splash-heart="img" so it can find it
 * without depending on this comment surviving.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/splash-heart-patch.js <home-output.html> <output.html>'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const IMG_FILE = path.join(ROOT, 'assets', 'hero-heart', 'heart.webp');
const IMG_BYTES = fs.readFileSync(IMG_FILE);
/* A WebP always starts "RIFF....WEBP". Checked here so a truncated or
   wrong-format file fails at the step that owns it, not as a blank medallion
   three builds later. */
if (IMG_BYTES.slice(0, 4).toString('ascii') !== 'RIFF' || IMG_BYTES.slice(8, 12).toString('ascii') !== 'WEBP') {
  throw new Error(`splash-heart: ${path.relative(ROOT, IMG_FILE)} is not a WebP file`);
}
const IMG_URI = 'data:image/webp;base64,' + IMG_BYTES.toString('base64');

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* The mount point, above the ECG sweep exactly where every previous heart has
   sat. The wrapper keeps the .sp-heart-mount class the entrance animation and
   splashtiming-patch's comment both name; the img inside it is what changes.
   decoding="sync" because this is the one image on the page whose whole job is
   to be there on the first paint. */
patch('splash: the heart medallion above the strip',
`  <div class="sp-in">
    <svg class="sp-strip"`,
`  <div class="sp-in">
    <div class="sp-heart-mount" id="spHeartMount" aria-hidden="true">
      <img class="sp-heart-img" data-splash-heart="img" alt="" decoding="sync" src="${IMG_URI}">
    </div>
    <svg class="sp-strip"`);

patch('splash: the medallion, its ring, and the beat',
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}`,
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}
.sp-heart-mount{width:min(310px,66vw);height:min(310px,66vw);margin-bottom:16px;
  position:relative;border-radius:26%;
  /* The plate: its own dark ground, a hairline ring to separate it from a
     cream splash, and a shadow deep enough to sit it on the page rather than
     float above it. */
  background:#0b1622;
  box-shadow:0 18px 46px rgba(3,12,24,.5), 0 0 0 1px rgba(148,190,220,.14),
             inset 0 0 60px rgba(4,10,18,.55);
  overflow:hidden;
  animation:spRise 1s both cubic-bezier(.2,.7,.3,1)}
.sp-heart-img{display:block;width:100%;height:100%;object-fit:cover;
  /* Systole is quick, diastole is slow — the easing does the work that a
     symmetric pulse cannot.

     NO DELAY, DELIBERATELY. This was written with a 1s delay so the beat would
     not "fight" the entrance rise. It cannot: spRise is on .sp-heart-mount and
     spBeat is on the .sp-heart-img inside it, so they compose rather than
     collide. Meanwhile the splash is dismissed on the app's first real render,
     which on a warm launch is a few hundred milliseconds — so a beat that
     started at 1s was a beat almost nobody would ever see. The suite caught
     this by sampling the transform twice and finding it unchanged. */
  animation:spBeat 1150ms infinite cubic-bezier(.28,.9,.32,1)}
/* A soft inner vignette over the photograph's own edge, so the medallion's
   corners fall away instead of ending on a hard crop. */
.sp-heart-mount::after{content:"";position:absolute;inset:0;border-radius:inherit;
  pointer-events:none;
  background:radial-gradient(115% 115% at 50% 42%,rgba(0,0,0,0) 52%,rgba(4,10,18,.62) 100%)}
@keyframes spRise{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}
@keyframes spBeat{0%,100%{transform:scale(1)}
  18%{transform:scale(1.045)}
  32%{transform:scale(1.012)}
  46%{transform:scale(1.026)}}
@media(prefers-reduced-motion:reduce){
  .sp-heart-mount{animation:none}
  .sp-heart-img{animation:none}}`);

fs.writeFileSync(OUT, html);
console.log(`Photographed splash heart applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`  heart.webp     ${(IMG_BYTES.length / 1024).toFixed(1)} KB  (${(IMG_URI.length / 1024).toFixed(1)} KB as a data: URI)`);
console.log(`written: ${OUT}`);
