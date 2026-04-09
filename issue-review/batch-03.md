# Batch 03 — Issues #7827–#8314

## Easy-Fix Candidates

### [#8230 — Demo spacing and formatting issues](https://github.com/TriliumNext/Trilium/issues/8230)
- **Problem**: `apps/edit-docs/demo/root/Trilium Demo.html` line 78 has "code blocks</a>and" (missing space before "and"), a comma trapped inside the `<a>` for "checkbox lists,", and could use a serial comma.
- **Proposed solution**: Edit `apps/edit-docs/demo/root/Trilium Demo.html` around line 78: move the `,` out of the `checkbox lists` anchor, add a space before `and`, and optionally add a serial comma before the final list item. Note: this file is authored via `pnpm run edit-docs` and the demo/demo.zip artifact may also need regeneration.
- **Effort**: trivial
- **Confidence**: high

### [#8045 — Mac Client setup doesn't support trailing slash](https://github.com/TriliumNext/Trilium/issues/8045)
- **Problem**: The sync-from-server setup form passes `syncServerHost` verbatim, so a trailing slash produces `http://host:port//api/...` URLs.
- **Proposed solution**: In `apps/client/src/setup.ts` around line 102, strip trailing slashes: `const syncServerHost = this.syncServerHostInput.value.trim().replace(/\/+$/, "");`. The setup modal is small enough that this single change covers it.
- **Effort**: trivial
- **Confidence**: high

### [#8188 — Displaying note icon when creating an inline note link, using @](https://github.com/TriliumNext/Trilium/issues/8188)
- **Problem**: The `@`-mention feed in CKEditor renders only the highlighted title, no icon, while other autocomplete surfaces show icons. The backend (`apps/server/src/routes/api/autocomplete.ts:70`) already returns `icon`, but it is dropped before reaching the itemRenderer.
- **Proposed solution**:
  1. In `apps/client/src/services/note_autocomplete.ts` `autocompleteSourceForCKEditor` (around lines 63–72), include `icon: row.icon` in the mapped object.
  2. In `apps/client/src/widgets/type_widgets/text/config.ts` around lines 184–190, prepend an `<span class="bx ...">` using the item's icon inside the generated button.
- **Effort**: small
- **Confidence**: high

### [#7884 — Remove `docker-compose.rootless.yaml`, as it is deprecated](https://github.com/TriliumNext/Trilium/issues/7884)
- **Problem**: The reporter wants the now-deprecated `docker-compose.rootless.yml` file removed. A `Glob` for `docker-compose.rootless*` at repo root returns nothing, so the file is already gone, but the issue remains open and references to it in docs (if any) should be scrubbed.
- **Proposed solution**: Verify no docs still link to `docker-compose.rootless.yml` (quick Grep), then close the issue as already addressed. If any lingering references exist, remove them.
- **Effort**: trivial
- **Confidence**: high

### [#7942 — "Open Command Palette" shortcut opens with the '>' symbol highlighted](https://github.com/TriliumNext/Trilium/issues/7942)
- **Problem**: `apps/client/src/widgets/dialogs/jump_to_note.tsx` unconditionally calls `.trigger("select")` in `onShown` (line 85), which highlights the entire input — including the `>` prefix — so the first keystroke wipes out the command-mode marker.
- **Proposed solution**: When `mode === "commands"`, instead of selecting all text, place the caret at the end. For example, grab the underlying input and call `setSelectionRange(len, len)` on it; keep `.trigger("select")` for the other modes. Single-file change in `jump_to_note.tsx`.
- **Effort**: small
- **Confidence**: medium (needs quick confirm that the autocomplete input is a normal `<input>`)

## Likely Already Fixed

### [#8060 — fix(search): Canvas notes with empty or missing elements cause quick search to crash](https://github.com/TriliumNext/Trilium/issues/8060)
- **Evidence**: `git log -S "Array.isArray(elements)"` shows commit `ecb972c71c fix(search): add null check for canvas elements in fulltext search`. The canvas handling has since moved to `apps/server/src/services/search/expressions/note_content_fulltext_preprocessor.ts` where `processCanvasContent` (lines 83–108) now guards with `if (Array.isArray(elements))` and returns `""` otherwise — exactly the fix proposed in the issue.
- **Verification needed**: Confirm with the reporter on a current nightly and close.

### [#7884 — Remove `docker-compose.rootless.yaml`](https://github.com/TriliumNext/Trilium/issues/7884)
- **Evidence**: `Glob "docker-compose.rootless*"` at repo root returns no files; the file has been removed.
- **Verification needed**: Grep any docs for dangling mentions of `docker-compose.rootless` and close. (Also listed under easy-fix in case any lingering references need cleanup.)

## Notable Non-Easy Issues

