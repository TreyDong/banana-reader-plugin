# Banana Reader

Version **0.14.0** adds a Z-Library book source (search inside the plugin, download into the vault) and a bookshelf view of cloth spines on wooden planks. English, Simplified Chinese and following Obsidian are supported.

**Read a passage. Ask about it. Keep the understanding beside the source.**

Turn Markdown notes, PDFs and EPUB books into a reading workspace inside Obsidian. Highlight a sentence, ask a question in the margin, follow the answer back to its source, and export what you learned as a Markdown note.

[Simplified Chinese guide](README.zh-CN.md) · [Install](https://github.com/TreyDong/banana-reader-plugin/releases) · [Report an issue](https://github.com/TreyDong/banana-reader-plugin/issues)


## Mobile development build

The `codex/mobile-support` branch enables mobile loading, with the same minimum Obsidian version of 1.11.4. This adaptation has not been published to the community directory and is awaiting physical iOS / Android testing.

- Use **Enter immersive reading**, **Choose a document to read** or **Open bookshelf** from the command palette. Long-press to select text, then use the bottom selection tools.
- Read answers and send follow-up questions in the notebook. On mobile, Enter inserts a newline; use the send button to submit. Inputs grow with text, and a focused follow-up stays visible as the keyboard viewport shrinks. Citations close the notebook and reveal the source. Markdown, EPUB, native PDF, annotations and exports retain their existing data formats.
- Add a **Custom API** in **Model services**, choose **Mobile question model** and use **Test connection**. Mobile task assignments are saved separately from desktop assignments. OpenAI-compatible, Responses, Anthropic and Gemini connections use Obsidian's cross-origin request interface and display complete responses. Stop discards late results; the already-sent request may still finish on the provider's side.
- Local Codex, Claude and Pi CLIs require desktop. Synced CLI configurations remain saved but cannot run on mobile; model assignments are never silently replaced. A loopback address on a phone points to that phone, so desktop-local APIs need a phone-accessible HTTPS endpoint.
- Install and enable **BRAT** from Community plugins, then add `TreyDong/banana-reader-plugin` and explicitly select the **0.14.0 pre-release**. Do not select Latest, which currently resolves to the desktop-only 0.13.3 stable release. BRAT installs the three release assets automatically; configure API secrets on the phone. See the [mobile guide](docs/mobile-candidate.md).

Obsidian 1.14.4 mobile emulation passed selection events, marking, API questions and follow-ups, citation jumps, note export, EPUB/PDF opening and bookshelf rendering. No page overflow was found at 320, 390 or 768 px. Physical selection handles, soft keyboards, PDF gestures, secret storage and book-source login/download still need device testing.

## What you can do

- **Ask where you are reading.** Select a passage for an explanation, a counterexample or a translation. Keep follow-up questions in the same conversation. Responses show their actual model and available usage.
- **Return to the evidence.** Click a paragraph citation or PDF page number to jump back to the passage behind an answer.
- **Mark what matters.** Add highlights, straight or wavy underlines and personal notes. Review them alongside your questions in the notebook.
- **Keep the original page.** Read PDF pages in their original layout with continuous scrolling. Read EPUB chapters in book order, with contents navigation and adjustable typography.
- **Leave with a useful note.** Export excerpts, annotations and conversations to a new Markdown file with source links. Original documents stay unchanged.
- **Use your own models.** Connect a supported API or an authenticated Codex, Claude or Pi CLI. Choose question, translation and article-brief models independently. Optional book indexing retrieves passages across a longer document.
- **Fetch books from Z-Library.** Search with format, language and sort filters, download into a vault folder and start reading immediately. Requires your own Z-Library account.
- **Bookshelf.** Markdown, PDF and EPUB in the vault stand on wooden planks as cloth spines; a red bookmark on the spine shows how far you have read. Click a spine to pull the book out and continue.

## Get started

1. Install from [GitHub Releases](https://github.com/TreyDong/banana-reader-plugin/releases) and enable **Banana Reader**.
2. Open a Markdown, PDF or EPUB file. Click **Open Banana Reader** in the ribbon, or run **Banana Reader: Enter immersive reading** from the command palette.
3. Select a sentence. Highlight it or add a note immediately. For AI questions, add a connection in **Settings → Banana Reader → Model services** and choose a question model first.
4. Ask about the selection, for example: *“Which claim does this paragraph support?”* Click a citation to check the answer against the source.
5. Open the notebook and click the download icon (**Export Markdown notes**) to save a new Markdown note in the vault’s export folder. Choose **Back to document** to return to the normal file view.

These instructions use English interface labels. Choose **English** in **Settings → Banana Reader → Appearance → Interface language**. For instructions using Chinese labels, see the [Chinese guide](README.zh-CN.md#%E7%95%8C%E9%9D%A2%E8%AF%AD%E8%A8%80).

Reading, marking, annotation and export work without an AI account. AI features need your own service access and may incur provider charges. The interface supports **English and Simplified Chinese**, on **Obsidian 1.11.4+**; see the mobile development-build limitations above.

## Make it comfortable

Choose **Settings → Banana Reader → Appearance → Interface language**: **Follow Obsidian**, **Simplified Chinese**, or **English**. Follow Obsidian is the default: Chinese locales use Simplified Chinese and other locales use English. The choice is saved for this vault. Settings, command labels and open readers update immediately, preserving selections, drafts and active questions. This changes UI labels only; prompts, model assignments, translation targets and saved content keep their existing values. Unedited built-in command names follow the interface; renamed and custom commands keep their saved names. Switching to English does not translate the existing Chinese default prompts or change the model's answer language.

Change the paper or dark theme, font, text size and line spacing from the reading toolbar. Wider panes show margin cards; narrow panes keep conversations in the notebook. Question, translation and article-brief models have separate assignments. Built-in Google translation is also available without a chat-model account.

For a longer text, configure an OpenAI-compatible embedding model and choose **Index → Build index** inside the reader. Indexing is optional; automatic indexing is off by default. Retrieval finds relevant passages and does not claim to summarize every page. See the [Chinese guide](README.zh-CN.md) for service setup and detailed format limits.

## Your files and connections

Annotations and conversations are saved in the plugin's `data.json`; optional indexes use its `indices/` folder. Export creates ordinary Markdown notes. If you sync `.obsidian`, your sync tool may also sync this data.

AI requests send document context and your question to the service you choose. Indexing sends text chunks to your embedding provider. Google translation sends selected text to Google; optional search sends search terms to DuckDuckGo. The optional Z-Library book source sends search queries and download requests to the mirrors you configure (failing over down your mirror list automatically), and stores sign-in credentials in Obsidian's secret storage. The plugin has no author-operated server, advertising or client-side telemetry. Bundled fonts load locally.

The file picker lists vault paths only when opened. Copy buttons **write** the requested text to the clipboard; the plugin does not read clipboard contents. Local CLI connections use executable discovery, existing CLI authentication and temporary workspaces, requiring filesystem and process access. A local CLI can still call a remote service. API connections do not require a CLI. Read the [access details](README.zh-CN.md#%E8%B4%A6%E5%8F%B7%E7%BD%91%E7%BB%9C%E4%B8%8E%E6%9C%AC%E5%9C%B0%E8%AE%BF%E9%97%AE) before connecting a service.

## Before you install

- Desktop release and mobile development candidate; English and Simplified Chinese interfaces are available.
- PDF selection needs a text layer. This version has no OCR or cross-page selection. Reading font settings do not reflow PDF pages.
- EPUB supports text chapters and local raster images. DRM and original fixed-layout styling are not supported.
- Use models available to your own account. Discovery does not guarantee access; failed requests show an error and do not silently switch providers.
- The Z-Library source is unofficial: mirrors, domains and endpoints may change at any time, some mirrors block automated clients, and free accounts have daily download limits. The book-source settings keep a mirror list with automatic failover and one-click probing; only fetch content you are entitled to access.

For manual updates, copy `main.js`, `manifest.json` and `styles.css` from the same [release](https://github.com/TreyDong/banana-reader-plugin/releases) into `.obsidian/plugins/banana-reader/`. Preserve existing `data.json` and `indices/`. The plugin ID is `banana-reader`, matching the published 0.13.3 replacement. Disable the old `gloss-reader` before enabling the replacement. Initial legacy import runs on desktop; phones verify an existing migration receipt without writing across plugin identities. See [identity migration](docs/plugin-id-migration.md). The archived old directory entry does not install this candidate.

## Development and credits

See the [development guide](docs/development.md) for the source layout, build and validation commands.

Build with `npm ci` and `npm run build`; run the official source checks with `npm run lint`, or all release checks with `npm run check`. When [reporting an issue](https://github.com/TreyDong/banana-reader-plugin/issues), include the app/plugin version, document format and reproduction steps. Do not include private documents or API keys.

Current project code: [MIT](LICENSE). Newsreader and Schibsted Grotesk fonts: SIL OFL. fflate: MIT. Full [third-party notices](THIRD_PARTY_NOTICES.md) are embedded in the installation package. Early interaction references include Gloss and Qiaomu Reader; the third-party notices retain the source-reference disclosures.

## Repository changes

- 2026-10-22 · 0.14.0: Add the Z-Library book source (EAPI search and download, multi-mirror failover and probing, secret-storage credentials, a book-source settings page) and a bookshelf view (cloth spines on wooden planks, progress bookmarks, pull-out hover motion), and update both guides and version metadata. Retain the published 0.13.3 `banana-reader` identity and legacy-link handlers. Mobile adds native API transport, isolated model assignments, touch selection, responsive notebook follow-ups and interrupted-request recovery. Physical iOS/Android acceptance remains pending.

- 2026-10-21 · 0.13.2: Replace 10 static style assignments and seven manual settings headings reported by the community scan, preserving existing values, dynamic layout and saved data. Add pinned official ESLint checks and a release-check command.

- 2026-10-20 · 0.13.1: Release immediate language switching for open readers, dynamic labels and accessibility captions; clean up English documentation. Validation covers 124 regression tests, TypeScript checking, the bundled build and native English/Chinese/English switching with marks and an unsent draft retained.

- 2026-10-20 · 0.13.0: Release English/Simplified Chinese interface settings and update both user guides, developer documentation and version metadata. Validation covers 120 regression tests, TypeScript checking and the bundled build. Plugin ID and data paths remain unchanged.

- 2026-10-20: Move unchanged runtime TypeScript into `src/`, tests into `tests/`, and the build script into `scripts/`. Group developer documentation by purpose. Update build/test paths and add an explicit TypeScript configuration. Version 0.12.5, plugin ID, installation outputs and data paths stay unchanged.

- 2026-10-20: Remove internal engineering and QA records from the repository and prepare the 0.12.5 release. Keep third-party notices and installation/data paths unchanged.

- 2026-10-20: Add a persisted UI-language choice (follow Obsidian, Simplified Chinese, English), localize settings and reader controls, and preserve existing prompts, model routes and saved documents. Settings and existing readers update immediately.

- 2026-10-20: Refresh existing reader labels immediately when the interface language changes, including Notebook, Q&A and Marks. Remove mixed-language prose from the English guide.

- 2026-10-20: Refresh reading statistics, index labels and progress tooltips on language changes, and remove orphaned accessibility captions. Validate English/Chinese/English switching in one open reader through BRAT, retaining marks and an unsent draft; 124 regression tests pass.
