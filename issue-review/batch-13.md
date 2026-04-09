# Batch 13 — Issues #1763–#2477

## Easy-Fix Candidates

### [#2362 — "Delete all clones" checkbox should have a different message if there are no clones](https://github.com/TriliumNext/Trilium/issues/2362)
- **Problem**: The "Delete all clones" checkbox is always rendered in the delete dialog even when the note has no clones, confusing users who don't know whether to tick it.
- **Proposed solution**: In `apps/client/src/widgets/dialogs/delete_notes.tsx`, compute the clone count from `noteIdsToBeDeleted` vs the branch count (or use a server-returned count). When `cloneCount <= 1`, render an info alert like "This note has no clones" instead of the `FormCheckbox`. When clones exist, append the count to the label (`delete_notes.delete_all_clones_description_n`). Add the new translation keys to `apps/client/src/translations/en/translation.json`.
- **Effort**: small
- **Confidence**: medium — may need to thread a clone count through `delete-notes-preview` response if not already available.

### [#2455 — Various feature requests (new-tab autocomplete focus portion only)](https://github.com/TriliumNext/Trilium/issues/2455)
- **Problem**: When opening a new tab, the caret is no longer inside the "search for a note by its name" autocomplete field; user has to manually click it.
- **Proposed solution**: In `apps/client/src/widgets/type_widgets/Empty.tsx`, add `autocompleteRef.current?.focus()` inside the existing `useEffect` that calls `note_autocomplete.showRecentNotes`. Only the focus subpart of this meta-issue is easy; the other sub-items (Tab navigation in search results, shortcut collisions inside search field, scroll shortcuts) are not in scope.
- **Effort**: trivial
- **Confidence**: high for the focus part only.

## Likely Already Fixed

### [#2290 — ERROR: Failed to deserialize sync response: Option "documentSecret" doesn't exist](https://github.com/TriliumNext/Trilium/issues/2290)
- **Evidence**: `apps/server/src/services/options_init.ts` lines 10–13 call `initDocumentOptions()` which unconditionally creates `documentId` and `documentSecret` with `randomSecureToken(16)`. The option is also referenced in `sync.ts`, `setup.ts`, and the commons `options_interface.ts`. Sync/setup flow was rewritten since v0.48.
- **Verification needed**: Have a maintainer reproduce the "remote docker killed mid-sync" scenario against a current build; the missing option should now be seeded.

### [#2340 — Denial of Service (setup page spawning main windows)](https://github.com/TriliumNext/Trilium/issues/2340)
- **Evidence**: `apps/server/src/routes/setup.ts` no longer calls `createMainWindow` directly on the unauthenticated setup endpoint. It renders a setup page and only calls `windowService.createMainWindow(app)` from `handleElectronRedirect()` after the DB is already initialized. Commit `a155b6e8d5` ("create separate window for setup and then main window") addressed this.
- **Verification needed**: Confirm that an unauthenticated `/setup` request against the current desktop build no longer spawns windows.

### [#2239 — Docker Compose file needs to be updated](https://github.com/TriliumNext/Trilium/issues/2239)
- **Evidence**: `git log` shows commit `78b6614eea` "fix docker-compose.yml #2239" and `883e71612c` "Use `triliumnext/notes` as image in `docker-compose.yml`". The new compose file uses the correct image name and a persisted volume.
- **Verification needed**: Run the repo's current `docker-compose.yml` and confirm data persists in the named volume.

### [#2413 — Note map does not display inherited relations](https://github.com/TriliumNext/Trilium/issues/2413)
- **Evidence**: `apps/server/src/routes/api/note_map.ts` line 61 uses `note.getRelations()`, and `apps/server/src/becca/entities/bnote.ts` line 657 defines `getRelations()` as `getAttributes(RELATION, name)` which explicitly includes inherited attributes (the doc comment says "including inherited ones"). Only `template`/`inherit` relation names are filtered out (line 57), not the inherited relations themselves.
- **Verification needed**: Reproduce with Template + Instance, open note map on Instance, confirm the `testRelation` edge to Target now appears.

