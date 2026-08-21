# The splash heart

Embedded into the app by `scripts/splash-heart-patch.js` — inline in the
single-file build, extracted to `content/splash-heart/` and fetched by
`scripts/build-pwa.js` in the split build.

| File | What it is | Licence |
|---|---|---|
| `lottie.min.js` | lottie-web 5.13.0, SVG renderer only (`lottie_light.min.js` upstream) | MIT |
| `heart.json` | the animation itself — a machined anatomical heart on a lit instrument plate, generated (not hand-drawn frame by frame) so every keyframe and gradient stop is data | — (this project's own) |

`heart.json` is a standard Lottie file: it opens in Lottie-aware tooling, and
could be replaced by an After-Effects export later without touching the code
that mounts it. It was authored by a small Python generator kept outside this
repository, the same way the app's other generated assets are — the output is
what gets committed and built from, not the generator.
