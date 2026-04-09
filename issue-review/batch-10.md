# Batch 10 — Issues #3704–#4192

## Easy-Fix Candidates

### [#4051 — (Bug report) Protected notes visible in Edited Notes](https://github.com/TriliumNext/Trilium/issues/4051)
- **Problem**: The "Edited Notes" sidebar on day notes lists protected notes with their real titles even without an active protected session, leaking encrypted data.
- **Proposed solution**: In `apps/server/src/routes/api/revisions.ts` `getEditedNotesOnDate()` (around line 155-189), filter out protected notes when no protected session is active. After `let notes = becca.getNotes(...)`, add a filter using `protectedSessionService.isProtectedSessionAvailable()` (from `apps/server/src/services/protected_session.ts`) to either skip `note.isProtected` rows or replace their title/content with a placeholder, mirroring how other protected-aware endpoints behave.
- **Effort**: small
- **Confidence**: high

### [#4150 — Mobile interface, add 'move note' to note menu](https://github.com/TriliumNext/Trilium/issues/4150)
- **Problem**: The mobile burger menu previously lacked a "move note" action.
- **Proposed solution**: Likely already resolved: `apps/client/src/widgets/mobile_widgets/mobile_detail_menu.tsx` now composes the shared `NoteContextMenu` (`widgets/ribbon/NoteActions.tsx`) which already exposes move commands. A maintainer should confirm the "Move to…" entry actually appears in the mobile dropdown; if not, passing additional tree-action items into `NoteContextMenu` from `mobile_detail_menu.tsx` is a one-file change.
- **Effort**: trivial
- **Confidence**: medium

### [#3751 — (Bug report) Logging api.startNote in backend JS script crashes app](https://github.com/TriliumNext/Trilium/issues/3751)
- **Problem**: `api.log(api.startNote)` crashes the server because `ws.js` does `JSON.stringify` on an object graph containing circular refs.
- **Proposed solution**: In the log sender (grep for `JSON.stringify` in `apps/server/src/services/ws.ts` and/or the backend script api logger in `apps/server/src/services/backend_script_api.ts`), wrap `JSON.stringify` in a try/catch that falls back to a safe stringifier with a circular-reference replacer. Reporter already linked the MDN example.
- **Effort**: trivial
- **Confidence**: high

### [#4178 — api.$container is null error for statistics js script](https://github.com/TriliumNext/Trilium/issues/4178)
- **Problem**: Demo "Most edited notes" / "Most type content" scripts fail because `api.$container` is null when the script runs outside a render-widget context.
- **Proposed solution**: Likely already fixed by the widget refactor and hidden-subtree demo rework, but a maintainer should verify the demo "Statistics" scripts still exist in the built-in demo content and that they access `api.$container` only when rendered as a render note. If the demo still ships, a null-guard (`if (!api.$container) return;`) in each demo script (`apps/server/src/assets/demo/…` or wherever demo notes live) is a one-liner.
- **Effort**: trivial
- **Confidence**: low

### [#3746 — (Feature request) add "include title" option in the "include note" windows](https://github.com/TriliumNext/Trilium/issues/3746)
- **Problem**: The Include Note dialog offers only a size selector; there is no way to suppress the note title in the rendered inclusion.
- **Proposed solution**: Small scope but touches multiple layers: `apps/client/src/widgets/dialogs/include_note.tsx` to add a checkbox, `packages/ckeditor5/src/plugins/includenote.ts` to persist an `includeTitle` (or `showTitle`) attribute alongside `boxSize`, and the client-side include-note renderer in `apps/client/src/services/` (grep for `loadIncludedNote`) to skip the title when set. Still contained to a well-understood area.
- **Effort**: small
- **Confidence**: medium

## Likely Already Fixed

### [#4184 — (Bug report) Search in read-only note does not work](https://github.com/TriliumNext/Trilium/issues/4184)
- **Evidence**: `apps/client/src/widgets/find.ts` now explicitly handles `readOnlyTemporarilyDisabled` and picks `htmlHandler` vs `textHandler` based on `noteContext?.isReadOnly()` (lines 245-259). The original 2023 bug was that only the editable text handler was wired up.
- **Verification needed**: Maintainer should reproduce in a note with `#readOnly` on the latest build; if search now finds matches, close.

