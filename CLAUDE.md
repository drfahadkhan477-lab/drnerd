# Working on Systole

Read this before changing anything. It is not a description of the project —
`README.md` and `docs/BUILD.md` do that. It is the set of rules that are easy
to break without noticing, each one here because it was broken at least once.

## The licensed corpus never enters git

The ACCSAP 12 export is licensed content. `source/`, `build/`, `content/` and
`dist/` are gitignored and stay that way. `tests/last-run.log` is gitignored
because suite output quotes question text.

Do not open, read, retain or reconstruct the licensed source material — the
split PDF parts, the manifest, the ACCSAP_12 HTML exports. Building the app
from the owner's own export is the sanctioned workflow; reading that export as
a document is not, and neither is quoting question text into a transcript.

`scripts/leak-guard.js` enforces the first half of this on staged files. Run
`npm run hooks` once per clone to get it on pre-commit; CI runs it regardless.

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

`tests/test-stats.json` is machine-written, on full green runs only. Never
hand-edit it.

Counts quoted in `README.md`, `docs/BUILD.md` and `.github/workflows/verify.yml`
are guarded by `tests/verify-stats.js` against that record. When one of them
looks stale, check whether it is guarded before "fixing" it: a number that
disagrees with reality but agrees with the record is *correct today* and will
correct itself on the next full run. Editing it by hand is prose leading the
record.

`PENDING_RECORD` in `scripts/verify.js` lists suites registered since the last
full green run. It is checked in both directions, so it self-cleans — empty it
after a full green run, not before.

**A guard with a hole in it is worse than no guard**, because the surrounding
green reads as coverage of the whole paragraph. Two sentences have drifted
this way: the README's split-build count, sitting between two guarded numbers,
and `verify.yml`'s "the nine suites" when there were eighteen. Both are guarded
now. If you write a sentence containing a number, guard it or do not write it.

## The patch chain

`scripts/build.js` holds `CHAIN`: 86 steps, each a `*-patch.js`. `patch(label,
find, replace)` throws unless `find` matches **exactly once** — that is the
whole safety model, so keep anchors distinctive and never loosen one to make it
match. `cut(label, open, close)` removes a span.

Anything asserted about the built output from a patch script (e.g. build-pwa
checking `SECURITY_HEADERS` as a substring) means that literal must stay
unbroken in the source. Reformatting it breaks the build, not the test.

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

## Before you finish

After merging, sync the working branch onto the merge commit **and push it** —
otherwise it sits one commit behind its own remote ref and the stop hook
catches what you should have.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
