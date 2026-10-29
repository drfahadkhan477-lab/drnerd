# Quiet Atlas continuation

Open the existing repository in Claude Code or Codex and use this prompt:

> Read AGENTS.md and inspect Git status before editing. Continue the Quiet Atlas
> design in app/css/home.css and app/systole.html. Preserve private inputs,
> reference notes and images, study state, backups, stashes and other worktrees.
> Keep Memorizer outside this task. The selected design uses a warm paper
> surface, teal navigation rail, serif pearl heading, the existing interactive
> heart and a next-session strip. Tablet Home, Brain and Labs landing pages
> should fit the viewport; long reading, enlarged text and small windows must
> remain accessible through scrolling. Preserve alternative palettes and dark
> mode. Do not replace the physiological heart with a static illustration.
>
> Run affected Home, homepager, pearl, typography, accessibility and theme
> checks in Chromium and WebKit. Follow the repository's negative-test evidence
> requirements. Use synthetic content for public checks. Locate and hash the
> owner's export and complete reference library before a private build. Build
> the app, regenerate the PWA, and validate the actual release artifacts. Never
> infer current success from a previous conversation's test counts.
>
> Before a production release, verify the owner's deployment authorization,
> current Cloudflare project, Access protection, final source commit and full
> private validation. Preserve existing credentials and bindings. Keep licensed
> content and raw validation logs outside Git. Report measured results,
> limitations, artifact provenance and deployment status accurately.

The Home styling is scoped to the landing pages so question reading keeps its
existing measure. Navigation remains a horizontal swipe pager; its controls
form a vertical rail on tablets and bottom tabs on phones. The selected tab's
orientation updates on resize. The review strip uses due questions when
available and opens Chapters otherwise.

A different account cannot automatically access another session's files or
credentials. Prefer using the existing laptop checkout. Otherwise transfer
committed source through Git and the licensed inputs through a separate private
archive; authenticate Cloudflare separately. Never include secrets in a handoff
archive, and avoid concurrent agents editing or deploying the same checkout.

Build using the actual private export path:

```powershell
npm run build -- ".\source\ACCSAP_12_super_v12.html"
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
npm run pwa
if ($LASTEXITCODE -ne 0) { throw "PWA build failed" }
```

Consult `node scripts/verify.js --help` and the current suite registry before
choosing validation options. Prepare reader assets before enabling offline test
mode. Keep synthetic preview outputs separate from private release outputs.

## Private validation checkpoint

See `docs/validation/quiet-atlas-private-checkpoint.json` for the latest measured
status. The licensed input archive has now been recovered and hash-verified.
The initial full run was interrupted after reproducing a short-portrait reading
failure. A layout correction is committed, but its focused probe is not a full
suite pass. Rebuild the PWA and complete the listed validation gates before
merging or deploying. Raw logs remain under the ignored
`build/private-validation/atlas-release/` directory in the current workspace.


The owner subsequently asked for faithful reproduction of the selected Home
composition. See `docs/validation/quiet-atlas-home-redesign.json`: the introductory
landing and real pearl reader now have separate states, and Explore in 3D keeps
the existing model accessible beside an original decorative anatomical asset.
Begin recall and Reveal are the entry points for reader-specific browser checks.
Do not interpret earlier full-run partial results as validating this redesign.
