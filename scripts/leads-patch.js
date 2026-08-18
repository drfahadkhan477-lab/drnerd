#!/usr/bin/env node
/*
 * A real 12-lead in Rhythm Lab, with an explanation attached to every lead.
 *
 *   node scripts/leads-patch.js <art-output.html> <output.html>
 *
 * The single-lead engine already in the app synthesises a waveform directly —
 * shape a P, shape a QRS, shape a T. That can never produce a 12-lead, because
 * the twelve leads are not twelve waveforms: they are one electrical event
 * seen from twelve directions. So src/core/leads12.js models the dipole and
 * projects it onto each lead axis, and every difference between the leads
 * falls out of the geometry rather than being drawn in by hand.
 *
 * That is what makes it worth having as a teaching tool. Verified against the
 * patterns a fellow is examined on: II tallest of the limb leads, aVR inverted,
 * R-wave progression from a deep S in V1 to a tall R in V6 with the transition
 * at V3-V4, septal q in I/aVL/V5/V6, rSR' in V1 for RBBB, broad R with the
 * septal q abolished in V6 for LBBB, and reciprocal change in both STEMIs.
 *
 * Only rhythms whose vector sequence is genuinely modelled offer the 12-lead.
 * For the rest the panel says so rather than drawing normal morphology under
 * an abnormal label, which would teach the wrong pattern confidently.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/leads-patch.js <art-output.html> <output.html>');
  process.exit(1);
}
const ROOT = path.join(__dirname, '..');
const leads12 = fs.readFileSync(path.join(ROOT, 'src', 'core', 'leads12.js'), 'utf8');
const ecg12 = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ecg12.js'), 'utf8');

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 260)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('embed: leads12.js and ecg12.js',
`/* ═══════════ More arrhythmias, hero rotation, Pencil feel`,
`/* ═══════════ 12-lead — see src/core/leads12.js and src/ui/ecg12.js ═══════════ */
${leads12}
${ecg12}

/* ═══════════ More arrhythmias, hero rotation, Pencil feel`);

patch('lab: the 12-lead panel',
`    \${buildLabHeart()}
  </div>\`;
}`,
`    \${buildTwelveLead()}
    \${buildLabHeart()}
  </div>\`;
}

/* Which of the lab's 27 rhythms have a genuinely modelled vector sequence.
   Anything else gets an honest note instead of a normal-looking 12-lead with
   an abnormal name on it. */
const LEAD12_MAP={sinus:'sinus',brady:'brady',tachy:'tachy',afib:'afib',flutter:'flutter',
  rbbb:'rbbb',lbbb:'lbbb',hyperk:'hyperk',longqt:'longqt',stemi:'stemi_ant',
  pericarditis:'pericarditis'};
