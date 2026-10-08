#!/usr/bin/env node
/*
 * Freeze the patch chain's output as the app's source: step 1 of retiring the
 * chain (docs/BUILD.md, "Retiring the patch chain").
 *
 *   node scripts/build.js                     # the chain, as always
 *   node scripts/freeze-shell.js [build/systole.html] [--app app] [--payload content/payload]
 *
 * Runs on the owner's machine: its input is the built file, which carries the
 * licensed bank. It writes:
 *
 *   app/systole.html         the app, every payload replaced by a slot token
 *                            (scripts/app-slots.js). This is what gets committed.
 *   content/payload/*.txt    the payloads (gitignored, like the rest of content/)
 *
 * It writes app/ only when ALL of these hold, and says which failed otherwise:
 *
 *   1. assembling the shell back gives the input byte for byte (sha256);
 *   2. no string of the question bank or the reference seed is in the shell;
 *   3. no base64 run of 2000+ characters is left that no slot claimed;
 *   4. scripts/leak-guard.js passes the shell (its size and payload rules).
 *
 * A shell that fails is written to content/payload/shell.rejected.html, which
 * is gitignored, so it can be looked at without being one `git add` from the
 * history. Nothing here stages or commits anything.
 *
 * The report prints counts, sizes and file names. It never prints the text of
 * a question, a note or a figure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');
const Slots = require('./app-slots.js');

const ROOT = path.join(__dirname, '..');
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

/* `slots` is a parameter so the suite can hand freeze a broken cut and see
   the round-trip check refuse it; nothing else passes one. */
function freeze({ input, appDir, payloadDir, root = ROOT, log = console.log, slots = Slots }) {
  const html = fs.readFileSync(input, 'utf8');
  const { shell, payloads, report } = slots.cut(html, slots.repoSources(root));

  fs.mkdirSync(payloadDir, { recursive: true });
  for (const [name, text] of Object.entries(payloads)) fs.writeFileSync(path.join(payloadDir, name + '.txt'), text);

  const failures = [];
  const back = slots.assemble(shell, slots.repoResolver(payloadDir, root));
  const same = back === html;
  if (!same) failures.push('assembling the shell does not give back the input');
  const scan = slots.leakScan(shell, payloads);
  if (scan.questionText) failures.push(`${scan.questionText} question-bank strings are in the shell (offsets ${scan.offsets.questionText.join(', ')})`);
  if (scan.refText) failures.push(`${scan.refText} reference-seed strings are in the shell (offsets ${scan.offsets.refText.join(', ')})`);
  /* A piece under app/ that the build no longer holds verbatim: the shell cut
     from this build would not cite it, and the piece would be left beside a
     shell that has its text inline. The chain and app/ have parted there, and
     which of the two is right is not something a freeze can decide. */
  if (report.inline.app.length) failures.push(`${report.inline.app.length} carved pieces are not in this build as they stand in app/: ${report.inline.app.join(', ')}`);
  if (scan.base64Runs) failures.push(`${scan.base64Runs} base64 runs of 2000+ characters no slot claimed (offsets ${scan.offsets.base64Runs.join(', ')})`);

  /* leak-guard judges the file by its content here, so it is given a copy
     outside the repository: under content/ its PATH rule would refuse it for
     where it is rather than what it is. The copy is the shell's name, so the
     NAME rule judges what would be committed. */
  const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'systole-freeze-'));
  const checkFile = path.join(checkDir, 'systole.html');
  fs.writeFileSync(checkFile, shell);
  const guard = spawnSync(process.execPath, [path.join(root, 'scripts', 'leak-guard.js'), checkFile], { encoding: 'utf8' });
  fs.rmSync(checkDir, { recursive: true, force: true });
  const staging = path.join(payloadDir, 'shell.rejected.html');
  if (guard.status !== 0) failures.push('leak-guard refuses the shell: ' + (guard.stdout + guard.stderr).trim().split('\n').slice(-3).join(' | '));

  const kinds = k => report.slots.filter(s => s.kind === k);
  log(`input   ${(html.length / 1e6).toFixed(2)} MB  sha256 ${sha(html).slice(0, 16)}`);
  log(`shell   ${(shell.length / 1e3).toFixed(0)} KB`);
  log(`slots   ${kinds('payload').map(s => `${s.name} ${(s.bytes / 1e6).toFixed(2)} MB`).join(', ')}`);
  log(`        ${kinds('src').length} src modules, ${kinds('asset').length} assets read from the repository at assembly`);
  const repeated = kinds('asset').filter(s => s.times > 1);
  if (repeated.length) log(`        claimed at more than one site: ${repeated.map(s => `${s.name} ×${s.times}`).join(', ')}`);
  if (report.inline.src.length) log(`inline  src not found verbatim (a patch edited the embedded copy, src/ changed since the build, or it is not embedded): ${report.inline.src.join(', ')}`);
  if (report.inline.asset.length) log(`inline  assets not found: ${report.inline.asset.join(', ')}`);
  if (kinds('app').length) log(`        ${kinds('app').length} pieces carved into app/ found as they stand`);
  log(`round trip ${same ? 'byte-identical' : 'DIFFERENT'}`);
  log(`scan    question text ${scan.questionText}, reference text ${scan.refText}, unclaimed base64 runs ${scan.base64Runs}`);

  if (failures.length) {
    fs.writeFileSync(staging, shell);
    log('\nNOT FROZEN. The shell is at ' + path.relative(root, staging) + ' (gitignored) for a look:');
    failures.forEach(f => log('  - ' + f));
    return { ok: false, failures, report, scan };
  }
  fs.rmSync(staging, { force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'systole.html'), shell);
  log(`\nfrozen → ${path.relative(root, path.join(appDir, 'systole.html'))}. Nothing is staged; review the diff, then commit app/ yourself.`);
  return { ok: true, failures, report, scan };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
  const input = args.find((a, i) => !a.startsWith('--') && !['--app', '--payload'].includes(args[i - 1])) || path.join(ROOT, 'build', 'systole.html');
  if (!fs.existsSync(input)) { console.error(`no build at ${input}: run npm run build -- path/to/your-export.html first`); process.exit(2); }
  try {
    const r = freeze({ input, appDir: opt('--app', path.join(ROOT, 'app')), payloadDir: opt('--payload', path.join(ROOT, 'content', 'payload')) });
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error('freeze-shell: ' + e.message);
    process.exit(2);
  }
}

module.exports = { freeze };
