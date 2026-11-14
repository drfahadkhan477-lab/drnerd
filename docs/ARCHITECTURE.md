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
| `src/core/` | Models with no DOM: physio, FSRS, pearl, brain, store, flagset, apexsignals, and what has left the shell (markdown, providererror, reviewqueue, apexwire, apexturn) | Must run under Node for the pure suites |
| `src/ui/` | Presenters that draw: wiggers, ecg12, echo, heroRhythm, pencil, livingDiagram | DOM allowed, no business rules |
| `src/lab/` | The Practice Lab: sounds, tracings, strips, heartmap, drill, progress, items, ui | Only `mountPractice()` reaches it |
| `src/app/` | Screens that have left the shell, one file each: results, memory, rhythmlab | A function of what the page hands it; changes nothing it is given; must run under Node |
| `app/` | The shell, its CSS, vendored libraries | Slot tokens live here |

## The shell's script

Most of the app's logic is still one inline script in `app/systole.html`, where
every function can reach every script-level name. `docs/SHELL-MAP.md` says what
each one reads, writes and calls, and in what order they can leave;
`tools/shell-map.js` writes it, and `--check` says whether it is current.

A function leaves by one pattern (roadmap E1). Its body goes to a `src/` module,
slotted where the function stood, taking as arguments what it used to reach
for. The shell keeps a one-line function of the same name, so no caller, inline
handler or suite changes. A pure suite holds the module, and holds the shell's
line to handing over the right things. Before moving one, read its entry in the
map for what runs as the script loads: a function declaration is hoisted and a
module is not.

A screen leaves the same way, into `src/app/` (roadmap E1 step 3). Its builder
becomes `screenHtml(S, …, kit)`: the page's state, the bank's names it reads,
and a kit of the page's helpers its markup uses (`e`, `icon` and the like). The
parameters keep the page's names for the same things, so the body moves as it
stood. The handlers its buttons name stay in the shell: an inline handler is
read where it is tapped, in the page. The map follows the state into the
module, so the screen is still listed under each field it reads.

A handler that asks with `confirm()` stays in the shell as it is, even when
only its screen calls it. `tests/verify-ui-pure.js` lists every native dialog by
the file that calls it, and reads only a call written out with its message; one
reached through a part handed to a module would be a dialog that rule could no
longer see.

A screen with state of its own keeps it in the shell for now, with the handler
that writes it and the mounts that draw into its canvases: the Rhythm Lab's
`labKind`, `setLab()` and `mountLab()`. The module is handed the values as they
are when the screen is drawn. A function that decides something the first time
it is asked (`physioIsPlaying()`, from Reduce Motion) is handed over as the
function, never as its answer. The markup and the mounts meet at element ids
and data attributes, and the screen's pure suite holds that each one the page
looks up is in the markup under that name.

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
