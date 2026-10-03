# The content schema

What a Systole question bank looks like once it is out of the export, in one
place. It is the contract between three pieces of code, and all three enforce
the same rule — `BankPack.validate()` in `src/core/bankpack.js`:

- `scripts/extract-content.js` writes `content/` and refuses to swap in a bank
  that fails it;
- `tools/pack-content.js` (and `scripts/build-pwa.js --no-content`) refuse to
  write a package that fails it;
- the iPad's importer in the code-only deploy refuses to store one.

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

## Changing the schema

Raise the version in `src/core/bankpack.js` and here together, teach
`validate()` the new shape, and make the extractor and packer write it. A
device holding a package of the old version keeps it until a new one is
imported; the importer never reinterprets an old package as a new one.
