#!/usr/bin/env node
/*
 * tools/check-refs.js answers "will this corpus clear the floors the suites
 * enforce?" — and a tool that answers that question wrongly is worse than no
 * tool, because it is consulted precisely when nobody wants to spend 29
 * minutes finding out the hard way.
 *
 *   node tests/verify-refscheck-pure.js
 *
 * So this drives the real tool, as a child process, over corpora built here.
 * Every defect it claims to catch is injected and watched: a tool that reports
 * a clean corpus after reading nothing would otherwise pass every check below
 * by doing nothing at all, which is the failure mode this project is named
 * after.
 *
 * THE FIXTURE IS GENERATED, NOT WRITTEN OUT. The floors include more than 100
 * notes and a median pearl of 220 characters, so a hand-written fixture would
 * be thousands of words of prose maintained beside the real corpus and drifting
 * from it. The template below is built to score: a bolded term, a threshold
 * with a unit, an action word and a discriminator, which is what
 * src/core/pearl.js rewards. Each file varies by index so no two notes are the
 * same string — retrieval is not under test here, but a corpus of 136 identical
 * sentences would make the pearl numbers meaningless.
 *
 * NO COUNT OF CHECKS DEPENDS ON A RESULT. Every ok() below runs on every
 * invocation, whatever the tool reports, because a suite whose size varies with
 * its outcome cannot be counted — tests/verify-stats.js explains why at length.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'check-refs.js');

let passed = 0, failed = 0;
const printed = [];
const say = line => { printed.push(line); console.log(line); };
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  say((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => say('\n── ' + t + ' ──');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'refscheck-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

/* ── a corpus that clears every floor ─────────────────────────────────────── */
const TOPICS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec',
  'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whisky', 'xray', 'yankee', 'zulu',
  'anton', 'berta', 'cesar', 'dora', 'emil', 'fritz', 'gustav', 'heinrich'];

/* Built to score against src/core/pearl.js: bold (+2), a unit threshold (+4),
   an action word (+3), a discriminator (+3) and a length inside 150-450 (+2),
   with fewer than four commas so the list penalty never applies. */
function section(topic, i, n) {
  return `**The ${topic} threshold of ${10 + n} mmHg** should be confirmed on a repeated study within ${n + 2} days ` +
    `rather than accepted from a single reading, because the ${topic} measurement in state ${i} varies with loading ` +
    `conditions and a value recorded once is not a value anybody should act upon in the ${topic} pathway.`;
}

