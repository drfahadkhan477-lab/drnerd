# Systole UI revamp: glass Study Tools, a glass nav capsule, one design language

> Approved plan, November 2026. File and line references are to commit `16911e7` and will drift; re-read the code before acting on one.
> Each task names the model and effort to run it with (see "How to run a task").

**In short**
- **Study Tools** (the circled block) becomes a two-row bento of solid tinted tiles: Chapters and Progress on top, four utilities below, no empty cell, no blur on the tiles, and the due count readable at a glance.
- **One glass language**: a single token set shared by Home, Labs and the inner screens, and a lint for CSS variables that are used but never defined. Two exist today (`--hp-b`, `--font-serif`); fixing either changes pixels, so each is your call.
- **A glass capsule in the header band** (Home · Brain · Labs · Chapters) on inner screens, with a sliding active indicator. Home's first page, the reading screens and phones stay as they are in v1. Apex stays a floating button, restyled as the orb.
- **Guards**: contrast by pixels, a ceiling on blurred surfaces, the Safari-13.4 CSS floor and the 288 KiB shell budget, each new check seen to fail first.
- **First step**: a clickable preview on invented content that you open on the iPad, before any app code changes. Every task below names its model and effort.

**Baseline measured (T0.1)**: `docs/validation/ui-revamp-baseline.json`, written by `tools/ui-baseline.js` on a synthetic build in Chromium.

## Context

The owner shared five screenshots: four Code XR "glassy UI" reels (Glassy Navbar V10, Liquid-glass Hero, Glassy Navigation Tabs V5,
Glassy Carousel V2) and the live Systole **Labs** screen on the owner's iPad with the **Study Tools** block circled and
"Revamp" written beside it.

The Labs screen shows the problem the roadmap already names: *two design languages* (`docs/ROADMAP.md` risk 3, item D1). Four saturated
lab cards sit above six flat navy tiles that carry the daily-driver tools. The goal is to make the tools block part of the same product,
add wayfinding, and bring the glass language of the reels to the whole app without breaking the repository's gates.

**Decisions already made by the owner**

| Question | Answer |
|---|---|
| Navigation | **A floating glass pill on inner screens only**; Home stays the calm single page (roadmap rule: no new element on Home). A design review then refined the placement: the default is a capsule in the header band, not an overlay below it (section C says why). The preview shows both and you pick. |
| Look | **Hybrid.** Calm frosted glass for the navigation layer; liquid sheen, glow and spring motion only on the active-tab indicator and the Apex orb. |
| Goal | **Best personal study tool.** No commercial work in this plan. |

**Not in this plan**: new features (streaks, readiness scores, new Home elements: the discovery doc warns the build is far ahead of use),
retiring themes (D6), the question-reading screens (quiz, results, mock), a phone bottom tab bar (v1), anything commercial. The licensed bank,
`scripts/leak-guard.js` and the offline behaviour are untouched.

**Model and effort**: every task carries a recommended model and effort from the project's own rules (`docs/ROADMAP.md` section 7,
`docs/CLAUDE-USAGE.md`). Run each task in a fresh session (AGENTS.md: one session per task).

---

## What the screenshots show

### The Labs screen: what is wrong, with the code behind it

| # | Finding | Where |
|---|---|---|
| 1 | **Two languages on one page.** Lab cards are saturated gradients; the tools are flat `.door` tiles in three CSS layers. | `app/css/home.css:106-148`; `cardiac.css:410-435, 532-544, 748-771`; `nav.css:158-236` |
| 2 | **Hierarchy is upside down.** Chapters, Search and Progress are the most-used tools and the smallest, dimmest objects (13 px title, 11 px grey caption, 21 px icon in a 7 px chip). | `cardiac.css:428-432, 750-751` |
| 3 | **The most useful fact is buried.** "1 due for review" is grey sub-text. | `src/app/home.js:248` |
| 4 | **Ragged grid.** `.door-wide` full row + 5 doors in 3 columns leaves cell 6 empty, exactly under the Apex button. | `cardiac.css:426`; `home.css:384` |
| 5 | **No wayfinding.** Brain and Labs are pager pages; the only control is a lone "Home" pill. Every screen has its own back button style (`.home-back`, `.sb-back`, `.study-back`, `.plab-back`, bare `.btn`, `.ns-back`) and Echo Studio has none. | `src/app/home.js:207-208`; per-screen modules |
| 6 | **Glass with nothing to refract.** All six tiles blur 20 px over a flat navy ground. Home's aurora is meant to supply colour, but its second colour `--hp-b` is defined nowhere in the repo, so that `background` is invalid at draw time and should paint nothing (to confirm in a browser, T0.1). `--font-serif` is likewise undefined. | `cardiac.css:532-537, 152, 916`; `home.css:902` |
| 7 | **Unlabelled status.** "1/5 · 20%" is the session score (correct of answered), red below 50%, with no label or accessible name. | `app/systole.html:5821, 5832-5837` |
| 8 | **Sloppy copy.** "1 chapters", "1 references" and, by the same code, "1 things Apex knows". | `home.js:248, 253, 254`; `tests/verify-homescreen-pure.js:89, 92, 95` |
| 9 | **Dead or stale CSS.** `.door-ic [data-icon]` tilt rules never match; the 280 px lab-card height is overridden; `.lab-card` has no focus-visible ring; lab hues are hard-coded with no palette override (Contrast palette included). | `home.css:142, 382, 747-750, 111-114` |

