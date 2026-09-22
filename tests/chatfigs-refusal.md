# verify-chatfigs on a corpus with no figures — the run that closed the proof

`7cc8ea3` and `41520f5` changed how `verify-chatfigs.js` behaves when no
reference note cites a `refimg://` figure. Both commits asked for a run to
prove it, because the defect needs a build plus a figure-free corpus and
neither exists on a machine without the licensed export. This file records the
run, so the evidence sits beside the code rather than in a chat log.

## Before

    ── open mode — where the figure used to be invisible ──

    ── what the page said before the suite died ──
      last section reached: open mode — where the figure used to be invisible
      checks completed: 0
      page events: none
    page.evaluate: TypeError: Cannot read properties of undefined (reading 'id')
        at ask (tests/verify-chatfigs.js:78:17)

`REF.find()` returned `undefined` and the next line read `.id` off it. The
suite reported nothing, because it never reached a check.

## After the first fix — still dying, three checks later

    FAIL  a note citing a figure was found to pin the answer to
          → no reference notes cite a figure
    FAIL  a figure from the cited note is shown  → undefined figure(s)
    FAIL  it is a real decoded image, not a dead reference
      checks completed: 3
    TypeError: Cannot read properties of undefined (reading 'length')
        at tests/verify-chatfigs.js:113:38

The gate fired and named the cause, which was the point. But guarding the
producer while the consumers still dereferenced its fields only moved the
death: `open.caption.length` off a bare `{ err }`.

## After the shape fix — the suite completes

    FAIL  one tap opens them  → null
    FAIL  and they occupy real height once open  → -1px
    PASS  toggling does not discard what you were typing  → half-typed question

    ── the strip is evidence, not furniture ──
      PASS  an empty thread shows no figure strip  → 0

    ── the system prompt tells the model how to place one safely ──
      PASS  it explains the citation form
      PASS  it insists the key be copied verbatim
      PASS  it forbids inventing one, which would render as nothing

    ── regression ──
      PASS  no console or page errors across the run

    8 passed, 32 failed

Forty checks reported instead of three, every section reached, and the
regression check confirming the page raised no errors while doing it. The 32
failures are correct and expected: the corpus genuinely has no figure to show.
A suite that passed here would be measuring nothing.

## What this does not prove

The good path. Every check above ran against a corpus with no figures, so the
fix is proven to turn a death into a diagnosis and nothing more. The figure
assertions themselves still need a corpus that cites one.

One check in that run passes while measuring nothing: "open mode still does not
spend tokens sending note figures" asserts that no image was sent, and on this
path nothing is sent because the guard returns before `fire()`. It was
unreachable before the fix and is reachable now. The honest form is probably
`!openHasImage && !open.err`, but that edits a check which measures something
real on the good path, and the good path has not been run.
