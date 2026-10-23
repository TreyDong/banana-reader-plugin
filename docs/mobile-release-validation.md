# Mobile candidate validation

Candidate: 0.14.0, distributed as a GitHub pre-release through BRAT. This is a test version awaiting physical iOS and Android acceptance. The stable release remains 0.13.3.

## Installation contract

The release tag and manifest version are both `0.14.0`; ID is `banana-reader`; minimum Obsidian is 1.11.4; `isDesktopOnly` is false. The only installation assets are `main.js`, `manifest.json` and `styles.css`. Vault records, indexes and secrets are excluded. Select the explicit 0.14.0 pre-release in BRAT.

## Validation scope

- 180 automated tests cover mobile API protocols, cancellation and timeouts, model assignments, Node isolation, indexes, interrupted-request recovery, document formats, localization, migration and legacy links.
- Official local lint has zero errors. Existing warnings remain visible; a local scan is not community-directory approval.
- An independent Obsidian 1.14.4 instance in official mobile-emulation mode passed selection, questions and follow-ups, source jumps, export, secret-storage reload, multiline input, keyboard-sized viewports, EPUB, native PDF, load-error retry and cancelled-load switching.
- Phone layouts were inspected at 320, 390 and 768 px. Keyboard-sized checks used a 390 by 430 viewport.
- Source matches the tested candidate build. Published installation assets must be downloaded and checked against their local SHA-256 values before declaring BRAT delivery ready.

## Outstanding physical-device acceptance

Real iOS and Android system selection handles, keyboards, safe areas, WebViews, PDF gestures, credential persistence, memory behavior and book-source account/download flows still need device testing. Desktop emulation and unit tests do not establish those results. Follow the [mobile candidate guide](mobile-candidate.md) to install and test.
