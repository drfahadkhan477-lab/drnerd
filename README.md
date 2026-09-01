# drnerd

This repository holds two unrelated projects.

## Systole — cardiology board review

A single-file study app for the ABIM cardiovascular boards, built by patching a
personal ACCSAP 12 export. A procedural WebGL heart that beats on a real cardiac
clock, a 12-lead derived from one electrical dipole, a computed cardiac cycle
(Wiggers, pressure–volume loop, coronary flow, Starling and Guyton), FSRS-5
spaced repetition, and Apex — an AI tutor that can be grounded in your own
reference notes, reads the figures they cite, and remembers you between
sessions.

The home screen says one thing: a live ECG, one pearl drawn from your own
reference notes — broken at its own joints into a numbered ladder, over ECG
paper, with the pressure–volume loop turning in its corner — how far through
the bank you are,
and a row of glass doors to everything else.

```bash
node scripts/build.js path/to/ACCSAP_export.html   # → build/systole.html
node scripts/verify.js                              # 1194 checks, 34 suites
node scripts/verify.js --pwa                        # + 75 more on the split build
```

**The question bank is licensed content and is not in this repository.** It
stays on your own devices; `source/`, `build/`, `content/` and `dist/` are all
gitignored.

[![verify](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml/badge.svg)](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml)

**That badge is not the 1194 + 76 checks above — read it as 89, not 1270.**
CI has no way to build the app at all: a real build needs the licensed
export, which is deliberately never committed here and never will be, on
GitHub or anywhere else that isn't your own devices. What CI *can* and does
run on every push, with no browser and no source file: every script parses,
the patch chain and the test-suite list both still list without crashing,
`scripts/build.js` still refuses to run and explains why when no source is
present, and the two suites that are pure logic with zero build dependency —
`verify-fsrs.js` (the scheduler, 38 checks) and `verify-worker.js` (the
Cloudflare Worker holding the Gemini key, 51 checks) — both stay green. See
[`.github/workflows/verify.yml`](.github/workflows/verify.yml) for the exact
scope and why the other 1105 checks can't run here.

- **[docs/BUILD.md](docs/BUILD.md)** — how to build and verify it
- **[docs/BUILD-PLAN.html](docs/BUILD-PLAN.html)** — what was built, measured, and why
- **[docs/IPAD.md](docs/IPAD.md)** — getting it onto an iPad, in Safari, without a third-party app
- **[docs/REFERENCE-GUIDE.md](docs/REFERENCE-GUIDE.md)** — writing reference notes for Apex, with [three worked examples](docs/reference-examples/)

Lives in `src/`, `scripts/`, `tests/`, `assets/`, `docs/`.

---

## iOS Learning Platform

An early Swift scaffold — `Course.swift`, `Auth/`, `Models/`, `Services/`,
`Podfile` — unrelated to Systole. Its original documentation follows.

Welcome to the iOS Learning Platform documentation! This platform aims to provide a comprehensive learning environment for iOS development enthusiasts.

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Key Features](#key-features)
4. [Installation](#installation)
5. [Usage](#usage)
6. [Contributing](#contributing)
7. [License](#license)

## Introduction

The iOS Learning Platform is designed to help beginners and experienced developers alike to explore and deepen their knowledge of iOS development. Whether you are just starting out or looking to refine your skills, this platform has something to offer.

## Getting Started

To get started with the iOS Learning Platform, follow these steps:
1. Clone the repository to your local machine.
2. Open the project in Xcode.
3. Build and run the app to see it in action.

## Key Features
- Comprehensive tutorials
- Interactive coding exercises
- Community support
- Regular updates and improvements

## Installation

1. Ensure you have Xcode installed on your Mac.
2. Clone the repository:
   ```bash
   git clone https://github.com/drfahadkhan477-lab/drnerd.git
   ```
3. Open the project in Xcode and run it.

## Usage

Once the app is running, you will be able to access various learning resources including tutorials, exercises, and forum discussions.

## Contributing

We welcome contributions from the community! Please check out our [Contributing Guidelines](CONTRIBUTING.md) for more information.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.