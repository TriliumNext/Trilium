# Batch 08 — Issues #4854–#5296

## Easy-Fix Candidates

### [#5250 — (Feature request) Prevent options note title changes](https://github.com/TriliumNext/Trilium/issues/5250)
- **Problem**: Titles of hidden options notes (e.g. `_optionsAppearance`) are editable by the user, which is inconsistent since their titles come from translations.
- **Proposed solution**: In `apps/client/src/widgets/note_title.tsx` (the `isReadOnly` computation around lines 25-31), add a condition for hidden/system notes. Simplest: `note.noteId.startsWith("_options")` (or more broadly, `note.noteId.startsWith("_") && !isLaunchBarConfig(...)` — but that's riskier). The existing pattern already handles `_help_` and launch bar config, so extending it with options IDs is a one-line change.
- **Effort**: trivial
- **Confidence**: high

### [#5201 — (Feature request) Disable text selection in mermaid diagrams?](https://github.com/TriliumNext/Trilium/issues/5201)
- **Problem**: Dragging to pan a mermaid diagram also selects text, which interferes with pan gesture.
- **Proposed solution**: Add the CSS rule (`user-select: none; -webkit-user-select: none;`) to `.mermaid-render` in the mermaid type widget's CSS. Issue author provides the exact CSS. Locate the mermaid type widget under `apps/client/src/widgets/type_widgets/` and append to its stylesheet — no need for a settings toggle as a first pass.
- **Effort**: trivial
- **Confidence**: high

### [#5220 — (Feature request) Add the `#appJs` attribute to load a custom script](https://github.com/TriliumNext/Trilium/issues/5220)
- **Problem**: `#appCss` exists for globally loading CSS from a note; an analogous `#appJs` would let users ship a JS library once instead of cloning it into every render note.
- **Proposed solution**: Mirror the existing `#appCss` handling — grep for `appCss` in `apps/server/src/` and `apps/client/src/` and add a parallel path that injects a `<script>` tag. The mechanism is well-established; mostly copy/paste. Document the obvious security caveats in the attribute docs (labels.html).
- **Effort**: small
- **Confidence**: medium (easy code-wise; security framing may prompt more review)

## Likely Already Fixed

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

## Notable Non-Easy Issues

- [#5296 — CKEditor Handle doesn't move when tree width is changed](https://github.com/TriliumNext/Trilium/issues/5296) — needs a ResizeObserver hook to trigger CKEditor layout recalc when sidebar changes; upstream-influenced.
- [#5294 — "Insert Child Note" Context Menu cut off / not scrollable](https://github.com/TriliumNext/Trilium/issues/5294) — `apps/client/src/menus/context_menu.ts` only positions the top-level menu; submenus don't have overflow logic or `max-height` handling. Needs a proper submenu positioning routine plus scrolling.
- [#5251 — Sync always fails after wrong DNS config once](https://github.com/TriliumNext/Trilium/issues/5251) — Electron HTTP/DNS cache persistence; needs an explicit "clear DNS cache" action or to bypass the cache for sync requests.
- [#5247 — Search/Filter Map View](https://github.com/TriliumNext/Trilium/issues/5247) — feature request but needs design work in the note-map widget.
- [#5233 — Copy/paste from note only pastes text, not images](https://github.com/TriliumNext/Trilium/issues/5233) — CKEditor clipboard integration; nontrivial.
- [#5214 — Scripts can overwrite files in application install dir](https://github.com/TriliumNext/Trilium/issues/5214) — security; `exportSubtreeToZipFile` in `apps/server/src/services/export/zip.ts` still accepts arbitrary paths. Needs sandboxing / CWD enforcement.
- [#5193 — Relation popup sometimes shows content of incorrect note](https://github.com/TriliumNext/Trilium/issues/5193) — attribute popup caches first hovered target; needs debug of PromotedAttributes/attribute_detail tooltip logic.
- [#5192 — Notes not saving (silent data loss)](https://github.com/TriliumNext/Trilium/issues/5192) — serious; needs reproduction and investigation into spacedUpdate / save pipeline.
- [#5191 — Scrolling when cursor is in note margin](https://github.com/TriliumNext/Trilium/issues/5191) — needs pointer-events/CSS rework on the text editor scroll container.
- [#5170 — "Create and link new note" moves link to beginning of parent note](https://github.com/TriliumNext/Trilium/issues/5170) — CKEditor mention/create-link command bug.
- [#5169 — Backend JS notes migration warning](https://github.com/TriliumNext/Trilium/issues/5169) — not a code bug, but the request for user-facing migration guidance needs docs work.
- [#5159 — Child notes don't refresh on selecting a different note](https://github.com/TriliumNext/Trilium/issues/5159) — collection/child-list widget refresh race; reporter is using `#viewType=list`.
- [#5118 — Copying attachment link to clipboard fails](https://github.com/TriliumNext/Trilium/issues/5118) — browser/HTTP context for clipboard access; needs polyfill / secure-context fallback.
- [#5080 — Investigate #titleTemplate for template notes](https://github.com/TriliumNext/Trilium/issues/5080) — `notes.ts` reads `titleTemplate` from the parent only; making it inherit from the template requires design discussion.
- [#4947 — Remove uses of `any` in server and client](https://github.com/TriliumNext/Trilium/issues/4947) — tracking/technical debt.
- [#4936 — Sync to server behind OIDC & reverse proxy](https://github.com/TriliumNext/Trilium/issues/4936) — OIDC auth interception breaks sync handshake; needs protocol design.
- [#4905 — shareCredentials tag does not work with reverse proxy](https://github.com/TriliumNext/Trilium/issues/4905) — reverse-proxy / HTTP/2 interaction with basic-auth 401 response.
- [#4898 — Link in images (CKEditor behaviour)](https://github.com/TriliumNext/Trilium/issues/4898) — CKEditor image+link UI interaction.
- [#4896 — Refer to current note clone in render note script](https://github.com/TriliumNext/Trilium/issues/4896) — scripting API design question.
- [#4888 — Sync server handshake failed, `<!DOCTYPE` is not valid JSON](https://github.com/TriliumNext/Trilium/issues/4888) — same family as #4936; reverse-proxy 404/login returning HTML.
- [#4887 — Normal notes recovered wrongly after syncing](https://github.com/TriliumNext/Trilium/issues/4887) — sync conflict recovery bug, needs deep investigation.
- [#4880 — Shared link shows address from sync server](https://github.com/TriliumNext/Trilium/issues/4880) — share URL generation uses wrong instance's base URL in a synced pair.
- [#5278 — Handle development user Javascript widgets more elegantly](https://github.com/TriliumNext/Trilium/issues/5278) — safe mode exists (`d97737756c chore(build): disable safe mode by default`) but reporter wants sandboxed live editing, which is a bigger architectural change.

## Feature Requests

- [#5281 — Change `clone` terminology](https://github.com/TriliumNext/Trilium/issues/5281)
- [#5268 — Register icon pack in mermaid](https://github.com/TriliumNext/Trilium/issues/5268)
- [#5228 — SOCKS Proxy Support in TriliumNext Desktop App](https://github.com/TriliumNext/Trilium/issues/5228)
- [#5217 — Friendly share urls: turn title into shareAlias](https://github.com/TriliumNext/Trilium/issues/5217)
- [#5205 — Image zoom / gallery view for shared notes](https://github.com/TriliumNext/Trilium/issues/5205)
- [#5199 — Export of HTML with `[missing note]` could retain names](https://github.com/TriliumNext/Trilium/issues/5199)
- [#5195 — Internal links to notes in Mermaid diagrams](https://github.com/TriliumNext/Trilium/issues/5195)
- [#5190 — Drag and drop note icon to insert link in note](https://github.com/TriliumNext/Trilium/issues/5190)
- [#5183 — Inline reference to labels](https://github.com/TriliumNext/Trilium/issues/5183)
- [#5126 — AVIF image compression support](https://github.com/TriliumNext/Trilium/issues/5126)
- [#5122 — (Try to) sync app on shutdown](https://github.com/TriliumNext/Trilium/issues/5122)
- [#5108 — Deploy to Flathub](https://github.com/TriliumNext/Trilium/issues/5108) (flatpak build exists via electron-forge; publishing step still missing)
- [#5089 — Template-typed attributes/relationships](https://github.com/TriliumNext/Trilium/issues/5089)
- [#5086 — Investigate Windows additional package managers (winget/chocolatey/scoop)](https://github.com/TriliumNext/Trilium/issues/5086)
- [#5049 — Appearance Settings Optional Sync](https://github.com/TriliumNext/Trilium/issues/5049)
- [#5044 — Calendar overview of Note activity](https://github.com/TriliumNext/Trilium/issues/5044)
- [#4989 — Keyboard shortcuts for more actions](https://github.com/TriliumNext/Trilium/issues/4989) (tracker)
- [#4969 — Note editors other than CKEditor](https://github.com/TriliumNext/Trilium/issues/4969) (tracker)
- [#4957 — End-to-end encryption (database-level)](https://github.com/TriliumNext/Trilium/issues/4957) (tracker)
- [#4956 — Milestone: Multi-user support](https://github.com/TriliumNext/Trilium/issues/4956) (tracker)
- [#4922 — Restore backed up database files to notes](https://github.com/TriliumNext/Trilium/issues/4922)
- [#4885 — Reload read position after "go back" from attachment view](https://github.com/TriliumNext/Trilium/issues/4885)
- [#4871 — Adding Elestio as deployment option](https://github.com/TriliumNext/Trilium/issues/4871)
- [#4870 — Synchronized Devices Dashboard in Trilium](https://github.com/TriliumNext/Trilium/issues/4870)
- [#4854 — Add a visual diff to split window](https://github.com/TriliumNext/Trilium/issues/4854)

## Skipped / Unclear

- [#5280 — Dependency Dashboard](https://github.com/TriliumNext/Trilium/issues/5280) — Renovate bot tracker, not an actionable issue.
