# Batch 07 — Issues #5298–#5526

## Easy-Fix Candidates

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

## Likely Already Fixed

### [#5341 — Duplicate HTML ids for tabs of the same view](https://github.com/TriliumNext/Trilium/issues/5341)
- **Evidence**: The options UI has been migrated to Preact (`apps/client/src/widgets/type_widgets/options/*.tsx`). `FormGroup` now generates IDs via `useUniqueName(name)` which returns `${name}-${randomString(10)}` (see `apps/client/src/widgets/react/FormGroup.tsx:19` and `hooks.tsx:372`). `FormCheckbox`, `FormRadioGroup`, `Collapsible`, and `Dropdown` all use the same hook. Every rendered instance therefore gets a fresh random ID.
- **Verification needed**: Open two options tabs in the same window and inspect the DOM to confirm no duplicate IDs remain across the multi-tab view.

## Notable Non-Easy Issues
- [#5526 — Investigate Creating/Shipping AppArmor Profile](https://github.com/TriliumNext/Trilium/issues/5526) — packaging work for deb/rpm AppArmor profile, non-trivial distro integration.
- [#5525 — Unable to launch desktop client - Permission denied](https://github.com/TriliumNext/Trilium/issues/5525) — likely the same AppArmor/chrome-sandbox issue as #5333; needs reproduction on target distro.
- [#5520 — Hidden notes hierarchy becomes apparent after importing a note](https://github.com/TriliumNext/Trilium/issues/5520) — tree state bug after import; requires debugging froca/tree update logic.
- [#5517 — Keyboard Shortcuts can be assigned multiple times](https://github.com/TriliumNext/Trilium/issues/5517) — needs cross-action duplicate detection + warning UI in `shortcuts.tsx`.
- [#5508 — Check which API endpoints are not protected / publicly accessible](https://github.com/TriliumNext/Trilium/issues/5508) — security audit task spanning all routes.
- [#5504 — Import markdown leaves out image](https://github.com/TriliumNext/Trilium/issues/5504) — markdown/zip import bug needing investigation of image resolution.
- [#5493 — Context Menu should use `menu` element](https://github.com/TriliumNext/Trilium/issues/5493) — DOM refactor across the entire context menu implementation.
- [#5482 — Option to disable Electron built-in shortcuts (Ctrl+Q etc.)](https://github.com/TriliumNext/Trilium/issues/5482) — needs interception of Electron-level accelerators; must survive restarts.
- [#5472 — Check what environmental variables are in use](https://github.com/TriliumNext/Trilium/issues/5472) — codebase audit + refactor task.
- [#5470 — Expose In UI which Settings are Auto-Synced](https://github.com/TriliumNext/Trilium/issues/5470) — requires new option metadata field and UI indicator across every option.
- [#5467 — Check if ETAPI OpenAPI spec is up-to-date](https://github.com/TriliumNext/Trilium/issues/5467) — full ETAPI audit.
- [#5446 — shareAlias should warn you if the alias is already used](https://github.com/TriliumNext/Trilium/issues/5446) — needs attribute-change validation hook + user-facing warning dialog.
- [#5443 — Include attributes in revisions](https://github.com/TriliumNext/Trilium/issues/5443) — fundamental change to revision model (schema + restore logic).
- [#5442 — Protected notes not protected from deletion, attribute visibility](https://github.com/TriliumNext/Trilium/issues/5442) — security model change.
- [#5436 — Map not visible when note is shared](https://github.com/TriliumNext/Trilium/issues/5436) — geomap not rendering in shaca share templates.
- [#5432 — note.noteSize and note.contentSize doesn't work in Note Search](https://github.com/TriliumNext/Trilium/issues/5432) — `noteSize` is not a real property (doesn't exist in Becca); `contentSize` looks like it should work but `property_comparison.ts:61` compares the already-camelCased name against a lowercase-only allowlist, breaking the `dbLoadNeeded` flag. Needs either a docs update or a proper fix + alias.
- [#5431 — Text note contents disappear when switching Read-Only to editable](https://github.com/TriliumNext/Trilium/issues/5431) — non-deterministic editor sync bug.
- [#5426 — Autoformat inline code when typing between backticks](https://github.com/TriliumNext/Trilium/issues/5426) — CKEditor autoformat plugin change.
- [#5424 — Autoformat Code-Block with language](https://github.com/TriliumNext/Trilium/issues/5424) — CKEditor autoformat plugin change with new parsing flow.
- [#5423 — `~child:child:template=...` not applied automatically](https://github.com/TriliumNext/Trilium/issues/5423) — template inheritance walker bug.
- [#5383 — Large Code Blocks in Text Notes Break Syntax Highlight](https://github.com/TriliumNext/Trilium/issues/5383) — highlight.js / CKEditor performance boundary.
- [#5380 — Make Initial Sync timeout value configurable](https://github.com/TriliumNext/Trilium/issues/5380) — requires new option + config plumbing.
- [#5359 — i18n: keyboard shortcuts from keyboard_actions service are not translatable](https://github.com/TriliumNext/Trilium/issues/5359) — needs extracting all action descriptions into translations.
- [#5346 — Notes experiencing automatic snapshot recovery](https://github.com/TriliumNext/Trilium/issues/5346) — potentially serious data-loss bug, needs repro.
- [#5336 — UX: friendly numbers in settings (parent)](https://github.com/TriliumNext/Trilium/issues/5336) — parent tracking issue; subtasks handled individually.
- [#5333 — SUID sandbox helper binary found but not configured](https://github.com/TriliumNext/Trilium/issues/5333) — same class as #5525/#5526, chrome-sandbox setup.
- [#5315 — Desktop app initial sync never stops](https://github.com/TriliumNext/Trilium/issues/5315) — sync loop bug that needs server-side investigation.
- [#5298 — Consider changing the default port](https://github.com/TriliumNext/Trilium/issues/5298) — Electron uses 37740/37840 (ephemeral range); changing requires care to avoid collisions; not a one-line fix.

## Feature Requests
- [#5511 — Calculated Content in Templates via Inline Javascript](https://github.com/TriliumNext/Trilium/issues/5511)
- [#5509 — Dynamic themes](https://github.com/TriliumNext/Trilium/issues/5509)
- [#5497 — Undo, permanent delete: add as action for note tree](https://github.com/TriliumNext/Trilium/issues/5497)
- [#5481 — Selected Note API](https://github.com/TriliumNext/Trilium/issues/5481)
- [#5480 — Notification API](https://github.com/TriliumNext/Trilium/issues/5480)
- [#5475 — Add keyboard shortcuts for managing splits](https://github.com/TriliumNext/Trilium/issues/5475)
- [#5451 — Add polylines or polygons on the geomap note type](https://github.com/TriliumNext/Trilium/issues/5451)
- [#5411 — Auto-hide the tab bar and toolbar in full-screen mode](https://github.com/TriliumNext/Trilium/issues/5411)
- [#5410 — Add the ability to create a shell link (shortcut) for a note](https://github.com/TriliumNext/Trilium/issues/5410)
- [#5401 — Confusing behaviour when the application is minimized in system tray](https://github.com/TriliumNext/Trilium/issues/5401)
- [#5363 — Option to open HTML attachment in browser instead of download](https://github.com/TriliumNext/Trilium/issues/5363)
- [#5362 — Unify/hide duplicate find dialogs/widgets](https://github.com/TriliumNext/Trilium/issues/5362)
- [#5361 — UX: image options clarification](https://github.com/TriliumNext/Trilium/issues/5361)
- [#5357 — Mind Map: Ability to add images as node](https://github.com/TriliumNext/Trilium/issues/5357)
- [#5355 — Import/Merge Another Trilium Database Into Current database](https://github.com/TriliumNext/Trilium/issues/5355)
- [#5350 — Save clip with prompt to add meta note](https://github.com/TriliumNext/Trilium/issues/5350)
- [#5344 — Importing html images as attached instead of external reference](https://github.com/TriliumNext/Trilium/issues/5344)
- [#5337 — UX: Code blocks: sort mime type by most used](https://github.com/TriliumNext/Trilium/issues/5337)
- [#5332 — Improve search result highlighting](https://github.com/TriliumNext/Trilium/issues/5332)
- [#5305 — Note Tree Sidebar - Confirmation Dialogue When Dragging and Dropping](https://github.com/TriliumNext/Trilium/issues/5305)
- [#5303 — Creating human-readable URL aliases without sharing](https://github.com/TriliumNext/Trilium/issues/5303)

## Skipped / Unclear
_(none — every issue in this batch is categorized above)_
