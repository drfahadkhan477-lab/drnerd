# Getting Systole onto an iPad, in Safari

The short version: **iOS and iPadOS Safari cannot open a local HTML file.** Not
from Files, not from iCloud Drive, not by typing a `file://` URL — Apple removed
that in iOS 8 and has not put it back. That single restriction is the whole
reason a 32 MB `systole.html` needs a third-party app like Documents to open at
all, and no amount of work on the file itself changes it.

So the file has to come from a URL. The good news is that once it does, Safari
gives you something better than Documents ever could: **Add to Home Screen**
turns Systole into a real app — its own icon, no browser chrome, its own window
in Split View — and the service worker keeps it working with the network off.

Build the thing you host:

```bash
node scripts/build.js path/to/ACCSAP_export.html   # → build/systole.html
node scripts/extract-content.js build/systole.html # → content/
node scripts/build-pwa.js build/systole.html       # → dist/
```

**All three, in that order, every time.** The middle one is easy to skip on a
rebuild — `content/` is already there, so the split appears to work. It does
not: `dist/index.html` and `dist/app.js` would be the new build and
`dist/content/` the old one, and nothing on screen would say so. `build-pwa.js`
now compares the digest `extract-content.js` wrote into `content/manifest.json`
against the file it is splitting and refuses the pair when they disagree,
naming both. This sequence is what the refusal is asking for.

`dist/` is a plain static folder, about 23 MB — the bank, 408 figures, the
shell and the fonts, and nothing else. Nothing in it needs a server that can run
code, so any static host will do.

---

## Which route

| | Where the content lives | Offline | Effort |
|---|---|---|---|
| **Tailscale** | your own machine | full, after one download | one install |
| **Cloudflare Pages + Access** | Cloudflare, behind a login | full | ~15 min, needs an account |
| **Plain LAN over HTTP** | your own machine | **no** | one command |

**The question bank is licensed.** Tailscale keeps it on hardware you own and
serves it only to your own devices. Cloudflare means uploading it to someone
else's storage, private URL or not. That is a judgement call about your licence,
not a technical one — which is why there is no single recommendation here.

---

## 1. Tailscale — private, TLS, nothing uploaded

Tailscale gives your machines a private network with real HTTPS certificates.
The iPad talks to your laptop directly; nothing is published anywhere.

It takes two commands because of a macOS limitation worth knowing about:
`tailscale serve` can point at a **folder** or at a **local port**, but the
folder form is unavailable on the Mac App Store and Standalone builds — the app
sandbox forbids it. So a small web server holds the folder, and Tailscale
proxies its port. That form works on every platform, so it is the one
documented here.

```bash
# 1. serve the folder locally. python3 ships with macOS; nothing to install.
cd /path/to/dist
python3 -m http.server 8080

# 2. in a second terminal, put that port on your tailnet
tailscale serve --bg 8080
tailscale serve status          # prints the https://<machine>.<tailnet>.ts.net URL
```

The first `tailscale serve` will offer to enable HTTPS certificates for your
tailnet if they are not already on — say yes; the URL depends on it.

`python3 -m http.server` is enough: the suite passes 34/34 against it, with the
manifest, the woff2 faces, the webp figures and the service worker all served
under the right content types by its stock table. If you would rather use the
repo's own server, `node scripts/serve.js 8080 dist` is equivalent.

Install Tailscale on the iPad from the App Store, sign in to the same account,
open that URL in Safari, then **Share → Add to Home Screen**.

To stop sharing: `tailscale serve off`.

Why this works when a LAN address does not: service workers require a *secure
context*. `https://….ts.net` is one; `http://192.168.1.42` is not. No secure
context means no service worker, which means no offline and no real install —
just a web page that stops working when you close the laptop.

**Press "Download the rest" first.** Figures are otherwise fetched one at a
time, as you meet the questions that use them — which would mean every figure
you had not already seen was a broken image the moment the laptop slept. The
card under the doors on the home screen pulls all 408 down in one go, about
19 MB over the wifi you are already on. After that the tablet holds the whole
bank whether or not the machine that served it still exists.

## 2. Cloudflare Pages + Access — works from anywhere, and needs no computer

Free, Access is free for up to 50 users, and the whole thing can be done from
the iPad: the dashboard's direct upload takes a **zip**, not just a folder, so
the zipped `dist/` can be picked straight out of Files.

### Making that zip, which is not as obvious as it looks

Two things have to be true, and the obvious Windows command gets the second
one wrong in a way nothing warns you about.

**The contents of `dist/` go at the root of the zip, not a `dist` folder.**
Cloudflare looks for `index.html` and `_worker.js` at the top level of what it
unpacks. Open the finished zip: if the first thing you see is `index.html`
beside `_worker.js`, it is right. If it is a folder called `dist`, the site
will 404 and the Worker holding the Gemini key will never be installed.

**The paths inside must use forward slashes.** The zip format requires `/`.
Windows PowerShell 5.1's `Compress-Archive` writes `\` instead —
`content\questions.json` — and nothing complains: iOS Files shows tidy
folders, because its unzipper guesses. Cloudflare's does not. It reads
`content\questions.json` as one oddly-named file at the root, so no `content/`
directory is ever created and every figure, font and icon is missing while the
five root files work perfectly. The app loads, the service worker installs,
and the splash says **"Could not load the question bank"**, with a second line
naming which failure it was. When this happened that second line read *"open
this over http, not as a file"* — the only sentence the loader had, and the
wrong one, which is why it sent the search in the wrong direction. It now says
*"content/questions.json is not on the server (404) — if this was just
deployed, the content folder did not make it into the upload"*, which is the
sentence that would have ended it in a minute.

