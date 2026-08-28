#!/usr/bin/env node
/*
 * Put the whole bank on the device, in one press.
 *
 *   node scripts/offline-patch.js <input.html> <output.html>
 *
 * The single-file build is offline by construction: 32 MB with every figure
 * inlined, and nothing to fetch. The split build — the one that can actually
 * be installed from Safari, because iPadOS will not open a local file — is the
 * opposite. Its shell is 559 KB and its 408 figures arrive one at a time, as
 * you meet the questions that use them.
 *
 * That is the right default. It is the wrong behaviour for the way this app is
 * about to be used: served from a laptop over Tailscale, opened on an iPad, and
 * then studied on a ward round with the laptop shut. Under that pattern every
 * figure you have not already met is a broken image, and you find out which
 * ones those are at the worst possible moment.
 *
 * So: a control that walks every figure and pulls it down. Nineteen megabytes,
 * once, on the wifi you are already on — and then the tablet holds the entire
 * bank whether or not the machine that served it still exists.
 *
 * IT DOES NOT OWN A CACHE. The service worker already caches a figure the
 * moment one is fetched, so this only has to REQUEST them; the caching is the
 * same code path, with the same cache name and the same eviction, that a
 * figure met the ordinary way goes through. A downloader that opened its own
 * cache would be a second store to keep in step with the first, and would rot
 * the first time the worker's cache name changed.
 *
 * WHY IT IS ONLY IN THE SPLIT BUILD. In the single file every figure is a
 * data: URI already resident in memory; there is nothing to download and a
 * button offering to would be a lie. build-pwa sets window.SPLIT_BUILD, and
 * the card is rendered only when it is set — an explicit flag rather than
 * sniffing whether IMGS holds URLs or base64, because the honest question here
 * is "which build is this", not "what shape is that variable".
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/offline-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the machinery ────────────────────────────────────────────────────── */
patch('offline: know what is here and fetch what is not',
`function buildHome(){`,
`/* ═══════════ Putting the whole bank on the device ═══════════
   Only meaningful in the split build — see the header of offline-patch.js. */
function offlineCapable(){
  return typeof window!=='undefined' && window.SPLIT_BUILD===true
      && typeof caches!=='undefined' && typeof IMGS!=='undefined';
}
/* Every distinct figure URL the bank references. IMGS is id → array of URLs in
   the split build; a data: URI here would mean the single-file build, where
   this whole feature is inapplicable, so those are filtered rather than
   fetched. */
function offlineFigures(){
  const seen=Object.create(null), out=[];
  try{
    for(const id in IMGS){
      const list=IMGS[id]; if(!list||!list.length) continue;
      for(const u of list){
        if(typeof u!=='string'||u.slice(0,5)==='data:'||seen[u]) continue;
        seen[u]=1; out.push(u);
      }
    }
  }catch(_){ }
  return out;
}
let offlineJob={have:0,total:0,busy:false,stop:false,counted:false};
/* caches.match() with no cache named searches every cache the origin has, so
   this asks the same question the worker's fetch handler asks, without needing
   to know what the worker called its cache. */
async function offlineSurvey(){
  if(!offlineCapable()) return offlineJob;
  const urls=offlineFigures();
  offlineJob.total=urls.length;
  let have=0;
  for(let i=0;i<urls.length;i+=24){
    const batch=urls.slice(i,i+24);
    const hits=await Promise.all(batch.map(u=>caches.match(u).then(r=>!!r).catch(()=>false)));
    have+=hits.filter(Boolean).length;
  }
  offlineJob.have=have; offlineJob.counted=true;
  offlinePaint();
  return offlineJob;
}
/* Six at a time. Enough to saturate a laptop on the same wifi, few enough that
   the tab stays responsive and a phone hotspot is not hammered. */
async function offlineDownload(){
  if(!offlineCapable()||offlineJob.busy) return;
  const urls=offlineFigures();
  offlineJob={have:offlineJob.have,total:urls.length,busy:true,stop:false,counted:true};
  offlinePaint();
  const todo=[];
  for(const u of urls) if(!(await caches.match(u).catch(()=>null))) todo.push(u);
  offlineJob.have=urls.length-todo.length;
  let i=0;
  async function worker(){
    while(i<todo.length&&!offlineJob.stop){
      const u=todo[i++];
      /* The response is discarded on purpose: the worker's fetch handler has
         already put a clone in the cache by the time this resolves, and
         holding 19 MB of decoded image in the tab would be the one way to
         make this feature worse than the problem. A failure is skipped
         rather than fatal — one missing figure is not a reason to abandon
         the other four hundred. */
      try{ const r=await fetch(u,{cache:'no-store'}); if(r.ok) offlineJob.have++; }catch(_){ }
      offlinePaint();
    }
  }
  await Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
  offlineJob.busy=false; offlineJob.stop=false;
  offlinePaint();
}
function offlineStop(){ offlineJob.stop=true; }
/* Repainted in place. render() would remount the hero — an ECG canvas and a
   WebGL heart — several hundred times over the course of a download. */
function offlinePaint(){
  const card=document.getElementById('offlineCard'); if(!card) return;
  const pct=offlineJob.total?Math.round(offlineJob.have/offlineJob.total*100):0;
  const done=offlineJob.counted&&offlineJob.total>0&&offlineJob.have>=offlineJob.total;
  card.classList.toggle('all-here',done);
  const bar=card.querySelector('.off-fill'); if(bar) bar.style.width=pct+'%';
  const val=card.querySelector('.off-val');
  if(val) val.textContent=!offlineJob.counted?'checking…'
    :done?\`all \${offlineJob.total} figures on this device\`
    :\`\${offlineJob.have} of \${offlineJob.total} figures here\`;
  const btn=card.querySelector('.off-btn');
  if(btn){
    btn.textContent=offlineJob.busy?'Stop':done?'Up to date':'Download the rest';
    btn.disabled=!offlineJob.busy&&done;
    btn.onclick=offlineJob.busy?offlineStop:offlineDownload;
  }
}
function buildHome(){`);

