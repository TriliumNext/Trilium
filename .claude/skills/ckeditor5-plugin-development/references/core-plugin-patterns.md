# Canonical patterns from the core plugins

> **The source paths below (`packages/ckeditor5-basic-styles`, `-link`, `-image`, `-ui`, etc.)
> point into the CKEditor 5 *library* source
> ([github.com/ckeditor/ckeditor5](https://github.com/ckeditor/ckeditor5)) — the external
> dependency Trilium pins at `48.2.0` — NOT into Trilium's monorepo.** They show where each idiom
> lives in the library's own source. These are the upstream library packages (basic-styles, link,
> image, engine, ui, core, widget, typing); do **not** confuse them with Trilium's own
> `packages/ckeditor5-*` plugins (admonition, collapsible, footnotes, keyboard-marker, math,
> mermaid), which apply these very same patterns. You can't open the upstream files as local
> Trilium files — the symbols ship inside the `ckeditor5` npm package.

Real-world idioms mined from the actual library `packages/*/src` source (verified against
`ckeditor5@48.2.0`). These go beyond the tutorials and are the patterns the official plugins
actually use — and the patterns Trilium's plugins follow. Each item cites its source file in the
CKEditor library repository.

**Imports.** The snippets keep the symbol names but in Trilium you import them all from the single
**`ckeditor5`** package (with file extensions on relative imports) — e.g. `import { Plugin,
ButtonView, MenuBarMenuListItemButtonView, AttributeCommand, TwoStepCaretMovement,
findAttributeRange, inlineHighlight, Widget, toWidget, WidgetToolbarRepository } from 'ckeditor5';`.
Where a snippet shows an `@ckeditor/ckeditor5-*` or relative `../utils.js` import (the library's
internal style), treat it as a pointer to where the symbol lives upstream, not the path you'd write
in a Trilium plugin.

## Buttons & the component factory

Trilium registers toolbar buttons directly via `editor.ui.componentFactory.add(...)` in each
plugin's `*ui.ts` (see `ui-and-localization.md` for the Trilium pattern and the `toolbar.ts`
wiring). Trilium has **no menu bar**, so there is no `menuBar:<name>` registration — and the
library's internal `_getBasicStylesButtonCreator` helper / `MenuBarMenuListItemButtonView` are not
used here. Useful library facts that still apply:

- `SwitchButtonView` auto-sets `isToggleable`. `FileDialogButtonView` fires a `done` event with a
  `FileList` (`acceptedType`, `allowMultipleFiles`) — use for file pickers.
- `componentFactory` API: `add(name, locale => view)`, `create(name)`, `has(name)`, `names()`;
  names are case-insensitive; views are created fresh per `create()`.

## Glue plugin & dependency typing

```ts
export class Admonition extends Plugin {
	public static get requires() { return [ AdmonitionEditing, AdmonitionUI ] as const; }
	public static get pluginName() { return 'Admonition' as const; }
}
```

- Trilium glue plugins use `pluginName` / `requires` with `as const` and **do not** set the
  library's `isOfficialPlugin` / `isPremiumPlugin` flags (those are CKSource first-party markers).
- `requires()` may list classes **or** plugin-name strings; order = load order.
- A `Command` must never go in `config.plugins` (it throws) — register with `editor.commands.add()`.

## augmentation.ts (typed plugins/commands/config)

```ts
// packages/ckeditor5-<feature>/src/augmentation.ts
declare module 'ckeditor5' {
	interface PluginsMap { [ Admonition.pluginName ]: Admonition; }
	interface CommandsMap { admonition: AdmonitionCommand; }   // optional — only if exposed
	interface EditorConfig { admonition?: AdmonitionConfig; }
}
```

`index.ts` ends with `import './augmentation.js';` so the type maps register on import. Without it,
`editor.plugins.get('Bold')`, `editor.commands.get('bold')`, and `config.get('myFeature')` are
untyped. (See also `tooling-and-packaging.md`.)

## Reusable AttributeCommand + setAttributeProperties

Inline-style features don't hand-roll the command — they reuse `AttributeCommand` and tag the
attribute as formatting so it behaves natively (copied on Enter, replicated on paste). Trilium's
`ckeditor5-keyboard-marker` follows this exactly: it registers a built-in `AttributeCommand` for
its `$text` attribute rather than writing a custom command.

