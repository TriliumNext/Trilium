---
name: ckeditor5-plugin-development
description: >-
  Write, extend, and review CKEditor 5 plugins in the Trilium (TriliumNext
  Notes) monorepo — the rich-text-note editor under packages/ckeditor5 and the
  @triliumnext/ckeditor5-<feature> plugin packages. Use when building or
  reviewing a Trilium CKEditor 5 feature/plugin, or when working with the
  editing engine (model, view, schema, conversion/upcast-downcast), commands,
  the UI library (buttons, dropdowns, dialogs, balloons, toolbars), widgets
  (block/inline, toWidget, nested editables), keystrokes, localization (t()/.po),
  registering a plugin into plugins.ts / the editor classes / toolbar.ts, or
  adding a plugin to the aggregator (or, for large features, a new
  @triliumnext/ckeditor5-* package). Covers the architecture,
  idiomatic patterns, Trilium packaging/registration, code-style conventions,
  and a review checklist.
---

# CKEditor 5 plugin development (Trilium monorepo)

CKEditor 5 is **plugin-based**: every feature — even typing and `<p>` support — is a
plugin. Without plugins the editor is an empty API. This skill is specific to **Trilium
(TriliumNext Notes)**, whose rich-text note editor is built from the CKEditor 5 library
(external dep, pinned `48.2.0`) plus Trilium's own plugins. In this repo the editor build
lives in `packages/ckeditor5` (`@triliumnext/ckeditor5`) and custom features live in
sibling `packages/ckeditor5-<feature>` workspace packages (`@triliumnext/ckeditor5-<feature>`:
admonition, collapsible, footnotes, keyboard-marker, math, mermaid). The editor is consumed
by `apps/client` (the text note widget). This skill distills how to write new Trilium plugins
and review existing ones idiomatically.

## When to use this skill

Use it whenever the task involves a Trilium CKEditor 5 plugin/feature: creating one (by default an
in-aggregator plugin under `packages/ckeditor5/src/plugins/`; a separate
`@triliumnext/ckeditor5-<feature>` package only for large self-contained features), extending one,
debugging editing behavior, registering a
plugin so it reaches the editor, or reviewing plugin code for correctness and convention
compliance. Trigger concepts include: model/view/schema, conversion (upcast/downcast),
`Command`, `editor.model.change()`, `ButtonView`/`componentFactory`, widgets (`toWidget`),
`ContextualBalloon`/`Dialog`, `editor.keystrokes`, `t()` localization, the `plugins.ts`
registry / editor classes / `toolbar.ts`, or a `@triliumnext/ckeditor5-*` package.

## The three pillars

These are the library's internal layers (upstream packages `ckeditor5-core`/`-engine`/`-ui`);
in Trilium you never import them by those paths — everything comes from the `ckeditor5` aggregate
(see below). They describe how the engine is organized:

1. **Core editor architecture** (library `ckeditor5-core`) — glue classes: `Editor`,
   `Plugin`, `Command`, plus the event/observable system.
2. **Editing engine** (library `ckeditor5-engine`) — the custom MVC data **model**, the
   **view** (virtual DOM), **schema**, and **conversion** between them. The biggest piece.
3. **UI library** (library `ckeditor5-ui`) — MVC views, templates, and components
   (buttons, dropdowns, dialogs, toolbars).

Mental model of the engine: there is **one model document** that is **converted** into two
views — the **editing view** (what the user sees/edits) and the **data view** (input/output
for `getData()`/`setData()`/paste). You almost always change the **model**; converters
render it to the view. Never hand-edit the view to represent model state.

```
data (HTML) ──upcast──▶ MODEL ──editing downcast──▶ editing view ──render──▶ DOM (contentEditable)
                          │
                          └────data downcast──────▶ data view ──▶ getData()/output HTML
```

## Importing CKEditor in Trilium

Import everything from the single **`ckeditor5`** aggregate package (pinned `48.2.0`; it is a
`peerDependency` + `devDependency` of every plugin package). Premium symbols come from
`ckeditor5-premium-features` (lazy-loaded, see `loadPremiumPlugins()`):

```ts
import { Plugin, ButtonView, Command, _setModelData } from 'ckeditor5';
```

- **Cross-plugin** imports use the workspace package name, e.g.
  `import { Kbd } from '@triliumnext/ckeditor5-keyboard-marker';`.
