# Quiet Atlas — integration review checklist

Reference: owner's selected design screenshot (landscape tablet, light theme).
Base for review: origin/master 9c67049. Incoming: claude/quiet-atlas (not yet pushed).

## What the screenshot shows

Surface: warm ivory paper, not white. Navy serif display type, teal accents,
muted pastel step circles (teal / blue / pink).

Left rail, narrow, full height:
  Home (house, selected: soft teal rounded-square), Brain (brain), Labs (waveform),
  icons above labels; divider; Apex at the foot, circular mark + label.

Top bar: teal heart mark + "Systole" navy serif wordmark | italic "Cardiology, in motion."
  Right: search field "Search questions, topics, or figures...", then moon and sun
  circular buttons.

Left column:
  eyebrow: lightbulb + "DAILY PEARL" teal small caps + trailing rule
  h1: "Make one idea stick." navy serif, teal underline swash
  body: "Explain the mechanism in your own words. / Then reveal the note and compare."
  three steps, arrows between: Observe (eye) / Explain (speech bubble) / Recall (document),
    each a bold label + two-line grey caption
  buttons: "Begin recall →" filled deep-teal pill; "Read note" outlined pill + doc icon

Right panel: anatomical heart on paper with faint technical arcs; caption italic
  "Illustrative anatomy" bottom-left; "Explore in 3D" outlined pill + cube icon and a
  circular Pause (❚❚) bottom-right.

Bottom strip, spanning both columns: progress ring with doc icon, "YOUR NEXT SESSION"
  teal small caps, "12 questions ready" navy serif, caption, "Start review →" teal pill.

## OWNER CONFIRMED (2026-10-27)

"Yes, keep the live heart in the panel." The static illustration in the screenshot is
the panel's dressing only. A diff that swaps in a static heart is a defect, not the design.

## Discrepancy to check first

The screenshot's heart is a STATIC labelled illustration (SVC / AORTA / RA / LV leader
lines, "Illustrative anatomy"). The owner's constraints say the opposite: keep the
existing physiological/animated heart and the 3D tools, and Pause/Play must drive both
the canvas animation and the CSS fallback.

=> The paper panel, caption, "Explore in 3D" and Pause control are the design.
   The thing inside the panel must remain the live heart.
   REJECT any diff that swaps the live heart for a static image or bakes in the
   SVC/AORTA/RA/LV label art as the heart itself.

## Claims to verify in the diff, each by measurement

1. Live heart preserved; Heart3D/hero mount untouched or still mounted.
2. Pause/Play: controls canvas AND the reduced-motion CSS fallback; aria-pressed and
   accessible name change with state (not a label frozen at "Pause").
3. "12 questions ready" comes from real due cards; zero-due opens Chapters.
4. "Read note" / Open notes actually opens notes; empty library says "Make one idea stick."
5. Rail orientation: vertical on tablet, bottom tabs on phone, and the selected tab's
   orientation updates on RESIZE (the screenshot's rail is the tablet case only).
6. Exactly one active-page H1; scroll regions keyboard reachable and named.
7. Home/Brain/Labs fit iPad portrait + landscape with no page scroll; long reading,
   enlarged text and short windows still scroll rather than clip.
8. Home styling scoped to landing pages only — question reading keeps its measure.
9. Dark mode and the other palettes still work; every colour via tokens.
10. :hover rules inside @media (hover:hover); CSS floor table covers any new feature.
11. No new heavy dependency or animation added for appearance.

## BASELINE MEASURED HERE on 9c67049 (2026-10-27)

Build: synthetic export + assemble-app, 6,051,110 bytes.

  test:pure            99 pure suites passed, 0 failed
  verify-homepager     chromium 57/0   webkit 57/0
  verify-pearl         chromium 96/0   webkit 96/0

Any failure in these after Quiet Atlas lands is the branch's, not pre-existing.
Node here is 22.22.0; CI measures on 24.

## Review of master 8aed6dd..9c67049 (20 commits, previously unreviewed) — CLEAN

Mostly tests: +42 checks across 9 suites, none lost. No threshold, timeout or
expected count was relaxed. Three vacuous passes were FIXED, not introduced:
  figsharp  m.decoded > 0            -> m.total > m.calibrations && m.decoded === m.total
  figsharp  upscaled.length === 0    -> narrow.length > 0 && upscaled.length === 0
  figsharp  wide.every(...)          -> wide.length > 0 && wide.every(...)
  ([].every() is true, so an empty measurement used to pass.)
figsharp also now injects deterministic 80px/2000px calibration images so both
directions are always exercised. Its new early return (reserved key clash) is
reported as a FAIL via ok(..., false, m.err), not silently skipped — checked.
App changes are real accessibility work: rem-based .pearl-concept (respects text
size), theme tokens replacing hardcoded rgba whites, .ai-body focus outline,
.off-btn contrast. No finding to raise.

## Validation plan (this container)

Engines verified launching here: WebKit 2359, Chromium 1243.
Node 22.22.0 local; CI measures on 24 — state that limit.
Suites: home, homepager, pearl, typography/readsize, hover, floor-css, themes/ink,
  plus whatever scripts/verify.js --help and the registry list for Home.
Negative tests required: injected defect must produce that check's own FAIL line.
Public runs use synthetic content. No private build or deploy from here.
