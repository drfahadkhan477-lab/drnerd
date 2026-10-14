# A question bank of your own

Systole runs on any bank in the content schema (`docs/CONTENT-SCHEMA.md`).
There are three ways to make one, and each is ready to use:

1. **Claude drafts, you review.** Claude writes the questions from a chapter
   of your notes or a PDF, and you read and sign every one before it ships.
   It is the route chosen at step 4 of the independence plan.
2. **You write them.** The same study files, written by hand from a template.
3. **A licensed bank.** A bank you hold a licence to, imported from its
   publisher's spreadsheet or JSON export.

The first two share a folder, a builder (`scripts/build-bank.js`) and its
rules. The third has its own importer (`scripts/import-bank.js`). All three
end the same way: `npm run build -- <bank folder>` builds Systole on the
bank, and `node tools/pack-content.js <bank folder>` makes the package the
iPad's code-only deploy imports.

## Your own questions

### The folder

Keep the source in `source/bank/`. `source/` is gitignored and refused by
`scripts/leak-guard.js`, so questions drafted from your books stay on your
own machine. The folder holds:

- `bank.json`, which says which bank this is, as the manifest's bank block:

  ```json
  { "id": "my-cardiology", "name": "My Cardiology Bank" }
  ```

  The `id` is a short lowercase name, never `accsap-12`. The `name` is what
  the app calls the bank. Add `"by"` to have the app say whose commentary it
  is ("the … commentary"); leave it out for plain "commentary".
  `node scripts/build-bank.js --init "My Cardiology Bank" [--by "…"]` writes
  it, with an id made from the name, and never replaces one.
- One study file per chapter or topic, in Memorizer's format
  (`docs/MEMORIZER-STUDY-FILE-PROMPT.md`). Its front matter can say:

  ```
  ---
  chapter: Valvular Disease
  prefix: valve-as
  ---
  ```

  `chapter` is the chapter its questions go under; without it, the file's
  title. `prefix` starts every id the file gives; without it, the file name.

### Drafted by Claude

1. **Draft.** Give Claude a chapter with the study-file prompt; it writes the
   file into `source/bank/`.
2. **Check.** `node tools/study-file-check.js source/bank/<file>.md` says
   what Memorizer would drop or flag. It checks against the file's own text,
   not against the book or the medicine.
3. **Review.** Read every question: the key, the explanation, and the reason
   each wrong option is wrong. Fix or delete what is wrong. Keep the numbers
   of the questions you keep.
4. **Sign.** `node scripts/build-bank.js --sign source/bank/<file>.md`
   records the date and a digest of the file's questions in its front matter.
   It refuses a file that breaks a rule below. An edit to any question after
   signing, even to one reason, means reading the file again and re-signing.
   An edit to the teaching text does not.
5. **Build the bank.** `npm run bank` writes `build/bank/` from the signed
   files only. `npm run bank -- --draft` also takes unsigned files, to look
   at in the app, and names the bank "… (draft)" so it cannot be taken for
   a reviewed one.
6. **Build the app.** `npm run build -- build/bank` builds Systole on it.
   For the iPad's code-only deploy, `node tools/pack-content.js build/bank`
   makes the package to import.

### Written by you

1. **Start a file.**
   `node scripts/build-bank.js --new source/bank/valvular.md --chapter "Valvular Disease" --prefix valve --questions 10`
   writes a study file of numbered questions with every field empty. It
   never replaces a file.
2. **Write.** Fill in each question's stem, its four options, the Correct
   Answer, the Explanation, and under "Why the distractors are wrong" a
   reason for each wrong option; delete the right one's line. Keep each
   question's number. Delete a question you will not write, or wrap it in
   `<!-- -->`: one begun and left unfinished is refused, never dropped in
   silence.
3. **Check.** `node scripts/build-bank.js --check source/bank/valvular.md`
   names, by number, every question the builder would refuse, or says the
   file is ready to read and sign.
4. **Sign and build** as in steps 4 to 6 above.

### What the builder refuses

It refuses the whole build and names the file and the question's number,
never a word of the question:

- a question without four options, a Correct Answer, an Explanation, or a
  reason for each wrong option;
- two options alike, or an "all of the above" or "none of the above";
- a question whose heading gives no number ("### Question N: …"), a number
  used twice in a file, or an id two files give;