### What the four reels share (design DNA)

| Reel | What it does | Port | Skip |
|---|---|---|---|
| Navbar V10 | Floating inset pill, orb at left, icon + label items, frosted highlight chip on the active item, one dark CTA | Capsule, concentric radii, highlight on the active item | The CTA; an orb inside the bar (Apex stays a floating button) |
| Liquid-glass Hero | Nested translucent panels with iridescent sheen and a big stat | Iridescence only on the Apex orb and the active indicator | Glass-on-glass hero panels (Apple advises against) |
| Navigation Tabs V5 | Four bars: glowing outline bulging around the active tab; spotlight cone; notch with a docked circular action; dot indicator | Active-indicator variants (owner picks in the preview) | The bottom bar and notch geometry in v1 |
| Carousel V2 | 3D coverflow of glass cards with a floating transport bar | Nothing now (a gimmick for a study screen; a later fit for Echo views) | All of it |

Two facts shape everything. The code overlay in all four reels is the same unrelated React/Framer-Motion snippet, so there is nothing to copy and
we rebuild from the visuals in vanilla CSS. And the reels show glass over rich photos while Systole's ground is flat navy, so glass needs colour
behind it.

---

## Research that shapes the design (sources at the end)

- **Apple HIG.** Liquid Glass is for the *navigation layer* that floats above content ("don't use Liquid Glass in the content layer"); use it
  sparingly; prefer five or fewer tabs with single-word labels; on iPad the tab bar sits near the top; minimise-on-scroll is an iOS behaviour;
  supply higher contrast for Increase Contrast; replace x/y/z motion with fades for Reduce Motion; 44 pt targets.
- **Safari limits.** True refraction (SVG-filter `backdrop-filter: url()`) is Chromium-only. Unprefixed `backdrop-filter` arrived in Safari 18
  (keep the `-webkit-` twin). An ancestor with `will-change: opacity`, `opacity < 1`, `transform` or `filter` becomes a backdrop root and stops a
  blurred child sampling what is behind it (WebKit 289149). Full-viewport `filter: blur()` layers caused paint bugs on iOS 26.2 (Apple forums
  813733), so no blurred "aurora" layers. `linear()` spring easing is not hardware-accelerated in released Safari (WebKit 312407): use the
  existing `--spring` cubic-bezier. Safari does not support `prefers-reduced-transparency`.
- **Accessibility critique of Liquid Glass.** Low contrast over busy backgrounds is the recurring failure, so text sits on thick or tinted
  surfaces and the High-contrast palette stays solid.
- **Libraries.** GlassKit (MIT) is 16.7 KB gzipped of CSS and needs `color-mix`; liquid-glass-js and liquidGL are WebGL/SVG refraction. None is
  worth vendoring against a 288 KiB shell budget: we borrow the layering recipe only (translucent fill, `blur + saturate`, 1 px rim, inner top
  highlight, soft shadow).
- **Competitors and retention.** UWorld and AMBOSS compete on QBank + library + analytics + offline; BoardVitals reviews complain about taps to
  zoom images and no in-app feedback. Duolingo's own test found that letting one lesson keep a streak, separate from the daily goal, raised
  day-14 retention 3.3%. The lesson for the UI: make the next action one tap.

## Constraints from this repository (non-negotiable)

1. **Safari floor iPadOS 13.4.** Every CSS feature newer than that needs a row in `tests/css-floor-table.json` and a fallback (`color-mix()` needs
   an `@supports not` companion; `backdrop-filter` needs its `-webkit-` twin with the same value; `inset` and `padding-block` are banned; `dvh`
   needs `vh` first). Rules of thumb for all new CSS: grid rather than flex `gap` (Safari 14.5); `:focus-visible` in a rule of its own; no
   `aspect-ratio`, `translate` or `:has`; decorative wrappers `pointer-events:none`. Verified by `verify-floor-css-pure` and `verify-floor`.
2. **Every `:hover` inside `@media (hover:hover)`** (`verify-hover-pure`, `verify-taps`); `pointer:coarse` and `any-hover` are not allowed guards.
3. **Shell budget** gzip(index.html) + gzip(app.js) < 288 KiB (`tests/verify-pwa.js:181`). This plan is estimated at +2 to 2.5 KiB gzipped (4
   pessimistic; CSS compresses about 0.24, JS about 0.3). T0.1 measured 278,756 B on the synthetic build, about 15.8 KiB under the cap
   (the real build may differ); the cap is owner-approved, so it is not raised. Offsets: merge the three `.door` layers (about 0.5 KB); delete the aurora gradient if you choose to drop it
   (about 0.2 KB); trim the `.door` entries at `nav.css:156-176` only together with `verify-glass`, which pins them.
