# Three worked examples

Templates for your own Braunwald notes. The format is explained in
[../REFERENCE-GUIDE.md](../REFERENCE-GUIDE.md); these are that guidance applied,
so you can see the shape rather than infer it.

| File | Chosen to demonstrate |
|---|---|
| `aortic-stenosis.md` | **Numbers survive.** Cutoffs, velocities, calcium scores, class of recommendation — the things BM25 matches and boards examine. |
| `atrial-fibrillation.md` | **Keep the qualifying clause.** "Use a DOAC" is the sentence that makes Apex confidently wrong; "except mechanical valves and rheumatic mitral stenosis" is the note worth having. |
| `hfref-therapy.md` | **Keep the mechanism.** "Ivabradine does nothing in AF" is a rule you forget; "it acts only on the sinus node" is a reason you don't — and it lets Apex reason about a case it has not seen. |

Each is four sections of 150–400 words, and every section stands alone. That is
the point: **a section is what gets retrieved, and it is retrieved by itself.**
Apex may see "Cardioverting safely" without ever seeing "Choosing the
anticoagulant" from the same file.

## Using them

Rhythm Lab → Notes → Import, and pick the `.md` files. One file becomes one note
per `##` section, titled `Chapter — Section`, carrying the file's tags and
source. Then turn on grounded mode to hold Apex to them.

## About the `source:` field

These carry guideline citations — the 2020 ACC/AHA valve guideline, the 2023 AF
guideline, the 2022 heart failure guideline — because that is genuinely where
these recommendations come from, and a citation you cannot check is worse than
none.

**Replace them with your own.** When you write from Braunwald, cite Braunwald
with the chapter and pages you actually read. The whole value of the `source`
field is that a grounded answer can be traced back and verified, which only
works if the citation is real.

## Checking your own files

`node tests/verify-references.js` runs the guide's rules against everything in
this folder: section length, self-containment, front matter, and whether a
realistic question actually retrieves the section that should answer it. Point
it at your own directory to check your notes before importing them:

```bash
node tests/verify-references.js build/systole.html ~/my-braunwald-notes
```
