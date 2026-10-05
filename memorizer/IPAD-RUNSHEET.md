# iPad trial run sheet

A page to work through with the iPad in your hand. It is an order of work and a
place to write results. The detail, the console snippets and the result
template are in [BACKUP-TESTING.md](BACKUP-TESTING.md); this page does not
repeat them. Every line starts **not run**, and a line stays that way until you
have done it and written down what you saw.

Nothing here has been run. In particular the OCR step below has never been run
on an iPad. The recovery added with the Firefox CI work (a retry when the text
reader faults, and a failed reader closing itself) is tested in Node with
stand-ins. The real-browser suites on Linux (Chromium, WebKit, Firefox) read a
scanned page through a normal start, but they do not make the reader fail.
WebKit on Linux shares an engine with Safari; it is not an iPad.

## Before you leave the desk

- [ ] `npm run memorizer`, host the build as in [../docs/IPAD.md](../docs/IPAD.md),
      on a test origin you can wipe. Restore replaces that origin's study data.
- [ ] Write down the commit and the build you hosted.
- [ ] Make only your own files, never licensed material:
  - a text PDF of numbered pages with a distinctive first and last line;
  - a scanned PDF you made yourself (print or screenshot a text page, save it as
    images in a PDF, so it has no text layer);
  - a two-part PDF with the part and page range in each filename.
- [ ] Note each file's name, bytes, page count and SHA-256 before it leaves the
      desk. You will compare after a restore.
- [ ] Charge the iPad, free some storage, close other apps, and note which.

## On the iPad, in this order

Time each step from the tap to the app saying it is done.

| # | Step | What to write down | Result |
| --- | --- | --- | --- |
| 1 | Open the test origin in Safari. In Settings, read the storage mode. | Wording shown (expect "Saved in this browser.") | not run |
| 2 | Import the text PDF. Open its first and last pages. | Seconds; first/last text match the file | not run |
| 3 | Import the **scanned** PDF. Watch the status line. | See below | not run |
| 4 | Import the two-part pair; review and reorder the parts. | Order shown; first/last page of each | not run |
| 5 | Start a long import and cancel it before the final commit. | Seconds until it stopped; no new book appeared | not run |
| 6 | Add a note, finish a section, review one card. | The note text; progress shown | not run |
| 7 | Export a backup and save the download in Files. | Bytes of the file; seconds | not run |
| 8 | Restore: read the preview, **cancel once**, then restore. | Counts in the preview; data unchanged after cancel; seconds | not run |
| 9 | Compare the restored files' fingerprints with the hashes you wrote down at the desk (snippet in BACKUP-TESTING.md). | Match / mismatch per file | not run |
| 10 | Use "Prepare for offline", then turn the network off and reopen the installed app. | Readiness shown; PDF pages and notes still open | not run |
| 11 | Memory-fallback rescue: relaunch with the database refused (BACKUP-TESTING.md, step 5), export, close the tab, reopen, restore. | Settings wording "Kept only for this visit."; restored counts | not run |
| 12 | VoiceOver and a keyboard through export and restore. | Focus order; focus returns after the dialog; status read aloud | not run |
| 13 | Separately: download a real on-device model, switch models, delete its cache. | Model ids; any failure message | not run |

### Step 3, the scanned PDF (new)

This is the one that exercises the OCR recovery. The fault it guards against was
seen in CI under WebKit as a random "Out of bounds memory access" while a page
was being read, on a page that read fine on the next run. Do it three times,
relaunching the app each time so every run starts a new reader.

- Write down every page the app names as unread.
- Write down whether the status line ever sat on "Downloading the text reader"
  longer than a minute and a half (the timeout), and whether the import
  finished or reported an error.
- If a page was read on the second attempt, that is the recovery working. If the
  same import fails twice in a row on the same page, keep the page number and
  the message; do not retry past that.
- Note whether the tab reloaded on its own. A reload mid-OCR is a memory failure,
  not an OCR bug, and belongs in the result below as such.

## When to stop

Stop and write it down, rather than push on, if the tab reloads without you
asking, an import never finishes, data you saved is missing, or a restore
reports a checksum error. One tab surviving once does not set a safe backup
size.

## Afterwards

Fill in the result template from BACKUP-TESTING.md once per trial and keep the
files you made. A lower-memory backup format is worth designing only if these
measurements show the current one failing; until then it is a guess.
