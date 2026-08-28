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
node scripts/build-pwa.js build/systole.html       # → dist/
```

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

```bash
# on the machine holding dist/
node scripts/serve.js 8080 dist &
tailscale serve --bg 8080
tailscale serve status          # prints the https://<machine>.<tailnet>.ts.net URL
```

Install Tailscale on the iPad from the App Store, sign in to the same account,
open that URL in Safari, then **Share → Add to Home Screen**.

Why this one works when a LAN address does not: service workers require a
*secure context*. `https://…ts.net` is one; `http://192.168.1.42` is not. No
secure context means no service worker, which means no offline and no real
install — just a web page that stops working when you close the laptop.

**Press "Download the rest" first.** Figures are otherwise fetched one at a
time, as you meet the questions that use them — which would mean every figure
you had not already seen was a broken image the moment the laptop slept. The
card under the doors on the home screen pulls all 408 down in one go, about
19 MB over the wifi you are already on. After that the tablet holds the whole
bank whether or not the machine that served it still exists.

## 2. Cloudflare Pages + Access — works from anywhere

Free, and Access is free for up to 50 users.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**, and drag `dist/` in.
2. **Settings → Access** on the new project → require your email address.
3. Open the `*.pages.dev` URL on the iPad, sign in once, **Add to Home Screen**.

Fully offline afterwards, and reachable from a hospital wifi. The trade is that
`dist/content/` — the bank and 408 figures — sits on Cloudflare's storage.

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
