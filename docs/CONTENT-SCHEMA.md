# The content schema

What a Systole question bank looks like once it is out of the export, in one
place. It is the contract between the pieces of code below, and each of them
enforces the same rule — `BankPack.validate()` in `src/core/bankpack.js`:

- `scripts/extract-content.js` writes `content/` and refuses to swap in a bank
  that fails it;
- `tools/pack-content.js` (and `scripts/build-pwa.js --no-content`) refuse to
  write a package that fails it;
- the iPad's importer in the code-only deploy refuses to store one;
- `scripts/assemble-app.js` (`npm run build -- <folder or .zip>`) refuses to
  build the app from one.

So a bank that would be refused on the device is refused on the laptop first.
The build's own content rules (`scripts/content-checks.js`, run by the
`contentrules` and `content` suites) check more about the questions — blank
options, chapter prefixes, flags — but not the figure files, which is what this
rule adds.

**Schema version: 1.** It is `manifest.schemaVersion`, and
`BankPack.SCHEMA` in code; `tests/verify-bankpack-pure.js` holds this line to
that constant. A package with any other version is refused, not guessed at.

## The files

```
manifest.json         schemaVersion, counts, sourceDigest, commit, chapters
questions.json        the bank: an array of questions
figures/<name>        one file per figure — .webp, .png or .jpg
extra/<name>          packages only: the reference notes' seed and figure files
```

`content/` holds the first three (plus things that are not the bank, such as
`refs-images/`). A package (`systole-content-v1.zip`) holds all four.

## A question

| field | required | meaning |
|---|---|---|
| `id` | yes | unique; letters, digits, `_ . -` only, never `..` — it becomes a file name |
| `ch` | yes | chapter |
| `s` | — | the stem |
| `o` | yes | the options: a list of at least two (strings, or `{l, t, …}` objects in the older ACC bank) |
| `ci` | yes | the key: an integer index into `o` |
| `ex` | — | the commentary |
| `img` | — | how many figures the question declares |
| `figs` | — | the figure file names, each present under `figures/` |
| `flag` | — | a caveat shown with the question |

Other fields ride along untouched; the schema names what is checked, not all
that may be there.

The app reads more than the schema requires. Built from a bank, the app gets
the export's shape: an option given as a string becomes `{l, t}` (letter and
text), an option with no `l` gets the letter its place gives it, a question
with no `img` gets the number of figures it names, and one with no `n` gets
its place in its chapter. A field the bank gives is kept as it is. A question
whose `img` disagrees with its `figs` is refused, as extraction refuses it.

An option's `p` is the share of candidates who chose it, in percent: ACCSAP's
peer statistics. A question whose options all carry one shows them (the answer
distribution, and how many answered correctly); one without them shows none,
and the tutor is not told any.

## A figure

A name matching `[A-Za-z0-9_.-]+\.(webp|png|jpg)`, never containing `..`,
whose bytes begin with that format's own signature (RIFF…WEBP, `\x89PNG`,
`FF D8 FF`). The extension is a claim; the first bytes are the file.

## The manifest

`schemaVersion` (required, as above). Where present, `questions` and
`figures` must equal what the bank actually holds and names. In a package,
`extras` lists every file under `extra/`; only the names the app asks for are
allowed — `refs-seed.json` and `refs-images/<unit>.json` (or `<unit>.N.json`
for a unit split across files) — and each must be JSON.

`bank` (optional) says which bank this is:

```json
"bank": { "id": "accsap-12", "name": "ACCSAP 12", "by": "ACC" }
```

`id` is a short lowercase name (`a-z`, `0-9` and `-`); `name` is what the
app calls the bank; `by`, optional, is who wrote its commentary. The app
shows `name` and `by`, so both are short plain text: no markup, quotes or
control characters. `BankPack.validate()` refuses a block that breaks this.

Every word the app says about its bank comes from this block (`BANK` in
`app/systole.html`): the tutor is told the question is from `name`, under
the heading OFFICIAL `by` COMMENTARY, and the screens speak of the `by`
commentary. For ACCSAP 12 those are the words the app has always used. A bank
with no `by` gets plain "commentary". The code-only deploy takes the block
from the package imported on the device; every other build carries the block
of the bank it was built from.

A manifest with no `bank` is ACCSAP 12's, since every bank made before the
block existed is. `scripts/extract-content.js` writes the block from the build
it reads. Only the bank whose `id` is `accsap-12` gets the ACCSAP answer-key
corrections and content flags (`scripts/which-bank.js`). Any other bank is built
and shipped as it is given. A bank of your own therefore needs a `bank` block,
or the build takes it for ACCSAP's and refuses it when the corrections do not
fit.

## Changing the schema

Raise the version in `src/core/bankpack.js` and here together, teach
`validate()` the new shape, and make the extractor and packer write it. A
device holding a package of the old version keeps it until a new one is
imported; the importer never reinterprets an old package as a new one.