```ts
// packages/ckeditor5-basic-styles/src/bold/boldediting.ts
editor.model.schema.extend( '$text', { allowAttributes: 'bold' } );
editor.model.schema.setAttributeProperties( 'bold', { isFormatting: true, copyOnEnter: true } );
editor.conversion.attributeToElement( { model: 'bold', view: 'strong', upcastAlso: [ 'b', /* … */ ] } );
editor.commands.add( 'bold', new AttributeCommand( editor, 'bold' ) );  // exported from basic-styles
```

`AttributeCommand` (`packages/ckeditor5-basic-styles/src/attributecommand.ts`): `refresh()` sets
`value` from the first allowed node and `isEnabled = schema.checkAttributeInSelection(...)`;
`execute({ forceValue })` toggles via `getValidRanges(..., { includeEmptyRanges: true })` and sets
the **selection attribute** on collapsed selections. `setAttributeProperties` flags:
`isFormatting` (replicated like native formatting), `copyOnEnter` (persists across Enter).

## Inline attributes at boundaries (links pattern)

For attributes that wrap text and need correct caret behavior at their edges:

```ts
// packages/ckeditor5-link/src/linkediting.ts
import { TwoStepCaretMovement, inlineHighlight } from 'ckeditor5'; // source: @ckeditor/ckeditor5-typing

editor.plugins.get( TwoStepCaretMovement ).registerAttribute( 'linkHref' );   // caret stops at edges
inlineHighlight( editor, 'linkHref', 'a', 'ck-link_selected' );               // class when caret inside

// packages/ckeditor5-link/src/linkcommand.ts
import { findAttributeRange } from 'ckeditor5'; // source: @ckeditor/ckeditor5-typing
const linkRange = findAttributeRange( position, 'linkHref', linkHref, model ); // whole same-value run
```

- `TwoStepCaretMovement` (require it; `registerAttribute(key)`) gives the two-press-to-exit caret.
- `findAttributeRange(position, key, value, model)` returns the full contiguous range carrying the
  same attribute value — use it to edit/replace the whole link under a collapsed caret.
- `inlineHighlight(editor, key, viewTag, className)` toggles a class while the selection is inside.

## AttributeElement priority & decorator converters

Downcasting attributes to nested inline elements (e.g. link + decorators) uses **attribute element
priority** so wrappers nest predictably:

```ts
// link manual decorator (packages/ckeditor5-link/src/linkediting.ts)
const a = conversionApi.writer.createAttributeElement( 'a', decorator.attributes, { priority: 5 } );
// then writer.wrap()/unwrap() the toViewRange, after consumable.consume(item, evt.name)
```

Higher-priority attribute elements nest **inside** lower/default-priority ones. Manual converters
must `conversionApi.consumable.consume(item, evt.name)` (and `.test()` first) before writing, or
they double-process — `false` means another converter already claimed it
(`packages/ckeditor5-image/src/image/converters.ts`).

## elementToStructure + slots (block widget wrapping content)

When a widget wraps editable/model children in extra view structure (image figure + caption):

```ts
// packages/ckeditor5-image/src/image/imageblockediting.ts (+ image/utils.ts)
conversion.for( 'editingDowncast' ).elementToStructure( {
	model: 'imageBlock',
	view: ( modelElement, { writer } ) => {
		const figure = writer.createContainerElement( 'figure', { class: 'image' } );
		writer.insert( writer.createPositionAt( figure, 0 ), writer.createEmptyElement( 'img' ) );
		writer.insert( writer.createPositionAt( figure, 'end' ), writer.createSlot( 'children' ) );
		return toImageWidget( figure, writer, t( 'image widget' ) );
	}
} );
```

`writer.createSlot()` marks where model children render; `'children'` = all, or pass a filter
callback `node => node.is('element','caption')` for specific children. Slots follow model child
order. Use `createEmptyElement` for voids (`img`), `createContainerElement` for containers.

## Reconversion (re-run downcast on attribute change)

A plain `elementToElement`/`elementToStructure` won't re-run when an attribute changes. Declare the
attributes in the model matcher to auto-reconvert, or reconvert manually:

```ts
conversion.for( 'downcast' ).elementToElement( {
	model: { name: 'tableCell', attributes: [ 'headingRows' ] },   // re-runs when headingRows changes
	view: ( el, { writer } ) => writer.createContainerElement( 'td' )
} );

editor.editing.reconvertItem( item );   // manual full re-downcast (editingcontroller.ts)
```

Use when the *tag/structure* depends on an attribute (e.g. `td`↔`th`). Reconvert the parent when a
child-count change affects the parent's rendering.

