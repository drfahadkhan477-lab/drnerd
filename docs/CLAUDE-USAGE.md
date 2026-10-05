# Models, usage, and limits in Claude Code

Owner-facing reference for keeping Claude Code sessions on this repo cheap and
sharp. `CLAUDE.md` carries only the short rules Claude acts on; this file is
the full explanation, kept out of `CLAUDE.md` because that file is resent on
every turn.

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

Every turn resends (1) the whole conversation so far, (2) `CLAUDE.md` plus any
files read, (3) your new prompt. Item 1 grows fastest — that is where cost and
context limits come from.

## Managing the context window

- **`/clear`** — wipe the chat, keep `CLAUDE.md` and files. Use when switching tasks. Cannot be undone.
- **`/compact`** — summarise history to free space mid-task. Auto-runs near the limit.
- **`/context`** — see what is loaded.

Rule of thumb: `/clear` for a new task, `/compact` to continue a long one.

## Five habits

1. **Clear between tasks.** If your next prompt would make sense in a fresh terminal, `/clear` first.
2. **Match the model to the job** (above).
3. **Point at files, don't paste them.** Write a bare path (`scripts/build.js`, the `patch` function) — an `@` prefix injects the whole file. Trim logs to the relevant 20–30 lines; put big dumps on disk and reference the path. In this repo, never paste suite output or `tests/last-run.log` — it quotes licensed question text.
4. **Keep `CLAUDE.md` lean.** Add a rule only the second time you correct Claude on the same thing; keep it under roughly 200 lines; prune stale notes every few weeks.
5. **Ask for a plan before big changes.** For anything over two or three files: Plan Mode, or "list the files you'll touch and what you'll do in each first." Correct the plan, then execute — ideally plan on Opus, execute on Sonnet.

## Agents and the working method

`.claude/agents/` holds small agents, each with one job, a stated input and
output, its failure modes and a list of what it never does. Ask for one by name
("run the verifier", "have the planner plan this"); Claude does not start them
on its own.

| Agent | Model | Job |
| --- | --- | --- |
| `planner` | sonnet | Plan for work over two or three files, before any edit. Read-only. |
| `verifier` | haiku | Run the pre-push checks and report what ran, what passed and what did not run. |
| `memorizer-reviewer` | sonnet | Review a change to `memorizer/` against the invariants in `memorizer/REVIEW.md`. |
| `hollow-check-reviewer` | sonnet | Review new checks for the ways checks have passed without measuring anything. |
| `leak-auditor` | haiku | Look for licensed content in a branch before it is pushed. |
| `ci-log-reader` | haiku | Read one CI job log and return only what failed. |

Keep the team this small. Add an agent only when the same job has been done by
hand more than once and has a failure mode worth writing down; a new agent is a
new thing to keep true.

`tasks/lessons.md` is the record of corrections, read at the start of a
session. `tasks/todo.md` (gitignored) holds the plan for the task in hand.
Both are described in `CLAUDE.md`, "Working method".

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