- **Every import includes its file extension** (`.js`/`.ts`/`.json`) — enforced by
  `eslint-config-ckeditor5` (`require-file-extensions-in-imports`), with
  `allow-imports-only-from-main-package-entry-point` and `no-legacy-imports` also active.
- The `@ckeditor/ckeditor5-*` deep paths you'll see in the library's own source (and cited in
  `references/core-plugin-patterns.md`) resolve to the same symbols, but in Trilium you always
  import from the `ckeditor5` aggregate to avoid duplicate-module-instance problems. The only
  routine exceptions are dev/debug packages: `@ckeditor/ckeditor5-icons` and the
  **CKEditor Inspector** (`import CKEditorInspector from '@ckeditor/ckeditor5-inspector';`).

## Plugin anatomy

A plugin `extends Plugin` (from `'ckeditor5'`). There is **no** `isOfficialPlugin`/`isPremiumPlugin`
flag in Trilium plugins. (License headers are not uniform across packages — some, e.g. admonition,
prefix files with a CKSource header; others don't. Match the package you're in; see
`references/conventions.md`.)

```ts
import { Plugin } from 'ckeditor5';
import FooEditing from './fooediting.js';
import FooUI from './fooui.js';

export default class Foo extends Plugin {
	// Dependencies — the editor loads these automatically before this plugin.
	static get requires() {
		return [ FooEditing, FooUI ] as const;
	}

	// Stable name (PascalCase = the package/folder) for editor.plugins.get( 'Foo' ).
	static get pluginName() {
		return 'Foo' as const;
	}

	init() {
		const editor = this.editor;   // the editor that loaded this plugin
		// Register schema, converters, commands, UI, keystrokes, listeners…
	}

	afterInit() {
		// Runs after ALL plugins' init(). Use it when you depend on another
		// plugin's runtime state (e.g. registering a widget toolbar).
	}

	// init()/afterInit() may return a Promise. Plugin extends a base that provides
	// destroy() and this.listenTo()/this.stopListening() (auto-cleaned on destroy).
}
```

Per-package `src/` layout (e.g. `packages/ckeditor5-admonition/src/`): `{feature}.ts` glue,
`{feature}editing.ts`, `{feature}ui.ts`, optional `{feature}command.ts`, `augmentation.ts`
(the `declare module 'ckeditor5'` types), and `index.ts` (re-exports glue + sub-plugins +
command types, plus `export const icons = { fooIcon }`). Complex plugins add `constants.ts`
(`ELEMENTS`/`ATTRIBUTES`/`COMMANDS`/`CLASSES`), `utils.ts` (model-query helpers), and split
`schema.ts`/`converters.ts`. Assets: `theme/{feature}.css`, `theme/icons/*.svg`,
`lang/en.po` + `lang/contexts.json`, `tests/`. See `references/conventions.md`.

Key rules (inherited from the upstream conventions via `eslint-config-ckeditor5`):

- Every feature is a plugin; plugins are **highly granular** and should know **as little
  about other plugins as possible** (communicate via commands, events, and the schema).
- **Split editing from UI.** The standard pattern is three plugins:
  - `Feature` — the **glue** plugin: `static get requires() { return [ FeatureEditing, FeatureUI ] as const; }`
  - `FeatureEditing` — schema, conversion, commands (works headless / server-side).
  - `FeatureUI` — buttons, dropdowns, balloons registered in `componentFactory`.
  This enables reuse (someone can take your editing layer and write a different UI). Simple
  text-attribute features can reuse the built-in `AttributeCommand` inline (see keyboard-marker).
- Register UI in `editor.ui.componentFactory.add( 'name', locale => view )`, then the component
  `'name'` is added to Trilium's toolbar config (`apps/client/.../text/toolbar.ts`).
- Make features self-configuring: pre-configure the schema and provide config defaults via
  `editor.config.define( 'feature', { … } )`, read with `editor.config.get( 'feature.key' )`.
- SVG icons are imported with `?raw` (`import fooIcon from '../theme/icons/foo.svg?raw';`) and
  surfaced through `export const icons = { fooIcon }` in `index.ts`.

## Minimal end-to-end example (inline text attribute)

A "highlight" feature = a `$text` attribute ↔ `<mark>` element, a command, a button, a
keystroke. This is the canonical shape for inline styling features.

