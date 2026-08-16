# Embedded typefaces

Latin subsets, embedded into the app by `scripts/stage0-patch.js` as base64 so
the app makes no network request on launch.

| File | Family | Licence |
|---|---|---|
| `DMSans.woff2` | DM Sans (variable 400–700) | SIL Open Font License 1.1 |
| `DMSans-Italic.woff2` | DM Sans Italic (variable 400–700) | SIL Open Font License 1.1 |
| `DMSerifDisplay.woff2` | DM Serif Display 400 | SIL Open Font License 1.1 |
| `JetBrainsMono.woff2` | JetBrains Mono (variable 400–700) | SIL Open Font License 1.1 |

The OFL permits redistribution and embedding, including in this repository.

Previously these were fetched from `fonts.googleapis.com` at launch. That request
stalled the app for **12.8 seconds** whenever it could not complete — offline, on
a plane, or behind a hospital captive portal — because the stylesheet blocks
rendering. Embedding them removed the stall and the dependency together.
