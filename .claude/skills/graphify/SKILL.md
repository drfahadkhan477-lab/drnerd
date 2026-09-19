---
name: graphify
description: Draw this repository's own structure as a diagram — the patch chain, the two build pipelines, the cache/versioning model, or which suites guard what and where each one can run. Use when asked to graph, diagram, visualise, chart or "show me" any part of how Systole is built, tested or released, or when explaining that structure to someone who has not read the source. Reads the real files and derives every number at runtime; never hardcodes counts and never opens licensed content.
---

# graphify

Systole's structure is real and almost entirely invisible. The patch chain is a
`CHAIN` array in `scripts/build.js`. The suite registry is a `SUITES` array in
`scripts/verify.js`. Which of those CI can actually run is a third list, in
`.github/workflows/verify.yml`. The relationship between the two build
pipelines is described in three documents and lives in none of them.

This skill draws those, from the files, at the moment it is asked.

## The two rules that matter

**DERIVE EVERY NUMBER; HARDCODE NONE.** `CLAUDE.md` is explicit: *"If you
write a sentence containing a number, guard it or do not write it."* A diagram
is a sentence with numbers in it. So this skill never states a count it has
not just read — not in the diagram, not in the summary beside it, not in this
file. A node carrying a step count is a lie the moment the next step lands,
and unlike the counts in `README.md` it has no `verify-stats.js` behind it.

If a count cannot be derived, the diagram says so rather than guessing.

**NEVER OPEN THE LICENSED CORPUS.** `source/`, `build/`, `content/` and
`dist/` are the ACCSAP export and everything derived from it. This skill reads
`scripts/`, `tests/`, `src/`, `docs/` and `.github/` only. It never reads a
built artifact to describe a build — the scripts that produce one say
everything a diagram needs, and they are not licensed.

## What it can draw

**the chain** — the ordered steps in `CHAIN`, grouped by what they do.
Derived from `scripts/build.js`; the dependency notes in that file's header
comment are the source for any edge that is not simply "comes after".

**the pipelines** — how the export becomes the two artifacts, and where they
diverge:

```
export.html ──► scripts/build.js ──► build/systole.html ──┬─► (the single file)
                                                          │
                          scripts/extract-content.js ◄────┘
                                     │
                                  content/ ──┐
                                             ├─► scripts/build-pwa.js ──► dist/
                          build/systole.html ┘
```

The joint is the point of the picture: `build-pwa.js` takes **two** inputs, and
the freshness check in it exists because nothing used to prove they came from
the same build.

**the versioning model** — `SHELL_V`, `CONTENT_V`, `BUILD_ID` and the commit:
what each is computed over, which cache each keys, and which of them a given
change moves. Read from `scripts/build-pwa.js`. This is the diagram most worth
having, because the whole design is "a code deploy must not evict the figures"
and that is invisible in the source.

**the suites** — every registered suite, split three ways: runnable in CI,
needs a browser, needs the licensed export. `SUITES` in `scripts/verify.js`
crossed with the `run:` lines in `.github/workflows/verify.yml`. Mark the
suites that must have the machine to themselves; `verify.js` names them and
says why.

## How to extract

Read the arrays, do not re-type them:

```bash
node -e "const s=require('fs').readFileSync('scripts/build.js','utf8');
  console.log((s.match(/const CHAIN = \[([\s\S]*?)\n\];/)||[])[1]);"
```

The same shape works for `SUITES` in `scripts/verify.js` and for the `run:`
lines in the workflow. When a regex stops matching, say so and stop — an empty
diagram is honest; a diagram drawn from a failed match is not.

## Output

**Mermaid in a fenced block, by default.** It renders in GitHub, in most
editors and on an iPad, it diffs as text, and it needs nothing installed. This
project has a hard no-new-dependencies rule and a build that runs on Node's
standard library alone; a diagram tool that needed a package would be the first
exception, for decoration.

**Inline SVG** when the shape is not a graph — a timeline, a size budget, a
layout. Hand-written, self-contained, no external stylesheet, and legible on
both light and dark backgrounds: set an explicit `fill` on text rather than
inheriting, and do not rely on a background colour being there.

Write the diagram to a file only if asked. Otherwise put it in the reply,
where it can be read without opening anything.

## Saying what it does not know

The parts of this repository that are genuinely uncertain should look
uncertain. Four WebKit crashers are unexplained; `home` fails intermittently
under sustained load; the split build's figures are fetched on demand rather
than precached. Where a diagram touches one of those, mark it — a dashed edge,
a question mark, a note beside the node. A clean picture of a system with known
holes in it is the same failure as a test that cannot fail.
