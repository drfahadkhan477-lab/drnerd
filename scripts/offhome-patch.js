#!/usr/bin/env node
/*
 * The offline-download card moves off the home screen.
 *
 *   node scripts/offhome-patch.js <in.html> <out.html>
 *
 * WHY IT HAD TO MOVE, measured rather than felt. The landscape home grid
 * budgets itself exactly one screen and gives all of it to four named areas:
 *
 *     min-height  732px   = 100dvh - navh - sat - 40      (1194x834)
 *     rows        267.9 hero | 136 progress | 0 <- the 1fr spacer | 245 doors
 *                 648.9 + 36 padding = 684.9
 *
 * and then sweeps every OTHER child into implicit rows beyond it, under a rule
 * whose own comment describes it as a fallback for "the story rail and the
 * feed" that had moved to the Chapters page. The offline card inherited that
 * fallback and became 114.5px of guaranteed overflow — not too tall, but
 * outside the budget by construction. verify-home measured 97px over; chain
 * step 81 (heroflex) took it to 47px by fixing the hero's axis, and nothing
 * about the hero could reach the rest: the pearl spans the first three rows,
 * is sized by its own content, and takes back whatever the hero gives up.
 *
 * THE ALTERNATIVE WAS TESTED AND REJECTED. Bringing the tail into the explicit
 * grid and capping the wrap does reach 0px over — but it squashes the hero
 * from 268px to 200px, and because the heart medallion is ALSO sized by
 * viewport width (clamp(132px,16vw,178px)) it then overlaps the ECG strip by
 * 87px where it used to overlap by 19. Nothing clipped, everything uglier, on
 * the exact device this app is held on. The owner chose the move.
 *
 * WHERE IT GOES, AND WHY THERE. Progress already opens with "Saved locally on
 * this device", which is the same subject: what this device is holding. The
 * card lands directly under the four stat tiles, above the retention and
 * calibration panels, so it is the first thing under the summary rather than
 * something to scroll for.
 *
 * WHAT THIS COSTS, said plainly: the card is no longer the thing you see on
 * launch, and it is how a fellow discovers the bank can be pulled down for a
 * flight. That is the trade the owner accepted for a home screen that does not
 * scroll. The single-file build has never had this card at all — every figure
 * is already a data: URI in memory there — so this changes one build only.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/offhome-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

const CARD = `\${offlineCapable()?\`<div class="off-card" id="offlineCard">
      <div class="off-head">
        <span class="off-tag">\${icon('image','icon-sm')} On this device</span>
        <span class="off-val">checking…</span>
      </div>
      <div class="off-track"><span class="off-fill" style="width:0%"></span></div>
      <div class="off-foot">
        <span class="off-note">Pull every figure down once and the bank works with no network at all.</span>
        <button class="off-btn" onclick="offlineDownload()">Download the rest</button>
      </div>
    </div>\`:''}`;

/* ── 1. off the home screen ──────────────────────────────────────────────── */
/* Anchored on the card plus the close of buildHome's template, not on the line
   before it: what precedes the card is the welcome card's own `:''} — welcome
   is a later chain step than offline and inserted itself above it. */
patch('offhome: the home screen stops carrying it',
`    ${CARD}
  </div>\`;
}`,
`  </div>\`;
}`);

/* ── 2. onto Progress, under the tiles ───────────────────────────────────── */
patch('offhome: Progress carries it, directly under the summary tiles',
`      <div class="stat-tile"><div class="st-v">\${dueN}</div><div class="st-l">due now</div></div>
    </div>
    \${retentionTile()}`,
`      <div class="stat-tile"><div class="st-v">\${dueN}</div><div class="st-l">due now</div></div>
    </div>
    ${CARD}
    \${retentionTile()}`);

/* ── 3. and surveys the cache when Progress opens, not when home does ────── */
/* The survey is four hundred cache lookups. Doing them on every visit home to
   populate a card that is no longer there would be pure waste; doing them when
   the card is on screen is the same deferred call it always was. */
patch('offhome: the survey follows the card',
`function mountHero(){
  mountPearlCurrent();
  /* After paint, and never blocking it: four hundred cache lookups are fast
     but they are not free, and nothing on screen is waiting for the answer. */
  if(typeof offlineCapable==='function'&&offlineCapable()&&!offlineJob.busy){
    setTimeout(function(){ offlineSurvey(); },0);
  }`,
`function mountHero(){
  mountPearlCurrent();`);

patch('offhome: Progress asks what is on the device',
`function buildStats(){
  const days=last30();`,
`function buildStats(){
  /* After paint, and never blocking it: four hundred cache lookups are fast
     but they are not free, and nothing on screen is waiting for the answer.
     Here rather than in mountHero because this is where the card is now. */
  if(typeof offlineCapable==='function'&&offlineCapable()&&!offlineJob.busy){
    setTimeout(function(){ offlineSurvey(); },0);
  }
  const days=last30();`);

/* ── the guards ─────────────────────────────────────────────────────────── */
const cards = (html.match(/id="offlineCard"/g) || []).length;
if (cards !== 1) throw new Error(`offhome: expected exactly 1 offline card, found ${cards}`);
/* It has to be inside buildStats and not inside the home markup. Located by
   offset rather than by eye, because both functions are long. */
const statsAt = html.indexOf('function buildStats(){');
const cardAt = html.indexOf('id="offlineCard"');
const homeAt = html.indexOf('function buildHome(){');
if (!(statsAt > -1 && cardAt > statsAt)) {
  throw new Error('offhome: the card did not land inside buildStats');
}
if (homeAt > -1 && cardAt > homeAt && cardAt < statsAt) {
  throw new Error('offhome: the card is still in the home markup');
}
/* Nothing about downloading was deleted along the way — only where it is shown. */
for (const keep of ['offlineDownload', 'offlineSurvey', 'offlineCapable', 'offlineJob']) {
  if (html.indexOf(keep) === -1) throw new Error(`offhome: ${keep} went with the card and should not have`);
}
if ((html.match(/setTimeout\(function\(\)\{ offlineSurvey\(\); \},0\);/g) || []).length !== 1) {
  throw new Error('offhome: the survey is scheduled from more or fewer than one place');
}
applied.push('offhome: one card, on Progress, with its survey and nothing else moved');

fs.writeFileSync(OUT, html);
console.log(`Offline card moved — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
