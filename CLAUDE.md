@AGENTS.md

## Claude Code only

- `.claude/hooks/guard.js` enforces rule 1: it refuses a read of the licensed
  paths, and a `git commit` that `scripts/leak-guard.js` refuses. It matches
  words, so a command that only mentions one of those folder names (in a `sed`
  script, say) can be refused too; rephrase that command. A refused read of
  licensed content is never done another way.
- `.claude/hooks/session-start.sh` turns the git hooks on and installs
  dependencies in cloud sessions.
