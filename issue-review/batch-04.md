# Batch 04 — Issues #6929–#7794

## Easy-Fix Candidates

### [#7085 — [regression] Archived notes are listed in note search/quick search](https://github.com/TriliumNext/Trilium/issues/7085)
- **Problem**: Autocomplete/quick-search returns `#archived` notes after the fuzzy-search rewrite, breaking the previous behaviour.
- **Proposed solution**: `searchNotesForAutocomplete` in `apps/server/src/services/search/services/search.ts:671` already passes `includeArchivedNotes: false`, and `parse.ts:472` wraps the expression with `PropertyComparisonExp("isarchived", "=", "false")`. However, `NoteFlatTextExp` in `apps/server/src/services/search/expressions/note_flat_text.ts` is invoked via `getFulltext` and walks `candidateNotes` without consulting `searchContext.includeArchivedNotes`; an archived candidate still produces hits because the `AndExp` short-circuit only filters *final* results through the comparison exp after paths are collected. Add an early `note.hasInheritedLabel('archived')` short-circuit at the top of the `for (const note of candidateNotes)` loop (line 102) gated on `!searchContext.includeArchivedNotes`. A matching test already exists at `search.spec.ts:696` — extend it to cover the autocomplete (flat-text) path.
- **Effort**: small
- **Confidence**: medium

### [#7396 — Duplicate a note without cloning it](https://github.com/TriliumNext/Trilium/issues/7396)
- **Problem**: User cannot find the already-existing "Duplicate subtree" action and assumes cut/paste is the only way (which clones).
- **Proposed solution**: This is a discoverability issue only — `duplicateSubtree` is already wired in `apps/client/src/menus/tree_context_menu.ts`, `apps/client/src/services/note_create.ts`, and has a keyboard shortcut. Close with a comment pointing at the existing context menu item, or (tiny improvement) ensure the label `Duplicate subtree` is in `apps/client/src/translations/en/translation.json` so it's discoverable. No code change needed.
- **Effort**: trivial
- **Confidence**: high

### [#7564 — Change the default sorting of grades to alphabetical order in Trilium](https://github.com/TriliumNext/Trilium/issues/7564)
- **Problem**: User question about how to configure multi-key sort (`#sorted=color` plus creation date), not a bug.
- **Proposed solution**: No code change — the user describes how to use existing `#sorted` attribute. Close with a pointer to `apps/server/src/assets/doc_notes/en/User Guide/.../Sorting.html`. This belongs in Discussions.
- **Effort**: trivial
- **Confidence**: high

### [#7606 — Preview of markdown](https://github.com/TriliumNext/Trilium/issues/7606)
- **Problem**: User asks where the side-by-side markdown preview is.
- **Proposed solution**: Trilium is a WYSIWYG editor — "Text" notes render rich text directly, not markdown, so there is no preview pane by design. Close with explanation or redirect to the Markdown import/export docs. No code change.
- **Effort**: trivial
- **Confidence**: high

