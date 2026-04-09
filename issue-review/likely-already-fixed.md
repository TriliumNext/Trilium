# Likely Already Fixed — Trilium Issue Review

Consolidated from per-batch analysis of all 859 open issues (as of 2026-04-09).
Total likely-already-fixed candidates: **58**

These issues show signs of being resolved in current `main`: references to removed/renamed files, commits that clearly address the symptom, or reproduction steps that no longer work. **Do not close blindly** — each one should be verified and ideally asked about by the maintainer before closing.

---

## From Batch 01

### [#9009 — Option to easily toggle the fuzzy search on/off](https://github.com/TriliumNext/Trilium/issues/9009)
- **Evidence**: Commit `f23a7b4842 feat(settings): also allow for fuzzy searching to just be disabled` (Mar 18 2026) adds a disable toggle in `apps/client/src/widgets/type_widgets/options/other.tsx`, wires it to `search_context.ts`, and updates `options_init.ts` + `options_interface.ts`. This lands after the issue was filed.
- **Verification needed**: A maintainer can confirm the new toggle exists in the Options UI (Other tab) in a current build and ask the reporter whether it satisfies their need; also verify the "quick jump" fuzzy concern mentioned in the issue is covered by the same toggle.

### [#8866 — Cursor jumps to note beginning periodically, tabs reset — LauncherContainer](https://github.com/TriliumNext/Trilium/issues/8866)
- **Evidence**: The error messages reference `LauncherContainer.js:545` (0.101.3). The current repo has `apps/client/src/widgets/launch_bar/LauncherContainer.tsx` — the widget was rewritten as a React component. Reported actions (`hideLeftPane`, `searchNotes`, `enterProtectedSession`) still exist but the rAF-in-launcher-container reflow storm described in the log looks gone after the rewrite.
- **Verification needed**: Maintainer should ask the reporter to retest on 0.102.2+ since the underlying file no longer exists in its 0.101.x form.

### [#8790 — Some assets not work in share notes when serving under a different path](https://github.com/TriliumNext/Trilium/issues/8790)
- **Evidence**: Issue references the path `assets/v0.99.3/src/share.js`. The share rendering pipeline has been completely replaced — share assets are now served from `packages/share-theme/` and `apps/server/src/share/content_renderer.ts` uses `basePath`-based asset URLs. The old `/assets/vX.X.X/src/share.js` path no longer exists.
- **Verification needed**: Maintainer should have the reporter retest with 0.102.x and the current reverse-proxy guide; the specific 404 URL from the bug cannot occur in the current codebase.

---

## From Batch 02

### [#8407 — Why was the title selection for new notes cancelled](https://github.com/TriliumNext/Trilium/issues/8407)
- **Evidence**: `apps/client/src/widgets/note_title.tsx` (lines 61–69) explicitly calls `textBoxRef.current.select()` on `focusAndSelectTitle` events, and `apps/client/src/services/note_create.ts:92` triggers that event with `isNewNote: true`. A relevant fix `06cea99b40 fix(react): note title not selecting text` (Aug 2025) pre-dates the issue, but recent churn in the title widget (e.g. `c09ef3af80`, Feb 2026) suggests the bug may have returned and then been addressed after the reporter filed on 0.101.3.
- **Verification needed**: Ask the reporter to retest on nightly / current main.

---

## From Batch 03

### [#8060 — fix(search): Canvas notes with empty or missing elements cause quick search to crash](https://github.com/TriliumNext/Trilium/issues/8060)
- **Evidence**: `git log -S "Array.isArray(elements)"` shows commit `ecb972c71c fix(search): add null check for canvas elements in fulltext search`. The canvas handling has since moved to `apps/server/src/services/search/expressions/note_content_fulltext_preprocessor.ts` where `processCanvasContent` (lines 83–108) now guards with `if (Array.isArray(elements))` and returns `""` otherwise — exactly the fix proposed in the issue.
- **Verification needed**: Confirm with the reporter on a current nightly and close.

### [#7884 — Remove `docker-compose.rootless.yaml`](https://github.com/TriliumNext/Trilium/issues/7884)
- **Evidence**: `Glob "docker-compose.rootless*"` at repo root returns no files; the file has been removed.
- **Verification needed**: Grep any docs for dangling mentions of `docker-compose.rootless` and close. (Also listed under easy-fix in case any lingering references need cleanup.)

