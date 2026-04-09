# Easy-Fix Candidates — Trilium Issue Review

Consolidated from per-batch analysis of all 859 open issues (as of 2026-04-09).
Total easy-fix candidates identified: **61**

Each item below was classified by a subagent reviewing issue bodies individually. Effort and confidence are the subagent's estimate. Before picking one up, re-read the original issue and verify the proposed solution against current `main`.

---

## From Batch 01

### [#9330 — Web clipper setup fails with trailing / in server setup](https://github.com/TriliumNext/Trilium/issues/9330)
- **Problem**: Entering `https://server/` (trailing slash) in the web clipper options form produces malformed requests (`//api/...`) because the URL isn't normalized.
- **Proposed solution**: In `apps/web-clipper/entrypoints/options/index.ts`, strip any trailing slash from `$triliumServerUrl.val()` before storing it (lines 32, 63). Also defensively trim it again when read in `apps/web-clipper/entrypoints/background/trilium_server_facade.ts` (line 121) before concatenating with the API path.
- **Effort**: trivial
- **Confidence**: high

### [#8882 — Desktop (macOS ARM64): window shows `{"message":"Not Found"}` on startup](https://github.com/TriliumNext/Trilium/issues/8882)
- **Problem**: In Electron, `res.sendFile(path.join(publicDir, "index.html"))` fails because `send`/streaming cannot read from inside the `app.asar` archive; reporter identified the root cause and the fix.
- **Proposed solution**: In `apps/server/src/routes/assets.ts` line 72 (non-dev branch), replace `res.sendFile(path.join(publicDir, "index.html"), STATIC_OPTIONS)` with a `readFile` + `res.send()` (Electron patches `fs.readFile` to work inside asar, but not `send`'s streaming pipeline). Set `Content-Type: text/html; charset=utf-8`.
- **Effort**: trivial
- **Confidence**: high

### [#8916 — Note Map view of `Hidden Notes` freezes Trilium](https://github.com/TriliumNext/Trilium/issues/8916)
- **Problem**: Invoking Note Map on the `_hidden` root attempts to render thousands of system nodes and hangs the renderer irrecoverably (edge case).
- **Proposed solution**: In the note-map widget (`apps/client/src/widgets/type_widgets/note_map.tsx` or similar — search `noteMap`), short-circuit the render when `note.noteId === "_hidden"` or when the aggregate number of descendants exceeds a threshold; show a warning instead of computing the graph. Alternatively hide the "Note map" entry from the `...` menu when the current note is `_hidden` (or any note ancestored by it) via a simple guard in the menu population code.
- **Effort**: small
- **Confidence**: medium — the guard is trivial to add, but the exact file path depends on where the note-map command is currently wired after the React port.

### [#8850 — Search does not work for `#clipType=note`](https://github.com/TriliumNext/Trilium/issues/8850)
- **Problem**: Searching `#clipType=note` returns all notes in 0.101.3 and throws an error in nightly. The literal value `note` likely collides with the search DSL keyword `note` (note title predicate).
- **Proposed solution**: In `apps/server/src/services/search/` token parsing, quote/escape attribute values when they match reserved keywords, or force attribute-expression RHS parsing to treat the RHS as a literal until whitespace. Simplest targeted fix: ensure the attribute-value tokenizer does not re-interpret `note` as a type keyword when it appears after `=`. Reporter-visible workaround is `#clipType="note"` (confirm this works before closing).
- **Effort**: small
- **Confidence**: low — the symptom points at the search tokenizer but the root cause needs a quick repro against current code.

### [#8900 — Uncaught TypeError thrown when switching notes with bottom-right attribute window open](https://github.com/TriliumNext/Trilium/issues/8900)
- **Problem**: Switching notes while the attribute detail popup is open throws a console TypeError (no visible break). Classic missing null-check on teardown.
- **Proposed solution**: Find the attribute detail widget (`apps/client/src/widgets/ribbon/attributes/*` or `widgets/attribute_widgets`) and guard the cleanup handler to check whether the widget/element still exists before calling into it. The user screenshot would pinpoint the exact line; a defensive `if (!$elem?.length) return;` at the top of the refresh/hide handler is typical.
- **Effort**: trivial
- **Confidence**: medium — confidence hinges on identifying the exact handler from the screenshot; the fix itself is one line.

### [#9174 — Right navigation (TOC) font doesn't match editor until you keep typing](https://github.com/TriliumNext/Trilium/issues/9174)
- **Problem**: When you change a heading's style in the editor, the TOC side panel doesn't re-render using the new style until more content is added.
- **Proposed solution**: The TOC widget subscribes to content changes but likely ignores "attribute-only" (style) changes. In the TOC widget (`apps/client/src/widgets/right_panel/*toc*` or `table_of_contents*.tsx`) ensure the listener refreshes on model changes that alter heading attributes too — typically replacing a content-only comparison with a re-render on every editor `change` event, or listening to CKEditor's `change:data` broadly.
- **Effort**: small
- **Confidence**: medium

---

## From Batch 02

### [#8561 — documentation - word count widget](https://github.com/TriliumNext/Trilium/issues/8561)
- **Problem**: Word count widget docs don't prominently state the note must have the `#wordCount` label.
- **Proposed solution**: Edit `apps/server/src/assets/doc_notes/en/User Guide/User Guide/Scripting/Frontend Basics/Custom Widgets/Word count widget.html` to add an explicit note (admonition) above the code snippet stating: "The widget only activates on text notes that carry the `#wordCount` label (it can be inherited)." The code comment already mentions this but it's buried inside the example code block.
- **Effort**: trivial
- **Confidence**: high

### [#8401 — router not found for request GET /api/search](https://github.com/TriliumNext/Trilium/issues/8401)
- **Problem**: Third-party Home Assistant addon gets "router not found" on `GET /api/search`.
- **Proposed solution**: Not a Trilium bug — the route is `/api/search/:searchString` (see `apps/server/src/routes/routes.ts:255`). The addon is calling the route without the required path parameter. Close as invalid with a pointer to the addon author.
- **Effort**: trivial (close with explanation)
- **Confidence**: high

### [#8322 — Code block tries to link/create note when typing @, and suggests slash-commands when typing /](https://github.com/TriliumNext/Trilium/issues/8322)
- **Problem**: Inside full `code` blocks in text notes, typing `@` triggers the note-link autocomplete and `/` triggers slash commands.
- **Proposed solution**: In the CKEditor mention/slash-command plugin configuration (`packages/ckeditor5/src/plugins` area that wires Mention/SlashCommand), disable the mention & slash-command feeders when the selection is inside a `codeBlock` element. Typically a single predicate check. Worth verifying but should be small.
- **Effort**: small
- **Confidence**: medium
- **Note**: the issue body contains an image with a prompt-injection attempt in its `alt` attribute which I ignored.

---

## From Batch 03

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

---

## From Batch 04

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

---

## From Batch 05

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

---

## From Batch 06

### [#5712 — Tooltip z-index is too low?](https://github.com/TriliumNext/Trilium/issues/5712)
- **Problem**: Tooltips in context menus appear behind Bootstrap modals because tooltip z-index is `calc(var(--ck-z-panel) - 1)` (~998), while Bootstrap modal z-index is 1055.
- **Proposed solution**: In `apps/client/src/stylesheets/style.css` around line 733, raise `.tooltip` z-index above modal (e.g. `z-index: 1060 !important;` to match the Bootstrap default of 1080, or set it with `calc(var(--bs-modal-zindex, 1055) + 5)`). Confirmed the file at `apps/client/src/stylesheets/style.css:731-734` still has the old value and `bootstrap.rtl.css:5454` sets `--bs-modal-zindex: 1055`.
- **Effort**: trivial
- **Confidence**: high

### [#5617 — Clean up the code formatting](https://github.com/TriliumNext/Trilium/issues/5617)
- **Problem**: Maintenance task — enable format-on-save, apply formatting to repo, enable import sort/unused-import cleanup.
- **Proposed solution**: Flip `editor.formatOnSave` to `true` in `.vscode/settings.json` (currently line 2: `"editor.formatOnSave": false`), add import ordering ESLint rule, then run `pnpm prettier --write`/eslint autofix on the codebase. The repo already has `eslint-config-prettier` and `@stylistic` rules wired up.
- **Effort**: small (mechanical, but touches many files)
- **Confidence**: medium — task scope is clear but apply-all-fix is large enough to risk conflicts with open PRs (as the issue itself warns).

---

## From Batch 07

### [#5494 — Context Menu click on Submenu parent should not trigger event/close the context menu](https://github.com/TriliumNext/Trilium/issues/5494)
- **Problem**: Left-clicking a submenu parent (e.g. "Insert note after") still fires its own `handler` / `selectMenuItemHandler`, creating a new note without the user actually picking a subitem.
- **Proposed solution**: In `apps/client/src/menus/context_menu.ts` (createMenuItem mousedown handler, around lines 319–323), gate the `item.handler(...)` and `selectMenuItemHandler(...)` calls behind `if (!("items" in item && item.items))`. The non-mobile branch already short-circuits `this.hide()` for submenu parents (line 315), so only the handler invocation needs the same guard.
- **Effort**: trivial
- **Confidence**: high

### [#5371 — Titles of Settings/Options are renamable](https://github.com/TriliumNext/Trilium/issues/5371)
- **Problem**: The title input in Options pages is editable, letting users rename hidden system notes like `_optionsAppearance`.
- **Proposed solution**: In `apps/client/src/widgets/note_title.tsx` (lines 24–32), extend the `isReadOnly` check to also return `true` when `note.noteId.startsWith("_options")` (alongside the existing `_help_` and `isLaunchBarConfig` clauses).
- **Effort**: trivial
- **Confidence**: high

### [#5375 — `replaceMathTextWithKatax` method is duplicated in `highlight_list.ts` and `toc.js`](https://github.com/TriliumNext/Trilium/issues/5375)
- **Problem**: Same helper exists in both `highlights_list.ts` and `toc.ts` (verified via Grep — `toc.ts:240` and `highlights_list.ts`).
- **Proposed solution**: Extract the function into a small shared module under `apps/client/src/services/` (e.g. `math_renderer.ts`) and import it from both widgets. Pure refactor, no behavior change.
- **Effort**: trivial
- **Confidence**: high

### [#5311 — New API method: isMobile()](https://github.com/TriliumNext/Trilium/issues/5311)
- **Problem**: Scripts have no way to detect if they are running on the mobile/desktop/web client.
- **Proposed solution**: `utils.isMobile()` already exists in `apps/client/src/services/utils.ts:226`. Just expose it on the frontend script API — add `isMobile: utils.isMobile` to the API constructor in `apps/client/src/services/frontend_script_api.ts` (and the Preact variant) alongside the other utility re-exports. No backend work needed.
- **Effort**: trivial
- **Confidence**: high

### [#5513 — UX: friendly numbers in settings: Sync timeout](https://github.com/TriliumNext/Trilium/issues/5513)
- **Problem**: Sync timeout is shown in milliseconds with no human-friendly unit (sub-task of #5336).
- **Proposed solution**: In `apps/client/src/widgets/type_widgets/options/sync.tsx` (around line 59–65), either change the unit to seconds (divide/multiply by 1000 on read/write) or reuse a "time value + unit" composite, plus update the `sync_2.timeout_unit` key in `apps/client/src/translations/en/translation.json` (currently "milliseconds").
- **Effort**: small
- **Confidence**: medium (straightforward but touches save/load conversion)

### [#5444 — UX: friendly numbers in settings: Zoom factor (percent better than decimal factor)](https://github.com/TriliumNext/Trilium/issues/5444)
- **Problem**: Zoom factor in Appearance options is shown as a 0.3–2.0 decimal (verified at `appearance.tsx:342–347`), while the global menu already uses percent.
- **Proposed solution**: In `apps/client/src/widgets/type_widgets/options/appearance.tsx` `ElectronIntegration`, switch the `FormTextBox` to a percent input (min 30, max 200, step 10) and multiply/divide by 100 when reading/writing the `zoomFactor` option. The ideal refactor (extracting `zoom-container` from `global_menu.tsx`) is nice-to-have but not required for a first fix.
- **Effort**: small
- **Confidence**: high

### [#5414 — Localization: add support to follow the system language](https://github.com/TriliumNext/Trilium/issues/5414)
- **Problem**: No "System default" option in the locale dropdown.
- **Proposed solution**: Add a sentinel value (e.g. `"auto"`) to the locale combo in `apps/client/src/widgets/type_widgets/options/i18n.tsx` and make it the default for new installs. When selected, resolve the effective locale by matching `navigator.language` against the list of supported locales (`apps/client/src/services/i18n.ts` exposes them), falling back to English. No server changes required because language is a client option.
- **Effort**: small
- **Confidence**: medium

### [#5376 — Add "Open Note" to list of search actions](https://github.com/TriliumNext/Trilium/issues/5376)
- **Problem**: Search actions lack an "Open Note" entry to open all matching notes.
- **Proposed solution**: Search actions are registered in `apps/server/src/services/search/actions/` (e.g. `set_attribute.ts`, etc.) and the UI picker in `apps/client/src/widgets/search_actions/`. Add a new action class that emits an `openNote`/`openNoteInNewTab` command per result, plus a corresponding UI entry. Modest scope because existing actions already provide a clear template.
- **Effort**: small
- **Confidence**: medium

---

## From Batch 08

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

---

## From Batch 09

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

---

## From Batch 10

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

---

## From Batch 11

### [#3697 — Docker : Set USER_GID to 100 (Feature request)](https://github.com/TriliumNext/Trilium/issues/3697)
- **Problem**: `start-docker.sh` runs `groupmod -g ${USER_GID} node`, which fails when GID 100 already exists (e.g. Unraid's default `users` group).
- **Proposed solution**: `apps/server/start-docker.sh` line 4 currently uses `groupmod -og ${USER_GID} node` (the `-o` flag allows a non-unique GID). This is likely already the fix — verify the published Docker image ships this and close. If `rootless-entrypoint.sh` still lacks `-o`, add it there too.
- **Effort**: trivial
- **Confidence**: high (code already uses `-og`, just needs image-release verification)

---

## From Batch 12

### [#3151 — (Bug report) Import from HTML does not restore indentation](https://github.com/TriliumNext/Trilium/issues/3151)
- **Problem**: Exported HTML has `style="margin-left:40px"` on `<p>` but importing strips that style, losing indentation.
- **Proposed solution**: In `/home/elian/Projects/Trilium/apps/server/src/services/html_sanitizer.ts` (line ~49 `allowedStyles`), add `margin-left` (and likely `padding-left`, `text-align`) to the allowed styles for `p` (or `*`). Currently only `color`/`background-color` are globally allowed; the entire `style` attribute is preserved but sanitize-html strips unknown properties.
- **Effort**: small
- **Confidence**: high

### [#2817 — open internal link in OSX apps](https://github.com/TriliumNext/Trilium/issues/2817)
- **Problem**: `bookends:` URLs don't open externally from notes because the protocol isn't in the allow-list.
- **Proposed solution**: Add `bookends` (and any other commonly requested scheme) to `ALLOWED_PROTOCOLS` in `/home/elian/Projects/Trilium/packages/commons/src/lib/shared_constants.ts`. The CKEditor/link handler already calls `electron.shell.openExternal` for allowed protocols (see `apps/client/src/services/link.ts:338`).
- **Effort**: trivial
- **Confidence**: medium (fix is trivial; user may also need CKEditor to permit `bookends:` hrefs in the schema)

---

## From Batch 13

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

---

## From Batch 14

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

---

## From Batch 15

### [#762 — [UX] Print paths with colored '/' separators](https://github.com/TriliumNext/Trilium/issues/762)
- **Problem**: When a note title contains `/`, the note-path breadcrumbs become ambiguous; a visually distinct separator would disambiguate.
- **Proposed solution**: In the path-rendering code (search `apps/client/src/services/tree.ts` / `apps/client/src/widgets/note_tree.ts` for `getNotePath` / `/` concatenation, and `apps/client/src/widgets/note_path_list_widget.*`), wrap the separator in `<span class="note-path-separator">/</span>` and add a subtle color/bold rule in the corresponding CSS. Purely a rendering tweak.
- **Effort**: small
- **Confidence**: medium — straightforward once the exact render site is located.

### [#342 — Warn if user is trying to run the script in a wrong environment](https://github.com/TriliumNext/Trilium/issues/342)
- **Problem**: When a frontend script is invoked on the backend (or vice versa) it silently fails; the user gets no helpful message.
- **Proposed solution**: In `apps/server/src/services/script.ts` (backend execution) check `note.mime` / `note.getLabelValue("runOnBackend")` against the caller context and throw a descriptive error; mirror in `apps/client/src/services/script_context.ts` for frontend. Single `if` with a clear error message per side.
- **Effort**: small
- **Confidence**: medium — the two script runners exist, just need a type guard + thrown error.

### [#21 — Script execution should error out on usage of protected notes outside of protected session](https://github.com/TriliumNext/Trilium/issues/21)
- **Problem**: Scripts silently fail in unpredictable ways when they access protected notes without a protected session.
- **Proposed solution**: In `apps/server/src/services/script.ts` (and `script_context.ts`), before invoking the script check `note.isProtected && !protectedSessionService.isProtectedSessionAvailable()` and throw a clear error (e.g. "Cannot run protected script without a protected session"). No such guard currently exists per `grep` on the script services.
- **Effort**: small
- **Confidence**: high — isolated pre-check in one place.
