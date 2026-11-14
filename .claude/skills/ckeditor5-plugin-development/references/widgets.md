# Widgets (block & inline)

A **widget** is a model element rendered in the editing view with widget behavior: clickable
to select, copy/paste/delete as a unit, hover/focus outlines, and optional **nested editable**
regions. The widget system ships in `ckeditor5` (engine + widget layer); import everything
from `ckeditor5`.

In the Trilium monorepo the live examples are:
- **aside** (`packages/ckeditor5/src/plugins/aside`): the smallest complete block widget with a
  nested editable, one `$blockObject` around one `isLimit` editable, with a selection handle, a
  post-fixer, a toolbar, positions and a resize grip. See _A worked example: the aside_ below.
- **multicolumn** (the column layout) and **tabs** (`packages/ckeditor5/src/plugins/multicolumn`,
  `packages/ckeditor5/src/plugins/tabs`): block widgets with several nested editables, whose
  post-fixers keep their structure.
- **math** (`packages/ckeditor5/src/plugins/math`, KaTeX): an external, async-rendered widget (see
  the dedicated section below).

The admonition and the collapsible block are not widgets: both are `$container` elements (model
`aside` with `admonitionType`, saved as `<aside class="admonition note">`, and `details`), whose
blocks are edited in place, as a block quote's are.

Two flavors:
- **Block widget** — `inheritAllFrom: '$blockObject'` (aside, column layout, tabs, block image,
  table).
- **Inline widget** — `inheritAllFrom: '$inlineObject'` (text-like; lives where `$text` is
  allowed, e.g. a placeholder/merge-field).