4. **Pinned tests.** `verify-homescreen-pure` pins the Labs markup by regex; `verify-homepager` requires every landing page to fit at 1180x820,
   834x1194 and 1024x768 and zero `.home-tabs` / `[role=tab]`; `verify-taps`; `verify-contrast` (Labs text against real pixels, 12 theme states);
   `verify-glass` (literal anchors at `nav.css:128, 261` and `app/systole.html:3157`; it pins the `.door` sheen); `verify-type` (px font sizes only on
   9/11/13/16/19/23/28/33/40/48/58 or `--t-*`); `verify-echo` slices `home.js` between two 6-space-indented tags (leave `.lab-card` markup alone).
5. **Home gets nothing new**, and "no rail, no tab bar" stays true for Home. The capsule must not use `.home-tabs`, `.home-tab` or `role="tab"`, and must
   not render on Home page 0.
6. **Nothing animates under a blurred surface; long lists are not blurred** (`home.css:896-899`, `verify-homepager.js:480-523`). That check covers only
   Home's aurora; the Rhythm, Echo and Practice canvases need their own (T5.2).
7. **Evidence rule.** For every new or changed check: inject the defect, watch its FAIL line, restore, put the evidence in the PR. Never move a
   threshold to turn a suite green. Report "N measured now, M reused".
8. **WebKit is not installed in this cloud container** (Chromium only). WebKit runs in CI (`synthetic-webkit`); attach screenshots as CI artifacts and
   make the final call on the iPad.
9. **Private build and deploy** need the owner's licensed export and Cloudflare login: owner's laptop only. `npm test`'s split-build phase hardcodes
   `<repo>/content` and `<repo>/dist`: harmless in a cloud checkout, but on the laptop run it in a separate clone.
10. **Other work in flight**: draft PR #435 (the Apex button's avatar follows Apex's state) touches `#aiFab`; only the orb restyle (T3.3) waits for it.

---

## Design

### A. One glass token set (D1, first slice)
New `app/css/glass.css`, slotted right after `base.css` (one `@@SLOT[app:...]@@` in the `<style>` line at `app/systole.html:21`; no script lists CSS files, so
cascade order is the trap). Tiers after Apple's regular/thick: `--glass-thin`, `--glass-regular` (today's `--card-glass`, 62%), `--glass-thick`, plus
`--glass-rim`, `--glass-hi`, `--glass-shadow` and a concentric radius scale (28 / 20 / 14 / pill). Reuse the motion tokens `--spring`, `--glide`, `--ease`.
**No visual change by construction**: today's names stay as per-scope aliases (for example `--gl-edge: var(--glass-rim)` at `:root`; `#homePages` already
shadows `--gl-edge`, `home.css:891`). Blur values are written literally with an identical `-webkit-` twin (`verify-ipad-pure`, `verify-floor-css-pure` and
`verify-glass` all pair them; WebKit 289800 makes `var()` in `-webkit-backdrop-filter` unreliable). Every glass rule is excluded under
`html[data-palette="contrast"]`, as today.

### B. Study Tools bento (the circled block)
CSS-first, so most pinned markup survives.
- **Grid.** At >= 700 px, 4 columns: row 1 **Chapters** (span 2) + **Progress** (span 2); row 2 **Search · Notes · Memory · Annotations**. Below 700 px,
  2 columns (Chapters and Progress full width, then 2x2). A check asserts every row is filled: no orphan cell at any width. Two rows, so no taller than
  today's three. Equal spans mean `verify-home.js:253-255` ("Chapters wider than the next door") becomes "at least as wide as every other door".
- **Surface.** Solid tinted tile, **no `backdrop-filter`**: `--card` ground, 6% hue wash, inner top highlight, 1 px rim, soft shadow. This deviates from
  "frosted tiles" on purpose and the preview says so: the tools are content layer (Apple), the old blur was six compositing layers over a flat ground,
  and `.home-page-in` is a backdrop root while the pager glides (`--hp-d` > 0). Per-tool hue via `data-action` selectors from existing tokens (`--accent`,
  `--success`, `--warning`, `--purple`, `--danger`); the preview fixes the hues. The one-shot sheen from `nav.css` stays (`verify-glass` pins it).
- **Type and targets.** Title 16 px, caption 13 px (both on the type ladder), 40 px icon medallion, tiles >= 88 px tall. Press = `scale(.97)` with `--spring`;
  hover lift only inside `@media (hover:hover)`; focus ring stays the global 2.5 px teal ring. Keep `.door-ic .icon` and its `door-greet` one-shot
  (`tests/_atlas-landing.js:49-58`).
