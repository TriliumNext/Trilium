# Reviewing a CKEditor 5 plugin (Trilium)

A structured checklist for reviewing Trilium CKEditor plugin code under `packages/ckeditor5-*`.
Pair each item with the relevant reference file when you need the "why". Flag deviations; not
every item applies to every plugin (e.g. a UI-only or editing-only plugin). The Trilium
integration items at the end are specific to this monorepo.

## Architecture & structure

- [ ] **Editing/UI split**: a glue plugin (`static get requires() { return [ XEditing, XUI ]; }`),
      with schema/conversion/commands in `*Editing` and UI in `*UI`. Single-file plugins are ok
      for trivial features but a split is expected for anything reusable.
- [ ] `static get pluginName()` present (TS: `as const`) and `static get requires()` declares
      real dependencies (e.g. `Widget`, `ContextualBalloon`, `WidgetToolbarRepository`).
- [ ] Init logic in `init()`; cross-plugin runtime wiring in `afterInit()`.
- [ ] Plugin knows little about other plugins — collaborates via commands/events/schema, not
      reaching into internals.
- [ ] Self-configuring: schema pre-configured; config defaults via `editor.config.define()`,
      read via `editor.config.get()`. No required manual schema setup pushed onto the user.

## Schema

- [ ] Inline features `schema.extend( '$text', { allowAttributes } )`; elements/objects use
      `schema.register()` with correct `inheritAllFrom` (`$blockObject` / `$inlineObject` /
      `$block`) and `allowIn` / `allowContentOf`.
- [ ] Semantic flags correct: `isLimit` for non-splittable editables, object types for atomic
      elements; `addChildCheck`/`addAttributeCheck` used to disallow invalid nesting/attrs.

## Conversion

- [ ] Symmetric coverage: an **upcast** plus **downcast**; editing vs. data downcast split
      only when needed (widget/UI extras go to `editingDowncast` so `getData()` stays clean).
- [ ] Correct helpers/direction (`elementTo…` upcast, `…ToElement` downcast); `attributeToElement`
      naming reflects model-first thinking.
- [ ] Custom callback converters use the provided `writer`; consumables handled in advanced
      converters; inline widgets register `viewToModelPositionOutsideModelElement` mapping.
- [ ] Everything rendered/round-tripped has a converter (un-converted elements/attributes are
      filtered out).

## Commands

- [ ] Logic lives in a `Command`, not inline in a button handler.
- [ ] `refresh()` sets `isEnabled` from a real schema check (disabled where the attribute/child
      isn't allowed) and `value` reflecting current state; no manual state fighting `refresh()`.
- [ ] `execute()` wraps mutations in `model.change()`; handles collapsed vs. ranged selection;
      uses `getValidRanges`/`insertObject`/`insertContent` rather than unsafe low-level writes.
- [ ] Boolean attributes set `true` / removed (never stored as `false`).
- [ ] External disabling via `forceDisabled()/clearForceDisabled()`; `affectsData=false` only
      for non-data commands that must stay enabled in read-only.

## UI

- [ ] Components registered in `editor.ui.componentFactory.add(name, locale => view)`; `locale`
      passed to constructors.
- [ ] Button/dropdown state **bound** to command (`bind('isOn','isEnabled').to(command,'value','isEnabled')`),
      not manually toggled.
- [ ] Handlers call `editor.editing.view.focus()` after executing.
- [ ] Custom views encapsulate their DOM (no direct `element.*` writes that collide with
      bindings); dropdowns/dialogs/balloons use the provided helpers; balloons clean up via
      `clickOutsideHandler` and remove themselves on hide.

## Accessibility

- [ ] Keyboard support: `editor.keystrokes.set()` for shortcuts; form views use `FocusTracker`
      + `KeystrokeHandler` + `FocusCycler`, and **destroy** them in `destroy()`.
- [ ] Shortcuts registered with `editor.accessibility.addKeystrokeInfos()` and shown in the
      button `keystroke` tooltip; labels set even when `withText` is false.
- [ ] Dialogs/modals always leave a way to close (don't trap Esc without an alternative).

## Localization

- [ ] All user-facing strings go through `editor.t()` with a **literal** first argument (string
      or object literal), never a variable.
- [ ] New strings have matching entries in the plugin's `lang/en.po` (`msgctxt` + `msgid` +
      `msgstr`) **and** `lang/contexts.json` (message id → context). No upstream
      `window.CKEDITOR_TRANSLATIONS` / `add()` / webpack-language wiring.
- [ ] Plugins that accept a host `translate` config read it with the identity fallback
      (`?? ( key => key )`) so labels degrade gracefully (see collapsible).

## Conventions & hygiene

- [ ] Naming/imports/file names/CSS-BEM/JSDoc/TS rules per `conventions.md`; `CKEditorError`
      with `@error`.
- [ ] **Imports**: library symbols from `ckeditor5`; cross-package from `@triliumnext/*`; all
      local/relative imports carry **file extensions** (`./foo.js`).
- [ ] **License header** matches the package's existing convention (varies per package — some
      carry the CKSource header, some don't; don't add/strip wholesale).
- [ ] **`pluginName` / `requires`** declared `as const`; type augmentation done via
      `declare module 'ckeditor5'` (config + command/plugin maps).
- [ ] Custom SVG icons imported with `?raw` and re-exported via `export const icons = { … }`
      from `index.ts`.
- [ ] Listeners use `this.listenTo()` (auto-cleaned); any other resources cleaned in `destroy()`.
- [ ] `ckeditor5-metadata.json` updated for new public plugins/UI/HTML output.
- [ ] Model is the source of truth — no view hacks standing in for model state (except genuine
      view-only state like focus).

## Trilium integration

- [ ] Plugin registered in `packages/ckeditor5/src/plugins.ts` in the **correct array**
      (package-level plugins like the widget features go in `EXTERNAL_PLUGINS`; in-tree glue
      plugins go in the internal list).
- [ ] Toolbar component name added to
      `apps/client/src/widgets/type_widgets/text/toolbar.ts` (registering the component-factory
      entry alone won't surface it).
- [ ] Works across all three editor classes used by Trilium — `AttributeEditor` (Balloon),
      `ClassicEditor` (Decoupled), `PopupEditor` (Balloon + `BlockToolbar`).
- [ ] Block widgets enforce structural invariants with `registerPostFixer` (admonition,
      collapsible) rather than relying on command-side cleanup.
- [ ] **Tests use the right environment**: happy-dom for unit/model logic; WebdriverIO
      (browser) only where real DOM/layout is required.
