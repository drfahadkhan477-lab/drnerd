#!/usr/bin/env node
/*
 * The review log learns to diagnose, not just score.
 *
 *   node scripts/calibrate-patch.js <in.html> <out.html>
 *
 * WHAT THE APP COULD NOT SEE. It knew whether an answer was right. It could
 * not tell apart knowing something cold, guessing lucky, being certain and
 * wrong, or knowing the concept and misreading the stem — four different study
 * problems with four different remedies, given one number. The scheduler
 * already decides WHEN a card returns; nothing was watching WHY one keeps
 * failing.
 *
 * Three fields, through one funnel. logReview() is the single point every
 * answer already passes through, and it already carries the right philosophy
 * in its own comment: when `ef` stopped meaning anything, the rows written
 * before that were left honestly empty rather than backfilled with invented
 * history. `ms`, `cf` and `why` inherit that exactly — a row from before this
 * step simply lacks them, and every readout below treats missing as missing.
 *
 * ORDER OF COST. Response time asks the learner for nothing and so is
 * unconditional. Confidence asks for one tap and is skippable — the skip path
 * is the common path, and answering without touching it must cost nothing at
 * all, or the row becomes a gate between the fellow and the question. Miss
 * reasons appear only after a wrong answer, where there is already a reason to
 * pause.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/calibrate-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 0. finish the WebGL recovery ────────────────────────────────────────── */

/* hardening (the previous step) taught heart3d.js to notice a lost context and
   exposed onLost/onRestored for it — and then nothing passed them. Verified
   before writing this: zero callers. So the loss was detected, the loop was
   stopped cleanly, and the heart stayed blank until a reload, which is better
   than spinning on a dead context but is not the fix that step implied.
   Two further things had to move for recovery to be possible at all:
   .heart-3d-active hides the static SVG fallback, and the identity guard at
   the top of mountHeroHeart3d would refuse to re-create while the stale
   instance was still assigned. */
patch('calibrate: a lost WebGL context falls back to the SVG and comes back after',
`  heroHeart3d=Heart3D.create(cv,{rhythm:heroCurrentKind||'sinus',mode:'whole',dark,
    resolution:[40,52,32], distance:26, yaw:0.32, pitch:0.10, autoRotate:true});`,
`  heroHeart3d=Heart3D.create(cv,{rhythm:heroCurrentKind||'sinus',mode:'whole',dark,
    resolution:[40,52,32], distance:26, yaw:0.32, pitch:0.10, autoRotate:true,
    /* Clearing both handles matters as much as showing the fallback: the
       identity guard at the top of this function returns early while a stale
       instance is still assigned to this canvas, so without nulling them a
       restore could not re-mount even when asked. */
    onLost:function(){
      heroHeart3d=null; heroHeart3dCanvas=null;
      document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    },
    onRestored:function(){
      if(S.screen==='home') mountHeroHeart3d();
    }});`);

/* ── 1. response time ────────────────────────────────────────────────────── */

/* Free: it asks the learner for nothing and shows them nothing. The only
   judgement in it is the ceiling — a question left open over lunch is not a
   40-minute deliberation, and letting that land in the log would poison the
   median it exists to inform. Beyond the ceiling the honest value is null,
   which every readout already handles because rows predating this step have
   nulls too. */
patch('calibrate: a question remembers when it appeared',
`function nextQ(){
  toTop();`,
`/* Long enough for a hard vignette with a figure, short enough that a walk
   away from the iPad is not recorded as thinking. */
const ANSWER_MS_CEILING=5*60*1000;
function markShown(){ S.shownAt=Date.now(); }
function answerMs(){
  if(!S.shownAt) return null;
  const d=Date.now()-S.shownAt;
  return (d>=0&&d<=ANSWER_MS_CEILING)?d:null;
}
function nextQ(){
  toTop();`);

patch('calibrate: the clock starts when the question is put up (next)',
`  else{S.qIdx++;restoreQuizState();render();clearAnnounce();focusEl('.q-card');}`,
`  else{S.qIdx++;restoreQuizState();render();clearAnnounce();focusEl('.q-card');markShown();}`);

