#!/usr/bin/env node
/*
 * Build Systole — the whole patch chain, in order, in one command.
 *
 *   node scripts/build.js [source.html] [options]
 *
 *   --out <path>   where the finished single file goes   (default build/systole.html)
 *   --keep         keep every intermediate step on disk   (default: only the last)
 *   --from <step>  resume from a step, reusing build/ from a previous --keep run
 *   --list         print the chain and exit
 *
 * WHY THIS EXISTS. The app is built by applying fifty-six patch scripts to the
 * ACCSAP export, each one asserting that every edit it makes matches exactly
 * once. That design is deliberate — a patch that silently matches zero times is
 * a feature that quietly disappeared — but it left the ORDER of the chain
 * living nowhere except in the head of whoever ran it last. Run two steps out
 * of order and you get a confusing "expected exactly 1 match, found 0" from a
 * script that is perfectly correct.
 *
 * So the order lives here, once, and it is the only place it lives.
 *
 * THE SOURCE FILE IS NOT IN THIS REPOSITORY, and must never be. It is the
 * licensed ACCSAP 12 export: 638 questions and 408 figures belonging to the
 * American College of Cardiology. It stays on your own devices. Point this
 * script at your copy, or drop it in source/ and it will be found.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* ── the chain ────────────────────────────────────────────────────────────────
   Order matters, and the dependencies are real rather than stylistic:

     stage0        stabilises the raw export — everything else assumes it
     keys          six answer keys the export gets wrong; before anything reads them
     flags         two questions whose lettered answer panels the export never
                   shipped; flagged beside keys, for the same reason
     apex          embeds heart3d.js and apex.js (the ONLY place heart3d enters)
     stage2/3      FSRS scheduling, then Apex's vision and memory
     polish        the rhythm registry the hero and the lab both read
     splash        the pre-paint loading screen
     braunwald     the grounded reference library
     art           the design pass the later panels sit inside
     leads         the 12-lead — needs art's panel styles
     physio        the cardiac cycle — anchors on the 12-lead's embed comment
     name          Systole
     theme         palettes — must follow name (it restyles the hero wordmark)
     home          the welcome bar, progress bar and layouts
     splash-heart  the crystal heart, into the splash markup from earlier
     crisp         the device-pixel ceilings
     scale         the spacing scale and the bar reveals
     type          the modular type scale, snapped over everything above
     lab           removes the lab's 3D heart — late, so every earlier step's
                   version of the code it deletes is the final one
     review        fixes from the full code review, last
     refs          ships content/refs/*.md already loaded as a note seed
     read          notes and Apex replies render as prose, not their own source
     ref-images    figures the notes cite render for real, and reach Apex's eyes
     gemini        a free provider that still sees a figure, alongside Groq and Claude
     memory        what Apex knows about the fellow, kept across sessions
     assets        an imported chapter brings its own figures — after memory,
                   because it embeds beside that module and rewrites the
                   importer, the renderer and the vision path it all sits on
     chatfigs      the figure Apex is reasoning from appears in the answer —
                   after assets and ref-images, whose work it rewrites
     pearl         the hero teaches something, from the notes already on the shelf
     homeflow      the home screen is three things — the trace, the pearl, the
                   progress — and everything else moves behind a door
     pearlcard     the pearl becomes a ladder on ECG paper — last, because it
                   rewrites markup and styles that pearl and homeflow both set
     offline       one press puts all 408 figures on the device — after
                   homeflow, whose door row it sits under
     pvloop        the pearl's strip becomes the pressure–volume loop the
                   cardiac-cycle screen already computes — last, it restyles
     fullbleed     the bar leaves the reading column so it reaches both edges
                   of an iPad, and reserves the strip the status bar sits in
     figview       a figure opens full size, and closes four ways — last,
                   because it hangs a viewer on markup every earlier step set
     slowcycle     the cardiac cycle runs at a fraction of real time, and says
                   so rather than redefining the heart rate
     hosted        Gemini moves behind the Cloudflare Worker; Groq and Anthropic
                   stay bring-your-own-key — last, it rewrites gemini's own work
     split         Apex sits beside the question in landscape and under it in
                   portrait, instead of covering it
     boundary      a retrieved note is fenced with a per-turn nonce and named as
                   data — after every earlier retrieval step, because it wraps
                   the text they produce
     toolfence     the same fence on the channel the model opens itself, and an
                   error stops being something Apex said — after boundary,
                   whose refBlock and refSafe it reuses rather than reinventing
     chatfix       the panel keeps what you typed and where you were reading,
                   and stops re-sending a thread that only grows
     autotheme     'auto' notices the system flipping, so the heart, the
                   12-lead and the cycle follow it rather than waiting for a
                   reload
     store         ink, notes, chats and the review log move to IndexedDB —
                   after every step that reads or writes through loadJSON
     homewide      the home screen fills a landscape iPad instead of sitting in
                   a 960px column with 406px of dead space either side
     pearlrich     a pearl is a whole thought, over a travelling ECG current
                   instead of a corner PV loop — after homewide, which is what
                   gives it a tall column to be long in
     apexroom      the tutor panel is spacious, its chips are behind a button,
                   and it scrolls on iOS
     mistral       Groq and Anthropic leave, Mistral arrives bring-your-own-key
                   and vision-capable — genuinely last, it revises code that
                   apex, gemini, hosted, memory, ref-images, toolfence, chatfix
                   and apexroom all touched
     guards        the quiz keyboard steps aside for a focused SELECT — after
                   apexroom, which is what puts a <select> over the quiz screen
     chipfix       apexroom hid .chips globally to fold the tutor's prompts
                   away; the Lab and the search screen share that class and
                   lost their rows. Scoped to #aiChips — after apexroom
     quiznav       a Previous button, and the per-question memory that makes
                   going back safe without re-grading or re-scheduling
     homeprog       the home screen's progress bar becomes a card: a legend,
                   a due-review pill, numbers that count up with the fill
     chapters       the Chapters grid finally uses its own stagger timing,
                   the bar transition gets a starting point to run from
     studyflow      the Signal/Focus/Grid switcher removed — it only ever
                   affected Chapters despite the name — and the page's
                   sections cascade in like the home screen's do
     welcome       one dismissable line under the doors naming Chapters and
                   Apex, for a first-time reader only — after homeflow, whose
                   door row it sits beneath, and never shown to anyone whose
                   scheduler or review log says they have been here before
     streamthrottle a streaming reply repaints on animation frames, not on
                   every network chunk — after mistral and gemini, whose
                   oneTurn* functions it wraps a shared painter around
     contrastfix   the 46 sites using --dim for text anyone is expected to
                   read move to the already-AA --muted, and every
                   interactive element gets a :focus-visible ring
     failsafe      render() throwing stops meaning a blank or frozen
                   screen — last, so it wraps every earlier step's own
                   version of render() and boot's own render() call
     semantictokens the accent/success/danger/warning names become
                   canonical in the root block and (accent only) the five
                   named palettes; --teal, --teal2, --green, --green2,
                   --red, --red2, --amber and --amber2 become pure var()
                   aliases — after failsafe, rewriting theme's own settled
                   literal values
     splashtiming  the rhythm trace waits for the heart to settle instead
                   of sweeping in parallel with it — a one-line
                   animation-delay, after splash-heart, whose 1s settle it
                   now sequences after
     haptics       a felt pulse alongside the correct/wrong feedback
                   selectOpt already draws — after splashtiming, no
                   dependency, just kept at the tail with the others
     designfollowup two small fixes found and deliberately deferred during
                   the design pass: --warn/--warn-bg/--warn-b become real
                   aliases instead of four independently-restated literals
                   (also fixing a latent auto+dark mismatch), and the
                   heart gets its own @keyframes back instead of losing to
                   spWord/spSub's later-declared, same-named spRise
     disclaimer    the app says what it is — an educational board-review tool,
                   not clinical decision support — in both of the Apex
                   panel's states and on the Progress screen (not the home
                   screen: verify-home.js's no-scroll guarantee for an
                   11-inch iPad is the design, and a fourth block is what it
                   exists to refuse), and gains the <main> and <h1>
                   landmarks it had been missing entirely
     announce      the quiz says what just happened: aria-pressed reports the
                   user's own selection instead of the answer key (it was
                   announcing the correct option as pressed), a permanent live
                   region outside #app speaks the verdict, focus follows the
                   reading order, ArrowLeft finally reaches the Previous
                   button quiznav shipped without a key, and the last --dim
                   on read text moves to --muted
     curate        the double-tap trap stops being document-wide (it was
                   swallowing pinch and double-tap zoom on figures), the hero
                   rotation stops while the page is hidden, the question card
                   gains the accessible name it needed once it started taking
                   focus, and two names that lied — reviewQueue's "cap", and
                   "storage marked persistent" — start telling the truth.
                   The CME boilerplate this round also found is NOT here: it is
                   content, so it lives in flags-patch.js where a content fix
                   survives re-extraction.
     calibrate     the review log stops recording only right-or-wrong: how long
                   the answer took, how sure the fellow was before they gave
                   it, and — after a miss — why they think they missed it.
                   Three fields through logReview's one funnel, plus calib.js
                   to read them back as calibration, pace and error mix on the
                   Progress screen. Also finishes the WebGL context recovery
                   `hardening` left half-wired, and fixes restoreQuizState
                   inferring "answered" from an S.answers entry existing —
                   which this step would otherwise have turned into a revealed
                   answer for a question nobody answered.
   ────────────────────────────────────────────────────────────────────────── */
