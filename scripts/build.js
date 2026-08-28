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
 * WHY THIS EXISTS. The app is built by applying twenty patch scripts to the
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
   ────────────────────────────────────────────────────────────────────────── */
const CHAIN = [
  'stage0', 'keys', 'apex', 'stage2', 'stage3', 'polish', 'splash', 'braunwald',
  'art', 'leads', 'physio', 'name', 'theme', 'home', 'splash-heart', 'crisp', 'scale', 'type', 'lab', 'review',
  'refs', 'read', 'ref-images', 'gemini', 'memory', 'assets', 'chatfigs', 'pearl', 'homeflow',
  'pearlcard', 'offline', 'pvloop', 'fullbleed',
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
