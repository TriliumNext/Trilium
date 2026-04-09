# Batch 11 — Issues #3185–#3703

## Easy-Fix Candidates

### [#3697 — Docker : Set USER_GID to 100 (Feature request)](https://github.com/TriliumNext/Trilium/issues/3697)
- **Problem**: `start-docker.sh` runs `groupmod -g ${USER_GID} node`, which fails when GID 100 already exists (e.g. Unraid's default `users` group).
- **Proposed solution**: `apps/server/start-docker.sh` line 4 currently uses `groupmod -og ${USER_GID} node` (the `-o` flag allows a non-unique GID). This is likely already the fix — verify the published Docker image ships this and close. If `rootless-entrypoint.sh` still lacks `-o`, add it there too.
- **Effort**: trivial
- **Confidence**: high (code already uses `-og`, just needs image-release verification)

## Likely Already Fixed

### [#3516 — (Bug report) Hidden notes appear in search results](https://github.com/TriliumNext/Trilium/issues/3516)
- **Evidence**: Search context has `includeHiddenNotes` option; `apps/server/src/services/search/services/parse.ts:503-510` wraps the query with `NotExp(new IsHiddenExp())` when `includeHiddenNotes` is false. `git log -S "IsHiddenExp"` shows commit `88bc7402a2` "hidden notes should not appear in the global search unless hoisted into it, #3516".
- **Verification needed**: Reproducer on a fresh 0.9x build — confirm `_hidden` subtree notes no longer show in global search.

### [#3627 — Invalid timezone in search using docker container](https://github.com/TriliumNext/Trilium/issues/3627)
- **Evidence**: Docker user guide (`apps/server/src/assets/doc_notes/.../Using Docker.html` around line 81) already has a "Note on timezones" section recommending setting the `TZ` env var. The reporter's suggestion was to document this.
- **Verification needed**: Maintainer can close as already documented (or link the docs section from the issue).

### [#3191 — (Feature request) Add ability to set X-Frame-Options header](https://github.com/TriliumNext/Trilium/issues/3191)
- **Evidence**: `apps/server/src/app.ts:82` uses helmet with only a few options overridden; Helmet's default frameguard is `SAMEORIGIN`, not `DENY`. The reporter's complaint was that DENY was being set — current defaults are already SAMEORIGIN.
- **Verification needed**: `curl -I` against a running instance, confirm the header value, close if SAMEORIGIN.

### [#3524 — Error in custom widget leads to blank application / web frontend](https://github.com/TriliumNext/Trilium/issues/3524)
- **Evidence**: `git log -S "custom widget"` shows `528d94a8fb` "accept custom widgets as classes instead of instances, #4274" and `7567903da3` "docs(user): improve documentation on custom widgets & Preact". The widget loading pipeline has been significantly restructured and now tolerates class-based widgets; unhandled doRender errors are caught higher in the widget tree in the new Preact-based rendering.
- **Verification needed**: Create a broken custom widget (call missing method), confirm app still renders with error logged instead of blanking.

### [#3415 — Unify the attribute_detail and builtin_attributes definitions](https://github.com/TriliumNext/Trilium/issues/3415)
- **Evidence**: `packages/commons/src/lib/builtin_attributes.ts` now exists as the shared source of truth (moved in commit `9b3396349e` "refactor(commons): add builtin_attributes to commons"). However, `apps/client/src/widgets/attribute_widgets/attribute_detail.ts:202-271` still maintains its own hardcoded `ATTR_HELP` map. Partial unification.
- **Verification needed**: Decide whether to close (partial unification done) or keep open as a refactor to have `attribute_detail` consume `builtin_attributes` entries and attach help text there.

### [#3218 — Starting searches with "Combining Diacritical Marks" will freeze Trilium](https://github.com/TriliumNext/Trilium/issues/3218)
- **Evidence**: `apps/server/src/services/utils.ts:108` normalizes input text before search, and commit `f705c432fd` "allow combining tokens in text and title/attributes, fixes #2820" rewrote combining-character handling.
- **Verification needed**: Try entering `¨` in quick search on current build — confirm no freeze.

### [#3355 — Global search finds notes with 'whitespace' inside search term](https://github.com/TriliumNext/Trilium/issues/3355)
- **Evidence**: The search tokenizer was rewritten alongside the sqlite FTS work (`git log --grep rice-searching-with-sqlite`), and text is normalized via `str.normalize("NFC")` in `apps/server/src/services/utils.ts:532`.
- **Verification needed**: Attempt the whitespace-in-term reproduction against a recent build. Likely no longer reproduces.

### [#3626 — Sync from clients to server fails for a specific daily journal note](https://github.com/TriliumNext/Trilium/issues/3626)
- **Evidence**: Reporter's error was "Can't find note 0LKt6C8L7y3s" in `resolveNotePathToSegments`. Sync engine and `froca.resolveNotePathToSegments` have been heavily refactored since 0.58; orphaned branches during sync are now tolerated rather than throwing fatal errors.
- **Verification needed**: Nothing to reproduce from the stale db. Close as stale / cannot-reproduce.

## Notable Non-Easy Issues

- [#3703 — Disable version history function failure](https://github.com/TriliumNext/Trilium/issues/3703) — `disableVersioning` check exists in `notes.ts:741`, reporter claims revisions still get saved after a period; needs repro against read-only auto-save path.
- [#3657 — New Note link not showing at cursor location after hitting "enter"](https://github.com/TriliumNext/Trilium/issues/3657) — CKEditor mention plugin: new-note insertion ignores caret when template picker is confirmed with Enter. Needs CKEditor mention fix.
- [#3600 — sync lag](https://github.com/TriliumNext/Trilium/issues/3600) — Canvas sync conflicts from stale client cache; complex sync logic change.
- [#3587 — ResizeObserver loop limit exceeded](https://github.com/TriliumNext/Trilium/issues/3587) — console spam on split; requires debouncing ResizeObserver callbacks in `content_header.ts` / `tab_row.ts`.
- [#3500 — Trilium does not start if the firewall has blocked it](https://github.com/TriliumNext/Trilium/issues/3500) — needs electron-level error surfacing when initial localhost connection fails; not trivial.
- [#3495 — High memory use causing process kill or OOM](https://github.com/TriliumNext/Trilium/issues/3495) — memory leak investigation in sync process; requires profiling.
- [#3478 — Lagging Trilium frontend when editing large note](https://github.com/TriliumNext/Trilium/issues/3478) — CKEditor `setData` re-run on every poll; requires changing debounce strategy in `EditableText.tsx`.
- [#3457 — Strange behavior when dealing with math related contents](https://github.com/TriliumNext/Trilium/issues/3457) — cursor skipping inline math + Firefox-specific math disappearance; upstream CKEditor math bugs.
- [#3395 — Reloading while editing a text field in a canvas note causes permanent invisibility](https://github.com/TriliumNext/Trilium/issues/3395) — Excalidraw `editingGroupId` persisted into saved JSON; needs canvas save-state sanitisation.
- [#3371 — Can not save weibo.com](https://github.com/TriliumNext/Trilium/issues/3371) — web-clipper compatibility with a specific site; needs clipper debugging.
- [#3283 — Misplaced links to newly created pages](https://github.com/TriliumNext/Trilium/issues/3283) — mouse-click confirmation of template picker drops caret; CKEditor mention plugin issue.
- [#3235 — JavaScript error popup - ERR_ONNECTION_RESET](https://github.com/TriliumNext/Trilium/issues/3235) — main process crash popup; needs electron main-process error handler.
- [#3214 — cursor jumps to another place after click included note](https://github.com/TriliumNext/Trilium/issues/3214) — CKEditor selection restoration after include-note click; non-trivial.
- [#3187 — HTML export results in unreadable notes on deeper parts of the tree](https://github.com/TriliumNext/Trilium/issues/3187) — Windows MAX_PATH limits on deep hierarchies; needs export path shortening.
- [#3185 — Export & import note tree with backlinks breaks note map](https://github.com/TriliumNext/Trilium/issues/3185) — dangling relation targets cause `hasLabel` on undefined; needs null-guard in backlink/note-map routes (borderline easy but depends on root cause investigation of why deleted relations survive import).

## Feature Requests

- [#3633 — Take a snapshot of a web page in Trilium](https://github.com/TriliumNext/Trilium/issues/3633)
- [#3593 — Ability to disable jumping to an image when an image is attached](https://github.com/TriliumNext/Trilium/issues/3593)
- [#3566 — Add search action to copy note](https://github.com/TriliumNext/Trilium/issues/3566)
- [#3563 — LeftPanel fix width and toggle](https://github.com/TriliumNext/Trilium/issues/3563)
- [#3557 — full text search by command line](https://github.com/TriliumNext/Trilium/issues/3557)
- [#3556 — Automatically set note code type when extension is written in note name](https://github.com/TriliumNext/Trilium/issues/3556)
- [#3551 — Context Menu Widget](https://github.com/TriliumNext/Trilium/issues/3551)
- [#3541 — How to config the font color sets](https://github.com/TriliumNext/Trilium/issues/3541)
- [#3540 — Unhoist temporarily](https://github.com/TriliumNext/Trilium/issues/3540)
- [#3498 — More signals for search & autocomplete ranking](https://github.com/TriliumNext/Trilium/issues/3498)
- [#3494 — Value replace in bulk action](https://github.com/TriliumNext/Trilium/issues/3494)
- [#3493 — Dynamic relations, or attribute inheritance between linked notes](https://github.com/TriliumNext/Trilium/issues/3493)
- [#3484 — add a keyshort for any format when write a text note](https://github.com/TriliumNext/Trilium/issues/3484)
- [#3462 — Color palette for Highlight](https://github.com/TriliumNext/Trilium/issues/3462)
- [#3458 — Show special characters in editor](https://github.com/TriliumNext/Trilium/issues/3458)
- [#3433 — Provide a set of charts in the hidden subtree](https://github.com/TriliumNext/Trilium/issues/3433)
- [#3430 — Add basic fulltext search to share](https://github.com/TriliumNext/Trilium/issues/3430)
- [#3426 — search and replace](https://github.com/TriliumNext/Trilium/issues/3426)
- [#3400 — Setting to disable replacement of straight quote sign with typographic ones](https://github.com/TriliumNext/Trilium/issues/3400)
- [#3399 — Export Notes option to include internal links](https://github.com/TriliumNext/Trilium/issues/3399)
- [#3389 — Images upload sequence on mobile](https://github.com/TriliumNext/Trilium/issues/3389)
- [#3385 — Searching through note revisions?](https://github.com/TriliumNext/Trilium/issues/3385)
- [#3358 — Is there a plan to add a table of contents function to the left side](https://github.com/TriliumNext/Trilium/issues/3358)
- [#3356 — Collapsed child notes links should toggle the expansion on first click](https://github.com/TriliumNext/Trilium/issues/3356)
- [#3353 — Support extra CA certs](https://github.com/TriliumNext/Trilium/issues/3353)
- [#3335 — Use mouse wheel to scroll up/down instead of zoom in mermaid notes](https://github.com/TriliumNext/Trilium/issues/3335)
- [#3304 — Add shortcut (set text to code format)](https://github.com/TriliumNext/Trilium/issues/3304)
- [#3269 — Declare some relation as "repeated but unique"](https://github.com/TriliumNext/Trilium/issues/3269)
- [#3268 — Accept drag-and-dropping note links into relation map](https://github.com/TriliumNext/Trilium/issues/3268)
- [#3267 — Multiple note drag-and-drop into relation map](https://github.com/TriliumNext/Trilium/issues/3267)
- [#3266 — Automatic layout on relation maps](https://github.com/TriliumNext/Trilium/issues/3266)
- [#3263 — Generalized Trilium tree](https://github.com/TriliumNext/Trilium/issues/3263)
- [#3246 — Is it possible to integrate the plantUML?](https://github.com/TriliumNext/Trilium/issues/3246)
- [#3244 — Add option, prompt before exit](https://github.com/TriliumNext/Trilium/issues/3244)

## Skipped / Unclear

- None — all 58 issues placed above.
