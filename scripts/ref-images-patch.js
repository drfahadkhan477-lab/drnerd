'use strict';
/* Retired patch-chain step, kept until the chain is deleted (tasks/todo.md,
   stage 3). Its logic lives in scripts/ref-images.js, which the assembler imports. */
const fs = require('fs');
const path = require('path');
const lib = require('./ref-images.js');
module.exports = lib;
const { buildRefImages, REFS_DIR, IMAGES_DIR } = lib;
if (require.main !== module) return;

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/ref-images-patch.js <input.html> <output.html>');
  process.exit(1);
}
const { keys, totalBytes, json: IMGS_JSON } = buildRefImages();

/* ── the patch ────────────────────────────────────────────────────────────── */
let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* 1. the lookup table, reassignable so the split build can fill it in after
   a fetch — see the REF_IMGS_START/END markers build-pwa.js looks for. */
patch('ref-images: the figure lookup ships already populated',
`let REF = refSeedApply(loadJSON(REF_KEY, []), REF_SEED);          // [{id,title,tags,body,ts,source}]`,
`let REF = refSeedApply(loadJSON(REF_KEY, []), REF_SEED);          // [{id,title,tags,body,ts,source}]
/* Figures cited by the reference notes above, keyed by the refimg:// path
   each note uses to name them. Reassignable ('let') because the split PWA
   build empties this and fetches the real map in afterward. */
let REF_IMGS = /*REF_IMGS_START*/${IMGS_JSON}/*REF_IMGS_END*/;
/* A note's images, as {caption,key} pairs, in citation order. Shared by the
   renderer (which resolves key -> pixels) and by the chat layer (which
   resolves key -> a vision block) so the two never drift out of sync on what
   counts as "this note has a figure". */
function extractRefImages(body){
  const out=[]; const re=/!\\[([^\\]]*)\\]\\(refimg:\\/\\/([^)\\s]+)\\)/g;
  let m; while((m=re.exec(body||''))) out.push({caption:m[1], key:m[2]});
  return out;
}`);

/* 2. md() renders the figure instead of leaving the markdown token literal. */
patch('ref-images: md() resolves refimg:// into a real figure',
`  /* Headings before inline marks, so a ## line never becomes a paragraph. */
  s=s.replace(/^####\\s+(.+)$/gm,'<h4>$1</h4>');`,
`  /* refimg:// figures resolve before any other inline rule touches them, so
     a caption's own \`**bold**\` or \`*em*\` is not double-processed once the
     caption is re-inserted whole into the <figcaption>. */
  s=s.replace(/!\\[([^\\]]*)\\]\\(refimg:\\/\\/([^)\\s]+)\\)/g,(m,cap,key)=>{
    const src=(typeof REF_IMGS!=='undefined'&&REF_IMGS[key])||'';
    if(!src) return '';
    return \`<figure class="ref-fig"><img src="\${src}" alt="\${cap}" loading="lazy"><figcaption>\${cap}</figcaption></figure>\`;
  });
  /* Headings before inline marks, so a ## line never becomes a paragraph. */
  s=s.replace(/^####\\s+(.+)$/gm,'<h4>$1</h4>');`);

patch('ref-images: figures count as block-level, so they never land inside a <p>',
`  s=s.split(/\\n{2,}/).map(p=>/^<(ul|h3|h4|pre|div|table)/.test(p.trim())?p:\`<p>\${p.replace(/\\n/g,' ')}</p>\`).join('');`,
`  s=s.split(/\\n{2,}/).map(p=>/^<(ul|h3|h4|pre|div|table|figure)/.test(p.trim())?p:\`<p>\${p.replace(/\\n/g,' ')}</p>\`).join('');`);

/* 3. the <figure> gets a frame to sit in, matching the card it lives inside. */
patch('ref-images: typography for the rendered figure',
`.ref-body>*:first-child{margin-top:0}
.ref-body>*:last-child{margin-bottom:0}`,
`.ref-body>*:first-child{margin-top:0}
.ref-body>*:last-child{margin-bottom:0}
.ref-body .ref-fig{margin:0 0 14px;padding:0;border:1px solid var(--border);
  border-radius:10px;overflow:hidden;background:var(--card)}
.ref-body .ref-fig img{display:block;width:100%;height:auto}
.ref-body .ref-fig figcaption{padding:8px 12px;font-size:13px;line-height:1.45;
  color:var(--muted);border-top:1px solid var(--border)}`);

