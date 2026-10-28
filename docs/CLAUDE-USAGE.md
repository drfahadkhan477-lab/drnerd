# Models, usage, and limits in Claude Code

Owner-facing reference for keeping Claude Code sessions on this repo cheap and
sharp. `AGENTS.md` carries the short rules Claude acts on; this file is the full
explanation, kept out of it because that file is resent on every turn.

`CLAUDE.md` and `.claude/agents/` were deleted from master (`57c822b`,
`2915c54`), and the rules they carried moved into `AGENTS.md`. Where this file
names a file or an agent that no longer exists, the section says so; nothing
below is a description of something to recreate.

## How usage is metered

| You signed in with… | You get | What "running out" looks like |
| --- | --- | --- |
| Claude subscription / Enterprise seat (`/login`) | A usage pool reset on a rolling window. | A "limit reached, resets at *time*" message. |
| API key (Console, Bedrock, Vertex, Foundry) | Pay-as-you-go, billed per token. | No hard stop; the account is charged. `/cost` shows session spend. |

## Choosing a model

Run `/model` to see and switch models — it is the source of truth for what
your account has.

- **Sonnet** — the large majority of coding work: features, tests, known bugs, routine refactors.
- **Opus** — hard debugging, cross-cutting refactors, architecture calls. Meaningfully more quota per turn.
- **Haiku** — quick lookups, renames, boilerplate, scripted runs.

Switching mid-session keeps the conversation. `/model opusplan` plans with
Opus and executes with Sonnet.

**For this repo:** use Opus for patch-chain anchor work, leak-guard / check
design (where "prove it fails" reasoning matters), and suite races; Sonnet for
everything else; Haiku for doc tweaks and lookups.

## What consumes tokens

Every turn resends (1) the whole conversation so far, (2) `AGENTS.md` plus any
files read, (3) your new prompt. Item 1 grows fastest — that is where cost and
context limits come from.

## Managing the context window

- **`/clear`** — wipe the chat, keep `AGENTS.md` and files. Use when switching tasks. Cannot be undone.
- **`/compact`** — summarise history to free space mid-task. Auto-runs near the limit.
- **`/context`** — see what is loaded.

Rule of thumb: `/clear` for a new task, `/compact` to continue a long one.

## Five habits

1. **Clear between tasks.** If your next prompt would make sense in a fresh terminal, `/clear` first.
2. **Match the model to the job** (above).
3. **Point at files, don't paste them.** Write a bare path (`scripts/assemble-app.js`, the `producers` function) — an `@` prefix injects the whole file. Trim logs to the relevant 20–30 lines; put big dumps on disk and reference the path. In this repo, never paste suite output or `tests/last-run.log` — it quotes licensed question text.
4. **Keep `AGENTS.md` lean.** Add a rule only the second time you correct Claude on the same thing; prune stale notes every few weeks. Every rule in it is resent on every turn, so a rule that no longer earns its place costs tokens on each one.
5. **Ask for a plan before big changes.** For anything over two or three files: Plan Mode, or "list the files you'll touch and what you'll do in each first." Correct the plan, then execute — ideally plan on Opus, execute on Sonnet.

## Agents and the working method — removed

**This section is history, not instructions.** `.claude/agents/` held the six
agents below until `2915c54` deleted it. There is no agent team in this
repository now, and the rules the agents encoded live in `AGENTS.md` as prose.
It is kept here because the reasoning in the last paragraph is still the
project's position, and because a tool that offers to generate an agent harness
will otherwise read the table as a specification to restore.

| Agent | Model | Job |
| --- | --- | --- |
| `planner` | sonnet | Plan for work over two or three files, before any edit. Read-only. |
| `verifier` | haiku | Run the pre-push checks and report what ran, what passed and what did not run. |
| `hollow-check-reviewer` | sonnet | Review new checks for the ways checks have passed without measuring anything. |
| `leak-auditor` | haiku | Look for licensed content in a branch before it is pushed. |
| `ci-log-reader` | haiku | Read one CI job log and return only what failed. |

That smallness was the point, and it is why the directory went: each agent is
a thing to keep true, and prose in `AGENTS.md` that states *why* a rule exists
survives a refactor better than a definition that has to be maintained
alongside the code it describes.

`tasks/lessons.md` is the record of corrections, read at the start of a
session. `tasks/todo.md` (gitignored) holds the plan for the task in hand.

## When you hit a limit

- **Subscription / seat:** the message says when the window resets; meanwhile `/model` to a lighter model.
- **API key:** check `/cost` and your dashboard; surprises almost always trace to long uncleared sessions.
- **Context full** (not the same as a usage limit): `/compact`, or `/clear` if the history is done with.

## Quick reference

| Command | Does |
| --- | --- |
| `/model` | See and switch models |
| `/cost` | Session token / dollar usage (API billing) |
| `/clear` | Fresh conversation, project memory stays |
| `/compact` | Summarise history to free context |
| `/context` | Inspect what is loaded |
