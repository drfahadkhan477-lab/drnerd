# Systole — UX discovery, 27 October 2026

Status: **honest and short on purpose.** The central finding is that there is no
usage evidence yet, so this document records what is known, what is assumed, and
the one cheap experiment that would settle it. It deliberately does not invent
personas or journey maps, because inventing evidence is worse than having none.

## Problem brief

- **Problem**: one fellow needs to pass the ABIM cardiovascular disease boards,
  and needs the understanding to survive past the exam rather than evaporate.
- **Affected user**: exactly one, known, and the same person who builds it — a
  cardiology fellow. Not a market. This is a sample size of one, which is a
  strength (direct access) and a trap (no disagreement).
- **Current alternative**: the ACCSAP 12 bank in its own web reader, plus
  whatever notes and recall happen around it.
- **Why that fails**: the bank tests but does not schedule, does not know what
  you chose, cannot teach across cases, and is not usable offline on the ward.
- **Scope**: improvement to an existing, feature-rich, barely-used app.

## The finding that matters

> "Didn't use that much till now."

Systole has around **eighty shipped feature efforts** and close to **zero study
hours**. The build is far ahead of the use. Every feature therefore rests on an
assumption that has never met a real session:

| Feature | Unvalidated assumption |
|---|---|
| FSRS-5 scheduling | Reviews will be opened on the day they come due |
| Timed mock, no feedback until hand-in | Exam simulation is wanted before the exam is near |
| Grounded Apex (pick, confidence, miss patterns) | The tutor is consulted mid-study, not skipped |
| Flags + per-question notes | Questions get revisited, not just marked |
| Daily pearl, Recall step | The day starts in the app rather than in the bank — **and that the pearl wins against the habit of opening the ACCSAP reader**, which is the real competitor, not another feature |
| Timed mock, again | That it is wanted *now* — it may be a late-cycle tool only, worth nothing until the exam is near, in which case building it early cost a cycle |
| Labs, Brain, 3D heart | Exploration earns its screen against question throughput |
| Three-page Home / Quiet Atlas | Home is a place you pass through, and its layout matters |

None of these are wrong. None are known to be right.

## The instrumentation is already there — the data is not

This is the useful asymmetry. Every answer already records the option picked,
whether it was right, stated confidence, the stated reason, time taken in ms,
and flag state (`src/core/apexsignals.js`, `answerLine({pick, ok, cf, why, ms,
flagged, grounded, letters})`). FSRS state, pace and calibration are derived
from it. Brain displays it. Backup exports it.

So the gap is not telemetry design. **No new measurement needs building.** The
gap is that nothing has been recorded, because the app has not been used.

## The one experiment

Do a single real study session on the iPad — 30–40 minutes, the way you would
actually study, not a demo pass. Do not fix anything you find while in it; just
finish, then write down:

1. Where you stalled, hesitated, or had to decide what to do next.
2. Anything you wanted that was not there.
3. Anything you ignored completely.
4. Whether you reached for Apex, and if not, why not.
5. Whether you would open it again tomorrow unprompted.
6. **When you reached for study material, did you open Systole or the ACCSAP
   reader?** If the reader, say what it gave you that Systole did not. This is
   the question the rest of the document missed: the competitor is an existing
   habit, not a missing feature, and no amount of polish beats a habit that is
   never interrupted.
7. Whether the timed mock felt wanted today, or like something for the month
   before the exam.

### Battery, honestly

An open question is what three live canvases on Home cost in battery. It cannot
be answered from a container. An attempt on 27 Oct counted canvas and WebGL draw
calls per second in headless Chromium and WebKit; a control that changed nothing
between two runs moved the number as much as the condition under test did
(84 → 88 draws/s), so the instrument could not see the effect and its readings
were discarded rather than reported. The measurement that counts is the iPad's
own battery figure across a real session, which the session above produces for
free. Note the percentage before and after.

Then look at Brain. It will hold real pick/confidence/pace data for the first
time, which is worth more than any further design reasoning in this document.

Item 3 is the most valuable and the least comfortable: a feature consistently
ignored in real use is a candidate for removal, and removal is the cheapest
performance and clarity win this codebase has available.

## What this means for the two decisions in flight

**Quiet Atlas** — ship it. A calmer Home is plausible, the work is largely done
and validated, and a redesign is cheap to revise. But it should be understood as
*a bet on calm*, not a fix for a diagnosed problem. Its real test is whether a
session starts faster, and nothing can tell us that until sessions happen.

**KaTeX** — do not build it yet. It is roughly 90 KB gzipped plus ~20 woff2
faces, against a 280 KB shell budget only just brought back under by lifting the
Practice Lab out. The content currently renders its mathematics as Unicode
(`≤`, `cm²`, `e′`) and no one has yet said that reads badly. Building a costly
feature with zero usage evidence is exactly the pattern this document exists to
interrupt. Revisit it only if a real session produces a formula that genuinely
does not read.

## Design principles this supports

1. **Removing the decision beats adding the feature.** The riskiest moment is
   the one between opening the app and starting work.
2. **Earn the screen.** Anything on Home competes with starting; it should
   justify itself in use, not in description.
3. **Build against observed behaviour from here on.** The next feature should
   cite a session, not an intuition.

## Risks

- **Sample of one, and it is the builder.** There is no one to disagree. Only
  real sessions can act as the second opinion.
- **Building substitutes for studying.** Shipping features is the more
  immediately rewarding of the two activities, and the exam does not reward it.
  This is the primary risk to the project's actual goal.
- **Feature mass is permanent, attention is not.** Each addition raises the cost
  of every future screen.

## Recommended next steps

1. One real 30–40 minute session on the iPad. Notes on the five questions above.
2. Read Brain afterwards; it will finally hold real data.
3. Integrate Quiet Atlas (independent of the above; it is already in flight).
4. Re-open this document once a session exists. Replace the assumption table
   with findings, and only then revisit KaTeX and any further Home work.
