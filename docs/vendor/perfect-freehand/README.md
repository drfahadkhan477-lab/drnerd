# perfect-freehand, vendored

The pen's strokes (`paint` in `attachInk`, `app/systole.html`) are drawn with perfect-freehand 1.2.3 by Steve Ruiz, MIT licensed (`LICENSE`, beside this file). It turns the points a stroke was written with into one outline that is filled, in place of a chain of round-capped segments. The highlighter is not drawn with it.

| File | From the npm package `perfect-freehand@1.2.3` | sha256 |
|---|---|---|
| `app/vendor/perfect-freehand/index.js` | `dist/cjs/index.js`, unchanged | `986865269438ec8fb5f5ab4c17ea743d57206c9da891523c045d88ae1dc5a33e` |

The package tarball's integrity, as npm publishes it:
`sha512-bHZSfqDHGNlPpgH2yxXgPHlQSPpEbo+qg7li0M78J9vNAi2yjwLeA4x79BEQhX44lEWpCLSFCeRZwpw0niiXPA==`

The file is CommonJS: it writes its functions to `exports`. `app/systole.html` slots it inside a function that gives it an
`exports` of its own and hands the result to `window.PerfectFreehand`. It carries no copyright banner, so its licence goes
with it as a file. When it was vendored the script was parsed (acorn 8.12.1): it is ES2020 because of one optional chain
(`?.`), which Safari 13.1, the iPadOS 13.4 floor, reads; ES2019 rejects it. That was checked once, by hand; no suite repeats it.

`tests/verify-vendor-pure.js` holds the script to the hash above and checks that its licence reaches the device.

The single-file build carries it inline. The split build lifts the wrapper and the library out of `app.js` into
`vendor/perfect-freehand-<hash>.js`, with this licence beside it as `vendor/perfect-freehand-LICENSE.txt`, and the service
worker precaches the script with the shell. The app loads it the first time an ink canvas is made; until it is there, a pen
stroke is drawn as segments, as it was before.