---

## From Batch 04

### [#6989 — New client sync issues](https://github.com/TriliumNext/Trilium/issues/6989)
- **Evidence**: Reporter is on **0.95.0** (released mid-2025) and describes websocket connection drops against a reverse proxy. The codebase has had several sync/websocket robustness fixes since 0.98. Current version is ~0.99.4.
- **Verification needed**: Ask reporter to retry on the latest version. If still reproducing, collect a fresh sync/WS log.

### [#6999 — Editing a Relation (from template) in mobile view, don't work](https://github.com/TriliumNext/Trilium/issues/6999)
- **Evidence**: Reporter is on **0.91.1**, which is extremely old relative to current mobile rework. The mobile attribute editor has been largely rewritten (`apps/client/src/widgets/attribute_widgets/*.tsx` is now React/TSX).
- **Verification needed**: Ask reporter to retry on 0.99.x; close if no repro.

### [#7393 — Note content overwritten when changing title of snippets](https://github.com/TriliumNext/Trilium/issues/7393)
- **Evidence**: Reporter is on **0.97.1**. Text snippet handling (`#textSnippet`) has been refactored since — see `apps/client/src/widgets/type_widgets/text/EditableText.tsx` and related CKEditor 5 integration. The described "flashing + content swap" while editing title suggests the old debounced save path that was rewritten around 0.99.
- **Verification needed**: Ask reporter to retry on 0.99.4 with the specific snippet-switching STR.

---

## From Batch 05

### [#6390 — `arm64` docker image does not include `wget`](https://github.com/TriliumNext/Trilium/issues/6390)
- **Evidence**: I read `apps/server/Dockerfile` and `Dockerfile.alpine`. Both use `HEALTHCHECK ... node /usr/src/app/docker_healthcheck.cjs` (line 28 / 26) — there is no longer any `wget`-based healthcheck. The runtime stage installs only `gosu` (Debian) or `su-exec` (Alpine). Commit `614958f16c chore(docker): reintroduce healthchecks` (Apr 2025) switched healthchecks from `wget` to a node script before this issue was filed (Jul 2025), so there is no dependency on `wget` in the current image — the issue may actually be about Coolify's external healthcheck expectations, not Trilium's image.
- **Verification needed**: Maintainer should confirm that Trilium's own image indeed no longer requires wget for healthchecks and respond to the Coolify maintainer on the upstream template; close as "not a Trilium bug" or as a docs-only fix.

---

## From Batch 06

### [#5669 — Add link dialog fails to link if you press enter twice too quickly](https://github.com/TriliumNext/Trilium/issues/5669)
- **Evidence**: `git log --grep "enter twice\|link.*enter"` finds commit `f6201d8581` "fix: add link dialog enter act correctly" (Mar 2026) which touches `apps/client/src/widgets/dialogs/add_link.tsx` (+76 lines) and adds a 160-line spec file. Directly addresses this bug.
- **Verification needed**: Run the reproduction steps from the issue in the latest main build and confirm it is no longer possible to trigger the "Choose note type" dialog by fast double-enter in the add-link flow.

### [#5606 — OpenID Connect support](https://github.com/TriliumNext/Trilium/issues/5606)
- **Evidence**: `apps/server/src/services/open_id.ts` exists; `express-openid-connect` is a direct dependency and has been continuously updated (git log shows `2.20.1`, `2.20.0`, `2.19.4`, etc.); OIDC docs have been improved (commit `963f4586f3`). The feature has clearly shipped.
- **Verification needed**: Confirm documentation covers configuration with Authelia/Keycloak/Authentik so the original reporter's use cases are answered, then close.

### [#5545 — Fancytree assertion failed: only init supported](https://github.com/TriliumNext/Trilium/issues/5545)
- **Evidence**: fancytree has since been updated to v2.38.5 (`5db8b59b51`) plus a "partial integrate jquery.fancytree" refactor (`23db7fe602`) and a "missing fancytree dependencies" fix (`901ab54e64`). The assertion error from an older version may no longer reproduce.
- **Verification needed**: Load the server build on a clean profile and check the browser console for the `only init supported` error on startup.

---

## From Batch 07