patch('calibrate: and when going back to one',
`  S.qIdx--;restoreQuizState();render();clearAnnounce();focusEl('.q-card');`,
`  S.qIdx--;restoreQuizState();render();clearAnnounce();focusEl('.q-card');markShown();`);

patch('calibrate: and on the first question of a quiz',
`  render();toTop();clearAnnounce();
}`,
`  render();toTop();clearAnnounce();markShown();
}`);

patch('calibrate: the log records how long the answer took',
`    LOG.push({t:Date.now(), q:q.id, ch:q.ch, g:grade, ok:ok?1:0, m:mode,`,
`    LOG.push({t:Date.now(), q:q.id, ch:q.ch, g:grade, ok:ok?1:0, m:mode,
      /* ms, cf and why are the calibrate step's three signals. A row written
         before it exists simply lacks them — the same honesty the ef comment
         below settled on, rather than backfilling history nobody recorded. */
      ms:answerMs(), cf:(S.answers[S.qIdx]&&S.answers[S.qIdx].cf!=null)?S.answers[S.qIdx].cf:null, why:null,`);

/* ── 2. the analytics module, embedded like every other src/core one ─────── */

const CALIB = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'core', 'calib.js'), 'utf8');

/* The markup lives in functions rather than inline in the quiz template. The
   template is already a nest of backticks; adding two more levels of escaping
   to it would make the next person's edit a guessing game, and these two rows
   are self-contained enough to name. */
const HELPERS = [
  'function cfRowHtml(){',
  '  if(S.answered) return "";',
  '  const a=S.answers[S.qIdx];',
  '  const chips=Calib.BANDS.map(function(b){',
  '    const on = a && a.cf===b.id;',
  '    return \'<button class="cf-chip\'+(on?" on":"")+\'" type="button" data-cf="\'+b.id+\'"\'',
  '      + \' aria-pressed="\'+(on?"true":"false")+\'" onclick="setConfidence(\'+b.id+\')">\'',
  '      + e(b.label) + \'</button>\';',
  '  }).join("");',
  '  return \'<div class="cf-row" role="group" aria-label="How sure are you, before answering?">\'',
  '    + \'<span class="cf-lab">How sure?</span>\' + chips + \'</div>\';',
  '}',
  'function missRowHtml(wasCorrect){',
  '  if(wasCorrect) return "";',
  '  const q=S.questions[S.qIdx];',
  '  let why=null;',
  '  if(q) for(let i=LOG.length-1;i>=0;i--){ if(LOG[i].q===q.id){ why=LOG[i].why; break; } }',
  '  const chips=Calib.REASONS.map(function(r){',
  '    const on = why===r.id;',
  '    return \'<button class="miss-chip\'+(on?" on":"")+\'" type="button" data-why="\'+r.id+\'"\'',
  '      + \' aria-pressed="\'+(on?"true":"false")+\'" onclick="setMissReason(\\\'\'+r.id+\'\\\')">\'',
  '      + e(r.label) + \'</button>\';',
  '  }).join("");',
  '  return \'<div class="miss-row" role="group" aria-label="Why did you miss it?">\'',
  '    + \'<span class="miss-lab">Why did you miss it?</span>\' + chips + \'</div>\';',
  '}',
  /* Toggling classes directly rather than re-rendering: render() rebuilds the
     screen, which would move focus and restart every entrance animation for a
     one-bit change the learner made deliberately. Tapping the same chip again
     clears it — a row you cannot escape after an accidental tap is a trap. */
  'function setConfidence(n){',
  '  if(S.answered) return;',
  '  const a=S.answers[S.qIdx]||(S.answers[S.qIdx]={selected:null,rated:false,cf:null});',
  '  a.cf = (a.cf===n) ? null : n;',
  '  document.querySelectorAll(".cf-chip").forEach(function(el){',
  '    const on = String(a.cf)===el.dataset.cf;',
  '    el.classList.toggle("on", on);',
  '    el.setAttribute("aria-pressed", on?"true":"false");',
  '  });',
  '}',
  /* Updates the row logReview already wrote. A second row would be double
     counting: every accuracy figure in the app sums over these, so an extra
     row per tagged miss would quietly deflate all of them. */
  'function setMissReason(k){',
  '  const q=S.questions[S.qIdx]; if(!q) return;',
  '  let hit=-1;',
  '  for(let i=LOG.length-1;i>=0;i--){ if(LOG[i].q===q.id){ hit=i; break; } }',
  '  if(hit<0) return;',
  '  LOG[hit].why = (LOG[hit].why===k) ? null : k;',
  '  document.querySelectorAll(".miss-chip").forEach(function(el){',
  '    const on = LOG[hit].why===el.dataset.why;',
  '    el.classList.toggle("on", on);',
  '    el.setAttribute("aria-pressed", on?"true":"false");',
  '  });',
  '  try{ saveLogSoon(); }catch(_){}',
  '}',
].join('\n');

