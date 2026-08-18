# Writing reference notes Apex can be held to

How to write the `.md` files so grounded mode actually works. This is not
generic markdown advice — it is shaped by exactly what the importer does with
your file and what retrieval does with the result.

---

## What the importer does

One file goes in. It comes out as **one note per `##` section**, each carrying
the file's `title`, `tags` and `source`.

```
amyloidosis.md
├── "Cardiac amyloidosis — Recognition"      ← one retrievable note
├── "Cardiac amyloidosis — Distinguishing AL from ATTR"
└── "Cardiac amyloidosis — Management"
```

That splitting is the single most important thing to design around. **A section
is the unit that gets retrieved, and it is retrieved alone.** Apex may see
"Recognition" without ever seeing "Management" from the same file.

Two consequences, and almost every mistake comes from ignoring them:

1. **No section may depend on another.** "As discussed above", "see below",
   "the same applies here" — all of these break, because there is no above.
2. **Section size is chunk size.** Aim for **150–400 words**. Under ~80 words
   there is not enough for BM25 to match on. Over ~600 and you crowd out the
   other notes competing for the same context budget.

---

## The template

```markdown
---
title: Cardiac amyloidosis
tags: amyloid, ATTR, transthyretin, AL, light chain, restrictive, HFpEF
source: Braunwald's Heart Disease 12e, Ch 77, pp 1681-1694
---

## Recognition
Suspect in HFpEF with increased wall thickness and *discordantly low* QRS
voltage — the combination is the tell, not either alone. Apical sparing of
longitudinal strain ("cherry on top") on echo. Bilateral carpal tunnel
syndrome commonly precedes cardiac presentation by 5–10 years.

## Distinguishing AL from ATTR
AL requires a monoclonal protein. Screen with serum free light chains PLUS
serum and urine immunofixation — a negative triple screen makes AL very
unlikely. ATTR is confirmed by grade 2–3 myocardial uptake on bone
scintigraphy (PYP/DPD) **in the absence of a monoclonal protein**; uptake with
a paraprotein does not exclude AL and still needs biopsy.

## Management
Tafamidis reduced all-cause mortality and cardiovascular hospitalisation in
ATTR-CM (ATTR-ACT). Avoid digoxin and non-dihydropyridine calcium channel
blockers — both bind amyloid fibrils and can precipitate toxicity or profound
hypotension. Diuresis is the mainstay; these ventricles are preload dependent.
```

### The three front-matter fields

| Field | Why it matters |
|---|---|
| `title` | Prefixes every section, so a citation names the chapter. Without it a note is just "Recognition", which tells you nothing. |
| `tags` | Fed straight into the search index. **Include synonyms and abbreviations both** — `ATTR, transthyretin` — because matching is literal. |
| `source` | Travels into the prompt and comes back in the citation. This is what makes a grounded answer *checkable*. Include page numbers if you have them. |

`citation:` and `ref:` also work if you prefer them to `source:`.

---

## How to write the body

**Name the section the way you'd ask about it.** Retrieval matches your
question against the note. `## Distinguishing AL from ATTR` gets found by "how
do I tell AL from ATTR"; `## Workup, part 2` gets found by nothing.

**Keep the qualifying clause.** This is where compression usually goes wrong:

> ❌ Bone scintigraphy confirms ATTR.
>
> ✅ Grade 2–3 uptake on bone scintigraphy confirms ATTR **in the absence of a
> monoclonal protein** — uptake with a paraprotein still needs biopsy.

The first version is the sentence that makes Apex confidently wrong. Boards
test the exception; so should your notes.

**Keep the mechanism, not just the fact.** "Avoid CCBs in amyloid" is a rule
you'll forget. "CCBs bind amyloid fibrils" is a reason you won't. Mechanism is
also what lets Apex reason about a case it hasn't seen.

**Numbers survive, prose evaporates.** Cutoffs, doses, intervals, trial names,
class of recommendation. These are what BM25 matches on and what gets examined.

**Write in your own words.** Beyond the copyright point below, summarising is
where the learning is — and it gives Apex your framing to build on rather than
a textbook's.

---

## What to avoid

- **A whole chapter under one heading.** It becomes one enormous note that
  either blows the budget or gets clipped mid-sentence, losing the end.
- **Bare bullet fragments.** `- apical sparing` matches poorly and teaches
  nothing. Write the clause: `Apical sparing of longitudinal strain on echo.`
- **Cross-references between sections.** See above.
- **Hedging you don't mean.** In grounded mode Apex answers from these notes
  *only*. "May sometimes be considered" gives it nothing to stand on.

---

## Suggested corpus shape

One file per Braunwald chapter you're revising, sections following how you'd
actually be asked:

```
content/refs/
├── 01-heart-failure.md
├── 02-cardiomyopathies.md
├── 03-amyloidosis.md
├── 04-valvular-aortic.md
├── 05-valvular-mitral.md
├── 06-arrhythmias-af.md
├── 07-arrhythmias-vt.md
├── 08-pericardial.md
└── ...
```

A section pattern that maps well onto board questions:

```
## Recognition          ← what makes you think of it
## Confirming it        ← the test, and its false positives
## Management           ← what you do, and what you must not
## The trap             ← the distractor that catches people
```

That last one is worth adding deliberately. It's the section that turns a
reference note into board preparation.

---

## Loading them in

**Notes → ⤒ Import .md** — select as many files as you like in one go. Each
file reports how many notes it produced.

Then, in the Apex panel, press the **folder button** in the header to turn on
grounded mode. The subtitle changes to `GROUNDED · n notes`.

In that mode:

- Apex answers **only** from your notes and cites each by title and source.
- The **ACC answer key for the current question is withheld from it** — it can
  see the stem and the options, but not the explanation, so it cannot quietly
  teach from the answer key and call it your notes.
- If your notes don't cover something, it says *"Your notes do not cover this"*
  and offers to answer from its own knowledge only if you ask.

Turn it off and Apex goes back to using everything it knows.

---

## Two honest cautions

**Grounded mode is only as good as the corpus.** If a note is wrong, Apex will
teach it confidently and cite it. That's the trade: you get provenance and no
invention, and in exchange the notes carry the burden of being right. Write
them carefully, and use open mode as a second opinion when something feels off.

**Braunwald is copyrighted.** Your own summaries, on your own device, for your
own study are fine — the same posture this app already takes with the ACCSAP
bank. Keep `content/` out of any repository you publish (it is already
gitignored), and don't redistribute the notes.