## Floating selection toolbar (BalloonToolbar)

The `BalloonToolbar` plugin shows a toolbar over a non-collapsed selection (Medium-style). Items
come from the `balloonToolbar` config; it fills from the component factory and pins to the
selection rect.

```ts
// usage
ClassicEditor.create( el, { plugins: [ /* … */ ], balloonToolbar: [ 'bold', 'italic', 'link' ] } );

// internals: packages/ckeditor5-ui/src/toolbar/balloon/balloontoolbar.ts
static get requires() { return [ ContextualBalloon ]; }
this._balloonConfig = normalizeToolbarConfig( editor.config.get( 'balloonToolbar' ) );
this.toolbarView.fillFromConfig( this._balloonConfig, editor.ui.componentFactory );
```

Gotchas: position `target` is a **function** (recomputed for scrolling); selection changes are
debounced (~200 ms); hides on blur/collapsed selection; `decorate('show')` lets you cancel showing.
Contrast with `WidgetToolbarRepository` (toolbar tied to a selected widget, registered in
`afterInit()` with `getRelatedElement`) — see `widgets.md` and `ui-and-localization.md`.

## Raw HTML widgets (createRawElement)

For embedding arbitrary HTML the editor shouldn't parse (html-embed):

```ts
// packages/ckeditor5-html-embed/src/htmlembedediting.ts
editor.data.registerRawContentMatcher( { name: 'div', classes: 'raw-html-embed' } ); // keep inner HTML on upcast

conversion.for( 'dataDowncast' ).elementToElement( {
	model: 'rawHtml',
	view: ( el, { writer } ) => writer.createRawElement( 'div', { class: 'raw-html-embed' },
		domElement => { domElement.innerHTML = el.getAttribute( 'value' ) || ''; } )
} );
```

`createRawElement(tag, attrs, renderFn)` — `renderFn(domElement)` gets the real DOM node for direct
manipulation (innerHTML, listeners). `registerRawContentMatcher` preserves inner HTML through upcast
instead of converting it. Selection can't enter a raw element.

## Clipboard pipeline

Intercept paste/copy/drop via the clipboard pipeline events rather than raw DOM:

```ts
// packages/ckeditor5-clipboard/src/clipboardpipeline.ts
// input chain:  view 'paste'/'drop' → 'clipboardInput' → 'inputTransformation' → 'contentInsertion'
// output chain: view 'copy'/'cut'   → 'clipboardOutput'
import { ClipboardPipeline } from 'ckeditor5';
static get requires() { return [ ClipboardPipeline ]; }   // and add it to requires()
this.listenTo( editor.plugins.get( ClipboardPipeline ), 'inputTransformation', ( evt, data ) => {
	// data.content is a view DocumentFragment; transform pasted content here
}, { priority: 'low' } );
```

- **Footgun — `inputTransformation`/`contentInsertion` fire on `ClipboardPipeline`, NOT the
  `Clipboard` umbrella plugin.** `editor.plugins.get( Clipboard )` does **not** emit those events:
  in `@ckeditor/ckeditor5-clipboard`, `ClipboardPipeline._setupPasteDrop()` is what fires
  `new EventInfo( this, 'inputTransformation' )`, and the separate `Clipboard` class never
  references the event (its `init()` only registers keystroke accessibility info) — there is no
  `.delegate()` between them. So `this.listenTo( editor.plugins.get( Clipboard ), 'inputTransformation', … )`
  is a **silently-dead handler** (no error, never runs). Listen on `ClipboardPipeline` and add it to
  `requires()`. (Contrast: the raw `'clipboardInput'` view event fires on
  `editor.editing.view.document` — a different, correct emitter that the upload pipeline does listen
  to; see `packages/ckeditor5/src/plugins/file_upload/fileuploadediting.ts`.)

Add a custom observer by subclassing `DomEventObserver` and `view.addObserver(MyObserver)` (see the
double-click recipe in `recipes.md`). Prefix custom view events with a namespace.

## Markers in practice

```ts
editor.model.change( writer => {
	writer.addMarker( 'myFeature:1', { range, usingOperation: false, affectsData: false } );
} );
editor.conversion.for( 'editingDowncast' ).markerToHighlight( { model: 'myFeature', view: { classes: 'highlight' } } );
editor.conversion.for( 'dataDowncast' ).markerToData( { model: 'myFeature' } );
editor.conversion.for( 'upcast' ).dataToMarker( { view: 'myFeature' } );
```

