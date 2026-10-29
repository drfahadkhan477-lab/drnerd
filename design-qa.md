# Quiet Atlas design comparison

final result: pass with documented visual differences

This is the visual-composition review, not a declaration of release readiness.
Full application validation is tracked separately in the validation checkpoints.

## Reference and captures

The visual target is the owner's attached ivory Quiet Atlas Home, including the
large “Make one idea stick.” heading, three learning steps, anatomical heart,
left navigation and bottom session strip. The black letterboxing is outside the
app. The final Home capture uses a 1312×910 viewport matching that app region.
The source was inspected in the conversation; a source-image file is not stored
in this repository. Captures remain private under
`build/private-validation/atlas-release/1312-0.png` and the corresponding tablet
viewport files. No combined source/capture image is committed.

## Reviewed steps

1. **Home invitation — visually healthy.** The serif heading, ivory/teal colors,
   horizontal Observe → Explain → Recall flow, prominent heart, search and
   session strip now follow the reference composition. Session counts come from
   the real deck; the empty queue opens Chapters rather than claiming 12 due.
2. **Begin recall / Reveal / Back — functional.** The invitation opens the real
   pearl reader, hides the answer, reveals it on request, and restores focus on
   return. Read note opens its source. Long text keeps scrolling access.
3. **Brain — visually healthy.** Chapter progress and the existing brain remain
   accessible in the compact tablet layout.
4. **Labs — visually healthy.** Rhythm, Echo and Practice remain visible with
   their study-tool entry points.

All three landing pages fit the measured 1180×820, 834×1194 and 1024×768
viewports without page overflow. These geometry observations are recorded in the
private capture log; they do not mean long reading content never scrolls.

## Accessibility and motion

Focused Chromium and desktop WebKit checks cover the landing interactions,
keyboard rail navigation, typography, accessibility, alternate themes and touch
areas. The new illustration respects reduced motion and Pause. Explore in 3D
retains the physiological model and a separate Chambers & flow control. A
subsequent full run exposed native caption-scroll timing; Home/End now explicitly
move within the caption region, with the existing regression retained.

## Remaining visual differences and limits

- The heart is an original generated illustration, not the exact reference
  image. Its decorative anatomy is labeled as illustrative; reference callouts
  are not reproduced. The interactive physiological model remains separate.
- The existing logo, selected-rail colors and theme controls are retained with
  minor differences from the mockup. Paper texture is not reproduced.
- Portrait adapts to the taller viewport; phone and enlarged reading content
  may scroll. Desktop WebKit is not a physical iPad measurement.
- Production has not been updated. A full green application run is still a
  separate release gate; do not infer it from this visual review.


## Latest-master integration

Integrated origin/master through 5126783, including the Apex rail placement
(Echo remains in Labs), scanned-model attribution/menu, pearl sizing/readability,
chapter resume and CI changes. Fresh captures confirm the invitation, heart and
session strip on the combined source. Portrait review caught the legacy hero
summary leaking through a more-specific upstream rule; the corrected selector
keeps that copy hidden. Geometry checks at 1312×910, 834×1194 and 744×1000 show
Home, Brain and Labs fitting their page viewport. The focused reader reclaims
the session strip's space and uses a compact hero on short portrait tablets.

The visual comparison passes with the differences listed above. Full private
Chromium and WebKit/PWA validation remains a separate, pending release gate.