### [#7274 — Insert internal links to notes in the canvas and mind map](https://github.com/TriliumNext/Trilium/issues/7274)
- **Problem**: User question about whether internal links can be inserted inside canvas/mind-map objects.
- **Proposed solution**: This overlaps with the long-standing limitation of Excalidraw/mind-map link handling. Likely duplicate of a canvas-link feature request. Close as duplicate / redirect to Discussions. No code change here (real implementation work lives under #7182 and related).
- **Effort**: trivial
- **Confidence**: high

### [#7072 — How to obtain recent_notes to achieve the system menu bar effect](https://github.com/TriliumNext/Trilium/issues/7072)
- **Problem**: User asks how to build a custom widget reading from `recent_notes`.
- **Proposed solution**: Support question. The `recent_notes` table is exposed via the autocomplete endpoint in `apps/server/src/routes/api/autocomplete.ts:40` and via `api.runOnBackend` scripting. Redirect to Discussions / scripting docs. No code change.
- **Effort**: trivial
- **Confidence**: high

## Likely Already Fixed

### [#6989 — New client sync issues](https://github.com/TriliumNext/Trilium/issues/6989)
- **Evidence**: Reporter is on **0.95.0** (released mid-2025) and describes websocket connection drops against a reverse proxy. The codebase has had several sync/websocket robustness fixes since 0.98. Current version is ~0.99.4.
- **Verification needed**: Ask reporter to retry on the latest version. If still reproducing, collect a fresh sync/WS log.

### [#6999 — Editing a Relation (from template) in mobile view, don't work](https://github.com/TriliumNext/Trilium/issues/6999)
- **Evidence**: Reporter is on **0.91.1**, which is extremely old relative to current mobile rework. The mobile attribute editor has been largely rewritten (`apps/client/src/widgets/attribute_widgets/*.tsx` is now React/TSX).
- **Verification needed**: Ask reporter to retry on 0.99.x; close if no repro.

### [#7393 — Note content overwritten when changing title of snippets](https://github.com/TriliumNext/Trilium/issues/7393)
- **Evidence**: Reporter is on **0.97.1**. Text snippet handling (`#textSnippet`) has been refactored since — see `apps/client/src/widgets/type_widgets/text/EditableText.tsx` and related CKEditor 5 integration. The described "flashing + content swap" while editing title suggests the old debounced save path that was rewritten around 0.99.
- **Verification needed**: Ask reporter to retry on 0.99.4 with the specific snippet-switching STR.

## Notable Non-Easy Issues
- [#7794 — OIDC Login requires multiple logins](https://github.com/TriliumNext/Trilium/issues/7794) — Likely a session-cookie race in the OIDC `afterCallback`/redirect flow in `apps/server/src/services/open_id.ts`; needs careful investigation.
- [#7692 — Windows shortcut arguments are removed](https://github.com/TriliumNext/Trilium/issues/7692) — electron-builder NSIS installer rewrites the Start Menu shortcut on update, dropping user-added CLI args (e.g. `--ignore-certificate-errors`); requires installer config or post-install preservation logic.
- [#7690 — 2nd desktop client install fails](https://github.com/TriliumNext/Trilium/issues/7690) — Second Trilium desktop install can push but not receive sync; needs reproduction with sync-server logs.
- [#7683 — Calendar Note Doesn't Respect #titleTemplate](https://github.com/TriliumNext/Trilium/issues/7683) — Calendar-view "add note on day click" creates the note via a code path that bypasses the `#titleTemplate` resolution in `notes.ts`; fixable but needs route tracing.
- [#7662 — Full search only showing promoted attributes and missing highlighting](https://github.com/TriliumNext/Trilium/issues/7662) — Search-result renderer in `apps/server/src/services/search/services/search.ts` (`extractAttributeSnippet`) has different behaviour from quick-search; needs a pass to unify.
- [#7641 — Cloned collection generates wrong links for left menu when >2 clones](https://github.com/TriliumNext/Trilium/issues/7641) — Share view picks wrong `notePath` when a branch is cloned 3+ times; lives in `apps/server/src/share/` path resolution.
- [#7405 — Clicking on code box blanks the document](https://github.com/TriliumNext/Trilium/issues/7405) — CKEditor 5 code-block interaction bug with data loss; needs upstream/plugin debugging.
- [#7389 — Child Note Node not placeable on Relation Note](https://github.com/TriliumNext/Trilium/issues/7389) — Hardware-acceleration/Electron hit-testing bug on relation map; reporter worked around with SW rendering.
- [#7373 — Typing slows down to unusable](https://github.com/TriliumNext/Trilium/issues/7373) — CKEditor/Electron performance regression; user has already moved on, hard to repro without data.
- [#7293 — Failed to delete notes when permanently deleting multi notes with children](https://github.com/TriliumNext/Trilium/issues/7293) — Race condition in bulk permanent-delete; related to #7288.
- [#7288 — Ghost note remains when moving multiple notes into a newly created note](https://github.com/TriliumNext/Trilium/issues/7288) — Tree view doesn't refresh "isFolder" when target transitions from leaf to folder mid-move.
- [#7266 — Mind-map sub-node background cannot be reset to transparent](https://github.com/TriliumNext/Trilium/issues/7266) — Upstream mind-map component limitation; needs fork or PR to `@mind-elixir/...`.
- [#7263 — Trilium randomly jumps to Today Date](https://github.com/TriliumNext/Trilium/issues/7263) — Some scheduler/calendar widget refresh navigates to day note unexpectedly.
- [#7258 — Open Note Custom fails on Linux due to mimeopen race](https://github.com/TriliumNext/Trilium/issues/7258) — `openCustom` implementation in client needs to wait for terminal-launched mimeopen; Linux-specific.
- [#7250 — OIDC credentials are not checked for identity match](https://github.com/TriliumNext/Trilium/issues/7250) — Real security bug: `afterCallback` at `apps/server/src/services/open_id.ts:125` doesn't compare `req.oidc.user.sub` against the stored user before granting access. Fix requires adding a compare + error path.
- [#7225 — Sync blocks UI during content hashing for large knowledge graphs](https://github.com/TriliumNext/Trilium/issues/7225) — Needs worker threads / parallelization, as the reporter researched.
- [#7211 — Note content deleted after altering math equation size](https://github.com/TriliumNext/Trilium/issues/7211) — CKEditor math plugin bug with data loss; needs plugin-level fix in `packages/ckeditor5-math`.
- [#7182 — Drag notes from tree to Canvas](https://github.com/TriliumNext/Trilium/issues/7182) — Canvas drop handler doesn't accept tree drags; needs Excalidraw drop integration.
- [#7148 — CTRL Z with two Canvas notes will delete previous drawing](https://github.com/TriliumNext/Trilium/issues/7148) — Canvas undo history is global instead of per-note, causing cross-contamination between canvas notes.
- [#7116 — Mobile Webapp: Text Notes Bullet List Issue](https://github.com/TriliumNext/Trilium/issues/7116) — CKEditor mobile touch-selection bug; reporter on iOS.
- [#7466 — Text editing bar appears blank after returning from attachment](https://github.com/TriliumNext/Trilium/issues/7466) — Editor toolbar not re-initialised on return navigation from attachment view.
- [#7517 — Wrong notification bar color in PWA](https://github.com/TriliumNext/Trilium/issues/7517) — `#initPWATopbarColor` in `apps/client/src/widgets/containers/root_container.ts:148` reads `#background-color-tracker` color, but `.css("color")` runs before theme variables apply on first load; needs ordering/observer fix.
- [#7468 — Display issue with app folders on macOS Launchpad](https://github.com/TriliumNext/Trilium/issues/7468) — macOS Launchpad icon caching; probably requires an `.icns` with additional sizes.
- [#6993 — Protected notes can be read back from the database file](https://github.com/TriliumNext/Trilium/issues/6993) — Security-sensitive; SQLite WAL and old revisions may retain plaintext after protecting a note.
- [#6929 — Partially typed name being used as relation](https://github.com/TriliumNext/Trilium/issues/6929) — Autocomplete in relation-map doesn't commit the highlighted suggestion before enter; needs a fix in relation name input handling.

## Feature Requests
- [#7670 — Attachment link customization](https://github.com/TriliumNext/Trilium/issues/7670)
- [#7666 — Allow adjustable widths for Content and TOC panes in Share view](https://github.com/TriliumNext/Trilium/issues/7666)
- [#7646 — Add a setting to switch to 24-hours clock](https://github.com/TriliumNext/Trilium/issues/7646)
- [#7636 — Documents about scripting may need an update](https://github.com/TriliumNext/Trilium/issues/7636)
- [#7635 — Option to use background images in presentations](https://github.com/TriliumNext/Trilium/issues/7635)
- [#7607 — Add API support to check and switch to an already opened note tab](https://github.com/TriliumNext/Trilium/issues/7607)
- [#7541 — Merging TOC and Highlights List](https://github.com/TriliumNext/Trilium/issues/7541)
- [#7447 — Milestone: Official mobile application](https://github.com/TriliumNext/Trilium/issues/7447)
- [#7411 — Better encryption algorithms](https://github.com/TriliumNext/Trilium/issues/7411)
- [#7410 — Feature request: ability to reorder sections in the Table of Contents](https://github.com/TriliumNext/Trilium/issues/7410)
- [#7403 — Option to disable fancy font ligatures](https://github.com/TriliumNext/Trilium/issues/7403)
- [#7313 — Option to remove demo data when creating new instance](https://github.com/TriliumNext/Trilium/issues/7313)
- [#7291 — Calendar view adds support for Resource Timeline](https://github.com/TriliumNext/Trilium/issues/7291)
- [#7279 — Implement Sticky tree view headers as a native feature](https://github.com/TriliumNext/Trilium/issues/7279)
- [#7224 — Quick Notes from Everywhere using a Creation Window](https://github.com/TriliumNext/Trilium/issues/7224)
- [#7217 — Allow opening note directly instead of quick edit in collections](https://github.com/TriliumNext/Trilium/issues/7217)
- [#7198 — Code Editor Indent wrapping](https://github.com/TriliumNext/Trilium/issues/7198)
- [#7127 — OpenID auto redirect](https://github.com/TriliumNext/Trilium/issues/7127)
- [#7113 — Use dateTime attribute for calendar child notes](https://github.com/TriliumNext/Trilium/issues/7113)
- [#7024 — Where is my clone note?: An easy way to find clone note](https://github.com/TriliumNext/Trilium/issues/7024)
- [#7006 — Hope to add protect single note frontApi](https://github.com/TriliumNext/Trilium/issues/7006)
- [#7001 — Logout Feature in the Desktop Version of Trilium Next](https://github.com/TriliumNext/Trilium/issues/7001)
- [#6991 — Search: Add Search Ranking Customizability](https://github.com/TriliumNext/Trilium/issues/6991)
- [#6962 — Prioritize Running Sync When Coming Back Online](https://github.com/TriliumNext/Trilium/issues/6962)

## Skipped / Unclear
_(none — all issues in the batch are categorised above)_
