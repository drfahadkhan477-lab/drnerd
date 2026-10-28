#!/usr/bin/env node
'use strict';
/*
 * The pull-request path filter skips a browser job only when it should.
 *
 *   node tests/verify-cichanges-pure.js
 *
 * scripts/ci-changes.js decides which of verify.yml's two browser jobs a pull
 * request runs. A wrong "skip" is the dangerous direction — the job turns grey
 * and the change it would have caught lands — so most of this is about that:
 * the lists against the files each job really runs, every doubtful case
 * running both, and the workflow wired so a failed decision also runs both.
 * The last part runs the script itself in throwaway git repositories.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { classify, decide } = require('../scripts/ci-changes.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const ROOT = path.join(__dirname, '..');
const show = d => `public=${d.public} synthetic=${d.synthetic}`;
const is = (files, p, s) => { const d = classify(files); return d.public === p && d.synthetic === s; };

head('a pull request skips only the job its files cannot reach');
{
  const sys = ['app/systole.html', 'assets/icon.png'];
  ok('Systole shell only: the public-browser job is skipped, the synthetic job runs', is(sys, false, true), show(classify(sys)));
  const docs = ['docs/BUILD.md', 'README.md', 'tasks/lessons.md', '.claude/agents/planner.md'];
  ok('docs only: both browser jobs are skipped', is(docs, false, false), show(classify(docs)));
  /* .gitignore read only by verify-engine and verify-leakguard, both in the logic job,
     which runs regardless of this decision. It used to start every browser job. */
  ok('.gitignore alone skips both browser jobs', is(['.gitignore'], false, false), show(classify(['.gitignore'])));
  ok('.gitignore beside docs still skips both', is(docs.concat(['.gitignore']), false, false));
  ok('.gitignore beside Systole code still runs the synthetic job', is(['.gitignore', 'app/systole.html'], false, true));
  ok('docs beside the shell still skip only the public-browser job', is(docs.concat(sys), false, true));
  /* Memorizer moved to its own repository, and its list went with it: a path
     under memorizer/ is on no list now, so it is a doubt, and runs both. */
  ok('a path under memorizer/ no longer skips the synthetic job', is(['memorizer/src/ui.js'], true, true), show(classify(['memorizer/src/ui.js'])));
  ok('the Practice Lab\'s browser suite, changed alone, runs the synthetic job: the Lab is a Systole screen now', classify(['tests/verify-lab.js']).synthetic === true, show(classify(['tests/verify-lab.js'])));
  ok('and the Lab\'s modules in src/lab/ run both', is(['src/lab/heartsounds.js'], true, true));
}

head('every doubtful case runs both');
{
  for (const f of ['src/core/fsrs.js', 'scripts/zip.js', 'scripts/build-pwa.js', 'tools/pack-content.js',
                   'tests/_render.js', 'tests/_engine.js', 'package.json', 'package-lock.json',
                   '.github/workflows/verify.yml', 'a-new-directory/file.js', 'docs.js', 'memorizer.js']) {
    ok(`${f} runs both`, is([f], true, true), show(classify([f])));
  }
  /* A .md file is docs only at the top level; a nested one is not on any list. */
  ok('a .md below the top level is not treated as docs', is(['src/notes.md'], true, true));
  ok('an empty file list runs both, rather than reading as "nothing changed"', is([], true, true));
  ok('so does a list that could not be read', is(null, true, true));
}

head('only a pull request is filtered');
{
  const docs = ['docs/BUILD.md'];
  ok('a pull request of docs skips both', show(decide('pull_request', docs)) === 'public=false synthetic=false');
  for (const ev of ['push', 'workflow_dispatch', '']) {
    ok(`a ${ev || 'missing'} event runs both, whatever changed`, show(decide(ev, docs)) === 'public=true synthetic=true');
  }
}

