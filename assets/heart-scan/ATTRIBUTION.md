# Scanned heart

**Realistic Human Heart** by [neshallads](https://sketchfab.com/neshallads),
[source on Sketchfab](https://sketchfab.com/3d-models/realistic-human-heart-3f8072336ce94d18b3d0d055a1ece089),
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Changed from the original: `scripts/prep-glb.js` placed the mesh in this app's
anatomical frame, quantised its geometry, added per-vertex chamber weights and
activation times so it beats on the app's cardiac clock, and re-encoded its
three texture maps as WebP. The licence and credit travel in
`heart-scan.json`, which the app reads to draw the credit on the home screen
whenever the scan is shown (`paintHeroScanCredit` in `app/systole.html`,
checked by `tests/verify-pwa.js`).