patch('calibrate: calib.js and the two rows it feeds are embedded whole',
`function logReview(q,grade,ok,mode){`,
CALIB + '\n' + HELPERS + '\nfunction logReview(q,grade,ok,mode){');

/* ── 3. where the two rows appear ────────────────────────────────────────── */

patch('calibrate: styles for the confidence and miss-reason rows',
`.chips{display:flex;flex-wrap:wrap;gap:7px 9px;padding:0 18px 12px}`,
`.chips{display:flex;flex-wrap:wrap;gap:7px 9px;padding:0 18px 12px}
/* Deliberately quieter than the options. This is an aside the fellow may
   ignore entirely, not a second question competing with the first. */
.cf-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:0 18px 10px}
.cf-lab,.miss-lab{font-size:var(--t-tiny);color:var(--muted)}
.cf-chip,.miss-chip{font-size:var(--t-tiny);color:var(--muted);background:var(--card);
  border:1px solid var(--border);border-radius:999px;padding:5px 11px;cursor:pointer;
  transition:border-color .18s,color .18s,background .18s}
.cf-chip.on,.miss-chip.on{color:var(--accent);border-color:var(--accent);background:var(--teal4)}
.miss-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:14px}
.miss-lab{width:100%}`);

patch('calibrate: the confidence row sits above the options, while unanswered',
`    <div class="opts">\${opts}</div>`,
`    \${cfRowHtml()}
    <div class="opts">\${opts}</div>`);

patch('calibrate: the reasons sit under the answer distribution, when wrong',
`<div class="dist-title">Answer Distribution</div>\${distRows}`,
`<div class="dist-title">Answer Distribution</div>\${distRows}\${missRowHtml(ok)}`);

/* Without this, answering would drop the confidence just given — logReview
   reads it first so the log row is right either way, but going back to the
   question would show an empty row. */
patch('calibrate: answering keeps the confidence rather than overwriting it',
`S.selected=idx;S.answered=true;S.answers[S.qIdx]={selected:idx,rated:false};save();render();`,
`S.selected=idx;S.answered=true;
  S.answers[S.qIdx]={selected:idx,rated:false,
    cf:(S.answers[S.qIdx]&&S.answers[S.qIdx].cf!=null)?S.answers[S.qIdx].cf:null};
  save();render();`);

/* THE ONE THING THIS STEP HAD TO FIX IN EXISTING CODE. restoreQuizState
   inferred "answered" from the mere existence of an S.answers entry, which was
   sound while only selectOpt ever created one. setConfidence now creates one
   BEFORE the question is answered, so without this, rating your confidence and
   navigating away would bring you back to a question marked answered — with
   the correct answer revealed, for a question you never answered.

   Behaviour-preserving for every path that predates this step: the only entry
   selectOpt ever wrote carries a numeric `selected`, so `!!a` and
   `a.selected != null` agreed everywhere before now. */
patch('calibrate: a question is answered when it was answered, not when it was rated',
`  S.answered=!!a;`,
`  S.answered=!!(a && a.selected!=null);`);


/* ── 5. what the three signals become on the Progress screen ─────────────── */

