#!/usr/bin/env node
/*
 * The scanned heart, and a third drawing style.
 *
 *   node scripts/prep-glb.js <model.glb>          # first
 *   node scripts/scan-patch.js <in.html> <out.html>
 *
 * MODEL. Rhythm Lab gains a second heart: a photogrammetry-grade scan, beating
 * on exactly the same cardiac clock as the procedural one. That is the whole
 * point of the exercise — the scan's per-vertex chamber weights were baked from
 * this app's own signed-distance fields, so the existing vertex shader animates
 * it unchanged. The atria kick before the ventricles, the base descends toward
 * a stationary apex, the LV twists. A mesh that merely scaled up and down would
 * have been far easier and worth much less.
 *
 * What each model is FOR is different, and both stay:
 *   · procedural — parameterised anatomy, so it can be cut away, show the
 *     conduction system, run blood particles, and be drawn as an engraving.
 *     It knows what it is made of.
 *   · scan — one photoreal skin. It cannot be cut open, because there is
 *     nothing inside it. It is the one to look at.
 *
 * ATTRIBUTION IS A LICENCE TERM, NOT A COURTESY. The asset is CC-BY-4.0, which
 * permits this use precisely on condition that the author is credited. The
 * credit travels in the manifest, is read at runtime, and is rendered under the
 * model — so it cannot be lost by someone editing a template and not noticing.
 *
 * STYLE. The style switch becomes a three-way cycle: anatomic, engraved, and
 * crystal — a glass shell with the coronary tree solid inside it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/scan-patch.js <in.html> <out.html>'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const SCAN = path.join(ROOT, 'assets', 'heart-scan');
if (!fs.existsSync(path.join(SCAN, 'heart-scan.json'))) {
  console.error('assets/heart-scan is missing — run scripts/prep-glb.js first');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(SCAN, 'heart-scan.json'), 'utf8'));
const dataUrl = (f, mime) => `data:${mime};base64,` + fs.readFileSync(path.join(SCAN, f)).toString('base64');
const ASSETS = {
  manifest: JSON.stringify(manifest),
  bin: dataUrl('heart-scan.bin', 'application/octet-stream'),
  base: dataUrl('base.webp', 'image/webp'),
  normal: dataUrl('normal.webp', 'image/webp'),
  mr: dataUrl('mr.webp', 'image/webp'),
};

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 260)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('scan: the asset, inlined',
`const LAB_HEART_MODES=`,
`/* The scan, inlined for the single-file build. In the Stage 1 build these are
   ordinary files under content/heart-scan/ and the loader fetches them; the
   loader takes URLs either way, and a data: URL is a URL. */
const HEART_SCAN=${JSON.stringify(ASSETS)};
const LAB_HEART_MODES=`);

patch('lab: remember which model, and cycle three styles',
`let labHeartStyle=(()=>{try{return localStorage.getItem('accsap12.heartstyle')==='ink'?'ink':'anatomic';}catch(_){return 'anatomic';}})();`,
`const HEART_STYLES=['anatomic','ink','crystal'];
const HEART_STYLE_LABEL={anatomic:'Anatomic',ink:'Engraved',crystal:'Crystal'};
let labHeartStyle=(()=>{try{const v=localStorage.getItem('accsap12.heartstyle');
  return HEART_STYLES.indexOf(v)>=0?v:'anatomic';}catch(_){return 'anatomic';}})();