This happened. 420 of 425 entries were affected; the five that were not are
the five at the root.

Either of these writes correct paths:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory("C:\path\to\drnerd\dist", "$HOME\Desktop\systole-dist.zip")
```

```powershell
tar.exe -a -c -f "$HOME\Desktop\systole-dist.zip" -C dist .
```

```bash
cd dist && zip -r ../systole-dist.zip .        # macOS and Linux
```

To check a zip before uploading it, on any machine with Python:

```bash
python3 -c "import zipfile,sys; n=zipfile.ZipFile(sys.argv[1]).namelist(); print(sum('\\' in x for x in n), 'of', len(n), 'entries use backslashes')" systole-dist.zip
```

Zero is the only acceptable answer.

NOTHING IN THE TEST SUITE CAN CATCH THIS. The build produces a correct
`dist/`; the damage happens afterwards, in a tool outside the repository, to
an artefact nobody verifies again. That is exactly why it is written down here
rather than left to be rediscovered.

### Deploying it

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**. Give it a name, then choose the zip.
2. **Settings → Access** on the new project → require your email address.
3. **Settings → Environment variables → Add variable**, name `GEMINI_API_KEY`,
   paste your AI Studio key, and press **Encrypt** before saving. Redeploy once
   so the running Worker picks it up.
4. Open the `*.pages.dev` URL on the iPad, sign in once, **Add to Home Screen**.
5. Press **Download the rest** on the home screen.

### The key lives on the edge now

`_worker.js` at the root of the upload makes the deployment a Worker as well as
a site: it answers `/api/apex/gemini/*` with your key attached server-side, and
hands every other request straight back to the static site. Apex opens with
nothing to type.

That is Gemini only. **Mistral is still bring-your-own-key**, and so is Gemini
the moment you paste a key into Apex settings — a key you typed always wins.
The single-file `systole.html` has no server at all, so it is always BYOK.

What bounds the cost: Access means only your signed-in address can reach the
endpoint; the Worker clamps `maxOutputTokens` to 2000 whatever the browser asks
for, caps the request body at 6 MB, and refuses any model that is not a Gemini
one. The per-minute limiter is **best-effort** — a Worker isolate has no shared
counter, so it is a speed bump against a runaway loop rather than a quota. If
you ever share this URL with someone else, put a KV-backed limiter in first.

The platform limit that binds is Cloudflare Pages' per-file ceiling — labelled
"25 MiB" but enforced at **25,000,000 bytes** — and the
file that approaches it is `content/refs-images.json`, which grows with every
unit of note figures. `build-pwa.js` refuses a `dist/` with any file over the
ceiling and prints the largest file on every build, so the margin is on screen
before a deploy rather than discovered after one. (This sentence used to quote
the largest file's size; that number went stale by a factor of four and a
deploy broke under it.)

Fully offline afterwards, and reachable from a hospital wifi. The trade is that
`dist/content/` — the bank and 408 figures — sits on Cloudflare's storage.

**An authenticating proxy does not answer with an error.** Access with an
expired session replies `200 OK` and a sign-in page, which is exactly what a
naive downloader counts as a figure. So every response is checked for an
`image/` content type before it counts, anything else is deleted back out of
the cache rather than left there pretending, and the card turns amber and says
how many failed. Sign in again in a browser tab and press the button once more.

## 3. Plain LAN — quickest, and the most limited

```bash
node scripts/serve.js 8080 dist          # then browse http://<your-ip>:8080
```

Fine for a look. No service worker (see above), so no offline and no install.

---

## Putting the whole bank on the tablet

The split build streams figures on demand — the right default for a web app,
and the wrong one for a ward round. So the home screen carries a card:

```
ON THIS DEVICE                        0 of 408 figures here
▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
Pull every figure down once and the bank works
with no network at all.              [ Download the rest ]
```

It does not keep a cache of its own: it only *requests* each figure, and the
service worker's ordinary fetch handler does the storing — the same cache, with
the same name and the same eviction, that a figure met the normal way goes
through. Six requests at a time, about ten seconds on a laptop over Tailscale,
and a reload afterwards finds all 408 without fetching one of them again.

The card appears only in the split build. In the single file every figure is
already inline, and a button offering to download them would be a lie.

## What "installed" gets you

The shell is 559 KB and the head already declares everything Safari needs:
`mobile-web-app-capable` and its `apple-` twin, `apple-mobile-web-app-title`,
a black-translucent status bar, `viewport-fit=cover` so the layout runs under
the rounded corners, an `apple-touch-icon`, and a web manifest that asks for
`display: standalone`.

Fonts, the question bank and the figures are separate cacheable files rather
than base64 inside the HTML — 250 KB of typeface alone that Safari no longer
has to parse before it can draw anything.

## Known limits, stated plainly

- **Not verified on real Safari.** The suites run against Chromium; WebKit is
  not installed in the build environment. Everything here follows from
  documented WebKit behaviour and from the shell's own contents, but nobody has
  watched it boot on an actual iPad.
- **`backdrop-filter`** carries `-webkit-` prefixes throughout, which is what
  Safari wants.
- **Storage is evictable.** iOS may clear a site's data after roughly seven days
  with no visit. Installing to the Home Screen makes this much less likely; your
  progress also rides in the export bundle, so take one before a long break.
