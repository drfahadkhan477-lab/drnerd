#!/usr/bin/env node
/*
 * Rhythm Lab loses the 3D heart, and the cardiac cycle takes the room.
 *
 *   node scripts/lab-patch.js <in.html> <out.html>
 *
 * WHY. The lab had three things stacked in it — a running monitor, a 12-lead,
 * a cardiac cycle diagram, and a rotatable heart. The heart was the most
 * impressive of them and the least useful: you look at it once, and after that
 * it is a shape turning slowly while the panel that actually teaches something
 * is pushed below the fold. The diagram is the one you read for ten minutes.
 * So the heart goes and the diagram gets the space.
 *
 * The heart stays on the home screen, where being decorative is the job.
 *
 * THE CLOCK. The diagram used to read its time from the heart — `physioClock`,
 * written by the heart's onCycle every frame, so cursor and muscle could not
 * drift apart. With the heart gone there is nothing writing it, and a diagram
 * whose time source never updates freezes on frame one. It integrates its own
 * clock again, which is what wiggers.js does when no timeSource is given, and
 * announces each frame through a new onFrame hook so the phase caption still
 * repaints. One clock either way; only the owner changes.
 *
 * THE SCAN GOES WITH IT. The photoreal scan was only ever loaded into the lab
 * heart, so removing the panel leaves a megabyte of base64 in the page that
 * nothing can display. Worse than dead weight: it is CC-BY-4.0, and the credit
 * that licence requires was rendered under the model that no longer exists.
 * Shipping the asset with the attribution removed is the one outcome that is
 * actually not allowed, so `scan` comes out of the build chain entirely and
 * assets/heart-scan is no longer embedded. The engraved style survives — it
 * belongs to ink-patch, not to the scan.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/lab-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 220)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}
/* Whole function bodies are too long to paste literally without the paste
   itself becoming the bug. A regex anchored on the declaration keeps the same
   guarantee that matters — exactly one match, or stop. */
