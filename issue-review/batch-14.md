# Batch 14 — Issues #1131–#1719

## Easy-Fix Candidates

### [#1712 — [UI/Low priority] Disable "Internal trilium link (Ctrl+L)" on code-block text selection](https://github.com/TriliumNext/Trilium/issues/1712)
- **Problem**: The "Internal Trilium link" toolbar button remains enabled when text inside a code block is selected even though all other formatting buttons are disabled.
- **Proposed solution**: In the CKEditor plugin that registers the `internallink` command (search `packages/ckeditor5*` for the command), override `refresh()` to also disable the command when the selection is inside a `codeBlock` element (use `isAllowedInSelection` / `schema.checkChild` against the selection's parent). Similar pattern is used by the built-in `link` command.
- **Effort**: small
- **Confidence**: medium — requires locating the custom plugin but the fix is a one-line schema check

### [#1643 — [FEATURE] note revision preview for `Saved search` notes](https://github.com/TriliumNext/Trilium/issues/1643)
- **Problem**: Saved search notes don't have a revision preview in the revisions dialog despite being simple JSON content.
- **Proposed solution**: In `apps/client/src/widgets/dialogs/revisions.*` (or wherever revision content is rendered), add a branch that renders saved-search revision content as plain JSON/text like code notes. Likely a missing `else if (type === "search")` path.
- **Effort**: small
- **Confidence**: medium — needs code inspection to confirm the exact switch

## Likely Already Fixed

### [#1157 — Split Screen And Unlinked References](https://github.com/TriliumNext/Trilium/issues/1157)
- **Evidence**: Split view is fully implemented. `apps/client/src/widgets/containers/split_note_container.js` exists, `link_context_menu.ts` has `openNoteInNewSplit` / `openNoteInOtherSplit`, `tree_context_menu.ts` has `openNoteInSplit`, and split-pane layout is wired into `desktop_layout.tsx` and `mobile_layout.tsx`.
- **Verification needed**: Part 1 (split view) is done. Part 2 (unlinked references) is still an open feature request — maintainer should close as partial/duplicate of other unlinked-references requests in batch.

### [#1460 — [Feature request] Make use of HTML5 as audio/video embedding provider. Relies on having partial-content supported by server.](https://github.com/TriliumNext/Trilium/issues/1460)
- **Evidence**: `apps/server/src/routes/api/files.ts` implements partial-content streaming (`range`, `start/end`, comment "Partial content request"). Client-side video/audio players exist in `apps/client/src/widgets/type_widgets/file/Video.tsx` and `MediaPlayer.tsx`.
- **Verification needed**: Confirm video/audio notes can be seeked in the browser; if yes, close.

### [#1512 — Fail to define shortcut like Meta+[ or Meta+Shift+Left](https://github.com/TriliumNext/Trilium/issues/1512)
- **Evidence**: `apps/server/src/services/keyboard_actions.ts` lines 22-33 now set Mac defaults to `CommandOrControl+[` / `CommandOrControl+]` for back/forward navigation — directly the shortcut the reporter asked for. Mac-specific branch is driven by `isMac`.
- **Verification needed**: Confirm on Mac that `Meta+[` now binds; if yes, close.

### [#1544 — embedding image with url](https://github.com/TriliumNext/Trilium/issues/1544)
- **Evidence**: `packages/ckeditor5/src/plugins.ts` lines 113-119 register `Image`, `ImageUpload`, `ImageInsert` family. CKEditor's native image insert dialog accepts URLs.
- **Verification needed**: Test Insert Image via URL in the toolbar and close if works.

## Notable Non-Easy Issues
- [#1719 — FR: Hide table edges](https://github.com/TriliumNext/Trilium/issues/1719) — CSS tweak but needs UI toggle / per-table property; not trivial without CKEditor table plugin support.
- [#1698 — [UX] Always clone included images](https://github.com/TriliumNext/Trilium/issues/1698) — requires changing image-include semantics around clipper orphans; design question.
- [#1573 — Copy Paste Image results in broken image links](https://github.com/TriliumNext/Trilium/issues/1573) — clipboard image handling in CKEditor, needs investigation.
- [#1572 — Could locations of cloned notes appear in global search?](https://github.com/TriliumNext/Trilium/issues/1572) — search result display question; may already work, needs repro.
- [#1578 — Feature Request - Implement restore backup function](https://github.com/TriliumNext/Trilium/issues/1578) — would require new UI + migration path; confirmed no `restoreBackup` in `apps/server/src/services/backup.ts`.
- [#1577 — Client certificates?](https://github.com/TriliumNext/Trilium/issues/1577) — TLS mTLS support, infra-level change.
- [#1503 — Web Clipper "searching" often](https://github.com/TriliumNext/Trilium/issues/1503) — clipper discovery/heartbeat bug in `apps/web-clipper`, needs repro.
- [#1449 — Clipped a web page with YouTube linked videos - they auto-play!](https://github.com/TriliumNext/Trilium/issues/1449) — HTML sanitization of imported iframes needs `?autoplay=0` stripping.
- [#1444 — Content Security Policy directive: "img-src 'self' data:"](https://github.com/TriliumNext/Trilium/issues/1444) — CSP misconfiguration breaking external images in clipped pages.
- [#1442 — Copy paste from rich text to plain text does not retain indents](https://github.com/TriliumNext/Trilium/issues/1442) — CKEditor clipboard converter for code/plain targets.
- [#1423 — [Crash] Importing a big file](https://github.com/TriliumNext/Trilium/issues/1423) — memory/streaming issue in import, deep fix.
- [#1357 — Inserting a space after a math expression deletes it](https://github.com/TriliumNext/Trilium/issues/1357) — CKEditor math plugin (`packages/ckeditor5-math`) bug.
- [#1324 — Import of Joplin documents](https://github.com/TriliumNext/Trilium/issues/1324) — no Joplin importer exists; would need new format support.
- [#1298 — Exact search result is placed way too low in results](https://github.com/TriliumNext/Trilium/issues/1298) — jump-to-note scoring needs an exact-match boost.
- [#1284 — Picky details of new Attributes field](https://github.com/TriliumNext/Trilium/issues/1284) — multi-item autocomplete/UX polish needing rework.
- [#1166 — Context menu is not usable with keyboard](https://github.com/TriliumNext/Trilium/issues/1166) — needs full keyboard navigation for custom Preact context menu.
- [#1131 — Alt + <x> keyboard shortcuts with active editor](https://github.com/TriliumNext/Trilium/issues/1131) — CKEditor swallows Alt+char for menu access; hard to override cleanly.

## Feature Requests
- [#1716 — Generating citation from note attributes](https://github.com/TriliumNext/Trilium/issues/1716)
- [#1715 — Page up/down in note selection dialogs (Jump to note, ..)](https://github.com/TriliumNext/Trilium/issues/1715)
- [#1704 — [FEATURE REQUEST] Block reference / content embedding (Roam-style)](https://github.com/TriliumNext/Trilium/issues/1704)
- [#1697 — Populate hyperlinked md file from a table](https://github.com/TriliumNext/Trilium/issues/1697)
- [#1693 — [FEATURE] Copy/Paste Table As/From CSV](https://github.com/TriliumNext/Trilium/issues/1693)
- [#1668 — [UX FEATURE] `Search` autocompletion for labels](https://github.com/TriliumNext/Trilium/issues/1668)
- [#1654 — [IMPROVEMENT] Contextual `Similar notes` algorithm based on search string](https://github.com/TriliumNext/Trilium/issues/1654)
- [#1652 — [FEATURE] `saved search` preview with number of results](https://github.com/TriliumNext/Trilium/issues/1652)
- [#1650 — [FEATURE] Copy notes from tree and paste into relation map](https://github.com/TriliumNext/Trilium/issues/1650)
- [#1625 — Add custom MIME types for code notes](https://github.com/TriliumNext/Trilium/issues/1625)
- [#1623 — [UX] Remember default box size for included notes](https://github.com/TriliumNext/Trilium/issues/1623)
- [#1589 — Setting to reduce logging only to errors?](https://github.com/TriliumNext/Trilium/issues/1589)
- [#1585 — Default import options for drag and drop](https://github.com/TriliumNext/Trilium/issues/1585)
- [#1567 — Proof import before importing, remove special chars](https://github.com/TriliumNext/Trilium/issues/1567)
- [#1554 — image alt text in markdown export](https://github.com/TriliumNext/Trilium/issues/1554)
- [#1526 — Set a shortcut to open the link in a new window](https://github.com/TriliumNext/Trilium/issues/1526)
- [#1514 — FR: Get the link to the note from the desktop apps](https://github.com/TriliumNext/Trilium/issues/1514)
- [#1507 — "save & reset" link map arrangement & zoom level](https://github.com/TriliumNext/Trilium/issues/1507)
- [#1479 — [Apache proxy setup] Some notes on installation sequence](https://github.com/TriliumNext/Trilium/issues/1479)
- [#1426 — request: unlinked references](https://github.com/TriliumNext/Trilium/issues/1426)
- [#1386 — [Feature Request] Zotero integration](https://github.com/TriliumNext/Trilium/issues/1386)
- [#1288 — please provide the way to save picture of linkmap](https://github.com/TriliumNext/Trilium/issues/1288)
- [#1280 — Enabling custom CKEditor plugins?](https://github.com/TriliumNext/Trilium/issues/1280)
- [#1269 — Customize note title shown in tree](https://github.com/TriliumNext/Trilium/issues/1269)
- [#1267 — Make INSERT NOTE optional / configurable default type](https://github.com/TriliumNext/Trilium/issues/1267)
- [#1266 — Suggestion for Recent Changes (split into changed/deleted)](https://github.com/TriliumNext/Trilium/issues/1266)
- [#1233 — Block Reference and transclude function](https://github.com/TriliumNext/Trilium/issues/1233)
- [#1209 — Clipper for PDF files](https://github.com/TriliumNext/Trilium/issues/1209)
- [#1206 — Jump back to last edit](https://github.com/TriliumNext/Trilium/issues/1206)
- [#1193 — Sort results in Jump to note by frequency of use](https://github.com/TriliumNext/Trilium/issues/1193)
- [#1181 — Make tabs keep the scroll on the tree left panel](https://github.com/TriliumNext/Trilium/issues/1181)
- [#1170 — Disable note editing in mobile front end](https://github.com/TriliumNext/Trilium/issues/1170)
- [#1148 — include relation maps content in search results](https://github.com/TriliumNext/Trilium/issues/1148)
- [#1144 — Option to auto expand book nodes](https://github.com/TriliumNext/Trilium/issues/1144)
- [#1142 — enhance link map (TheBrain-style)](https://github.com/TriliumNext/Trilium/issues/1142)

## Skipped / Unclear
(none — all issues classified)
