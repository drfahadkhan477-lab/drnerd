# Release validation

`npm run release-check -- path/to/licensed-export.html` builds fresh artifacts,
runs the full standalone registry in Chromium, checks the split PWA over HTTP,
and runs the full standalone registry in WebKit.

The PWA step uses `--only pwa --pwa`. This retains the split-build browser,
Worker and cache checks without repeating the standalone registry. Both full
browser runs remain mandatory for certification. Failed steps still refuse
certification, and explicit skips still produce an incomplete result.

This optimization reuses no previous run or cached pass. Every invocation
builds and measures its own artifacts. During development, run the affected
suites first; reserve the full private gate for the release candidate. Keep
licensed content and raw validation logs outside Git.
