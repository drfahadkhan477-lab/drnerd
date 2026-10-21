# The Practice Lab

A screen of Systole, opened from **Practice Lab** on the home screen, for the
things a question bank teaches badly because they are heard or drawn rather than
read:

- **Heart sounds** — twelve lesions, synthesised on the valve events `physio.js`
  already measures. Press play, name what you hear. Each is offered against the
  look-alikes it is mistaken for (a systolic murmur against systolic murmurs).
- **Pressure tracings** — right atrial and wedge waveforms, normal and abnormal,
  drawn from the same equations as the cardiac-cycle diagram.
- **ECG strips** — fifteen single-lead rhythms from the Rhythm Lab's generators,
  with the rate read off the finished strip.
- **Show on the heart** — for each of those 24 conditions: which valve, what kind
  of fault, which chambers it loads, where blood goes that should not, which patch
  of chest to listen at, and when in the cycle it is heard (read from the audio,
  not written down).

It remembers what you get wrong and brings it back (the same FSRS scheduler as the
question bank), keeps a day streak, and stores all of that in the browser, under its
own key (`systole-lab-v1`), apart from the question bank's record: Systole's backup
does not carry it, and a reset of one does not touch the other. Nothing leaves the
device.

## How it sits in Systole

It is not the Rhythm Lab (the `lab` screen, live traces to explore); it is the
`practice` screen beside it.

- `src/lab/*.js` are the Lab's modules, loaded by the shell after `physio.js`,
  `rhythms-extra.js` and `fsrs.js`, which they read as they load. `src/lab/ui.js` draws
  the screens inside the element Systole gives it: Systole's `buildPractice()` draws an
  empty `#plabRoot`, and `mountPractice()` hands it to `LabUI.mount()` after every draw
  and calls `LabUI.unmount()` when any other screen is drawn, which stops a heart sound
  that is playing.
- `app/css/practice.css` styles it. Every class and id starts `plab-`, so Systole's own
  `.btn`, `.chip` and `.card` never reach it, and its colours are Systole's theme
  tokens: it follows the theme chosen, light or dark, palette by palette.
- Its keys (1 to 9 answer, Enter or n goes on, p plays, Escape goes back to the Lab's
  home) answer only while it is on screen; Systole's own keys answer only on the quiz
  and a mock block.

It needs no licensed export and is built with Systole (`npm run build`). Until it moved
here it was a separate app with its own build, `scripts/build-lab.js`, and its own
Cloudflare project; that build is gone. Progress kept by the old separate app lived on
its own address and does not carry over.

## What has and has not been checked

Held by tests: the audio is the lesion asked about (read back off the buffer handed
to the browser), nothing names an answer before it is given, progress survives a
reload and bad storage, the heart map agrees with the physiology and the audio, every
strip shows what it is named for, nothing leaves the device.

**Not held by any test, and yours to check:**

- The teaching points, the look-alike pairs, the chambers each condition loads and
  where to listen were written for this app and have not been reviewed by a clinician.
  The screen says so.
- Nobody has *listened* to the heart sounds. The tests prove where the energy is;
  they cannot prove it sounds like a murmur. Use headphones: they are low-pitched.
- The ECG generator cuts a premature beat's T wave off where the next beat starts, a
  small step on the strip. Not fixed; the strip reader is written to ignore it.
