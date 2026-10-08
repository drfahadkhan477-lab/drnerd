# Working on Systole

Read this before changing anything. It is not a description of the project —
`README.md` and `docs/BUILD.md` do that. It is the set of rules that are easy
to break without noticing, each one here because it was broken at least once.

## The licensed corpus never enters git

The ACCSAP 12 export is licensed content. `source/`, `build/`, `content/` and
`dist/` are gitignored in the main repository and stay that way. `tests/last-run.log` is gitignored
because suite output quotes question text.

**Main repository rule:** Do not commit the ACCSAP export, split PDFs, manifest,
or question bank HTML directly to `drnerd`. Building the app from the owner's own
export is the sanctioned workflow. Reading that export as a document is not sanctioned,
and neither is quoting question text into a transcript.

**Reference notes:** `content/refs-repo` holds derived reference material
(markdown exports, figures) from the licensed corpus. It is no longer a
submodule: its private repository (`systole-refs`) was deleted by the owner, so
the folder exists only on the owner's machine, under the gitignored `content/`.
It is still licensed material — the guards that refuse to read it stay — and
never re-add it to git in any form.

`scripts/leak-guard.js` enforces this on drnerd's staged files. Run
`npm run hooks` once per clone to get it on pre-commit (and the pure suites on pre-push); CI runs it regardless.

## The failure mode this project keeps producing

**Checks that pass without measuring anything.** It has appeared at least
seven times, in seven different disguises:

- `ok('...', true)` — a literal
- a skipped step counted as a pass (`--dry-run` printed CERTIFIED having run
  nothing)
- a timeout in the wrong argument position, so a 30 s default silently applied
  (`waitForFunction(fn, arg, options)` — the two-arg form is the trap)
- a figure audit scanning a field the data does not have
- a probe comparing against `undefined`, which is also what a probe that never
  ran returns — it passed hardest when everything was broken
- a lint whose fixer had the same comment-blindness bug as the lint, producing
  a missed site *and* a false "zero remaining"
- a test using a provider id that the patch chain rewrites later, so it
  silently exercised the no-vision path

So: **every new check must be proven to fail.** Inject the defect it claims to
catch, watch it go red, restore, watch it go green. Put the evidence in the
commit message or PR body. A check you have not seen fail is a check you have
not written.

And when a check passes where you expected it to fail, that is information:
either the defect is not what you thought, or the check measures something
narrower than its comment claims. **Narrow the comment. Never widen the test to
fit the prose.**

## Never adjust a threshold to accommodate a regression

If a number has to move to make a suite green, the suite is right and the
change is wrong until proven otherwise.

## Prose follows the record, never leads it

`tests/test-stats.json` is machine-written, never hand-edited. It has two
halves, Systole and the Memorizer (`scripts/record.js`), and each half is
written only from a run where every one of its own suites ran and passed; the
other half keeps its previous numbers. A Memorizer failure no longer holds back
Systole's record, and the reverse. Do not loosen "every one of its suites" —
a half written from a partial run is a confidently wrong number in three docs.

Counts quoted in `README.md`, `docs/BUILD.md` and `.github/workflows/verify.yml`
are guarded by `tests/verify-stats.js` against that record. When one of them
looks stale, check whether it is guarded before "fixing" it: a number that
disagrees with reality but agrees with the record is *correct today* and will
correct itself on the next full run. Editing it by hand is prose leading the
record.

`PENDING_RECORD` in `scripts/verify.js` lists suites registered since their
half of the record was last written. It is checked in both directions, so it
self-cleans — remove a name after a green run has recorded it, not before.
`RETIRED_RECORD` is its mirror: suites deleted since their half was last
written, still in the record until the next write drops them. Also checked in
both directions; remove a name once a green run has dropped it.

**A guard with a hole in it is worse than no guard**, because the surrounding
green reads as coverage of the whole paragraph. Two sentences have drifted
this way: the README's split-build count, sitting between two guarded numbers,
and `verify.yml`'s "the nine suites" when there were eighteen. Both are guarded
now. If you write a sentence containing a number, guard it or do not write it.

## How the app is built

