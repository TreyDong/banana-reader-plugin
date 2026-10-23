# Plugin identity replacement and recovery

Version 0.13.3 uses `banana-reader` as the plugin ID and installation folder. It is a replacement installation for the earlier `gloss-reader` identity. The maintainer chose to retire the old listing rather than maintain parallel versions. A published GitHub release and a completed directory registration are separate outcomes; a new directory link may be unavailable while review is pending.

## Directory cutover

The account editor has no ID field. The [official sample](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/AGENTS.md#manifest-rules-manifestjson) treats released IDs as stable API, and the [manifest reference](https://docs.obsidian.md/Reference/Manifest) requires installation folders to match the ID. This replacement does not claim an automatic update path or transfer of listing history/downloads. An earlier administrator inquiry remains separate from the chosen replacement strategy.

1. Run local checks and submit the exact candidate for official Review branch scanning. For 0.13.3, the old entry rejected only the changed manifest ID (`banana-reader` versus `gloss-reader`); source checks contained warnings without blocking source errors. The maintainer explicitly approved proceeding through new-entry review instead of requiring the incompatible old-ID preview to pass.
2. Prepare the three installation assets and retain the old release tag and assets as recovery material. Do not overwrite old release assets with a new-ID manifest.
3. The old `gloss-reader` listing is archived. A new submission using the former repository was rejected because archiving retains its repository binding. The maintainer explicitly approved a separate public publication repository, [TreyDong/banana-reader-plugin](https://github.com/TreyDong/banana-reader-plugin), retaining the former repository for history and ending legacy-version maintenance. Publish the audited 0.13.3 package there and submit the new repository for `banana-reader`. If the directory also reserves the old display name, stop for administrator assistance rather than delete or rename entries to evade a restriction.
4. Verify the new listing and its review result independently of GitHub. An archived old listing is not a redirect, and registration does not migrate installed vaults.

## Existing installation

For the 0.14.0 mobile candidate, complete the initial legacy migration on desktop. Mobile never copies across plugin identities: Obsidian DataAdapter does not provide exclusive file creation. With old data present, the phone requires the desktop migration receipt, verifies legacy hashes (including Windows receipt paths), and validates the destination store before loading it. Changed legacy data, an active/unknown old plugin, or a missing/invalid receipt stops loading before settings reads or writes. Fresh installations and existing `banana-reader` installations without legacy data load normally.

Back up the old plugin folder first. Disable `gloss-reader` before enabling `banana-reader`; do not uninstall the old plugin first, because uninstalling may remove its stored data. Install the matching new release files into `<vault>/.obsidian/plugins/banana-reader/`, using the actual configuration directory if it differs from `.obsidian`.

On first load, the guarded migration runs before `loadData()` or any settings persistence. It copies the old `data.json` and recognized `indices/` files without rewriting their fields, preserving settings, model/service references, prompts, document keys, highlights, annotations, conversations, citations and reading progress. Normal pre-existing store-version migrations still apply during loading. New installations without old data use the normal defaults.

The helper stages private files, verifies hashes and creates destination files exclusively. Existing destination data or indexes without a matching migration receipt cause a refusal; it never merges or overwrites them. It rejects active/unknown old-plugin state, symlinks, invalid or unsupported data formats, unexpected index files, changed source files and excessive sizes. Failed copies roll back only newly created unchanged files. Old files remain untouched. The `legacy-migration.json` receipt makes subsequent loads idempotent and prevents a changed old copy from silently replacing newer data.

Only data copying is automated. Plugin installation, enabled state, vault-wide settings, custom shortcuts and workspace files are not rewritten. Reassign custom shortcuts to the new plugin commands. Internal reader view types remain stable. New exported links use `obsidian://banana-reader`; old `obsidian://gloss-reader` links use the same handler for existing notes. No parallel old plugin needs to remain enabled.

## Connections and credentials

Service IDs and existing `reader-<service-id>` SecretStorage reference names are retained. The helper does not read, copy, export or transmit credential values. Test the connection after cutover; session-only keys must be entered again, and a missing saved secret should be re-entered through the usual service settings rather than copied into data files. Cross-ID secret availability must be verified in an isolated vault rather than assumed from a mock test.

## Recovery and conflicts

Keep both data copies and the backup until migration, restart and annotations have been verified. Before new edits are made, disable the new plugin and return to the old installation/release if needed. Once either copy has new edits, reconcile the copies explicitly before switching back; no automatic merge or reverse migration is provided. Do not remove the migration receipt or erase destination data to force a repeat import. Directory retirement does not delete local data or historical release assets.

## Validation

Run `npm run check` for official lint, the complete regression suite and the TypeScript/bundle build. Filesystem tests cover byte-preserving copies, custom configuration directories, idempotence, active/unknown old-plugin state, conflicts, malformed/future data, symlinks, concurrent changes and partial disk failure. Compiled-plugin tests cover import-before-load, refusal before settings reads/writes while the old plugin is active, and new/legacy note-protocol registration. Export tests cover new protocol links with encoded document paths and anchors. Use synthetic vaults for native Markdown/PDF/EPUB, restart, connection and recovery checks; never rename an active personal installation to test the migration.