- [#8314 — Scissor "Cut & Paste Selection to Sub-note" does not transfer image attachments](https://github.com/TriliumNext/Trilium/issues/8314) — Attachment ownership needs to be moved when the scissor CKEditor plugin creates a new note; requires reworking the plugin's content-handoff to also reassign image attachment ownership on the server side.
- [#8282 — text editor crashed](https://github.com/TriliumNext/Trilium/issues/8282) — CKEditor `view-position-after-root` error during note creation; likely an upstream CKEditor selection race, needs reproducer.
- [#8280 — Error dragging note content to the title](https://github.com/TriliumNext/Trilium/issues/8280) — Regression in drag-to-title behaviour in 0.101.1; requires reproducing and tracing the drag handler.
- [#8272 — Desktop Sync has no 2FA](https://github.com/TriliumNext/Trilium/issues/8272) — Requires non-trivial auth-flow work (sync API doesn't currently participate in TOTP).
- [#8261 — fix docker backup path](https://github.com/TriliumNext/Trilium/issues/8261) — The backup path shown in the UI is hard-coded to a default; making it reflect the actual compose mount is non-trivial since the backend only sees paths inside the container.
- [#8216 — Docker installation, IPv4 accessible but IPv6 not](https://github.com/TriliumNext/Trilium/issues/8216) — Likely needs to bind to `::` or handle dual-stack explicitly; needs triage to determine whether it's a Docker networking issue or Trilium's listen config.
- [#8215 — Sync icon does not change when editing notes](https://github.com/TriliumNext/Trilium/issues/8215) — `SyncStatus.tsx` still overlays a `bxs-star` on `connected-with-changes`, but the visual change may have become too subtle vs the old asterisk; needs UX call, not a one-liner.
- [#8209 — Allow disabling app access when using TOTP](https://github.com/TriliumNext/Trilium/issues/8209) — Needs a new "enforce TOTP on all logins" server option and wiring through sync/desktop login flows.
- [#8199 — Use desktop without password](https://github.com/TriliumNext/Trilium/issues/8199) — Desktop currently mandates a password for the local store; loosening this is an architecture decision.
- [#8195 — Promoted attributes aren't aligned when using custom or legacy themes](https://github.com/TriliumNext/Trilium/issues/8195) — Layout regression driven by multiple theme CSS files (`PromotedAttributes.css`, theme-next, theme-next-light/dark); requires theme-aware audit.
- [#8181 — Widget migration guide](https://github.com/TriliumNext/Trilium/issues/8181) — Documentation task to help users migrate custom widgets to the new layout; not an easy one-liner because real code examples need to be updated.
- [#8178 — Layout issue of a sharing page — lack of responsiveness](https://github.com/TriliumNext/Trilium/issues/8178) — Needs responsive CSS work on the share template.
- [#8169 — noteId is not validated when forced, leading to broken note links](https://github.com/TriliumNext/Trilium/issues/8169) — `createNewNote` in `apps/server/src/services/notes.ts:214` accepts any `params.noteId` without validating against the `[_a-z0-9]{4,}` pattern required by `apps/client/src/services/link.ts:259`. Fix is conceptually simple (add server-side validation against the same regex) but risks breaking existing sync clusters with already-imported dashed IDs; needs careful handling.
- [#8097 — Print to PDF not using printCss correctly](https://github.com/TriliumNext/Trilium/issues/8097) — Electron PDF export doesn't load #printCss fonts; needs investigation of the print pipeline.
- [#8094 — automatic -- to – conversion happens inside inline code blocks](https://github.com/TriliumNext/Trilium/issues/8094) — CKEditor TextTransformation plugin should be scoped to exclude `$text` inside code spans; non-trivial CKEditor config.
- [#8092 — WebView notes have very limited Iframe options](https://github.com/TriliumNext/Trilium/issues/8092) — Requires rearchitecting the WebView widget to use Electron `<webview>` / proper sandbox flags depending on platform.
- [#8089 — JS Error: Uncaught error — `(new Set()).intersection is not a function`](https://github.com/TriliumNext/Trilium/issues/8089) — Polyfill/browser-compat issue (Set.prototype.intersection is newer); needs a polyfill or refactor.
- [#8079 — Pasting a reply from Gemini loses code-box content](https://github.com/TriliumNext/Trilium/issues/8079) — Upstream CKEditor clipboard-handling bug with Gemini's copied HTML; needs reproducer.
- [#8013 — Frontend & Backend Intellisense](https://github.com/TriliumNext/Trilium/issues/8013) — Large feature: generate TypeScript `.d.ts` for the scripting APIs and feed CodeMirror.
- [#8008 — [Linux] Cannot install Unity Engine after installing Trilium (build-id conflict)](https://github.com/TriliumNext/Trilium/issues/8008) — Fix requires `%define _build_id_links none` in the RPM spec (package-build level change).
- [#8001 — Colors using hex codes](https://github.com/TriliumNext/Trilium/issues/8001) — Color attribute is now stored as hex, breaking searches against old named colors; needs a migration or compatibility layer.
- [#7999 — Confirm button in LaTeX formula editor doesn't work](https://github.com/TriliumNext/Trilium/issues/7999) — Dialog "OK" click is not firing; needs reproducer inside `packages/ckeditor5-math/src/ui/mathinputview.ts`.
- [#7996 — Typing quickly after Ctrl+L causes search text to be added to note](https://github.com/TriliumNext/Trilium/issues/7996) — Input race during dialog animation; needs either input suppression during transition or eager focus handoff in the add-link dialog.
- [#7964 — Collections Table View: multi-value labels don't display as columns](https://github.com/TriliumNext/Trilium/issues/7964) — Table view column generator excludes multi-value labels; requires rework of the column builder.
- [#7944 — Calendar displaying deep child notes](https://github.com/TriliumNext/Trilium/issues/7944) — Either documentation is wrong or the calendar collector is recursing further than intended; needs investigation.
- [#7901 — Nov 30 nightly: Sub pages are not displayed anymore](https://github.com/TriliumNext/Trilium/issues/7901) — Regression in the "children overview" cards on Doc/Book notes, introduced around the new layout; needs bisection.
- [#7892 — CKEditor enforces non-breaking space after footnotes](https://github.com/TriliumNext/Trilium/issues/7892) — `&nbsp;` insertion isn't coming from the Trilium footnotes package (no `nbsp` occurrences in `packages/ckeditor5-footnotes/src`); requires tracing through CKEditor's GHS/schema handling.
- [#7869 — Docker deployment "Share root not found" prompt](https://github.com/TriliumNext/Trilium/issues/7869) — UX improvement for share-root unreachable state; requires changes to the share middleware error page, not just a string tweak.

## Feature Requests

- [#8281 — Search history](https://github.com/TriliumNext/Trilium/issues/8281)
- [#8260 — Improve Note Drag & Drop Functionality](https://github.com/TriliumNext/Trilium/issues/8260)
- [#8228 — Make Github releases immutable](https://github.com/TriliumNext/Trilium/issues/8228)
- [#8225 — Offline mode for the PWA](https://github.com/TriliumNext/Trilium/issues/8225)
- [#8219 — [Feature Request] Custom Icon Support (Upload/Delete Beyond Default Icons)](https://github.com/TriliumNext/Trilium/issues/8219)
- [#8187 — Search for new relation in promoted attributes does not suggest to create it](https://github.com/TriliumNext/Trilium/issues/8187)
- [#8174 — Add the "Distribute Columns" feature to the table](https://github.com/TriliumNext/Trilium/issues/8174)
- [#8158 — Split lines into paragraphs](https://github.com/TriliumNext/Trilium/issues/8158)
- [#8150 — Note header image](https://github.com/TriliumNext/Trilium/issues/8150)
- [#8140 — "shareExternalLink"-type label for PDF generation](https://github.com/TriliumNext/Trilium/issues/8140)
- [#8122 — [REQUEST] continue updating on chocolatey repository](https://github.com/TriliumNext/Trilium/issues/8122)
- [#8121 — Checking for dead links](https://github.com/TriliumNext/Trilium/issues/8121)
- [#8107 — Can I support Markdown syntax (mindmap extension syntax)](https://github.com/TriliumNext/Trilium/issues/8107)
- [#8098 — Make clicking a month name in Year view open that month's view](https://github.com/TriliumNext/Trilium/issues/8098)
- [#7940 — Input Box Optimization: Add a Clear Button](https://github.com/TriliumNext/Trilium/issues/7940)
- [#7931 — Inline Mermaid Diagram Display](https://github.com/TriliumNext/Trilium/issues/7931)
- [#7927 — Kanban: (Option to) Display the first ~line of note content for each item](https://github.com/TriliumNext/Trilium/issues/7927)
- [#7923 — Auto Import Folder Contents To Trilium](https://github.com/TriliumNext/Trilium/issues/7923)
- [#7895 — (feat) Image Gallery/Collection](https://github.com/TriliumNext/Trilium/issues/7895)
- [#7893 — Add Podman installation to documentation](https://github.com/TriliumNext/Trilium/issues/7893)
- [#7886 — [Feature] Allow inserting video previews in notes](https://github.com/TriliumNext/Trilium/issues/7886)
- [#7885 — [quick-edit] new controls for quick-edit window management](https://github.com/TriliumNext/Trilium/issues/7885)
- [#7876 — Implement site search with type ahead (OpenSearch)](https://github.com/TriliumNext/Trilium/issues/7876)
- [#7827 — Increase donation visibility by adding a "Donate" entry in the Options page](https://github.com/TriliumNext/Trilium/issues/7827)

## Skipped / Unclear

- [#8282 — text editor crashed](https://github.com/TriliumNext/Trilium/issues/8282) — (also listed in Notable) only a stack trace, no reliable repro steps.
- [#8216 — Docker IPv6 vs IPv4 accessibility](https://github.com/TriliumNext/Trilium/issues/8216) — (also listed in Notable) reporter hasn't attached their compose/network config, so it's unclear whether it's a Trilium or Docker setup issue.
