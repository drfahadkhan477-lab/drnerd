#!/bin/bash
# Cloud sessions only: a fresh clone has neither node_modules nor the
# pre-commit hook (core.hooksPath is per clone and `npm run hooks` was never
# run), so the leak guard CLAUDE.md relies on would be off. Idempotent.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR"
git config core.hooksPath .githooks
# npm ci, not npm install: install rewrites package-lock.json whenever it has
# drifted from package.json (it had: engines >=18 vs >=20), so every session
# would start on a dirty tree. ci installs the lockfile as it is, in about a
# second here. Playwright's browsers are pre-installed; never download them.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