Both follow the standard editing/UI/glue split (see SKILL.md). The editing plugin must
`static get requires() { return [ Widget ]; }` — without the `Widget` plugin the view gets
widget classes but no behavior (clicking won't select). Local imports use file extensions
(`./aside_editing.js`); library symbols come from `ckeditor5`.

## Inline widget recipe (placeholder)

Model: `<placeholder name="time">` inside text. View/data: `<span class="placeholder">{time}</span>`.

```js
import { Plugin, Widget, toWidget, viewToModelPositionOutsideModelElement } from 'ckeditor5';

class PlaceholderEditing extends Plugin {
	static get requires() { return [ Widget ]; }
	init() {
		this._defineSchema();
		this._defineConverters();
		this.editor.commands.add( 'placeholder', new PlaceholderCommand( this.editor ) );
		// Map view positions inside the <span> to outside the model element (avoids
		// model-nodelist-offset-out-of-bounds when selecting the widget).
		this.editor.editing.mapper.on( 'viewToModelPosition',
			viewToModelPositionOutsideModelElement( this.editor.model, v => v.hasClass( 'placeholder' ) ) );
		this.editor.config.define( 'placeholderConfig', { types: [ 'date', 'first name', 'surname' ] } );
	}
	_defineSchema() {
		this.editor.model.schema.register( 'placeholder', {
			inheritAllFrom: '$inlineObject',   // selectable, atomic, allowed where $text is; can carry text attrs
			allowAttributes: [ 'name' ]
		} );
	}
	_defineConverters() {
		const conversion = this.editor.conversion;
		conversion.for( 'upcast' ).elementToElement( {
			view: { name: 'span', classes: [ 'placeholder' ] },
			model: ( viewElement, { writer } ) =>
				writer.createElement( 'placeholder', { name: viewElement.getChild( 0 ).data.slice( 1, -1 ) } )
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'placeholder',
			view: ( item, { writer } ) => toWidget( createView( item, writer ), writer )
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'placeholder',
			view: ( item, { writer } ) => createView( item, writer )   // NO toWidget in data
		} );
		function createView( item, writer ) {
			const span = writer.createContainerElement( 'span', { class: 'placeholder' } );
			writer.insert( writer.createPositionAt( span, 0 ), writer.createText( `{${ item.getAttribute( 'name' ) }}` ) );
			return span;
		}
	}
}
```

Command inserts the object and selects it:

```js
class PlaceholderCommand extends Command {
	execute( { value } ) {
		const selection = this.editor.model.document.selection;
		this.editor.model.change( writer => {
			const ph = writer.createElement( 'placeholder', { ...Object.fromEntries( selection.getAttributes() ), name: value } );
			this.editor.model.insertObject( ph, null, null, { setSelection: 'on' } );
		} );
	}
	refresh() {
		const sel = this.editor.model.document.selection;
		this.isEnabled = this.editor.model.schema.checkChild( sel.focus.parent, 'placeholder' );
	}
}
```

UI is typically a `createDropdown` list of types read from config (see `ui-and-localization.md`).

## Block widget recipe (box with nested editables)

Model:

```text
<simpleBox>
  <simpleBoxTitle></simpleBoxTitle>
  <simpleBoxDescription></simpleBoxDescription>
</simpleBox>
```

Schema — the box is a `$blockObject`; children are `isLimit` editables with controlled content:

```js
schema.register( 'simpleBox', { inheritAllFrom: '$blockObject', allowAttributes: [ 'secret' ] } );
schema.register( 'simpleBoxTitle', { isLimit: true, allowIn: 'simpleBox', allowContentOf: '$block' } );
schema.register( 'simpleBoxDescription', { isLimit: true, allowIn: 'simpleBox', allowContentOf: '$root' } );
schema.addChildCheck( ( ctx, child ) => {
	if ( ctx.endsWith( 'simpleBoxDescription' ) && child.name == 'simpleBox' ) return false; // no nesting
} );
```

Conversion — split editing vs. data downcast; `toWidget()` on the container,
`toWidgetEditable()` on each nested editable (built with `createEditableElement`). Upcast and
dataDowncast stay plain so `getData()` is clean:

```js
conversion.for( 'upcast' ).elementToElement( { model: 'simpleBox', view: { name: 'section', classes: 'simple-box' } } );
conversion.for( 'dataDowncast' ).elementToElement( { model: 'simpleBox', view: { name: 'section', classes: 'simple-box' } } );
conversion.for( 'editingDowncast' ).elementToElement( {
	model: 'simpleBox',
	view: ( el, { writer } ) => {
		const section = writer.createContainerElement( 'section', { class: 'simple-box' } );
		writer.setCustomProperty( 'simpleBox', true, section );          // tag for widget detection
		return toWidget( section, writer, { label: 'simple box widget' } );
	}
} );
// title / description:
conversion.for( 'editingDowncast' ).elementToElement( {
	model: 'simpleBoxTitle',
	view: ( el, { writer } ) => toWidgetEditable( writer.createEditableElement( 'h1', { class: 'simple-box-title' } ), writer )
} );
```

`toWidget()` makes content non-editable (sets `contentEditable=false` + classes like
`ck-widget`); `toWidgetEditable()` makes a nested region editable again. They react to hover,
selection, and focus.

Insert command uses `model.insertObject()` (splits paragraphs as needed) and builds the
structure with the writer. **A nested editable needs at least one paragraph** to be editable:

```js
function createSimpleBox( writer ) {
	const box = writer.createElement( 'simpleBox' );
	const title = writer.createElement( 'simpleBoxTitle' );
	const desc = writer.createElement( 'simpleBoxDescription' );
	writer.append( title, box );
	writer.append( desc, box );
	writer.appendElement( 'paragraph', desc );   // required, see ckeditor5#1464
	return box;
}
// refresh(): isEnabled = schema.findAllowedParent( selection.getFirstPosition(), 'simpleBox' ) !== null;
```

**Trilium block widgets — schema invariants via post-fixers.** The aside, the column layout and
the tabs use `inheritAllFrom: '$blockObject'` (+ `isLimit` on the nested editable) exactly as
above, and guard their structure with `editor.model.document.registerPostFixer(...)`: fixers that
run after every change to repair illegal states (ensure the required child exists, merge extra
ones, refill an empty editable, undo a disallowed nesting). See `registerPostFixer()` in
`aside_editing.ts`, `multicolumn_editing.ts` and `tabs_editing.ts`; the admonition and collapsible
containers keep their invariants the same way. A post-fixer returns `true` if it made a change (to
re-run the cycle). Prefer post-fixers over command-side cleanup so the document stays valid no
matter how the change originated (paste, undo, collaboration).

**Forbid nesting in the post-fixer, not in the schema.** The recipe above refuses a box inside its
own description with `addChildCheck()`. Don't do that for an object that holds the user's text:
`model.insertContent()`, which paste, drop and snippets go through, checks every level of the
inserted content against the schema. It unwraps a refused element that is not an object, and
removes a refused object with all its content (`_removeDisallowedChildren()` in the engine, on by
default; the deprecated `experimentalFlags.modelInsertContentDeepSchemaVerification` turns it
off). An aside pasted into an aside would lose its text. So the aside's schema allows the nesting
(`allowContentOf: '$root'` takes `$blockObject`s), its post-fixer replaces an inner aside with its
blocks (`fixAside()`), and `insertAside` is disabled inside an aside and on a selected one.

## A worked example: the aside

`packages/ckeditor5/src/plugins/aside/` keeps the editing/UI/glue split: `aside_editing.ts`
(schema, converters, post-fixer, and the registrations with the shared parts below),
`aside_commands.ts` (`insertAside`, `removeAside`, `asideColor`), `aside_ui.ts` (the insert
button, the background color and position dropdowns and the toolbar) and `constants.ts`. Its
stylesheet is `src/theme/aside.css`.

- **A saved form without the editable.** The model is `asideBlock > asideContent > blocks`, the
  editing view an `<aside>` widget (with a selection handle) around the nested editable
  `<div class="aside-content">`, and the saved HTML a bare `<aside>` that holds the blocks. The
  data downcast converts the children of `asideContent` into the `<aside>` and maps the model
  positions inside it there (`registerDataDowncast()`); the upcast creates `asideContent` and
  converts the children into it.
- **Two features on one tag.** An admonition is saved as `<aside class="admonition …">` too. The
  aside's upcast is an `element:aside` listener at `high` priority that skips `.admonition`, so it
  runs before the admonition's converter and General HTML Support, and the admonition's upcast
  matches only `aside.admonition`. Every other reader of the saved HTML makes the same split:
  `isAside()` in the Markdown export, the import's `normalizeToEditorMarkup()`, and
  `aside:not(.admonition)` in `aside.css`.
- **Nesting** is allowed by the schema and undone by the post-fixer (above).
- **Placing, resizing and the selected look** come from the shared parts below; the aside only
  registers with them.
- **A color dropdown from CKEditor's own.** `AsideColorUI` extends `FontColorUIBase`, so the
  `asideColor` dropdown is the font background color's: the palette of `asideColor` in the editor
  configuration, _Remove color_, and the color picker with its undo batch, which
  `AsideColorCommand` takes as `{ value, batch }` like a font color command. The color is the
  `backgroundColor` attribute, saved as `background-color`; `AdaptiveColors` adds
  `--tn-background` and the stylesheet adapts it in the `aside-background` role (see the
  `working-with-adaptive-colors` skill). A phone's context bar opens dropdowns as menus of rows, so
  the toolbar leaves the color out there (`hasContextToolbar()`).

## Shared parts for block widgets

A block widget that the user places in the text, resizes or types in reuses these.

- **`PositionedWidgets`** (`plugins/positioned_widgets.ts`) places a widget on lines of its own at
  the left, center or right, or with the text wrapped around it at the left or right
  (`POSITIONS`). Call `register(modelName, { commandName, getPositions?, getPosition? })` from
  `init()`, after the schema: it allows the `position` attribute, writes it as `data-position` in
  the editing view, and adds a `WidgetPositionCommand` for the selected widget or the one around
  the selection. The widget's own upcast and data downcast read and write the attribute with
  `getPositionOfView()` and `getPositionAttributes()`; centered is not saved. The toolbar takes
  `createWidgetPositionDropdown()` and `getAnchoredToolbarPositions()`, which keeps it level with
  the edge the widget sits against (`getAnchor()`). The widget's stylesheet places it by
  `data-position`.
- **`ResizableWidgets`** (`plugins/resizable_widgets/`) resizes a widget with a mouse, a pen or a
  finger. Call `register(modelName, config)` from `init()`:
  - `propertyPrefix` names the CSS custom properties that save the size, `<prefix>-width` and
    `<prefix>-height` in `em` (model attributes `customWidth` and `customHeight`). The widget's
    stylesheet applies them, and the import sanitizer must allow them on the widget's element
    (see the checklist at the end). The `em` is the widget's own: a widget with its own
    `font-size`, as the aside's `--aside-font-size`, saves sizes in its ems, so a change to that
    font size rescales every saved size.
  - `isWidthResizable` and `isHeightResizable` take a boolean or a function of the element;
    `getAnchor` (usually `PositionedWidgets#getAnchor`) gives the edge that stays in place;
    `isResizable`, `heightTarget`, `minWidth` and `minHeight` are optional. Double-clicking a
    grip resets its axes.
  - The corner shows a grip on every screen; the edge handles show theirs on touch screens only.
    For a widget that resizes on one axis, pass a **function** that returns `false` for the
    other, as the aside does (`isHeightResizable: () => false`): the widget gets
    `ck-widget_fixed-height`, which keeps the corner alone, resizing the free axis. A plain
    `false` leaves a single edge handle, which has no grip on a mouse screen.
  - The corner's cursor (`src/theme/resizable_widgets.css`) is a diagonal that follows the edge
    the widget is anchored to, or `ew-resize` / `ns-resize` when one axis is fixed. Those two
    rules tie with the anchor rules on specificity and must stay after them.
  - Specs stub `Element.prototype.setPointerCapture`, and emulate a touch screen with CDP
    `Emulation.setTouchEmulationEnabled` to check the edge grips.
- **`NestedLimitSelection`** (`plugins/nested_limit_selection.ts`) widens a selection that leaves
  a nested editable only as far as the innermost limit that holds both ends, where CKEditor would
  select the whole outer widget. The aside and the column layout require it.
- **`widget_utils.ts`** (`plugins/widget_utils.ts`):
  - `markWidgetOfSelection(editor, findWidget)` gives `ck-widget_selected` to the widget that
    holds the selection, as `Widget` gives it to a widget the selection is on. An aside then
    looks selected, with its resize grip, while the caret is in it, and a content embed while
    its caption holds the caret.
  - `findSelectedWidget(selection, property)` returns the innermost widget with the custom
    property `property` that is selected or holds the selection: the `getRelatedElement` of a
    toolbar that also shows while the caret is inside (aside, column layout, tabs).
  - `markFocusedContainers()` keeps a class of your own on the containers that hold the focused
    nested editable, so a stylesheet can mark them without a `:has()` (column layout, tabs).

## Widget attributes (e.g. a boolean toggle)

Add to schema (`allowAttributes: [ 'secret' ]`), convert with the two-way
`attributeToAttribute` helper (maps a CSS class ↔ model attribute in both pipelines), and
expose a `SwitchButtonView` bound to a toggle command:

```js
conversion.attributeToAttribute( { model: 'secret', view: { name: 'section', key: 'class', value: 'secret' } } );
```

Boolean-attribute convention: set `true` to enable, **remove** the attribute to disable.

## Widget contextual toolbar

A contextual toolbar appears when a **widget is selected** — distinct from the main `toolbar.ts`
toolbar (which holds the insert button). Register it **inside the plugin** with
`WidgetToolbarRepository` (in `afterInit()`, because it depends on runtime state). Items come from
config; `getRelatedElement` decides when the toolbar shows by finding the widget view element
(detect via the custom property + `isWidget()`):

```js
import { Plugin, WidgetToolbarRepository } from 'ckeditor5';

class SimpleBoxToolbar extends Plugin {
	static get requires() { return [ WidgetToolbarRepository ]; }
	afterInit() {
		const editor = this.editor;
		editor.plugins.get( WidgetToolbarRepository ).register( 'simpleBoxToolbar', {
			items: editor.config.get( 'simpleBox.toolbar' ),     // e.g. [ 'secretSimpleBox' ]
			getRelatedElement: getClosestSimpleBoxWidget
		} );
	}
}
// getRelatedElement walks the view from selection looking for an element where
// !!viewElement.getCustomProperty('simpleBox') && isWidget(viewElement).
```

This is the same mechanism images/tables use to show their contextual toolbars. In Trilium, the
aside registers its toolbar this way (`aside_ui.ts`), with the position dropdown and the remove
button. A toolbar that should also show while the caret is inside the widget takes
`findSelectedWidget()` from `plugins/widget_utils.ts` as its `getRelatedElement` (see _Shared
parts for block widgets_).

## External / async-rendered widgets (math, mermaid)

Trilium's **math** (KaTeX, `packages/ckeditor5/src/plugins/math`) and **mermaid**
(`packages/ckeditor5/src/plugins/mermaid`) plugins are the real-world references for this section. Widgets
that render the output of an external library need a few patterns beyond the static-widget
basics. The model stores the **source** (the LaTeX string / mermaid diagram code) as an
attribute; the **data downcast** emits that source wrapped in plain markup (so `getData()` is
clean and re-parseable — see the data-processor note below), while the **editing downcast**
renders it via KaTeX/Mermaid.

**Host the rendered output in a UI element.** A `UIElement`'s render callback runs in the real
DOM and is the hook for injecting external output into the editing view (UI elements are filtered
out of the data pipeline, so this never pollutes `getData()`):

```js
conversion.for( 'editingDowncast' ).elementToElement( {
	model: { name: 'diagram', attributes: [ 'source' ] },  // attributes → reconvert on change (see below)
	view: ( modelEl, { writer } ) => {
		const wrapper = writer.createContainerElement( 'div', { class: 'diagram' } );
		const rendered = writer.createUIElement( 'div', { class: 'diagram__preview' }, function( domDocument ) {
			const domElement = this.toDomElement( domDocument );      // real DOM node
			void renderInto( domElement, modelEl.getAttribute( 'source' ) );  // async render
			return domElement;
		} );
		writer.insert( writer.createPositionAt( wrapper, 0 ), rendered );
		return toWidget( wrapper, writer, { label: 'diagram' } );
	}
} );
```

**Re-render when the source changes.** Two options:
- **Idiomatic — reconversion.** Listing the attribute in the model matcher
  (`model: { name, attributes: [ 'source' ] }`, as above) makes the converter re-run when `source`
  changes, rebuilding the element and its UI element → the render callback fires again. Simplest;
  rebuilds the whole widget view.
- **Imperative — downcast listener.** To update the existing DOM without rebuilding, listen to the
  editing downcast dispatcher and re-render in place:

  ```js
  editor.editing.downcastDispatcher.on( 'attribute:source:diagram', ( evt, data, conversionApi ) => {
  	const viewEl = conversionApi.mapper.toViewElement( data.item );
  	// locate the rendered DOM node via the view→DOM converter and re-render it
  } );
  ```

**Guard against stale async renders.** Overlapping renders can finish out of order and clobber a
newer one. Gate writes with a generation counter:

```js
this._gen = 0;
async renderInto( domEl, source ) {
	const gen = ++this._gen;
	const out = await lib.render( source );
	if ( gen === this._gen ) domEl.innerHTML = out;   // ignore if a newer render started
}
```

**Lazy-load the library once.** Cache the load promise so a heavy dependency loads on first use
and initializes a single time, driven from config so Trilium can supply the loader. Math reads
`mathConfig.lazyLoad` (and `mathConfig.katexRenderOptions`) from `editor.config`
(`packages/ckeditor5/src/plugins/math/math_editing.ts`, `math_ui.ts`); the glue plugin in
`math.ts` types the config shape via `declare module 'ckeditor5'`:

```ts
this._libPromise ??= Promise.resolve( editor.config.get( 'math.lazyLoad' )() )
	.then( lib => { lib.initialize( editor.config.get( 'math.config' ) ); return lib; } );
const lib = await this._libPromise;
```

**Editable source inside the widget.** If users type the raw source into a textarea/field embedded
in the widget, wrap that element so the editor's own keystroke/selection handlers don't hijack
input — give the container the `data-cke-ignore-events` attribute. Debounce the input handler that
writes back to the model (`editor.model.change(...)`).

**Mode / state machine.** For source/preview/split toggles, store a display-mode attribute,
expose one command per mode that sets it, render different DOM per mode in the editing
downcast, and bind the widget-toolbar buttons' `isOn` to each command's value so they reflect
the current mode. Mermaid is exactly this: separate `mermaidSourceViewCommand`,
`mermaidPreviewCommand`, and `mermaidSplitViewCommand`
(`packages/ckeditor5/src/plugins/mermaid/`) drive the mode, surfaced through the widget
toolbar from `mermaidtoolbar.ts`.

**Pre-process input with a data processor.** To accept the raw source on load, wrap/transform
it in a data-processor step so upcast sees a converter-friendly shape; mermaid does this in its
editing setup so a fenced/diagram block round-trips cleanly through `getData()`.

## Useful widget utilities

`toWidget`, `toWidgetEditable`, `isWidget`, `viewToModelPositionOutsideModelElement`,
`WidgetToolbarRepository`, plus engine helpers `model.insertObject`, `model.insertContent`,
`writer.setCustomProperty`, `selection.getSelectedElement()`, `position.findAncestor(name)`.

If you attach custom DOM event handlers inside a widget (or an editable source field), wrap
them in a container with the `data-cke-ignore-events` attribute so the editor's default
handlers skip them — math/mermaid use this around their source inputs.

## Wiring a new block widget into Trilium

A new block widget reaches every place below. The aside does, so a search for `aside`,
`asideBlock` or `theme/aside.css` finds an example of each.

In the editor (`packages/ckeditor5`):
- **Registration**: the glue plugin in an array of `src/plugins.ts` (the aside is in
  `EXTERNAL_PLUGINS`), and an import of its module in `src/index.ts`, which loads its
  `declare module 'ckeditor5'` augmentation for config and command typings.
- **Insert**: a `componentFactory` button whose name goes into the insert group of the classic,
  floating and mobile toolbars in `apps/client/src/widgets/type_widgets/text/toolbar.ts`
  (`toolbar.spec.ts` checks the order; see `ui-and-localization.md`), and an entry in
  `plugins/mention/slash_commands.ts` with the `aliases` users search by.
- **Contextual toolbar**: registered in the plugin (above), not in `toolbar.ts`, with its title in
  `getToolbarName()` of `plugins/context_toolbar.ts`.
- **Strings and icon**: each `editor.t()` message needs its `text-editor.ck` entry, and a new SVG
  means regenerating the `cke` icon font (both in SKILL.md).
- **Vim mode**: a line rule and specs (the `developing-vim-mode` skill, _A new block, widget or
  container_).

In the client (`apps/client`):
- **Block type**: `BLOCK_TYPES` in `src/services/block_reference.ts` maps the model element to a
  `BlockType`, labeled under `block_handle_menu.types` in the client catalogue, and `byBlockType`
  in `src/services/in_app_help.ts` gives its help page (`null` until the User Guide has one).
- **Selected outline in the Next theme**: `src/stylesheets/theme-next/notes/text.css` colors
  selected block widgets through `.ck-editor__editable :is(div, figure, section,
  aside).ck-widget_selected`, a list of tag names. A widget drawn as another element gets the
  default outline color, not the theme's, until its tag joins the list.

The content stylesheet (`src/theme/<widget>.css`, rules under `.ck-content`): every surface that
shows saved content loads it itself. The aside's reaches:
- the editor (imported by the glue plugin) and read-only notes (`apps/client/src/index.ts`, with
  the other content styles shared with the share theme);
- print (`apps/client/src/print.tsx`) and the presentation view
  (`apps/client/src/widgets/collections/presentation/index.tsx`);
- share pages (`packages/share-theme/src/index.ts`);
- the copy each build serves as `ckeditor5-<widget>.css` (`scripts/build.ts` of `apps/server`,
  `apps/desktop` and `apps/edit-docs`, checked by their `spec/build-checks/artifacts.spec.ts`);
- the static HTML export (`apps/server/src/services/export/zip/factory.ts` and
  `apps/standalone/src/lightweight/zip_export_provider_factory.ts`).

The saved HTML on the backend (`packages/trilium-core/src/services`, `packages/commons`):
- **Import sanitizer** (`sanitizer.ts`, on every import path): `data-*` attributes pass on any
  element, but a style custom property needs an `allowedStyles` entry for its element. A new tag
  goes into the default allowed tags (`packages/commons/src/lib/shared_constants.ts`), which reach
  only new databases: existing ones keep their list in the `allowedHtmlTags` option.
- **Markdown**: the export (`export/markdown.ts`) needs a rule for the element, and the import
  (`import/markdown.ts`, `normalizeToEditorMarkup()`) restores what the export gives up, so a note
  that goes out to Markdown and back is unchanged. The aside exports as `<aside>` tags on lines of
  their own around the Markdown of its blocks, as a column of the column layout does.
- **Block references** (`sliceToBlockReference()` in `packages/commons/src/lib/block_reference.ts`):
  decide what an excerpt keeps of the widget. An aside that is the only block loses its position.