### [#4058 — (Bug report) API removeLabel() results in duplicated labels upon refreshing](https://github.com/TriliumNext/Trilium/issues/4058)
- **Evidence**: This was reported against `zadam/trilium` master in 2023. Label/attribute persistence went through a major rewrite in the becca entity layer since then (see `apps/server/src/becca/entities/battribute.ts` and the `PUT /api/notes/:noteId/attributes` route). The described symptom (stale attributes being re-inserted on refresh) is a classic froca-cache bug that was addressed in the subsequent cache-coherence work.
- **Verification needed**: Reproduce the exact script against current master — add/remove label via `note.removeLabel(...)` from `api.runOnBackend` and verify the label stays removed after reopening.

### [#3834 — (Bug report) chrome extension Trilium Web Clipper save whole page can not show in Trilium note](https://github.com/TriliumNext/Trilium/issues/3834)
- **Evidence**: The error trace points at obfuscated CKEditor 5 upcast conversion code that no longer matches the current CKEditor 5 + Trilium plugin set (we're on a much newer CKEditor 5 with rewritten plugins in `packages/ckeditor5/`). Web Clipper code has also been moved into `apps/web-clipper/`.
- **Verification needed**: Retest clipping the reporter's URL with current master web clipper + server.

### [#3868 — docker log show chown operation not permitted](https://github.com/TriliumNext/Trilium/issues/3868)
- **Evidence**: Docker image and its entrypoint have been significantly rewritten (see `apps/server/Dockerfile*` and `apps/server/scripts/start-docker.sh`) — the `chown` loop the reporter hit has been replaced with a conditional that respects existing ownership. The `USER_UID`/`USER_GID` flow has been re-worked to avoid `usermod` collisions.
- **Verification needed**: A maintainer should pull the latest image on an SMB/NFS share and verify it starts without chown errors.

### [#4008 — Permissions issue: Can not set UID and GID to '0'](https://github.com/TriliumNext/Trilium/issues/4008)
- **Evidence**: Same root cause as #3868 and likely addressed by the same Docker entrypoint rewrite. The `usermod: UID '0' already exists` path was conditional and has since been guarded.
- **Verification needed**: Maintainer should test `USER_UID=0 USER_GID=0` with the current Docker image.

### [#3705 — Changing the size of inclusions in a note](https://github.com/TriliumNext/Trilium/issues/3705)
- **Evidence**: Possibly already fixed — `apps/client/src/widgets/dialogs/include_note.tsx` exists and the plugin in `packages/ckeditor5/src/plugins/includenote.ts` stores `boxSize` as a model attribute (so editing is theoretically possible). Grep for a double-click or toolbar action on the `includeNote` widget to confirm there is a "change size" affordance; if none exists, this should move to Notable.
- **Verification needed**: Try inserting an Include Note, then right-click or double-click the widget in a current build to see if a size editor appears.

## Notable Non-Easy Issues

- [#4192 — Full portable mode](https://github.com/TriliumNext/Trilium/issues/4192) — Needs an Electron launcher that suppresses the console window on Windows and redirects `userData` to the exe directory; touches packaging.
- [#4175 — The application freezes when opening the backend log](https://github.com/TriliumNext/Trilium/issues/4175) — Likely a huge-log-file render-blocking issue in `BackendLog.tsx`; needs streaming/virtualization, not a one-liner.
- [#4174 — Frontend script API getActiveContextCodeEditor() times out](https://github.com/TriliumNext/Trilium/issues/4174) — Timing issue with `refreshWithNote` vs editor readiness; needs scripting-API investigation.
- [#4064 — Hovering over link inside mermaid diagram causes flicker](https://github.com/TriliumNext/Trilium/issues/4064) — Tooltip positioning/pointer-events fix on mermaid link hover; not trivial to get right cross-browser.
- [#4043 — Image goes to subnote of main after delete it](https://github.com/TriliumNext/Trilium/issues/4043) — Image-deletion / orphan-attachment behavior in text notes; needs backend+frontend coordination.
- [#4029 — Directory redirection sometimes does not lead to the specified directory](https://github.com/TriliumNext/Trilium/issues/4029) — Vague scroll/jump bug in note tree; needs reporter repro but potentially a real race.
- [#4010 — Text cursor jumps to EOF instead of next line with internal link title](https://github.com/TriliumNext/Trilium/issues/4010) — CKEditor 5 caret-navigation bug across non-editable reference widgets; upstream-ish.
- [#3919 — Internal link is not searchable in the note editor](https://github.com/TriliumNext/Trilium/issues/3919) — CKEditor Find-and-Replace over non-text reference elements.
- [#3851 — Can't drag a note to the top of the child list?](https://github.com/TriliumNext/Trilium/issues/3851) — fancytree drag target zone issue for "before first child"; needs careful tree-widget work.
- [#3823 — Word-wise matching in search](https://github.com/TriliumNext/Trilium/issues/3823) — Quoted substring search matching within words; touches `apps/server/src/services/search/` tokenizer.
- [#3789 — Task daily journal clone disappears when assigning a tag](https://github.com/TriliumNext/Trilium/issues/3789) — Task manager clone logic corner case; needs investigation in demo "Task Manager" scripts.
- [#3704 — Trilium always places the cursor at the beginning of the note](https://github.com/TriliumNext/Trilium/issues/3704) — Cursor/scroll-position persistence across note switches; meaningful UX change.

## Feature Requests

- [#4179 — Identify the current outline location](https://github.com/TriliumNext/Trilium/issues/4179)
- [#4134 — Add 'Expandable' option to Include Note feature](https://github.com/TriliumNext/Trilium/issues/4134)
- [#4124 — Labels with predefined lists](https://github.com/TriliumNext/Trilium/issues/4124)
- [#4099 — An idea for (perhaps) a better naming of note clones](https://github.com/TriliumNext/Trilium/issues/4099)
- [#4080 — Workspace Specific Launchers](https://github.com/TriliumNext/Trilium/issues/4080)
- [#4061 — Unix Days as calendar](https://github.com/TriliumNext/Trilium/issues/4061)
- [#4052 — File selecting items stored in notes?](https://github.com/TriliumNext/Trilium/issues/4052)
- [#4026 — Time attribute field](https://github.com/TriliumNext/Trilium/issues/4026)
- [#4023 — Allow launchers to pass arguments to script notes](https://github.com/TriliumNext/Trilium/issues/4023)
- [#4005 — ETAPI interface to get note content hash](https://github.com/TriliumNext/Trilium/issues/4005)
- [#4002 — Internal link inside mermaid diagram](https://github.com/TriliumNext/Trilium/issues/4002)
- [#3983 — API function to refresh search note](https://github.com/TriliumNext/Trilium/issues/3983)
- [#3978 — Login page custom background](https://github.com/TriliumNext/Trilium/issues/3978)
- [#3964 — API Method to get all notes](https://github.com/TriliumNext/Trilium/issues/3964)
- [#3958 — Allow hiding/blocking inherited attributes on template users](https://github.com/TriliumNext/Trilium/issues/3958)
- [#3913 — Allow no timeout for protected notes](https://github.com/TriliumNext/Trilium/issues/3913)
- [#3906 — Host Trilium Demo Instance](https://github.com/TriliumNext/Trilium/issues/3906)
- [#3905 — add central excalidraw library for all canvas notes](https://github.com/TriliumNext/Trilium/issues/3905)
- [#3902 — view child notes inside canvas note](https://github.com/TriliumNext/Trilium/issues/3902)
- [#3899 — Preserve selected delete/import dialog options](https://github.com/TriliumNext/Trilium/issues/3899)
- [#3885 — Fully adhere to the XDG Base Directory Specification](https://github.com/TriliumNext/Trilium/issues/3885)
- [#3878 — Sort Lines](https://github.com/TriliumNext/Trilium/issues/3878)
- [#3865 — MyScript Handwriting integration](https://github.com/TriliumNext/Trilium/issues/3865)
- [#3840 — Allow transclusion as additional note relation in the map](https://github.com/TriliumNext/Trilium/issues/3840)
- [#3825 — Office document support](https://github.com/TriliumNext/Trilium/issues/3825)
- [#3798 — Take all links referenced in child notes and create a reference page](https://github.com/TriliumNext/Trilium/issues/3798)
- [#3794 — Tiling images without resorting to tables](https://github.com/TriliumNext/Trilium/issues/3794)
- [#3785 — Standard label for opening default note](https://github.com/TriliumNext/Trilium/issues/3785)
- [#3767 — Is there a way to turn off Autoformat completely?](https://github.com/TriliumNext/Trilium/issues/3767)
- [#3761 — Template mixins: Grouped inherited promoted attributes](https://github.com/TriliumNext/Trilium/issues/3761)
- [#3743 — Minimize/close to tray icon](https://github.com/TriliumNext/Trilium/issues/3743)
- [#3729 — Keep sidebar width more consistent](https://github.com/TriliumNext/Trilium/issues/3729)
- [#3724 — Paste picture default Settings](https://github.com/TriliumNext/Trilium/issues/3724)
- [#3721 — ETAPI: Append to existing note content](https://github.com/TriliumNext/Trilium/issues/3721)
- [#3720 — Clone to today](https://github.com/TriliumNext/Trilium/issues/3720)

## Skipped / Unclear

_None — every issue in this batch is classified above._