`npm run build` (and `npm run release-check`) runs `scripts/assemble-app.js`,
which fills the slots in `app/systole.html` from the export, the reference
notes, `src/` and `assets/`. **Edit `app/`, `src/` and `assets/` directly.**
The bank's corrections live in `scripts/answer-keys.js` and `content-flags.js`;
the reference notes are built by `ref-seed.js` and `ref-images.js`.

The patch chain that used to build the app (`scripts/build.js` and its
`*-patch.js` steps) is deleted; git history has it. Do not bring back a
`*-patch.js` step or a find-and-replace build. `verify-release.js` fails if
a `scripts/*-patch.js` or `scripts/build.js` appears; the rest is on you.

Anything a check asserts as a substring of `app/systole.html` (e.g. build-pwa
checking `SECURITY_HEADERS`) means that literal must stay unbroken in the
source. Reformatting it breaks the build, not the test.

## Tests

- **`tests/_source.js`** has the comment blanker. Do not roll your own — five
  copies existed and two had drifted apart. `verify-engine.js` enforces this.
  Blanking, not stripping: positions and line boundaries survive.
- **Any scan of this repo's own source must read the blanked copy.** The files
  explain themselves at length and the explanations quote the patterns being
  hunted, so a scan that reads comments reports the paragraph warning about a
  bug *as* the bug. This has happened three times.
- **`tests/_render.js`** has the render waits. THE RULE: a wait must be a
  precondition, never the proposition under test. Quiescence is not a render
  wait.
- **No suite calls `chromium.launch()` directly** — the engine is a flag.
  `verify-engine.js` enforces it.
- `render()` swaps the DOM inside an async `startViewTransition` callback. That
  has caused four separate suite races. Use the helpers.
- The `waitForTimeout` sleeps are triaged, not forgotten: most are followed by
  an `evaluate()` read, and migrating those mechanically would turn them into
  tautologies. They need the app, one site at a time. (No count here on
  purpose — it moves with every suite added, and an unguarded number in a doc
  is the thing this file tells you not to write.)

## Pull requests

Report what was **found**, not what was looked for — including the parts that
came back clean, since a review listing only problems implies the rest was
never examined. State what you got wrong and what you did about it. If you
built something and threw it away, say why; the next person will otherwise
rebuild it.

## Working method

- **Read `tasks/lessons.md` at the start of a session.** After any correction
  from the owner or a reviewer, add the pattern and a rule that prevents it.
- **Plan before editing** anything over two or three files, or with an
  architectural choice: write checkable steps to `tasks/todo.md` (gitignored),
  confirm them, tick them off, and add a short review section at the end. If
  something goes sideways, stop and re-plan; do not keep pushing.
- **Never call a task done without proof**: run the checks, tail the result
  lines, and say what did not run. Ask whether a staff engineer would approve it.
- **Fix the root cause, touching only what the fix needs.** A bug report or a
  red CI job is yours to fix without being told how.
- **Agents in `.claude/agents/`** (`planner`, `verifier`, `memorizer-reviewer`,
  `hollow-check-reviewer`, `leak-auditor`, `ci-log-reader`) are used when the
  owner asks for them, per "Spending tokens". Each states its inputs, what it
  returns, its failure modes, and what it never does.

## Before you finish

Run `npm run test:pure` before every push (about a minute; `npm run hooks`
makes git do it for you). CI's first job runs the same suites, and a push that
fails there costs a ten-minute cycle: two of them on one day were a fixture
that tripped a rule in another suite, which running them all would have shown.

After merging, sync the working branch onto the merge commit **and push it** —
otherwise it sits one commit behind its own remote ref and the stop hook
catches what you should have.

## Spending tokens

Full guide for the owner: `docs/CLAUDE-USAGE.md`. The rules Claude acts on:

- Read selectively: grep or read line ranges, not whole large files. Never
  dump suite output or build logs into the transcript — tail the relevant lines.
- Subagents only when asked; when used, give them the cheapest model that fits
  (`haiku` for lookups/mechanical edits, `sonnet` for routine coding, `opus`
  only for hard design or debugging).
- For changes touching more than two or three files, state the plan (files and
  what changes in each) before editing.
- When a task is finished and the next request is unrelated, suggest `/clear`;
  in a long task, suggest `/compact`. If the work is routine and the session is
  on Opus, say once that Sonnet would do (`/model`).