### [#5341 — Duplicate HTML ids for tabs of the same view](https://github.com/TriliumNext/Trilium/issues/5341)
- **Evidence**: The options UI has been migrated to Preact (`apps/client/src/widgets/type_widgets/options/*.tsx`). `FormGroup` now generates IDs via `useUniqueName(name)` which returns `${name}-${randomString(10)}` (see `apps/client/src/widgets/react/FormGroup.tsx:19` and `hooks.tsx:372`). `FormCheckbox`, `FormRadioGroup`, `Collapsible`, and `Dropdown` all use the same hook. Every rendered instance therefore gets a fresh random ID.
- **Verification needed**: Open two options tabs in the same window and inspect the DOM to confirm no duplicate IDs remain across the multi-tab view.

---

## From Batch 08

### [#5134 — Upgrade autocomplete dependencies](https://github.com/TriliumNext/Trilium/issues/5134)
- **Evidence**: Grepped the git log and found commits `d1fc4780b7 refactor: remove old autocomplete completely`, `3b35dc50c5 feat(core): integrate autocomplete route`, plus a series of `feat(autocomplete)` / `test(autocomplete)` commits. The old autocomplete has been fully removed and replaced in-house.
- **Verification needed**: Maintainer should confirm the new autocomplete is considered the replacement the reporter was asking for, then close.

