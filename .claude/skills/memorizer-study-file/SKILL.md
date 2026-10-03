---
name: memorizer-study-file
description: Write a Memorizer study file from a chapter of the owner's own book, in the exact markdown shape the app imports, and check it with the app's own import code before handing it over. Use when asked to make a study file, study notes for Memorizer, or an importable unit from a chapter or PDF.
---

# A Memorizer study file

The owner gives a chapter (a PDF, or pasted text) from their own book. The
deliverable is one `.md` file that Memorizer's **Import Study** takes in
whole, with nothing dropped and nothing flagged.

## What this is not for

The ACCSAP 12 export and the older ACC question banks are licensed and not
read in a session (CLAUDE.md, section "The licensed corpus never enters git
(except via submodule)"). If the chapter comes from `source/`, `content/`,
`build/` or `dist/`, stop and say so. A study file is never written from a
question bank.

## 1. The rules are the app's prompt

Read the prompt in `docs/MEMORIZER-STUDY-FILE-PROMPT.md`, between
`## The prompt` and the end of the file. It is generated from
`memorizer/src/spec.js` and `memorizer/src/studyImport.js`, and
`tests/verify-memorizer-spec-pure.js` fails when it is stale. So it is the
specification, word for word. Follow it exactly. This skill adds only how to
work in a session, and repeats none of its rules, so the two cannot drift
apart.

Work only from the chapter. Teaching skills such as braunwald-the-master can
explain a chapter more deeply, but their knowledge from outside the chapter
must not enter the file. The prompt's first rule forbids it, and the app
flags any number that is not in the file's own text.

## 2. Write it outside the repository

Write the file to the scratchpad, or wherever the owner names, and never
inside this repository. It is derived from a licensed book, so it is never
staged or committed. leak-guard does not know its shape and would not stop
it.

Name it after the unit: `<unit>.md`.

## 3. Check it with the app's own code

```
node tools/study-file-check.js <file.md> --strict
```

The checker runs the import path the app runs: it parses the file, cuts it
into sections and checks the pack. `--strict` is the import dialog's
**Strict consistency check**, which also holds each question's scenario to
the text. It prints counts and, for each problem, where it is and why, in
the app's words, never the item's text. It exits 0 only when the app would
import everything and flag nothing.

For each problem it reports:

- **A number or name not in the text:** go back to the chapter. If the
  chapter has it, add it to the point or table it belongs in. If it does
  not, take it out of the question. Never add a number to the text only to
  satisfy the check.
- **A question left out** (no answer marked, not exactly 4 options): fix the
  question to the prompt's shape.
- **Anything dropped:** the reason says what to fix.

Run it again until it exits 0.

The checker checks the file against itself. It cannot see the chapter. So
before handing the file over, also check by hand what the app does not:

- every number against the chapter;
- 5 to 10 points per heading, each at most 25 words;
- every page citation matches the chapter's page.

## 4. Hand it over

Send the file to the owner, with the checker's `app:` line and the counts
from its first line. Say what you checked by hand, and anything in the
chapter that you left out because the prompt's shape had no place for it.
Then they import it in Memorizer: **Import Study**, choose the file, check
the preview, **Import**.