```js
import { Plugin, Command, ButtonView } from 'ckeditor5';

class HighlightCommand extends Command {
	refresh() {
		const { document, schema } = this.editor.model;
		this.value = document.selection.getAttribute( 'highlight' );
		this.isEnabled = schema.checkAttributeInSelection( document.selection, 'highlight' );
	}
	execute() {
		const model = this.editor.model;
		const selection = model.document.selection;
		const newValue = !this.value;
		model.change( writer => {
			if ( !selection.isCollapsed ) {
				for ( const range of model.schema.getValidRanges( selection.getRanges(), 'highlight' ) ) {
					newValue ? writer.setAttribute( 'highlight', true, range )
					         : writer.removeAttribute( 'highlight', range );
				}
			}
			newValue ? writer.setSelectionAttribute( 'highlight', true )
			         : writer.removeSelectionAttribute( 'highlight' );
		} );
	}
}

export default class Highlight extends Plugin {
	init() {
		const editor = this.editor;

		// 1. Schema: allow the attribute on text.
		editor.model.schema.extend( '$text', { allowAttributes: 'highlight' } );

		// 2. Conversion: model attribute 'highlight' <-> view <mark>.
		editor.conversion.attributeToElement( { model: 'highlight', view: 'mark' } );

		// 3. Command.
		editor.commands.add( 'highlight', new HighlightCommand( editor ) );

		// 4. UI button, reactive to command state.
		editor.ui.componentFactory.add( 'highlight', locale => {
			const button = new ButtonView( locale );
			const command = editor.commands.get( 'highlight' );
			button.set( { label: editor.t( 'Highlight' ), withText: true, isToggleable: true, tooltip: true } );
			button.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
			button.on( 'execute', () => { editor.execute( 'highlight' ); editor.editing.view.focus(); } );
			return button;
		} );

		// 5. Keystroke.
		editor.keystrokes.set( 'Ctrl+Alt+H', 'highlight' );
	}
}
```

The same five steps (schema → conversion → command → UI → keystroke) recur in almost every
feature. For elements/objects/widgets you `schema.register(...)` and use `elementToElement`
converters instead of `attributeToElement`; see `references/widgets.md`.

## Development workflow

