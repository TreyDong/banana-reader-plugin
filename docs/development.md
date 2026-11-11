# Development

Run commands from the repository root. Node.js and npm are required.

Current version: **0.13.3**, using `banana-reader` as the plugin ID with guarded legacy-data copying and compatible old note links. The minimum desktop Obsidian version remains **1.11.4**.

```sh
npm ci
npm run check
```

## Layout

- `src/`: runtime TypeScript. The plugin entry is `src/main.ts`. Existing modules remain together so their relative imports and behavior are unchanged.
- `tests/`: Node test-runner regression tests. Imports point to `../src/`; tests use synthetic data and mocked or local-loopback services.
- `scripts/build.mjs`: bundle the entry with esbuild and embed the root project license and complete third-party notices.
- `tsconfig.json`: typecheck runtime sources using the existing compiler options; no JavaScript is emitted by TypeScript.
- `docs/`: developer and detailed reference documentation.

The build emits `main.js` in the repository root. Install that file together with root `manifest.json` and `styles.css`. Runtime outputs are independent of the source-directory layout. `main.js` and `node_modules/` are ignored by Git.

The plugin ID and installation folder are `banana-reader`. Legacy `gloss-reader` data is imported only when the old plugin is disabled and the destination is safe. Build and tests do not deploy files to a vault. Preserve any existing `data.json` and `indices/`; they are user data and are never source files or release assets. Do not copy this repository into an Obsidian vault.

## Licenses

[LICENSE](../LICENSE) covers project code. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) records bundled dependency and font notices plus historical source references. The build carries the complete texts in `main.js`. Both files stay in the repository root.

## Official source checks

`npm run lint` runs the pinned `eslint-plugin-obsidianmd` recommended checks against all runtime sources and release metadata. Obsidian rules retain their recommended error/warning levels. General JavaScript and TypeScript findings remain visible warnings to match the observed community scan; they are not silently disabled. `npm run check` runs lint, regression tests and the TypeScript/bundle build in sequence. Any lint error or failed test/build blocks the command.

The 0.13.1 scan reported 10 static style assignments and seven manually created settings headings. The fix keeps the same style values through `setCssStyles()` and uses `Setting.setName().setHeading()` with existing typography and localization bindings. It does not change model execution, layout calculations or persisted data. The lint regression was checked against the original source: all 17 errors were detected and none remain in the repaired source. Other warnings remain outside this repair's scope.

## UI localization

`src/i18n.ts` contains the UI catalog, Obsidian-language resolution and display-only helpers. `settings.language` accepts `auto`, `zh-CN` or `en`; older settings default to `auto`. Use `ui(...)` for fixed interface labels. Keep document content, editable prompts, custom model/service names and data-path strings literal. Built-in command names are translated only while their saved name is unchanged. Locale changes persist through the existing save queue; a failed save restores the previous locale. Open reader tabs update their explicitly bound UI labels in place, preserving active questions, selections and drafts.

`auto` uses Obsidian's `getLanguage()`: Chinese locales resolve to Simplified Chinese, while other locales resolve to English. The setting is per vault. UI language does not change the model's answer language or translate existing default prompts. Preserve canonical PDF source labels and other stored identity strings; translate their display labels without changing selection or citation matching.

The regression suite includes locale resolution, catalog coverage, placeholder preservation, custom command names, persistence and save-failure rollback, compiled-plugin integration and same-page PDF selection preservation. Compiled-plugin tests cover language changes in an already open notebook and retain draft inputs, source anchors and active controllers. The suite includes the original 124 regression tests plus migration and protocol compatibility coverage. Native checks in an isolated synthetic vault use BRAT to restart only the test Reader, then switch English/Chinese/English in the same open reader. Notebook filters and counters, mark styles, reading statistics and index tooltips update while the unsent draft and saved marks remain intact.

`bindUi()` registers explicitly translated text nodes and accessibility attributes; `refreshUi()` updates only those bindings, retaining child icons and skipping nodes changed by another renderer. User-authored content and input values are never registered. `refreshLanguage()` refreshes reader chrome, notebook labels and reading statistics without reloading documents, restarting services or triggering model requests. Index progress retains a label callback so counts can be rendered in the current locale; repainting does not restart indexing. After notebook rendering, remove only generated accessibility captions no longer referenced by `aria-labelledby`.

## Release checklist

The active publication repository is [TreyDong/banana-reader-plugin](https://github.com/TreyDong/banana-reader-plugin). The previous `TreyDong/banana-reader` repository retains historical releases; do not publish new versions there. The package ID and local project directory remain `banana-reader`.

Keep `package.json`, the root package entries in `package-lock.json`, `manifest.json` and `versions.json` consistent. Update the current version and behavior in both READMEs and this guide; historical release entries retain their original versions. Run `npm run check` from the exact source revision being released. For an unchanged plugin ID, push a candidate branch and obtain a successful official **Review branch** scan before publishing. The old entry rejects a new ID even when its source checks pass. For the explicitly approved 0.13.3 replacement, archive the old entry, publish the new-ID package and submit a new entry for its own review. A local build or GitHub release alone does not establish directory approval.

Publish only `main.js`, `manifest.json` and `styles.css` as installation assets, using the manifest version as the release tag without a `v` prefix. Verify the published tag, source revision and downloaded asset hashes. Keep compiled output, credentials and vault data out of Git and the release. Updates within the new ID replace only those three files. Old-ID installations must follow the guarded replacement process below; never install a new-ID manifest into the old folder. Preserve `data.json`, `indices/` and `legacy-migration.json`.

## Plugin identity replacement

Use a new `banana-reader` directory entry and retire the old `gloss-reader` listing rather than maintain parallel release channels. The package is based on 0.13.2 plus the isolated migration work; unrelated 0.14.0 work is excluded. Internal view types and historical source attributions remain unchanged. Both new and legacy note protocols resolve through the same handler. Do not rename active installations or rewrite vault-wide settings during development.