/* The workflow with its comments removed, so a sentence describing the wiring
   cannot stand in for the wiring. */
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8').replace(/(^|\s)#.*$/gm, '$1');
function jobBody(job) {
  const start = yml.indexOf(`\n  ${job}:\n`);
  if (start < 0) return '';
  const rest = yml.slice(start + job.length + 5);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\s*\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

head('each list is held against the files the job it skips really runs');
{
  /* A file a job runs must, changed alone, run that job. Read from the
     workflow, so a suite added to a job is checked without anyone adding it
     here. */
  const runs = body => [...body.matchAll(/\bnode\s+((?:tests|scripts)\/[a-z0-9_-]+\.js)/g)].map(m => m[1]);
  const pubFiles = runs(jobBody('public-browser'));
  const synFiles = runs(jobBody('synthetic-browser'));
  ok('the public-browser job’s files are found', pubFiles.length >= 2, pubFiles.join(', ') || 'none');
  ok('and the synthetic job’s', synFiles.length >= 30, synFiles.length + '');
  const pubSkipped = pubFiles.filter(f => !classify([f]).public);
  ok('every file the public-browser job runs, changed alone, runs it', pubSkipped.length === 0, pubSkipped.join(', ') || 'none');
  const synSkipped = synFiles.filter(f => !classify([f]).synthetic);
  ok('every file the synthetic job runs, changed alone, runs it', synSkipped.length === 0, synSkipped.join(', ') || 'none');
  /* synthetic-webkit is skipped on the same answer, so the same must hold
     for every file it runs. */
  const wkFiles = runs(jobBody('synthetic-webkit'));
  const wkSkipped = wkFiles.filter(f => !classify([f]).synthetic);
  ok('and every file the WebKit job runs, changed alone, runs it', wkFiles.length >= 5 && wkSkipped.length === 0,
     wkSkipped.join(', ') || `${wkFiles.length} files`);
  /* The shared helpers every browser suite requires. */
  const helpers = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => /^_.*\.js$/.test(f)).map(f => 'tests/' + f);
  const helperSkips = helpers.filter(f => !is([f], true, true));
  ok('every shared test helper runs both', helpers.length > 3 && helperSkips.length === 0, helperSkips.join(', ') || `${helpers.length} helpers`);
  /* The other direction, for what the public-browser job is allowed to skip: no file it runs names a
     directory on the Systole-only list as a path ('app/…', or 'app' handed to path.join). Read with
     comments blanked. */
  const { blankComments } = require('./_source.js');
  const SHELL = /['"`/](?:app|assets)\/|join\([^)]*['"](?:app|assets)['"]/;
  const reads = pubFiles.filter(f => fs.existsSync(path.join(ROOT, f)))
    .filter(f => SHELL.test(blankComments(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  ok('no file the public-browser job runs names app/ or assets/', pubFiles.length >= 2 && reads.length === 0, reads.join(', ') || `${pubFiles.length} files read`);
  ok('and that reading finds such a name where there is one', SHELL.test(blankComments(fs.readFileSync(path.join(ROOT, 'tests', 'verify-app-slots-pure.js'), 'utf8'))));
  /* split-build is skipped on the same answer. It names a few scripts, and the
     last, verify.js --pwa, runs more: build-pwa, the static server and the
     split build's suites. Those are read from verify.js's --pwa block, so a
     phase added there is held here too. */
  const v = fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8');
  const pwaBlock = v.slice(v.indexOf("if (flag('--pwa')) {"));
  const pwaFiles = [...pwaBlock.matchAll(/path\.join\(ROOT,\s*'(scripts|tests)',\s*'([a-z0-9_-]+\.js)'\)/g)].map(m => `${m[1]}/${m[2]}`);
  const splitFiles = [...new Set(runs(jobBody('split-build')).concat(pwaFiles))];
  ok('the split-build job’s files are found, with what verify.js --pwa runs',
     splitFiles.includes('scripts/verify.js') && splitFiles.includes('tests/verify-pwa.js') && splitFiles.length >= 8, splitFiles.join(', '));
  const splitSkipped = splitFiles.filter(f => !classify([f]).synthetic);
  ok('and every one of them, changed alone, runs it', splitSkipped.length === 0, splitSkipped.join(', ') || 'none');
}

head('the workflow is wired so a failed decision runs both');
{
  const pub = jobBody('public-browser'), syn = jobBody('synthetic-browser'), ch = jobBody('changes');
  ok('there is a `changes` job', ch.length > 0);
  ok('it runs the script', /\n\s+run:\s*node scripts\/ci-changes\.js\s*\n/.test(ch + '\n'));
  ok('with two commits of history, so HEAD^1 exists', /fetch-depth:\s*2\b/.test(ch));
  ok('and publishes both answers from that step',
     /public:\s*\$\{\{\s*steps\.which\.outputs\.public\s*\}\}/.test(ch) &&
     /synthetic:\s*\$\{\{\s*steps\.which\.outputs\.synthetic\s*\}\}/.test(ch) && /id:\s*which\b/.test(ch));
  for (const [name, body, key] of [['public-browser', pub, 'public'], ['synthetic-browser', syn, 'synthetic'],
                                    ['synthetic-webkit', jobBody('synthetic-webkit'), 'synthetic'],
                                    ['split-build', jobBody('split-build'), 'synthetic']]) {
    const cond = (body.match(/\n    if:\s*(.+)/) || [])[1] || '';
    ok(`${name} is in the workflow`, body.length > 0);
    ok(`${name} waits for the decision`, /\n    needs:\s*\[?\s*changes\s*\]?\s*\n/.test(body));
    /* `!= 'false'`: an empty output, from a changes job that failed, runs the
       job. `== 'true'` would skip it. !cancelled(): without it a failed
       dependency skips this job outright. */
    ok(`${name} is skipped only on an explicit 'false'`,
       cond.includes(`needs.changes.outputs.${key} != 'false'`) && cond.includes('!cancelled()'), cond || 'no if');
  }
  /* The jobs that must never be filtered. */
  for (const job of ['syntax', 'logic', 'build-guard']) {
    const body = jobBody(job);
    ok(`${job} does not depend on the decision`, body.length > 0 && !/needs\.changes|\n    needs:\s*\[?[^\n]*changes/.test(body));
  }
}

head('the script itself, in throwaway repositories');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cichanges-'));
  const script = path.join(ROOT, 'scripts', 'ci-changes.js');
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const runIn = (cwd, event) => {
    const out = path.join(tmp, 'out-' + Math.random().toString(36).slice(2));
    fs.writeFileSync(out, '');
    execFileSync(process.execPath, [script], { cwd, stdio: 'pipe', env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: out } });
    return fs.readFileSync(out, 'utf8').trim().replace(/\n/g, ' ');
  };
  const repo = (files) => {
    const d = fs.mkdtempSync(path.join(tmp, 'r-'));
    git(d, 'init', '-q');
    fs.writeFileSync(path.join(d, 'base.txt'), 'base');
    git(d, 'add', '.'); git(d, 'commit', '-qm', 'base');
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), 'x'); }
    git(d, 'add', '.'); git(d, 'commit', '-qm', 'change');
    return d;
  };
  try {
    const shell = repo(['app/systole.html']);
    ok('a shell-only commit writes public=false synthetic=true', runIn(shell, 'pull_request') === 'public=false synthetic=true', runIn(shell, 'pull_request'));
    ok('the same commit pushed to master writes both true', runIn(shell, 'push') === 'public=true synthetic=true', runIn(shell, 'push'));
    const both = repo(['app/systole.html', 'src/core/fsrs.js']);
    ok('a commit that also touches src/ writes both true', runIn(both, 'pull_request') === 'public=true synthetic=true', runIn(both, 'pull_request'));
    /* A shared file moved into app/: git names a rename by its new path only, which alone
       would skip the public-browser job although it had used the file at its old path. */
    const moved = fs.mkdtempSync(path.join(tmp, 'r-'));
    git(moved, 'init', '-q');
    fs.mkdirSync(path.join(moved, 'src', 'core'), { recursive: true });
    fs.writeFileSync(path.join(moved, 'src', 'core', 'shared.js'), Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n'));
    git(moved, 'add', '.'); git(moved, 'commit', '-qm', 'base');
    fs.mkdirSync(path.join(moved, 'app'));
    git(moved, 'mv', 'src/core/shared.js', 'app/shared.js'); git(moved, 'commit', '-qm', 'move');
    ok('a shared file moved into app/ still runs the public-browser job: the path it left counts', runIn(moved, 'pull_request') === 'public=true synthetic=true', runIn(moved, 'pull_request'));
    /* One commit, so HEAD^1 does not exist: the diff fails, and must not
       read as "nothing changed". */
    const lone = fs.mkdtempSync(path.join(tmp, 'r-'));
    git(lone, 'init', '-q'); fs.writeFileSync(path.join(lone, 'README.md'), 'x'); git(lone, 'add', '.'); git(lone, 'commit', '-qm', 'one');
    ok('a diff git cannot take writes both true', runIn(lone, 'pull_request') === 'public=true synthetic=true', runIn(lone, 'pull_request'));
  } catch (e) {
    ok('the script runs', false, String(e.message).split('\n')[0]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