let labHeartModel=(()=>{try{return localStorage.getItem('accsap12.heartmodel')==='scan'?'scan':'procedural';}catch(_){return 'procedural';}})();
let scanLoading=false, scanCredit=null;`);

patch('lab: a model switch and a three-way style switch',
`      <span class="lab-style-sep"></span>
      <button class="chip style-chip\${labHeartStyle==='ink'?' hot':''}" data-heart-style
        title="Draw it as an anatomical engraving instead">\${labHeartStyle==='ink'?'Engraved':'Anatomic'}</button></div>`,
`      <span class="lab-style-sep"></span>
      <button class="chip model-chip\${labHeartModel==='scan'?' hot':''}" data-heart-model
        title="Switch between the parameterised anatomy and a photoreal scan">\${labHeartModel==='scan'?'Scan':'Model'}</button>
      <button class="chip style-chip\${labHeartStyle!=='anatomic'?' hot':''}" data-heart-style
        title="Cycle the drawing style">\${HEART_STYLE_LABEL[labHeartStyle]}</button></div>
    <div class="scan-credit" id="scanCredit"></div>`);

patch('lab: wire both switches',
`  const sb=document.querySelector('[data-heart-style]');
  if(sb) sb.onclick=()=>{
    labHeartStyle=labHeartStyle==='ink'?'anatomic':'ink';
    try{localStorage.setItem('accsap12.heartstyle',labHeartStyle);}catch(_){}
    labHeart.setStyle(labHeartStyle);
    sb.textContent=labHeartStyle==='ink'?'Engraved':'Anatomic';
    sb.classList.toggle('hot',labHeartStyle==='ink');
    document.querySelector('.lab-heart-panel')?.classList.toggle('ink-paper',labHeartStyle==='ink');
  };
  document.querySelector('.lab-heart-panel')?.classList.toggle('ink-paper',labHeartStyle==='ink');`,
`  const sb=document.querySelector('[data-heart-style]');
  if(sb) sb.onclick=()=>{
    labHeartStyle=HEART_STYLES[(HEART_STYLES.indexOf(labHeartStyle)+1)%HEART_STYLES.length];
    try{localStorage.setItem('accsap12.heartstyle',labHeartStyle);}catch(_){}
    labHeart.setStyle(labHeartStyle);
    sb.textContent=HEART_STYLE_LABEL[labHeartStyle];
    sb.classList.toggle('hot',labHeartStyle!=='anatomic');
    document.querySelector('.lab-heart-panel')?.classList.toggle('ink-paper',labHeartStyle==='ink');
  };
  document.querySelector('.lab-heart-panel')?.classList.toggle('ink-paper',labHeartStyle==='ink');

  const mb=document.querySelector('[data-heart-model]');
  if(mb) mb.onclick=()=>{ setHeartModel(labHeartModel==='scan'?'procedural':'scan'); };
  if(labHeartModel==='scan') applyHeartModel();
  paintScanCredit();`);

patch('lab: load the scan on demand, and never lose the credit',
`function paintLabHeartReadout(`,
`/* Loaded the first time it is asked for, not at boot: it is ~800 KB of mesh
   and maps, and most sessions never open Rhythm Lab at all. */
function applyHeartModel(){
  if(!labHeart) return;
  if(labHeartModel!=='scan'){ labHeart.setModel('procedural'); paintScanCredit(); return; }
  if(labHeart.hasScan()){ labHeart.setModel('scan'); paintScanCredit(); return; }
  if(scanLoading) return;
  scanLoading=true; paintScanCredit('Loading the scan…');
  labHeart.loadScan(HEART_SCAN).then(credit=>{
    scanLoading=false; scanCredit=credit;
    if(labHeartModel==='scan'&&labHeart) labHeart.setModel('scan');
    paintScanCredit();
  }).catch(()=>{
    scanLoading=false; labHeartModel='procedural';
    paintScanCredit('The scan could not be loaded — showing the model instead.');
    const mb=document.querySelector('[data-heart-model]');
    if(mb){ mb.textContent='Model'; mb.classList.remove('hot'); }
  });
}
function setHeartModel(m){
  labHeartModel=m==='scan'?'scan':'procedural';
  try{localStorage.setItem('accsap12.heartmodel',labHeartModel);}catch(_){}
  const mb=document.querySelector('[data-heart-model]');
  if(mb){ mb.textContent=labHeartModel==='scan'?'Scan':'Model'; mb.classList.toggle('hot',labHeartModel==='scan'); }
  applyHeartModel();
}
/* CC-BY is a licence, and the credit is its condition. Rendered from the
   manifest the asset itself carries, so it cannot be quietly dropped. */
function paintScanCredit(msg){
  const el=document.getElementById('scanCredit'); if(!el) return;
  if(msg){ el.textContent=msg; el.classList.add('on'); return; }
  if(labHeartModel!=='scan'||!scanCredit){ el.textContent=''; el.classList.remove('on'); return; }
  const c=scanCredit;
  el.innerHTML=\`<b>\${e(c.title)}</b> by \${e(String(c.author).replace(/\\s*\\(.*\\)$/,''))}
    · \${e(String(c.license).replace(/\\s*\\(.*\\)$/,''))}\`
    + (c.source?\` · <a href="\${e(c.source)}" target="_blank" rel="noopener">source</a>\`:'');
  el.classList.add('on');
}
function paintLabHeartReadout(`);

patch('lab: the scan follows rhythm changes like everything else',
`function setLab(k){`,
`function setLab(k){
  /* nothing model-specific: both hearts run off the same cycle */`);

patch('css: the model switch and the credit line',
`.lab-style-sep{flex:1 1 auto}`,
`.lab-style-sep{flex:1 1 auto}
.model-chip{font-variant-numeric:tabular-nums}
.scan-credit{display:none;padding:0 14px 12px;font-size:11.5px;line-height:1.5;color:var(--dim)}
.scan-credit.on{display:block}
.scan-credit b{color:var(--muted);font-weight:650}
.scan-credit a{color:var(--teal);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--teal) 40%,transparent)}`);

fs.writeFileSync(OUT, html);
const mb = b => (b / 1048576).toFixed(2) + ' MB';
console.log(`Scan + crystal applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n  ${manifest.credit.title} — ${manifest.credit.author}`);
console.log(`  ${manifest.credit.license}`);
console.log(`\n${mb(fs.statSync(SRC).size)} → ${mb(fs.statSync(OUT).size)}`);
console.log(`written: ${OUT}`);