const PANEL = [
  'function pct(x){ return Math.round(x*100)+"%"; }',
  'function secs(ms){ return ms==null?"—":(ms<10000?(ms/1000).toFixed(1):Math.round(ms/1000))+"s"; }',
  /* Returns "" until there is something true to say. A panel of em-dashes on
     day one teaches nothing and makes the screen look broken. */
  'function calibPanel(){',
  '  const cal=Calib.calibration(LOG), sp=Calib.speed(LOG), rs=Calib.reasons(LOG);',
  '  if(!cal.rated && !sp.n && !rs.tagged) return "";',
  '  const bars=cal.bands.map(function(b){',
  '    const w = b.accuracy==null ? 0 : Math.round(b.accuracy*100);',
  '    const val = b.accuracy==null ? ("needs "+(Calib.MIN_SAMPLES-b.n)+" more") : pct(b.accuracy);',
  '    return \'<div class="cb-row"><span class="cb-lab">\'+e(b.label)+\'</span>\'',
  '      + \'<span class="cb-track"><span class="cb-fill" style="width:\'+w+\'%"></span></span>\'',
  '      + \'<span class="cb-val\'+(b.accuracy==null?" cb-thin":"")+\'">\'+e(val)+\'</span></div>\';',
  '  }).join("");',
  /* The headline. Null rather than 0 when unknown — 0 would read as "never
     wrong", which is the opposite of the truth it is standing in for. */
  '  const head = cal.certainButWrong==null',
  '    ? \'<div class="cb-head cb-thin">Rate a few more answers and this will show how often "Certain" was wrong.</div>\'',
  '    : \'<div class="cb-head">Certain, and wrong: <b>\'+pct(cal.certainButWrong)+\'</b>\'',
  '      + \'<span class="cb-sub">the gap you cannot feel from the inside</span></div>\';',
  '  const speed = !sp.enough ? \'<div class="cb-thin">Not enough timed answers yet.</div>\'',
  '    : \'<div class="cb-row2">Correct in <b>\'+secs(sp.correctMs)+\'</b> · wrong in <b>\'+secs(sp.wrongMs)+\'</b>\'',
  '      + (sp.fragile ? \'<span class="cb-sub">right, but slower than your wrong answers — the concept is there, the retrieval is not yet</span>\' : "")',
  '      + \'</div>\';',
  '  const mix = !rs.enough ? \'<div class="cb-thin">\'+(rs.misses? "Tag a few misses and the pattern shows here." : "No misses recorded.")+\'</div>\'',
  '    : rs.counts.filter(function(c){return c.n;}).sort(function(a,b){return b.n-a.n;}).map(function(c){',
  '        return \'<div class="cb-row"><span class="cb-lab">\'+e(c.label)+\'</span>\'',
  '          + \'<span class="cb-track"><span class="cb-fill" style="width:\'+Math.round(c.share*100)+\'%"></span></span>\'',
  '          + \'<span class="cb-val">\'+pct(c.share)+\'</span></div>\';',
  '      }).join("");',
  '  return \'<div class="panel"><div class="panel-h">Calibration · \'+cal.rated+\' rated</div>\'',
  '    + head + bars',
  '    + \'<div class="panel-h cb-h2">Pace</div>\' + speed',
  '    + \'<div class="panel-h cb-h2">Where the misses come from</div>\' + mix',
  '    + \'</div>\';',
  '}',
].join('\n');

patch('calibrate: the Progress screen reads the three signals back',
`function buildStats(){`,
PANEL + '\nfunction buildStats(){');

patch('calibrate: and the panel sits with the other progress panels',
`    \${retentionTile()}`,
`    \${retentionTile()}
    \${calibPanel()}`);

patch('calibrate: styles for the calibration panel',
`.miss-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:14px}`,
`.miss-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:14px}
.cb-head{font-size:var(--t-body);color:var(--text);padding:2px 0 10px}
.cb-head b{color:var(--danger)}
.cb-sub{display:block;font-size:var(--t-tiny);color:var(--muted);margin-top:3px}
.cb-h2{margin-top:16px}
.cb-row{display:flex;align-items:center;gap:9px;padding:3px 0}
.cb-row2{font-size:var(--t-meta);color:var(--text);padding:2px 0}
.cb-lab{font-size:var(--t-tiny);color:var(--muted);width:9.5em;flex:none}
.cb-track{flex:1;height:7px;border-radius:999px;background:var(--border);overflow:hidden}
.cb-fill{display:block;height:100%;background:var(--accent);border-radius:999px}
.cb-val{font-size:var(--t-tiny);color:var(--muted);width:6.5em;text-align:right;flex:none}
.cb-thin{font-size:var(--t-tiny);color:var(--muted);padding:2px 0}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('calibrate-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