- **Due count.** v1 promotes the existing caption ("12 chapters · 1 due for review": 13 px, full-contrast text) with no markup change. Optional, if you pick it in
  the preview: a numeral badge as a text-only `<span aria-hidden>` after `.door-txt` (the pure regex ignores anything after it); it duplicates the caption, so it
  needs a reason.
- **Markup.** DOM order becomes Chapters, Progress, Search, Notes, Memory, Annotations (keyboard order = visual order). Keep the class strings `door` and
  `door door-wide` and add no attribute to `.door` (the pure regex needs both); Progress is placed by a `data-action` selector. Copy: "1 chapter",
  "1 reference", "1 thing Apex knows".
- **Edit location.** Markup in `src/app/home.js` (`labsHtml`, lines 213-257); CSS in a new `app/css/tools.css` slotted after `home.css`, replacing the three `.door`
  layers for `.lab-doors` only.

### C. Glass capsule navigation on inner screens
A design review of the first draft (a floating pill under the header) found three problems. A fixed overlay never changes `scrollHeight`, so `verify-homepager`'s
fit test would pass while the heading and the back button were covered. The landing pages are pinned to fit, so a reserved band costs height Brain and Labs may
not have. And a bottom bar collides with the Apex button, which sits bottom-right on every screen. Apple's own iPad pattern is a tab bar near the top, in the
toolbar. So:
- **Where.** In the header band (`#navbar`, fixed, already budgeted as `--navh`), centred between the brand and the right-hand buttons: no extra height, nothing to
  cover. Built by `buildNav()` (`app/systole.html:5819`) through a pure module `src/app/gnav.js` (kit pattern, `docs/ARCHITECTURE.md`; `docs/SHELL-MAP.md`
  regenerated). `renderNow()` repaints `#navbar` on every render, so the sliding indicator animates from the previous active index (FLIP). Pager moves (`homeGo`,
  which does not call `render()`) call `gnavSync()` once the glide has settled (`homeTween === 0`), not every frame in `homeMark()` (`:6801`). T3.1 may instead choose
  one persistent node outside the repaint.
- **Items.** Home · Brain · Labs · Chapters (Search is already an icon in the header). Active item from one map: `home` page 1 = Brain; page 2, `lab`, `echo`,
  `practice`, `sessions`, `stats`, `refs`, `memory`, `annotations` = Labs; `study` = Chapters; `search`, `notesearch` = no active item. `aria-current="page"`, a
  labelled `<nav>`, arrow-key roving focus. New action `goBrain`; the rest reuse `goHome`, `goLabs`, `goStudy`; all in the `ACTIONS` allowlist (`:5108`).
