# How the documentation is produced and consumed

## The trees

| Tree | Root noteId | Source | Generated from it |
| --- | --- | --- | --- |
| User Guide | `pOsGYCXsbNQG` | `docs/User Guide/` (Markdown + `!!!meta.json`) | `apps/server/src/assets/doc_notes/en/User Guide/**/*.html` + its minified `!!!meta.json`; `apps/standalone/src/assets/help_meta.json`; `site/user-guide` on the docs site |
| Developer Guide | `jdjRLhLV3TtI` | `docs/Developer Guide/` | `site/developer-guide` |
| Release Notes | `hD3V4hiu2VW4` | `docs/Release Notes/` | the GitHub release body (`scripts/release-notes-body.mts`, `release.yml`) |

`edit-docs-config.yaml` at the repo root is the single list of these mappings; both the editor and the
headless sync read it.

## The round trip

`pnpm edit-docs:edit-docs` (`apps/edit-docs/src/edit-docs.ts`) zips every non-`exportOnly` mapping,
imports it into an in-memory database with `preserveIds: true`, opens an Electron window, and — 10 s
after any entity change — `rm -rf`s **every** mapping's directory and re-exports it from the
database: Markdown for the three trees, HTML for the User Guide. Nothing exports on close, and an
untouched session writes nothing.

`pnpm edit-docs:sync-docs` (`apps/edit-docs/src/sync-docs.ts`, `docs.mjs sync`) is the same import
and the same export with no window: `apps/edit-docs/src/docs_pipeline.ts` holds the shared code.
Running it on a clean tree is byte-stable; running it after a hand edit normalizes the Markdown the
way the editor would (the import renders Markdown to HTML, the export turns it back) and regenerates
the HTML and both help metas. ~7 s.

Consequences:

- The import resolves every relative `.md` link to a noteId; the export re-derives paths and file
  names from titles. So a rename or move only needs the title/entry changed — links, attachment file
  names and folder names follow on the next sync.
- A file in no `!!!meta.json` entry is deleted by the export; a `.md` in an existing folder with no
  entry makes the import throw (`Cannot find parentNoteId`). Tree-shape changes go through `docs.mjs
  new` / `image` / `rename` / `move` / `delete`, which write the entry.
- The export adds `# <title>` when the body does not start with it; the importer removes a matching
  first H1 and demotes a differing one.
- `internalLink` / `imageLink` relations are never in the meta — they are rebuilt from content.
- `pnpm docs:build` (`apps/build-docs`) is the **site** build: it imports `docs/` again and share-exports
  it to `site/`, ignoring `edit-docs-config.yaml`. It is not a way to regenerate `doc_notes`.

## `!!!meta.json` (formatVersion 2)

`{ formatVersion: 2, files: [rootEntry] }`, written 4-space indented, key order `isClone, noteId,
notePath, title, notePosition, prefix, isExpanded, type, mime, attributes, format, dataFileName,
attachments, dirFileName, children`. Types: `packages/trilium-core/src/meta.ts`; producer
`services/export/zip.ts` (`createNoteMeta`); consumer `services/import/zip.ts` (`getMeta`).

- `noteId`: 12 chars `[A-Za-z0-9]` (`newEntityId()`). Kept on import. **Permanent** once the app or
  a page links it.
- `notePath`: ancestor noteIds from the tree root down to the entry.
- `notePosition`: multiples of 10, ascending within `children` (ties allowed); the root is forced to 1.
- `type` / `mime`: `text` / `text/html` for a page (`text/markdown` is a legacy mime on 71 older
  pages); `webView` for the Script/REST API frames (`webViewSrc`); `code` for a few `.js`/`.jsx`/`.json`
  notes; `book` for the Breaking-changes folder.
- `format: "markdown"` on every text entry (that is what makes the importer render the file).
- `dataFileName`: `sanitize(title) + ".md"`; absent for a folder note with empty content (13 in the
  User Guide). `dirFileName`: `sanitize(title)`, present only with `children`. `sanitize` strips
  `/ \ : * ? " < > |`.
- `attributes[]`: owned labels/relations `{type, name, value, isInheritable, position}`. In the
  User Guide: `shareAlias` (295), `iconClass` (254, all `bx …`), `webViewSrc` (7), `sorted` (3), and
  on the root `label:shareAlias` (the promoted "Slug" field, inheritable) and `readOnly`.
- `attachments[]`: `{attachmentId, title, role: "image", mime, position: 10, dataFileName}` sorted by
  `attachmentId`; file `<page base>_<title>`, `N_` prefixed when the directory already has that name.
