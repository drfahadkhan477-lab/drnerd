#!/usr/bin/env node
/*
 * Stage 3 — Apex gets eyes and memory.
 *
 *   node scripts/stage3-patch.js <stage2-output.html> <output.html>
 *
 * Two changes, both to what the tutor knows before it answers:
 *
 *   1. VISION. 305 of 638 questions carry a figure, and the system prompt
 *      previously told the tutor it could not see it and should ask the
 *      fellow to describe it — inverting the teaching relationship on
 *      exactly the items where help is worth most. Figures now ride along
 *      with the request on providers that accept images.
 *
 *      Format verified against the Anthropic vision documentation: base64
 *      image content blocks, WebP supported, images before their text, each
 *      labelled when there are several. Our figures are ≤122 KB against a
 *      10 MB per-image cap and ≤4 per item against a 100-image cap.
 *
 *      Only Anthropic is wired for it. The Groq models this app offers
 *      (gpt-oss, qwen) are text-only, so on Groq the original "describe it
 *      to me" prompt is preserved verbatim — dropping the image silently and
 *      letting the model bluff would be worse than not offering the feature.
 *      No Groq vision model id is guessed at here.
 *
 *      Images are injected at request time and never written into CHATS,
 *      which is serialised to localStorage — Stage 0 spent real work keeping
 *      that under the origin quota and a saved thread full of base64 WebP
 *      would undo it.
 *
 *   2. LEARNING PROFILE. Apex previously opened every conversation knowing
 *      nothing about who it was teaching unless it thought to call a tool
 *      first. It now always carries a short summary of chapter accuracy,
 *      recent misses, FSRS retention and due load — the Stage 2 data finally
 *      being read by something other than the Progress screen.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/stage3-patch.js <stage2-output.html> <output.html>');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) {
    throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  }
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Embed the modules
 * ──────────────────────────────────────────────────────────────────────────── */
const ROOT = path.join(__dirname, '..');
const vision = fs.readFileSync(path.join(ROOT, 'src', 'core', 'vision.js'), 'utf8');
const profile = fs.readFileSync(path.join(ROOT, 'src', 'core', 'profile.js'), 'utf8');

patch('embed: vision.js and profile.js',
`/* ══════════════ Apex — cardiology reasoning panel ══════════════ */`,
`/* ═══════════ Vision + learning profile — see src/core/{vision,profile}.js ═══════════ */
${vision}
${profile}

/* ══════════════ Apex — cardiology reasoning panel ══════════════ */`);

/* ────────────────────────────────────────────────────────────────────────────
 * 2. The question context tells the truth about what the tutor can see
 * ──────────────────────────────────────────────────────────────────────────── */
patch('context: figure line reflects whether the figures are actually attached',
"${q.img?`(The fellow is also looking at ${q.img} clinical figure${q.img>1?'s':''} for this item, which you cannot see. If the answer turns on a finding in the figure, ask them what they see rather than guessing.)\\n`:''}",
"${Vision.figureContextLine(q, AI.provider)}");

patch('context: attach the learning profile to every turn',
"  return `CURRENT QUESTION — ACCSAP 12, ${q.ch}, item ${q.n}",
"  const profileBlock = (typeof Profile!=='undefined') ? Profile.build() : '';\n" +
"  return `CURRENT QUESTION — ACCSAP 12, ${q.ch}, item ${q.n}");

patch('context: append the profile after the fellow\'s own note',
"Use this as the ground truth for the item. You may go well beyond it.${ownBlock}`;",
"Use this as the ground truth for the item. You may go well beyond it.${ownBlock}${profileBlock}`;");

/* The no-question case gets the profile too — "where am I weak" is asked from
   the index as often as from inside a question. */
patch('context: profile is available even with no question open',
`  if(!q) return 'The fellow is browsing the question index; no question is open.';`,
`  if(!q) return 'The fellow is browsing the question index; no question is open.'
    + ((typeof Profile!=='undefined') ? Profile.build() : '');`);

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Send the figures
 * ──────────────────────────────────────────────────────────────────────────── */
patch('vision: attach figures to the Anthropic request',
`    body:JSON.stringify({model:cur().model,max_tokens:2000,stream:true,
      system:[{type:'text',text:SYSTEM},{type:'text',text:aiCtx(q)+(extra||'')}],
      tools:TOOLS, messages:wire})`,
`    body:JSON.stringify({model:cur().model,max_tokens:2000,stream:true,
      system:[{type:'text',text:SYSTEM},{type:'text',text:aiCtx(q)+(extra||'')}],
      tools:TOOLS,
      /* Non-mutating: the bounded tool loop calls this once per iteration, and
         withFigures returns a fresh array each time rather than stacking more
         copies of the image onto the same wire. The persisted history in
         CHATS is never touched — see src/core/vision.js. */
      messages:Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider)})`);

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Say so in the UI — the fellow should know why the answers got better
 * ──────────────────────────────────────────────────────────────────────────── */
patch('ui: show when Apex can see the figures',
`        <div class="ai-sub">\${q?e(q.ch)+' · item '+q.n:'Cardiology tutor'}</div>`,
`        <div class="ai-sub">\${q?e(q.ch)+' · item '+q.n+visionBadge(q):'Cardiology tutor'}</div>`);

patch('ui: the badge itself',
`function setupHtml(){`,
`/* A quiet signal that the figures went with the question — and, on a
   text-only provider, that they did not. */
function visionBadge(q){
  if(!q||!q.img) return '';
  const n=q.img, plural=n>1?'s':'';
  return Vision.providerSeesFigures(AI.provider)
    ? \` · sees \${n} figure\${plural}\`
    : \` · \${n} figure\${plural}, not visible to this model\`;
}
function setupHtml(){`);

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Teaching instruction for figure items
 * ──────────────────────────────────────────────────────────────────────────── */
patch('prompt: how to teach from a figure',
`- When the fellow's own reference notes are supplied, treat them as their current understanding: build on what is right, and correct what is wrong plainly and specifically.`,
`- When the fellow's own reference notes are supplied, treat them as their current understanding: build on what is right, and correct what is wrong plainly and specifically.
- When a figure is attached, start by saying what you actually see in it — rate, rhythm, axis, intervals, the specific wall or valve — before you reason from it. Naming the findings lets the fellow check your read, and teaches them the reading order to use themselves. If the image is unclear or you are unsure what a finding is, say so; a confident misread of a tracing is worse than an admitted one, and the official commentary is the ground truth wherever the two disagree.`);

/* ──────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, html);
const before = fs.statSync(SRC).size, after = fs.statSync(OUT).size;
console.log(`Stage 3 applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
console.log(`written: ${OUT}`);