/* ── 2. where it lives ───────────────────────────────────────────────────── */
patch('offline: a card under the doors, in the build that needs one',
`        <span class="door-txt"><b>Rhythm Lab</b><i>every trace, drawn live</i></span>
        <span class="door-go">\${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>
  </div>\`;
}`,
`        <span class="door-txt"><b>Rhythm Lab</b><i>every trace, drawn live</i></span>
        <span class="door-go">\${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>
    \${offlineCapable()?\`<div class="off-card" id="offlineCard">
      <div class="off-head">
        <span class="off-tag">\${icon('image','icon-sm')} On this device</span>
        <span class="off-val">checking…</span>
      </div>
      <div class="off-track"><span class="off-fill" style="width:0%"></span></div>
      <div class="off-foot">
        <span class="off-note">Pull every figure down once and the bank works with no network at all.</span>
        <button class="off-btn" onclick="offlineDownload()">Download the rest</button>
      </div>
    </div>\`:''}
  </div>\`;
}`);

patch('offline: survey the cache once the home screen exists',
`function mountHero(){
  mountPearlECG();`,
`function mountHero(){
  mountPearlECG();
  /* After paint, and never blocking it: four hundred cache lookups are fast
     but they are not free, and nothing on screen is waiting for the answer. */
  if(typeof offlineCapable==='function'&&offlineCapable()&&!offlineJob.busy){
    setTimeout(function(){ offlineSurvey(); },0);
  }`);

/* ── 3. how it looks ─────────────────────────────────────────────────────── */
patch('offline: styled as the doors are, since it sits with them',
`/* Two wide doors and four small ones, so the grid closes evenly at every`,
`/* The same glass as the doors, because it sits in their row and is the same
   kind of thing: a control, not something to read. */
.off-card{margin-top:10px;padding:14px 16px;border-radius:16px;
  background:color-mix(in srgb, var(--white) 74%, transparent);
  backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);
  border:1.5px solid var(--border2);
  animation:riseIn .6s var(--glide) .28s both}
.off-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
.off-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;
  letter-spacing:.09em;text-transform:uppercase;color:var(--teal)}
.off-val{font-family:var(--font-mono);font-size:11px;color:var(--dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.off-track{height:6px;border-radius:3px;overflow:hidden;
  background:color-mix(in srgb, var(--teal) 12%, transparent)}
.off-fill{display:block;height:100%;border-radius:3px;
  background:linear-gradient(90deg,var(--teal),var(--teal2));
  transition:width .3s var(--glide)}
.off-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}
.off-note{font-size:11px;line-height:1.45;color:var(--dim);min-width:0}
.off-btn{flex:0 0 auto;padding:8px 14px;border-radius:11px;cursor:pointer;font-family:inherit;
  font-size:13px;font-weight:650;color:var(--white);background:var(--teal);border:0;
  transition:transform .26s var(--spring),opacity .2s}
.off-btn:hover{transform:translateY(-1px)}
.off-btn:disabled{cursor:default;opacity:.55;transform:none;
  background:color-mix(in srgb, var(--teal) 30%, transparent);color:var(--muted)}
/* Nothing left to fetch: the bar is the whole width and the prose stops
   asking for something that has already happened. */
.off-card.all-here .off-note{color:var(--teal)}
@media(max-width:520px){
  .off-foot{flex-direction:column;align-items:stretch}
  .off-btn{width:100%}
}

/* Two wide doors and four small ones, so the grid closes evenly at every`);

fs.writeFileSync(OUT, html);
console.log(`The whole bank, on the device — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
