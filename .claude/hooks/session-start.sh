#!/bin/bash
#
# Install graphify and build this repository's knowledge graph, once per session.
#
# WHY THIS EXISTS. CLAUDE.md tells agents to run `graphify query` before reading
# raw source, because a scoped subgraph costs a fraction of the tokens that
# grepping the tree does. Claude Code on the web runs in a fresh container, and
# graphify-out/ is gitignored — it is derived from the tree, and with the wrong
# flag from the licensed corpus, which is why scripts/leak-guard.js refuses it.
# So both the tool and the graph are absent at the start of every web session,
# and that rule points at nothing. This hook makes it point at something.
#
# WHAT IT DELIBERATELY DOES NOT DO. It writes no agent instructions anywhere:
# no skill file, no CLAUDE.md edit, no settings change. The registration is
# already committed (CLAUDE.md's ## graphify section and this file's sibling
# settings.json). All this does is install a package and build a derived index.
#
# It never runs `graphify hook install`, so no git hook is added and nothing
# rebuilds the graph on commit. Refresh it by hand with `graphify update .`.
#
# It always exits 0. A session must start even when PyPI is unreachable; the
# PreToolUse guards degrade to exit 0 when no graph is present, so the cost of
# failure here is advice that does nothing, not a blocked session.

set -uo pipefail

log() { printf '[graphify-setup] %s\n' "$*"; }

# Web only. A local checkout has its own Python and its own graphify, and this
# must not reinstall over them.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# `graphifyy[mcp]` covers both surfaces in ONE install: the `graphify` CLI that
# CLAUDE.md's rules invoke, and the importable graphify.serve that .mcp.json
# runs as a stdio MCP server. pip puts both console scripts in the interpreter's
# script directory, which is already on PATH here.
#
# --ignore-installed PyJWT is load-bearing. The mcp extra pulls a PyJWT newer
# than the one Debian ships, and pip cannot uninstall a distro package because
# it has no RECORD file, so without the flag the ENTIRE install aborts with
#   ERROR: Cannot uninstall PyJWT 2.7.0, RECORD file not found
# and neither the CLI nor the server arrives. That is exactly how it failed
# before the flag was added, not a precaution against a hypothetical.
if pip install --quiet --ignore-installed PyJWT 'graphifyy[mcp]' 2>&1 | tail -3; then
  log "installed $(graphify --version 2>&1 | head -1)"
else
  log "FAIL: pip install 'graphifyy[mcp]' failed — no graph this session"
  exit 0
fi

# AST only: no API key, no LLM call, no cost. ~6s for this repository's 228
# files from a cold cache. Idempotent — a second run re-extracts and rewrites
# the same graph rather than erroring.
#
# Output is checked rather than assumed: `graphify update` exits 0 in cases
# where it wrote nothing useful, and a hook that reports success without
# measuring anything is the failure mode CLAUDE.md opens with.
if ! graphify update . >/dev/null 2>&1; then
  log "FAIL: graphify update . failed — CLAUDE.md's query-first rule has no graph"
  exit 0
fi

GRAPH="graphify-out/graph.json"
if [ ! -s "$GRAPH" ]; then
  log "FAIL: $GRAPH missing or empty after a successful update"
  exit 0
fi

NODES=$(python -c "
import json,sys
try:
    g=json.load(open('$GRAPH'))
    print(len(g.get('nodes') or []))
except Exception:
    print(0)
" 2>/dev/null || echo 0)

if [ "$NODES" -lt 1 ]; then
  log "FAIL: $GRAPH parsed to $NODES nodes — treating as no graph"
  exit 0
fi

log "graph ready: $NODES nodes. Run \`graphify query \"...\"\` before grepping."
exit 0