### [#5174 — '@' Context menu's auto-completion not showing most relevant but most recent](https://github.com/TriliumNext/Trilium/issues/5174)
- **Evidence**: The autocomplete subsystem was fully rewritten (see #5134 evidence). Fuzzy matching has been added (`f23a7b4842 feat(settings): also allow for fuzzy searching to just be disabled`) and a new autocomplete route exists. The old "most recent" behaviour may be gone.
- **Verification needed**: Repro on current main — create ancient notes matching the query, a few recent ones, then `@` and check ordering.

### [#5196 — (Feature request) Cursor automatically in text box when embedding note](https://github.com/TriliumNext/Trilium/issues/5196)
- **Evidence**: Commit `35bd210062 fix(react/dialogs): recent notes not triggered in autocomplete` (Aug 2025) refactored `triggerRecentNotes` in `apps/client/src/services/note_autocomplete.ts` to call `$el.trigger("focus").trigger("select")`. `apps/client/src/widgets/dialogs/include_note.tsx` invokes `triggerRecentNotes(autoCompleteRef.current)` in `onShown`, so the input should now focus automatically when the Include Note dialog opens.
- **Verification needed**: Repro on current main — open a text note, click Include Note, confirm focus is in the search box without clicking.

### [#5254 — User configurable whitelist of html tags stripped on import](https://github.com/TriliumNext/Trilium/issues/5254)
- **Evidence**: The issue's interim request — extend the default allowlist with `acronym`, `article`, `big`, `button`, `cite`, `col`, `colgroup`, `data`, `dd`, `fieldset`, `form`, `legend`, `meter`, `noscript`, `option`, `progress`, `rp`, `samp`, `small`, `sub`, `sup`, `template`, `textarea`, `tt` — is now done in `packages/commons/src/lib/shared_constants.ts` (`SANITIZER_DEFAULT_ALLOWED_TAGS`, comment references this same issue). Additionally, `apps/server/src/services/html_sanitizer.ts` already reads an `allowedHtmlTags` option (user-configurable).
- **Verification needed**: Confirm the user-configurable option has a UI surface; if only programmatic, close the issue with a docs pointer.

### [#5131 — (Bug report) v0.90.4 docker does not read USER_UID and USER_GID from environment](https://github.com/TriliumNext/Trilium/issues/5131)
- **Evidence**: Reporter's logs show `./start-docker.sh: 3: [[: not found` — the script was using bash `[[ ]]` under `/bin/sh`. Current `apps/server/start-docker.sh` uses POSIX `[ ! -z "${USER_UID}" ]` / `[ ! -z "${USER_GID}" ]`, so the bug is gone.
- **Verification needed**: Spin up the latest docker image with `USER_UID=1001 USER_GID=1001` and confirm the container starts and writes the log dir.

### [#5066 — Fix `spec/etapi` tests and port to vitest](https://github.com/TriliumNext/Trilium/issues/5066)
- **Evidence**: `apps/server/spec/etapi/` now contains 30+ `.spec.ts` files (e.g. `app-info.spec.ts`, `search.spec.ts`, `mcp.spec.ts`). The migration has happened.
- **Verification needed**: Confirm `pnpm test:sequential` actually runs them and they pass.

---

## From Batch 09

### [#4649 — (Bug report) Importing large ZIP-Files via etapi throws error and request hangs](https://github.com/TriliumNext/Trilium/issues/4649)
- **Evidence**: The reported root cause was that `req.body` was undefined/unparsed on the `/etapi/notes/:noteId/import` POST. `apps/server/src/app.ts:94` now registers `express.raw({ limit: "500mb" })` globally, and `apps/server/src/etapi/notes.ts:180-190` still passes `req.body` straight to `zipImportService.importZip` — the raw buffer path now exists. Issue predates the monorepo restructure.
- **Verification needed**: Reproduce the original Python import with a large zip against current main; verify `Content-Type: application/zip` is handled (Express `raw()` defaults to `application/octet-stream`, so users may need the right Content-Type or an explicit type in the raw handler).

### [#4261 — (Feature request) Make apps logs saving optional](https://github.com/TriliumNext/Trilium/issues/4261)
- **Evidence**: Log retention is now configurable via `config.Logging.retentionDays` (`apps/server/src/services/log.ts:36-42`) with `-1` keeping all logs and positive values deleting older files. While fully disabling file logging isn’t wired up, the disk-space concern is mitigated by retention config.
- **Verification needed**: Maintainer to decide whether the feature is satisfied by retention config or still needs an explicit “disable file logs” switch.

---

## From Batch 10

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

---

## From Batch 11

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

---

## From Batch 12

### [#3177 — (Bug report) ERR_SOCKET_BAD_PORT - port set to NaN on server start](https://github.com/TriliumNext/Trilium/issues/3177)
- **Evidence**: `/home/elian/Projects/Trilium/apps/server/src/services/port.ts` now uses `parseAndValidate()` that explicitly checks `isNaN` and exits with a clear FATAL message; v0.55 parser issue appears rewritten.
- **Verification needed**: Ask reporter to retry with current release and provide `config.ini` if still failing.

### [#3045 — Docker : Can't run by using user 1000:1000](https://github.com/TriliumNext/Trilium/issues/3045)
- **Evidence**: `/home/elian/Projects/Trilium/apps/server/Dockerfile.rootless` now exists — runs as non-root user with configurable UID/GID via build args and does not rely on `su-exec`/`setgroups`. Multiple rootless-related fixes present in git log.
- **Verification needed**: Confirm with reporter that the rootless image solves their scenario.

### [#2957 — (Bug report) JavaScript error when attempting to run when an instance is already running](https://github.com/TriliumNext/Trilium/issues/2957)
- **Evidence**: `/home/elian/Projects/Trilium/apps/desktop/src/main.ts:87` uses `app.requestSingleInstanceLock()` and exits gracefully (`process.exit(0)`) with a translated info message instead of throwing an unhandled error. There's also a `second-instance` handler that focuses the existing window.
- **Verification needed**: Run two instances on Windows to confirm no more JS error.

### [#2722 — (Feature request) Make interface auth timeout configurable](https://github.com/TriliumNext/Trilium/issues/2722)
- **Evidence**: `Session.cookieMaxAge` is configurable in `apps/server/src/assets/config-sample.ini` (line 39) and documented in `apps/server/src/assets/doc_notes/en/User Guide/.../Authentication.html`. Used by `apps/server/src/routes/session_parser.ts:110`.
- **Verification needed**: Close as implemented, link to Authentication docs.

### [#2784 — (Feature request) Add an example documentation for self-signed certs in TLS configuration wiki page](https://github.com/TriliumNext/Trilium/issues/2784)
- **Evidence**: `docs/User Guide/User Guide/Installation & Setup/Server Installation/HTTPS (TLS).md` contains 3 matches for `self-signed`/`self sign`, so self-signed guidance is now present.
- **Verification needed**: Maintainer confirms current doc covers the scenario the reporter wanted.

### [#2909 — webclipper show not correct](https://github.com/TriliumNext/Trilium/issues/2909)
- **Evidence**: Web-clipper was completely rewritten — new implementation lives in `apps/web-clipper/` (WXT-based). The reporter's 0.52.2-era bug with the old zadam web-clipper is no longer reproducible against the new codebase.
- **Verification needed**: Ask reporter to retry with the current web-clipper.

### [#2621 — (Bug report) Inconsistency import pictures with Trilium Web Clipper Addon](https://github.com/TriliumNext/Trilium/issues/2621)
- **Evidence**: Same as #2909 — web-clipper rewritten under `apps/web-clipper/`; old image-import inconsistency from v0.50 won't reproduce.
- **Verification needed**: Ask reporter to retry "Save whole page" against modern web-clipper.

### [#2596 — (Bug report) Failed Start Up (Gnome Arc Menu extension)](https://github.com/TriliumNext/Trilium/issues/2596)
- **Evidence**: Likely dead — Electron stack, Gnome shell extensions, and everything else has been updated many times since v0.49.5 (Jan 2022). No code in Trilium controls this; it's a third-party shell extension conflict.
- **Verification needed**: Ask reporter to retry current release with Arc Menu; close as stale if not reproducible.

---

## From Batch 13

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

---

## From Batch 14

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

---

## From Batch 15

### [#1102 — Spellchecker is overly sensitive](https://github.com/TriliumNext/Trilium/issues/1102)
- **Evidence**: Items (1) and (2) were rejected upstream (Electron/Blink limitation). Item (3) (runtime toggle shortcut) is still not supported — `apps/server/src/services/window.ts` reads `spellCheckEnabled` only at window creation, and no `toggleSpellCheck` shortcut exists in `keyboard_actions.ts`. However the original items 1 & 2 are effectively closed as "won't fix".
- **Verification needed**: Close items 1-2 as won't-fix (Electron limitation); split out item 3 as a separate feature request if still wanted.

### [#1080 — Cell properties panel invisible when table cell content too large](https://github.com/TriliumNext/Trilium/issues/1080)
- **Evidence**: Filed against Trilium 0.42.6 with CKEditor from that era. CKEditor5 has been upgraded many major versions since; table cell properties panel positioning is handled by upstream CKEditor. No custom override exists in `packages/ckeditor5/`.
- **Verification needed**: Reproduce with current build — paste a huge text block into a table cell and try to open cell properties; if panel is visible, close.

### [#924 — Text following innerlink becomes part of the link after switching pages](https://github.com/TriliumNext/Trilium/issues/924)
- **Evidence**: Reported against 0.40.6 — a CKEditor link-range bug from that era. CKEditor has been upgraded many versions; no custom link-range fix exists in `packages/ckeditor5/`. No commits touching "innerlink" in `git log`.
- **Verification needed**: Reproduce: insert a Ctrl+L link, type text after it, switch notes and back; if the trailing text is no longer absorbed into the link, close.

### [#936 — unable to clip some pages](https://github.com/TriliumNext/Trilium/issues/936)
- **Evidence**: 0.40-era web clipper timeout on a large GitHub markdown page. Clipper and server code have been rewritten since (`apps/web-clipper/`, clipping endpoint in `apps/server/src/routes/api/clipper.ts`).
- **Verification needed**: Re-try clipping `https://github.com/learnbyexample/learn_gnuawk/blob/master/gnu_awk.md` with current clipper; if successful, close.

### [#75 — add standard attribute value autocomplete](https://github.com/TriliumNext/Trilium/issues/75)
- **Evidence**: `apps/client/src/services/attribute_autocomplete.ts` exports `initLabelValueAutocomplete`, which calls `attribute-values/<name>` server endpoint and populates autocomplete suggestions. Wired up in `attribute_detail.ts` and `PromotedAttributes.tsx`. Exactly what was asked for.
- **Verification needed**: None — can be closed as done.

### [#649 — Open/focus a note from command line / desktop URL handler (Trilium URL protocol)](https://github.com/TriliumNext/Trilium/issues/649)
- **Evidence**: PR #9248 ("Add URL protocol support for trilium://") is referenced as submitted for this IssueHunt. No `trilium://` handler or `setAsDefaultProtocolClient` currently in the codebase (so PR is still open).
- **Verification needed**: Track PR #9248 — once merged, close this issue.
