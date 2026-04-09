# Batch 05 — Issues #5790–#6928

## Easy-Fix Candidates

### [#6387 — Current OpenID Connect Implementation is not compatible with Authelia](https://github.com/TriliumNext/Trilium/issues/6387)
- **Problem**: `afterCallback` in `open_id.ts` blindly calls `req.oidc.user.name.toString()` / `.email.toString()`, crashing with `Cannot read properties of undefined (reading 'toString')` when the IdP (Authelia) does not return `name`/`email` in `req.oidc.user`.
- **Proposed solution**: In `apps/server/src/services/open_id.ts` lines 125–137, guard the `.toString()` calls (e.g. `req.oidc.user.name?.toString() ?? ""`) and/or call `await req.oidc.fetchUserInfo()` to populate user claims before saving. `sub` is the only reliably-present field; `name`/`email` should fall back gracefully.
- **Effort**: small
- **Confidence**: high — verified source still matches the line referenced in the issue and the null-deref still exists.

### [#6390 — `arm64` docker image does not include `wget`](https://github.com/TriliumNext/Trilium/issues/6390)
- **Problem**: Third-party tooling (Coolify) depends on `wget` being present in the docker image for healthchecks.
- **Proposed solution**: Either (a) document that Trilium healthchecks now use the bundled `docker_healthcheck.cjs` (no `wget` required at all — both `apps/server/Dockerfile` and `Dockerfile.alpine` only install `gosu`/`su-exec`), or (b) add `wget` to the apt/apk install line in `apps/server/Dockerfile` and `Dockerfile.alpine` for backwards-compat with external tooling. Option (a) is the right call; Coolify should be updated. Either way this is a 1–2 line change.
- **Effort**: trivial
- **Confidence**: medium — the fix itself is trivial but whether to actually add wget is a policy call for maintainers.

### [#5790 — Can't pull `rootless` docker tag](https://github.com/TriliumNext/Trilium/issues/5790)
- **Problem**: `docker pull triliumnext/notes:rootless` returns "manifest unknown"; the docs reference a tag that does not exist on Docker Hub (the image is now published as `triliumnext/trilium`, not `triliumnext/notes`).
- **Proposed solution**: Update the docs at `apps/server/src/assets/doc_notes/en/User Guide/User Guide/Installation & Setup/Server Installation/1. Installing the server/Using Docker.html` (and the `Using Docker.md` referenced in the issue) to use `triliumnext/trilium:rootless` (the repo was renamed from `Notes` to `Trilium` and there are now `Dockerfile.rootless` / `Dockerfile.alpine.rootless` files in `apps/server/`). Also confirm the rootless tag is actually published in the CI workflow under `.github/workflows/`.
- **Effort**: small
- **Confidence**: medium — docs fix is trivial but it may also require fixing the publish workflow if the tag is not pushed.

### [#6730 — Clear or disable search history](https://github.com/TriliumNext/Trilium/issues/6730)
- **Problem**: Jump-to-note results are cluttered with Search History entries; no way to hide/clear them.
- **Proposed solution**: The command-palette already has a "show-search-history" entry (`apps/client/src/services/command_registry.ts` line 83). The jump-to dialog at `apps/client/src/widgets/dialogs/jump_to_note.tsx` likely surfaces history as part of its result list — either add an option to filter them out or add a "Clear history" action. A quick win: add a user-option-backed toggle (e.g. `jumpToShowSearchHistory` default true) and skip search-history notes when false. New key under `apps/client/src/translations/en/translation.json`.
- **Effort**: small
- **Confidence**: medium — depends on whether jump-to currently blends history entries via a single query; needs a quick read of `jump_to_note.tsx` to confirm.

### [#6134 — The checkbox and cursor in the to-do list are too close](https://github.com/TriliumNext/Trilium/issues/6134)
- **Problem**: In todo lists, the checkbox and the caret/text sit with no visual spacing.
- **Proposed solution**: Adjust the padding/margin of `.ck-content .todo-list .todo-list__label > input` (or `.todo-list__label__description`) in `apps/client/src/stylesheets/style.css` around line 1184 — add a small `margin-inline-end` / `gap` on the label. One-line CSS tweak.
- **Effort**: trivial
- **Confidence**: medium — CSS adjust is trivial but exact value needs design call.