function cut(label, re) {
  const all = html.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
  if (all.length !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${all.length}`);
  html = html.replace(re, '');
  applied.push(label);
}

/* ── 1. the panel leaves the lab ──────────────────────────────────────────── */
patch('lab: the heart panel is no longer built into the screen',
`    ${'$'}{buildPhysio()}
    ${'$'}{buildLabHeart()}`,
`    ${'$'}{buildPhysio()}`);

cut('lab: buildLabHeart and its mode list are gone',
    /\nconst LAB_HEART_MODES=\[\['whole'[\s\S]*?\n\}\n(?=let |const |function |\/\*)/);

cut('lab: mountLabHeart is gone', /function mountLabHeart\(\)\{[\s\S]*?\n\}\n(?=[a-zA-Z/])/);

cut('lab: so is the readout it painted', /function paintLabHeartReadout\(c\)\{[\s\S]*?\n\}\n/);

patch('lab: nothing mounts it when the lab opens',
`  if(typeof mountTwelve==='function') mountTwelve();
  mountLabHeart();
  if(typeof mountPhysio==='function') mountPhysio();`,
`  if(typeof mountTwelve==='function') mountTwelve();
  if(typeof mountPhysio==='function') mountPhysio();`);

/* The heart was mounted from render() unconditionally, which is what tore it
   down when the lab's markup went away. The diagram was only ever mounted from
   mountLab(), which render() calls only while the lab is on screen — so it had
   no teardown path at all. It takes the heart's place here, and now its
   destroy() actually gets a chance to run. */
patch('lab: the diagram inherits the unconditional mount that tore the heart down',
`  if(typeof mountLabHeart==='function') mountLabHeart();`,
`  if(typeof mountPhysio==='function') mountPhysio();`);

/* ── 2. the references that are now dangling ──────────────────────────────── */
patch('lab: changing rhythm no longer retunes a heart that is not there',
`  labKind=k; if(labHeart) labHeart.setRhythm(k);`,
`  labKind=k;`);

patch('lab: nor does changing theme',
`  if(typeof labHeart!=='undefined'&&labHeart) labHeart.setDark(d);\n`, '');

patch('lab: the handles it was held by',
`let labHeart=null, labHeartMode='whole', labHeartCanvasEl=null;`, '');

cut('lab: the comment that explained how it was mounted',
    /\/\* Always runs, on every render — mirrors mountHero[\s\S]*?has left the DOM\. \*\/\n/);

/* ── 3. the diagram keeps its own time ────────────────────────────────────── */
/* ── 4. the styles that dressed it ────────────────────────────────────────── */
cut('css: every rule that dressed the heart panel',
    /\.lab-heart-panel\{background:var\(--card\)[\s\S]*?\.lab-heart-hint\{[^}]*\}\n/);

/* ── 5. the cycle takes the space the heart was using ─────────────────────── */
/* Order is the loudest statement a screen makes about what it is for. The
   12-lead was above the diagram because the heart used to be below it and the
   diagram sat between them; with the heart gone, the panel you read for ten
   minutes should not be the one you scroll past two panels to reach. */
patch('lab: the cardiac cycle comes before the 12-lead',
`    ${'$'}{buildTwelveLead()}
    ${'$'}{buildPhysio()}`,
`    ${'$'}{buildPhysio()}
    ${'$'}{buildTwelveLead()}`);

/* The heading sat flush against the panel's left border, because these two
   panels zero their padding so the canvas can run edge to edge and the heading
   inherited that zero. The border then clipped the first glyph — "12-lead" was
   drawing as "!2-lead". It needs its own inset rather than the panel's. */
patch('css: the panel heading gets the inset its panel gave up',
`.physio-panel{padding:0;overflow:hidden}`,
`.physio-panel{padding:0;overflow:hidden}
.physio-panel>.panel-h,.twelve-panel>.panel-h{
  display:flex;align-items:baseline;gap:var(--s3,12px);
  padding:var(--s4,16px) var(--s5,20px) 0;margin-bottom:var(--s2,8px)}
/* The phase, where you are already looking. The caption underneath explains it;
   this only names it, and it is the one thing on the panel that changes while
   you watch, so it earns the accent. */
.physio-phase{margin-left:auto;font-family:var(--font-mono);font-size:11px;
  letter-spacing:.06em;text-transform:uppercase;font-weight:700;
  color:var(--teal);background:var(--teal4);border:1px solid var(--teal3);
  border-radius:999px;padding:3px 10px;white-space:nowrap;
  font-variant-numeric:tabular-nums}
/* Taller than it was. The pressure traces are the point of the diagram and
   they were sharing 60vh with a heart that is no longer there. */
.physio-stage{aspect-ratio:1.72/1;max-height:74vh}
@media(max-width:900px){.physio-stage{aspect-ratio:1.4/1;max-height:64vh}}
@media(max-width:560px){.physio-stage{aspect-ratio:1.1/1;max-height:58vh}}
/* Up one step of the ladder, not to an arbitrary 14px: the caption is now the
   only prose on the panel and it is what you read while the cursor sweeps. */
.physio-note{font-size:var(--t-body,16px);line-height:1.6}`);

patch('lab: the heading carries a live phase',
`    <div class="panel-h">Cardiac cycle · ${'$'}{e(v[1])}</div>`,
`    <div class="panel-h"><span>Cardiac cycle · ${'$'}{e(v[1])}</span>
      <span class="physio-phase" id="physioPhase">&nbsp;</span></div>`);

patch('lab: and the phase is repainted with the caption',
`  el.innerHTML=physioNoteHtml();
}`,
`  el.innerHTML=physioNoteHtml();
  const pill=document.getElementById('physioPhase');
  if(pill) pill.textContent = physioView==='wiggers'
    ? Physio.phaseAt(physio?physio.time():0).name : PHYSIO_VIEWS.find(x=>x[0]===physioView)[1];
}`);

fs.writeFileSync(OUT, html);
console.log(`Rhythm Lab focused on the cycle — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