function writeCorpus(dir, opts = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const images = path.join(path.dirname(dir), 'refs-images');
  fs.rmSync(images, { recursive: true, force: true });
  fs.mkdirSync(images, { recursive: true });
  fs.writeFileSync(path.join(images, 'fig.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const files = opts.files || TOPICS.length;
  for (let f = 0; f < files; f++) {
    const topic = TOPICS[f % TOPICS.length] + (f >= TOPICS.length ? f : '');
    const tags = ['one', 'two', 'three', 'four', topic].join(', ');
    let md = `---\ntitle: Topic ${topic}\ntags: ${tags}\nsource: A published guideline\n---\n`;
    const secs = opts.sectionsPerFile || 4;
    for (let s = 0; s < secs; s++) {
      md += `\n## Aspect ${topic} ${s}\n${section(topic, s, f + s)}\n`;
      /* Enough figure-citing notes to clear "more than 5 carry a figure". */
      if (s === 0 && f < 10) md += `\n![a figure](refimg://fig.png)\n`;
    }
    fs.writeFileSync(path.join(dir, `${topic}.md`), md);
  }
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const GOOD = path.join(TMP, 'good', 'refs');
writeCorpus(GOOD);
const good = run(GOOD);

head('a corpus that clears every floor is reported clean');
ok('the tool exits 0', good.code === 0, `exit ${good.code}`);
/* THE DETAIL IS REFORMATTED, AND THAT IS NOT COSMETIC. scripts/verify.js
   reads a suite's check count with out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/)
   — no /g, so it takes the FIRST match in the whole of stdout. This suite
   spawns a tool that prints a summary in exactly that shape, and printing it
   back verbatim put it three lines into the output, ahead of this file's own
   summary. The runner counted the TOOL's checks as this suite's: it reported
   12 where 16 ran, and the record carried 12 for a full green run before
   anyone noticed. A number that looks right and is not, which is the failure
   this project is named after, arriving through a detail string.
   So the tool's numbers are printed in a shape the runner cannot read. */
ok('and reports no failures', /\n12 passed, 0 failed/.test(good.out),
   (good.out.match(/(\d+) passed, (\d+) failed/) || [, '?', '?']).slice(1).join(' clean / ') + ' failing');
/* NON-VACUITY. Every injection below is judged by the tool reporting a
   failure, and a tool that read nothing would report nothing and appear to
   pass this whole suite. So the clean run has to prove it actually parsed the
   corpus: the note count is a number only a real read produces. */
ok('and it actually read the corpus, rather than reporting on nothing',
   /34 files, 136 notes, \d+ pearls/.test(good.out),
   (good.out.match(/\d+ files, \d+ notes, \d+ pearls/) || ['(nothing parsed)'])[0]);

/* ── each defect the tool claims to catch, injected ───────────────────────── */
head('every floor it claims to hold, it holds');

function inject(name, mutate) {
  const dir = path.join(TMP, name, 'refs');
  writeCorpus(dir);
  mutate(dir);
  return run(dir);
}

const thin = inject('thin', d => {
  const f = path.join(d, 'alpha.md');
  fs.writeFileSync(path.join(d, 'alpha.md'),
    fs.readFileSync(f, 'utf8').replace(/## Aspect alpha 0\n[^\n]+/, '## Aspect alpha 0\nToo short to retrieve.'));
});
ok('a section under 40 words is caught', /FAIL  refs-patch: no section under 40 words/.test(thin.out) && thin.code === 1,
   `exit ${thin.code}`);

const fat = inject('fat', d => {
  const f = path.join(d, 'bravo.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replace(/## Aspect bravo 0\n[^\n]+/, '## Aspect bravo 0\n' + 'word '.repeat(700)));
});
ok('a section over 600 words is caught', /FAIL  guide: no section over 600 words/.test(fat.out) && fat.code === 1,
   `exit ${fat.code}`);

const back = inject('backref', d => {
  const f = path.join(d, 'charlie.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replace('## Aspect charlie 1\n', '## Aspect charlie 1\nAs discussed above, the rule holds. '));
});
ok('a section referring to another is caught', /FAIL  guide: no section refers to another/.test(back.out) && back.code === 1,
   `exit ${back.code}`);

const nofront = inject('nofront', d => {
  const f = path.join(d, 'delta.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^source: .*$/m, 'note: none'));
});
ok('a file missing its source is caught', /FAIL  guide: every file carries title, tags and source/.test(nofront.out),
   `exit ${nofront.code}`);

const fewtags = inject('fewtags', d => {
  const f = path.join(d, 'echo.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^tags: .*$/m, 'tags: only, two'));
});
ok('a file with fewer than four tags is caught', /FAIL  guide: every file carries at least four tags/.test(fewtags.out),
   `exit ${fewtags.code}`);

const single = inject('single', d => {
  const f = path.join(d, 'foxtrot.md');
  const src = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, src.slice(0, src.indexOf('\n## Aspect foxtrot 1')));
});
ok('a file with only one section is caught', /FAIL  guide: every file splits into more than one section/.test(single.out),
   `exit ${single.code}`);

const noimg = inject('noimg', d => fs.rmSync(path.join(path.dirname(d), 'refs-images', 'fig.png')));
ok('a cited figure with no file is caught', /FAIL  every refimg:\/\/ key resolves to a file/.test(noimg.out),
   `exit ${noimg.code}`);

const small = path.join(TMP, 'small', 'refs');
writeCorpus(small, { files: 6 });
const smallRun = run(small);
ok('a corpus of too few notes is caught', /FAIL  retrieval: more than 100 notes/.test(smallRun.out) && smallRun.code === 1,
   (smallRun.out.match(/more than 100 notes\s+→ (\d+ notes)/) || [, '?'])[1]);
ok('and the pearl floor falls with it', /FAIL  pearl: more than 100 pearls/.test(smallRun.out),
   `exit ${smallRun.code}`);

head('it refuses a corpus that is not there, rather than passing it');
const absent = run(path.join(TMP, 'nothing-here'));
ok('a missing directory exits non-zero', absent.code === 1, `exit ${absent.code}`);
ok('and says where the format is documented', /REFERENCE-GUIDE/.test(absent.out),
   absent.out.trim().split('\n').pop() || '(no message)');

head('it does not overclaim');
/* The tool measures structure. Retrieval quality needs the built app, and a
   tool that implied otherwise would be trusted in place of the suite that
   actually measures it. */
ok('a failing report says retrieval quality is not measured here',
   /Retrieval quality[\s\S]*NOT measured here/.test(smallRun.out));
ok('and names the suite that does measure it', /verify-retrieval\.js/.test(smallRun.out));

/* AND THE LEAK IS CHECKED FOR, not merely fixed once. Anything this file
   prints before its own summary that matches the runner's pattern would be
   counted instead of the summary, silently and in the record. */
{
  const mine = printed.join('\n');
  const foreign = mine.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  ok('nothing it prints can be mistaken for its own summary line',
     foreign === null, foreign ? `"${foreign[0]}" would be read as the count` : 'none');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
