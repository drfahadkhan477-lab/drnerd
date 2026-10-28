# Reading, appearance and Apex settings

The shared Settings button opens one panel. Apex's settings shortcut opens
that same panel at its connection controls. Display changes apply immediately
without replacing the active question or the Apex composer.

## Reading and appearance

Focused layout keeps the question and explanation in one column. Side by side
places the revealed explanation beside the question only when both columns
have enough room for the current text size. Narrow screens, larger text and
opening Apex can return it to one column without changing the saved choice.
An unanswered question never gains an explanation merely by changing layout.

Text size uses the existing device preference. Reading width and app brightness
are also device preferences, outside the study backup. Brightness dims the app,
not the physical display, and leaves Settings readable. Themes retain their
existing storage and backup behavior. Reset display settings leaves study data
and Apex credentials untouched.

## Apex

The panel reuses the existing provider discovery and connection flow. A key is
masked until Show key is selected. Validation must succeed before replacing the
working credential; closing or replacing the controls abandons the pending
replacement. Removal requires confirmation inside the panel. Provider errors redact echoed keys.
The existing Apex memory view remains available from the panel.

No new providers, storage copies of credentials or dependencies are introduced.

## Verification

The registered `settings` suite runs with synthetic content and mocked provider
responses in the Chromium and WebKit CI jobs. To exercise its negative controls:

```sh
NEGATIVE_CHECK=all node tests/verify-settings.js build/synthetic/systole.html
```

This mode measures each normal assertion, injects its corresponding defect,
requires the same assertion to fail, and restores the live nodes and state.
The final keyboard check also ensures that quiz shortcuts cannot act behind
the panel. Injected failures are labelled explicitly and are not recorded as passing
product checks. Raw local output and synthetic builds remain outside Git.

Existing theme and text-size suites exercise the unified panel. Their targeted
negative builds check incorrect radio semantics, unexpected closure on theme
selection, and a broken dismissal handler. The separate release/deployment
work and private inputs are outside this feature.

Measured outcomes and artifact/source hashes are recorded in
[the validation checkpoint](validation/unified-settings.json).