- **Where it shows.** Inner screens and Home pages 1-2, where the header's free centre allows: labels from roughly 820 px, icons only down to 700 px, absent below
  700 px in v1 (phones keep today's bar). Hidden on Home page 0, quiz, results, mock, mockreport and in focus mode.
- **Width is the risk.** The header is `max-width: --measure` (780/900/960 px) with 20 px padding; the brand takes about 165 px and the right-hand buttons 130-330 px.
  Brain and Labs wear Home's header, whose search is a wide pill (`min-width: 280px` from 1000 px), so the centre is smallest there; `body.has-gnav` can collapse that
  pill to an icon. T0.1 measures the free centre per screen at 744, 820, 1024 and 1180 px, with and without the session pill, and `verify-gnav` hit-tests that the
  capsule never overlaps the brand or the buttons. Measured in T0.1: inner screens leave 379-799 px free at 744-1180 px wide; Brain and Labs leave 223-427 px, and only
  111-315 px with the session score showing (tightest at 744 and 1024 wide), so there the search pill must collapse or the capsule go icon-only.
- **Look (Hybrid).** A translucent capsule on the bar with no backdrop-filter of its own (the bar is already 92% opaque and blurred): tinted fill, 1 px rim, inner top
  highlight. The active item is a sliding capsule (`transform`, `--spring`) with an accent glow; you pick the indicator variant from the V5 reel (dot, spotlight, bulge
  outline) in the preview. The bulge outline is the costly one (an inline SVG path, probably a floor-table row); the preview prices all three. It must read on both
  skins: the navy bar on inner screens and the paper bar on Home's Brain and Labs pages.
- **Apex.** Stays the floating button, bottom-right. It has five CSS layers (`apex.css:265`, `figures.css:104, 306`, `refinements.css:117`, `nav.css:170-253`,
  `home.css:27, 30, 980, 1014`), hide rules and geometry pins, so it is restyled, not moved: glass ground, an iridescent `conic-gradient` ring (no floor-table row yet:
  T5.3 adds it), state-aware once #435 lands; geometry untouched.
- **Back buttons stay** in v1, visible: `verify-homepager.js:171` needs focus on `#homePage2 .home-back`, `verify-taps.js:121-140` measures `.study-back`, and six
  pure suites pin the markup. The capsule complements them. Retiring them is an optional later task (T3.6).
- **T3.6, done (the owner asked for it).** While the capsule is up (`body.has-gnav`), a back button whose destination is a capsule item is set aside by
  `app/css/gnav.css`: Brain's and Labs' Home, Chapters' Back, and the Home or Labs of the Rhythm Lab, Search, Progress, Sessions, Annotations, the Practice
  lab, Notes and Memory. The markup is untouched, so a phone, focus mode, the question screens and a header with no room keep every back button. Kept everywhere:
  the Practice lab's back within the lab, the note search's Results, and the question screens' Home. The keyboard that opens Brain or Labs lands on the
  capsule's Home, and the capsule's Home hands it back to the door that was used. `verify-gnav-pure` holds the list to the source's buttons; the browser
  suites that tapped a back button at tablet width now take the capsule's item, after measuring that the screen's own button is set aside.

### D. Polish and motion
`.lab-card:focus-visible` (CSS only; leave the card markup alone); shared rim/shadow tokens; per-palette lab hues including the Contrast palette; label the session pill
(`aria-label` "This session: 1 of 5 correct, 20%"); style `#navbar` in one place (today three: `nav.css:5-10`, `cardiac.css:528-531`, `home.css:402`); spring press,
indicator slide and entrance stagger; `prefers-reduced-motion` and Home's Pause respected.

### E. Guards
- A ceiling on visible `backdrop-filter` elements per inner screen; nothing animates under a blurred surface (including the Rhythm, Echo and Practice canvases under the
  header); `backdrop-filter` is never animated; no `will-change` or `opacity` on ancestors of blurred elements.
- A pure lint: every `var(--x)` used in `app/css` has a declaration (`verify-tokens.js` covers only colour aliases today). Its allowlist is seeded with the two known
  cases, then each is fixed as its own owner-decided change.
- Contrast by pixels for the changed screens in 12 theme states; High-contrast palette solid; `prefers-contrast: more` and `prefers-reduced-transparency` used only as
  progressive enhancements (floor-table rows).

---

## Work plan: tasks, with model and effort

**How to run a task** (`docs/ROADMAP.md` section 7): start a fresh session, set the model and effort before the first message, then give the task id: "Do T2.2 from
docs/UI-REVAMP.md". Terminal: `/model opus` or `/model sonnet` or `/model haiku`, then `/effort high`. Cloud session: the same commands typed in the chat (if the session
will not take `/effort`, run that task from the terminal CLI). `/model opusplan` plans on Opus and executes on Sonnet. No task needs `fable` or `max`.
Levels in this repository: `low` docs, lookups, reading a CI log; `medium` a clear spec with a suite that covers it; `high` anything that touches WebKit, the build, or a
check whose FAIL evidence matters (the default for real work).

### Phase 0: baseline, preview, decisions (no app code)

| Task | What | Model · effort | Why this tier |
|---|---|---|---|
| T0.0 | Save this plan as `docs/UI-REVAMP.md` (line references dated to commit `16911e7`; no counts a suite would have to guard), link it from `docs/ROADMAP.md` D1/D5, open a draft PR (WORK-MAP: claim work early), read PR #435 | Haiku · low | Doc and lookup work |
| T0.1 | Baseline on a synthetic build. "Before" captures of Home, Brain, Labs, Chapters at 1180x820, 834x1194, 1024x768, 744 and a phone, dark and light. Numbers: free centre width of the header per inner screen at 744, 820, 1024 and 1180 px with and without the session pill; `#navbar` z-index against `#ai`, `#peek` and Settings; Labs and Brain slack (`clientHeight - scrollHeight`) at the three pinned sizes plus 744; per inner screen, its scroll container, fixed or sticky nodes within 80 px of the top and bottom, and animations or canvases under the header; the Apex button's rect per screen; `verify-pwa`'s byte count (split build); visible `backdrop-filter` count per screen; whether `--hp-b` and `--font-serif` really change pixels | Sonnet · medium | Scripted, clearly specified |
| T0.2 | Interpret T0.1, then build a clickable preview on invented content: Study Tools bento (caption vs badge), the capsule in the header band and, for comparison, the floating-below variant, three indicator variants, the restyled Apex orb; dark and light; iPad portrait and landscape. Published as a private artifact to open on the iPad (it renders in WebKit) | Opus · high | Interpreting measurements plus visual judgement from screenshots (roadmap: D1 decisions) |
| T0.3 | You pick: capsule placement and indicator variant, tile hues, caption or badge, whether Home's aurora is restored or dropped (`--hp-b`), whether the Progress title becomes serif (`--font-serif`), capsule hidden in reading screens | You | A decision, not a task |

### Phase 1: tokens and two latent bugs