## Notable Non-Easy Issues

- [#2350 — Out of memory on large DB](https://github.com/TriliumNext/Trilium/issues/2350) — Docker OOM with a 2.7 GB document.db; needs profiling of note cache load / backup code paths.
- [#2163 — Uploading large .aac broke sync](https://github.com/TriliumNext/Trilium/issues/2163) — Large-file upload causing corrupt branch state + JS heap OOM on sync; deep investigation into sync chunking needed.
- [#2141 — Broken database causes web UI to not load](https://github.com/TriliumNext/Trilium/issues/2141) — When saved-search deletion corrupted the DB, client rendered a blank page instead of an error; needs better error boundary + recovery.
- [#2050 — content with lot of pdf attachments not sync between multi-client and server](https://github.com/TriliumNext/Trilium/issues/2050) — Sync of notes with many large attachments ends up with a crumbled tree; sync service bug.
- [#2060 — trilium-server will not sync with trilium-desktop over TLS; ERR_CERT_AUTHORITY_INVALID](https://github.com/TriliumNext/Trilium/issues/2060) — Need docs and/or a "trust this cert" option in desktop sync settings.
- [#2278 — Image on side pane unloads when switching focus to other pane](https://github.com/TriliumNext/Trilium/issues/2278) — Split-pane image widget unloads the image on focus change; type-widget lifecycle bug.
- [#2326 — Image at very top of note can't show 'Insert new line' arrow; margin issues](https://github.com/TriliumNext/Trilium/issues/2326) — CKEditor top-margin/image toolbar collision; needs CSS tweaks in the editor image plugin.
- [#1813 — Note title input on mobile (caret jumps around)](https://github.com/TriliumNext/Trilium/issues/1813) — Mobile Chrome title editing; likely a contenteditable interaction bug.
- [#1883 — Exporting HTML files in zip with special characters ISSUE](https://github.com/TriliumNext/Trilium/issues/1883) — `sanitize-filename` is used but reporter shows dataerror during decompression; may need proper UTF-8 filename encoding in zip writer (EFS flag).
- [#1877 — No distinction between undefined and false in a boolean promoted attribute](https://github.com/TriliumNext/Trilium/issues/1877) — Promoted boolean checkbox renders `valueAttr.value === "true"`, so unset looks identical to explicitly false; would need a tri-state UI.
- [#2092 — web clipper doesn't import code snippets](https://github.com/TriliumNext/Trilium/issues/2092) — Parser bug in web clipper extension.
- [#2323 — MoveTo and CloneTo should suggest destinations not sources](https://github.com/TriliumNext/Trilium/issues/2323) — Need a separate "recent destinations" tracker distinct from `note_autocomplete.triggerRecentNotes` which shows recently visited notes.
- [#2128 — Workspace name in tab title](https://github.com/TriliumNext/Trilium/issues/2128) — `tab_manager.updateDocumentTitle` / `note_context.getNavigationTitle` would need workspace (hoisted) context added.
- [#2212 — Ctrl+W on root note should close Trilium](https://github.com/TriliumNext/Trilium/issues/2212) — `removeNoteContext` explicitly short-circuits when the last tab is empty; closing Trilium itself requires electron-specific IPC.
- [#1847 — autoReadOnly delay](https://github.com/TriliumNext/Trilium/issues/1847) — Request for a delay/temporary-edit-mode shortcut; needs a design decision and option surface.

## Feature Requests

- [#2477 — Automatically delete and/or unhide unsaved notes](https://github.com/TriliumNext/Trilium/issues/2477)
- [#2473 — Show branch prefix in quick search (for protected notes)](https://github.com/TriliumNext/Trilium/issues/2473)
- [#2420 — Link between labels with date values and daily journal notes](https://github.com/TriliumNext/Trilium/issues/2420)
- [#2404 — Full-Text Search results list like Google](https://github.com/TriliumNext/Trilium/issues/2404)
- [#2391 — One-click installation on CapRover](https://github.com/TriliumNext/Trilium/issues/2391)
- [#2363 — Better support for linking notes from Mermaid diagrams](https://github.com/TriliumNext/Trilium/issues/2363)
- [#2354 — Group together pages under same path in Edited Notes](https://github.com/TriliumNext/Trilium/issues/2354)
- [#2351 — Documentation/example for mobile frontend plugin buttons](https://github.com/TriliumNext/Trilium/issues/2351)
- [#2330 — A note that collects all the unfinished todo items from other notes](https://github.com/TriliumNext/Trilium/issues/2330)
- [#2303 — Note Map Live Update](https://github.com/TriliumNext/Trilium/issues/2303)
- [#2293 — When "Including note", select which section to include based on markdown header](https://github.com/TriliumNext/Trilium/issues/2293)
- [#2281 — If note already open in another tab, switch to it](https://github.com/TriliumNext/Trilium/issues/2281)
- [#2261 — Start url for chrome/brave/edge "create shortcut" feature](https://github.com/TriliumNext/Trilium/issues/2261)
- [#2259 — VIM support (embedded nvim)](https://github.com/TriliumNext/Trilium/issues/2259)
- [#2203 — Option to not expand a subtree when opening a subnote](https://github.com/TriliumNext/Trilium/issues/2203)
- [#2186 — today, tomorrow, yesterday search terms to link to day pages](https://github.com/TriliumNext/Trilium/issues/2186)
- [#2185 — Make Alt+T in editor insert link to current day's page](https://github.com/TriliumNext/Trilium/issues/2185)
- [#2181 — Change note icon for folder note with content vs without content](https://github.com/TriliumNext/Trilium/issues/2181)
- [#2159 — jsplumb, add node groups function](https://github.com/TriliumNext/Trilium/issues/2159)
- [#2115 — Cite reference like Zettlr (BibTeX)](https://github.com/TriliumNext/Trilium/issues/2115)
- [#2064 — Improve the default layout of the link map](https://github.com/TriliumNext/Trilium/issues/2064)
- [#2053 — Allow search to search for dates in different formats](https://github.com/TriliumNext/Trilium/issues/2053)
- [#2051 — Embedding youtube/vimeo videos](https://github.com/TriliumNext/Trilium/issues/2051)
- [#1991 — Relation Constraints](https://github.com/TriliumNext/Trilium/issues/1991)
- [#1967 — Manually save note revision and add comment](https://github.com/TriliumNext/Trilium/issues/1967)
- [#1958 — Bulk note creation and linking](https://github.com/TriliumNext/Trilium/issues/1958)
- [#1950 — Attributes and searches inclusion in notes body (transclusion)](https://github.com/TriliumNext/Trilium/issues/1950)
- [#1949 — Inheritance fine control](https://github.com/TriliumNext/Trilium/issues/1949)
- [#1946 — Show attributes (relations) on link map](https://github.com/TriliumNext/Trilium/issues/1946)
- [#1927 — Note Stacking for rich navigation UX](https://github.com/TriliumNext/Trilium/issues/1927)
- [#1921 — UI improvement for dangling links](https://github.com/TriliumNext/Trilium/issues/1921)
- [#1909 — One-way asymmetric encryption of notes](https://github.com/TriliumNext/Trilium/issues/1909)
- [#1853 — Additional suggestions about Zotero integration](https://github.com/TriliumNext/Trilium/issues/1853)
- [#1850 — Collapsable bullets](https://github.com/TriliumNext/Trilium/issues/1850)
- [#1826 — Support insertDateTimeToText shortcut for labels](https://github.com/TriliumNext/Trilium/issues/1826)
- [#1772 — Change or disable ckeditor's automatic text transformation](https://github.com/TriliumNext/Trilium/issues/1772)
- [#1763 — Custom title for saved search results](https://github.com/TriliumNext/Trilium/issues/1763)

## Skipped / Unclear

- [#2455 — Various feature requests](https://github.com/TriliumNext/Trilium/issues/2455) — Meta-issue bundling multiple unrelated requests; only the new-tab focus portion is actionable as an easy fix (listed above), the rest (Tab navigation, keybinding collisions, scroll shortcuts) need separate issues.