### [#6468 — Table function area blocks the text function area](https://github.com/TriliumNext/Trilium/issues/6468)
- **Problem**: When a CKEditor table is tall, the sticky table toolbar floats over the main text toolbar.
- **Proposed solution**: CSS tweak to give the main CKEditor toolbar a higher `z-index` than the inline table toolbar, or add a top-offset on the table toolbar so it doesn't overlap. Candidate file `apps/client/src/stylesheets/ckeditor-theme.css` (or `style.css`). Target `.ck-toolbar_floating` / `.ck.ck-balloon-panel`.
- **Effort**: small
- **Confidence**: medium — CSS z-index/offset fix is cheap but the root cause may involve CKEditor's own balloon/toolbar stacking context.

### [#6555 — Unable to set column value to zero in table view](https://github.com/TriliumNext/Trilium/issues/6555)
- **Problem**: Entering `0` in a Number column in Table view clears the label instead of saving "0".
- **Proposed solution**: In `apps/client/src/widgets/collections/table/row_editing.ts` around line 42, `newValue = cell.getValue()` returns a number. The boolean branch already stringifies, but the plain-label branch passes a number through to `setLabel`. Add `if (typeof newValue === "number") newValue = String(newValue);` before the `setLabel` call. Also verify the server-side `set-attribute` endpoint doesn't coerce `0` to empty (`apps/server/src/routes/routes.ts` handler).
- **Effort**: small
- **Confidence**: medium — client fix is 1 line, server may also need a touch.

### [#6204 — Presence of #workspaceCalendarRoot affects how notes are displayed](https://github.com/TriliumNext/Trilium/issues/6204)
- **Problem**: When a note has both `#viewType=calendar` and `#workspaceCalendarRoot`, events are forced to all-day (only `#dateNote` notes shown) and `#startTime`/`#endTime` are ignored.
- **Proposed solution**: In `apps/client/src/widgets/collections/calendar/index.tsx` (verified existing file), `isCalendarRoot = (calendarRoot || workspaceCalendarRoot)` collapses both flags into a single "date-note only" mode. The bug is the OR — workspaceCalendarRoot should NOT enable the date-note-only event builder unless the user also set `calendarRoot`. Suggest decoupling: only force date-note mode when `calendarRoot` is set, and let `workspaceCalendarRoot` simply mark the note as a workspace root without changing the event source. Single-file change.
- **Effort**: small
- **Confidence**: medium — behavioral fix clearly localized, but intent of `workspaceCalendarRoot` needs maintainer confirmation.

### [#6518 — Open child note from table view by clicking note name](https://github.com/TriliumNext/Trilium/issues/6518)
- **Problem**: Clicking a note title in the Table view starts renaming instead of opening the note.
- **Proposed solution**: In `apps/client/src/widgets/collections/table/columns.tsx` / `row_editing.ts`, change the title column so that a single click opens the note (via `appContext.tabManager.getActiveContext()?.setNote()`) and double-click (or a dedicated pencil area) starts editing. Tabulator supports this through `cellClick` + `editable` on double-click.
- **Effort**: small
- **Confidence**: medium — clearly confined to the table view module.