- `usingOperation: false` = UI/state markers (search hits, fake selection; not undoable);
  `true` = collaborative/undoable. `affectsData: true` only when the marker is saved as data.
- **Fake visual selection** (keep a selection highlight while a balloon form is open): add a
  non-operation marker over the selection range and `markerToHighlight` it (link/`linkui` pattern).
- Marker ranges are live — they auto-update as the document changes.

## Post-fixers (enforce invariants)

```ts
editor.model.document.registerPostFixer( writer => {
	let changed = false;
	// inspect differ / structure, fix it, set changed = true if you wrote anything
	return changed;        // returning true triggers another pass
} );
editor.editing.view.document.registerPostFixer( writer => { /* view-side cleanup */ return false; } );
```

Post-fixers run after each change (model) or downcast (view) and re-run until all return `false`.
Use to guarantee structure (e.g. a required paragraph inside an editable, no two adjacent X).
Trilium's `ckeditor5-admonition` and `ckeditor5-collapsible` register **multiple**
`registerPostFixer`s to keep their block structure valid (e.g. an enforced title/content region).

## Inserting content — option details

```ts
model.insertObject( element, null, null, { findOptimalPosition: 'auto', setSelection: 'on' } );
const range = model.insertContent( fragmentOrNode, selectionOrPosition ); // returns affected range
const optimal = model.schema.findOptimalInsertionRange( selection, 'imageBlock' );
model.modifySelection( selection, { direction: 'forward', unit: 'character' } ); // unicode-aware
```

- `insertObject` options: `findOptimalPosition` (`'auto'`/`'before'`/`'after'`, block objects),
  `setSelection` (`'on'`/`'after'`). `insertContent` returns the inserted range (collapsed = nothing
  inserted). `findOptimalInsertionRange` avoids splitting blocks (respects widget type-around).

## UI niceties

- `CssTransitionDisablerMixin(MyView)` adds `disableCssTransitions()`/`enableCssTransitions()` —
  wrap a form/panel to avoid flicker on first show (`packages/ckeditor5-ui/src/bindings/`).
- Template bindings: `bind.to('prop')` (attr/text), `bind.if('prop','class')` (conditional class),
  `bind.to(evt => …)` (event). `view.extendTemplate({...})` augments an existing view's template.
- `addKeyboardHandlingForGrid({ keystrokeHandler, focusTracker, gridItems, numberOfColumns, uiLanguageDirection })`
  for arrow-key navigation in grid UIs (special characters, emoji).
- `editor.accessibility.addKeystrokeInfos({ keystrokes: [ { label, keystroke } ] })` (and
  `addKeystrokeInfoGroup`/`addKeystrokeInfoCategory`) feed the Alt+0 help dialog — call after
  registering the keystroke.

## Async work: PendingActions & upload adapters

```ts
const pending = editor.plugins.get( 'PendingActions' );           // a ContextPlugin — add to requires()
const action = pending.add( t( 'Saving changes' ) );
action.bind( 'message' ).to( /* … */ );
pending.remove( action );

// Upload: implement the adapter on FileRepository (packages/ckeditor5-upload)
editor.plugins.get( 'FileRepository' ).createUploadAdapter = loader => ( {
	upload: () => loader.file.then( file => /* … */ ( { default: url } ) ),
	abort: () => {}
} );
```

`PendingActions` warns the user before leaving with unsaved async work. The upload adapter's
`upload()` resolves to a `{ default: url, … }` map of URLs; `loader` exposes `file`, `uploaded`,
`uploadTotal`.

## Config defaults

Call `editor.config.define( 'myFeature', { … } )` in the **constructor** (not `init()`), then read
with `editor.config.get( 'myFeature.key' )`. `define()` only fills values the integrator didn't set.

## Editor types (one-liners)

`ClassicEditor` (boxed UI, sticky toolbar), `InlineEditor` (floating toolbar over an inline
editable), `BalloonEditor` (selection balloon toolbar), `DecoupledEditor` (you place toolbar +
editable yourself), `MultiRootEditor` (many editables, no `ElementApiMixin`; `sourceElements` map).
All share the `create()` flow: `initPlugins()` → `ui.init()` → `data.init()` → fire `ready`. See
`tooling-and-packaging.md` for the custom-creator anatomy. Trilium subclasses these in
`packages/ckeditor5/src/index.ts`: `AttributeEditor`/`PopupEditor` extend `BalloonEditor`, and its
`ClassicEditor` extends `DecoupledEditor` (see `architecture.md` → Editor classes).
