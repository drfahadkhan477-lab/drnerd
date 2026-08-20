# Hypertension drill

Twenty board-style questions, an explanation for each, and a one-page crib
sheet for the last ten minutes before a quiz. Built into a single HTML file
that works offline.

```bash
node study/hypertension/build.js              # → study/hypertension/hypertension.html
NODE_PATH=$(npm root -g) node study/hypertension/check.js   # → 29 checks
```

Open the built file in any browser. Nothing to install, nothing to serve.

## These questions are original

They were written for this drill. They are not extracted from ACCSAP or from
any other question bank, which is why this directory is committed while
`content/` is not — the licensed export stays on your own devices, as it has
throughout this project.

The medicine follows the 2017 ACC/AHA hypertension guideline and the trials
each explanation names (SPRINT, ALLHAT, PATHWAY-2, CORAL, ASTRAL). Written to
study from, not to practise from.

## What is in it

| File | |
|---|---|
| `questions.js` | the twenty items — stem, five options, the key, the explanation, a topic |
| `facts.js` | twenty-four high-yield points for the night before |
| `page.html` | the shell: styles, the three modes, the keyboard handling |
| `build.js` | folds the two data files into the shell |
| `check.js` | drives the built page at a phone viewport |

Adding a question means adding one object to `questions.js` and rebuilding.
The shape is deliberately terse because it is written by hand:

```js
{ s: "stem",
  o: ["A", "B", "C", "D", "E"],
  ci: 2,                          // index of the correct option
  ex: "explanation\n\nsecond paragraph",
  t: "Topic" }                    // becomes a filter chip and a score row
```

Topics come from the data — a new one appears as a chip on its own.

## The three modes

**Quiz** shuffles the deck, one question at a time. Answer with a tap or with
`1`–`5`; the key is striped green, your miss red, and the explanation opens
underneath. `Enter` advances. At the end there is a per-topic breakdown and a
button that re-deals only the ones you missed.

**All questions** is the whole set as a sheet, each item collapsed to its stem
with the answer and explanation a tap away. This is the mode that prints.

**Night before** is `facts.js` with nothing between the entries.

Which questions you have ever answered correctly is kept in `localStorage`, so
closing the tab does not lose it. So is the light/dark choice, which cycles
auto → light → dark on the button in the corner.