1. **Write the plugin.** **Default: an in-aggregator plugin** — a file/folder under
   `packages/ckeditor5/src/plugins/`. Create a separate `packages/ckeditor5-<feature>` workspace
   package (`@triliumnext/ckeditor5-<feature>`, `main: "src/index.ts"`, ships TS source) **only for
   a large, self-contained feature**. See `references/tooling-and-packaging.md` ("Where a new plugin
   goes").
2. **Register it so it reaches the editor** (full flow in `references/tooling-and-packaging.md`):
   - For a new workspace package, add `"@triliumnext/ckeditor5-<feature>": "workspace:*"` to
     `packages/ckeditor5/package.json`.
   - Import it in `packages/ckeditor5/src/plugins.ts` and add it to the right array —
     `CORE_PLUGINS` (minimal/attribute editor), `TRILIUM_PLUGINS` (in-repo `src/plugins/`), or
     `EXTERNAL_PLUGINS` (the `@triliumnext` workspace packages). These compose into
     `COMMON_PLUGINS`, which the editor classes in `packages/ckeditor5/src/index.ts` expose as
     `static builtinPlugins`.
   - Add the component name to the toolbar in `apps/client/src/widgets/type_widgets/text/toolbar.ts`.
- **Always reach for the CKEditor 5 Inspector** while developing — it shows the live model,
  view, schema, commands, and selection. `import CKEditorInspector from '@ckeditor/ckeditor5-inspector'; CKEditorInspector.attach( editor );`
- **Change the model, not the DOM.** Wrap all model mutations in `editor.model.change( writer => … )`
  (one block = one undo step). Use `editor.editing.view.change()` only for view-only state
  (e.g. focus class) that the model does not represent.
- **Lint & test per package** with pnpm workspace filters:
  `pnpm --filter @triliumnext/ckeditor5-<feature> test` (also `lint`, `stylelint`, `test:debug`).
- **Verify** with `editor.getData()` / `editor.setData()` and by exercising selection edge
  cases (collapsed vs. ranged, inside objects/limits).
- **A changed plugin won't apply to an already-open editor via HMR.** A plugin's `init()` runs
  only when the editor is *built*, so do a **full page reload** (or close/reopen the note) to get a
  fresh editor instance that picks up your change — otherwise you're testing the old code.

## Reference map

Load the focused reference for the task at hand:

| File | Use it for |
|------|-----------|
| `references/architecture.md` | Model, view, schema, positions/ranges/selections, markers, the event/observable system, binding. The conceptual foundation. |
| `references/conversion.md` | Upcast/downcast pipelines, conversion helpers, custom (callback) converters, attribute/element/marker conversion, position mapping. |
| `references/commands.md` | `Command` patterns: `refresh()`/`execute()`, state (`value`/`isEnabled`), `forceDisabled()`, `affectsData`, command events. |
| `references/ui-and-localization.md` | Views & templates, component catalog (buttons, inputs, dropdowns, dialogs/modals, balloons, toolbars), icons, `componentFactory`, focus/keystroke management, and `t()` localization. |
| `references/widgets.md` | Block & inline widgets: `toWidget`/`toWidgetEditable`, nested editables, `insertObject`, widget toolbars, view↔model position mapping, custom properties, and external/async-rendered widgets (UI-element render callbacks, re-render on change, stale-render guard, lazy-load). |
| `references/conventions.md` | Trilium conventions: imports from `ckeditor5`/`@triliumnext` + required file extensions, per-package license/headers (not uniform), `@triliumnext` scope + `workspace:*`, per-package tsconfig, `?raw` icons, `.po` localization, `declare module 'ckeditor5'` augmentation, plus the upstream naming/CSS/BEM/JSDoc/TypeScript rules inherited via `eslint-config-ckeditor5`. For writing idiomatic code and reviewing. |
| `references/tooling-and-packaging.md` | Trilium packaging & wiring: the `@triliumnext/ckeditor5-<feature>` package layout, `workspace:*` deps, `main: src/index.ts` (no per-package dist), tsconfig/eslint/stylelint setup, the full registration flow (`plugins.ts` arrays → editor classes `builtinPlugins` → `toolbar.ts`), the three editor classes, the Vite build, how `apps/client` creates the editor (config, watchdog, lazy premium), and the Inspector. |
| `references/review-checklist.md` | A structured checklist for reviewing an existing plugin (architecture, schema, conversion, commands, UI, a11y, conventions). |
| `references/recipes.md` | Task-oriented how-tos: insert content, find/iterate nodes, custom observers, place caret, extend other plugins' UI, etc. |
| `references/core-plugin-patterns.md` | Canonical idioms mined from the actual `packages/*/src` source: toolbar+menu-bar button factory, plugin flags & `augmentation.ts`, `AttributeCommand`/`setAttributeProperties`, inline-attribute boundary helpers, `elementToStructure`+slots, reconversion, `BalloonToolbar`, raw-HTML widgets, clipboard pipeline, markers, post-fixers, async/upload. Each cites its source file. |

For **testing** a plugin (Vitest setup, test editors, model/view assertions, command/UI test
patterns), use the separate **`ckeditor5-testing`** skill.

## Quick review checklist (summary)

When reviewing a plugin, confirm: editing/UI split with a glue plugin; `static get requires()`
and `pluginName` present; schema registered/extended and the feature self-configures; symmetric
upcast + (data & editing) downcast converters; a `Command` whose `refresh()` sets `isEnabled`
correctly (disabled where the schema disallows it); UI bound to command state and refocusing the
editing view on execute; keyboard accessibility (keystrokes + `accessibility.addKeystrokeInfos`);
all user-facing strings wrapped in `t()`; model changes inside `model.change()`; cleanup of
trackers/handlers in `destroy()`. Full version: `references/review-checklist.md`. To **drive** a
review (workflow, CKEditor-specific defect patterns, contribution process), use the separate
**`ckeditor5-reviewing`** skill, which delegates back to this checklist.

## Scope & sources

This skill is specific to the **Trilium (TriliumNext Notes) monorepo's** CKEditor 5 integration.
Repository paths it cites — `packages/ckeditor5`, `packages/ckeditor5-<feature>`, `apps/client/...` —
are **this repository**, and examples come from Trilium's own plugins (admonition, collapsible,
footnotes, keyboard-marker, math, mermaid). The CKEditor 5 **library** is an external dependency
pinned to **48.2.0**; its mechanics were distilled from the upstream docs (ckeditor.com/docs) and
source (github.com/ckeditor/ckeditor5, commit 9ecca53627). Where a snippet cites an upstream library
package (e.g. ckeditor5-basic-styles, -link, -image), that is the library's own source — not a
Trilium package.
