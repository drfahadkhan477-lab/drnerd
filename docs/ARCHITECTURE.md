# Systole — the shape of it, in one page

Written 2026-10-27, for the reader who has to change something and wants to know
what they are standing on. `AGENTS.md` holds the rules; this holds the map.

## The spine

One HTML file ships. `app/systole.html` is the shell: markup, styles and the
app's own code, with `@@SLOT[kind:name]@@` tokens where generated content goes.
`scripts/assemble-app.js` fills those slots and writes the build.

    app/systole.html  ──┐
    app/css/*.css       ├─ assemble-app.js ─→ build/systole.html (one file, offline)
    src/**/*.js         │                          │
    the bank + figures ─┘                          └─ build-pwa.js ─→ dist/ (split build)

Three slot kinds. `payload` is data (the bank, the seeded notes, the baked heart
mesh). `src` is a module from `src/`. `app` is a file from `app/` (a stylesheet,
a vendored library). `scripts/app-slots.js` defines the token and the fill.

The **split build** (`scripts/build-pwa.js`) takes that single file apart again
for the web: a small shell, the bank as a separate fetch, figures on demand,
fonts and big libraries lifted into `vendor/` and precached by the service
worker. The shell has a hard budget — gzip(index.html) + gzip(app.js) under
280 KB — enforced by `tests/verify-pwa.js`. Three things have been lifted out of
it to stay under: PhotoSwipe, perfect-freehand, and the Practice Lab.

## The layers

| Layer | Holds | Rule |
|---|---|---|
| `src/core/` | Models with no DOM: physio, FSRS, pearl, brain, store, flagset, apexsignals | Must run under Node for the pure suites |
| `src/ui/` | Presenters that draw: wiggers, ecg12, echo, heroRhythm, pencil, livingDiagram | DOM allowed, no business rules |
| `src/lab/` | The Practice Lab: sounds, tracings, strips, heartmap, drill, progress, items, ui | Only `mountPractice()` reaches it |
| `app/` | The shell, its CSS, vendored libraries | Slot tokens live here |
| `memorizer/` | A sibling product with its own store and pipeline | Shared philosophy, separate codebase |

## The clock

The teaching win, and the thing to be careful with. One cardiac cycle time
drives the physiology, the twelve-lead, the 3D heart and the rhythm strips, so
one event shows up in every view at the same instant. `src/core/physio.js`
computes valve events as **pressure crossings**, not as fixed offsets — that
invariant is why the Wiggers diagram and the PV loop agree. Changing a timing
constant changes every view at once.

## Storage

Two tiers, deliberately. Boot state (progress, flags, notes, FSRS cards) is
synchronous and small. Large stores (reference images, bank packs) live in
IndexedDB behind `src/core/refassets.js` and `src/core/bankstore.js`, written
atomically so a half-finished write never strands the last good copy.

## Where the heart is baked

Worth knowing before touching `src/core/heart3d.js` (2,118 lines).

The mesh is **not** computed in the browser. `assemble-app.js` reads
`heart3d.js` as a single file, evaluates it at build time, and bakes the surface
mesh into the build as the `HEART_MESH` payload. `build-pwa.js` then lifts that
baked mesh back out of `app.js` (`splitHeartMesh`) into its own digest-named
file, and asserts the module reached `app.js` verbatim — if a build step edited
it after the bake, the build fails on purpose.

### If you split heart3d.js

It decomposes cleanly by section — vector/matrix helpers, SDF primitives, the
anatomy, mesh building, shaders, animation, the public API — but four places are
coupled to it being **one file**, and all four must move together:

1. `app/systole.html` — the `@@SLOT[src:src/core/heart3d.js]@@` line becomes several, in dependency order.
2. `scripts/assemble-app.js` — `HEART_MESH` reads one path; it would have to concatenate the pieces in the same order before baking.
3. `scripts/build-pwa.js` — `splitHeartMesh()` and the verbatim-reached-app.js assertion.
4. `tests/verify-heartreuse.js` and the floor suites, which drive the mounted heart.

The risk is specific: the mesh is baked, so a wrong concatenation order produces
a build that renders a subtly wrong heart **without failing anything**. Any split
must assert the baked mesh is byte-identical before and after. Do it as its own
change, with nothing else in it.

## Tests, in one breath

`scripts/verify.js` is the registry. Pure suites need no browser and run on every
push. Browser suites run in Chromium and, for anything the iPad touches, WebKit —
Chromium alone never establishes iPad compatibility. `tests/test-stats.json` is
written only by full green runs and is checked against the numbers quoted in
prose. A check you have not seen fail is a check you have not written.

## Deploy

`npm run build` from the licensed export, then `npm run pwa`, then direct upload
to the Cloudflare Pages project `systole` (`systole-9hq.pages.dev`), which sits
behind Cloudflare Access. The licensed inputs never enter Git; `scripts/leak-guard.js`
and a pre-push hook enforce that.