let twelve=null, twelveLead=null;
function buildTwelveLead(){
  const modelled=!!LEAD12_MAP[labKind];
  return \`<div class="panel twelve-panel">
    <div class="panel-h">12-lead · \${e(RHYTHMS[labKind].name)}</div>
    \${modelled?\`
      <div class="twelve-stage"><canvas id="twelveCanvas" aria-label="12-lead electrocardiogram"></canvas></div>
      <div class="twelve-hint">25 mm/s · 10 mm/mV · tap any lead to see what it looks at</div>
      <div class="lead-card" id="leadCard">\${leadCardHtml(twelveLead)}</div>\`
    :\`<div class="twelve-none">A distinct 12-lead is modelled for sinus, bradycardia, tachycardia,
        atrial fibrillation, flutter, RBBB, LBBB, anterior STEMI, pericarditis, hyperkalaemia and long QT.
        <b>\${e(RHYTHMS[labKind].name)}</b> is shown on the single-lead trace above — drawing it here would mean
        showing normal morphology under an abnormal name, which teaches the wrong pattern.</div>\`}
  </div>\`;
}
function leadCardHtml(id){
  if(typeof Leads12==='undefined') return '';
  if(!id) return \`<div class="lead-empty">Tap a lead above.</div>\`;
  const L=Leads12.LEADS.find(l=>l.id===id); if(!L) return '';
  return \`<div class="lead-head"><span class="lead-id">\${e(L.id)}</span>
      <span class="lead-terr">\${e(L.territory)}</span>
      <span class="lead-art">\${e(L.artery)}</span></div>
    <div class="lead-sees">\${e(L.sees)}</div>
    <div class="lead-look">\${e(L.look)}</div>\`;
}
function mountTwelve(){
  const cv=document.getElementById('twelveCanvas');
  if(!cv||typeof ECG12==='undefined'){ twelve=null; return; }
  const dark=document.documentElement.getAttribute('data-theme')==='dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  twelve=ECG12.mount(cv,{kind:LEAD12_MAP[labKind]||'sinus',hr:RHYTHMS[labKind].hr||68,dark});
  if(!twelve) return;
  if(twelveLead) twelve.select(twelveLead);
  cv.onclick=ev=>{
    const r=cv.getBoundingClientRect();
    const id=twelve.leadAt(ev.clientX-r.left, ev.clientY-r.top);
    if(!id) return;
    twelveLead = twelveLead===id ? null : id;
    twelve.select(twelveLead);
    const card=document.getElementById('leadCard');
    if(card) card.innerHTML=leadCardHtml(twelveLead);
  };
  /* The canvas is sized from its box, and the box is not final until layout
     settles after a screen change — redraw once it is. */
  requestAnimationFrame(()=>twelve&&twelve.draw());
}`);

patch('lab: mount the 12-lead alongside the monitor',
`  if(cv){ labMon=new ECGMonitor(cv,{kind:labKind,speed:0.15,grid:true,amp:60,lineWidth:2.2}); labMon.start(); }`,
`  if(cv){ labMon=new ECGMonitor(cv,{kind:labKind,speed:0.15,grid:true,amp:60,lineWidth:2.2}); labMon.start(); }
  if(typeof mountTwelve==='function') mountTwelve();`);

patch('lab: switching rhythm redraws the 12-lead too',
`function setLab(k){ labKind=k; if(labHeart) labHeart.setRhythm(k); render(); }`,
`function setLab(k){
  /* A lead selected on one rhythm is still the lead you want to watch on the
     next, so the selection survives — but only if that rhythm has a 12-lead. */
  labKind=k; if(labHeart) labHeart.setRhythm(k); render();
}`);

patch('theme: the 12-lead follows light/dark like everything else',
`  if(typeof heroHeart3d!=='undefined'&&heroHeart3d) heroHeart3d.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
}`,
`  if(typeof heroHeart3d!=='undefined'&&heroHeart3d) heroHeart3d.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
  if(typeof twelve!=='undefined'&&twelve) twelve.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
}`);

patch('css: the 12-lead panel',
`.lab-heart-panel{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);`,
`.twelve-panel{padding:0;overflow:hidden}
.twelve-stage{position:relative;aspect-ratio:1.62/1;max-height:62vh;margin:0}
.twelve-stage canvas{width:100%;height:100%;display:block;cursor:pointer;touch-action:manipulation}
.twelve-hint{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.05em;
  color:var(--dim);padding:8px 14px 0;text-transform:uppercase}
.twelve-none{padding:14px;font-size:14px;line-height:1.55;color:var(--muted)}
.lead-card{padding:12px 14px 14px;min-height:64px}
.lead-empty{font-size:13px;color:var(--dim)}
.lead-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:7px}
.lead-id{font-family:var(--font-mono);font-size:17px;font-weight:700;color:var(--teal);letter-spacing:-.01em}
.lead-terr{font-size:12px;font-weight:650;color:var(--text)}
.lead-art{font-family:var(--font-mono);font-size:11px;color:var(--dim)}
.lead-sees{font-size:14px;line-height:1.5;color:var(--text);margin-bottom:6px}
.lead-look{font-size:13.5px;line-height:1.5;color:var(--muted)}
.lab-heart-panel{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);`);

fs.writeFileSync(OUT, html);
console.log(`12-lead applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
