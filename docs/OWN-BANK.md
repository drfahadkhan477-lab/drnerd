# A question bank of your own

Systole runs on any bank in the content schema (`docs/CONTENT-SCHEMA.md`).
This is how to make one from your own reading. Claude drafts the questions
from a chapter of your notes or a PDF, and you review every one before it
ships. It is the route chosen at step 4 of the independence plan.

## The folder

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

## The steps

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

## What the builder refuses

It refuses the whole build and names the file and the question's number,
never a word of the question:

- a question without four options, a Correct Answer, an Explanation, or a
  reason for each wrong option;
- two options alike, or an "all of the above" or "none of the above";
- a question whose heading gives no number ("### Question N: …"), a number
  used twice in a file, or an id two files give;
- a missing `bank.json`, or one that gives ACCSAP 12's id;
- a file not signed off, or changed since it was.

Whatever it refuses, the last good bank in `build/bank/` stays as it was.

## Ids

A question's id is `<prefix>_<number>`, from the number its heading gives
it. Deleting a question renumbers none of the others, so what the app has
learned about a question stays with it. Do not give a deleted question's
number to a new one: the app would carry the old one's history over.

## What the app shows

The bank is your own, so it carries no ACCSAP correction or content flag
(`scripts/which-bank.js`). The app names it by `bank.json`'s `name`, shows
the reasons the wrong options are wrong under the explanation, and shows no
peer statistics, since a bank of your own has none.
