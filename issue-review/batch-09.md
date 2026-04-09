# Batch 09 — Issues #4194–#4837

## Easy-Fix Candidates

### [#4584 — (Feature Request) Hide hidden notes from `similar notes` view](https://github.com/TriliumNext/Trilium/issues/4584)
- **Problem**: Similar-notes results include notes living inside the `_hidden` subtree (templates, system notes, launchers), polluting the list.
- **Proposed solution**: In `apps/server/src/becca/similarity.ts` around line 411 (`for (const candidateNote of Object.values(becca.notes))`), skip candidates where `candidateNote.isHiddenCompletely()` is true. The helper already exists on `BNote` (`apps/server/src/becca/entities/bnote.ts:1203`), so this is a one-liner guard.
- **Effort**: trivial
- **Confidence**: high

### [#4780 — (Feature request) Change Icon for Jump to Note](https://github.com/TriliumNext/Trilium/issues/4780)
- **Problem**: The Jump-to-Note launcher icon is `bx bx-send` (a paper-airplane/send icon), which suggests sending instead of navigating.
- **Proposed solution**: Change `icon: "bx bx-send"` to a navigation-style icon (e.g. `"bx bx-navigation"`, `"bx bx-log-in"`, `"bx bx-crosshair"`) in `apps/server/src/services/hidden_subtree_launcherbar.ts` at lines 105 and the second occurrence near line 194. Existing installations should pick up the change because launcher bar items are created via `HiddenSubtreeItem`; since the icon is stored as an attribute, add `enforceAttributes: true` to that entry if the icon should override user customisations.
- **Effort**: trivial
- **Confidence**: high (trivial to change; needs confirmation of the enforcement behaviour)

### [#4543 — (Bug report) Orphaned keyboardShortcuts* options after upgrade](https://github.com/TriliumNext/Trilium/issues/4543)
- **Problem**: Users upgraded from 0.59.x have stale `keyboardShortcutsShowNoteRevisions` and `keyboardShortcutsForceSaveNoteRevision` option rows that produce “Keyboard action … found in database, but not in action definition.” warnings on every startup. The active action names are `showRevisions` / `forceSaveRevision` (`apps/server/src/services/keyboard_actions.ts:449,825`).
- **Proposed solution**: Add a small migration under `apps/server/src/migrations/` that deletes the two orphaned options: `DELETE FROM options WHERE name IN ('keyboardShortcutsShowNoteRevisions','keyboardShortcutsForceSaveNoteRevision')`. Follow the pattern of existing migrations and register it in `apps/server/src/migrations/migrations.ts`.
- **Effort**: trivial
- **Confidence**: high

## Likely Already Fixed

### [#4649 — (Bug report) Importing large ZIP-Files via etapi throws error and request hangs](https://github.com/TriliumNext/Trilium/issues/4649)
- **Evidence**: The reported root cause was that `req.body` was undefined/unparsed on the `/etapi/notes/:noteId/import` POST. `apps/server/src/app.ts:94` now registers `express.raw({ limit: "500mb" })` globally, and `apps/server/src/etapi/notes.ts:180-190` still passes `req.body` straight to `zipImportService.importZip` — the raw buffer path now exists. Issue predates the monorepo restructure.
- **Verification needed**: Reproduce the original Python import with a large zip against current main; verify `Content-Type: application/zip` is handled (Express `raw()` defaults to `application/octet-stream`, so users may need the right Content-Type or an explicit type in the raw handler).

### [#4261 — (Feature request) Make apps logs saving optional](https://github.com/TriliumNext/Trilium/issues/4261)
- **Evidence**: Log retention is now configurable via `config.Logging.retentionDays` (`apps/server/src/services/log.ts:36-42`) with `-1` keeping all logs and positive values deleting older files. While fully disabling file logging isn’t wired up, the disk-space concern is mitigated by retention config.
- **Verification needed**: Maintainer to decide whether the feature is satisfied by retention config or still needs an explicit “disable file logs” switch.

