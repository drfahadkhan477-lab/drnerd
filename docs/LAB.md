# The Lab

A second, small app next to Systole and Memorizer for the things a question bank
teaches badly because they are heard or drawn rather than read:

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
question bank), keeps a day streak, and stores all of that in the browser. Nothing
leaves the device.

## It contains nothing from ACCSAP

Unlike Systole it needs no licensed export, so it builds anywhere, CI included.

```bash
npm run lab              # → dist-lab/index.html (one file, also works opened locally)
npm run lab:serve        # build, then serve it at http://localhost:8082
node scripts/build-lab.js --zip   # → lab-cloudflare.zip, for Cloudflare Pages
```

## Putting it on the iPad

Same as Memorizer (see `docs/IPAD.md`): in Cloudflare, **Workers & Pages → Create →
Pages → Upload assets**, a *new* project (name it `systole-lab`), upload
`lab-cloudflare.zip`. Open the address in Safari on the iPad and **Add to Home Screen**.
From a page opened straight from the Files app nothing is stored, and the Lab says so.

## What has and has not been checked

Held by tests: the audio is the lesion asked about (read back off the buffer handed
to the browser), nothing names an answer before it is given, progress survives a
reload and bad storage, the heart map agrees with the physiology and the audio, every
strip shows what it is named for, nothing leaves the device.

**Not held by any test, and yours to check:**

- The teaching points, the look-alike pairs, the chambers each condition loads and
  where to listen were written for this app and have not been reviewed by a clinician.
  The page says so.
- Nobody has *listened* to the heart sounds. The tests prove where the energy is;
  they cannot prove it sounds like a murmur. Use headphones: they are low-pitched.
- The ECG generator cuts a premature beat's T wave off where the next beat starts, a
  small step on the strip. Not fixed; the strip reader is written to ignore it.