| Task | What | Model · effort | Why |
|---|---|---|---|
| T1.1 | The pure lint "every `var(--x)` resolves", allowlist seeded with the two known cases; inject-and-restore evidence | Opus · high | Check design where "prove it fails" matters |
| T1.2 | `--hp-b`: define it or delete the dead gradient, as you decided in T0.3 (defining it paints an aurora on Home); own PR, before/after captures, contrast re-run | Sonnet · medium | Small change after a decision |
| T1.3 | `--font-serif`: define it or switch the two rules to `--font-display`, as decided (T0.1 measured: only the Progress screen's `.stats-title` changes, from DM Sans to DM Serif; the Home hero heading already computes to DM Serif through another rule); own PR, before/after captures | Sonnet · medium | Same |
| T1.4 | Token map: inventory `--gl-*`, `--card-glass`, `--glass`, `--lab-*`; names, tiers, the `--gl-edge` collision; a table in the PR | Opus · high | Roadmap D1 decisions row |
| T1.5 | Move tokens into `glass.css` with aliases for today's names, no visual change; before/after captures; `verify-glass`, `home`, `homepager`, `theme`, `tokens`, `contrast`, `floor`, `ipad-pure` | Sonnet · medium | Roadmap D1 token moves row |

### Phase 2: Study Tools (the circled block)

| Task | What | Model · effort | Why |
|---|---|---|---|
| T2.1 | `labsHtml`: DOM order, plural copy, nothing else added. Update the pins: in `verify-homescreen-pure` lines 85 (order), 86 (actions), 87 (icons), 89 and 92 (singular copy), 90 (indices: Search becomes d[2], Progress d[1]), 437 (`says` order), and add a "1 thing Apex knows" case; `verify-home.js:253-255`; check `verify-pwa.js:207` (`/\d+ references/` with a singular). Keep intact: the `doors()` regex shape (line 60), 84, 345-351, 356, 438 | Sonnet · high | Small change under many pins; medium is enough if this list is in the prompt |
| T2.2 | `tools.css`: bento grid, per-tool hue, states, reduced motion, solid in the Contrast palette; delete the superseded `.door` layers for `.lab-doors`; keep `door-greet` | Sonnet · high | WebKit-sensitive CSS, clear spec |
| T2.3 | Checks: row-filled and no-orphan assertions at four widths, targets >= 44 px, no `backdrop-filter` on tiles, six actions reachable, focus order = visual order, reduced motion, all added to `verify-homepager` (it already loads Labs at the pinned sizes; no new suite). Add Labs to the screen lists of `verify-a11y` (axe), `verify-layout` and `verify-floor`, none of which opens it today. Each check seen to FAIL | Opus · high | New check design |
| T2.4 | Separate PR, optional: dead CSS (`.door-ic [data-icon]`, the 280 px rule, stale tab-bar comments, the `body.on-home .nav{padding-left:104px}` leftover) to buy shell bytes | Sonnet · low | Tidying |

### Phase 3: glass capsule navigation

| Task | What | Model · effort | Why |
|---|---|---|---|
| T3.1 | One-page spec in the PR: in-flow versus persistent node, item labels versus icon-only from T0.1's widths, the screen-to-item map, hide rules, `gnavSync` on settle, `body.has-gnav`, which pins change | Opus · high | Architecture call across shell and pager |
| T3.2 | `src/app/gnav.js` with its pure suite, the `buildNav()` call, `goBrain` and `gnavSync`, `app/css/gnav.css` (capsule, sliding indicator, both skins, reduced motion) | Opus · high | A shell state machine plus WebKit behaviour; the roadmap pairs Sonnet-high only with an Opus review |
| T3.3 | Restyle the Apex button as the orb (CSS only, geometry untouched) after #435 lands; `verify-taps`, `verify-contrast` (name over the gradient), `verify-glass` anchors | Sonnet · high | Layered CSS with geometry pins |
| T3.4 | Browser suite `verify-gnav` (hit-tests, >= 44 px, no overlap with the brand, the header buttons or the Apex button, hidden states, reduced motion, contrast, nothing animates under the capsule, the Apex panel docked open, the largest text size); re-word the "no tab bar" titles in `verify-homepager:91-92` | Opus · high | New check design |
| T3.5 | Measure the shell budget; `node tools/shell-map.js --write` | Sonnet · medium; Haiku · low for the tool run | Budget arithmetic; mechanical |
| T3.6 | Optional, last: retire per-screen back buttons where the capsule covers them (updates `verify-homepager:171`, `verify-taps:121-140`, six pure suites, `verify-quiznav`, `verify-chapters`, `verify-searchwarm`, `verify-flags`) | Opus · high | Cross-cutting change under many pins |

### Phase 4: polish and motion (after Phase 2: shared `home.css` and `cardiac.css`)

| Task | What | Model · effort |
|---|---|---|
| T4.1 | Lab cards: focus ring, shared rim tokens, per-palette hues incl. Contrast (markup untouched) | Sonnet · medium |
| T4.2 | Header: labelled session pill, `#navbar` styled in one place | Sonnet · medium |
| T4.3 | Motion: spring press, indicator slide, entrance stagger; reduced-motion and Pause parity | Sonnet · medium |

### Phase 5: hardening and release

| Task | What | Model · effort | Why |
|---|---|---|---|
| T5.1 | Contrast sweep: changed screens x 12 theme states, fix what fails | Opus · high | Roadmap D2 row |
| T5.2 | Glass budget guard: visible `backdrop-filter` ceiling; nothing animates under blur, including the Rhythm, Echo and Practice canvases | Opus · high | Check design |
| T5.3 | Floor-table rows (`scripts/css-floor-table.js`, e.g. `conic-gradient`), `verify-floor`, hover guard | Sonnet · high | Touches the floor machinery |
| T5.4 | Full measured runs: `npm test`, `SYSTOLE_ENGINE=webkit npm test` where WebKit exists (CI), pure suites under `TZ=America/New_York`; watch CI; report "N measured now, M reused" | Sonnet · low; Haiku · low to read one log for FAIL lines | Roadmap: watching a PR, reading CI |
| T5.5 | Docs: record the reversal of "no tab bar" for inner screens in `docs/DESIGN-HANDOFF.md`, `docs/ROADMAP.md` D1/D5 status, stale comments | Sonnet · low | Docs |
| T5.6 | Whole-diff review (`/code-review high`) | Opus · high | Silent-failure hunt |
| T5.7 | Private build and deploy to the Access-protected `systole` Pages project, only after the private gate passes (AGENTS.md authorises it; verify project, Access and SHA first) | Sonnet · high, on the owner's laptop | Touches the build and release |
| T5.8 | A 30-40 minute real session on the iPad; note battery % before and after (the discovery doc's one experiment) | You | Use beats build |

**Phase 5 status (November 2026).**
- T5.1: `verify-contrast` now also reads Echo, the Practice lab, Search, Annotations and Memory, the screens the capsule reaches that
  it did not open.
- T5.2: `tests/verify-glassbudget.js`. It found the Rhythm Lab readout blurring a canvas that draws every frame, and the header's icon
  buttons blurring inside the blurred bar; both were fixed.
- T5.3: `conic-gradient` has its floor-table row (Phase 3); the new rules use nothing newer than the floor.
- T5.4: the full measured run is CI's (both engines); here, the affected suites in Chromium and the pure suites, also under
  `TZ=America/New_York`.
- T5.5: `DESIGN-HANDOFF.md` and `ROADMAP.md` record the capsule and what landed.
- T5.6: `/code-review high` on this branch's diff (the `--card2` fix, T3.6, T5.1, T5.2). It found the glass budget blind to anything with
  `pointer-events:none` and to glass carried by a moving ancestor, and no browser suite still tapping the real back buttons, which phones
  rely on. All three are fixed, with smaller points. Phases 0 to 4, merged earlier, were not reviewed again.
- T5.7 and T5.8 are the owner's: they need the licensed export, the Cloudflare login and the iPad.

**Sequence.** T0 first. In Phase 1, the lint (T1.1) first; the two bug fixes wait for your T0.3 decision. Phase 2 and the capsule work (T3.1-T3.2) can run in
parallel sessions: they touch disjoint files (T2: `home.js`, `cardiac.css`, `home.css` and three suites; T3: new files plus `buildNav` hunks). T3.3 waits for #435.
Phase 4 follows Phase 2. Serialise suite registrations: `PENDING_RECORD` in `scripts/verify.js` is one long line and `verify.yml` is shared. A new pure suite needs a
`SUITES` entry, a `PENDING_RECORD` entry and a `logic` step named "... (N checks)"; the browser suite needs a step in `verify-browser-shard.yml` gated by
`contains(steps.shard.outputs.suites, ',verify-gnav,')` running `node tests/verify-gnav.js build/synthetic/systole.html`. Never rename a required job.

## Definition of done

- Labs at 834x1194, 1180x820 and 1024x768 fits without clipping; every Study Tools row is full; tiles >= 88 px tall; the due count readable at a glance.
- The capsule is absent on Home page 0, in reading screens and below 700 px; present on Brain, Labs and inner screens at 700 px and up; `aria-current` correct;
  keyboard operable; never overlapping the brand, the header buttons or the Apex button.
- Contrast >= 4.5:1 (median, as `verify-contrast` measures) in all 12 theme states; the High-contrast palette stays solid.
- Home page 0 unchanged except what you chose in T0.3: before/after captures match, `verify-home` and `verify-homepager` green, the Apex button still in its corner.
- Shell under 288 KiB gzipped with the headroom reported; floor table, hover guard, type ladder and icon guards green.
- Every new or changed check shows its injected-defect FAIL in the PR. Chromium here, WebKit in CI, and a real-iPad check by the owner.

## Verification (how to test end to end)

```bash
# synthetic build outside the repo (CI's own commands, verify.yml:401-402)
SYN=<a scratch directory outside the repo, e.g. the session scratchpad>/synth      # never build/ or dist/: those hold private output on the laptop
node scripts/synthetic-export.js "$SYN/export.html"
node scripts/assemble-app.js "$SYN/export.html" --refs "$SYN/refs" --ref-images "$SYN/refs-images" --out "$SYN/systole.html"
node scripts/serve.js 8123 "$SYN"                                     # then http://localhost:8123/systole.html
# affected suites first, never a whole-suite baseline
node tests/verify-homescreen-pure.js && node tests/verify-hover-pure.js && node tests/verify-floor-css-pure.js
node scripts/verify.js "$SYN/systole.html" --only homepager,home,taps,contrast,glass,theme,tokens,type,floor --engine chromium
npm run test:pure && npm run leak-guard && node tools/shell-map.js --check
npm test && SYSTOLE_ENGINE=webkit npm test        # WebKit only in CI from this container; report measured vs reused
```

- **Shell byte count**: follow the `split-build` job in `.github/workflows/verify.yml` on the synthetic build, then read `tests/verify-pwa.js`'s line (it writes `<repo>/content` and `<repo>/dist`).
- **Screenshots**: Playwright with the repo harness (`tests/_engine.js`, `tests/_render.js`), `deviceScaleFactor: 2`, screens Home, Brain, Labs, Study, Settings at 1194x834,
  834x1194, 1366x1024 and 390x844. There are no golden-image tests: before/after review is manual, with the images attached to the PR.
- **Negative evidence** for each new check: inject (for example give one tile `backdrop-filter`, leave an orphan cell, render the capsule on Home page 0, overlap it with
  the brand), see the check's own FAIL line, restore, quote it in the PR.
- **Real device**: you open the preview, then the deployed build, on the iPad; battery % across a 30-minute session.

## Critical files

`src/app/home.js` (`labsHtml`) · `app/systole.html` (`buildNav` 5819, `renderNow` 5723, `homeMark` 6801, `homeGo` 6834, `ACTIONS` 5108, `<style>` slot line 21, `#aiFab` 184) ·
`app/css/home.css`, `cardiac.css`, `nav.css`, `apex.css` · new `app/css/glass.css`, `tools.css`, `gnav.css` and `src/app/gnav.js` ·
`tests/verify-homescreen-pure.js`, `verify-home.js`, `verify-homepager.js`, `verify-taps.js`, `verify-glass.js`, `verify-echo.js`, `verify-pwa.js`, `_atlas-landing.js` ·
new `tests/verify-gnav.js`, a pure gnav suite and the var-resolves lint · `scripts/verify.js` (SUITES, PENDING_RECORD), `.github/workflows/verify.yml` and `verify-browser-shard.yml` ·
`tests/css-floor-table.json` · `docs/SHELL-MAP.md`, `docs/DESIGN-HANDOFF.md`, `docs/ROADMAP.md`.

## Risks and open decisions

- **Header width**: the capsule only fits where the header's free centre allows; T0.1 measures it, and below 700 px v1 shows nothing. Brain and Labs (Home's header) are the tightest.
- **Placement deviates from "floating"**: the default is a capsule in the header band for the reasons in C; the preview shows both so you can overrule.
- **Tiles without blur** deviate from "frosted tiles": deliberate (content layer, six fewer blurred surfaces), and flagged in the preview.
- **Shell budget**: T0.1 measured about 15.8 KiB of headroom on the synthetic build (the real build may differ); offsets listed in the constraints; the cap is not raised.
- **Both undefined variables change pixels**: restoring Home's aurora changes Home, and `--font-serif` changes the Progress title; they are your decisions (T0.3) and separate PRs.
- **WebKit is CI-only here**: expect one or two CI round trips; real-iPad confirmation is yours.
- **Building can substitute for studying** (the discovery doc's primary risk): do T5.8 early, and use the preview as the thing to try in a real session.

## Sources

[Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials.md) · [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars.md) ·
[Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars.md) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility.md) ·
[Safari 18 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes.md) ·
[Liquid glass on the web: 6 ways](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07) · [Building glass for the web (Aave)](https://aave.com/design/building-glass-for-the-web) ·
[GlassKit (MIT)](https://github.com/JUNGHERZ/GlassKit) · [liquidGL](https://github.com/naughtyduk/liquidGL) · [liquid-glass-js](https://dashersw.github.io/liquid-glass-js) ·
[Axess Lab: glassmorphism and accessibility](https://axesslab.com/?p=5111) · [Infinum on Liquid Glass](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/) ·
[prefers-reduced-transparency support](https://caniuse.com/wf-prefers-reduced-transparency) · [WebKit 289149](https://bugs.webkit.org/show_bug.cgi?id=289149) ·
[WebKit 211349](https://bugs.webkit.org/show_bug.cgi?id=211349) · [Apple forums 813733](https://developer.apple.com/forums/thread/813733) · [WebKit 312407](https://bugs.webkit.org/show_bug.cgi?id=312407) ·
[Duolingo: improving the streak](https://blog.duolingo.com/improving-the-streak) · [UWorld app](https://apps.apple.com/us/app/-/id991621303) ·
[BoardVitals app](https://apps.apple.com/us/app/id1484690932) · [AMBOSS features](https://www.amboss.com/us/features)
