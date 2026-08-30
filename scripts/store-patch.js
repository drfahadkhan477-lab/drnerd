#!/usr/bin/env node
/*
 * The four stores that outgrew localStorage, and two things beside them.
 *
 *   node scripts/store-patch.js <input.html> <output.html>
 *
 * Everything this app keeps lived in localStorage — a ~5 MB cliff shared by
 * every key — and four of those keys have no ceiling at all: the Pencil ink,
 * the chat threads, the review log and the sticky notes. The cliff is not
 * theoretical. When it arrives setItem throws, the app toasts once, and every
 * write after that fails in silence: annotations made that evening are simply
 * not there the next morning.
 *
 * src/core/store.js does the moving, and it is deliberately the same shape as
 * refassets.js — IndexedDB with an in-memory mirror, because the code that
 * reads this is synchronous and cannot await a database. Read that file's
 * header for the boot ordering and the migration's copy-verify-delete rule.
 * This patch is only the wiring.
 *
 * TWO OTHER THINGS, HERE BECAUSE THEY ARE ABOUT THE SAME WRITES:
 *
 *   · save() — the one that persists your statistics and all 639 FSRS cards —
 *     had a bare catch and no warning at all, while saveJSON at least toasted
 *     once. So the single store whose loss you would most want to hear about
 *     was the one that died without a word.
 *
 *   · The review log has been recording nothing useful since FSRS landed. It
 *     writes `ef: c.ef`, and an FSRS card is {difficulty, stability, ivl, reps,
 *     lapses, due, last} — ef was SM-2's. Every row since the migration has an
 *     empty field where the description of the card should be, and the whole
 *     point of the log is to have that history to fit parameters against later.
 *     Old rows stay as they are; they are honestly empty and rewriting them
 *     would be inventing data.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/store-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

const STORE_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'store.js'), 'utf8');

/* ── 1. the module, above the first thing that reads through it ──────────── */
patch('store: the module itself',
`/* ══════════ Apple-Pencil annotation · sticky notes · local persistence ══════════ */`,
`${STORE_JS}
/* ══════════ Apple-Pencil annotation · sticky notes · local persistence ══════════ */`);

/* ── 2. one pair of functions, routed ────────────────────────────────────── */
patch('store: loadJSON and saveJSON go through it',
`function loadJSON(k,d){ try{return JSON.parse(localStorage.getItem(k))||d;}catch(_){return d;} }
function saveJSON(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch(_){ warnStorage(); } }`,
`/* Store answers synchronously for every key. The four large ones come from
   IndexedDB once it has hydrated and from localStorage before that; everything
   else passes straight through to localStorage exactly as it always did. */
function loadJSON(k,d){ return Store.get(k,d); }
function saveJSON(k,v){ if(!Store.set(k,v)) warnStorage(); }`);

/* ── 3. and the app re-reads once the database answers ───────────────────── */
patch('store: pick the real data up when it arrives',
`applyTheme();
/* After applyTheme so the first paint is already right, and before render so
   a flip during boot is not missed. */
watchSystemTheme();
render();`,
`applyTheme();
/* After applyTheme so the first paint is already right, and before render so
   a flip during boot is not missed. */
watchSystemTheme();
render();
/* THE DATABASE ANSWERS AFTER THE APP HAS ALREADY BOOTED. Boot is not gated on
   it — a browser with IndexedDB disabled would then show a blank app instead
   of a working one — so the app starts from whatever localStorage still held
   and picks the real stores up here. On every device I can measure this lands
   inside the splash, so there is nothing to see. */
Store.ready().then(()=>{
  /* Re-render only if the database actually held something the app did not
     already have. On a first launch, and on every launch where the migration
     has nothing left to do, this changes nothing — and an unconditional
     render() here is real work on a cold, throttled CPU, landing while the
     splash is still waiting on its own dismissal timer. It delayed the splash
     past its removal on about one launch in three. Key names rather than a
     serialisation: comparing megabytes of ink to decide whether to repaint
     would cost more than the repaint. */
  const mark=()=>Object.keys(INK).join()+'|'+Object.keys(NOTES).join()+'|'+
                 Object.keys(CHATS).join()+'|'+LOG.length;
  const was=mark();
  INK=Store.get(INK_KEY,{}); NOTES=Store.get(NOTE_KEY,{});
  CHATS=Store.get(AI_CHAT,{}); LOG=Store.get(LOG_KEY,[]);
  if(mark()===was) return;
  try{ render(); }catch(_){}
  try{ if(document.getElementById('shell').classList.contains('ai-open')) buildAI(); }catch(_){}
}).catch(()=>{});`);

/* ── 4. the store that failed most quietly ───────────────────────────────── */
patch('store: say when the scheduling could not be written',
`  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup}));}catch(_){}}`,
`  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup}));}
  /* This holds the statistics and all 639 FSRS cards. It had a bare catch, so
     the one store whose loss you would most want to hear about was the only
     one that died without a word. */
  catch(_){ warnStorage(); }}`);

/* ── 5. an imported thread is loaded, not just written ───────────────────── */
patch('store: importing a backup restores the chats to the running app',
`        if(d.chat) saveJSON('accsap12.chat',d.chat);`,
`        /* Every other line here updates the live variable as well as the
           store; this one only wrote, so a restored backup's conversations
           did not appear until the app was next launched. */
        if(d.chat){ CHATS=d.chat; saveJSON('accsap12.chat',CHATS); }`);

/* ── 6. and the log records the card it is describing ────────────────────── */
patch('store: the review log describes an FSRS card, not an SM-2 one',
`      ef:c?Math.round(c.ef*100)/100:null, ivl:c?c.ivl:0, reps:c?c.reps:0,`,
`      /* ef was SM-2's ease factor and an FSRS card has never had one, so this
         wrote an empty field on every review since the scheduler changed —
         in the log that exists precisely to fit parameters to real history.
         d and s are difficulty and stability, the two numbers that describe
         the card. Rows written before this are honestly empty; rewriting them
         would be inventing history that was not recorded. */
      d:(c&&isFinite(c.difficulty))?Math.round(c.difficulty*100)/100:null,
      s:(c&&isFinite(c.stability))?Math.round(c.stability*100)/100:null,
      ivl:c?c.ivl:0, reps:c?c.reps:0,`);

fs.writeFileSync(OUT, html);
console.log(`Off the localStorage cliff — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