### [#6817 — Jump To…: Create new notes in Inbox (not as child notes)](https://github.com/TriliumNext/Trilium/issues/6817)
- **Problem**: When the Jump-to dialog creates a new note, it uses the current parent, but users expect it to land in the Inbox.
- **Proposed solution**: In `apps/client/src/widgets/dialogs/jump_to_note.tsx`, when creating a new note, resolve the inbox note (`dateNotesService.getInboxNote()` equivalent in the client — there's already an `inboxNote` helper via `#inbox` attribute lookup). Simple target-parent swap. Optionally add a setting toggle.
- **Effort**: small
- **Confidence**: medium — small code change; might want a user-setting to keep it opt-in.

## Likely Already Fixed

### [#6390 — `arm64` docker image does not include `wget`](https://github.com/TriliumNext/Trilium/issues/6390)
- **Evidence**: I read `apps/server/Dockerfile` and `Dockerfile.alpine`. Both use `HEALTHCHECK ... node /usr/src/app/docker_healthcheck.cjs` (line 28 / 26) — there is no longer any `wget`-based healthcheck. The runtime stage installs only `gosu` (Debian) or `su-exec` (Alpine). Commit `614958f16c chore(docker): reintroduce healthchecks` (Apr 2025) switched healthchecks from `wget` to a node script before this issue was filed (Jul 2025), so there is no dependency on `wget` in the current image — the issue may actually be about Coolify's external healthcheck expectations, not Trilium's image.
- **Verification needed**: Maintainer should confirm that Trilium's own image indeed no longer requires wget for healthchecks and respond to the Coolify maintainer on the upstream template; close as "not a Trilium bug" or as a docs-only fix.

## Notable Non-Easy Issues

- [#6928 — excalidraw element link can not jump to the right file](https://github.com/TriliumNext/Trilium/issues/6928) — Excalidraw element-link navigation regression; needs Excalidraw integration debugging.
- [#6927 — Multiple linked notes in table view relation column](https://github.com/TriliumNext/Trilium/issues/6927) — Table view only stores/renders the first relation; needs rethinking the relation cell editor for multi-value support.
- [#6926 — Relation map nodes/edges in random positions after reload](https://github.com/TriliumNext/Trilium/issues/6926) — Position persistence bug in relation map loader.
- [#6919 — 0.98.1 Windows OOM crash on startup](https://github.com/TriliumNext/Trilium/issues/6919) — 20 GB database triggers heap OOM; needs becca loading optimization.
- [#6853 — Aliases with `,` break label/relation definitions](https://github.com/TriliumNext/Trilium/issues/6853) — Parser/validation work in attribute-definition code; interacts with #6421.
- [#6845 — Create parent note in-place using script](https://github.com/TriliumNext/Trilium/issues/6845) — Script API / tree refresh race; needs investigation of `ensureNoteIsPresent/Absent` batching.
- [#6825 — NixOS server: port can't be configured](https://github.com/TriliumNext/Trilium/issues/6825) — Actually an upstream nixpkgs module bug (not setting `TRILIUM_PORT`); port.ts reads it correctly.
- [#6808 — Search function slow since 0.98.0](https://github.com/TriliumNext/Trilium/issues/6808) — Search perf regression on very large notes; needs profiling of `apps/server/src/services/search/`.
- [#6781 — Windows setup dialog not scrollable on error](https://github.com/TriliumNext/Trilium/issues/6781) — Setup dialog layout needs overflow handling in error state; looks small but needs to be tested against the sync-setup flow.
- [#6708 — Packaging RPMs fails with RPM 4.20+](https://github.com/TriliumNext/Trilium/issues/6708) — Upstream `electron-installer-redhat` bug; needs pnpm patch or waiting for fix.
- [#6643 — Some shortcuts not working anymore (ctrl+alt+digit)](https://github.com/TriliumNext/Trilium/issues/6643) — Global shortcut handler swallows modifier+digit combos; needs shortcut service audit.
- [#6641 — Creating a new note reopens closed tree](https://github.com/TriliumNext/Trilium/issues/6641) — Tree auto-expand on note creation; long-standing UX issue.
- [#6570 — Win client crashed with >300MB files](https://github.com/TriliumNext/Trilium/issues/6570) — Memory/file-size limit crash; needs repro + fix.
- [#6548 — Highlight list adds resident custom color](https://github.com/TriliumNext/Trilium/issues/6548) — CKEditor highlight palette state persistence bug.
- [#6474 — Tab in table view refocuses original field](https://github.com/TriliumNext/Trilium/issues/6474) — Tabulator tab-focus regression; table view.
- [#6447 — Canvas notes sometimes fail to render](https://github.com/TriliumNext/Trilium/issues/6447) — Excalidraw first-render race condition on cache miss.
- [#6413 — Checkbox Item Alignment (Div vs Span)](https://github.com/TriliumNext/Trilium/issues/6413) — CKEditor list+link html structure inconsistency; downstream CKEditor todo-list plugin.
- [#6387 → already listed above]
- [#6349 — Promoted, single date label produces multiple entries](https://github.com/TriliumNext/Trilium/issues/6349) — Fast-typing race in date input change handler (Chrome-only).
- [#6257 — "Erase notes permanently" still leaves notes in tree](https://github.com/TriliumNext/Trilium/issues/6257) — Erase/delete sync bug; needs becca/entity-change investigation.
- [#6204 → already listed above as candidate]
- [#6177 — Protected note can be moved/deleted in unprotected mode](https://github.com/TriliumNext/Trilium/issues/6177) — Security/permissions semantics; needs discussion of expected behavior and server-side checks.
- [#6153 — CKEditorError: marker-destroyed when editing with search](https://github.com/TriliumNext/Trilium/issues/6153) — CKEditor marker lifecycle bug in highlighting; upstream interaction.
- [#6129 — JavaScript heap OOM on initial sync](https://github.com/TriliumNext/Trilium/issues/6129) — Sync batching memory pressure; needs sync service work.
- [#5857 — "invalid user" on OIDC auth](https://github.com/TriliumNext/Trilium/issues/5857) — Related to #6387 family; needs better OIDC error logging and likely the same `req.oidc.user` claim fallback work.
- [#5818 — Converting attachment to note breaks links](https://github.com/TriliumNext/Trilium/issues/5818) — Link-rewrite logic missing in attachment→note conversion service.

## Feature Requests

- [#6841 — Drag note into split view](https://github.com/TriliumNext/Trilium/issues/6841)
- [#6836 — Sync: handle HTTP redirects for server instance address](https://github.com/TriliumNext/Trilium/issues/6836)
- [#6829 — Allow sorting notes by multiple attributes](https://github.com/TriliumNext/Trilium/issues/6829)
- [#6805 — Adaptive tray icon](https://github.com/TriliumNext/Trilium/issues/6805)
- [#6779 — Embedded Playbook (runnable script steps in notes)](https://github.com/TriliumNext/Trilium/issues/6779)
- [#6546 — Store file notes in the filesystem rather than the database](https://github.com/TriliumNext/Trilium/issues/6546)
- [#6421 — [wip] Attributes V2](https://github.com/TriliumNext/Trilium/issues/6421)
- [#6410 — Display the notes number in folders](https://github.com/TriliumNext/Trilium/issues/6410)
- [#6409 — Checklist progress](https://github.com/TriliumNext/Trilium/issues/6409)
- [#6407 — Kanban Board enhancements](https://github.com/TriliumNext/Trilium/issues/6407)
- [#6406 — Packaging for Chocolatey](https://github.com/TriliumNext/Trilium/issues/6406)
- [#6351 — Mount part of note tree as writable folder](https://github.com/TriliumNext/Trilium/issues/6351)
- [#6350 — Repeat-last-action shortcut (like Word F4)](https://github.com/TriliumNext/Trilium/issues/6350)
- [#6296 — Auto hide sidebar](https://github.com/TriliumNext/Trilium/issues/6296)
- [#6259 — geo-map: support ctrl+z/undo when moving a pin](https://github.com/TriliumNext/Trilium/issues/6259)
- [#6226 — Add "Clone to" to search bulk actions](https://github.com/TriliumNext/Trilium/issues/6226)
- [#6225 — Settings for displaying search results](https://github.com/TriliumNext/Trilium/issues/6225)
- [#6203 — Suppress messages on Frontend API scripts](https://github.com/TriliumNext/Trilium/issues/6203)
- [#6162 — Global Tag View](https://github.com/TriliumNext/Trilium/issues/6162)
- [#6144 — Ability to define custom styles for CKEditor](https://github.com/TriliumNext/Trilium/issues/6144)
- [#5849 — Label/tag system (macOS-style)](https://github.com/TriliumNext/Trilium/issues/5849)
- [#5827 — Replace a word/symbol with a user-defined term](https://github.com/TriliumNext/Trilium/issues/5827)
- [#5825 — Annotate image](https://github.com/TriliumNext/Trilium/issues/5825)
- [#5795 — Drop image attachments without shrinking (separate from setting)](https://github.com/TriliumNext/Trilium/issues/5795)

## Skipped / Unclear

- [#6570 — The Win client crashed.](https://github.com/TriliumNext/Trilium/issues/6570) — Reporter gave no logs, only "crashes with >300MB files"; not reproducible without more info. (Listed in Notable as well, but needs clarification before action.)
