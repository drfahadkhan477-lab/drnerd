# PhotoSwipe, vendored

The figure viewer (`openFigure` in `app/systole.html`) is PhotoSwipe 5.4.4 by Dmytro Semenov, MIT licensed (`LICENSE`, beside this file).

| File | From the npm package `photoswipe@5.4.4` | sha256 |
|---|---|---|
| `app/vendor/photoswipe/photoswipe.umd.min.js` | `dist/umd/photoswipe.umd.min.js`, unchanged | `ba86fd2dadb31acd8e488540fedb5037c598bf86c63a2a804d5025271af6a323` |
| `app/css/photoswipe.css` | `dist/photoswipe.css`, with its one `:hover` rule moved inside `@media (hover:hover)` and the `-moz-`/`-ms-user-select` lines removed | (edited) |

The package tarball's integrity, as npm publishes it:
`sha512-WNFHoKrkZNnvFFhbHL93WDkW3ifwVOXSW3w1UuZZelSmgXpIGiZSNlZJq37rR8YejqME2rHs9EhH9ZvlvFH2NA==`

`tests/verify-vendor-pure.js` holds the script to the hash above and checks that its licence reaches the device. When it was
vendored the script was parsed (acorn 8.12.1) as ES2019, which Safari 13.4 reads, and it calls nothing newer than
`PointerEvent`, `img.decode()` and `globalThis`. That was checked once, by hand; no suite repeats it.

The single-file build carries it inline. The split build lifts it out of `app.js` into
`vendor/photoswipe-<hash>.js`, with this licence beside it as `vendor/photoswipe-LICENSE.txt`, and the service worker
precaches the script with the shell. The app loads it the first time
a figure opens, so the shell's transfer budget does not pay for it.