/* 4. Vision learns to build blocks from a caption+dataURL list, and to merge
   them into a wire that withFigures may already have touched. */
patch('vision: ref-note figures get the same treatment as question figures',
`root.Vision = {
  withFigures, figureBlocks, figureContextLine, providerSeesFigures, dataUrlToSource,
  IMAGE_RULE,
  VISION_PROVIDERS,
};`,
`/* Turns {caption, dataUrl, noteTitle} entries into the same [text, image]
   pairing figureBlocks uses for question figures, so both read the same way
   in the transcript: a label, then the picture it labels. */
function refImageBlocks(images) {
  const blocks = [];
  (images || []).forEach(img => {
    const source = dataUrlToSource(img.dataUrl);
    if (!source) return;
    blocks.push({ type: 'text', text: \`Figure from "\${img.noteTitle}": \${img.caption}\` });
    blocks.push({ type: 'image', source });
  });
  return blocks;
}

/* Attaches note figures to the first user turn, same non-mutating contract as
   withFigures — and composes with it: if withFigures already turned that
   turn's content into blocks (a question's own figures), this appends after
   them rather than overwriting, so a question with figures AND a cited note
   with figures both show up rather than one clobbering the other. */
function withImages(wire, images, provider) {
  if (!providerSeesFigures(provider)) return wire;
  const blocks = refImageBlocks(images);
  if (!blocks.length || !wire.length) return wire;
  const first = wire[0];
  if (!first || first.role !== 'user') return wire;
  const out = wire.slice();
  if (Array.isArray(first.content)) {
    const content = first.content.slice();
    const textIdx = content.length - 1;   // withFigures always puts the text block last
    out[0] = { role: 'user', content: content.slice(0, textIdx).concat(blocks).concat(content.slice(textIdx)) };
  } else {
    out[0] = { role: 'user', content: blocks.concat([{ type: 'text', text: String(first.content || '') }]) };
  }
  return out;
}

root.Vision = {
  withFigures, figureBlocks, figureContextLine, providerSeesFigures, dataUrlToSource,
  refImageBlocks, withImages,
  IMAGE_RULE,
  VISION_PROVIDERS,
};`);

/* 5. wire it into the one place a reply is actually sent: resolve whichever
   ref notes are in lastHits into images, capped at four, and compose with
   whatever withFigures already did for the current question's own figures. */
patch('ref-images: attach cited notes\' figures to the reply, capped at four',
`      messages:Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider)})`,
`      messages:Vision.withImages(
        Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider),
        refImagesForHits(lastHits), AI.provider)})`);

/* refImagesForHits sits at top level, same scope as REF/REF_IMGS/md — added
   once, right before the function that now calls it. */
patch('ref-images: resolve the notes actually in context into vision-ready images',
`async function oneTurnAnthropic(q,wire,extra){`,
`/* lastHits holds whichever notes retrievedContext/groundedContext put in
   front of Apex this turn (plus anything a tool call cited afterward) — the
   same list the "cited from" UI already reads. Turning those into images
   here, at call time, means no new state has to be threaded through fire() /
   streamReply() / oneTurn(): the images always match what the fellow can see
   was actually retrieved.

   Grounded mode only. In the default mode retrievedContext's "further
   material" fallback surfaces a note even on thin, coincidental keyword
   overlap — fine for an optional citation, not fine for putting a random
   figure in front of the fellow on an unrelated question. Grounded mode is
   the opposite: the fellow has told Apex these notes are the only material
   it may teach from, so a cited note's own figure belongs in view. */
function refImagesForHits(hits){
  if(!AI_GROUNDED) return [];
  const out=[];
  for(const h of (hits||[])){
    if(!h||h.kind!=='r') continue;
    const r=REF.find(x=>x.id===h.id); if(!r) continue;
    for(const img of extractRefImages(r.body)){
      const dataUrl=(typeof REF_IMGS!=='undefined'&&REF_IMGS[img.key])||'';
      if(!dataUrl) continue;
      out.push({caption:img.caption, dataUrl, noteTitle:r.title});
      if(out.length>=4) return out;
    }
  }
  return out;
}
async function oneTurnAnthropic(q,wire,extra){`);

fs.writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`ref-images: ${applied.length} edits applied`);
console.log(`            ${keys.size} figures, ${kb(totalBytes)} raw / ${kb(Buffer.byteLength(IMGS_JSON))} embedded`);
console.log(`            → ${OUT}`);
