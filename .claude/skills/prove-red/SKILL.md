---
name: prove-red
description: Prove a new or changed check can fail before trusting it. Inject the defect it claims to catch, watch that check go red, restore, watch it go green, and record the evidence. Use whenever a test, guard, lint or audit is added or changed in this repository, and before writing "proven to fail" in a commit or PR.
---

# Prove it red

CLAUDE.md, section "The failure mode this project keeps producing": every new
check must be proven to fail. This is that rule as steps. A check you have not
seen fail is a check you have not written.

## 1. Name the defect

Write one sentence: *this check fails when ___.* Name the defect in the code
under test, not in the test. If you cannot finish the sentence, the check
measures nothing yet. Stop and fix that first.

List every defect the check's comment claims to catch. Each one gets its own
injection. A comment that claims three things and was proven on one has two
claims left unproven.

## 2. Green first

Run the suite and note its count, e.g. `node tests/verify-claude-skills.js`.
Tail the result line. Never paste suite output into the transcript: suite
output can quote question text.

## 3. Inject one defect

- Make the smallest edit that reproduces the real bug. Edit the code under
  test, or the data the check reads, never the check itself.
- One defect at a time. `git diff --stat` should show only the file you meant
  to touch.
- Never inject into `tests/test-stats.json`, a licensed path, or anything a
  stop hook would leave dirty.
- Cover the hollow shapes too, because they are what this project keeps
  producing:
  - **Nothing to check.** Delete or empty the input. A loop over zero items
    passes every assertion inside it, so the suite needs an "there are things
    to check" guard, and this injection proves it.
  - **The probe never ran.** If the check compares against a value, make the
    producer return `undefined` or nothing. That must fail, not pass.
  - **Wired, not just correct.** If the check is registered somewhere (a
    workflow step, a settings matcher, `SUITES`), unregister it and confirm
    something notices.

## 4. Watch the right check go red

Run it again. A non-zero exit is not enough. Read the FAIL lines
(`… | grep FAIL`) and confirm the failing check is **the one that claims this
defect**. A crash, a syntax error, or a different check failing proves
nothing about this one.

## 5. Restore and go green

Revert the injection (`git checkout -- <file>`, or undo the edit), confirm
`git diff` no longer shows it, and run again. The count must match step 2.

## 6. If it stayed green

That is information, not a nuisance. Either the defect is not what you
thought, or the check measures something narrower than its comment says.
**Narrow the comment. Never widen the test to fit the prose,** and never move
a threshold to make the red go away.

## 7. Record the evidence

Put a table in the commit message or PR body, one row per injection, and a
final restored row:

```
| injected defect              | result     |
|------------------------------|------------|
| <what you changed, briefly>  | 1 failed   |
| <the hollow shape>           | 2 failed   |
| restored                     | 26 passed  |
```

Say what was not proven, and why. A row that went green belongs in the table
too, next to the comment you narrowed because of it.