- a question begun and not finished: a "### Question N" heading with no
  stem and options under it;
- a missing `bank.json`, or one that gives ACCSAP 12's id;
- a file not signed off, or changed since it was;
- an `--out` folder that holds anything but a bank.

Whatever it refuses, the last good bank in `build/bank/` stays as it was.

### Ids

A question's id is `<prefix>_<number>`, from the number its heading gives
it. Deleting a question renumbers none of the others, so what the app has
learned about a question stays with it. Do not give a deleted question's
number to a new one: the app would carry the old one's history over.

### What the app shows

The bank is your own, so it carries no ACCSAP correction or content flag
(`scripts/which-bank.js`). The app names it by `bank.json`'s `name`, shows
the reasons the wrong options are wrong under the explanation, and shows no
peer statistics, since a bank of your own has none.

## A licensed bank

A bank you hold a licence to, exported as a spreadsheet (CSV or TSV) or as
JSON, one question to a row:

```sh
npm run bank:import -- source/licensed/bank.csv --name "Bank Name" --by "Publisher"
npm run build -- build/bank-name
```

Keep the export in `source/` (or outside the repository). The importer
refuses to read a licensed file, or its figures, from anywhere else in the
repository, and to write the bank anywhere in it but `build/`, `source/` or
`content/`, which Git ignores and `scripts/leak-guard.js` refuses. It writes
`build/<id>/` unless `--out` says otherwise; `--id` sets the id, which is
otherwise made from the name.

### The file

Its columns are found by name, in any order or case, spaces and punctuation
ignored:

| field | column names | |
|---|---|---|
| id | id, qid, question id, item id | required, and kept: the app holds what it has learned about a question by its id, from one import to the next |
| chapter | chapter, category, section, topic, domain, subject | or `--chapter "…"`, for a file with no such column |
| stem | stem, question, question text, prompt, vignette | required |
| options | A … H, option A …, choice A … | at least two, from A on |
| answer | answer, correct, correct answer, key, answer key | a letter, or a number counting from 1 |
| commentary | explanation, rationale, commentary, critique, discussion | |
| reasons | why A …, reason A … | why that option is wrong, shown after the commentary |
| peers | percent A …, pct A …, p A … | the share of candidates who chose it, 0 to 100: for every option of a question, or for none |
| figures | figures, figure, images, image | file names in a `figures/` folder beside the file (or `--figures`), split by `;`, `\|` or `,` |
| number | n, item, item number, number | the number the app shows beside the chapter; its place in its chapter otherwise |

A CSV may be split by commas, semicolons or tabs, and saved as UTF-8 ("CSV
UTF-8" in a spreadsheet) or as UTF-16 ("Unicode text"); a `.tsv` or `.txt`
file is split by tabs. JSON is a list of objects with those keys, or
`{ "questions": [ … ] }`, and may give `options`, `percents` and `why` as
lists. A bank already in the content schema's own shape (`id`, `ch`, `s`,
`o`, `ci`, `ex`) is read as one. Markup in a field (`<p>`, `<br>`, `&amp;`)
becomes the plain text the app shows.

The report names every column the importer did not read, so nothing is
dropped unseen, and counts the questions with no commentary.

### What the importer refuses

It refuses the whole import and names the row and the id, never a word of a
question:

- a row with no id, an id used twice, or one that cannot be a file name;
- a row with no chapter or no stem, fewer than two options, or an empty
  option before a filled one;
- an answer that is not one of its options;
- peers for some options and not others, or not a number from 0 to 100;
- a figure that is not in the folder, is not a `.webp`, `.png` or `.jpg`,
  or whose bytes are not what its name says;
- a file that is not UTF-8 or UTF-16 text, a CSV quote never closed, a cell
  under no column heading, or two columns that give the same field;
- `accsap-12` as the bank's id, or a name the app would refuse;
- a file inside the folder the bank is written to, or an `--out` folder that
  holds anything but a bank.

Whatever it refuses, the last bank in the output folder stays as it was.

### What the app shows

A licensed bank ships as its publisher wrote it. It is not signed off
question by question, and it gets none of ACCSAP's corrections or content
flags. The app names it by `--name`, calls its commentary the `--by`
commentary, shows the reasons under the commentary when the file gives them,
and shows peer statistics for a question whose options all carry them.