## Notable Non-Easy Issues
- [#4835 — Links don't open when clicked on](https://github.com/TriliumNext/Trilium/issues/4835) — CKEditor image-style-configuration error + ResizeObserver loop; likely downstream CKEditor config bug needing investigation in the current editor pipeline.
- [#4702 — "Add to homescreen" sets wrong url under reverse proxy sub-directory](https://github.com/TriliumNext/Trilium/issues/4702) — `manifest.webmanifest` is a static file with hardcoded `"scope":"/"` and `"start_url":"/"` (`apps/client/src/assets/manifest.webmanifest`); needs dynamic generation based on `X-Forwarded-Prefix`/proxy prefix.
- [#4762 — ERROR when syncing deleted notes](https://github.com/TriliumNext/Trilium/issues/4762) — Stale blob reference for deleted note; deletion sync logic bug needing deep investigation.
- [#4666 — Excalidraw changes fonts](https://github.com/TriliumNext/Trilium/issues/4666) — Excalidraw hand-drawn font inconsistency on re-render; needs canvas note type investigation.
- [#4657 — Backup database exposes protected notes](https://github.com/TriliumNext/Trilium/issues/4657) — Security bug: protected content leaks into backup; needs careful investigation of protect/encrypt-on-backup flow.
- [#4650 — All notes blank after opening pdf attachment a few times](https://github.com/TriliumNext/Trilium/issues/4650) — CKEditor error “Cannot read properties of null (reading 'parent')”; attachment-related editor crash.
- [#4598 — ck-block-toolbar-button display issue when adjusting tree pane](https://github.com/TriliumNext/Trilium/issues/4598) — CKEditor toolbar positioning bug tied to layout resize events.
- [#4576 — Avoid CPU usage spikes from healthcheck script](https://github.com/TriliumNext/Trilium/issues/4576) — Docker healthcheck spawns node every 30s (`apps/server/src/docker_healthcheck.ts` + Dockerfiles); needs lightweight alternative (wget/curl, or embedded check).
- [#4562 — Attachment links not working as expected (web vs desktop)](https://github.com/TriliumNext/Trilium/issues/4562) — Clipboard API behavior inconsistency between Electron and web clients.
- [#4555 — Formatting of imported .enex note lost on edit](https://github.com/TriliumNext/Trilium/issues/4555) — CKEditor drops style attributes on first edit of Evernote-imported HTML; normalisation pipeline bug.
- [#4536 — "include note" not displayed in sharing](https://github.com/TriliumNext/Trilium/issues/4536) — Shared view (Shaca) doesn't render included-note widgets; share renderer fix.
- [#4463 — Unexpected data loss after app restart and backup restoration](https://github.com/TriliumNext/Trilium/issues/4463) — Unclear reproduction; needs diagnosis of long-uptime data persistence.
- [#4690 — search highlights not performing correct scroll-to-term](https://github.com/TriliumNext/Trilium/issues/4690) — Scroll-into-view after search hit opens; read-only-mode code path likely missing scroll.
- [#4394 — mobile: editing notes offline covers screen in errors](https://github.com/TriliumNext/Trilium/issues/4394) — Needs global offline/connection-lost indicator instead of per-request toasts.
- [#4392 — mobile: toggling checkboxes opens keyboard](https://github.com/TriliumNext/Trilium/issues/4392) — Checkbox tap focuses text editor on mobile; CKEditor focus management issue.
- [#4389 — Sync error between docker and Windows 0.61.12](https://github.com/TriliumNext/Trilium/issues/4389) — Version mismatch/sync bug from 2023; likely obsolete but needs reporter retest.
- [#4254 — Portrait images rotated by 90° after import](https://github.com/TriliumNext/Trilium/issues/4254) — EXIF orientation not honoured on image import/resize pipeline.
- [#4221 — SVG zooming regression in 0.61](https://github.com/TriliumNext/Trilium/issues/4221) — SVG viewer dropped zoom handling after 0.59 → 0.61 upgrade.
- [#4194 — "Open externally" doesn't work in Flatpak](https://github.com/TriliumNext/Trilium/issues/4194) — Flatpak sandbox TMPDIR scoping; requires Flathub manifest `finish-args` fix rather than codebase change.

## Feature Requests
- [#4837 — Cloud Deployment](https://github.com/TriliumNext/Trilium/issues/4837)
- [#4834 — Import PDF files into Canvas notes](https://github.com/TriliumNext/Trilium/issues/4834)
- [#4832 — Tag-based note connections for Note Map](https://github.com/TriliumNext/Trilium/issues/4832)
- [#4818 — Set zip import options via API](https://github.com/TriliumNext/Trilium/issues/4818)
- [#4816 — Public link with search for entire tree](https://github.com/TriliumNext/Trilium/issues/4816)
- [#4813 — Sticky horizontal scrollbar for long tables](https://github.com/TriliumNext/Trilium/issues/4813)
- [#4811 — Attribute to change document link behaviour (target=_self)](https://github.com/TriliumNext/Trilium/issues/4811)
- [#4755 — Enable trilium iframe compatibility](https://github.com/TriliumNext/Trilium/issues/4755)
- [#4732 — Flathub Verification](https://github.com/TriliumNext/Trilium/issues/4732)
- [#4701 — LanguageTool integration](https://github.com/TriliumNext/Trilium/issues/4701)
- [#4691 — Context-Menu Option: "Add backlink to"](https://github.com/TriliumNext/Trilium/issues/4691)
- [#4669 — Printed font size configuration](https://github.com/TriliumNext/Trilium/issues/4669)
- [#4668 — Create clone target location when it doesn't exist](https://github.com/TriliumNext/Trilium/issues/4668)
- [#4651 — Allow embedding webviews into text notes](https://github.com/TriliumNext/Trilium/issues/4651)
- [#4612 — Authorization (Basic/Bearer) for /sync endpoints](https://github.com/TriliumNext/Trilium/issues/4612)
- [#4606 — Full-text search via SQLite FTS for relevance sorting](https://github.com/TriliumNext/Trilium/issues/4606)
- [#4498 — Bulk convert images to attachments](https://github.com/TriliumNext/Trilium/issues/4498)
- [#4468 — Toggle for promoted attributes on mobile](https://github.com/TriliumNext/Trilium/issues/4468)
- [#4439 — In-app update mechanism](https://github.com/TriliumNext/Trilium/issues/4439)
- [#4405 — Vim keybindings: yank/paste system clipboard](https://github.com/TriliumNext/Trilium/issues/4405)
- [#4396 — Ordering of templates (templates at top of menu)](https://github.com/TriliumNext/Trilium/issues/4396)
- [#4395 — Autocomplete dialog support via scripting API](https://github.com/TriliumNext/Trilium/issues/4395)
- [#4384 — Display attachments (PDF, video) directly inside notes](https://github.com/TriliumNext/Trilium/issues/4384)
- [#4375 — Allow user-selectable data location](https://github.com/TriliumNext/Trilium/issues/4375)
- [#4366 — Static log file name for trilium server (log rotation)](https://github.com/TriliumNext/Trilium/issues/4366)
- [#4354 — Cursor always positioned in center of screen (typewriter mode)](https://github.com/TriliumNext/Trilium/issues/4354)
- [#4353 — Prevent autocorrecting `...`/`--`/`->` to symbols](https://github.com/TriliumNext/Trilium/issues/4353)
- [#4345 — Sync API support for ETAPI](https://github.com/TriliumNext/Trilium/issues/4345)
- [#4305 — Encrypted/protected attributes](https://github.com/TriliumNext/Trilium/issues/4305)
- [#4299 — Expose protectedSessionService to frontend script API](https://github.com/TriliumNext/Trilium/issues/4299)
- [#4296 — Remember last scroll position in a note](https://github.com/TriliumNext/Trilium/issues/4296)
- [#4242 — Subscript/superscript keyboard shortcuts](https://github.com/TriliumNext/Trilium/issues/4242)
- [#4203 — Export subtree as single MD with nested headings](https://github.com/TriliumNext/Trilium/issues/4203)
- [#4199 — Modify note creation/modification times via API](https://github.com/TriliumNext/Trilium/issues/4199)

## Skipped / Unclear
(none — every issue in the batch has been categorized above.)
