#!/usr/bin/env node
/*
 * The saved blob says what shape it is, and an older build stops eating the
 * newer one's fields.
 *
 *   node scripts/schema-patch.js <in.html> <out.html>
 *
 * THE BUG THIS PREVENTS IS DATA LOSS, AND IT IS NOT HYPOTHETICAL. Systole is a
 * single HTML file you copy to your own devices, so two copies at different
 * versions on an iPad and a laptop is the normal case, not the edge case. Add
 * a field to the saved blob in some future step and the sequence is:
 *
 *   the new build writes  {..., somethingNew: [...]}
 *   the old build loads it, knows nothing about somethingNew, ignores it
 *   the old build saves — writing the object literal it was built with
 *   somethingNew is gone, silently, permanently
 *
 * The fix is not a version check that refuses to load. Refusing would mean a
 * fellow who opened the older copy sees an empty progress screen, which is a
 * worse day than the one we are preventing. The fix is that save() preserves
 * what it did not recognise: fields this build never heard of are carried
 * through untouched, so an old build can read, write, and hand the store back
 * intact. Forward compatibility is cheap when it is designed in and impossible
 * to retrofit once someone's history is already gone.
 *
 * DATA_SCHEMA_VERSION exists so the situation is legible rather than merely
 * survivable. The key is already called accsap12.v2, which is a version
 * baked into a key name — and a version in a key name can only ever be
 * changed by orphaning everything written under the old one. A number inside
 * the blob can be read, compared, and migrated from.
 *
 * WHAT THE SHIPPED CODE SAYS, AND WHAT IT DOES NOT. The app carries three
 * declarations and a pointer back here; the reasoning stays in this file.
 * That is not only a size decision, though the split shell is on a budget and
 * this is the fourth change in a row to press against it — it is where chain
 * documentation belongs, the same division figzoom-patch.js makes when it says
 * the maths is not here. The three declarations are: DATA_SCHEMA_VERSION (the
 * shape of the blob, bumped when a stored field is added, removed, or changes
 * meaning — never when only the way a value is computed changes); SCHEMA_KEYS
 * (exactly what save() writes, kept as a fixed list rather than derived,
 * because it is compared against blobs from builds that wrote more, and
 * "everything else" is meaningless without a fixed "everything this build
 * knows"); and FOREIGN (what a newer build wrote, held from load() to save()).
 *
 * NOT THE SAME NUMBER AS THE ONE ON A CARD. src/core/fsrs.js stamps `sv` on
 * every card: which SCHEDULER produced that schedule. This is `schemaVersion`
 * on the blob as a whole: which SHAPE the stored object is in. They move for
 * different reasons — new FSRS weights bump one, a new stored field bumps the
 * other — and collapsing them into one number would mean every weight change
 * looked like a schema change.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/schema-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('schema: the blob is versioned, and a stranger field survives a round trip',
`const KEY='accsap12.v2';
function save(){try{localStorage.setItem(KEY,JSON.stringify({
  chStats:S.chStats,missed:[...S.missed],theme:S.theme,homeLayout:S.homeLayout,
  sessionCorrect:S.sessionCorrect,sessionTotal:S.sessionTotal,
  srs:S.srs,reviewStreak:S.reviewStreak,lastReviewDay:S.lastReviewDay,daily:S.daily,
  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup}));}`,
`const KEY='accsap12.v2';

/* Shape of the object under KEY; the fields this build writes; and the fields
   a NEWER build wrote that this one must carry through untouched rather than
   drop. Why, at length, in scripts/schema-patch.js. */
const DATA_SCHEMA_VERSION=1;
const SCHEMA_KEYS=['schemaVersion','chStats','missed','theme','homeLayout',
  'sessionCorrect','sessionTotal','srs','reviewStreak','lastReviewDay','daily',
  'practice','sinceBackup','lastBackup'];
let FOREIGN={};

function save(){try{localStorage.setItem(KEY,JSON.stringify(Object.assign({},FOREIGN,{
  schemaVersion:DATA_SCHEMA_VERSION,
  chStats:S.chStats,missed:[...S.missed],theme:S.theme,homeLayout:S.homeLayout,
  sessionCorrect:S.sessionCorrect,sessionTotal:S.sessionTotal,
  srs:S.srs,reviewStreak:S.reviewStreak,lastReviewDay:S.lastReviewDay,daily:S.daily,
  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup})));}`);

patch('schema: load keeps what it did not recognise, and says so once if the data is ahead',
`function load(){try{return JSON.parse(localStorage.getItem(KEY))||{};}catch(_){return{};}}`,
`function load(){try{
  const raw=JSON.parse(localStorage.getItem(KEY))||{};
  /* No schemaVersion means a store written before this step — every store in
     the wild today, and its shape is exactly version 1. Left unstamped until
     the next save rather than backfilled. */
  FOREIGN={}; for(const k in raw) if(SCHEMA_KEYS.indexOf(k)===-1) FOREIGN[k]=raw[k];
  /* Deferred past the splash, which is still up at boot. */
  if(+raw.schemaVersion>DATA_SCHEMA_VERSION)
    setTimeout(()=>toast('This copy of Systole is older than the data saved on this device. Nothing has been lost — update this copy to see everything.'),4200);
  return raw;
}catch(_){return{};}}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('schema-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
