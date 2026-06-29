# CKEditor 5 defect patterns (Trilium)

The high-value, easy-to-miss failure modes to hunt during a correctness review of a Trilium
CKEditor 5 plugin. Each: **symptom**, how to **spot** it in a diff, **why** it's wrong, and the
**fix**. Grouped by layer. The **Conversion → Tests** groups are CKEditor-library-general (they
apply unchanged to Trilium's `packages/ckeditor5-*` plugins); the final **Trilium integration**
group covers the monorepo wiring/convention defects. For the idiomatic "how it should look," see the
`ckeditor5-plugin-development` skill.

## Conversion

**Asymmetric / incomplete conversion.**
- Spot: a model element/attribute with an `upcast` but no `dataDowncast` (or vice versa); or only
  `editingDowncast`. Count `for('upcast')` vs `for('dataDowncast')`/`for('editingDowncast')` — but
  remember a **two-way** helper (`conversion.elementToElement`/`attributeToElement`/`attributeToAttribute`)
  registers both directions at once.
- Why: missing `dataDowncast` → content silently dropped on `getData()` (data loss). Missing
  `upcast` → pasted/loaded HTML doesn't become the model. Missing `editingDowncast` → nothing
  renders in the editor.
- Fix: ensure every rendered/round-tripped element & attribute has matching upcast + downcast.

**Editing-only wrapping leaking into data.**
- Spot: `toWidget` / `toWidgetEditable` / UI elements / `contentEditable` / widget classes in a
  `dataDowncast` (or a two-way converter used for a widget).
- Why: `getData()` then emits editor-only markup (`ck-widget`, `contenteditable`) — dirty output.
- Fix: put widget wrapping in `editingDowncast` only; keep `dataDowncast` clean.

**Unconsumed elements in a custom upcast converter → duplication.**
- Spot: a manual `for('upcast').add(dispatcher => …)` that returns early without
  `consumable.consume(...)`, or never consumes the element it handles.
- Why: leftover elements get re-processed by catch-all converters (General HTML Support) →
  duplicated output like `<a><a>…</a></a>`.
- Fix: `test()` before `consume()`, and consume on **every** path that handles the element. (See the
  plugin-dev `conversion.md` consumables section.)

**View element treated as DOM.**
- Spot: `.dataset`, `.classList`, `.getAttributeNS`, `.style.x` on the element inside an
  upcast/downcast callback.
- Why: it's a CKEditor *view* element — those DOM-only APIs return `undefined` and silently drop
  data. Tests that mock the view tree won't catch it.
- Fix: `getAttribute` / `hasAttribute` / `hasClass` / `getClassNames()`; mutate via the view writer.

**Missing reconversion.**
- Spot: an `elementToElement`/`elementToStructure` whose view depends on a model attribute, but the
  attribute isn't listed in the model matcher (`model: { name, attributes: [ 'x' ] }`).
- Why: the view goes stale when the attribute changes (the converter doesn't re-run).
- Fix: declare the attribute to trigger reconversion, or use a separate `attributeToAttribute`/
  `attributeToElement` converter, or `editor.editing.reconvertItem(item)`.

**Clipboard-pipeline handler bound to the wrong emitter (silently dead).**
- Spot: `listenTo(editor.plugins.get(Clipboard), 'inputTransformation'|'contentInsertion', …)` — the
  handler is attached to the `Clipboard` *umbrella* glue plugin (a real one in `ckeditor5-math/src/automath.ts:28`).
- Why: those events fire on **`ClipboardPipeline`**, not `Clipboard` (which only `requires` it), so the
  handler never runs — no error, no test failure (a Trilium handler sat dead ~1 year this way).
- Fix: `listenTo(editor.plugins.get(ClipboardPipeline), 'inputTransformation', …)`.

## Schema

**Object/limit flags wrong.**
- Spot: a self-contained element registered without `$blockObject`/`$inlineObject` (or `isObject`);
  a nested editable (title/caption) without `isLimit`.
- Why: without object semantics the element is splittable/partly-selectable/mis-deleted; without
  `isLimit` the caret escapes the editable and Enter/Backspace break it.
- Fix: `inheritAllFrom: '$blockObject' | '$inlineObject'` for atomic elements; `isLimit: true` +
  `allowContentOf` for nested editables.

**Relying on the schema to filter pasted HTML.**
- Spot: assuming a disallowed attribute/element is stripped on paste purely via schema.
- Why: filtering happens at **conversion** — elements/attributes with no registered converter are
  dropped before the schema is consulted. Schema governs structure, not input sanitization.
- Fix: don't register converters for things you don't want; rely on conversion + (if needed) GHS
  config, not schema alone.

**Inline-widget position mapping missing.**
- Spot: an inline object whose view has more content than the model (e.g. `<placeholder>` →
  `<span>{name}</span>`) without a `viewToModelPosition` mapper.
- Why: selecting/traversing it throws `model-nodelist-offset-out-of-bounds`.
- Fix: `editor.editing.mapper.on('viewToModelPosition', viewToModelPositionOutsideModelElement(...))`.

## Commands

**`refresh()` doesn't gate on the schema.**
- Spot: `refresh()` that sets `this.isEnabled = true` unconditionally, or omits a
  `schema.checkAttributeInSelection` / `checkChild` / `findAllowedParent` check.
- Why: the button is enabled where the action is illegal → no-op clicks or schema violations.
- Fix: derive `isEnabled` from a real schema check for the current selection.

**Model mutated outside `model.change()`.**
- Spot: `writer.*` calls or attribute changes not wrapped in `editor.model.change(writer => …)`.
- Why: changes outside a change block don't run conversion/diff → nothing happens (or corruption).
- Fix: wrap all model mutations; one logical operation = one `change()` block = one undo step.

**Boolean attribute stored as `false`.**
- Spot: `writer.setAttribute('secret', false, el)`.
- Why: the idiom is `true` to enable / **remove** to disable (→ `undefined`); `false` leaks into
  data and breaks `value` checks.
- Fix: `setAttribute(key, true)` / `removeAttribute(key)`.

**Collapsed vs. ranged not handled.**
- Spot: an attribute command that only loops `getRanges()` (ignores the collapsed-caret/selection-
  attribute case), or only sets the selection attribute (ignores ranged text).
- Fix: handle both — `getValidRanges()` for ranged, `setSelectionAttribute`/`removeSelectionAttribute`
  for collapsed.

**Read-only correctness.**
- Spot: a command that doesn't change data (opens a dialog, navigates) but gets disabled in
  read-only; or one that *does* change data but stays enabled.
- Fix: set `this.affectsData = false` for non-data commands; leave it `true` (default) otherwise.

**Fighting `refresh()`.**
- Spot: manual `command.isEnabled = false` from outside, undone on the next model change.
- Fix: `command.forceDisabled('MyFeature')` / `clearForceDisabled('MyFeature')`.

## UI

**State set imperatively instead of bound.**
- Spot: `button.isEnabled = …` / `button.isOn = …` updated by hand, or listeners syncing them.
- Why: drifts out of sync with the command.
- Fix: `button.bind('isOn','isEnabled').to(command,'value','isEnabled')`.

**Editor not refocused after an action.**
- Spot: a button/dropdown `execute` handler that runs the command but doesn't
  `editor.editing.view.focus()`.
- Why: focus stays on the button; the user can't keep typing.
- Fix: call `editor.editing.view.focus()` after executing.

**Views created without `locale`; missing a11y.**
- Spot: `new ButtonView()` with no `locale`; no `label` when `withText` is false; keystrokes not in
  `accessibility.addKeystrokeInfos`.
- Fix: pass `locale`; always set `label`; register keystroke info and the button `keystroke`.

## Lifecycle / leaks

**Trackers/handlers/timers not destroyed.**
- Spot: `FocusTracker`, `KeystrokeHandler`, `FocusCycler`, `ResizeObserver`, `setInterval`, or
  manually-added DOM listeners created but no `destroy()` cleaning them; balloon views never removed.
- Why: memory leaks across editor create/destroy cycles (CKEditor even has memory-leak tests).
- Fix: destroy them in the view/plugin `destroy()`; prefer `this.listenTo()` (auto-cleaned).

## Architecture / packaging

**Editing/UI split violated.**
- Spot: schema/converters/commands registered inside the `*UI` plugin; no glue plugin; missing
  `static get requires()` / `pluginName`.
- Why: breaks headless/server-side use and reuse of the editing layer.
- Fix: editing logic in `*Editing`, UI in `*UI`, glue plugin requiring both.

**Outdated / mixed imports (Trilium pins ckeditor5 48.2.0).**
- Spot: deep imports `@ckeditor/ckeditor5-*/src/...`; any `@ckeditor/*` package import instead of the
  `ckeditor5` aggregate; a `ckeditor5`/`@triliumnext/...` import *missing the file extension*;
  removed/renamed symbols (the UI model class is `ViewModel` — what Trilium's plugins use — not the
  old `Model`; `icons.check` → `IconCheck`).
- Why: Trilium always imports from the `ckeditor5` aggregate (pinned 48.2.0) or cross-plugin
  `@triliumnext/ckeditor5-<x>`, **with explicit file extensions** — `eslint-config-ckeditor5`
  (`require-file-extensions-in-imports`, `allow-imports-only-from-main-package-entry-point`,
  `no-legacy-imports`) fails the build otherwise; deep `@ckeditor/*` paths also risk duplicate
  module instances; renamed symbols don't exist.
- Fix: import from `ckeditor5` (or `@triliumnext/ckeditor5-<x>`) with the file extension; use current
  symbol names. (See the Trilium integration group below for the augmentation-module variant.)

## Localization

**`t()` gaps / misuse.**
- Spot: user-facing strings not wrapped in `t()`; `t` renamed or called on a variable (the static
  analyzer only recognizes a literal-arg `t()`); a reused string creating a new source message
  instead of aliasing `editor.locale.t`; a new `t('…')` string with no matching entry added to the
  plugin's `lang/en.po` (+ `lang/contexts.json` where context disambiguation is needed).
- Fix: wrap all UI strings in `t()` with a literal first arg; reuse via the `locale.t` alias; add the
  source string to `lang/en.po` and its context note to `lang/contexts.json`.

## Undo / batching

**Unintended multiple undo steps.**
- Spot: several sibling `model.change()` blocks for what is one logical edit.
- Why: each block is a separate undo step — jarring UX.
- Fix: one `change()` per logical operation (nested `change()` folds into the outer batch).

## Tests (cross-check with the testing skill)

- Spot: a behavior change with no new/changed test; assertions via DOM instead of
  `_getModelData`/`_getViewData`; only one selection shape covered; editor not destroyed in
  `afterEach`; legacy Chai/Sinon left in a touched file.
- Fix: test the change itself; assert on stringified model/view; cover collapsed + ranged +
  schema-disallowed; tear down. Tests are **Vitest** with real `ClassicEditor.create` and helpers
  from `ckeditor5`; run them via `pnpm --filter @triliumnext/ckeditor5-<f> test`.

## Trilium integration

The monorepo wiring and conventions — a plugin can be internally correct yet still broken because
nothing loads it, no button shows, or lint/license/localization is off.

**Plugin not registered in `plugins.ts`.**
- Spot: a new or renamed plugin class that is never added to `packages/ckeditor5/src/plugins.ts`, or
  added to the **wrong array** (`CORE_PLUGINS` / `TRILIUM_PLUGINS` / `EXTERNAL_PLUGINS` →
  `builtinPlugins`).
- Why: it never loads into the editor classes in `packages/ckeditor5/src/index.ts`
  (AttributeEditor[Balloon], ClassicEditor[Decoupled], PopupEditor[Balloon]) — the feature silently
  does nothing. (Exception: it may be pulled in transitively via another plugin's
  `static get requires()`; check the chain before flagging.)
- Fix: export the plugin and add it to the appropriate array so it reaches `builtinPlugins`.

**Unnecessary separate package.**
- Spot: a small/simple feature shipped as a new `@triliumnext/ckeditor5-<feature>` workspace
  package (its own `package.json`/tsconfig/build/`workspace:*` wiring).
- Why: project direction is to keep new plugins **in the aggregator** (`packages/ckeditor5/src/plugins/`,
  registered in `TRILIUM_PLUGINS`). A separate package is reserved for large, self-contained features
  (math, footnotes, mermaid, …); a thin one is needless overhead.
- Fix: move it into `packages/ckeditor5/src/plugins/` unless it's genuinely large/standalone. (Minor.)

**Toolbar component not wired up.**
- Spot: a plugin that registers a `componentFactory` button but no corresponding entry in
  `apps/client/src/widgets/type_widgets/text/toolbar.ts`.
- Why: the button never appears in the editor UI even though the plugin loaded.
- Fix: add the component name to the toolbar config.

**Import not from the aggregate / missing file extension.**
- Spot: imports from `@ckeditor/ckeditor5-*` (deep or top-level), or `ckeditor5` /
  `@triliumnext/ckeditor5-<x>` imports **without a file extension**.
- Why: `eslint-config-ckeditor5` (`require-file-extensions-in-imports`,
  `allow-imports-only-from-main-package-entry-point`, `no-legacy-imports`) fails the build.
- Fix: import from `ckeditor5` or cross-plugin `@triliumnext/ckeditor5-<x>`, always with the file
  extension. (See "Outdated / mixed imports" above.)

**License header inconsistent with the package.**
- Spot: a new file that adds or omits the CKSource header against the package's existing convention.
- Why: header/license practice is **not uniform** across Trilium's CKEditor packages (admonition
  carries the CKSource header; footnotes/math are `ISC`; keyboard-marker `GPL-3.0`; etc.).
- Fix: match the other source files in that package — don't add or strip headers wholesale. (Minor.)

**Augmentation via the wrong module.**
- Spot: `declare module '@ckeditor/ckeditor5-core'` (the upstream pattern) in a `.d.ts` /
  augmentation block.
- Why: Trilium augments the aggregate — the editor config/plugin-map types live on `ckeditor5`, so
  the wrong module declaration doesn't merge and the types are missing.
- Fix: `declare module 'ckeditor5'`.

**New UI strings missing from localization.**
- Spot: a new user-facing `t('…')` string with no entry in the plugin's `lang/en.po` (and, where
  context matters, `lang/contexts.json`).
- Why: the source catalog is incomplete; downstream translation can't pick the string up.
- Fix: add the string to `lang/en.po` and its context note to `lang/contexts.json`. (See the
  Localization group above.)

**Wrong test environment.**
- Spot: a widget/toolbar/layout-dependent test (anything needing real DOM geometry, focus, or
  rendering) running under **happy-dom** instead of browser mode; or vice-versa, a plain
  model/conversion test forced into the heavier browser mode.
- Why: Trilium splits environments — admonition/collapsible use **happy-dom**;
  math/mermaid/footnotes/keyboard-marker use **`@vitest/browser-webdriverio` browser mode** (NOT
  Playwright). A widget test under happy-dom gives false passes/failures because layout isn't real.
- Fix: match the plugin's configured environment; move browser-dependent assertions to a
  browser-mode package/config.
