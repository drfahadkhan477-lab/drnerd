# Quiet Atlas design review

final result: blocked

The implementation is available for code review. This is not a declaration of
production readiness or pixel-matched fidelity.

## Evidence

- Source visual truth: the owner's selected Quiet Atlas screenshot in the task
  conversation. Its original image file is not available in this checkout for
  a normalized, combined comparison artifact.
- Implementation captures: ignored `build/atlas-qa/1180-0.png`, with matching
  Brain and Labs captures and portrait captures alongside it. Browser viewport
  dimensions are encoded in the filenames; capture density is one CSS pixel
  per image pixel.
- States: synthetic bank, light theme, Home/Brain/Labs. Browser suites also
  exercise dark-theme accessibility, keyboard navigation, motion preferences,
  swipe navigation and rotation.
- Full-view and focused source/implementation comparison: not completed as a
  combined image; do not claim exact reproduction.

## Findings and changes

- Typography: reused local DM Serif Display for the pearl and page headings.
  Replaced newly introduced fixed text sizes with the existing type ladder.
- Layout: moved tablet controls to a left rail, put the pearl before the heart
  in landscape, and compacted the Brain chapter grid and Labs launchers.
  Browser checks cover page overflow; long pearl reading can still expand.
- Color: warm paper and teal apply to the default light Home surface;
  alternative palettes and dark mode remain available. Fixed score contrast
  on the new light header.
- Images: reused the existing interactive physiological heart and source
  figures. The heart differs from the static anatomical illustration in the
  selected reference. No replacement medical imagery was generated.
- Content: retained real pearl rendering and provenance. Added a next-session
  action driven by due questions, with Chapters as the empty-queue route.
- Accessibility: named and keyboard-enabled the pearl scroll region; updated
  tab orientation on resize and added vertical arrow navigation.

## Review history

Initial captures showed a vertically centered rail and blue header. The rail
now fills the left edge and the default light header follows the paper palette.
Tests caught a hidden pearl animation, stale orientation after resizing to a
phone, off-scale text sizes and low-contrast header scores. Those issues were
fixed and affected checks rerun. Raw reports remain outside Git.

## Release gates still open

- Compare the original source image and final captures in one normalized
  visual review; decide whether further heart framing and visual refinement
  are wanted.
- The licensed library is now recovered and hash-verified. The initial full
  run found a short-portrait pearl-reading defect; the hero has been compacted
  to preserve reading room. The focused probe passes, but the full app and
  regenerated PWA still need validation. See the private-checkpoint JSON.
- Review CI results and the remaining affected theme/layout coverage before
  merging or deploying. Desktop WebKit does not constitute a physical iPad run.

## Latest visual comparison — 0e88344

The owner reattached the selected reference. A direct visual review against the
new licensed Home capture confirms the ivory/teal palette, dark serif heading,
left navigation rail, two-column landscape composition and bottom session strip.
All three landing pages fit at 1180×820, 834×1194 and 1024×768 in the measured
Chromium captures, with no page overflow in those nine cases.

This remains an adaptation, not a faithful reproduction: the existing animated
heart is smaller than the reference anatomical illustration; the hero repeats
the brand and greeting; search remains an icon rather than a field; and actual
pearl content replaces the reference's Observe/Explain/Recall introduction.
Long headings occupy more space, with Show all retaining access to the text.
These differences remain visible and are not treated as resolved visual findings.
The reference and captures have not been assembled into a normalized artifact.

The latest capture includes Pause/Play. Private screenshots and full logs stay
outside Git. The portrait fix passed all 97 licensed pearl checks on 818a02d.
The full Chromium Systole/PWA run now targets 0e88344; focused WebKit and PWA
checks are queued. No complete release pass or deployment is claimed.

## Reference-faithful Home checkpoint

The owner explicitly requested the supplied composition on 2026-10-28. The
landing now uses the large Make one idea stick heading, Observe/Explain/Recall
steps, visible search, a generated anatomical illustration, and the next-session
strip. Begin recall opens the existing real pearl reader; Read note opens its
source. The physiological 3D heart remains accessible through Explore in 3D.

This supersedes the earlier layout comparison. The initial Chromium full run
was stopped for this new scope, and its partial passes do not validate this
redesign. New focused checks exposed hidden-reader assumptions and a short
portrait reading-space issue; corrections and interaction tests are in progress.
The generated illustration is decorative and labeled illustrative anatomy.
No private files or raw logs are included in the checkpoint. Full validation,
negative evidence for new assertions, WebKit and final comparison remain open.