- `isClone: true` entries (2) carry only `noteId, notePath, title, prefix, dataFileName: "<Title>.clone.md",
  type, format, isExpanded` — the same noteId appears twice in the tree.

## What the app reads

- **In-app help** (`F1`, help buttons): `apps/server/src/in_app_help_provider.ts` loads
  `doc_notes/en/User Guide/!!!meta.json` — a minified `HiddenSubtreeItem[]` (not a NoteMetaFile)
  built by `apps/edit-docs/src/help_meta_generator.ts`: each page becomes `_help_<noteId>` of type
  `doc` with `#docName` (`User Guide/User Guide/<folders>/<title>`), `#docUrl` (the alias chain) and
  `#iconClass`. `checkHiddenSubtree()` materializes it under `_help`; `doc_renderer.ts` fetches
  `doc_notes/en/<docName>.html` and refuses a docName outside `[a-zA-Z0-9_/\- ()&.,\`]`.
- **Standalone/mobile**: `apps/standalone/src/assets/help_meta.json` — the same tree as `webView`
  items pointing at `docUrl`; a page without an alias is dropped.
- **Help buttons link by noteId** (`<HelpButton helpPage="…">` → `openInAppHelpFromUrl` →
  `_help_<id>`; `Modal helpPageId`; `services/in_app_help.ts` maps note types, collection views and
  sidebar sections). ~60 IDs are hard-coded in `apps/client/src`; `docs.mjs show` lists them per page
  and `check` fails when one points nowhere. `apps/client/src/services/in_app_help.spec.ts` is the CI
  guard for the `in_app_help.ts` maps, the docName files and the `_help_` links inside the HTML.
- **Public URL** = `https://docs.triliumnotes.org` + `/` + each ancestor's `shareAlias` (ancestors
  without one contribute nothing). Unique as a full path, not globally (`troubleshooting` is used
  three times). Hard-coded in `README.md` (mirrored to 40 translated READMEs by CI), `apps/website`,
  `apps/web-clipper`, the about dialog; `check` resolves every literal against the alias chains.
- **Search docs examples**: `packages/trilium-core/src/services/search/docs_examples.spec.ts`
  requires every query shown in `Navigation/Search.md` and `Quick search.md` to have a test.
- **LLM tools** read the same `doc_notes` files (`apps/server/src/services/llm/tools/doc_notes.ts`).

`doc_notes/cn/` holds nine legacy hand-written system snippets (launch-bar and hidden-note docs), no
User Guide, and is frozen; the client always requests the User Guide in `en`.

## What the site build reads

`.github/workflows/deploy-docs.yml` runs `pnpm docs:build` on pushes to `main`/`stable` and on PRs
touching `docs/**`, `apps/edit-docs/**`, `apps/build-docs/**` or `packages/share-theme/**`, validates
only that `site/index.html` and `site/developer-guide/index.html` exist, and deploys to Cloudflare
Pages. No link or image check runs anywhere in CI — `docs.mjs check` is the only one.

## Where features are documented (a map for `impact`)

Settings panes → `Basic Concepts and Features/UI Elements/Options.md` plus the feature's own page
(Appearance → `Themes.md`, `UI Elements/{New Layout, Ribbon, Zoom, Content width}.md`; Shortcuts →
`Keyboard Shortcuts.md`; Text notes → `Note Types/Text/*`; Code notes → `Note Types/Code.md`; Images →
`Note Types/Text/Images.md`, `Advanced Usage/Text Extraction (OCR).md`; Spellcheck → `Note Types/Text/
Spell Check.md`; Password/TOTP → `Installation & Setup/Server Installation/*`; ETAPI → `Advanced
Usage/ETAPI (REST API).md`; Backup → `Installation & Setup/Backup.md`; Sync → `Installation & Setup/
Synchronization.md`; AI → `AI.md`, `AI/*`). Ribbon, launcher bar, right sidebar, tabs, split view,
floating buttons, note tree, global menu → `Basic Concepts and Features/UI Elements/*`. Note types →
`Note Types/<type>.md`; collection views → `Collections/<view>.md`; search → `Basic Concepts and
Features/Navigation/{Search, Quick search, Jump to & command palette}.md`; attributes → `Advanced
Usage/Attributes/*`; import/export → `Basic Concepts and Features/Import & Export/*`; scripting →
`Scripting/*`; themes/icon packs → `Theme development/*`; desktop/mobile → `Installation & Setup/
{Desktop Installation, Mobile Frontend}.md`. `Feature Highlights.md` is a per-version list of major
features the maintainer curates at release time.