const CHAIN = [
  'stage0', 'keys', 'flags', 'apex', 'stage2', 'stage3', 'polish', 'splash', 'braunwald',
  'art', 'leads', 'physio', 'name', 'theme', 'home', 'splash-heart', 'crisp', 'scale', 'type', 'lab', 'review',
  'refs', 'read', 'ref-images', 'gemini', 'memory', 'assets', 'chatfigs', 'pearl', 'homeflow',
  'pearlcard', 'offline', 'pvloop', 'fullbleed', 'figview', 'slowcycle', 'hosted',
  'split', 'boundary', 'toolfence', 'chatfix', 'autotheme', 'store',
  'homewide', 'pearlrich', 'apexroom', 'mistral', 'guards', 'chipfix', 'quiznav', 'homeprog', 'chapters',
  'studyflow', 'welcome', 'streamthrottle', 'contrastfix', 'failsafe',
  'semantictokens', 'splashtiming', 'haptics', 'designfollowup', 'disclaimer', 'announce',
  'curate', 'calibrate',
];

/* ── arguments ───────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name, fb) => { const i = argv.indexOf(name); return i > -1 && argv[i + 1] ? argv[i + 1] : fb; };
/* Everything that is neither a flag nor a flag's value. */
const VALUED = ['--out', '--from'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));

if (flag('--list')) {
  console.log('The chain, in order:\n');
  CHAIN.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.padEnd(14)} scripts/${s}-patch.js`));
  process.exit(0);
}

const OUT = path.resolve(opt('--out', path.join(ROOT, 'build', 'systole.html')));
const WORK = path.join(ROOT, 'build');
const KEEP = flag('--keep');
const FROM = opt('--from', null);
if (FROM && !CHAIN.includes(FROM)) {
  console.error(`--from ${FROM}: not a step. Run with --list to see the chain.`);
  process.exit(1);
}

/* ── find the source export ──────────────────────────────────────────────── */
function findSource() {
  if (positional[0]) return path.resolve(positional[0]);
  if (process.env.SYSTOLE_SRC) return path.resolve(process.env.SYSTOLE_SRC);
  const candidates = [];
  for (const dir of [path.join(ROOT, 'source'), ROOT]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.html?$/i.test(f) && /accsap/i.test(f)) candidates.push(path.join(dir, f));
    }
  }
  /* Newest first: successive exports sort sensibly and you almost always want
     the one you just downloaded. */
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

const SRC = findSource();
if (!SRC || !fs.existsSync(SRC)) {
  console.error([
    '',
    'Could not find the ACCSAP export to build from.',
    '',
    '  It is the licensed question bank and is deliberately not in this repository.',
    '  Give it explicitly, set SYSTOLE_SRC, or drop it in source/:',
    '',
    '    node scripts/build.js ~/Downloads/ACCSAP_12_super_v12.html',
    '    SYSTOLE_SRC=~/path/to/export.html node scripts/build.js',
    '    mkdir -p source && cp ~/Downloads/ACCSAP*.html source/',
    '',
  ].join('\n'));
  process.exit(1);
}

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const mb = b => (b / 1048576).toFixed(2) + ' MB';
const stepFile = s => path.join(WORK, `${s}.html`);

console.log(`\nBuilding Systole`);
console.log(`  source  ${SRC}  (${mb(fs.statSync(SRC).size)})`);
console.log(`  output  ${OUT}\n`);

let input = SRC;
let started = !FROM;
const t0 = Date.now();
const report = [];

for (const step of CHAIN) {
  const out = stepFile(step);
  if (!started) {
    if (step === FROM) started = true;
    else {
      if (!fs.existsSync(out)) {
        console.error(`--from ${FROM} needs ${path.relative(ROOT, out)}, which is not there.\n` +
                      `  Intermediates are cleaned up unless you ask for them — run a full build with --keep first.`);
        process.exit(1);
      }
      input = out;
      console.log(`  ${'·'} ${step.padEnd(14)} reused`);
      continue;
    }
  }

  const t = Date.now();
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [path.join(__dirname, `${step}-patch.js`), input, out],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (err) {
    console.error(`\n✗ ${step} failed\n`);
    console.error((err.stdout || '') + (err.stderr || ''));
    process.exit(1);
  }
  /* Each patch prints "— N edits"; surface the count so a step that quietly
     shrinks is visible in the build log rather than only in a failing test. */
  const edits = (stdout.match(/—\s*(\d+)\s*edits/) || [])[1];
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  report.push({ step, edits, secs, size: fs.statSync(out).size });
  console.log(`  ✓ ${step.padEnd(14)} ${(edits ? edits + ' edits' : '').padEnd(10)} ${mb(fs.statSync(out).size).padStart(9)}   ${secs}s`);
  input = out;
}

fs.copyFileSync(input, OUT);
if (!KEEP) for (const s of CHAIN) { const f = stepFile(s); if (f !== OUT && fs.existsSync(f)) fs.unlinkSync(f); }

const totalEdits = report.reduce((n, r) => n + (+r.edits || 0), 0);
console.log(`\n  ${totalEdits} edits across ${report.length} steps in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  ${mb(fs.statSync(SRC).size)} → ${mb(fs.statSync(OUT).size)}`);
console.log(`\nwritten: ${OUT}`);
console.log(`\nNext:  node scripts/verify.js ${path.relative(process.cwd(), OUT)}`);
